// The screens and the chrome around them. Each screen is built as exactly `height` lines of exactly
// `width` cells, so the frame never scrolls or leaves stale cells behind.
import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { Issue } from '../core/types.js';
import type { TuiData } from './data.js';
import type { IssueUi } from './detail.js';
import { paneLines } from './detail.js';
import {
  displayWidth, dueLabel, GROUP_MODES, inboxItems, issuesForRoute, listRowsFor, padEnd, padStart, PRESET_LABEL,
  progressBar, projectProgress, projectRows, relTime, TAB_GAP, tabText, truncate, wrap, type InboxItem, type Line, type ListRow, type Seg, type Tab,
} from './model.js';
import { listViewOf, routeKey, type TuiState } from './state.js';
import { HEALTH, keySeg, priorityMark, SPINNER, STATE_ICON, theme } from './theme.js';
import { LineView } from './ui.js';

const SELECT_BAR: Seg = { text: '▌ ', color: theme.accent };
const NO_BAR: Seg = { text: '  ' };

/** the first visible row: moves only as far as needed to keep `cursor` in view */
export function windowStart(prev: number, cursor: number, height: number, total: number): number {
  let start = prev;
  if (cursor < start) start = cursor;
  if (cursor >= start + height) start = cursor - height + 1;
  return Math.max(0, Math.min(start, Math.max(0, total - height)));
}

export function useWindow(key: string, cursorRow: number, height: number, total: number): number {
  const starts = useRef<Record<string, number>>({});
  const start = windowStart(starts.current[key] ?? 0, cursorRow, height, total);
  starts.current[key] = start;
  return start;
}

/** `sel` is the row drawn on the selection background; `dim` greys everything out while an overlay has the keys */
export function Lines({ lines, width, height, sel = -1, dim }: { lines: Line[]; width: number; height: number; sel?: number; dim?: boolean }) {
  const out = lines.slice(0, height);
  while (out.length < height) out.push([]);
  return (
    <Box flexDirection="column" width={width} height={height}>
      {out.map((l, i) => <LineView key={i} line={l} width={width} bg={i === sel && !dim ? theme.selBg : undefined} dim={dim} />)}
    </Box>
  );
}

function emptyState(width: number, height: number, title: string, hint: string): Line[] {
  const top = Math.max(0, Math.floor(height / 3) - 1);
  const center = (t: string) => ' '.repeat(Math.max(0, Math.floor((width - displayWidth(t)) / 2)));
  return [...Array.from({ length: top }, () => []), [{ text: center(title) }, { text: title, bold: true }], [], [{ text: center(hint) }, { text: hint, color: theme.muted }]];
}

// ---------- issue list ----------

interface Columns { key: number; title: number; state: boolean; assignee: boolean; due: boolean }

function listColumns(rows: ListRow[], data: TuiData, width: number, showAssignee: boolean, showState: boolean): Columns {
  const issues = rows.filter((r): r is Extract<ListRow, { kind: 'issue' }> => r.kind === 'issue').map(r => r.issue);
  const key = Math.max(6, ...issues.map(i => data.keyOf(i).length));
  let room = width - (2 + 2 + key + 2 + (showState ? 2 : 0));
  const take = (w: number) => { if (room - w - 2 >= 20) { room -= w + 2; return true; } return false; };
  const due = issues.some(i => i.dueDate) ? take(8) : false;
  const assignee = showAssignee ? take(2) : false;
  return { key, title: room, state: showState, assignee, due };
}

function issueLine(i: Issue, data: TuiData, cols: Columns, selected: boolean, now: number): Line {
  const st = data.stateById.get(i.stateId);
  const pm = priorityMark(i.priority);
  const line: Line = [selected ? SELECT_BAR : NO_BAR, { text: pm.text, color: pm.color, bold: i.priority === 1 }, { text: ' ' },
    { text: padEnd(data.keyOf(i), cols.key + 2), color: selected ? undefined : theme.muted, bold: selected },
    ...(cols.state ? [{ text: `${st ? STATE_ICON[st.type] : '○'} `, color: st?.color }] : []),
    { text: padEnd(i.title, cols.title), bold: selected }];
  if (cols.assignee) {
    const u = i.assigneeId ? data.userById.get(i.assigneeId) : undefined;
    line.push({ text: '  ' }, u ? { text: padEnd(u.initials, 2), color: u.color, bold: true } : { text: '··', color: '#4a4a4a' });
  }
  if (cols.due) {
    const d = i.dueDate ? dueLabel(i.dueDate, now) : undefined;
    line.push({ text: '  ' }, { text: padStart(d?.text ?? '', 8), color: d?.tone === 'overdue' ? theme.error : d?.tone === 'soon' ? theme.warn : theme.muted });
  }
  return line;
}

