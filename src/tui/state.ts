// The whole app state and the one reducer that changes it.
import type { Issue, Priority } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import { patchIssue, type TuiData } from './data.js';
import {
  defaultExpanded, GROUP_BYS, inboxItems, isListRoute, isSelectable, listGroups, listRows, listRowsFor, PRESETS, rowIdFor, selectableIds,
  type GroupBy, type ListRow, type ListView, type Preset,
} from './model.js';
import type { TextField } from './textfield.js';

export type Route =
  | { kind: 'my' }
  | { kind: 'team'; teamId: string }
  | { kind: 'inbox' }
  | { kind: 'projects' }
  | { kind: 'project'; projectId: string }
  | { kind: 'issue'; issueId: string };

export type PickerField = 'state' | 'priority' | 'assignee' | 'labels' | 'project' | 'team';

export interface IssueDraft { teamId: string; stateId: string; priority: Priority; assigneeId: string | null; projectId: string | null }
export const DRAFT_FIELDS = ['title', 'team', 'state', 'priority', 'assignee', 'project'] as const;
export type DraftField = typeof DRAFT_FIELDS[number];

export type Overlay =
  | { kind: 'none' }
  | { kind: 'help'; scroll: number }
  | { kind: 'palette'; input: TextField; cursor: number }
  | { kind: 'search'; input: TextField; cursor: number }
  /** issueId is null for pickers that aren't about an issue (the team switcher) */
  | { kind: 'picker'; field: PickerField; issueId: string | null; input: TextField; cursor: number; selected: string[] }
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
  /** per route and group id: whether that group is open (unset: the grouping's default, Done and Canceled folded) */
  expanded: Record<string, boolean>;
  groupBy: GroupBy;
  preset: Preset;
  focus: 'main' | 'sidebar';
  sidebarCursor: number;
  sidebarHidden: boolean;
  /** the list's peek pane; null follows the terminal width */
  peek: boolean | null;
  /** the first key of a chord ("g" of "g m"), waiting for the second */
  pending: string | null;
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
    data: null, route, stack, overlay: { kind: 'none' }, cursor: {}, expanded: {}, groupBy: 'status', preset: 'all', focus: 'main', sidebarCursor: 0, sidebarHidden: false, peek: null, pending: null,
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
  | { type: 'toggleGroup'; groupId: string }
  | { type: 'foldAll' }
  | { type: 'cycleGroupBy' }
  | { type: 'cyclePreset' }
  | { type: 'select'; issueId: string }
  | { type: 'focus'; focus: 'main' | 'sidebar' }
  | { type: 'sidebarMove'; delta: number; count: number }
  | { type: 'toggleSidebar' }
  | { type: 'peek'; on: boolean }
  | { type: 'pending'; key: string | null }
  | { type: 'stepIssue'; delta: number; now: number }
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

export const expandKey = (r: Route, groupId: string) => `${routeKey(r)}|${groupId}`;
export const expandedFn = (s: Pick<TuiState, 'expanded'>, r: Route) => (groupId: string) => s.expanded[expandKey(r, groupId)] ?? defaultExpanded(groupId);
export const listViewOf = (s: Pick<TuiState, 'expanded' | 'groupBy' | 'preset'>, r: Route): ListView => ({ groupBy: s.groupBy, preset: s.preset, isExpanded: expandedFn(s, r) });

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** keep each route's cursor on the same row when the rows under it change (new data, a fold, another grouping);
 *  an issue that a fold hid hands the cursor to its group's header */
function remapCursors(before: TuiState, after: TuiState, now: number): Record<string, number> {
  const cursor = { ...after.cursor };
  if (!after.data) return cursor;
  for (const r of [after.route, ...after.stack]) {
    const k = routeKey(r);
    if (r.kind === 'issue' || cursor[k] === undefined) continue;
    const prev = before.data ? selectableIds(r, before.data, listViewOf(before, r), now)[cursor[k]] : undefined;
    const rows = isListRoute(r) ? listRowsFor(r, after.data, listViewOf(after, r)) : null;
    const ids = rows ? rows.filter(isSelectable).map(x => x.id) : selectableIds(r, after.data, listViewOf(after, r), now);
    const target = prev && rows ? rowIdFor(rows, prev) ?? prev : prev;
    const at = target ? ids.indexOf(target) : -1;
    cursor[k] = at >= 0 ? at : clamp(cursor[k], 0, Math.max(0, ids.length - 1));
  }
  return cursor;
}

/** a change to what the lists show, with every cursor kept on its row */
function relist(s: TuiState, next: TuiState, now = Date.now()): TuiState {
  return { ...next, cursor: remapCursors(s, next, now) };
}

