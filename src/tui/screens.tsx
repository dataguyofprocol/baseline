// The screens and the chrome around them. Each screen is built as exactly `height` lines of exactly
// `width` cells, so the frame never scrolls or leaves stale cells behind.
import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { Issue } from '../core/types.js';
import type { TuiData } from './data.js';
import type { IssueUi } from './detail.js';
import { paneLines } from './detail.js';
import {
  displayWidth, dueLabel, GROUP_MODES, issuesForRoute, listRowsFor, padEnd, padStart, PRESET_LABEL,
  projectProgress, relTime, TAB_GAP, tabText, truncate, type Line, type ListRow, type Seg, type Tab,
} from './model.js';
import { doneOpen, listViewOf, routeKey, type TuiState } from './state.js';
import { prOf, todayModel, todayRows, type NeedKind, type TodayModel } from './today.js';
import { keySeg, priorityMark, SPINNER, STATE_ICON, theme } from './theme.js';
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

interface Columns { key: number; title: number; state: boolean; assignee: boolean; due: boolean; pr: boolean }

function listColumns(rows: ListRow[], data: TuiData, width: number, showAssignee: boolean, showState: boolean): Columns {
  const issues = rows.filter((r): r is Extract<ListRow, { kind: 'issue' }> => r.kind === 'issue').map(r => r.issue);
  const key = Math.max(6, ...issues.map(i => data.keyOf(i).length));
  let room = width - (2 + 2 + key + 2 + (showState ? 2 : 0));
  const take = (w: number) => { if (room - w - 2 >= 20) { room -= w + 2; return true; } return false; };
  const assignee = showAssignee ? take(2) : false;
  const pr = issues.some(i => prOf(data, i.id)) ? take(6) : false;
  const due = issues.some(i => i.dueDate) ? take(8) : false;
  return { key, title: room, state: showState, assignee, due, pr };
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
  if (cols.pr) {
    const pr = prOf(data, i.id);
    const check: Seg = pr?.checks === 'success' ? { text: '✓', color: theme.ok } : pr?.checks === 'failure' ? { text: '✕', color: theme.error } : pr?.checks === 'pending' ? { text: '…', color: theme.warn } : { text: ' ' };
    line.push({ text: '  ' }, ...(pr ? [{ text: padStart(`#${pr.number}`, 4), color: pr.state === 'open' ? theme.accent : theme.muted }, { text: ' ' }, check] : [{ text: '      ' }]));
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
    const empty = route.kind === 'team' ? ['No issues in this team yet', 'n creates the first one'] : ['No issues in this project yet', 'n adds one'];
    return <Lines lines={emptyState(width, height, empty[0], empty[1])} width={width} height={height} dim={dim} />;
  }
  if (!rows.length) {
    return <Lines lines={emptyState(width, height, `No ${PRESET_LABEL[s.preset].toLowerCase()} issues here`, 'type / show all to see the rest')} width={width} height={height} dim={dim} />;
  }
  const cols = listColumns(rows, data, width, true, s.groupBy !== 'status');
  const shown = rows.slice(start, start + height);
  const lines = shown.map(r => (r.kind === 'group' ? groupLine(r, r.id === selectedId) : issueLine(r.issue, data, cols, r.id === selectedId, now)));
  return <Lines lines={lines} width={width} height={height} sel={shown.findIndex(r => r.id === selectedId)} dim={dim} />;
}

// ---------- detail pane ----------

