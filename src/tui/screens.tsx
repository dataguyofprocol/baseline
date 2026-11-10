// The main pane's screens and the chrome around them. Each screen is built as exactly `height`
// lines of exactly `width` cells, so the frame never scrolls or leaves stale cells behind.
import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { Issue } from '../core/types.js';
import type { TuiData } from './data.js';
import { hintsFor, type Context } from './keys.js';
import {
  displayWidth, dueLabel, groupIssues, inboxItems, issuesForRoute, listRows, navIdFor, navItems, padEnd, padStart,
  progressBar, projectProgress, projectRows, relTime, truncate, unreadCount, type Line, type ListRow, type Seg,
} from './model.js';
import { cursorRow, expandedFn, routeKey, type Route, type TuiState } from './state.js';
import { peekLines } from './detail.js';
import { HEALTH, priorityGlyph, SPINNER, STATE_ICON, theme } from './theme.js';
import { LineView } from './ui.js';

const SELECT_BAR: Seg = { text: '▍', color: theme.accent };
const NO_BAR: Seg = { text: ' ' };

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

function Lines({ lines, width, height }: { lines: Line[]; width: number; height: number }) {
  const out = lines.slice(0, height);
  while (out.length < height) out.push([]);
  return (
    <Box flexDirection="column" width={width} height={height}>
      {out.map((l, i) => <LineView key={i} line={l} width={width} />)}
    </Box>
  );
}

function emptyState(width: number, height: number, title: string, hint: string): Line[] {
  const top = Math.max(0, Math.floor(height / 3) - 1);
  const center = (t: string) => ' '.repeat(Math.max(0, Math.floor((width - displayWidth(t)) / 2)));
  return [...Array.from({ length: top }, () => []), [{ text: center(title) }, { text: title, bold: true }], [], [{ text: center(hint) }, { text: hint, color: theme.muted }]];
}

// ---------- issue list ----------

function priorityCell(i: Pick<Issue, 'priority'>): Seg[] {
  const g = priorityGlyph(i.priority);
  if (g.text.includes('▂')) {
    const chars = [...g.text];
    return [{ text: chars.slice(0, g.lit).join('') }, { text: chars.slice(g.lit).join(''), color: '#4a4a4a' }];
  }
  return [{ text: g.text, color: g.color, bold: i.priority === 1 }];
}

interface Columns { key: number; title: number; labels: number; project: number; assignee: boolean; due: boolean }

function listColumns(rows: ListRow[], data: TuiData, width: number, showAssignee: boolean): Columns {
  const issues = rows.filter((r): r is Extract<ListRow, { kind: 'issue' }> => r.kind === 'issue').map(r => r.issue);
  const key = Math.max(6, ...issues.map(i => data.keyOf(i).length));
  const fixed = 2 + 3 + 1 + key + 1 + 2;
  const labelsW = Math.min(22, Math.max(0, ...issues.map(i => i.labelIds.reduce((n, id) => n + (data.labelById.get(id)?.name.length ?? 0) + 3, 0))));
  const projectW = Math.min(18, Math.max(0, ...issues.map(i => (i.projectId ? (data.projectById.get(i.projectId)?.name.length ?? 0) + 2 : 0))));
  const due = issues.some(i => i.dueDate);
  let room = width - fixed;
  const take = (w: number) => { if (w && room - w - 2 >= 28) { room -= w + 2; return w; } return 0; };
  const dueW = due ? take(9) : 0;
  const assignee = showAssignee ? take(2) > 0 : false;
  const project = take(projectW);
  const labels = take(labelsW);
  return { key, title: room, labels, project, assignee, due: dueW > 0 };
}

