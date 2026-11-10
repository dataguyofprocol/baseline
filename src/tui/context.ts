// What the screen shows, as the plain data `baseline context` prints for an agent. Pure.
import { PRIORITY_LABELS, type Issue } from '../core/types.js';
import type { TuiData } from './data.js';
import { isListRoute, listRowsFor, selectableIds } from './model.js';
import { todayModel } from './today.js';
import type { ContextRow, SessionContext } from './session.js';
import { cursorRow, listViewOf, routeKey, type Route, type TuiState } from './state.js';

const MAX_ROWS = 50;

function routeName(r: Route, data: TuiData): string {
  switch (r.kind) {
    case 'today': return 'Today';
    case 'team': return data.teamById.get(r.teamId)?.name ?? 'Team';
    case 'project': return data.projectById.get(r.projectId)?.name ?? 'Project';
    case 'issue': { const i = data.issueById.get(r.issueId); return i ? data.keyOf(i) : 'Issue'; }
  }
}

const row = (i: Issue, data: TuiData): ContextRow => ({
  key: data.keyOf(i), title: i.title, state: data.stateById.get(i.stateId)?.name ?? '?',
  assignee: i.assigneeId ? data.userById.get(i.assigneeId)?.name ?? null : null, priority: PRIORITY_LABELS[i.priority],
});

export function contextOf(s: TuiState, now: number): SessionContext | null {
  const data = s.data;
  if (!data) return null;
  const open = s.route.kind === 'issue' ? data.issueById.get(s.route.issueId) : undefined;
  // on an issue page the list is the one it was opened from
  const listRoute = isListRoute(s.route) || s.route.kind === 'today' ? s.route : [...s.stack].reverse().find(r => isListRoute(r) || r.kind === 'today');
  let list: SessionContext['list'] = null;
  if (listRoute && isListRoute(listRoute)) {
    const rows = listRowsFor(listRoute, data, listViewOf(s, listRoute)).flatMap(r => (r.kind === 'issue' ? [row(r.issue, data)] : []));
    const at = cursorRow(s, listRoute);
    list = { title: routeName(listRoute, data), groupBy: s.groupBy, preset: s.preset, rows: rows.slice(0, MAX_ROWS), cursorKey: open ? data.keyOf(open) : at?.kind === 'issue' ? data.keyOf(at.issue) : null };
  } else if (listRoute?.kind === 'today') {
    // Needs you, In flight and Up next, top to bottom, as the screen lists them
    const m = todayModel(data, now);
    const issues = [...m.needs.map(r => r.issue), ...m.flight.map(r => r.issue), ...m.next.map(r => r.issue)].filter((i): i is Issue => !!i);
    const under = s.route.kind === 'today' ? targetOf(s, issues, now) : undefined;
    const cursorIssue = open ?? under;
    list = { title: 'Today', groupBy: 'none', preset: 'all', rows: issues.slice(0, MAX_ROWS).map(i => row(i, data)), cursorKey: cursorIssue ? data.keyOf(cursorIssue) : null };
  }
  const trail = [...s.stack.slice(-2), s.route].map(r => routeName(r, data));
  return {
    route: s.route,
    stack: s.stack,
    showing: trail.join(' › '),
    openIssue: open ? { key: data.keyOf(open), title: open.title } : null,
    display: { groupBy: s.groupBy, preset: s.preset },
    list,
  };
}

/** the issue under Today's cursor (the rows' ids are issue ids) */
function targetOf(s: TuiState, issues: Issue[], now: number): Issue | undefined {
  const ids = selectableIds(s.route, s.data!, listViewOf(s, s.route), now);
  const id = ids[Math.min(s.cursor[routeKey(s.route)] ?? 0, Math.max(0, ids.length - 1))];
  return issues.find(i => i.id === id);
}
