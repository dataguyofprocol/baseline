// What the screen shows, as the plain data `baseline context` prints for an agent. Pure.
import { PRIORITY_LABELS, type Issue } from '../core/types.js';
import type { TuiData } from './data.js';
import { inboxItems, isListRoute, listRowsFor } from './model.js';
import type { ContextRow, SessionContext } from './session.js';
import { cursorRow, listViewOf, type Route, type TuiState } from './state.js';

const MAX_ROWS = 50;

function routeName(r: Route, data: TuiData): string {
  switch (r.kind) {
    case 'my': return 'My work';
    case 'inbox': return 'Inbox';
    case 'projects': return 'Projects';
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
  const listRoute = isListRoute(s.route) || s.route.kind === 'inbox' ? s.route : [...s.stack].reverse().find(r => isListRoute(r) || r.kind === 'inbox');
  let list: SessionContext['list'] = null;
  if (listRoute && isListRoute(listRoute)) {
    const rows = listRowsFor(listRoute, data, listViewOf(s, listRoute)).flatMap(r => (r.kind === 'issue' ? [row(r.issue, data)] : []));
    const at = cursorRow(s, listRoute);
    list = { title: routeName(listRoute, data), groupBy: s.groupBy, preset: s.preset, rows: rows.slice(0, MAX_ROWS), cursorKey: open ? data.keyOf(open) : at?.kind === 'issue' ? data.keyOf(at.issue) : null };
  } else if (listRoute?.kind === 'inbox') {
    const items = inboxItems(data, now);
    const ids = [...new Set(items.map(i => i.issueId).filter((id): id is string => !!id))];
    const under = items[Math.min(s.cursor.inbox ?? 0, Math.max(0, items.length - 1))];
    const rows = ids.map(id => data.issueById.get(id)).filter((i): i is Issue => !!i).map(i => row(i, data));
    const cursorIssue = open ?? (under?.issueId ? data.issueById.get(under.issueId) : undefined);
    list = { title: 'Inbox', groupBy: 'none', preset: 'all', rows: rows.slice(0, MAX_ROWS), cursorKey: cursorIssue ? data.keyOf(cursorIssue) : null };
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