function issueLine(i: Issue, data: TuiData, cols: Columns, selected: boolean, now: number): Line {
  const st = data.stateById.get(i.stateId);
  const line: Line = [selected ? SELECT_BAR : NO_BAR, { text: ' ' }, ...priorityCell(i), { text: ' ' },
    { text: padEnd(data.keyOf(i), cols.key), color: selected ? theme.accent : theme.muted, bold: selected }, { text: ' ' },
    { text: st ? STATE_ICON[st.type] : '○', color: st?.color }, { text: ' ' },
    { text: padEnd(i.title, cols.title), bold: selected }];
  if (cols.labels) {
    const segs: Seg[] = [];
    let used = 0;
    for (const id of i.labelIds) {
      const l = data.labelById.get(id);
      if (!l) continue;
      const name = truncate(l.name, cols.labels - used - 2);
      if (used + 2 + name.length > cols.labels || !name) break;
      segs.push({ text: '•', color: l.color }, { text: `${name} `, color: theme.muted });
      used += name.length + 2;
    }
    line.push({ text: '  ' }, ...segs, { text: ' '.repeat(Math.max(0, cols.labels - used)) });
  }
  if (cols.project) {
    const p = i.projectId ? data.projectById.get(i.projectId) : undefined;
    line.push({ text: '  ' }, ...(p ? [{ text: '◆ ', color: p.color }, { text: padEnd(p.name, cols.project - 2), color: theme.muted }] : [{ text: ' '.repeat(cols.project) }]));
  }
  if (cols.assignee) {
    const u = i.assigneeId ? data.userById.get(i.assigneeId) : undefined;
    line.push({ text: '  ' }, u ? { text: padEnd(u.initials, 2), color: u.color, bold: true } : { text: '··', color: '#4a4a4a' });
  }
  if (cols.due) {
    const d = i.dueDate ? dueLabel(i.dueDate, now) : undefined;
    line.push({ text: '  ' }, { text: padStart(d?.text ?? '', 9), color: d?.tone === 'overdue' ? theme.error : d?.tone === 'soon' ? theme.warn : theme.muted });
  }
  return line;
}

function groupLine(r: Extract<ListRow, { kind: 'group' }>, selected: boolean): Line {
  const arrow = r.selectable ? (r.expanded ? '▾ ' : '▸ ') : '';
  return [selected ? SELECT_BAR : NO_BAR, { text: ' ' }, { text: arrow, color: theme.muted }, { text: `${STATE_ICON[r.group.type]} `, color: r.group.color },
    { text: r.group.label, bold: true }, { text: `  ${r.group.issues.length}`, color: theme.muted },
    ...(r.selectable && !r.expanded && selected ? [{ text: '   enter to show', color: theme.muted }] : [])];
}

export function ListScreen({ s, data, width, height, now }: { s: TuiState; data: TuiData; width: number; height: number; now: number }) {
  const route = s.route;
  const issues = issuesForRoute(route, data);
  const rows = listRows(groupIssues(issues, data), expandedFn(s, route));
  const selectable = rows.filter(r => r.kind === 'issue' || r.selectable);
  const cursor = Math.min(s.cursor[routeKey(route)] ?? 0, Math.max(0, selectable.length - 1));
  const selectedId = selectable[cursor]?.id;
  let cursorRow = rows.findIndex(r => r.id === selectedId);
  if (cursorRow > 0 && rows[cursorRow - 1].kind === 'group' && !(rows[cursorRow - 1] as Extract<ListRow, { kind: 'group' }>).selectable) cursorRow--;
  const start = useWindow(routeKey(route), Math.max(0, cursorRow), height, rows.length);
  if (!issues.length) {
    const empty = route.kind === 'my' ? ['Nothing assigned to you', 'Press c to create an issue, or / to find one'] : route.kind === 'team' ? ['No issues in this team yet', 'Press c to create the first one'] : ['No issues in this project yet', 'Press c to add one'];
    return <Lines lines={emptyState(width, height, empty[0], empty[1])} width={width} height={height} />;
  }
  const cols = listColumns(rows, data, width, route.kind !== 'my');
  const lines = rows.slice(start, start + height).map(r => (r.kind === 'group' ? groupLine(r, r.id === selectedId) : issueLine(r.issue, data, cols, r.id === selectedId, now)));
  return <Lines lines={lines} width={width} height={height} />;
}