function groupLine(r: Extract<ListRow, { kind: 'group' }>, selected: boolean): Line {
  const arrow = r.selectable ? (r.expanded ? '▾ ' : '▸ ') : '';
  return [{ text: arrow, color: theme.muted }, ...r.group.icon, { text: ' ' },
    { text: r.group.label, bold: true }, { text: `  ${r.group.issues.length}`, color: theme.muted },
    ...(r.selectable && selected ? [{ text: `   enter ${r.expanded ? 'folds' : 'shows'} these`, color: theme.muted }] : [])];
}

export function ListScreen({ s, data, width, height, now, dim }: { s: TuiState; data: TuiData; width: number; height: number; now: number; dim?: boolean }) {
  const route = s.route;
  const issues = issuesForRoute(route, data);
  const rows = listRowsFor(route, data, listViewOf(s, route));
  const selectable = rows.filter(r => r.kind === 'issue' || r.selectable);
  const cursor = Math.min(s.cursor[routeKey(route)] ?? 0, Math.max(0, selectable.length - 1));
  const selectedId = selectable[cursor]?.id;
  let cursorRow = rows.findIndex(r => r.id === selectedId);
  if (cursorRow > 0 && rows[cursorRow - 1].kind === 'group' && !(rows[cursorRow - 1] as Extract<ListRow, { kind: 'group' }>).selectable) cursorRow--;
  const start = useWindow(routeKey(route), Math.max(0, cursorRow), height, rows.length);
  if (!issues.length) {
    const empty = route.kind === 'my' ? ['Nothing assigned to you', 'n creates an issue, / finds one'] : route.kind === 'team' ? ['No issues in this team yet', 'n creates the first one'] : ['No issues in this project yet', 'n adds one'];
    return <Lines lines={emptyState(width, height, empty[0], empty[1])} width={width} height={height} dim={dim} />;
  }
  if (!rows.length) {
    return <Lines lines={emptyState(width, height, `No ${PRESET_LABEL[s.preset].toLowerCase()} issues here`, 'type / show all to see the rest')} width={width} height={height} dim={dim} />;
  }
  const cols = listColumns(rows, data, width, route.kind !== 'my', s.groupBy !== 'status');
  const shown = rows.slice(start, start + height);
  const lines = shown.map(r => (r.kind === 'group' ? groupLine(r, r.id === selectedId) : issueLine(r.issue, data, cols, r.id === selectedId, now)));
  return <Lines lines={lines} width={width} height={height} sel={shown.findIndex(r => r.id === selectedId)} dim={dim} />;
}

// ---------- detail pane ----------

/** the issue under the list cursor, beside the list; all from the snapshot, so moving the cursor costs no fetch */
export function DetailPane({ issue, note, data, width, height, now, ui }: { issue: Issue | undefined; note?: Line[]; data: TuiData; width: number; height: number; now: number; ui?: IssueUi }) {
  const inner = width - 3;
  const head = note ?? [];
  const lines: Line[] = issue ? [...head, ...paneLines(issue, data, inner, height - head.length, now, ui)] : head;
  const out = lines.slice(0, height);
  while (out.length < height) out.push([]);
  return (
    <Box flexDirection="column" width={width} height={height}>
      {out.map((l, i) => (
        <Text key={i}>
          <Text color={theme.border}> │ </Text>
          <LineView line={l} width={inner} />
        </Text>
      ))}
    </Box>
  );
}

/** what the detail pane says above an inbox item's issue: who did what, when */
export function inboxNote(it: InboxItem, width: number, now: number): Line[] {
  return [
    [{ text: it.unread ? '● ' : '  ', color: theme.accent }, { text: it.who, bold: true }, { text: ` ${it.verb} · ${relTime(it.notification.createdAt, now)}`, color: theme.muted }],
    ...(it.issueId ? [] : wrap(it.body, width - 2).map(l => [{ text: '  ' }, ...l])),
    [],
  ];
}

// ---------- issue page ----------

export function DetailScreen({ s, lines, width, height, pinned }: { s: TuiState; lines: Line[] | null; width: number; height: number; pinned?: number }) {
  if (!lines) return <Lines lines={emptyState(width, height, 'Issue not found', 'esc to go back')} width={width} height={height} />;
  const max = Math.max(0, lines.length - height);
  let scroll = Math.min(s.cursor[routeKey(s.route)] ?? 0, max);
  // an open picker is never scrolled out of view
  if (pinned !== undefined && (pinned < scroll || pinned >= scroll + height)) scroll = Math.min(max, Math.max(0, pinned - 2));
  return <Lines lines={lines.slice(scroll, scroll + height)} width={width} height={height} />;
}

