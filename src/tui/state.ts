// The whole app state and the one reducer that changes it.
import type { Handoff, Issue, Priority } from '../core/types.js';
import type { FieldId } from './detail.js';
import type { MenuId } from './menus.js';
import type { WorkThread } from '../core/work-types.js';
import { patchIssue, type TuiData } from './data.js';
import { DONE_GROUP, issueNeeds, type NeedRow, type Pane } from './today.js';
import {
  defaultExpanded, isListRoute, isSelectable, listGroups, listRowsFor, rowIdFor, selectableIds,
  type GroupBy, type ListRow, type ListView, type Preset,
} from './model.js';
import { emptyField, type TextField } from './textfield.js';

/** Today, a team's list, a project's list (from /), and the issue page. An issue page opened from Needs you
 *  (`needs`) counts "n of N" and moves on to the next item after a decision; `focusComment` is where it opens */
export type Route =
  | { kind: 'today' }
  | { kind: 'team'; teamId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'issue'; issueId: string; needs?: boolean; focusComment?: string };

export type PickerField = 'state' | 'priority' | 'assignee' | 'labels' | 'project';

export interface IssueDraft { teamId: string; stateId: string; priority: Priority; assigneeId: string | null; projectId: string | null }
export const DRAFT_FIELDS = ['title', 'team', 'state', 'priority', 'assignee', 'project'] as const;
export type DraftField = typeof DRAFT_FIELDS[number];

/** the start sheet's options, in the order they are numbered */
export const START_CHOICES = ['pane', 'here', 'copy', 'none'] as const;
export type StartChoice = typeof START_CHOICES[number];
/** how an answer to a blocked agent runs it again */
export const RERUN_CHOICES = ['pane', 'here', 'comment'] as const;

/** what rises from the bottom: anything typed or confirmed, and the lists / opens */
export type Sheet =
  | { type: 'start'; issueId: string; cursor: number; branch: { name: string; exists: boolean } | null }
  /** a note: a comment (m), a reply to a mention, a send-back, or an answer to a blocked agent (`rerun` indexes RERUN_CHOICES) */
  | { type: 'note'; purpose: 'comment' | 'reply' | 'sendBack' | 'answer'; issueId: string; input: TextField; parentId: string | null; to: string | null; rerun: number }
  | { type: 'followups'; issueId: string; ids: string[]; ticked: string[]; cursor: number }
  | { type: 'standup'; text: string | null; error: string | null }
  | { type: 'projects'; cursor: number }
  | { type: 'notifications'; cursor: number };

export type Overlay =
  | { kind: 'none' }
  /** `intro` is the first-launch card alone; ? adds every key below it */
  | { kind: 'help'; scroll: number; intro?: boolean }
  | { kind: 'find'; query: TextField; cursor: number }
  /** `selected` is the labels picker's set */
  | { kind: 'picker'; field: PickerField; issueId: string; query: TextField; cursor: number; selected: string[] }
  | { kind: 'compose'; target: 'issue'; field: DraftField; input: TextField; draft: IssueDraft }
  | { kind: 'compose'; target: 'title'; issueId: string; input: TextField }
  | { kind: 'sheet'; sheet: Sheet }
  /** the space menu; `path` is the submenus stepped into, `cursor` the row ↑↓ is on */
  | { kind: 'menu'; path: MenuId[]; issueId: string; cursor: number };

/** `undo` offers u: the toast of a change that is on the undo stack */
export interface Toast { id: number; tone: 'ok' | 'error' | 'info'; text: string; undo?: boolean }

/** one field change made from this TUI, with what it replaced */
export interface UndoEntry { issueId: string; key: string; field: FieldId; before: Partial<Issue>; after: Partial<Issue>; label: string }
export const UNDO_LIMIT = 20;

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
  /** an issue key to put the list cursor on once data arrives (reopening where the last session left off) */
  restoreCursor: string | null;
  toast: Toast | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  syncedAt: number | null;
  syncing: boolean;
  threads: Record<string, WorkThread[]>;
  /** per issue: its prompt, branch and link, fetched when a menu or / needs them */
  handoffs: Record<string, Handoff>;
  /** newest last */
  undo: UndoEntry[];
  /** the field that just changed, marked ✓ saved for a moment */
  saved: { issueId: string; field: FieldId; id: number } | null;
  /** issue → the tmux pane this TUI started its agent in (on this tmux server) */
  panes: Record<string, Pane>;
}

export const routeKey = (r: Route): string => {
  switch (r.kind) {
    case 'team': return `team:${r.teamId}`;
    case 'project': return `project:${r.projectId}`;
    case 'issue': return `issue:${r.issueId}`;
    default: return r.kind;
  }
};

export const TODAY: Route = { kind: 'today' };
export const isTopLevel = (r: Route) => r.kind === 'today' || r.kind === 'team';