// ---------- peek ----------

/** the issue under the list cursor, beside the list; all from the snapshot, so moving the cursor costs no fetch */
export function PeekPane({ s, data, width, height, now }: { s: TuiState; data: TuiData; width: number; height: number; now: number }) {
  const row = cursorRow(s);
  const inner = width;
  const lines: Line[] = row?.kind === 'issue' ? peekLines(row.issue, data, inner, height, now)
    : row?.kind === 'group' ? [[{ text: `${STATE_ICON[row.group.type]} `, color: row.group.color }, { text: row.group.label, bold: true }, { text: `  ${row.group.issues.length}`, color: theme.muted }], [], [{ text: 'Folded. enter shows these issues.', color: theme.muted }]]
    : [];
  const out = lines.slice(0, height);
  while (out.length < height) out.push([]);
  return (
    <Box flexDirection="column" width={width + 3} height={height}>
      {out.map((l, i) => (
        <Text key={i}>
          <Text color={theme.border}> │ </Text>
          <LineView line={l} width={inner} />
        </Text>
      ))}
    </Box>
  );
}

// ---------- detail ----------

export function DetailScreen({ s, lines, width, height }: { s: TuiState; lines: Line[] | null; width: number; height: number }) {
  if (!lines) return <Lines lines={emptyState(width, height, 'Issue not found', 'esc to go back')} width={width} height={height} />;
  const scroll = Math.min(s.cursor[routeKey(s.route)] ?? 0, Math.max(0, lines.length - height));
  return <Lines lines={lines.slice(scroll, scroll + height)} width={width} height={height} />;
}

export function scrollLabel(s: TuiState, total: number, height: number): string {
  if (total <= height) return '';
  const scroll = Math.min(s.cursor[routeKey(s.route)] ?? 0, total - height);
  return scroll === 0 ? 'more ↓' : scroll >= total - height ? 'end' : `${Math.round((scroll / (total - height)) * 100)}%`;
}

// ---------- inbox ----------

export function InboxScreen({ s, data, width, height, now }: { s: TuiState; data: TuiData; width: number; height: number; now: number }) {
  const items = inboxItems(data, now);
  const cursor = Math.min(s.cursor.inbox ?? 0, Math.max(0, items.length - 1));
  const start = useWindow('inbox', cursor, height, items.length);
  if (!items.length) return <Lines lines={emptyState(width, height, 'Inbox zero ✓', 'You\'re all caught up')} width={width} height={height} />;
  const keyW = Math.max(6, ...items.map(i => i.key?.length ?? 0));
  const timeW = 9;
  const flex = width - 2 - 2 - keyW - 1 - timeW - 2;
  const subjectW = Math.max(16, Math.min(Math.floor(flex * 0.5), 48));
  const restW = Math.max(0, flex - subjectW - 2);
  const lines = items.slice(start, start + height).map((it, n): Line => {
    const selected = start + n === cursor;
    const tone = it.unread ? {} : { color: theme.muted };
    return [selected ? SELECT_BAR : NO_BAR, { text: ' ' }, { text: it.unread ? '● ' : '  ', color: theme.accent },
      { text: padEnd(it.key ?? '', keyW), color: selected ? theme.accent : theme.muted, bold: selected }, { text: ' ' },
      { text: padEnd(it.subject, subjectW), bold: it.unread || selected, ...tone }, { text: '  ' },
      { text: padEnd(`${it.who} ${it.verb}${it.body && it.body !== it.subject ? `: ${it.body}` : ''}`, restW), color: theme.muted },
      { text: '  ' }, { text: padStart(relTime(it.notification.createdAt, now), timeW), color: theme.muted }];
  });
  return <Lines lines={lines} width={width} height={height} />;
}

// ---------- projects ----------

