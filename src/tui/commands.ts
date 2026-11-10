// What each keymap command does. Reads go through the state; writes go through the Baseline client,
// patched into the state first so the screen answers before the server does.
import { basename } from 'node:path';
import type { Dispatch } from 'react';
import { BaselineError, ResolveError, type Baseline } from '../client/index.js';
import { PRIORITY_LABELS, type Handoff, type Issue, type Priority } from '../core/types.js';
import { openBrowser, osc52 } from '../cli/system.js';
import { localRepo } from '../cli/repo.js';
import { myActivity, startIssue } from '../ops/index.js';
import { OpError, runOp, type LocalRepo, type OpContext } from '../ops/operation.js';
import type { CommandId } from './keys.js';
import { agentCommand, agentCwd, agentEnv, branchExists, editInEditor, focusPane, runInPane, runInTerminal } from './launch.js';
import { MENUS, SUBMENU, type MenuCtx, type MenuId } from './menus.js';
import { isListRoute, isSelectable, listRowsFor, notificationRows, projectRows, selectableIds, type Tab } from './model.js';
import type { FieldId } from './detail.js';
import { findItems, findResults, type FindItem } from './find.js';
import { cycleDraft, filteredOptions, newDraft, NONE } from './overlays.js';
import { cursorRow, doneOpen, listViewOf, RERUN_CHOICES, routeKey, START_CHOICES, type Action, type PickerField, type Sheet, type TuiState, type UndoEntry } from './state.js';
import { emptyField, fieldOf } from './textfield.js';
import { DONE_GROUP, followupsOf, issueNeeds, myThread, prOf, threadAsk, todayModel, todayRows, type NeedRow, type TodayRow } from './today.js';

/** `pageSize`: the rows a list or the issue page shows; `overlayPage`: the rows the open picker, / or help shows */
/** `detailStart`: where the issue page sits before it is scrolled (a mention opens at its comment) */
export interface Layout { pageSize: number; detailMax: number; detailStart?: number; helpMax: number; overlayPage: number; tabs: Tab[] }

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
  /** the git repo an issue starts in (its branch is checked out there); tests pass one that touches no repo */
  repo?: (cwd: string) => LocalRepo;
  /** told the tmux pane an agent was started in, to remember it across sessions */
  onPane?: (issueId: string, paneId: string) => void;
  /** whether a new tmux pane is possible (default: $TMUX is set) */
  tmux?: boolean;
}

let toastSeq = 0;
export const toast = (dispatch: Dispatch<Action>, tone: 'ok' | 'error' | 'info', text: string, undo = false) =>
  dispatch({ type: 'toast', toast: { id: ++toastSeq, tone, text, undo } });

export const errorText = (e: unknown) =>
  e instanceof BaselineError || e instanceof ResolveError || e instanceof OpError ? e.message : e instanceof Error ? e.message : String(e);

const inTmux = (ctx: Pick<Ctx, 'tmux'>) => ctx.tmux ?? !!process.env.TMUX;

function cursorIds(s: TuiState, now: number): string[] {
  return s.data ? selectableIds(s.route, s.data, listViewOf(s, s.route), now) : [];
}

/** the Today row under the cursor */
export function todayRow(s: TuiState, now: number): TodayRow | undefined {
  if (!s.data || s.route.kind !== 'today') return undefined;
  const rows = todayRows(todayModel(s.data, now), doneOpen(s));
  return rows[Math.min(s.cursor[routeKey(s.route)] ?? 0, Math.max(0, rows.length - 1))];
}

/** the issue a command acts on: the open issue, or the row under the cursor */
export function targetIssue(s: TuiState, now: number): Issue | undefined {
  if (!s.data) return undefined;
  if (s.route.kind === 'issue') return s.data.issueById.get(s.route.issueId);
  if (s.route.kind === 'today') {
    const r = todayRow(s, now);
    return !r || r.kind === 'doneHeader' ? undefined : r.kind === 'need' ? r.row.issue ?? undefined : r.row.issue;
  }
  const id = cursorIds(s, now)[s.cursor[routeKey(s.route)] ?? 0];
  return isListRoute(s.route) && id ? s.data.issueById.get(id) : undefined;
}

/** the Needs you row about an issue, and where it sits in the list */
function needOf(s: TuiState, issueId: string, now: number): { row: NeedRow; index: number } | undefined {
  if (!s.data) return undefined;
  const rows = issueNeeds(s.data, now);
  const index = rows.findIndex(r => r.issue.id === issueId);
  return index < 0 ? undefined : { row: rows[index]!, index };
}

async function write<T>(ctx: Ctx, opts: { issueId?: string; patch?: Partial<Issue>; run: () => Promise<T>; ok: (r: T) => string; after?: (r: T) => void; undo?: boolean }): Promise<T | undefined> {
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
  opts.after?.(result);
  toast(ctx.dispatch, 'ok', opts.ok(result), opts.undo);
  await ctx.refresh();
  return result;
}

