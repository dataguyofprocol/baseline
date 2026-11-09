// The whole app state and the one reducer that changes it.
import type { Issue, Priority, WorkflowStateType } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import { patchIssue, type TuiData } from './data.js';
import { defaultExpanded, isListRoute, issuesForRoute, groupIssues, listRows, selectableIds } from './model.js';
import type { TextField } from './textfield.js';

export type Route =
  | { kind: 'my' }
  | { kind: 'team'; teamId: string }
  | { kind: 'inbox' }
  | { kind: 'projects' }
  | { kind: 'project'; projectId: string }
  | { kind: 'issue'; issueId: string };

export type PickerField = 'state' | 'priority' | 'assignee' | 'labels' | 'project';

export interface IssueDraft { teamId: string; stateId: string; priority: Priority; assigneeId: string | null; projectId: string | null }
export const DRAFT_FIELDS = ['title', 'team', 'state', 'priority', 'assignee', 'project'] as const;
export type DraftField = typeof DRAFT_FIELDS[number];

export type Overlay =
  | { kind: 'none' }
  | { kind: 'help'; scroll: number }
  | { kind: 'palette'; input: TextField; cursor: number }
  | { kind: 'search'; input: TextField; cursor: number }
  | { kind: 'picker'; field: PickerField; issueId: string; input: TextField; cursor: number; selected: string[] }
  | { kind: 'compose'; target: 'issue'; field: DraftField; input: TextField; draft: IssueDraft }
  | { kind: 'compose'; target: 'comment' | 'title'; issueId: string; input: TextField }
  | { kind: 'confirm'; action: 'agent'; issueId: string; command: string[]; cwd: string; note: string | null };

export interface Toast { id: number; tone: 'ok' | 'error' | 'info'; text: string }

export interface TuiState {
  data: TuiData | null;
  route: Route;
  stack: Route[];
  overlay: Overlay;
  /** per route: the selected row in a list, or the scroll offset of a detail page */
  cursor: Record<string, number>;
  /** per route and state type: whether that group is open (unset: closed groups are collapsed) */
  expanded: Record<string, boolean>;
  focus: 'main' | 'sidebar';
  sidebarCursor: number;
  toast: Toast | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  syncedAt: number | null;
  syncing: boolean;
  threads: Record<string, WorkThread[]>;
}

export const routeKey = (r: Route): string => {
  switch (r.kind) {
    case 'team': return `team:${r.teamId}`;
    case 'project': return `project:${r.projectId}`;
    case 'issue': return `issue:${r.issueId}`;
    default: return r.kind;
  }
};

export const isTopLevel = (r: Route) => r.kind === 'my' || r.kind === 'team' || r.kind === 'inbox' || r.kind === 'projects';

export function initialState(route: Route = { kind: 'my' }, stack: Route[] = []): TuiState {
  return {
    data: null, route, stack, overlay: { kind: 'none' }, cursor: {}, expanded: {}, focus: 'main', sidebarCursor: 0,
    toast: null, status: 'loading', error: null, syncedAt: null, syncing: false, threads: {},
  };
}

export type Action =
  | { type: 'syncStart' }
  | { type: 'loaded'; data: TuiData; at: number }
  | { type: 'loadFailed'; message: string }
  | { type: 'navigate'; route: Route }
  | { type: 'switchView'; route: Route }
  | { type: 'back' }
  | { type: 'move'; delta: number; count: number }
  | { type: 'moveTo'; index: number }
  | { type: 'scroll'; delta: number; max: number }
  | { type: 'toggleGroup'; groupType: WorkflowStateType }
  | { type: 'select'; issueId: string }
  | { type: 'focus'; focus: 'main' | 'sidebar' }
  | { type: 'sidebarMove'; delta: number; count: number }
  | { type: 'openOverlay'; overlay: Overlay }
  | { type: 'closeOverlay' }
  | { type: 'editInput'; input: TextField }
  | { type: 'overlayMove'; delta: number; count: number }
  | { type: 'pickerToggle'; id: string }
  | { type: 'composeField'; delta: number }
  | { type: 'composeDraft'; draft: Partial<IssueDraft> }
  | { type: 'helpScroll'; delta: number; max: number }
  | { type: 'patchIssue'; issueId: string; patch: Partial<Issue> }
  | { type: 'markRead'; ids: string[] | 'all'; read: boolean }
  | { type: 'threads'; issueId: string; threads: WorkThread[] }
  | { type: 'toast'; toast: Toast }
  | { type: 'clearToast'; id: number };