export function ProjectsScreen({ s, data, width, height }: { s: TuiState; data: TuiData; width: number; height: number }) {
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
    const line: Line = [selected ? SELECT_BAR : NO_BAR, { text: ' ' }, { text: '◆ ', color: p.color }, { text: padEnd(p.name, nameW), bold: selected, ...(closed ? { color: theme.muted } : {}) },
      { text: '  ' }, { text: bar.filled, color: p.color }, { text: bar.empty, color: '#3a3a3a' },
      { text: ` ${padStart(`${pct}%`, 4)}` }, { text: ` ${padStart(`${r.done}/${r.total}`, 5)}`, color: theme.muted },
      { text: '  ' }, closed ? { text: padEnd(p.status === 'completed' ? 'Completed' : 'Canceled', 9), color: theme.muted } : { text: padEnd(health.label, 9), color: health.color }];
    if (showLead) line.push({ text: '  ' }, { text: padEnd(r.lead ?? '—', 14), color: theme.muted });
    if (showTarget) line.push({ text: '  ' }, { text: padEnd(p.targetDate ? dueLabel(p.targetDate, Date.now()).text : '', 8), color: theme.muted });
    return line;
  });
  return <Lines lines={lines} width={width} height={height} />;
}

// ---------- header, sidebar, footer ----------

function routeTitle(route: Route, data: TuiData, now: number): Line {
  switch (route.kind) {
    case 'my': {
      const open = issuesForRoute(route, data).filter(i => !['completed', 'canceled'].includes(data.stateById.get(i.stateId)?.type ?? '')).length;
      return [{ text: 'My Issues', bold: true }, { text: `  ${open} open`, color: theme.muted }];
    }
    case 'team': {
      const t = data.teamById.get(route.teamId);
      return [{ text: '■ ', color: t?.color }, { text: t?.name ?? 'Team', bold: true }, { text: `  ${t?.key ?? ''} · ${(data.issuesByTeam.get(route.teamId) ?? []).length} issues`, color: theme.muted }];
    }
    case 'project': {
      const p = data.projectById.get(route.projectId);
      const prog = projectProgress(route.projectId, data);
      const h = p ? HEALTH[p.health] : undefined;
      return [{ text: '◆ ', color: p?.color }, { text: p?.name ?? 'Project', bold: true }, { text: `  ${prog.done}/${prog.total} done`, color: theme.muted },
        ...(h ? [{ text: '  · ', color: theme.muted }, { text: h.label, color: h.color }] : [])];
    }
    case 'projects': return [{ text: 'Projects', bold: true }, { text: `  ${data.projects.length}`, color: theme.muted }];
    case 'inbox': {
      const n = unreadCount(data, now);
      return [{ text: 'Inbox', bold: true }, { text: n ? `  ${n} unread` : '  all read', color: theme.muted }];
    }
    case 'issue': {
      const i = data.issueById.get(route.issueId);
      return [{ text: i ? data.keyOf(i) : 'Issue', bold: true, color: theme.accent }, ...(i ? [{ text: `  ${i.title}`, color: theme.muted }] : [])];
    }
  }
}

export function headerLine(s: TuiState, data: TuiData, width: number, right: string, now: number): Line {
  const crumbs = s.stack.slice(-2).map(r => routeTitle(r, data, now)[r.kind === 'team' || r.kind === 'project' ? 1 : 0].text);
  const left: Line = [...crumbs.flatMap(c => [{ text: c, color: theme.muted }, { text: ' › ', color: theme.muted }]), ...routeTitle(s.route, data, now)];
  const rightW = displayWidth(right);
  const fitted: Line = [];
  let used = 0;
  for (const seg of left) {
    const text = truncate(seg.text, width - rightW - 2 - used);
    if (!text) break;
    fitted.push({ ...seg, text });
    used += displayWidth(text);
  }
  return [...fitted, { text: ' '.repeat(Math.max(1, width - used - rightW)) }, { text: right, color: theme.muted }];
}