/** the issue's prompt, branch and link: the cached copy, else fetched (and cached for the menus to show) */
export async function handoff(ctx: Pick<Ctx, 'bl' | 'dispatch' | 'state'>, issue: Issue, quiet = false): Promise<Handoff | undefined> {
  const cached = ctx.state.handoffs[issue.id];
  if (cached) return cached;
  try {
    const h = await ctx.bl.handoffFor(issue.id);
    if (h) ctx.dispatch({ type: 'handoff', issueId: issue.id, handoff: h });
    else if (!quiet) toast(ctx.dispatch, 'error', `No handoff for ${ctx.state.data!.keyOf(issue)}`);
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

/** where an agent for this issue runs: its location when that is on this disk, else here */
export function agentWhere(issue: Issue, data: NonNullable<TuiState['data']>) {
  const location = issue.locationId ? data.locations.find(l => l.id === issue.locationId) : undefined;
  return agentCwd(location?.path);
}

export function menuCtxFor(s: TuiState, issueId: string, now: number, tmux = !!process.env.TMUX): MenuCtx | undefined {
  const issue = s.data?.issueById.get(issueId);
  if (!s.data || !issue) return undefined;
  return { issue, data: s.data, handoff: s.handoffs[issueId], env: tmux ? process.env : { ...process.env, TMUX: '' }, where: agentWhere(issue, s.data), now };
}

function openMenu(ctx: Ctx, menu: MenuId): void {
  const s = ctx.state;
  if (s.overlay.kind === 'menu') return ctx.dispatch({ type: 'menuPush', menu });
  const issue = targetIssue(s, ctx.now());
  if (!issue) return toast(ctx.dispatch, 'info', 'Select an issue first');
  ctx.dispatch({ type: 'openOverlay', overlay: { kind: 'menu', path: [menu], issueId: issue.id, cursor: 0 } });
}

/** a menu row, by its letter or (key null) the row under the cursor: a submenu steps in, anything else closes the menu and runs */
function runMenuRow(ctx: Ctx, key: string | null): Promise<unknown> | void {
  const s = ctx.state, o = s.overlay;
  if (o.kind !== 'menu') return;
  const menu = MENUS[o.path[o.path.length - 1]!];
  const row = key === null ? menu.rows[o.cursor] : menu.rows.find(r => r.key === key);
  const mc = menuCtxFor(s, o.issueId, ctx.now(), inTmux(ctx));
  if (!row || !mc) return;
  const ok = row.enabled?.(mc) ?? true;
  if (ok !== true) return toast(ctx.dispatch, 'info', ok);
  const sub = SUBMENU[row.command];
  if (sub) return ctx.dispatch({ type: 'menuPush', menu: sub });
  ctx.dispatch({ type: 'closeOverlay' });
  return runCommand(row.command, { ...ctx, state: { ...s, overlay: { kind: 'none' } } }, row.key);
}

/** runs the agent on an issue: in a tmux split beside this one (remembered, so enter on In flight goes back to it), or here.
 *  `note`: the person's answer to the question the agent stopped on, added to its prompt */
async function startAgent(ctx: Ctx, i: Issue, where: 'here' | 'pane', note?: string): Promise<{ ok: boolean; message: string }> {
  const data = ctx.state.data!;
  const h = await handoff(ctx, i);
  if (!h) return { ok: false, message: `no handoff for ${data.keyOf(i)}` };
  const key = data.keyOf(i);
  const prompt = note ? `${h.prompt}\n\nYou stopped on a question on ${key}. The person answered (also posted as a comment on ${key}):\n\n${note}\n\nCarry on from where you left off.` : h.prompt;
  const cmd = agentCommand(prompt);
  const at = agentWhere(i, data);
  if (where === 'pane') {
    if (!inTmux(ctx)) return { ok: false, message: 'a new pane needs tmux. Run baseline inside tmux, or run the agent here.' };
    const r = runInPane(cmd, { cwd: at.cwd, target: ctx.bl.target, issueKey: key });
    if (r.ok && r.paneId) {
      ctx.dispatch({ type: 'pane', issueId: i.id, paneId: r.paneId });
      ctx.onPane?.(i.id, r.paneId);
    }
    return r.ok ? { ok: true, message: `${basename(cmd[0]!)} started in a tmux pane beside this one` } : r;
  }
  let result = { ok: false, message: '' };
  await ctx.suspend(() => {
    result = runInTerminal(cmd, { cwd: at.cwd, env: agentEnv(ctx.bl.target, key), banner: `baseline › ${key}: ${cmd[0]} in ${at.cwd} (exit it to return to the TUI)` });
  });
  return result;
}

async function agentCommandRun(ctx: Ctx, i: Issue, where: 'here' | 'pane'): Promise<unknown> {
  const key = ctx.state.data!.keyOf(i);
  const r = await startAgent(ctx, i, where);
  toast(ctx.dispatch, r.ok ? 'ok' : 'error', `${key}: ${r.message}`);
  return where === 'here' ? ctx.refresh() : undefined;
}

function openPicker(ctx: Ctx, field: PickerField): void {
  const issue = targetIssue(ctx.state, ctx.now());
  if (!issue) return toast(ctx.dispatch, 'info', 'Select an issue first');
  ctx.dispatch({ type: 'openOverlay', overlay: { kind: 'picker', field, issueId: issue.id, query: emptyField, cursor: 0, selected: field === 'labels' ? [...issue.labelIds] : [] } });
}

/** how a change reads in its toast: "moved to In Progress", "assigned to Ada Osei" */
export function describeChange(field: FieldId, patch: Partial<Issue>, data: NonNullable<TuiState['data']>): string {
  switch (field) {
    case 'state': return `moved to ${data.stateById.get(patch.stateId ?? '')?.name ?? '?'}`;
    case 'assignee': return patch.assigneeId ? `assigned to ${patch.assigneeId === data.currentUser.id ? 'you' : data.userById.get(patch.assigneeId)?.name ?? 'someone'}` : 'unassigned';
    case 'priority': return `priority set to ${PRIORITY_LABELS[patch.priority ?? 0]}`;
    case 'labels': { const names = (patch.labelIds ?? []).map(id => data.labelById.get(id)?.name).filter(Boolean); return names.length ? `labels: ${names.join(', ')}` : 'labels cleared'; }
    case 'project': return patch.projectId ? `moved to project ${data.projectById.get(patch.projectId)?.name ?? '?'}` : 'removed from its project';
    case 'title': return 'renamed';
    case 'description': return 'description saved';
  }
}

const before = (issue: Issue, patch: Partial<Issue>): Partial<Issue> =>
  Object.fromEntries(Object.keys(patch).map(k => [k, issue[k as keyof Issue]])) as Partial<Issue>;

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? [...a].sort().join() === [...b].sort().join() : a === b;

const undoEntry = (issue: Issue, field: FieldId, patch: Partial<Issue>, data: NonNullable<TuiState['data']>): UndoEntry =>
  ({ issueId: issue.id, key: data.keyOf(issue), field, before: before(issue, patch), after: patch, label: describeChange(field, patch, data) });

/** one field change from this TUI, written ahead of the server's answer, then put on the undo stack */
export async function change(ctx: Ctx, issue: Issue, field: FieldId, patch: Partial<Issue>): Promise<unknown> {
  const data = ctx.state.data!;
  const entry = undoEntry(issue, field, patch, data);
  const ok = await write(ctx, {
    issueId: issue.id, patch, run: () => ctx.bl.updateIssue(issue.id, patch, ctx.actorId), ok: () => `${entry.key} ${entry.label}`, undo: true,
    after: () => ctx.dispatch({ type: 'pushUndo', entry }),
  });
  if (ok) ctx.dispatch({ type: 'saved', issueId: issue.id, field, id: ++toastSeq });
  return ok;
}

/** u: put back what the newest change replaced, unless someone has changed that field since */
async function undo(ctx: Ctx): Promise<unknown> {
  const top = ctx.state.undo[ctx.state.undo.length - 1];
  if (!top) return toast(ctx.dispatch, 'info', 'Nothing to undo');
  let now: Issue | undefined;
  try { now = await ctx.bl.getIssue(top.issueId); } catch (e) { return toast(ctx.dispatch, 'error', errorText(e)); }
  if (!now) {
    ctx.dispatch({ type: 'popUndo' });
    return toast(ctx.dispatch, 'error', `${top.key} is gone; nothing to undo there`);
  }
  const data = ctx.state.data!;
  if (!Object.entries(top.after).every(([k, v]) => sameValue(now![k as keyof Issue], v))) {
    return toast(ctx.dispatch, 'error', `Not undone: ${top.key} changed since (${describeChange(top.field, before(now, top.after), data)}). Undo only reverts what nobody has touched.`);
  }
  ctx.dispatch({ type: 'popUndo' });
  const ok = await write(ctx, {
    issueId: top.issueId, patch: top.before, run: () => ctx.bl.updateIssue(top.issueId, top.before, ctx.actorId),
    ok: () => `Undone: ${top.key} ${describeChange(top.field, top.before, data)}`,
  });
  if (ok) ctx.dispatch({ type: 'saved', issueId: top.issueId, field: top.field, id: ++toastSeq });
  else ctx.dispatch({ type: 'pushUndo', entry: top });
  return ok;
}

// ---------- decisions: they take the item off Needs you, and the issue page moves on to the next one ----------

interface Step { field: FieldId; patch: Partial<Issue> }

/** One decision on an issue: its Needs you notifications marked read (optimistically, so the row leaves at once),
 *  then the writes, one toast, one refetch. On the issue page of an item that needed you, the next item opens. */
async function decide(ctx: Ctx, issue: Issue, opts: { change?: Step; run?: () => Promise<string | void>; text: (extra: string) => string }): Promise<boolean> {
  const s = ctx.state, data = s.data!, now = ctx.now();
  const need = needOf(s, issue.id, now);
  const ids = need?.row.notificationIds ?? [];
  // only an issue page opened from Needs you walks on to the next item
  const onPage = s.route.kind === 'issue' && s.route.issueId === issue.id && !!s.route.needs;
  const end = ctx.beginWrite();
  if (ids.length) ctx.dispatch({ type: 'markRead', ids, read: true });
  const entry = opts.change ? undoEntry(issue, opts.change.field, opts.change.patch, data) : null;
  if (opts.change) ctx.dispatch({ type: 'patchIssue', issueId: issue.id, patch: opts.change.patch });
  let extra = '';
  try {
    if (opts.change) await ctx.bl.updateIssue(issue.id, opts.change.patch, ctx.actorId);
    extra = (await opts.run?.()) ?? '';
    await Promise.all(ids.map(id => ctx.bl.markNotificationRead(id, true)));
  } catch (e) {
    end();
    toast(ctx.dispatch, 'error', errorText(e));
    await ctx.refresh();
    return false;
  }
  end();
  if (entry) {
    ctx.dispatch({ type: 'pushUndo', entry });
    ctx.dispatch({ type: 'saved', issueId: issue.id, field: entry.field, id: ++toastSeq });
  }
  if (onPage && need) ctx.dispatch({ type: 'advance', index: need.index, at: now });
  toast(ctx.dispatch, 'ok', opts.text(extra), !!entry);
  await ctx.refresh();
  return true;
}

const completedState = (data: NonNullable<TuiState['data']>, teamId: string) =>
  data.states.filter(st => st.teamId === teamId && st.type === 'completed').sort((a, b) => a.position - b.position)[0];
/** where sent-back work goes: the team's first started state that isn't In Review */
const workingState = (data: NonNullable<TuiState['data']>, teamId: string) =>
  data.states.filter(st => st.teamId === teamId && st.type === 'started' && st.name.trim().toLowerCase() !== 'in review').sort((a, b) => a.position - b.position)[0];

function doneStep(data: NonNullable<TuiState['data']>, issue: Issue): Step | undefined {
  const st = completedState(data, issue.teamId);
  return st && st.id !== issue.stateId ? { field: 'state', patch: { stateId: st.id } } : undefined;
}

async function markDone(ctx: Ctx, issue: Issue): Promise<unknown> {
  const data = ctx.state.data!;
  const key = data.keyOf(issue);
  const step = doneStep(data, issue);
  if (!step && !needOf(ctx.state, issue.id, ctx.now())) return toast(ctx.dispatch, 'info', `${key} is done already`);
  return decide(ctx, issue, { change: step, text: () => `${key} Done` });
}

function openNote(ctx: Ctx, purpose: 'comment' | 'reply' | 'sendBack' | 'answer', issue: Issue, parentId: string | null = null, to: string | null = null): void {
  ctx.dispatch({ type: 'openOverlay', overlay: { kind: 'sheet', sheet: { type: 'note', purpose, issueId: issue.id, input: emptyField, parentId, to, rerun: inTmux(ctx) ? 0 : 1 } } });
}

/** b: send finished work back with a note, or (an agent blocked on a question) answer it and run it again */
function sendBack(ctx: Ctx, issue: Issue): void {
  const ask = threadAsk(myThread(ctx.state.data!, issue.id));
  openNote(ctx, ask === 'blocked' ? 'answer' : 'sendBack', issue);
}

/** m: a comment; on a mention it is the reply */
function comment(ctx: Ctx, issue: Issue): void {
  const need = needOf(ctx.state, issue.id, ctx.now());
  if (need?.row.kind === 'mention') {
    const c = need.row.commentId ? ctx.state.data!.comments.find(x => x.id === need.row.commentId) : undefined;
    const to = ctx.state.data!.userById.get(c?.userId ?? need.row.actorId ?? '')?.name.split(/\s+/)[0] ?? null;
    return openNote(ctx, 'reply', issue, c ? c.parentId ?? c.id : null, to);
  }
  openNote(ctx, 'comment', issue);
}

async function submitNote(ctx: Ctx, sheet: Extract<Sheet, { type: 'note' }>): Promise<unknown> {
  const s = ctx.state, data = s.data!;
  const issue = data.issueById.get(sheet.issueId);
  if (!issue) return ctx.dispatch({ type: 'closeOverlay' });
  const key = data.keyOf(issue);
  const text = sheet.input.value.trim();
  if (!text) return toast(ctx.dispatch, 'error', sheet.purpose === 'answer' ? 'Type your answer first, or esc to cancel' : 'Type a note first, or esc to cancel');
  ctx.dispatch({ type: 'closeOverlay' });
  const closed: Ctx = { ...ctx, state: { ...s, overlay: { kind: 'none' } } };
  const post = async () => { await ctx.bl.addComment(issue.id, ctx.actorId, text, sheet.parentId); };
  const need = needOf(s, issue.id, ctx.now());
  switch (sheet.purpose) {
    case 'comment':
      // a comment on something that asked you (a mention, a reply) answers it
      if (need && need.row.kind !== 'review' && need.row.kind !== 'blocked') return decide(closed, issue, { run: post, text: () => `Commented on ${key}` });
      return write(closed, { run: post, ok: () => `Commented on ${key}` });
    case 'reply':
      return decide(closed, issue, { run: post, text: () => `Replied on ${key}${sheet.to ? ` to ${sheet.to}` : ''}` });
    case 'sendBack': {
      const st = workingState(data, issue.teamId);
      const step = st && st.id !== issue.stateId ? { field: 'state' as const, patch: { stateId: st.id } } : undefined;
      return decide(closed, issue, { change: step, run: post, text: () => `${key} sent back${step ? ` to ${st!.name}` : ''}, with your note` });
    }
    case 'answer': {
      const how = RERUN_CHOICES[sheet.rerun] ?? 'comment';
      let rerun: { ok: boolean; message: string } | null = null;
      return decide(closed, issue, {
        run: async () => {
          await post();
          if (how !== 'comment') rerun = await startAgent(closed, issue, how, text);
        },
        text: () => {
          const r = rerun as { ok: boolean; message: string } | null;
          return r ? (r.ok ? `Answered ${key}; ${r.message}` : `Answered ${key}, but the agent didn't start: ${r.message}`) : `Answered ${key} in a comment`;
        },
      });
    }
  }
}

/** f: the follow-ups the agent noted, to tick and file */
function openFollowups(ctx: Ctx, issue: Issue): void {
  const drafts = followupsOf(ctx.state.data!, issue.id);
  if (!drafts.length) return toast(ctx.dispatch, 'info', `The agent noted no follow-ups on ${ctx.state.data!.keyOf(issue)}`);
  // the first is ticked, so f enter files it and closes the issue (the mockup's "file one follow-up")
  ctx.dispatch({ type: 'openOverlay', overlay: { kind: 'sheet', sheet: { type: 'followups', issueId: issue.id, ids: drafts.map(d => d.id), ticked: [drafts[0]!.id], cursor: 0 } } });
}

/** enter on the follow-ups sheet: file the ticked drafts (the create-from-draft path agents use), then Done */
async function fileFollowups(ctx: Ctx, sheet: Extract<Sheet, { type: 'followups' }>): Promise<unknown> {
  const data = ctx.state.data!;
  const issue = data.issueById.get(sheet.issueId);
  if (!issue) return ctx.dispatch({ type: 'closeOverlay' });
  ctx.dispatch({ type: 'closeOverlay' });
  const drafts = data.drafts.filter(d => sheet.ticked.includes(d.id));
  const key = data.keyOf(issue);
  return decide({ ...ctx, state: { ...ctx.state, overlay: { kind: 'none' } } }, issue, {
    change: doneStep(data, issue),
    run: async () => {
      const filed: string[] = [];
      for (const d of drafts) {
        const r = await ctx.bl.createAgentIssue({ session: null, teamId: d.teamId, draftId: d.id }, ctx.actorId);
        filed.push(data.keyOf(r.issue));
      }
      return filed.length ? ` · ${filed.length} follow-up${filed.length === 1 ? '' : 's'} filed as ${filed.join(', ')}` : '';
    },
    text: extra => `${key} Done${extra}`,
  });
}

async function markRead(ctx: Ctx, issue: Issue): Promise<unknown> {
  const key = ctx.state.data!.keyOf(issue);
  if (!needOf(ctx.state, issue.id, ctx.now())) return toast(ctx.dispatch, 'info', `Nothing about ${key} is waiting on you`);
  return decide(ctx, issue, { text: () => `${key} marked read` });
}

// ---------- starting work ----------

/** enter on Up next: the start sheet, with the branch it will use */
function openStart(ctx: Ctx, issue: Issue): void {
  const s = ctx.state;
  const cwd = agentWhere(issue, s.data!).cwd;
  const cursor = inTmux(ctx) ? 0 : 1;
  const sheet = (h: Handoff | undefined): Sheet => ({ type: 'start', issueId: issue.id, cursor, branch: h ? { name: h.branchName, exists: !!branchExists(cwd, h.branchName) } : null });
  ctx.dispatch({ type: 'openOverlay', overlay: { kind: 'sheet', sheet: sheet(s.handoffs[issue.id]) } });
  if (!s.handoffs[issue.id]) {
    void handoff(ctx, issue, true).then(h => { if (h) ctx.dispatch({ type: 'setSheet', sheet: sheet(h) }); });
  }
}

/** the start sheet's choice: start the issue the way `baseline work` does (start_issue: In Progress, yours, its
 *  branch checked out), then the agent in a pane, here, the prompt copied, or nothing more */
async function startFromSheet(ctx: Ctx, sheet: Extract<Sheet, { type: 'start' }>, index: number): Promise<unknown> {
  const data = ctx.state.data!;
  const issue = data.issueById.get(sheet.issueId);
  if (!issue) return ctx.dispatch({ type: 'closeOverlay' });
  const choice = START_CHOICES[index];
  if (!choice) return;
  if (choice === 'pane' && !inTmux(ctx)) return toast(ctx.dispatch, 'info', 'A new pane needs tmux. Run baseline inside tmux, or pick 2 to run it here.');
  ctx.dispatch({ type: 'closeOverlay' });
  const closed: Ctx = { ...ctx, state: { ...ctx.state, overlay: { kind: 'none' } } };
  const key = data.keyOf(issue);
  const cwd = agentWhere(issue, data).cwd;
  const opCtx: OpContext = { bl: ctx.bl, actor: { kind: 'person' }, session: null, surface: 'cli', local: (ctx.repo ?? localRepo)(cwd) };
  const end = ctx.beginWrite();
  let out: Awaited<ReturnType<typeof startIssue.run>>;
  try {
    out = await runOp(startIssue, opCtx, { issue: key });
  } catch (e) {
    end();
    toast(ctx.dispatch, 'error', errorText(e));
    return ctx.refresh();
  }
  end();
  const git = out.git.status === 'manual' ? `branch ${out.branch}: ${out.git.note ?? `run ${out.git.command}`}` : `on ${out.branch}`;
  const started = `${out.already_started ? `${key} was started already` : `Started ${key}`} (${out.state}, ${git})`;
  await ctx.refresh();
  if (choice === 'copy') {
    const h = await handoff(closed, issue);
    if (h) { ctx.terminal(osc52(h.prompt)); ctx.clipboard(h.prompt); }
    return toast(ctx.dispatch, 'ok', `${started}; prompt copied`);
  }
  if (choice === 'none') return toast(ctx.dispatch, 'ok', started);
  const r = await startAgent(closed, issue, choice);
  toast(ctx.dispatch, r.ok ? 'ok' : 'error', r.ok ? `${started}; ${r.message}` : `${started}, but ${r.message}`);
  if (choice === 'here') await ctx.refresh();
}

// ---------- / ----------

/** what `/` is about: the issue under the cursor, its menu context, and the team a new issue would go to */
export function findCtx(s: TuiState, now: number) {
  const issue = targetIssue(s, now);
  const data = s.data!;
  const team = data.teamById.get(newDraft(s, data).teamId);
  return { issue, mc: issue ? menuCtxFor(s, issue.id, now) : undefined, team };
}

export const findSections = (s: TuiState, query: string, now: number) => {
  const f = findCtx(s, now);
  return findResults(query, s, s.data!, f.issue, f.mc, now, f.team);
};

async function runFind(ctx: Ctx, item: FindItem): Promise<unknown> {
  const s = ctx.state, data = s.data!, d = ctx.dispatch;
  const closed = { ...ctx, state: { ...s, overlay: { kind: 'none' } as const } };
  d({ type: 'closeOverlay' });
  const run = item.run;
  if ('route' in run) return d({ type: run.route.kind === 'issue' || run.route.kind === 'project' ? 'navigate' : 'switchView', route: run.route });
  if ('view' in run) return d({ type: 'setView', ...run.view });
  if ('command' in run) return runCommand(run.command, closed, '');
  if ('markAllRead' in run) return markAllRead(closed);
  if ('create' in run) {
    const draft = newDraft(s, data);
    return write(closed, {
      run: () => ctx.bl.createIssue({ teamId: draft.teamId, title: run.create, stateId: draft.stateId || undefined, priority: draft.priority, assigneeId: draft.assigneeId, projectId: draft.projectId }, ctx.actorId),
      ok: issue => `Created ${data.teamById.get(issue.teamId)?.key ?? 'ISS'}-${issue.number}  ${issue.title}`,
      after: issue => d({ type: 'select', issueId: issue.id }),
    });
  }
  const issue = findCtx(s, ctx.now()).issue;
  return issue ? change(closed, issue, run.change.field, run.change.patch) : undefined;
}

async function markAllRead(ctx: Ctx): Promise<unknown> {
  const n = notificationRows(ctx.state.data!, ctx.now()).filter(i => i.unread).length;
  if (!n) return toast(ctx.dispatch, 'info', 'Nothing unread');
  const end = ctx.beginWrite();
  ctx.dispatch({ type: 'markRead', ids: 'all', read: true });
  try {
    await ctx.bl.markAllNotificationsRead();
    toast(ctx.dispatch, 'ok', `Marked ${n} notification${n === 1 ? '' : 's'} read`);
  } catch (e) { toast(ctx.dispatch, 'error', errorText(e)); } finally { end(); }
  return ctx.refresh();
}

/** the standup text, the same `baseline standup` prints */
async function openStandup(ctx: Ctx): Promise<void> {
  ctx.dispatch({ type: 'openOverlay', overlay: { kind: 'sheet', sheet: { type: 'standup', text: null, error: null } } });
  try {
    const out = await runOp(myActivity, { bl: ctx.bl, actor: { kind: 'person' }, session: null, surface: 'cli' }, {});
    ctx.dispatch({ type: 'setSheet', sheet: { type: 'standup', text: myActivity.text(out, 'cli'), error: null } });
  } catch (e) {
    ctx.dispatch({ type: 'setSheet', sheet: { type: 'standup', text: null, error: errorText(e) } });
  }
}

// ---------- overlays ----------

function applyPicker(ctx: Ctx): Promise<unknown> | void {
  const s = ctx.state, data = s.data!;
  const o = s.overlay;
  if (o.kind !== 'picker') return;
  const chosen = filteredOptions(o, data)[o.cursor]?.option;
  const issue = data.issueById.get(o.issueId);
  if (!issue) return ctx.dispatch({ type: 'closeOverlay' });
  ctx.dispatch({ type: 'closeOverlay' });
  if (o.field === 'labels') {
    if ([...o.selected].sort().join() === [...issue.labelIds].sort().join()) return;
    return change(ctx, issue, 'labels', { labelIds: o.selected });
  }
  if (!chosen || chosen.current) return;
  switch (o.field) {
    case 'state': return change(ctx, issue, 'state', { stateId: chosen.id });
    case 'priority': return change(ctx, issue, 'priority', { priority: Number(chosen.id) as Priority });
    case 'assignee': return change(ctx, issue, 'assignee', { assigneeId: chosen.id === NONE ? null : chosen.id });
    case 'project': return change(ctx, issue, 'project', { projectId: chosen.id === NONE ? null : chosen.id });
  }
}

async function acceptSheet(ctx: Ctx, sheet: Sheet): Promise<unknown> {
  const data = ctx.state.data!, now = ctx.now();
  switch (sheet.type) {
    case 'start': return startFromSheet(ctx, sheet, sheet.cursor);
    case 'note': return submitNote(ctx, sheet);
    case 'followups': return fileFollowups(ctx, sheet);
    case 'standup':
      ctx.dispatch({ type: 'closeOverlay' });
      return sheet.text ? copy(ctx, sheet.text, 'the standup') : undefined;
    case 'projects': {
      const p = projectRows(data)[sheet.cursor];
      return p ? ctx.dispatch({ type: 'navigate', route: { kind: 'project', projectId: p.id } }) : ctx.dispatch({ type: 'closeOverlay' });
    }
    case 'notifications': {
      const row = notificationRows(data, now)[sheet.cursor];
      if (!row) return ctx.dispatch({ type: 'closeOverlay' });
      if (row.issueId) return ctx.dispatch({ type: 'navigate', route: { kind: 'issue', issueId: row.issueId } });
      if (row.notification.projectId && data.projectById.has(row.notification.projectId)) return ctx.dispatch({ type: 'navigate', route: { kind: 'project', projectId: row.notification.projectId } });
      return toast(ctx.dispatch, 'info', row.body || 'Nothing to open for this notification');
    }
  }
}

async function accept(ctx: Ctx): Promise<unknown> {
  const s = ctx.state, data = s.data!, o = s.overlay;
  switch (o.kind) {
    case 'picker': return applyPicker(ctx);
    case 'find': {
      const item = findItems(findSections(s, o.query.value, ctx.now()))[o.cursor];
      return item ? runFind(ctx, item) : undefined;
    }
    case 'sheet': return acceptSheet(ctx, o.sheet);
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
      if (!text) return toast(ctx.dispatch, 'error', 'A title can\'t be empty');
      ctx.dispatch({ type: 'closeOverlay' });
      if (text === issue.title) return;
      return change(ctx, issue, 'title', { title: text });
    }
    case 'menu': return runMenuRow(ctx, null);
    default: return;
  }
}

function overlayCount(ctx: Ctx): number {
  const s = ctx.state, data = s.data!, o = s.overlay;
  switch (o.kind) {
    case 'picker': return filteredOptions(o, data).length;
    case 'find': return findItems(findSections(s, o.query.value, ctx.now())).length;
    case 'menu': return MENUS[o.path[o.path.length - 1]!].rows.length;
    case 'sheet': switch (o.sheet.type) {
      case 'start': return START_CHOICES.length;
      case 'followups': return o.sheet.ids.length;
      case 'projects': return projectRows(data).length;
      case 'notifications': return notificationRows(data, ctx.now()).length;
      default: return 0;
    }
    default: return 0;
  }
}

function move(ctx: Ctx, delta: number): void {
  const s = ctx.state;
  if (s.route.kind === 'issue') return ctx.dispatch({ type: 'scroll', delta, max: ctx.layout.detailMax, from: ctx.layout.detailStart });
  ctx.dispatch({ type: 'move', delta, count: cursorIds(s, ctx.now()).length });
}

/** the rows a list draws, each with its cursor index, or null for a group header the cursor skips */
function drawnRows(s: TuiState, now: number): Array<number | null> {
  if (!s.data) return [];
  if (!isListRoute(s.route)) return cursorIds(s, now).map((_, i) => i);
  let n = 0;
  return listRowsFor(s.route, s.data, listViewOf(s, s.route)).map(r => (isSelectable(r) ? n++ : null));
}

/** move by `delta` drawn rows: the issue page scrolls; a list's cursor lands on the nearest row it can rest on,
 *  first past the target, else before it */
function jump(ctx: Ctx, delta: number): void {
  const s = ctx.state;
  if (s.route.kind === 'issue') return ctx.dispatch({ type: 'scroll', delta, max: ctx.layout.detailMax, from: ctx.layout.detailStart });
  const rows = drawnRows(s, ctx.now());
  const count = rows.filter(r => r !== null).length;
  if (!count) return;
  const at = rows.indexOf(Math.min(s.cursor[routeKey(s.route)] ?? 0, count - 1));
  const target = Math.max(0, Math.min(rows.length - 1, at + delta));
  const ahead = delta > 0 ? rows.slice(target) : rows.slice(0, target + 1).reverse();
  const behind = delta > 0 ? rows.slice(0, target).reverse() : rows.slice(target + 1);
  const index = [...ahead, ...behind].find(r => r !== null);
  if (index != null) ctx.dispatch({ type: 'moveTo', index });
}

/** a page of the issue page keeps its last line on screen, so the eye has somewhere to continue from */
const pageOf = (ctx: Ctx) => (ctx.state.route.kind === 'issue' ? Math.max(1, ctx.layout.pageSize - 1) : ctx.layout.pageSize);

const toggleDone = (ctx: Ctx) => ctx.dispatch({ type: 'toggleGroup', groupId: DONE_GROUP });

/** enter on Today: go into the row, or take its next step */
function openToday(ctx: Ctx, row: TodayRow): unknown {
  const s = ctx.state, data = s.data!, d = ctx.dispatch, now = ctx.now();
  switch (row.kind) {
    case 'need': {
      const r = row.row;
      if (r.issue) return d({ type: 'openNeed', issueId: r.issue.id, at: now });
      if (r.kind === 'triage' && r.teamId) return d({ type: 'switchView', route: { kind: 'team', teamId: r.teamId } });
      return toast(d, 'info', r.text || 'Nothing to open for this one');
    }
    case 'flight': {
      const pane = s.panes[row.id];
      if (pane && focusPane(pane)) return toast(d, 'ok', `${data.keyOf(row.row.issue)}: switched to its tmux pane`);
      return d({ type: 'navigate', route: { kind: 'issue', issueId: row.id } });
    }
    case 'next': return openStart(ctx, row.row.issue);
    case 'doneHeader': return toggleDone(ctx);
    case 'done': return d({ type: 'navigate', route: { kind: 'issue', issueId: row.id } });
  }
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
    case 'backOrQuit': return s.stack.length || s.route.kind !== 'today' ? d({ type: 'back' }) : ctx.exit();
    case 'back': return d({ type: 'back' });
    case 'help': return d({ type: 'openOverlay', overlay: { kind: 'help', scroll: 0 } });
    case 'search': return d({ type: 'openOverlay', overlay: { kind: 'find', query: emptyField, cursor: 0 } });
    case 'create':
      if (!data.teams.length) return toast(d, 'error', 'This workspace has no teams to file an issue in');
      return d({ type: 'openOverlay', overlay: { kind: 'compose', target: 'issue', field: 'title', input: emptyField, draft: newDraft(s, data) } });
    case 'tab': {
      const tab = ctx.layout.tabs[Number(key) - 1];
      return tab ? d({ type: 'switchView', route: tab.route }) : undefined;
    }
    case 'undo': return undo(ctx);
    case 'down': return move(ctx, 1);
    case 'up': return move(ctx, -1);
    case 'pageDown': return jump(ctx, pageOf(ctx));
    case 'pageUp': return jump(ctx, -pageOf(ctx));
    case 'halfDown': return jump(ctx, Math.max(1, Math.floor(ctx.layout.pageSize / 2)));
    case 'halfUp': return jump(ctx, -Math.max(1, Math.floor(ctx.layout.pageSize / 2)));
    case 'top': return jump(ctx, -Infinity);
    case 'bottom': return jump(ctx, Infinity);
    case 'actions': {
      const row = cursorRow(s);
      if (row?.kind === 'group') return d({ type: 'toggleGroup', groupId: row.group.id });
      if (s.route.kind === 'today' && todayRow(s, now)?.kind === 'doneHeader') return toggleDone(ctx);
      return openMenu(ctx, 'actions');
    }
    case 'editMenu': case 'agentMenu': case 'copyMenu': return openMenu(ctx, SUBMENU[cmd]!);
    case 'menuKey': return runMenuRow(ctx, key);
    case 'overlayBack': return d({ type: 'menuBack' });

    case 'open': {
      if (s.route.kind === 'today') {
        const row = todayRow(s, now);
        return row ? openToday(ctx, row) : undefined;
      }
      const id = cursorIds(s, now)[s.cursor[routeKey(s.route)] ?? 0];
      if (!id || !isListRoute(s.route)) return;
      const row = listRowsFor(s.route, data, listViewOf(s, s.route)).find(r => r.id === id);
      if (row?.kind === 'group') return d({ type: 'toggleGroup', groupId: row.group.id });
      return d({ type: 'navigate', route: { kind: 'issue', issueId: id } });
    }

    case 'done': return needIssue(i => markDone(ctx, i));
    case 'sendBack': return needIssue(i => sendBack(ctx, i));
    case 'followups': return needIssue(i => openFollowups(ctx, i));
    case 'markRead': return needIssue(i => markRead(ctx, i));

    case 'setState': return openPicker(ctx, 'state');
    case 'setPriority': return openPicker(ctx, 'priority');
    case 'setAssignee': return openPicker(ctx, 'assignee');
    case 'setLabels': return openPicker(ctx, 'labels');
    case 'setProject': return openPicker(ctx, 'project');
    case 'comment': return needIssue(i => comment(ctx, i));
    case 'editTitle': return needIssue(i => d({ type: 'openOverlay', overlay: { kind: 'compose', target: 'title', issueId: i.id, input: fieldOf(i.title) } }));
    case 'editDescription': return needIssue(async i => {
      let result: ReturnType<typeof editInEditor> = { text: null, error: null };
      await ctx.suspend(() => { result = editInEditor(i.description, data.keyOf(i)); });
      if (result.error) return toast(d, 'error', result.error);
      const text = result.text?.replace(/\s+$/, '') ?? null;
      if (text === null || text === i.description.replace(/\s+$/, '')) return toast(d, 'info', 'Description unchanged');
      return change(ctx, i, 'description', { description: text });
    });

    case 'copyKey': return needIssue(i => copy(ctx, data.keyOf(i), data.keyOf(i)));
    case 'copyUrl': return needIssue(async i => { const h = await handoff(ctx, i); if (h) copy(ctx, h.url, h.url); });
    case 'copyBranch': return needIssue(async i => { const h = await handoff(ctx, i); if (h) copy(ctx, h.branchName, `branch ${h.branchName}`); });
    case 'copyPrompt': return needIssue(async i => { const h = await handoff(ctx, i); if (h) copy(ctx, h.prompt, `agent prompt for ${h.key}`); });
    case 'openBrowser': return needIssue(async i => {
      const pr = prOf(data, i.id);
      if (pr) {
        openBrowser(pr.url);
        return toast(d, 'ok', `Opened ${data.keyOf(i)}'s PR #${pr.number} in the browser`);
      }
      const h = await handoff(ctx, i);
      if (!h) return;
      openBrowser(h.url);
      toast(d, 'ok', `Opened ${h.key} in the browser${ctx.bl.target.kind === 'local' ? ' (needs `baseline serve` running)' : ''}`);
    });
    case 'agentHere': return needIssue(i => agentCommandRun(ctx, i, 'here'));
    case 'agentPane': return needIssue(i => agentCommandRun(ctx, i, 'pane'));

    case 'standup': return openStandup(ctx);
    case 'projects': return d({ type: 'openOverlay', overlay: { kind: 'sheet', sheet: { type: 'projects', cursor: 0 } } });
    case 'notifications': return d({ type: 'openOverlay', overlay: { kind: 'sheet', sheet: { type: 'notifications', cursor: 0 } } });

    case 'overlayDown': case 'overlayUp': {
      const delta = cmd === 'overlayDown' ? 1 : -1;
      if (s.overlay.kind === 'help') return d({ type: 'helpScroll', delta, max: ctx.layout.helpMax });
      return d({ type: 'overlayMove', delta, count: overlayCount(ctx) });
    }
    case 'overlayPageDown': case 'overlayPageUp': case 'overlayTop': case 'overlayBottom': {
      const page = cmd === 'overlayTop' || cmd === 'overlayBottom' ? Infinity : Math.max(1, ctx.layout.overlayPage);
      const delta = cmd === 'overlayPageDown' || cmd === 'overlayBottom' ? page : -page;
      if (s.overlay.kind === 'help') return d({ type: 'helpScroll', delta, max: ctx.layout.helpMax });
      return d({ type: 'overlayMove', delta, count: overlayCount(ctx), clamp: true });
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

    case 'sheetPick': {
      const o = s.overlay;
      if (o.kind !== 'sheet' || o.sheet.type !== 'start') return;
      const n = Number(key) - 1;
      return startFromSheet(ctx, o.sheet, n);
    }
    case 'sheetToggle': {
      const o = s.overlay;
      if (o.kind !== 'sheet' || o.sheet.type !== 'followups') return;
      const id = o.sheet.ids[o.sheet.cursor];
      if (!id) return;
      const ticked = o.sheet.ticked.includes(id) ? o.sheet.ticked.filter(x => x !== id) : [...o.sheet.ticked, id];
      return d({ type: 'setSheet', sheet: { ...o.sheet, ticked } });
    }
    case 'sheetRerun': {
      const o = s.overlay;
      if (o.kind !== 'sheet' || o.sheet.type !== 'note') return;
      // without tmux there is no new pane to run it in
      const order = inTmux(ctx) ? [0, 1, 2] : [1, 2];
      const at = order.indexOf(o.sheet.rerun);
      return d({ type: 'setSheet', sheet: { ...o.sheet, rerun: order[(at + 1) % order.length]! } });
    }
    case 'sheetEditor': {
      const o = s.overlay;
      if (o.kind !== 'sheet' || o.sheet.type !== 'note') return;
      const sheet = o.sheet;
      const i = data.issueById.get(sheet.issueId);
      let result: ReturnType<typeof editInEditor> = { text: null, error: null };
      await ctx.suspend(() => { result = editInEditor(sheet.input.value, i ? data.keyOf(i) : 'note'); });
      if (result.error) return toast(d, 'error', result.error);
      const text = result.text?.replace(/\s+$/, '');
      return text === undefined ? undefined : d({ type: 'setSheet', sheet: { ...sheet, input: fieldOf(text) } });
    }
    case 'sheetCopy': {
      const o = s.overlay;
      if (o.kind !== 'sheet' || o.sheet.type !== 'standup' || !o.sheet.text) return;
      return copy(ctx, o.sheet.text, 'the standup');
    }
  }
}
