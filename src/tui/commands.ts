// What each keymap command does. Reads go through the state; writes go through the Baseline client,
// patched into the state first so the screen answers before the server does.
import type { Dispatch } from 'react';
import { BaselineError, ResolveError, type Baseline } from '../client/index.js';
import { PRIORITY_LABELS, type Handoff, type Issue, type Priority } from '../core/types.js';
import { openBrowser, osc52 } from '../cli/system.js';
import type { CommandId } from './keys.js';
import { agentCommand, agentCwd, agentEnv, editInEditor, runInTerminal } from './launch.js';
import { inboxItems, isListRoute, listRowsFor, projectRows, selectableIds, type InboxItem, type Tab } from './model.js';
import { cycleDraft, filteredOptions, newDraft, NONE, searchResults } from './overlays.js';
import { listViewOf, routeKey, type Action, type PickerField, type TuiState } from './state.js';
import { emptyField, fieldOf } from './textfield.js';

export interface Layout { pageSize: number; detailMax: number; helpMax: number; tabs: Tab[] }

export interface Ctx {
  state: TuiState;
  dispatch: Dispatch<Action>;
  bl: Baseline;
  actorId: string | undefined;
  layout: Layout;
  refresh: () => Promise<void>;
  /** marks a write as started (so a fetch that began before it can't overwrite its optimistic patch); call the result when it settles */
  beginWrite: () => () => void;
  suspend: (fn: () => void | Promise<void>) => Promise<void>;
  /** writes straight to the terminal, past Ink (escape sequences that draw nothing) */
  terminal: (seq: string) => void;
  /** the native clipboard helper; false when none worked */
  clipboard: (text: string) => boolean;
  exit: () => void;
  now: () => number;
}

let toastSeq = 0;
export const toast = (dispatch: Dispatch<Action>, tone: 'ok' | 'error' | 'info', text: string) =>
  dispatch({ type: 'toast', toast: { id: ++toastSeq, tone, text } });

export const errorText = (e: unknown) =>
  e instanceof BaselineError || e instanceof ResolveError ? e.message : e instanceof Error ? e.message : String(e);

function cursorIds(s: TuiState, now: number): string[] {
  return s.data ? selectableIds(s.route, s.data, listViewOf(s, s.route), now) : [];
}

/** the issue a command acts on: the open issue, or the row under the cursor */
export function targetIssue(s: TuiState, now: number): Issue | undefined {
  if (!s.data) return undefined;
  if (s.route.kind === 'issue') return s.data.issueById.get(s.route.issueId);
  const id = cursorIds(s, now)[s.cursor[routeKey(s.route)] ?? 0];
  if (isListRoute(s.route)) return id ? s.data.issueById.get(id) : undefined;
  if (s.route.kind === 'inbox') {
    const item = currentInboxItem(s, now);
    return item?.issueId ? s.data.issueById.get(item.issueId) : undefined;
  }
  return undefined;
}

export function currentInboxItem(s: TuiState, now: number): InboxItem | undefined {
  if (!s.data || s.route.kind !== 'inbox') return undefined;
  const items = inboxItems(s.data, now);
  return items[Math.min(s.cursor.inbox ?? 0, Math.max(0, items.length - 1))];
}

async function write<T>(ctx: Ctx, opts: { issueId?: string; patch?: Partial<Issue>; run: () => Promise<T>; ok: (r: T) => string; after?: (r: T) => void }): Promise<T | undefined> {
  const end = ctx.beginWrite();
  if (opts.issueId && opts.patch) ctx.dispatch({ type: 'patchIssue', issueId: opts.issueId, patch: opts.patch });
  let result: T;
  try {
    result = await opts.run();
  } catch (e) {
    end();
    toast(ctx.dispatch, 'error', errorText(e));
    await ctx.refresh();
    return undefined;
  }
  end();
  toast(ctx.dispatch, 'ok', opts.ok(result));
  await ctx.refresh();
  opts.after?.(result);
  return result;
}

async function handoff(ctx: Ctx, issue: Issue): Promise<Handoff | undefined> {
  try {
    const h = await ctx.bl.handoffFor(issue.id);
    if (!h) toast(ctx.dispatch, 'error', `No handoff for ${ctx.state.data!.keyOf(issue)}`);
    return h;
  } catch (e) {
    toast(ctx.dispatch, 'error', errorText(e));
    return undefined;
  }
}

/** both ways at once: OSC 52 for SSH and helper-less terminals, the native helper for terminals that ignore OSC 52 */
function copy(ctx: Ctx, text: string, what: string): void {
  ctx.terminal(osc52(text));
  toast(ctx.dispatch, 'ok', ctx.clipboard(text) ? `Copied ${what}` : `Copied ${what} (through the terminal; no pbcopy, wl-copy or xclip here)`);
}