export function initialState(route: Route = TODAY, stack: Route[] = [], start: { groupBy?: GroupBy; preset?: Preset; cursorKey?: string | null; intro?: boolean; panes?: Record<string, Pane> } = {}): TuiState {
  return {
    data: null, route, stack, overlay: start.intro ? { kind: 'help', scroll: 0, intro: true } : { kind: 'none' }, cursor: {}, expanded: {}, groupBy: start.groupBy ?? 'status', preset: start.preset ?? 'all', restoreCursor: start.cursorKey ?? null,
    toast: null, status: 'loading', error: null, syncedAt: null, syncing: false, threads: {}, handoffs: {}, undo: [], saved: null, panes: start.panes ?? {},
  };
}

/** whether Today's "Done this week" is open */
export const doneOpen = (s: Pick<TuiState, 'expanded'>) => s.expanded[expandKey(TODAY, DONE_GROUP)] ?? false;

/** the issue page a Needs you row opens: at what the agent did, or (a mention) at the comment with the reply sheet open */
export function openNeed(s: TuiState, row: NeedRow & { issue: Issue }, stack: Route[]): TuiState {
  const route: Route = { kind: 'issue', issueId: row.issue.id, needs: true, ...(row.kind === 'mention' && row.commentId ? { focusComment: row.commentId } : {}) };
  const cursor = { ...s.cursor };
  delete cursor[routeKey(route)];
  const reply = row.kind === 'mention' && s.data;
  const parent = reply && row.commentId ? s.data!.comments.find(c => c.id === row.commentId) : undefined;
  const to = reply ? s.data!.userById.get(parent?.userId ?? row.actorId ?? '')?.name.split(/\s+/)[0] ?? null : null;
  const overlay: Overlay = reply
    ? { kind: 'sheet', sheet: { type: 'note', purpose: 'reply', issueId: row.issue.id, input: emptyField, parentId: parent ? parent.parentId ?? parent.id : null, to, rerun: 0 } }
    : { kind: 'none' };
  return { ...s, route, stack, overlay, cursor };
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
  /** `from`: where the page is before its first scroll */
  | { type: 'scroll'; delta: number; max: number; from?: number }
  | { type: 'toggleGroup'; groupId: string }
  | { type: 'setView'; groupBy?: GroupBy; preset?: Preset }
  | { type: 'select'; issueId: string }
  | { type: 'openOverlay'; overlay: Overlay }
  | { type: 'closeOverlay' }
  | { type: 'editInput'; input: TextField }
  /** ↑↓ wrap around; `clamp` (a page, the first or last row) stops at the ends */
  | { type: 'overlayMove'; delta: number; count: number; clamp?: boolean }
  | { type: 'pickerToggle'; id: string }
  | { type: 'menuPush'; menu: MenuId }
  | { type: 'menuBack' }
  | { type: 'handoff'; issueId: string; handoff: Handoff }
  | { type: 'pushUndo'; entry: UndoEntry }
  | { type: 'popUndo' }
  | { type: 'saved'; issueId: string; field: FieldId; id: number }
  | { type: 'clearSaved'; id: number }
  | { type: 'composeField'; delta: number }
  | { type: 'composeDraft'; draft: Partial<IssueDraft> }
  | { type: 'helpScroll'; delta: number; max: number }
  | { type: 'patchIssue'; issueId: string; patch: Partial<Issue> }
  | { type: 'markRead'; ids: string[] | 'all'; read: boolean }
  | { type: 'threads'; issueId: string; threads: WorkThread[] }
  /** after a decision on Needs you item `index`: open the item now at that place, or go back to Today when none is left */
  | { type: 'advance'; index: number; at: number }
  | { type: 'openNeed'; issueId: string; at: number }
  | { type: 'setSheet'; sheet: Sheet }
  /** a pane an agent was started in; null forgets it (it is gone) */
  | { type: 'pane'; issueId: string; pane: Pane | null }
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
    if (r.kind === 'issue') continue;
    // a list nobody has moved in yet has its cursor on the first row, and that row is followed too
    if (cursor[k] === undefined) { if (r !== after.route) continue; cursor[k] = 0; }
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

/** fold or open one group of the current list */
function fold(s: TuiState, groupId: string): TuiState {
  if (!s.data || !isListRoute(s.route)) return s;
  return relist(s, { ...s, expanded: { ...s.expanded, [expandKey(s.route, groupId)]: !expandedFn(s, s.route)(groupId) } });
}

export function reducer(s: TuiState, a: Action): TuiState {
  switch (a.type) {
    case 'syncStart': return { ...s, syncing: true };
    case 'loaded': {
      let next = relist(s, { ...s, data: a.data, status: 'ready', error: null, syncing: false, syncedAt: a.at }, a.at);
      if (next.restoreCursor) {
        const issue = a.data.issues.find(i => a.data.keyOf(i) === next.restoreCursor);
        const listRoute = [next.route, ...[...next.stack].reverse()].find(isListRoute);
        next = { ...(issue && listRoute ? selectIn(next, listRoute, issue.id) : next), restoreCursor: null };
      }
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
      return { ...s, stack: [...s.stack, s.route], route: a.route, overlay: { kind: 'none' } };
    case 'switchView':
      return { ...s, stack: [], route: a.route, overlay: { kind: 'none' } };
    case 'back': {
      // a team or project list goes back to Today, so Today is never more than two presses away
      if (!s.stack.length) return s.route.kind === 'team' || s.route.kind === 'project' ? { ...s, route: TODAY, overlay: { kind: 'none' } } : s;
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
      return { ...s, cursor: { ...s.cursor, [k]: clamp((s.cursor[k] ?? a.from ?? 0) + a.delta, 0, Math.max(0, a.max)) } };
    }
    case 'toggleGroup': return fold(s, a.groupId);
    case 'setView': return relist(s, { ...s, groupBy: a.groupBy ?? s.groupBy, preset: a.preset ?? s.preset });
    case 'select': return selectIn(s, s.route, a.issueId);
    case 'openOverlay': return { ...s, overlay: a.overlay };
    case 'closeOverlay': return { ...s, overlay: { kind: 'none' } };
    case 'editInput': {
      const o = s.overlay;
      if (o.kind === 'find' || o.kind === 'picker') return { ...s, overlay: { ...o, query: a.input, cursor: a.input.value === o.query.value ? o.cursor : 0 } };
      if (o.kind === 'compose') return { ...s, overlay: { ...o, input: a.input } };
      if (o.kind === 'sheet' && o.sheet.type === 'note') return { ...s, overlay: { kind: 'sheet', sheet: { ...o.sheet, input: a.input } } };
      return s;
    }
    case 'overlayMove': {
      const o = s.overlay;
      const n = Math.max(1, a.count);
      if (o.kind === 'sheet' && 'cursor' in o.sheet) {
        const cur = o.sheet.cursor;
        return { ...s, overlay: { kind: 'sheet', sheet: { ...o.sheet, cursor: a.clamp ? clamp(cur + a.delta, 0, n - 1) : ((cur + a.delta) % n + n) % n } } };
      }
      if (o.kind !== 'find' && o.kind !== 'picker' && o.kind !== 'menu') return s;
      return { ...s, overlay: { ...o, cursor: a.clamp ? clamp(o.cursor + a.delta, 0, n - 1) : ((o.cursor + a.delta) % n + n) % n } };
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
    case 'menuPush': return s.overlay.kind === 'menu' ? { ...s, overlay: { ...s.overlay, path: [...s.overlay.path, a.menu], cursor: 0 } } : s;
    case 'menuBack': {
      const o = s.overlay;
      if (o.kind !== 'menu') return s;
      return o.path.length > 1 ? { ...s, overlay: { ...o, path: o.path.slice(0, -1), cursor: 0 } } : { ...s, overlay: { kind: 'none' } };
    }
    case 'pushUndo': return { ...s, undo: [...s.undo, a.entry].slice(-UNDO_LIMIT) };
    case 'popUndo': return { ...s, undo: s.undo.slice(0, -1) };
    case 'saved': return { ...s, saved: { issueId: a.issueId, field: a.field, id: a.id } };
    case 'clearSaved': return s.saved?.id === a.id ? { ...s, saved: null } : s;
    case 'handoff': return { ...s, handoffs: { ...s.handoffs, [a.issueId]: a.handoff } };
    case 'threads': return { ...s, threads: { ...s.threads, [a.issueId]: a.threads } };
    case 'advance': {
      if (!s.data) return s;
      const rows = issueNeeds(s.data, a.at);
      if (!rows.length) return { ...s, route: TODAY, stack: [], overlay: { kind: 'none' } };
      return openNeed(s, rows[Math.min(Math.max(0, a.index), rows.length - 1)]!, [TODAY]);
    }
    case 'openNeed': {
      const row = s.data ? issueNeeds(s.data, a.at).find(r => r.issue.id === a.issueId) : undefined;
      return row ? openNeed(s, row, [...s.stack, s.route]) : s;
    }
    case 'setSheet': return { ...s, overlay: { kind: 'sheet', sheet: a.sheet } };
    case 'pane': {
      const panes = { ...s.panes };
      if (a.pane) panes[a.issueId] = a.pane; else delete panes[a.issueId];
      return { ...s, panes };
    }
    case 'toast': return { ...s, toast: a.toast };
    case 'clearToast': return s.toast?.id === a.id ? { ...s, toast: null } : s;
  }
}