/** the issue under the list cursor, beside the list; all from the snapshot, so moving the cursor costs no fetch */
export function DetailPane({ issue, lines: given, data, width, height, now, ui }: { issue: Issue | undefined; lines?: Line[]; data: TuiData; width: number; height: number; now: number; ui?: IssueUi }) {
  const inner = width - 3;
  const lines: Line[] = given ?? (issue ? paneLines(issue, data, inner, height, now, ui) : []);
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

// ---------- issue page ----------

/** `start`: where the page opens before you scroll it (a mention opens at its comment) */
export function DetailScreen({ s, lines, width, height, pinned, start = 0 }: { s: TuiState; lines: Line[] | null; width: number; height: number; pinned?: number; start?: number }) {
  if (!lines) return <Lines lines={emptyState(width, height, 'Issue not found', 'esc to go back')} width={width} height={height} />;
  const max = Math.max(0, lines.length - height);
  let scroll = Math.min(s.cursor[routeKey(s.route)] ?? start, max);
  // an open picker is never scrolled out of view
  if (pinned !== undefined && (pinned < scroll || pinned >= scroll + height)) scroll = Math.min(max, Math.max(0, pinned - 2));
  return <Lines lines={lines.slice(scroll, scroll + height)} width={width} height={height} />;
}

export function scrollLabel(s: TuiState, total: number, height: number, start = 0): string {
  if (total <= height) return '';
  const scroll = Math.min(s.cursor[routeKey(s.route)] ?? start, total - height);
  return scroll === 0 ? 'more ↓' : scroll >= total - height ? 'end' : `${Math.round((scroll / (total - height)) * 100)}%`;
}

// ---------- Today ----------

const NEED_GLYPH: Record<NeedKind, Seg> = {
  review: { text: '✓', color: theme.ok }, blocked: { text: '✕', color: theme.error }, mention: { text: '@', color: theme.accent },
  pr: { text: '↗', color: theme.accent }, ask: { text: '•', color: theme.accent }, triage: { text: STATE_ICON.triage, color: theme.muted },
};

const age = (iso: string, now: number) => relTime(iso, now).replace('just now', 'now');

/** Today as lines: Needs you, In flight (an agent's row has a second line: what it did and has left), Up next, and the
 *  folded Done this week. `rowLine[i]` is the line of the i-th row the cursor can rest on */
export function todayLines(m: TodayModel, data: TuiData, o: { width: number; now: number; frame: number; cursor: number; doneOpen: boolean; panes: Readonly<Record<string, string>> }): { lines: Line[]; rowLine: number[] } {
  const { width, now } = o;
  const rows = todayRows(m, o.doneOpen);
  const lines: Line[] = [];
  const rowLine: number[] = [];
  const keyW = Math.max(6, ...rows.flatMap(r => (r.kind === 'doneHeader' || (r.kind === 'need' && !r.row.issue) ? [] : [data.keyOf(r.row.issue!).length])));
  const reasons = [...m.needs.map(r => r.reason), ...m.flight.map(r => (r.thread || o.panes[r.id] ? 'agent' : 'you')), ...m.next.map(r => r.reason)];
  const reasonW = Math.min(width < 60 ? 9 : 12, Math.max(5, ...reasons.map(r => displayWidth(r))));
  const titleW = Math.max(8, width - 2 - 2 - (keyW + 2) - 2 - reasonW - 2 - 4);
  let n = 0;
  const head = (title: string, count: number) => lines.push([{ text: ' ' }, { text: title, bold: true }, { text: `  ${count}`, color: theme.muted }]);
  const quiet = (text: string) => lines.push([{ text: `    ${text}`, color: theme.muted }]);
  const row = (glyph: Seg, key: string, title: string, reason: Seg, at: string | null) => {
    const sel = n === o.cursor;
    rowLine.push(lines.length);
    n++;
    lines.push([sel ? SELECT_BAR : NO_BAR, glyph, { text: ' ' }, { text: padEnd(key, keyW + 2), color: sel ? undefined : theme.muted, bold: sel },
      { text: padEnd(title, titleW), bold: sel }, { text: '  ' }, { ...reason, text: padEnd(reason.text, reasonW) }, { text: '  ' },
      { text: padStart(at ? age(at, now) : '', 4), color: theme.muted }]);
  };

  head('Needs you', m.needs.length);
  if (!m.needs.length) quiet('Nothing is waiting on you.');
  for (const r of m.needs) {
    const tone = r.kind === 'review' ? theme.ok : r.kind === 'blocked' ? theme.error : theme.muted;
    row(NEED_GLYPH[r.kind], r.issue ? data.keyOf(r.issue) : '', r.issue?.title ?? r.text, { text: r.reason, color: tone }, r.at);
  }
  lines.push([]);
  head('In flight', m.flight.length);
  if (!m.flight.length) quiet('Nothing started. Up next has what to pick.');
  for (const r of m.flight) {
    const agent = !!r.thread || !!o.panes[r.id];
    const st = data.stateById.get(r.issue.stateId);
    row(agent ? { text: SPINNER[o.frame % SPINNER.length]!, color: theme.ok } : { text: STATE_ICON.started, color: st?.color ?? theme.warn },
      data.keyOf(r.issue), r.issue.title, { text: agent ? 'agent' : 'you', color: theme.muted }, r.at);
    if (agent) {
      const p = r.thread?.progress;
      const text = p && (p.did || p.left || p.blocked) ? [p.did && `did ${p.did}`, p.left && `left ${p.left}`, p.blocked && `blocked ${p.blocked}`].filter(Boolean).join(' · ')
        : o.panes[r.id] ? 'starting · in a tmux pane' : 'starting';
      lines.push([{ text: ' '.repeat(2 + 2 + keyW + 2 - 4) }, { text: '    ' }, { text: truncate(text.replace(/\s+/g, ' '), titleW + reasonW), color: theme.muted }]);
    }
  }
  lines.push([]);
  head('Up next', m.next.length);
  if (!m.next.length) quiet('Nothing queued for you. / finds an issue, n files one.');
  for (const r of m.next) {
    const pm = priorityMark(r.issue.priority);
    row({ text: pm.text, color: pm.color, bold: r.issue.priority === 1 }, data.keyOf(r.issue), r.issue.title, { text: r.reason, color: /due|overdue/.test(r.reason) ? theme.warn : theme.muted }, null);
  }
  if (m.done.length) {
    lines.push([]);
    const sel = n === o.cursor;
    rowLine.push(lines.length);
    n++;
    lines.push([sel ? SELECT_BAR : NO_BAR, { text: o.doneOpen ? '▾ ' : '▸ ', color: theme.muted }, { text: 'Done this week', color: theme.muted, bold: sel }, { text: `  ${m.done.length}`, color: theme.muted },
      ...(sel ? [{ text: `   enter ${o.doneOpen ? 'folds' : 'shows'} these`, color: theme.muted }] : [])]);
    if (o.doneOpen) for (const r of m.done) {
      const st = data.stateById.get(r.issue.stateId);
      row({ text: st ? STATE_ICON[st.type] : '●', color: st?.color }, data.keyOf(r.issue), r.issue.title, { text: '' }, r.at);
    }
  }
  return { lines, rowLine };
}

/** Today. `animate`: the In flight spinner turns (tests switch it off, so frames stay still) */
export function TodayScreen({ s, data, width, height, now, dim, animate = true }: { s: TuiState; data: TuiData; width: number; height: number; now: number; dim?: boolean; animate?: boolean }) {
  const m = todayModel(data, now);
  const spinning = animate && m.flight.some(r => r.thread || s.panes[r.id]);
  const frame = useTicker(120, spinning);
  const count = todayRows(m, doneOpen(s)).length;
  const cursor = Math.min(s.cursor.today ?? 0, Math.max(0, count - 1));
  const { lines, rowLine } = todayLines(m, data, { width, now, frame, cursor, doneOpen: doneOpen(s), panes: s.panes });
  const at = rowLine[cursor] ?? 0;
  // keep the section header in view above the first row of a section
  const start = useWindow('today', at, height, lines.length);
  const top = at - start < 2 && at < 3 ? 0 : start;
  return <Lines lines={lines.slice(top, top + height)} width={width} height={height} sel={count ? at - top : -1} dim={dim} />;
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
  const view = s.route.kind === 'team' || s.route.kind === 'project'
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

/** compact: the dot alone, so a narrow footer keeps its keys */
function syncLabel(s: TuiState, frame: number, compact: boolean): Seg[] {
  if (s.syncing) return [{ text: compact ? SPINNER[frame % SPINNER.length] : `${SPINNER[frame % SPINNER.length]} ${s.syncedAt ? 'syncing' : 'loading'}`, color: theme.muted }];
  if (!s.syncedAt) return [];
  const secs = Math.max(0, Math.round((Date.now() - s.syncedAt) / 1000));
  const stale = secs > 15;
  return [{ text: compact ? '●' : '● ', color: stale ? theme.warn : theme.ok }, ...(compact ? [] : [{ text: secs < 2 ? 'synced' : `synced ${secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`} ago`, color: theme.muted }])];
}

/** key chips with their labels: "↑↓ move  enter open" */
export function hintSegs(hints: Array<{ key: string; label: string }>): Seg[] {
  return hints.flatMap((h, i) => [...(i ? [{ text: '  ' }] : []), keySeg(h.key), { text: ` ${h.label}` }]);
}

/** one line: what the keys do here on the left (cut to fit), the sync state on the right */
export function Footer({ s, left, width, target }: { s: TuiState; left: Seg[]; width: number; target: string }) {
  const frame = useTicker(s.syncing ? 80 : 1000);
  // an open overlay's footer is only its own keys
  const compact = width < 100;
  const right: Seg[] = s.overlay.kind !== 'none' ? [] : [...syncLabel(s, frame, compact), ...(compact ? [] : [{ text: `  ${target}`, color: theme.muted }])];
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