function openPicker(ctx: Ctx, field: PickerField): void {
  const issue = targetIssue(ctx.state, ctx.now());
  if (!issue) return toast(ctx.dispatch, 'info', 'Select an issue first');
  ctx.dispatch({ type: 'openOverlay', overlay: { kind: 'picker', field, issueId: issue.id, query: emptyField, cursor: 0, selected: field === 'labels' ? [...issue.labelIds] : [] } });
}

function applyPicker(ctx: Ctx): Promise<unknown> | void {
  const s = ctx.state, data = s.data!;
  const o = s.overlay;
  if (o.kind !== 'picker') return;
  const chosen = filteredOptions(o, data)[o.cursor]?.option;
  const issue = data.issueById.get(o.issueId);
  if (!issue) return ctx.dispatch({ type: 'closeOverlay' });
  const key = data.keyOf(issue);
  ctx.dispatch({ type: 'closeOverlay' });
  const update = (patch: Partial<Issue>, label: string) =>
    write(ctx, { issueId: issue.id, patch, run: () => ctx.bl.updateIssue(issue.id, patch, ctx.actorId), ok: () => `${key} → ${label}` });
  if (o.field === 'labels') {
    const before = [...issue.labelIds].sort().join();
    if ([...o.selected].sort().join() === before) return;
    const names = o.selected.map(id => data.labelById.get(id)?.name).filter(Boolean).join(', ');
    return update({ labelIds: o.selected }, names ? `labels ${names}` : 'no labels');
  }
  if (!chosen || chosen.current) return;
  switch (o.field) {
    case 'state': return update({ stateId: chosen.id }, chosen.label);
    case 'priority': return update({ priority: Number(chosen.id) as Priority }, PRIORITY_LABELS[Number(chosen.id) as Priority]);
    case 'assignee': return update({ assigneeId: chosen.id === NONE ? null : chosen.id }, chosen.id === NONE ? 'unassigned' : chosen.label);
    case 'project': return update({ projectId: chosen.id === NONE ? null : chosen.id }, chosen.id === NONE ? 'no project' : chosen.label);
  }
}

async function accept(ctx: Ctx): Promise<unknown> {
  const s = ctx.state, data = s.data!, o = s.overlay;
  switch (o.kind) {
    case 'picker': return applyPicker(ctx);
    case 'search': {
      const r = searchResults(o.input.value, data)[o.cursor];
      if (!r) return;
      return ctx.dispatch({ type: 'navigate', route: { kind: 'issue', issueId: r.issue.id } });
    }
    case 'compose': {
      const text = o.input.value.trim();
      if (o.target === 'issue') {
        if (!text) return toast(ctx.dispatch, 'error', 'Give the issue a title first');
        const d = o.draft;
        ctx.dispatch({ type: 'closeOverlay' });
        return write(ctx, {
          run: () => ctx.bl.createIssue({ teamId: d.teamId, title: text, stateId: d.stateId || undefined, priority: d.priority, assigneeId: d.assigneeId, projectId: d.projectId }, ctx.actorId),
          ok: issue => `Created ${data.teamById.get(issue.teamId)?.key ?? 'ISS'}-${issue.number}  ${issue.title}`,
          after: issue => ctx.dispatch({ type: 'select', issueId: issue.id }),
        });
      }
      const issue = data.issueById.get(o.issueId);
      if (!issue) return ctx.dispatch({ type: 'closeOverlay' });
      const key = data.keyOf(issue);
      if (o.target === 'comment') {
        if (!text) return toast(ctx.dispatch, 'error', 'Type a comment first, or esc to cancel');
        ctx.dispatch({ type: 'closeOverlay' });
        return write(ctx, { run: () => ctx.bl.addComment(issue.id, ctx.actorId, text, null), ok: () => `Commented on ${key}` });
      }
      if (!text) return toast(ctx.dispatch, 'error', 'A title can\'t be empty');
      ctx.dispatch({ type: 'closeOverlay' });
      if (text === issue.title) return;
      return write(ctx, { issueId: issue.id, patch: { title: text }, run: () => ctx.bl.updateIssue(issue.id, { title: text }, ctx.actorId), ok: () => `${key} renamed` });
    }
    case 'confirm': {
      ctx.dispatch({ type: 'closeOverlay' });
      const issue = data.issueById.get(o.issueId);
      if (!issue) return;
      const key = data.keyOf(issue);
      let result = { ok: false, message: '' };
      await ctx.suspend(() => {
        result = runInTerminal(o.command, { cwd: o.cwd, env: agentEnv(ctx.bl.target, key), banner: `baseline › ${key}: ${o.command[0]} in ${o.cwd} (exit it to return to the TUI)` });
      });
      toast(ctx.dispatch, result.ok ? 'ok' : 'error', `${key}: ${result.message}`);
      return ctx.refresh();
    }
    default: return;
  }
}