export const expandKey = (r: Route, type: WorkflowStateType) => `${routeKey(r)}|${type}`;
export const expandedFn = (s: Pick<TuiState, 'expanded'>, r: Route) => (type: WorkflowStateType) => s.expanded[expandKey(r, type)] ?? defaultExpanded(type);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** keep each route's cursor on the same row id when the rows under it change */
function remapCursors(s: TuiState, oldData: TuiData | null, newData: TuiData, expanded: Record<string, boolean>, now: number): Record<string, number> {
  const cursor = { ...s.cursor };
  for (const r of [s.route, ...s.stack]) {
    const k = routeKey(r);
    if (r.kind === 'issue' || cursor[k] === undefined) continue;
    const before = oldData ? selectableIds(r, oldData, expandedFn(s, r), now) : [];
    const after = selectableIds(r, newData, expandedFn({ expanded }, r), now);
    const at = after.indexOf(before[cursor[k]]);
    cursor[k] = at >= 0 ? at : clamp(cursor[k], 0, Math.max(0, after.length - 1));
  }
  return cursor;
}

function withData(s: TuiState, data: TuiData, now = Date.now()): TuiState {
  return { ...s, data, cursor: remapCursors(s, s.data, data, s.expanded, now) };
}

export function reducer(s: TuiState, a: Action): TuiState {
  switch (a.type) {
    case 'syncStart': return { ...s, syncing: true };
    case 'loaded': {
      const next = withData({ ...s, status: 'ready', error: null, syncing: false, syncedAt: a.at }, a.data, a.at);
      // an issue that vanished (deleted, archived, moved out of reach) can't stay open
      if (next.route.kind === 'issue' && !a.data.issueById.has(next.route.issueId)) {
        const back = reducer(next, { type: 'back' });
        return { ...back, toast: { id: a.at, tone: 'info', text: 'That issue is gone (archived or deleted)' } };
      }
      return next;
    }
    case 'loadFailed':
      return s.data
        ? { ...s, syncing: false, toast: { id: Date.now(), tone: 'error', text: a.message } }
        : { ...s, syncing: false, status: 'error', error: a.message };
    case 'navigate':
      return { ...s, stack: [...s.stack, s.route], route: a.route, overlay: { kind: 'none' }, focus: 'main' };
    case 'switchView':
      return { ...s, stack: [], route: a.route, overlay: { kind: 'none' }, focus: 'main' };
    case 'back': {
      if (!s.stack.length) return s;
      const stack = s.stack.slice(0, -1);
      return { ...s, route: s.stack[s.stack.length - 1], stack, overlay: { kind: 'none' } };
    }
    case 'move': {
      const k = routeKey(s.route);
      return { ...s, cursor: { ...s.cursor, [k]: clamp((s.cursor[k] ?? 0) + a.delta, 0, Math.max(0, a.count - 1)) } };
    }
    case 'moveTo': return { ...s, cursor: { ...s.cursor, [routeKey(s.route)]: Math.max(0, a.index) } };
    case 'scroll': {
      const k = routeKey(s.route);
      return { ...s, cursor: { ...s.cursor, [k]: clamp((s.cursor[k] ?? 0) + a.delta, 0, Math.max(0, a.max)) } };
    }
    case 'toggleGroup': {
      const k = expandKey(s.route, a.groupType);
      const expanded = { ...s.expanded, [k]: !expandedFn(s, s.route)(a.groupType) };
      return s.data ? { ...s, expanded, cursor: remapCursors(s, s.data, s.data, expanded, Date.now()) } : { ...s, expanded };
    }
    case 'select': {
      if (!s.data || !isListRoute(s.route)) return s;
      const issue = s.data.issueById.get(a.issueId);
      if (!issue) return s;
      const type = s.data.stateById.get(issue.stateId)?.type;
      const expanded = type && !expandedFn(s, s.route)(type) ? { ...s.expanded, [expandKey(s.route, type)]: true } : s.expanded;
      const ids = listRows(groupIssues(issuesForRoute(s.route, s.data), s.data), expandedFn({ expanded }, s.route))
        .filter(r => r.kind === 'issue' || r.selectable).map(r => r.id);
      const at = ids.indexOf(a.issueId);
      return at < 0 ? s : { ...s, expanded, cursor: { ...s.cursor, [routeKey(s.route)]: at } };
    }
    case 'focus': return { ...s, focus: a.focus };
    case 'sidebarMove': return { ...s, sidebarCursor: clamp(s.sidebarCursor + a.delta, 0, Math.max(0, a.count - 1)) };
    case 'openOverlay': return { ...s, overlay: a.overlay };
    case 'closeOverlay': return { ...s, overlay: { kind: 'none' } };
    case 'editInput': {
      const o = s.overlay;
      if (o.kind === 'palette' || o.kind === 'search' || o.kind === 'picker') return { ...s, overlay: { ...o, input: a.input, cursor: a.input.value === o.input.value ? o.cursor : 0 } };
      if (o.kind === 'compose') return { ...s, overlay: { ...o, input: a.input } };
      return s;
    }
    case 'overlayMove': {
      const o = s.overlay;
      if (o.kind !== 'palette' && o.kind !== 'search' && o.kind !== 'picker') return s;
      const n = Math.max(1, a.count);
      return { ...s, overlay: { ...o, cursor: ((o.cursor + a.delta) % n + n) % n } };
    }
    case 'pickerToggle': {
      const o = s.overlay;
      if (o.kind !== 'picker') return s;
      const selected = o.selected.includes(a.id) ? o.selected.filter(x => x !== a.id) : [...o.selected, a.id];
      return { ...s, overlay: { ...o, selected } };
    }
    case 'composeField': {
      const o = s.overlay;
      if (o.kind !== 'compose' || o.target !== 'issue') return s;
      const n = DRAFT_FIELDS.length;
      return { ...s, overlay: { ...o, field: DRAFT_FIELDS[(DRAFT_FIELDS.indexOf(o.field) + a.delta + n) % n] } };
    }
    case 'composeDraft': {
      const o = s.overlay;
      if (o.kind !== 'compose' || o.target !== 'issue') return s;
      return { ...s, overlay: { ...o, draft: { ...o.draft, ...a.draft } } };
    }
    case 'helpScroll': {
      const o = s.overlay;
      return o.kind === 'help' ? { ...s, overlay: { ...o, scroll: clamp(o.scroll + a.delta, 0, Math.max(0, a.max)) } } : s;
    }
    case 'patchIssue': return s.data ? withData(s, patchIssue(s.data, a.issueId, a.patch)) : s;
    case 'markRead': {
      if (!s.data) return s;
      const at = new Date().toISOString();
      const notifications = s.data.notifications.map(n => (a.ids === 'all' || a.ids.includes(n.id) ? { ...n, readAt: a.read ? n.readAt ?? at : null } : n));
      return { ...s, data: { ...s.data, notifications } };
    }
    case 'threads': return { ...s, threads: { ...s.threads, [a.issueId]: a.threads } };
    case 'toast': return { ...s, toast: a.toast };
    case 'clearToast': return s.toast?.id === a.id ? { ...s, toast: null } : s;
  }
}