export function scrollLabel(s: TuiState, total: number, height: number): string {
  if (total <= height) return '';
  const scroll = Math.min(s.cursor[routeKey(s.route)] ?? 0, total - height);
  return scroll === 0 ? 'more ↓' : scroll >= total - height ? 'end' : `${Math.round((scroll / (total - height)) * 100)}%`;
}

// ---------- inbox ----------

export function InboxScreen({ s, data, width, height, now, dim }: { s: TuiState; data: TuiData; width: number; height: number; now: number; dim?: boolean }) {
  const items = inboxItems(data, now);
  const cursor = Math.min(s.cursor.inbox ?? 0, Math.max(0, items.length - 1));
  const start = useWindow('inbox', cursor, height, items.length);
  if (!items.length) return <Lines lines={emptyState(width, height, 'Inbox zero ✓', 'You\'re all caught up')} width={width} height={height} dim={dim} />;
  const keyW = Math.max(6, ...items.map(i => i.key?.length ?? 0));
  const flex = width - 2 - 2 - keyW - 2 - 2 - 4;
  const whoW = flex >= 60 ? Math.min(30, Math.floor(flex * 0.35)) : 0;
  const subjectW = flex - (whoW ? whoW + 2 : 0);
  const lines = items.slice(start, start + height).map((it, n): Line => {
    const selected = start + n === cursor;
    const tone = it.unread ? {} : { color: theme.muted };
    return [selected ? SELECT_BAR : NO_BAR, { text: it.unread ? '● ' : '  ', color: theme.accent },
      { text: padEnd(it.key ?? '', keyW + 2), color: selected ? undefined : theme.muted, bold: selected },
      { text: padEnd(it.subject, subjectW), bold: it.unread || selected, ...tone },
      ...(whoW ? [{ text: '  ' }, { text: padEnd(`${it.who} ${it.verb}`, whoW), color: theme.muted }] : []),
      { text: '  ' }, { text: padStart(relTime(it.notification.createdAt, now).replace('just now', 'now'), 4), color: theme.muted }];
  });
  return <Lines lines={lines} width={width} height={height} sel={cursor - start} dim={dim} />;
}

// ---------- projects ----------

export function ProjectsScreen({ s, data, width, height, dim }: { s: TuiState; data: TuiData; width: number; height: number; dim?: boolean }) {
  const rows = projectRows(data);
  const cursor = Math.min(s.cursor.projects ?? 0, Math.max(0, rows.length - 1));
  const start = useWindow('projects', cursor, height, rows.length);
  if (!rows.length) return <Lines lines={emptyState(width, height, 'No projects yet', 'Create one in the web app or with `baseline project create`')} width={width} height={height} />;
  const barW = width >= 90 ? 16 : 10;
  const showLead = width >= 78, showTarget = width >= 96;
  const nameW = Math.max(14, width - 2 - 2 - 2 - (barW + 5 + 6) - 2 - 9 - (showLead ? 16 : 0) - (showTarget ? 10 : 0));
  const lines = rows.slice(start, start + height).map((r, n): Line => {
    const selected = start + n === cursor;
    const p = r.project;
    const bar = progressBar(r.done, r.total, barW);
    const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
    const health = HEALTH[p.health];
    const closed = p.status === 'completed' || p.status === 'canceled';
    const line: Line = [selected ? SELECT_BAR : NO_BAR, { text: '◆ ', color: p.color }, { text: padEnd(p.name, nameW), bold: selected, ...(closed ? { color: theme.muted } : {}) },
      { text: '  ' }, { text: bar.filled, color: p.color }, { text: bar.empty, color: '#3a3a3a' },
      { text: ` ${padStart(`${pct}%`, 4)}` }, { text: ` ${padStart(`${r.done}/${r.total}`, 5)}`, color: theme.muted },
      { text: '  ' }, closed ? { text: padEnd(p.status === 'completed' ? 'Completed' : 'Canceled', 9), color: theme.muted } : { text: padEnd(health.label, 9), color: health.color }];
    if (showLead) line.push({ text: '  ' }, { text: padEnd(r.lead ?? '—', 14), color: theme.muted });
    if (showTarget) line.push({ text: '  ' }, { text: padEnd(p.targetDate ? dueLabel(p.targetDate, Date.now()).text : '', 8), color: theme.muted });
    return line;
  });
  return <Lines lines={lines} width={width} height={height} sel={cursor - start} dim={dim} />;
}

// ---------- tabs, toast, footer ----------