export function Sidebar({ s, data, width, height, now }: { s: TuiState; data: TuiData; width: number; height: number; now: number }) {
  const items = navItems(data, now);
  const active = navIdFor(s.route, s.stack);
  const focused = s.focus === 'sidebar';
  const w = width - 1;
  const lines: Line[] = [
    [{ text: ' ' }, { text: truncate(data.workspace.name, w - 2), bold: true }],
    [{ text: ' ' }, { text: truncate(data.currentUser.name, w - 2), color: theme.muted }],
    [],
  ];
  items.forEach((item, i) => {
    if (item.route.kind === 'team' && items[i - 1]?.route.kind !== 'team') lines.push([], [{ text: ' Teams', color: theme.muted }]);
    if (item.route.kind === 'projects') lines.push([]);
    const isActive = item.id === active;
    const isCursor = focused && i === s.sidebarCursor;
    const count = item.count ? String(item.count) : '';
    const label = truncate(item.label, w - 6 - count.length);
    lines.push([isCursor ? SELECT_BAR : NO_BAR, { text: `${item.icon} `, color: item.color ?? (isActive ? theme.accent : theme.muted) },
      { text: label, bold: isActive || isCursor, color: isActive ? theme.accent : undefined },
      { text: ' '.repeat(Math.max(1, w - 3 - displayWidth(label) - count.length - 1)) },
      { text: count, color: item.id === 'inbox' && item.count ? theme.accent : theme.muted, bold: item.id === 'inbox' && !!item.count }]);
  });
  const out = lines.slice(0, height);
  while (out.length < height) out.push([]);
  if (focused && height > out.length - 1) out[height - 1] = [{ text: ' enter open · tab back', color: theme.muted }];
  return (
    <Box flexDirection="column" width={width} height={height}>
      {out.map((l, i) => (
        <Text key={i}>
          <LineView line={l} width={w} />
          <Text color={focused ? theme.accent : theme.border}>│</Text>
        </Text>
      ))}
    </Box>
  );
}

export function ToastLine({ toast, width }: { toast: TuiState['toast']; width: number }) {
  if (!toast) return <LineView line={[]} width={width} />;
  const icon = toast.tone === 'ok' ? '✓' : toast.tone === 'error' ? '✗' : '›';
  const color = toast.tone === 'ok' ? theme.ok : toast.tone === 'error' ? theme.error : theme.accent;
  return <LineView line={[{ text: ` ${icon} `, color, bold: true }, { text: toast.text, color: toast.tone === 'error' ? theme.error : undefined }]} width={width} />;
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

export function Footer({ s, contexts, width, target }: { s: TuiState; contexts: Context[]; width: number; target: string }) {
  const frame = useTicker(s.syncing ? 80 : 1000);
  const right: Seg[] = [...syncLabel(s, frame), { text: `  ${target}`, color: theme.muted }];
  const rightW = right.reduce((n, x) => n + displayWidth(x.text), 0) + 1;
  const hints = hintsFor(contexts, s.pending);
  const help = hints.find(h => h.label === 'help');
  const rest = hints.filter(h => h !== help);
  const segs: Seg[] = [{ text: ' ' }];
  let used = 1;
  if (s.pending) { segs.push({ text: `${s.pending}…  `, color: theme.accent, bold: true }); used += displayWidth(`${s.pending}…  `); }
  const room = width - rightW - (help ? displayWidth(`${help.key} ${help.label}`) + 3 : 0);
  for (const h of rest) {
    const w = displayWidth(`${h.key} ${h.label}`) + 3;
    if (used + w > room) break;
    segs.push({ text: h.key, bold: true }, { text: ` ${h.label}   `, color: theme.muted });
    used += w;
  }
  if (help) { segs.push({ text: help.key, bold: true }, { text: ` ${help.label}`, color: theme.muted }); used += displayWidth(`${help.key} ${help.label}`); }
  return <LineView line={[...segs, { text: ' '.repeat(Math.max(1, width - used - rightW)) }, ...right, { text: ' ' }]} width={width} />;
}