function overlayCount(ctx: Ctx): number {
  const s = ctx.state, data = s.data!, o = s.overlay;
  switch (o.kind) {
    case 'picker': return filteredOptions(o, data).length;
    case 'search': return searchResults(o.input.value, data).length;
    default: return 0;
  }
}

function move(ctx: Ctx, delta: number): void {
  const s = ctx.state;
  if (s.route.kind === 'issue') return ctx.dispatch({ type: 'scroll', delta, max: ctx.layout.detailMax });
  ctx.dispatch({ type: 'move', delta, count: cursorIds(s, ctx.now()).length });
}

export async function runCommand(cmd: CommandId, ctx: Ctx, key: string): Promise<unknown> {
  const s = ctx.state, d = ctx.dispatch;
  const now = ctx.now();
  if (cmd === 'quit') return ctx.exit();
  if (cmd === 'retry' || cmd === 'refresh') return ctx.refresh();
  const data = s.data;
  if (!data) return;
  const issue = () => targetIssue(s, now);
  const needIssue = (fn: (i: Issue) => unknown) => {
    const i = issue();
    return i ? fn(i) : toast(d, 'info', 'Select an issue first');
  };

  switch (cmd) {
    case 'backOrQuit': return s.stack.length ? d({ type: 'back' }) : ctx.exit();
    case 'back': return d({ type: 'back' });
    case 'help': return d({ type: 'openOverlay', overlay: { kind: 'help', scroll: 0 } });
    case 'search': return d({ type: 'openOverlay', overlay: { kind: 'search', input: emptyField, cursor: 0 } });
    case 'create':
      if (!data.teams.length) return toast(d, 'error', 'This workspace has no teams to file an issue in');
      return d({ type: 'openOverlay', overlay: { kind: 'compose', target: 'issue', field: 'title', input: emptyField, draft: newDraft(s, data) } });
    case 'tab': {
      const tab = ctx.layout.tabs[Number(key) - 1];
      return tab ? d({ type: 'switchView', route: tab.route }) : undefined;
    }
    case 'down': return move(ctx, 1);
    case 'up': return move(ctx, -1);

    case 'open': {
      const id = cursorIds(s, now)[s.cursor[routeKey(s.route)] ?? 0];
      if (!id) return;
      if (isListRoute(s.route)) {
        const row = listRowsFor(s.route, data, listViewOf(s, s.route)).find(r => r.id === id);
        if (row?.kind === 'group') return d({ type: 'toggleGroup', groupId: row.group.id });
        return d({ type: 'navigate', route: { kind: 'issue', issueId: id } });
      }
      if (s.route.kind === 'projects') {
        const p = projectRows(data).find(r => r.id === id);
        return p ? d({ type: 'navigate', route: { kind: 'project', projectId: p.id } }) : undefined;
      }
      if (s.route.kind === 'inbox') {
        const item = inboxItems(data, now).find(i => i.id === id);
        if (!item) return;
        if (item.unread) markRead(ctx, [item.id], true);
        if (item.issueId) return d({ type: 'navigate', route: { kind: 'issue', issueId: item.issueId } });
        if (item.notification.projectId && data.projectById.has(item.notification.projectId)) return d({ type: 'navigate', route: { kind: 'project', projectId: item.notification.projectId } });
        return toast(d, 'info', item.body || 'Nothing to open for this notification');
      }
      return;
    }

    case 'setState': return openPicker(ctx, 'state');
    case 'setPriority': return openPicker(ctx, 'priority');
    case 'setAssignee': return openPicker(ctx, 'assignee');
    case 'setLabels': return openPicker(ctx, 'labels');
    case 'setProject': return openPicker(ctx, 'project');
    case 'assignMe': return needIssue(i => {
      const me = data.currentUser;
      if (i.assigneeId === me.id) return toast(d, 'info', `${data.keyOf(i)} is already yours`);
      return write(ctx, { issueId: i.id, patch: { assigneeId: me.id }, run: () => ctx.bl.updateIssue(i.id, { assigneeId: me.id }, ctx.actorId), ok: () => `${data.keyOf(i)} → ${me.name}` });
    });
    case 'comment': return needIssue(i => d({ type: 'openOverlay', overlay: { kind: 'compose', target: 'comment', issueId: i.id, input: emptyField } }));
    case 'editTitle': return needIssue(i => d({ type: 'openOverlay', overlay: { kind: 'compose', target: 'title', issueId: i.id, input: fieldOf(i.title) } }));
    case 'editDescription': return needIssue(async i => {
      let result: ReturnType<typeof editInEditor> = { text: null, error: null };
      await ctx.suspend(() => { result = editInEditor(i.description, data.keyOf(i)); });
      if (result.error) return toast(d, 'error', result.error);
      const text = result.text?.replace(/\s+$/, '') ?? null;
      if (text === null || text === i.description.replace(/\s+$/, '')) return toast(d, 'info', 'Description unchanged');
      return write(ctx, { issueId: i.id, patch: { description: text }, run: () => ctx.bl.updateIssue(i.id, { description: text }, ctx.actorId), ok: () => `${data.keyOf(i)} description saved` });
    });

    case 'copyKey': return needIssue(i => copy(ctx, data.keyOf(i), data.keyOf(i)));
    case 'copyUrl': return needIssue(async i => { const h = await handoff(ctx, i); if (h) copy(ctx, h.url, h.url); });
    case 'copyBranch': return needIssue(async i => { const h = await handoff(ctx, i); if (h) copy(ctx, h.branchName, `branch ${h.branchName}`); });
    case 'copyPrompt': return needIssue(async i => { const h = await handoff(ctx, i); if (h) copy(ctx, h.prompt, `agent prompt for ${h.key}`); });
    case 'openBrowser': return needIssue(async i => {
      const h = await handoff(ctx, i);
      if (!h) return;
      openBrowser(h.url);
      toast(d, 'ok', `Opened ${h.key} in the browser${ctx.bl.target.kind === 'local' ? ' (needs `baseline serve` running)' : ''}`);
    });
    case 'startAgent': return needIssue(async i => {
      const h = await handoff(ctx, i);
      if (!h) return;
      const location = i.locationId ? data.locations.find(l => l.id === i.locationId) : undefined;
      const where = agentCwd(location?.path);
      d({ type: 'openOverlay', overlay: { kind: 'confirm', action: 'agent', issueId: i.id, command: agentCommand(h.prompt), cwd: where.cwd, note: where.note } });
    });

    case 'markRead': {
      if (s.route.kind !== 'inbox') return;
      const id = cursorIds(s, now)[s.cursor[routeKey(s.route)] ?? 0];
      const item = inboxItems(data, now).find(i => i.id === id);
      return item ? markRead(ctx, [item.id], item.unread) : undefined;
    }
    case 'markAllRead': {
      const n = inboxItems(data, now).filter(i => i.unread).length;
      if (!n) return toast(d, 'info', 'Nothing unread');
      const end = ctx.beginWrite();
      d({ type: 'markRead', ids: 'all', read: true });
      try {
        await ctx.bl.markAllNotificationsRead();
        toast(d, 'ok', `Marked ${n} notification${n === 1 ? '' : 's'} read`);
      } catch (e) { toast(d, 'error', errorText(e)); } finally { end(); }
      return ctx.refresh();
    }

    case 'overlayDown': case 'overlayUp': {
      const delta = cmd === 'overlayDown' ? 1 : -1;
      if (s.overlay.kind === 'help') return d({ type: 'helpScroll', delta, max: ctx.layout.helpMax });
      return d({ type: 'overlayMove', delta, count: overlayCount(ctx) });
    }
    case 'overlayAccept': return accept(ctx);
    case 'overlayCancel': return d({ type: 'closeOverlay' });
    case 'pickerToggle': {
      const o = s.overlay;
      if (o.kind !== 'picker') return;
      const opt = filteredOptions(o, data)[o.cursor]?.option;
      return opt ? d({ type: 'pickerToggle', id: opt.id }) : undefined;
    }
    case 'pickerPick': {
      const o = s.overlay;
      const n = Number(key) - 1;
      if (o.kind !== 'picker' || !filteredOptions(o, data)[n]) return;
      const picked = { ...o, cursor: n };
      d({ type: 'overlayMove', delta: n - o.cursor, count: overlayCount(ctx) });
      if (o.field === 'labels') return runCommand('pickerToggle', { ...ctx, state: { ...s, overlay: picked } }, key);
      return applyPicker({ ...ctx, state: { ...s, overlay: picked } });
    }
    case 'composeNext': return d({ type: 'composeField', delta: 1 });
    case 'composePrev': return d({ type: 'composeField', delta: -1 });
    case 'composeCycleNext': case 'composeCyclePrev': {
      const o = s.overlay;
      if (o.kind !== 'compose' || o.target !== 'issue' || o.field === 'title') return;
      return d({ type: 'composeDraft', draft: cycleDraft(o.field, o.draft, cmd === 'composeCycleNext' ? 1 : -1, data) });
    }
  }
}

async function markRead(ctx: Ctx, ids: string[], read: boolean): Promise<void> {
  const end = ctx.beginWrite();
  ctx.dispatch({ type: 'markRead', ids, read });
  try {
    await Promise.all(ids.map(id => ctx.bl.markNotificationRead(id, read)));
  } catch (e) {
    toast(ctx.dispatch, 'error', errorText(e));
  } finally {
    end();
  }
  await ctx.refresh();
}