/** where you are inside a tab: the project or issue opened from it, and a list display that isn't the default */
function crumbs(s: TuiState, data: TuiData): string {
  const parts: string[] = [];
  for (const r of [...s.stack, s.route]) {
    if (r.kind === 'project') {
      const p = data.projectById.get(r.projectId);
      const prog = projectProgress(r.projectId, data);
      parts.push(`◆ ${p?.name ?? 'Project'}  ${prog.done}/${prog.total} done`);
    }
    if (r.kind === 'issue') { const i = data.issueById.get(r.issueId); parts.push(i ? data.keyOf(i) : 'Issue'); }
  }
  const view = s.route.kind === 'my' || s.route.kind === 'team' || s.route.kind === 'project'
    ? [s.groupBy !== 'status' ? GROUP_MODES[s.groupBy].label : '', s.preset !== 'all' ? PRESET_LABEL[s.preset] : ''].filter(Boolean) : [];
  return [...parts.map(p => ` › ${p}`), ...view.map(v => ` · ${v}`)].join('');
}

export function tabBarLine(s: TuiState, data: TuiData, tabs: Tab[], hidden: number, activeId: string | null, width: number, right: string): Line {
  const segs: Seg[] = [];
  tabs.forEach((t, i) => {
    if (i) segs.push({ text: ' '.repeat(TAB_GAP - 2) });
    const text = tabText(t, i + 1);
    if (t.id === activeId) {
      segs.push({ text: ' ', bg: theme.tabBg }, { text: String(i + 1), color: theme.key, bg: theme.tabBg, bold: true }, { text: `${text.slice(String(i + 1).length)} `, bg: theme.tabBg, bold: true, color: '#ffffff' });
    } else segs.push({ text: ` ${text} `, color: theme.muted });
  });
  if (hidden) segs.push({ text: `   +${hidden} more · /`, color: theme.muted });
  const used = segs.reduce((n, x) => n + displayWidth(x.text), 0);
  const rw = displayWidth(right);
  const room = width - used - rw - 2;
  const crumb = room >= 10 ? truncate(crumbs(s, data), room) : '';
  return [...segs, { text: crumb, color: theme.muted }, { text: ' '.repeat(Math.max(1, width - used - displayWidth(crumb) - rw)) }, { text: right, color: theme.muted }];
}

export function ToastLine({ toast, width }: { toast: TuiState['toast']; width: number }) {
  if (!toast) return <LineView line={[]} width={width} />;
  const icon = toast.tone === 'ok' ? '✓' : toast.tone === 'error' ? '✗' : '›';
  const color = toast.tone === 'ok' ? theme.ok : toast.tone === 'error' ? theme.error : theme.accent;
  return <LineView line={[{ text: ` ${icon} `, color, bold: true }, { text: toast.text, color: toast.tone === 'error' ? theme.error : undefined },
    ...(toast.undo ? [{ text: '      ' }, keySeg('u'), { text: ' undo' }] : [])]} width={width} />;
}

function useTicker(ms: number, active = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN(x => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return n;
}

function syncLabel(s: TuiState, frame: number): Seg[] {
  if (s.syncing && !s.syncedAt) return [{ text: `${SPINNER[frame % SPINNER.length]} loading`, color: theme.muted }];
  if (s.syncing) return [{ text: `${SPINNER[frame % SPINNER.length]} syncing`, color: theme.muted }];
  if (!s.syncedAt) return [];
  const secs = Math.max(0, Math.round((Date.now() - s.syncedAt) / 1000));
  const stale = secs > 15;
  return [{ text: '● ', color: stale ? theme.warn : theme.ok }, { text: secs < 2 ? 'synced' : `synced ${secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`} ago`, color: theme.muted }];
}

/** key chips with their labels: "↑↓ move  enter open" */
export function hintSegs(hints: Array<{ key: string; label: string }>): Seg[] {
  return hints.flatMap((h, i) => [...(i ? [{ text: '  ' }] : []), keySeg(h.key), { text: ` ${h.label}` }]);
}

/** one line: what the keys do here on the left (cut to fit), the sync state on the right */
export function Footer({ s, left, width, target }: { s: TuiState; left: Seg[]; width: number; target: string }) {
  const frame = useTicker(s.syncing ? 80 : 1000);
  // an open overlay's footer is only its own keys
  const right: Seg[] = s.overlay.kind !== 'none' ? [] : [...syncLabel(s, frame), { text: `  ${target}`, color: theme.muted }];
  const rightW = right.reduce((n, x) => n + displayWidth(x.text), 0) + 1;
  const segs: Seg[] = [{ text: ' ' }];
  let used = 1;
  for (let i = 0; i < left.length; i++) {
    const seg = left[i];
    // a key chip goes only with its label
    const w = displayWidth(seg.text) + (seg.bg === theme.keyBg && left[i + 1] ? displayWidth(left[i + 1].text) : 0);
    if (used + w > width - rightW - 1) break;
    segs.push(seg);
    used += displayWidth(seg.text);
  }
  return <LineView line={[...segs, { text: ' '.repeat(Math.max(1, width - used - rightW)) }, ...right, { text: ' ' }]} width={width} />;
}