/** the row under a list route's cursor: an issue, or a folded group's header */
export function cursorRow(s: TuiState, route: Route = s.route): ListRow | undefined {
  if (!s.data || !isListRoute(route)) return undefined;
  const rows = listRowsFor(route, s.data, listViewOf(s, route)).filter(isSelectable);
  return rows[Math.min(s.cursor[routeKey(route)] ?? 0, Math.max(0, rows.length - 1))];
}

/** the issue ids J/K walk on an issue page: the list it was opened from, as that list shows them */
export function siblingIssueIds(s: TuiState, now: number): string[] {
  const from = s.stack[s.stack.length - 1];
  if (!s.data || !from) return [];
  if (from.kind === 'inbox') return [...new Set(inboxItems(s.data, now).map(i => i.issueId).filter((id): id is string => !!id))];
  if (!isListRoute(from)) return [];
  const view = listViewOf(s, from);
  const groups = listGroups(from, s.data, view);
  const shown = listRows(groups, view.isExpanded).filter(r => r.kind === 'issue').map(r => r.id);
  return s.route.kind === 'issue' && shown.includes(s.route.issueId) ? shown : groups.flatMap(g => g.issues.map(i => i.id));
}

/** the cursor of a list route moved onto an issue, opening its group if it was folded */
function selectIn(s: TuiState, route: Route, issueId: string): TuiState {
  if (!s.data || !isListRoute(route)) return s;
  const group = listGroups(route, s.data, listViewOf(s, route)).find(g => g.issues.some(i => i.id === issueId));
  if (!group) return s;
  const expanded = expandedFn(s, route)(group.id) ? s.expanded : { ...s.expanded, [expandKey(route, group.id)]: true };
  const ids = listRowsFor(route, s.data, listViewOf({ ...s, expanded }, route)).filter(isSelectable).map(r => r.id);
  const at = ids.indexOf(issueId);
  return at < 0 ? s : { ...s, expanded, cursor: { ...s.cursor, [routeKey(route)]: at } };
}

/** fold or open one group of the current list, or (groupId null) fold every group, or open them all when all are folded */
function fold(s: TuiState, groupId: string | null): TuiState {
  if (!s.data || !isListRoute(s.route)) return s;
  const isOpen = expandedFn(s, s.route);
  const groups = listGroups(s.route, s.data, listViewOf(s, s.route));
  const ids = groupId ? [groupId] : groups.map(g => g.id);
  const open = groupId ? !isOpen(groupId) : ids.every(id => !isOpen(id));
  const expanded = { ...s.expanded };
  for (const id of ids) expanded[expandKey(s.route, id)] = open;
  return relist(s, { ...s, expanded });
}

function stepIssue(s: TuiState, delta: number, now: number): TuiState {
  if (s.route.kind !== 'issue' || !s.data) return s;
  const ids = siblingIssueIds(s, now);
  const at = ids.indexOf(s.route.issueId);
  const nextId = at < 0 ? undefined : ids[at + delta];
  if (!nextId) {
    const text = !ids.length || at < 0 ? 'J/K step through the list this issue was opened from' : delta > 0 ? 'Last issue in the list' : 'First issue in the list';
    return { ...s, toast: { id: now, tone: 'info', text } };
  }
  const route: Route = { kind: 'issue', issueId: nextId };
  const from = s.stack[s.stack.length - 1];
  const moved = from.kind === 'inbox' ? s : selectIn(s, from, nextId);
  return { ...moved, route, cursor: { ...moved.cursor, [routeKey(route)]: 0 } };
}

export function reducer(s: TuiState, a: Action): TuiState {
  switch (a.type) {
    case 'syncStart': return { ...s, syncing: true };
    case 'loaded': {
      const next = relist(s, { ...s, data: a.data, status: 'ready', error: null, syncing: false, syncedAt: a.at }, a.at);
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
    case 'toggleGroup': return fold(s, a.groupId);
    case 'foldAll': return fold(s, null);
    case 'cycleGroupBy': return relist(s, { ...s, groupBy: GROUP_BYS[(GROUP_BYS.indexOf(s.groupBy) + 1) % GROUP_BYS.length] });
    case 'cyclePreset': return relist(s, { ...s, preset: PRESETS[(PRESETS.indexOf(s.preset) + 1) % PRESETS.length] });
    case 'select': return selectIn(s, s.route, a.issueId);
    case 'focus': return { ...s, focus: a.focus };
    case 'sidebarMove': return { ...s, sidebarCursor: clamp(s.sidebarCursor + a.delta, 0, Math.max(0, a.count - 1)) };
    case 'toggleSidebar': return { ...s, sidebarHidden: !s.sidebarHidden, focus: 'main' };
    case 'peek': return { ...s, peek: a.on };
    case 'pending': return s.pending === a.key ? s : { ...s, pending: a.key };
    case 'stepIssue': return stepIssue(s, a.delta, a.now);
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
    case 'patchIssue': return s.data ? relist(s, { ...s, data: patchIssue(s.data, a.issueId, a.patch) }) : s;
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
