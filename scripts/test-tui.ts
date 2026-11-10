// The terminal UI: its pure view-model, reducer, keymap, menus and / results, and end-to-end runs of the
// real App rendered by Ink against a scratch database, every write read back through a fresh client.
// Runs against a throwaway local database under $TMPDIR and never touches ~/.baseline.
//
//   npm run test:tui
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink';
import { createElement } from 'react';
import { connect } from '../src/client/index.js';
import { openDb } from '../src/core/db.js';
import { seedWorkspace } from '../src/core/seed.js';
import type { Issue, WorkflowStateType } from '../src/core/types.js';
import { App } from '../src/tui/App.js';
import { buildData, fetchData, type TuiData } from '../src/tui/data.js';
import { BINDINGS, contextsFor, hintsFor, lookup, takesText, type Context } from '../src/tui/keys.js';
import { helpSections, MENUS, menuTrail, rowLabel } from '../src/tui/menus.js';
import { agentCommand, agentEnv, paneCommand, shellPreview } from '../src/tui/launch.js';
import { findSections } from '../src/tui/commands.js';
import { findItems, wordMatch } from '../src/tui/find.js';
import { prepareStart } from '../src/tui/index.js';
import { paneLines } from '../src/tui/detail.js';
import { readPanes, rememberPane, sessionPath, sessionWriter, targetId, workspaceDir, type SessionFile } from '../src/tui/session.js';
import {
  CLOSED_TYPES, DEFAULT_VIEW, defaultExpanded, displayWidth, GROUP_BYS, notificationRows, listRowsFor, listGroups, fuzzyFilter, fuzzyMatch, groupIssues, issuesForRoute, lineWidth, listRows,
  markdownLines, selectableIds, sortIssues, statusGroupOf, truncate, wrap,
} from '../src/tui/model.js';
import { cycleDraft, newDraft, pickerOptions } from '../src/tui/overlays.js';
import { nextIssue } from '../src/ops/index.js';
import { runOp } from '../src/ops/operation.js';
import { agentAsk, DONE_GROUP, followupsOf, issueNeeds, paneStarting, prOf, todayModel, todayRows } from '../src/tui/today.js';
import { seedMorning } from './tui-fixture.js';
import { cursorRow, initialState, listViewOf, reducer, routeKey, type Action, type TuiState } from '../src/tui/state.js';
import { editField, emptyField, fieldOf } from '../src/tui/textfield.js';

const work = mkdtempSync(join(tmpdir(), 'baseline-tui-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
// the TUI's state files go under $HOME/.baseline/tui; never the real one
const home = join(work, 'home');
process.env.HOME = home;
delete process.env.BASELINE_TUI_STATE_DIR;
const dbPath = join(work, 'tui.db');
const seedDb = openDb(dbPath);
seedWorkspace(seedDb);
seedDb.close();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};
const run = (s: TuiState, ...actions: Action[]) => actions.reduce(reducer, s);

const bl = await connect({ db: dbPath });
const data = await fetchData(bl);
const now = Date.now();
const typeOf = (i: Issue) => data.stateById.get(i.stateId)!.type;
/** the list most tests run on: the first team's */
const TEAM = { kind: 'team' as const, teamId: data.teams[0]!.id };
const TEAM_KEY = `team:${data.teams[0]!.id}`;

{
  const base = data.issues[0];
  const fake = ([1, 0, 4, 2, 3] as const).map((priority, n) => ({ ...base, id: `x${n}`, number: 900 + n, priority, sortOrder: n }));
  check('sortIssues: urgent, high, medium, low, then no priority', sortIssues(fake).map(i => i.priority).join() === '1,2,3,4,0', sortIssues(fake).map(i => i.priority).join());

  const mine = issuesForRoute(TEAM, data);
  check('a team list holds exactly that team\'s issues', mine.length > 0 && mine.every(i => i.teamId === TEAM.teamId));
  const groups = groupIssues(mine, data);
  const order = groups.map(g => g.key as WorkflowStateType);
  check('groups follow Linear order: In Progress before Todo before Backlog, closed last',
    order.indexOf('started') < order.indexOf('unstarted') && order.indexOf('unstarted') < order.indexOf('backlog') && order.slice(-2).every(t => CLOSED_TYPES.has(t)), order.join());
  check('every issue lands in the group of its state type (In Review apart)', groups.every(g => g.issues.every(i => statusGroupOf(data.stateById.get(i.stateId)) === g.key)));
  check('status group headers carry the state color', groups.every(g => g.issues.length > 0 && /^#/.test(g.icon[0]?.color ?? '')));
  for (const by of GROUP_BYS) {
    const gs = groupIssues(mine, data, by);
    const all = gs.flatMap(g => g.issues.map(i => i.id));
    if (new Set(all).size !== mine.length || all.length !== mine.length) check(`grouping by ${by} keeps every issue exactly once`, false);
  }
  check('every grouping keeps every issue exactly once', true);
  const byPriority = groupIssues(mine, data, 'priority').map(g => g.label);
  check('by priority: Urgent first, No priority last', byPriority[0] === 'Urgent' && (byPriority.includes('No priority') ? byPriority[byPriority.length - 1] === 'No priority' : true), byPriority.join());
  const byAssignee = groupIssues(data.issues, data, 'assignee').map(g => g.label);
  check('by assignee: me first, No assignee last', byAssignee[0].endsWith('(me)') && byAssignee[byAssignee.length - 1] === 'No assignee', byAssignee.join());
  check('no grouping: one group, no header rows', listRows(groupIssues(mine, data, 'none'), defaultExpanded).every(r => r.kind === 'issue'));
  const active = listRowsFor(TEAM, data, { ...DEFAULT_VIEW, preset: 'active' }).filter(r => r.kind === 'issue');
  check('the Active preset shows only started and unstarted issues', active.length > 0 && active.every(r => r.kind === 'issue' && ['started', 'unstarted'].includes(typeOf(r.issue))));

  const rows = listRows(groups, defaultExpanded);
  const doneRow = rows.find(r => r.kind === 'group' && r.group.key === 'completed');
  check('Done starts collapsed: its header shows, its issues do not', !!doneRow && !rows.some(r => r.kind === 'issue' && typeOf(r.issue) === 'completed'));
  const open = listRows(groups, () => true);
  check('expanding shows the closed issues', open.some(r => r.kind === 'issue' && typeOf(r.issue) === 'completed'));
  const ids = selectableIds(TEAM, data, DEFAULT_VIEW, now);
  check('the cursor skips open group headers but stops on collapsed ones', !ids.includes('group:status:started') && ids.includes('group:status:completed'));

  check('fuzzy: a subsequence matches across words', !!fuzzyMatch('cmdk', 'Cmd+K fuzzy search scoring'));
  check('fuzzy: letters out of order don\'t match', fuzzyMatch('zq', 'Cmd+K fuzzy search scoring') === null);
  const ranked = fuzzyFilter(['Persist theme choice per device', 'Theme switching without reload', 'Audit color tokens for both themes'], 'theme', t => t);
  check('fuzzy: an early word-start match ranks first', ranked[0]?.item === 'Theme switching without reload', ranked.map(r => r.item).join(' | '));
  check('fuzzy: the key is searchable ("core4" finds CORE-4)', !!fuzzyMatch('core4', 'CORE-4 Cmd+K fuzzy search scoring'));

  check('truncate ends in an ellipsis inside the width', truncate('Theme switching without reload', 10) === 'Theme swi…');
  check('wide characters count as two cells', displayWidth('漢字ab') === 6 && displayWidth(truncate('漢字漢字漢字', 5)) <= 5);
  check('emoji outside the old ranges count as two cells, as Ink draws them', displayWidth('🚀') === 2 && displayWidth('✅ done') === 7);
  const family = '👨‍👩‍👧';
  check('truncate never splits a joined emoji', truncate(`${family}${family}${family}`, 4) === `${family}…`);
  check('wrapped emoji text never runs past the line', wrap('Ship 🚀🚀🚀 rocket 日本語のタイトル 🚀🚀', 7).every(l => lineWidth(l) <= 7));
  const text = 'One CLI covering the whole store so coding agents never need the UI, with a verylongunbreakablewordthatmustbesplit.';
  check('wrap never exceeds the width', [12, 20, 33].every(w => wrap(text, w).every(l => lineWidth(l) <= w)));

  const md = markdownLines('# Plan\n\n- first `code`\n- [x] done\n\n| a | bb |\n| --- | --- |\n| 1 | 2 |\n\n```\nconst x = 1;\n```', 40);
  check('markdown: headings are bold', md[0].every(s => s.bold) && md[0].map(s => s.text).join('') === 'Plan');
  check('markdown: bullets and task items get glyphs', md.some(l => l[0]?.text.startsWith('• ')) && md.some(l => l[0]?.text.includes('☑')));
  check('markdown: tables align their columns', md.some(l => l.map(s => s.text).join('') === 'a │ bb') && md.some(l => l.map(s => s.text).join('') === '1 │ 2 '));
  check('markdown: fenced code is dim', md.some(l => l[0]?.dim && l[0].text.includes('const x = 1;')));
}

// ---------- Today, on a workspace where the morning has happened ----------
const morningPath = join(work, 'morning.db');
{ const db = openDb(morningPath); seedWorkspace(db); db.close(); }
const morning = await seedMorning(morningPath);
const mbl = await connect({ db: morningPath });
const mdata = await fetchData(mbl);
{
  const m = todayModel(mdata, now);
  const key = (id: string) => mdata.keyOf(mdata.issueById.get(id)!);
  const needIds = m.needs.map(r => r.id);
  check('Needs you is one row per issue, even with several notifications about one', new Set(needIds).size === needIds.length && (m.needs.find(r => r.id === morning.review)?.notificationIds.length ?? 0) >= 2,
    m.needs.map(r => `${r.id}:${r.notificationIds.length}`).join(' '));
  const kinds = Object.fromEntries(m.needs.map(r => [r.id, r.kind]));
  check('an agent that finished reads as review, a blocked one as blocked, a mention as mention', kinds[morning.review] === 'review' && kinds[morning.blocked] === 'blocked' && kinds[morning.mention] === 'mention', JSON.stringify(kinds));
  check('a review row carries the agent\'s finished work', m.needs.find(r => r.id === morning.review)?.thread?.state.status === 'finished');
  check('a mention row knows the comment that mentions you', m.needs.find(r => r.id === morning.mention)?.commentId === morning.mentionCommentId);
  check('triage on a team you lead is one row in Needs you', m.needs.some(r => r.kind === 'triage' && r.count > 0));
  const flightIds = m.flight.map(r => r.id);
  check('In flight leaves out what needs you (CORE-1 is started but asked about)', !flightIds.some(id => needIds.includes(id)) && !flightIds.includes(morning.mention));
  const w = m.flight.find(r => r.id === morning.working);
  check('In flight shows an agent at work with what it did and has left', !!w?.thread && w.thread.progress.did === 'list --json' && w.thread.progress.left === 'search flags');
  check('In flight shows my own started work without an agent as mine', m.flight.some(r => !r.thread));
  const op = await runOp(nextIssue, { bl: mbl, actor: { kind: 'person' }, session: null, surface: 'cli' }, { limit: 10 });
  const started = new Set(mdata.issues.filter(i => mdata.stateById.get(i.stateId)?.type === 'started').map(i => mdata.keyOf(i)));
  const expected = op.issues.map(i => i.key).filter(k => !started.has(k) && !needIds.some(id => mdata.issueById.get(id) && key(id) === k)).slice(0, 3);
  check('Up next is next_issue\'s own order, without what is started or needs you', m.next.map(r => key(r.id)).join() === expected.join(), `${m.next.map(r => key(r.id)).join()} vs ${expected.join()}`);
  check('every Up next row says why it is there', m.next.every(r => r.reason.length > 0));
  check('Done this week holds what I closed in the last seven days, folded', m.done.length > 0 && todayRows(m, false).some(r => r.id === DONE_GROUP) && !todayRows(m, false).some(r => r.kind === 'done'));
  const rows = todayRows(m, true);
  check('Today\'s row ids never repeat, so the cursor can follow an issue', new Set(rows.map(r => r.id)).size === rows.length);
  check('the PR and the follow-up drafts are in the TUI\'s data', prOf(mdata, morning.review)?.number === 41 && followupsOf(mdata, morning.review).length === 2);
}

{
  const dir = join(work, 'panes');
  rememberPane('db:/x', 'i1', { id: '%3', at: '2026-01-01T00:00:00Z' }, { server: '/tmp/tmux-1/default,111', dir });
  check('a remembered pane belongs to its tmux server: another server (whose %3 is some other pane) sees none, and outside tmux there are none',
    readPanes('db:/x', { server: '/tmp/tmux-1/default,111', dir }).i1?.id === '%3' && !readPanes('db:/x', { server: '/tmp/tmux-1/default,222', dir }).i1 && !Object.keys(readPanes('db:/x', { server: null, dir })).length);
  check('a pane that is gone is dropped when the TUI starts', !readPanes('db:/x', { server: '/tmp/tmux-1/default,111', dir, alive: () => false }).i1);
  rememberPane('db:/x', 'i1', null, { server: '/tmp/tmux-1/default,111', dir });
  check('…and forgetting one removes it', !readPanes('db:/x', { server: '/tmp/tmux-1/default,111', dir }).i1);
  const t = mdata.threads.get(morning.working)!.slice(-1)[0]!;
  check('an agent in a pane reads as starting only until its thread moves', paneStarting(mdata, morning.working, { id: '%1', at: new Date(Date.parse(t.updatedAt) + 1000).toISOString() }) &&
    !paneStarting(mdata, morning.working, { id: '%1', at: new Date(Date.parse(t.updatedAt) - 1000).toISOString() }));
  const review = mdata.issueById.get(morning.review)!;
  const progress = mdata.states.find(x => x.teamId === review.teamId && x.name === 'In Progress')!;
  check('finished work asks for a review only while it waits In Review: sent back, it asks nothing', agentAsk(mdata, review)?.ask === 'review' && agentAsk(mdata, { ...review, stateId: progress.id }) === null);
  const st = run(initialState(), { type: 'loaded', data: mdata, at: now }, { type: 'navigate', route: { kind: 'issue', issueId: morning.blocked } });
  check('the page\'s keys follow the threads the page shows (loaded for it), not only Today\'s', contextsFor(st)[0] === 'blocked' &&
    contextsFor(run(st, { type: 'threads', issueId: morning.blocked, threads: [] }))[0] === 'detail');
}

// ---------- the reducer's side of the morning: opening what needs you, deciding, moving on ----------
{
  const st = run(initialState(), { type: 'loaded', data: mdata, at: now });
  const needs = issueNeeds(mdata, now);
  const reviewIdx = needs.findIndex(r => r.issue.id === morning.review);
  const opened = run(st, { type: 'openNeed', issueId: morning.review, at: now });
  check('enter on a Needs you row opens its issue page, counted as needs you, with Today behind it', opened.route.kind === 'issue' && opened.route.needs === true && opened.stack.map(r => r.kind).join() === 'today');
  check('…a review page, whose footer is the decision keys d b f', contextsFor(opened).join() === 'review,detail,global' && hintsFor(contextsFor(opened)).slice(0, 3).map(h => h.key).join(' ') === 'd b f', hintsFor(contextsFor(opened)).map(h => h.key).join(' '));
  const decided = run(opened, { type: 'markRead', ids: needs[reviewIdx]!.notificationIds, read: true }, { type: 'advance', index: reviewIdx, at: now });
  const left = issueNeeds(decided.data!, now);
  check('after a decision the page moves on to the item now in its place, Today still one esc away', left.length === needs.length - 1 && decided.route.kind === 'issue' && decided.route.issueId === left[Math.min(reviewIdx, left.length - 1)]!.issue.id && decided.stack.map(r => r.kind).join() === 'today');
  const mention = run(st, { type: 'openNeed', issueId: morning.mention, at: now });
  check('a mention opens at its comment with the reply sheet already open', mention.route.kind === 'issue' && mention.route.focusComment === morning.mentionCommentId &&
    mention.overlay.kind === 'sheet' && mention.overlay.sheet.type === 'note' && mention.overlay.sheet.purpose === 'reply' && mention.overlay.sheet.parentId === morning.mentionCommentId);
  const cleared = run(opened, { type: 'markRead', ids: 'all', read: true }, { type: 'advance', index: 0, at: now });
  check('when nothing needs you any more, a decision lands back on Today', cleared.route.kind === 'today' && cleared.stack.length === 0);
  const typed = run(mention, { type: 'editInput', input: fieldOf('Per account') });
  check('typing goes into the note sheet', typed.overlay.kind === 'sheet' && typed.overlay.sheet.type === 'note' && typed.overlay.sheet.input.value === 'Per account');
  check('esc closes a sheet without saving', run(typed, { type: 'closeOverlay' }).overlay.kind === 'none' && lookup(contextsFor(typed), 'esc')?.command === 'overlayCancel');
  check('a note sheet takes letters as text (d is not Done there)', takesText(typed) && lookup(contextsFor(typed), 'd') === undefined && lookup(contextsFor(typed), 'enter')?.command === 'overlayAccept');
  const start = run(st, { type: 'setSheet', sheet: { type: 'start', issueId: morning.review, cursor: 0, branch: null } }, { type: 'overlayMove', delta: -1, count: 4 });
  check('the start sheet moves over its four ways to start; 1-4 pick one', start.overlay.kind === 'sheet' && start.overlay.sheet.type === 'start' && start.overlay.sheet.cursor === 3 && lookup(contextsFor(start), '4')?.command === 'sheetPick');
  const team = { kind: 'team' as const, teamId: mdata.issueById.get(morning.review)!.teamId };
  const groups = listGroups(team, mdata, DEFAULT_VIEW);
  check('a team list shows In Review first, apart from In Progress', groups[0]?.label === 'In Review' && groups[0].issues.some(i => i.id === morning.review) && groups.some(g => g.label === 'In Progress'), groups.map(g => g.label).join());
  const notes = notificationRows(mdata, now);
  check('the notifications list is one row per issue (the old inbox repeated them)', new Set(notes.map(n => n.id)).size === notes.length && (notes.find(n => n.issueId === morning.review)?.count ?? 0) >= 2);
}

{
  const typed = 'hello world'.split('').reduce((f, ch) => editField(f, ch, ch)!, emptyField);
  check('typing inserts at the cursor', typed.value === 'hello world' && typed.cursor === 11);
  check('backspace deletes before the cursor', editField(typed, 'backspace', '')!.value === 'hello worl');
  check('ctrl+w deletes the previous word', editField(typed, 'ctrl+w', '')!.value === 'hello ');
  const mid = editField(editField(typed, 'home', '')!, 'right', '')!;
  check('home/right move the cursor; typing lands there', editField(mid, 'X', 'X')!.value === 'hXello world');
  check('a pasted string is inserted whole, newlines flattened', editField(fieldOf('a'), 'b\nc', 'b\nc')!.value === 'ab c');
  check('a command key is not an edit', editField(typed, 'enter', '') === null && editField(typed, 'ctrl+k', '') === null);
}

{
  const s0 = run(initialState(TEAM), { type: 'loaded', data, at: now });
  check('loading data marks the app ready', s0.status === 'ready' && s0.data === data && s0.syncedAt === now);
  check('the TUI opens on Today', initialState().route.kind === 'today');
  const issue = issuesForRoute(TEAM, data)[0];
  const s1 = run(s0, { type: 'navigate', route: { kind: 'issue', issueId: issue.id } });
  check('navigate pushes the previous route', s1.route.kind === 'issue' && s1.stack.length === 1 && s1.stack[0].kind === 'team');
  check('back pops it', run(s1, { type: 'back' }).route.kind === 'team' && run(s1, { type: 'back' }).stack.length === 0);
  check('esc on a team list goes to Today, and Today stays put: Today is never more than two presses away',
    run(s0, { type: 'back' }).route.kind === 'today' && run(s1, { type: 'back' }, { type: 'back' }).route.kind === 'today' && run(s0, { type: 'back' }, { type: 'back' }).route.kind === 'today');
  const team = data.teams[0];
  check('switching views clears the stack', run(s1, { type: 'switchView', route: { kind: 'team', teamId: team.id } }).stack.length === 0);

  const count = selectableIds(TEAM, data, DEFAULT_VIEW, now).length;
  const moved = run(s0, { type: 'move', delta: 3, count }, { type: 'move', delta: 999, count });
  check('moving clamps to the last row', moved.cursor[TEAM_KEY] === count - 1);
  check('moving up clamps to the first row', run(moved, { type: 'move', delta: -999, count }).cursor[TEAM_KEY] === 0);

  const at2 = run(s0, { type: 'move', delta: 2, count });
  const idAt2 = selectableIds(TEAM, data, DEFAULT_VIEW, now)[2];
  const urgent: Issue = { ...issue, id: 'i_new_urgent', number: 999, priority: 1, sortOrder: -1, stateId: data.issueById.get(idAt2)!.stateId };
  const grown: TuiData = buildData({ ...data, issues: [urgent, ...data.issues] });
  const after = run(at2, { type: 'loaded', data: grown, at: now + 1 });
  check('a refetch that inserts a row above keeps the cursor on the same issue', selectableIds(TEAM, grown, DEFAULT_VIEW, now)[after.cursor[TEAM_KEY]!] === idAt2);

  const gone = run(s1, { type: 'loaded', data: buildData({ ...data, issues: data.issues.filter(i => i.id !== issue.id) }), at: now + 2 });
  check('an open issue that disappears goes back with a note', gone.route.kind === 'team' && gone.toast?.tone === 'info');

  const picker = run(s0, { type: 'openOverlay', overlay: { kind: 'picker', field: 'state', issueId: issue.id, query: emptyField, cursor: 0, selected: [] } });
  check('opening a picker sets the overlay', picker.overlay.kind === 'picker');
  const wrapped = run(picker, { type: 'overlayMove', delta: -1, count: 5 });
  check('picker movement wraps around', wrapped.overlay.kind === 'picker' && wrapped.overlay.cursor === 4);
  const filtered = run(wrapped, { type: 'editInput', input: fieldOf('do') });
  check('typing a filter resets the picker cursor', filtered.overlay.kind === 'picker' && filtered.overlay.cursor === 0 && filtered.overlay.query.value === 'do');
  check('closing returns to no overlay', run(filtered, { type: 'closeOverlay' }).overlay.kind === 'none');

  const labels = run(s0, { type: 'openOverlay', overlay: { kind: 'picker', field: 'labels', issueId: issue.id, query: emptyField, cursor: 0, selected: ['l1'] } }, { type: 'pickerToggle', id: 'l2' }, { type: 'pickerToggle', id: 'l1' });
  check('the labels picker toggles a set', labels.overlay.kind === 'picker' && labels.overlay.selected.join() === 'l2');

  const draft = newDraft({ route: { kind: 'team', teamId: team.id }, stack: [] }, data);
  check('a new issue defaults to the team in view', draft.teamId === team.id && draft.assigneeId === null);
  check('on Today a new issue is assigned to me', newDraft({ route: { kind: 'today' }, stack: [] }, data).assigneeId === data.currentUser.id);
  const otherTeam = data.teams[1];
  const switched = cycleDraft('team', draft, 1, data);
  check('changing the team resets the state to that team\'s', switched.teamId === otherTeam.id && data.stateById.get(switched.stateId!)?.teamId === otherTeam.id);
  const compose = run(s0, { type: 'openOverlay', overlay: { kind: 'compose', target: 'issue', field: 'title', input: emptyField, draft } }, { type: 'composeField', delta: -1 });
  check('shift-tab from the title wraps to the last field', compose.overlay.kind === 'compose' && compose.overlay.target === 'issue' && compose.overlay.field === 'project');

  const opts = pickerOptions('assignee', issue, data);
  check('the assignee picker offers Me first and unassign last', opts[0].id === data.currentUser.id && opts[0].label === 'Me' && opts[opts.length - 1].label === 'No assignee');
  check('routeKey separates routes of the same kind', routeKey({ kind: 'team', teamId: 'a' }) !== routeKey({ kind: 'team', teamId: 'b' }));

  const firstGroup = groupIssues(issuesForRoute(TEAM, data), data)[0];
  const folded = run(s0, { type: 'toggleGroup', groupId: firstGroup.id });
  check('folding a group puts the cursor on its header', cursorRow(folded)?.id === `group:${firstGroup.id}` &&
    !listRowsFor(TEAM, data, listViewOf(folded, TEAM)).some(r => r.kind === 'issue' && firstGroup.issues.some(i => i.id === r.id)));
  check('toggling again unfolds it', run(folded, { type: 'toggleGroup', groupId: firstGroup.id }).expanded[`${TEAM_KEY}|${firstGroup.id}`] === true);
}

{
  const contexts = [...new Set(BINDINGS.flatMap(b => b.when))] as Context[];
  const clashes = contexts.flatMap(ctx => {
    const keys = BINDINGS.filter(b => b.when.includes(ctx)).flatMap(b => b.keys);
    return keys.filter((k, i) => keys.indexOf(k) !== i).map(k => `${ctx}:${k}`);
  });
  check('no key is bound twice in one context', !clashes.length, clashes.join(', '));
  const st = run(initialState(), { type: 'loaded', data, at: now });
  check('s on a list opens the status picker', lookup(['list', 'global'], 's')?.command === 'setState');
  check('j moves on lists and scrolls the issue page', lookup(['detail', 'global'], 'j')?.command === 'down' && lookup(['list', 'global'], 'j')?.command === 'down');
  check('removed keys answer nothing: D, J, z, ctrl-b, ctrl-k, and no g chord', ['D', 'J', 'z', 'ctrl+b', 'ctrl+k', 'g i', 'g g'].every(k => !lookup(['list', 'global'], k)) && BINDINGS.every(b => b.keys.every(k => !k.includes(' '))));
  check('page keys work on lists and the issue page: PgDn, ctrl-d, g/Home, G/End', ['list', 'today', 'detail'].every(c =>
    lookup([c as Context, 'global'], 'pagedown')?.command === 'pageDown' && lookup([c as Context, 'global'], 'ctrl+d')?.command === 'halfDown' &&
    ['g', 'home'].every(k => lookup([c as Context, 'global'], k)?.command === 'top') && ['G', 'end'].every(k => lookup([c as Context, 'global'], k)?.command === 'bottom')));
  check('space stays the action menu; / keeps Home, End and ctrl-d for its caret', lookup(['list', 'global'], 'space')?.command === 'actions' &&
    ['home', 'end', 'ctrl+d', 'ctrl+u', 'g'].every(k => !lookup(['finder'], k)) && lookup(['finder'], 'pagedown')?.command === 'overlayPageDown' && lookup(['picker'], 'end')?.command === 'overlayBottom');
  const moveRows = helpSections().find(sec => sec.group === 'Move around')!.rows.map(r => `${r.key} ${r.label}`);
  check('? lists the page keys under Move around', ['PgDn PgUp page', 'ctrl-d ctrl-u half page', 'g G top, bottom'].every(t => moveRows.some(r => r.startsWith(t))), moveRows.join(' | '));
  const help = helpSections().flatMap(sec => sec.rows.map(r => `${sec.group}|${r.key}|${r.label}`));
  check('the help overlay has no duplicate rows', new Set(help).size === help.length, help.filter((r, i) => help.indexOf(r) !== i).join(', '));
  const pickerState = run(st, { type: 'openOverlay', overlay: { kind: 'picker', field: 'priority', issueId: data.issues[0].id, query: emptyField, cursor: 0, selected: [] } });
  check('a picker: digits always pick, every other letter filters',
    lookup(contextsFor(pickerState), '3')?.command === 'pickerPick' && lookup(contextsFor(run(pickerState, { type: 'editInput', input: fieldOf('h') })), '3')?.command === 'pickerPick' &&
    lookup(contextsFor(pickerState), 'j') === undefined && lookup(contextsFor(pickerState), 'q') === undefined);
  check('letters typed into a search box are text, not commands', lookup(['finder'], 's') === undefined && lookup(['finder'], 'q') === undefined);
  check('space toggles in the labels picker only', lookup(['multipicker', 'picker'], 'space')?.command === 'pickerToggle' && lookup(['picker'], 'space') === undefined);
  check('ctrl-c quits from anywhere, even inside an overlay', ['boot', 'finder', 'picker', 'compose', 'help', 'menu'].every(c => lookup([c as Context], 'ctrl+c')?.command === 'quit'));
  check('a compose title field is a text context', contextsFor(run(st, { type: 'openOverlay', overlay: { kind: 'compose', target: 'issue', field: 'title', input: emptyField, draft: newDraft(st, data) } })).join() === 'compose-issue,compose');
}

{
  const st = run(initialState(TEAM), { type: 'loaded', data, at: now });
  const target = data.issueById.get(selectableIds(TEAM, data, DEFAULT_VIEW, now)[0])!;
  const key = data.keyOf(target);
  check('words must each start a word: "done" finds Done, "one" does not', wordMatch('done', 'Move CORE-4 to Done') !== null && wordMatch('one', 'Move CORE-4 to Done') === null);
  const items = (q: string) => findItems(findSections(st, q, now));
  check('/ "done" offers Move <issue> to Done, with its key s', items('done')[0]?.label === `Move ${key} to Done` && items('done')[0]?.key === 's', items('done').map(i => i.label).join(' | '));
  const ada = data.users.find(u => u.name.startsWith('Ada'))!;
  check('/ "assign ada" offers Assign <issue> to Ada', items('assign ada')[0]?.label === `Assign ${key} to ${ada.name}`, items('assign ada').map(i => i.label).join(' | '));
  check('/ "agent" offers the agent actions, Start … here first, keyed w h', items('agent')[0]?.key === 'w h' && items('agent').some(i => i.key === 'w p'), items('agent').map(i => `${i.key} ${i.label}`).join(' | '));
  check('/ "new Foo" offers to create Foo in a team, and nothing else to do', items('new Foo')[0]?.label.startsWith('Create “Foo” in ') && 'create' in items('new Foo')[0].run);
  check('/ "group by priority" offers the grouping that has no key now', items('group by priority').some(i => 'view' in i.run && i.run.view.groupBy === 'priority'));
  check('/ with an issue key goes to that issue, not to actions', items(data.keyOf(data.issues[3]))[0]?.issue?.id === data.issues[3].id);
  const sections = findSections(st, 'done', now);
  check('/ puts "Do with <issue>" above "Issues"', sections[0].title === `Do with ${key}` && sections[sections.length - 1].title === 'Issues');

  const todo = data.states.find(x => x.teamId === target.teamId && x.type === 'unstarted' && x.id !== target.stateId)!;
  check('the cursor follows its issue into another group, even before it has moved', cursorRow(run(st, { type: 'patchIssue', issueId: target.id, patch: { stateId: todo.id } }))?.id === target.id);
  check('the space menu has the letters that work here: s a p l m e d b f r w c o n', MENUS.actions.rows.map(r => r.key).join(' ') === 's a p l m e d b f r w c o n');
  check('…and each of them works on Today, a list and the issue page without space', ['today', 'list', 'detail'].every(c => MENUS.actions.rows.every(r => lookup([c as Context, 'global'], r.key)?.command === r.command)));
  check('the agent menu: h here, n new pane, p prompt, b branch', MENUS.agent.rows.map(r => `${r.key}:${r.command}`).join() === 'h:agentHere,n:agentPane,p:copyPrompt,b:copyBranch');
  const mc = { issue: target, data, handoff: undefined, env: {}, where: { cwd: '/x', note: null }, now };
  const pane = MENUS.agent.rows.find(r => r.key === 'n')!;
  check('a new pane needs tmux: off without $TMUX, with a reason', pane.enabled!(mc) !== true && pane.enabled!({ ...mc, env: { TMUX: '/tmp/tmux' } }) === true);
  check('$BASELINE_AGENT keeps the label generic', rowLabel(MENUS.agent.rows[0], mc) === 'Start Claude Code here' && rowLabel(MENUS.agent.rows[0], { ...mc, env: { BASELINE_AGENT: 'codex' } }) === 'Start the agent here');
  check('the menu trail names the keys that led there', menuTrail(['actions', 'agent']).join(' ') === 'space w' && menuTrail(['copy']).join(' ') === 'c');
  const menu = run(st, { type: 'openOverlay', overlay: { kind: 'menu', path: ['actions'], issueId: target.id, cursor: 0 } }, { type: 'menuPush', menu: 'agent' });
  check('backspace steps out of a submenu, then closes the menu', menu.overlay.kind === 'menu' && run(menu, { type: 'menuBack' }).overlay.kind === 'menu' && run(menu, { type: 'menuBack' }, { type: 'menuBack' }).overlay.kind === 'none');
  check('paneCommand splits tmux beside this pane in the issue\'s directory', paneCommand(['claude', 'go'], { cwd: '/w', target: { kind: 'local', dbPath: '/d.db', source: 'flag' }, issueKey: 'CORE-1' }).join(' ') ===
    'tmux split-window -h -P -F #{pane_id} -c /w -e BASELINE_ISSUE=CORE-1 -e BASELINE_DB=/d.db -e BASELINE_URL= -e BASELINE_TOKEN= claude go');
  const paneEnv = (target: Parameters<typeof paneCommand>[1]['target']) => paneCommand(['a'], { cwd: '/w', target, issueKey: 'K-1' }).filter((_, i, a) => a[i - 1] === '-e');
  check('a tmux pane gets the database even when BASELINE_DB chose it, since splits don\'t inherit this process\'s environment',
    paneEnv({ kind: 'local', dbPath: '/env.db', source: 'env' }).includes('BASELINE_DB=/env.db'));
  check('a tmux pane gets the server and key when the environment chose them',
    paneEnv({ kind: 'remote', url: new URL('https://bl.example.com'), token: 'tok', source: 'env' }).join(' ') === 'BASELINE_ISSUE=K-1 BASELINE_DB= BASELINE_URL=https://bl.example.com BASELINE_TOKEN=tok');
  check('a tmux pane on a logged-in server clears all three so its CLI reads the same config file',
    paneEnv({ kind: 'remote', url: new URL('https://bl.example.com'), token: 'tok', source: 'config' }).join(' ') === 'BASELINE_ISSUE=K-1 BASELINE_DB= BASELINE_URL= BASELINE_TOKEN=');

  const entry = (n: number) => ({ issueId: `i${n}`, key: `K-${n}`, field: 'state' as const, before: {}, after: {}, label: '' });
  const stacked = Array.from({ length: 25 }, (_, n) => n).reduce((x, n) => run(x, { type: 'pushUndo', entry: entry(n) }), st);
  check('the undo stack keeps the newest 20', stacked.undo.length === 20 && stacked.undo[19].issueId === 'i24' && stacked.undo[0].issueId === 'i5');
  check('popping undo drops the newest', run(stacked, { type: 'popUndo' }).undo[18].issueId === 'i23');
  const help = helpSections().map(sec => sec.group);
  check('help is grouped by task', help.join() === 'Move around,Decide,Change an issue,Agents and copying,Find and views');
  check('help lists each submenu\'s letters under its key', helpSections().some(sec => sec.rows.some(r => r.key === 'w h')));
}

{
  check('BASELINE_AGENT may carry flags; the prompt is the last argument', agentCommand('do it', { BASELINE_AGENT: 'claude --model opus' }).join('|') === 'claude|--model|opus|do it');
  check('the agent defaults to claude', agentCommand('p', {})[0] === 'claude');
  const env = agentEnv({ kind: 'local', dbPath: '/tmp/x.db', source: 'flag' }, 'CORE-1', { BASELINE_URL: 'https://x', BASELINE_TOKEN: 't' });
  check('an agent started from a --db TUI writes to that same database', env.BASELINE_DB === '/tmp/x.db' && !env.BASELINE_URL && env.BASELINE_ISSUE === 'CORE-1');
  const fromEnv = agentEnv({ kind: 'local', dbPath: '/tmp/e.db', source: 'env' }, 'CORE-1', { BASELINE_URL: 'https://x', BASELINE_TOKEN: 't' });
  check('an agent started from a BASELINE_DB TUI writes to that same database', fromEnv.BASELINE_DB === '/tmp/e.db' && !fromEnv.BASELINE_URL && !fromEnv.BASELINE_TOKEN);
  check('the confirm preview quotes the prompt and cuts it to one line', shellPreview(['claude', "Work on CORE-1: it's\nmore"], 80) === `claude 'Work on CORE-1: it'\\''s…'`);
}

class FakeStdout extends EventEmitter {
  columns = 120;
  rows = 40;
  isTTY = false;
  frames: string[] = [];
  write(chunk: string) { this.frames.push(chunk); return true; }
  get last() { return stripVTControlCharacters(this.frames[this.frames.length - 1] ?? ''); }
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  private queue: string[] = [];
  setRawMode() { return this; }
  setEncoding() { return this; }
  ref() { return this; }
  unref() { return this; }
  resume() { return this; }
  pause() { return this; }
  read(): string | null { return this.queue.shift() ?? null; }
  press(data: string) { this.queue.push(data); this.emit('readable'); }
}

{
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const waitFor = async (what: string, ok: (frame: string) => boolean, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (ok(stdout.last)) return true;
      await new Promise(r => setTimeout(r, 25));
    }
    check(`(timed out waiting for ${what})`, false, stdout.last);
    return false;
  };
  const settle = (ms = 250) => new Promise(r => setTimeout(r, ms));

  const copied: string[] = [];
  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000, route: TEAM, animate: false, tmux: false, clipboard: (t: string) => { copied.push(t); return true; } }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const fresh = await connect({ db: dbPath });

  const teamName = data.teams[0]!.name;
  const firstKeys = selectableIds(TEAM, data, DEFAULT_VIEW, now).slice(0, 5).map(id => data.issueById.get(id)).filter((i): i is Issue => !!i).map(i => data.keyOf(i));
  await waitFor('the team list', f => f.includes(`2 ${teamName}`) && f.includes(firstKeys[0]!));
  const frame = stdout.last;
  check('a team list renders its issues', firstKeys.every(k => frame.includes(k)), firstKeys.filter(k => !frame.includes(k)).join(', '));
  check('group headers render with counts', /In Progress\s+\d+/.test(frame) && /Todo\s+\d+/.test(frame));
  check('the tab bar numbers Today, then each team; no Inbox or Projects tab', new RegExp(`1 Today( \\d+)?\\s+2 ${teamName}\\s+3 ${data.teams[1]!.name}`).test(frame) && !/Inbox|Projects|My work/.test(frame.split('\n')[0]!), frame.split('\n')[0]);
  check('the footer is one line: ↑↓ move, enter open, esc back, 1-3 places, / find, space actions, ? help', /↑↓ move\s+enter open\s+esc back\s+1-3 places\s+\/ find\s+space actions\s+\? help/.test(frame), frame.split('\n').slice(-2).join('\n'));
  check('the detail pane shows the issue under the cursor with a key on each field', /│ s Status/.test(frame) && /│ a Assignee/.test(frame) && /│ p Priority/.test(frame) && /│ l Labels/.test(frame) && /│ w Work on it with an agent\s+c copy/.test(frame));

  stdin.press('1');
  await waitFor('Today', f => /Needs you\s+\d+/.test(f) && /In flight\s+\d+/.test(f) && /Up next\s+\d+/.test(f));
  check('1 goes to Today: Needs you, In flight, Up next', /Needs you/.test(stdout.last));
  stdin.press('2');
  await waitFor('the team again', f => f.includes(firstKeys[0]!) && /◐ In Progress/.test(f));

  const target = data.issueById.get(selectableIds(TEAM, data, DEFAULT_VIEW, now)[0])!;
  const key = data.keyOf(target);
  const states = pickerOptions('state', target, data);
  const third = states[2];
  check('(the third status differs from the current one)', !third.current);
  stdin.press('s');
  await waitFor('status picker on its field', f => f.includes(`Status for ${key}`) && /│ s Status .*▾/.test(f) && f.includes(`3  `));
  check('s opens the status dropdown under the field, numbered, with only its keys in the footer', /│\s+│ 3\s+\S+ /.test(stdout.last) && /Status for \S+\s+↑↓ choose\s+1-\d pick\s+enter apply\s+esc cancel/.test(stdout.last) && !stdout.last.includes('? help'));
  stdin.press('3');
  await waitFor('status toast with undo', f => f.includes(`${key} moved to ${third.label}`) && f.includes('u undo'));
  check('s then 3 sets the third status, as a fresh client reads it', (await fresh.getIssue(target.id))?.stateId === third.id);
  check('the changed field says ✓ saved', await waitFor('saved marker', f => /│ s Status .*✓ saved/.test(f)));

  stdin.press('u');
  await waitFor('undo toast', f => f.includes(`Undone: ${key}`));
  check('u reverts it, as a fresh client reads it', (await fresh.getIssue(target.id))?.stateId === target.stateId);

  stdin.press('s');
  await waitFor('status picker again', f => f.includes(`Status for ${key}`));
  stdin.press('3');
  await waitFor('second change', f => f.includes(`${key} moved to ${third.label}`));
  const other = states.find(o => o.id !== third.id && o.id !== target.stateId && !/done|cancel/i.test(o.label))!;
  await fresh.updateIssue(target.id, { stateId: other.id });
  stdin.press('u');
  await waitFor('undo refused', f => f.includes(`Not undone: ${key} changed since`));
  check('u after someone else changed the field refuses and leaves their change', (await fresh.getIssue(target.id))?.stateId === other.id);
  await settle(100);
  stdin.press('u');
  await waitFor('still refused', f => f.includes('Not undone'));
  check('…and keeps the stack (u again still names that change, not "Nothing to undo")', stdout.last.includes('Not undone') && !stdout.last.includes('Nothing to undo'));
  stdin.press('\x12');
  await waitFor('refreshed', f => new RegExp(`│ s Status\\s+\\S+ ${other.label}`).test(f));

  stdin.press(' ');
  await waitFor('space menu', f => f.includes('space › _') && f.includes('waiting for the next key: s a p l m e d b f r w c o n'));
  check('space opens the action menu: the issue on top and a letter per row', stdout.last.includes(`${key}  ${target.title}`) && /│ s  Status\s/.test(stdout.last) && /│ w  Work on it with an agent/.test(stdout.last));
  stdin.press('s');
  await waitFor('status picker from the menu', f => f.includes(`Status for ${key}`));
  check('space then s opens the status picker', stdout.last.includes(`Status for ${key}`) && !stdout.last.includes('space › _'));
  stdin.press('\x1b');
  await waitFor('picker closed', f => !f.includes('Status for'));
  stdin.press(' ');
  await waitFor('space menu again', f => f.includes('space › _'));
  stdin.press('w');
  await waitFor('agent menu', f => f.includes('space › w › _') && f.includes('will run'));
  check('space w shows the agent menu with the command it will run and where', /│ h  Start Claude Code here/.test(stdout.last) && /will run\s+\$ claude/.test(stdout.last) && /│ in\s+\S/.test(stdout.last));
  stdin.press('\x1b');
  await waitFor('menu closed', f => !f.includes('space › w'));

  stdin.press('/');
  await waitFor('find', f => f.includes('Recently updated') && f.includes('try typing'));
  stdin.press('done');
  await waitFor('find done', f => f.includes(`Move ${key} to Done`) && f.includes(`Do with ${key}`));
  check('/ done offers Move <issue> to Done under "Do with", with its key', /▌ Move \S+ to Done\s+s\s*$/m.test(stdout.last));
  stdin.press('\r');
  await waitFor('moved to Done', f => f.includes(`${key} moved to Done`));
  check('…and enter applies it, as a fresh client reads it', data.stateById.get((await fresh.getIssue(target.id))!.stateId)?.type === 'completed');

  stdin.press('/');
  await waitFor('find again', f => f.includes('try typing'));
  stdin.press('new Foo from find');
  await waitFor('create offer', f => f.includes('Create “Foo from find” in'));
  stdin.press('\r');
  await waitFor('created from find', f => f.includes('Created') && f.includes('Foo from find'));
  check('/ new Foo creates the issue', (await fresh.listIssues({ query: 'Foo from find' })).length === 1);

  const opened = issuesForRoute(TEAM, data).find(i => i.id !== target.id && !CLOSED_TYPES.has(typeOf(i)))!;
  stdin.press('/');
  await waitFor('find for a key', f => f.includes('try typing'));
  stdin.press(data.keyOf(opened));
  await waitFor('key result', f => f.includes(`› ${data.keyOf(opened)}`) && f.includes('Issues'));
  stdin.press('\r');
  await waitFor('issue page', f => f.includes('── Description') && f.includes(opened.title));
  check('/ → an issue key → enter opens its page, fields keyed', /^ s Status/m.test(stdout.last) && stdout.last.includes(data.keyOf(opened)));

  stdin.press('m');
  await waitFor('comment box', f => f.includes('Comment on'));
  stdin.press('Reviewed from the terminal');
  await waitFor('typed comment', f => f.includes('Reviewed from the terminal'));
  stdin.press('\r');
  await waitFor('comment toast', f => f.includes(`Commented on ${data.keyOf(opened)}`));
  check('m → a comment is saved on the open issue, and offers no undo', (await fresh.snapshot(['comments'])).comments.some(c => c.issueId === opened.id && c.body === 'Reviewed from the terminal') && !stdout.last.includes('u undo'));

  stdin.press('\x1b');
  await waitFor('back to the list', f => f.includes(`2 ${teamName}`) && !f.includes('── Description'));
  stdin.press('n');
  await waitFor('new issue form', f => f.includes('New issue'));
  stdin.press('Filed from the TUI test');
  await waitFor('typed title', f => f.includes('Filed from the TUI test'));
  stdin.press('\r');
  await waitFor('created toast', f => f.includes('Created') && f.includes('Filed from the TUI test'));
  const created = (await fresh.listIssues({ query: 'Filed from the TUI test' }))[0];
  check('n → enter creates the issue in the team in view', !!created && created.teamId === TEAM.teamId);

  const liveIds = selectableIds(TEAM, await fetchData(fresh), DEFAULT_VIEW, now);
  const secondTitle = (await fresh.getIssue(liveIds[1]))!.title;
  stdin.press(`${'k'.repeat(20)}j\r`);
  await waitFor('burst opens the second issue', f => f.includes('── Description') && f.includes(secondTitle));
  check('a burst of keys in one chunk (tmux send-keys) acts as separate presses', stdout.last.includes(secondTitle));
  stdin.press('\x1b');
  await waitFor('list once more', f => !f.includes('── Description'));

  const live = await fetchData(fresh);
  const pick = live.issueById.get(selectableIds(TEAM, live, DEFAULT_VIEW, now)[0])!;
  stdin.press(`${'k'.repeat(20)}p`);
  await waitFor('priority picker', f => f.includes('Priority for'));
  stdin.press('4');
  await waitFor('priority toast', f => f.includes(`${live.keyOf(pick)} priority set to Low`));
  check('a digit in a picker picks that option (p 4 → Low)', (await fresh.getIssue(pick.id))?.priority === 4);

  stdin.press('ck');
  await waitFor('copy toast', f => f.includes(`Copied ${live.keyOf(pick)}`));
  const osc = `\x1b]52;c;${Buffer.from(live.keyOf(pick)).toString('base64')}\x07`;
  check('c k copies the issue key through OSC 52 and the native helper', stdout.frames.some(f => f.includes(osc)) && copied.includes(live.keyOf(pick)));

  await settle(3700);
  const body = (f: string) => f.split('\n').slice(0, -2).join('\n');
  const before = body(stdout.last);
  for (const k of ['D', 'J', 'z']) stdin.press(k);
  await settle(400);
  check('removed keys (D, J, z) do nothing', body(stdout.last) === before && !stdout.last.includes('by priority'), body(stdout.last).split('\n').slice(0, 6).join('\n'));

  stdin.press('?');
  await waitFor('help card', f => f.includes('Baseline, in your terminal'));
  stdin.press('jjjjjjjjjjjjjjjjjjjjjjjj');
  await waitFor('every key', f => f.includes('Move around') && f.includes('Agents and copying'));
  check('? shows the card, then every key grouped by task', stdout.last.includes('Change an issue') && stdout.last.includes('Find and views'));
  stdin.press('\r');
  await waitFor('help closed', f => !f.includes('Agents and copying'));

  stdin.press('q');
  await waitFor('Today after q', f => /Needs you/.test(f));
  check('q on a team goes back to Today', /Needs you/.test(stdout.last));
  stdin.press('q');
  const exited = await Promise.race([app.waitUntilExit().then(() => true), new Promise(r => setTimeout(() => r(false), 3000))]);
  check('q on Today exits', exited === true);
}

{
  const stdout = new FakeStdout();
  stdout.columns = 80;
  stdout.rows = 24;
  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000, animate: false }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: new FakeStdin() as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const until = async (ok: () => boolean, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end && !ok()) await new Promise(r => setTimeout(r, 25)); return ok(); };
  await until(() => stdout.last.includes('1 Today') && /Up next/.test(stdout.last));
  check('at 80 columns no Today line is wider than the terminal', stdout.last.split('\n').every(l => displayWidth(l) <= 80));
  check('below 100 columns there is no detail pane, the list takes the width', !stdout.last.includes('s Status') && !stdout.last.includes(' │ '), stdout.last);
  app.unmount();
}

{
  const stdout = new FakeStdout();
  stdout.columns = 120;
  stdout.rows = 30;
  // Ink follows resizes only on a terminal, and draws the frame it already has before React re-renders
  stdout.isTTY = true;
  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000, route: TEAM }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: new FakeStdin() as unknown as NodeJS.ReadStream, exitOnCtrlC: false, patchConsole: false,
  });
  const until = async (ok: () => boolean, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end && !ok()) await new Promise(r => setTimeout(r, 25)); return ok(); };
  await until(() => stdout.last.includes('s Status'));
  const from = stdout.frames.length;
  stdout.columns = 90;
  stdout.emit('resize');
  await until(() => !stdout.last.includes('s Status'));
  const widest = Math.max(...stdout.frames.slice(from).flatMap(f => stripVTControlCharacters(f).split('\n')).map(l => displayWidth(l)));
  check('after the terminal narrows, no frame is wider than it, so the terminal never wraps and scrolls a stale frame', widest <= 90, `widest line ${widest}`);
  app.unmount();
}

{
  const prev = process.env.BASELINE_TUI_STATE_DIR;
  process.env.BASELINE_TUI_STATE_DIR = join(work, 'first-launch');
  const bl1 = await connect({ db: dbPath });
  const first = await prepareStart(bl1, { fresh: true }, work);
  check('the first ever start opens on the welcome card', first.start?.intro === true);
  const stdout = new FakeStdout();
  const app = render(createElement(App, { bl: bl1, pollMs: 60_000, ...first }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: new FakeStdin() as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const end = Date.now() + 4000;
  while (Date.now() < end && !stdout.last.includes('Baseline, in your terminal')) await new Promise(r => setTimeout(r, 25));
  const card = stdout.last;
  check('…which states the five rules: 1-9 a place, enter, esc, space, /; and enter start', card.includes('Baseline, in your terminal') && /1-3\s+a place: 1 is Today/.test(card) && /enter\s+go into the thing under the cursor/.test(card) &&
    /esc\s+back one level; Today is never more than two presses away/.test(card) && /space\s+every action here/.test(card) && /\/\s+everything without a tab/.test(card) && card.includes('After a decision you land on the next thing that needs you') && /enter start/.test(card), card);
  app.unmount();
  check('the second start does not show it again', (await prepareStart(bl1, { fresh: true }, work)).start?.intro !== true);
  if (prev === undefined) delete process.env.BASELINE_TUI_STATE_DIR; else process.env.BASELINE_TUI_STATE_DIR = prev;
}

const root = join(import.meta.dirname, '..');
const cli = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(join(root, 'node_modules/.bin/tsx'), [join(root, 'src/cli/index.ts'), ...args], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TSX_TSCONFIG_PATH: join(root, 'tsconfig.node.json'), ...env } });

{
  const r = cli([], { BASELINE_DB: dbPath });
  check('bare `baseline` without a terminal prints help instead of opening the TUI', `${r.stdout}${r.stderr}`.includes('Usage: baseline') && !`${r.stdout}${r.stderr}`.includes('needs an interactive terminal'), r.stderr.slice(0, 200));
  const fresh = cli(['--fresh', '--db', dbPath]);
  check('`baseline --fresh` is `baseline tui --fresh` (no "unknown option"); without a terminal it says it needs one', fresh.status === 1 && fresh.stderr.includes('needs an interactive terminal') && !fresh.stderr.includes('unknown option'), fresh.stderr.slice(0, 200));
  const help = cli(['--help']);
  check('`baseline --help` still prints help', help.stdout.includes('Usage: baseline'), help.stderr.slice(0, 200));
}

{
  const stdout = new FakeStdout();
  stdout.columns = 160;
  const stdin = new FakeStdin();
  const workspace = workspaceDir(work);
  const target = targetId({ kind: 'local', dbPath, source: 'flag' });
  const path = sessionPath(workspace, target);
  check('the state file lives under $HOME/.baseline/tui (a temp HOME here)', path.startsWith(join(home, '.baseline', 'tui')), path);
  const writer = sessionWriter(path, { cwd: work, workspace, target }, 50);
  const read = (): SessionFile | null => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as SessionFile : null);
  const until = async (ok: () => boolean, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end && !ok()) await new Promise(r => setTimeout(r, 25)); return ok(); };

  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000, route: TEAM, onContext: writer.update }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await until(() => stdout.last.includes(`2 ${data.teams[0]!.name}`));
  stdin.press('jj');
  const live = await fetchData(await connect({ db: dbPath }));
  const ids = selectableIds(TEAM, live, DEFAULT_VIEW, Date.now());
  const third = live.issueById.get(ids[2])!;
  const thirdKey = live.keyOf(third);
  await until(() => read()?.list?.cursorKey === thirdKey);
  const file = read();
  check('moving the cursor writes the state file: route, list rows and the cursor key', file?.version === 1 && file.route.kind === 'team' && file.list?.cursorKey === thirdKey && file.list.rows.length > 2 && file.pid === process.pid, JSON.stringify(file?.list?.cursorKey));

  const ctx = cli(['context', '--db', dbPath]);
  const marked = ctx.stdout.split('\n').filter(l => l.includes('← cursor'));
  const position = (file?.list?.rows ?? []).findIndex(r => r.key === thirdKey) + 1;
  check('`baseline context` marks the cursor on the right row of the list', ctx.status === 0 && marked.length === 1 && marked[0].startsWith(`${position}. ${thirdKey} `), ctx.stdout + ctx.stderr);
  check('`baseline context` says what is showing and that the TUI is open', ctx.stdout.includes(`- Showing: ${data.teams[0]!.name}`) && ctx.stdout.includes(`pid ${process.pid}, open,`), ctx.stdout.split('\n')[0]);
  const json = cli(['context', '--json', '--db', dbPath]);
  check('`baseline context --json` prints the file', json.status === 0 && JSON.parse(json.stdout).list.cursorKey === thirdKey && JSON.parse(json.stdout).open === true);

  stdin.press('\r');
  await until(() => read()?.route.kind === 'issue');
  check('opening an issue records it as the open issue', read()?.openIssue?.key === thirdKey, JSON.stringify(read()?.openIssue));
  app.unmount();
  writer.flush();

  const bl2 = await connect({ db: dbPath });
  const start = await prepareStart(bl2, {}, workspace);
  check('the next start reopens the same issue, grouping and list', start.route?.kind === 'issue' && start.route.issueId === third.id && start.stack?.[0]?.kind === 'team' && start.start?.groupBy === 'status');
  check('--fresh skips the restore', Object.keys(await prepareStart(bl2, { fresh: true }, workspace)).length === 0);
  const out2 = new FakeStdout();
  const app2 = render(createElement(App, { bl: bl2, pollMs: 60_000, ...start }), {
    stdout: out2 as unknown as NodeJS.WriteStream, stdin: new FakeStdin() as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  check('…and renders that issue page', await until(() => out2.last.includes('Description') && out2.last.includes(third.title)), out2.last.slice(0, 300));
  app2.unmount();

  rmSync(path);
  const none = cli(['context', '--db', dbPath]);
  check('`baseline context` with no state file exits 1 with a hint to run baseline', none.status === 1 && none.stderr.includes('Run `baseline`'), none.stderr);
}

{
  // page keys end to end: a team list in a short terminal, then an issue with a 200-line description
  const team = data.teams[0];
  const longBody = Array.from({ length: 200 }, (_, i) => `- Line ${String(i + 1).padStart(3, '0')} of the long description`).join('\n');
  const long = await bl.createIssue({ teamId: team.id, title: 'A very long read', description: longBody }, data.currentUser.id);
  const live = await fetchData(bl);
  const longKey = live.keyOf(long);

  const pane = paneLines(live.issueById.get(long.id)!, live, 50, 24, now).map(l => l.map(x => x.text).join(''));
  const roomy = paneLines({ ...live.issueById.get(long.id)!, description: 'Short.' }, live, 50, 40, now).map(l => l.map(x => x.text).join(''));
  check('the detail pane says "more ↓ enter for the whole issue" only when it cuts the issue off', pane.includes('more ↓ enter for the whole issue') && !roomy.some(l => l.includes('more ↓')), pane.join('\n'));

  const menu = run(initialState(), { type: 'loaded', data: live, at: now }, { type: 'openOverlay', overlay: { kind: 'menu', path: ['actions'], issueId: long.id, cursor: 1 } });
  check('a page in an overlay stops at the ends instead of wrapping', run(menu, { type: 'overlayMove', delta: 99, count: 5, clamp: true }).overlay.kind === 'menu' &&
    (run(menu, { type: 'overlayMove', delta: 99, count: 5, clamp: true }).overlay as { cursor: number }).cursor === 4 &&
    (run(menu, { type: 'overlayMove', delta: -Infinity, count: 5, clamp: true }).overlay as { cursor: number }).cursor === 0);

  const stdout = new FakeStdout();
  stdout.columns = 80;
  stdout.rows = 12;
  const stdin = new FakeStdin();
  const route = { kind: 'team' as const, teamId: team.id };
  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000, route }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const until = async (ok: () => boolean, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end && !ok()) await new Promise(r => setTimeout(r, 25)); return ok(); };
  const page = stdout.rows - 4;
  const rows = listRowsFor(route, live, DEFAULT_VIEW);
  const canRest = rows.map(r => r.kind === 'issue' || r.selectable);
  const first = canRest.indexOf(true), last = canRest.lastIndexOf(true);
  // the drawn row a page lands on: the target, else the nearest row the cursor can rest on past it, else before it
  const landing = (from: number, delta: number) => {
    const t = Math.max(0, Math.min(rows.length - 1, from + delta));
    for (let i = t; i >= 0 && i < rows.length; i += Math.sign(delta)) if (canRest[i]) return i;
    for (let i = t; i >= 0 && i < rows.length; i -= Math.sign(delta)) if (canRest[i]) return i;
    return from;
  };
  const shows = (i: number) => {
    const r = rows[i];
    const lines = stdout.last.split('\n');
    return r.kind === 'issue' ? lines.some(l => l.includes('▌') && l.includes(`${live.keyOf(r.issue)} `)) : lines.some(l => l.includes(r.group.label) && l.includes('enter shows these'));
  };
  const what = (i: number) => (rows[i].kind === 'issue' ? live.keyOf((rows[i] as { issue: Issue }).issue) : 'a group header');
  const frameBody = () => stdout.last.split('\n').slice(2, -2).join('\n');
  check('(the team list is longer than two pages)', rows.length > page * 2, String(rows.length));
  await until(() => shows(first));
  check('a list opens with the cursor on its first row', shows(first), frameBody());

  stdin.press('\x1b[6~');
  const paged = landing(first, page);
  check(`PgDn moves the list cursor a page (${what(first)} → ${what(paged)})`, await until(() => shows(paged)), frameBody());
  stdin.press('\x1b[5~');
  check('PgUp moves it back', await until(() => shows(first)), frameBody());
  stdin.press('\x04');
  const half = landing(first, Math.floor(page / 2));
  check(`ctrl-d moves half a page (${what(first)} → ${what(half)})`, await until(() => shows(half)), frameBody());
  stdin.press('\x1b[F');
  check('End reaches the last row', await until(() => shows(last)), frameBody());
  stdin.press('g');
  check('g goes back to the top', await until(() => shows(first)), frameBody());
  stdin.press('G');
  check('G reaches the last row', await until(() => shows(last)), frameBody());
  stdin.press('\x1b[H');
  check('Home goes back to the top', await until(() => shows(first)), frameBody());

  stdin.press('/');
  await until(() => stdout.last.includes('› '));
  stdin.press(longKey);
  await until(() => stdout.last.includes(`${longKey}`) && stdout.last.includes('A very long read'));
  stdin.press('\r');
  const marker = () => stdout.last.split('\n')[0].trim().split(/\s+/).slice(-2).join(' ');
  await until(() => stdout.last.includes('Description') || marker() === 'more ↓');
  check('a long issue page shows "more ↓" at the right of the header', marker() === 'more ↓', stdout.last.split('\n')[0]);
  const top = frameBody();
  stdin.press('\x1b[6~');
  await until(() => frameBody() !== top);
  const pct1 = marker().split(' ').pop()!;
  check('PgDn scrolls the issue page and the marker turns into a percentage', frameBody() !== top && /^\d+%$/.test(pct1), `${marker()}\n${frameBody()}`);
  const p1 = frameBody();
  stdin.press('\x04');
  await until(() => frameBody() !== p1);
  const pct2 = marker().split(' ').pop()!;
  check('ctrl-d scrolls on by half a page', /^\d+%$/.test(pct2) && parseInt(pct2) > parseInt(pct1), `${pct1} → ${pct2}`);
  stdin.press('G');
  check('G reaches the end of the issue: the last line shows, the marker says end', await until(() => stdout.last.includes('Line 200') && marker().endsWith('end')), `${marker()}\n${frameBody()}`);
  stdin.press('g');
  check('g goes back to its top', await until(() => marker() === 'more ↓'), marker());
  app.unmount();
}

{
  // the morning end to end: review CORE-4 and file a follow-up, answer the blocked agent, reply to Ada, start from Up next
  const stdout = new FakeStdout();
  stdout.rows = 40;
  const stdin = new FakeStdin();
  const waitFor = async (what: string, ok: (frame: string) => boolean, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (ok(stdout.last)) return true; await new Promise(r => setTimeout(r, 25)); }
    check(`(timed out waiting for ${what})`, false, stdout.last);
    return false;
  };
  const checkouts: string[] = [];
  const copied: string[] = [];
  const repo = () => ({ team: null, checkout: async (branch: string) => { checkouts.push(branch); return { status: 'manual' as const, branch, command: `git checkout -b ${branch}`, note: 'a test repo' }; } });
  const app = render(createElement(App, { bl: await connect({ db: morningPath }), pollMs: 60_000, animate: false, tmux: false, repo, clipboard: (t: string) => { copied.push(t); return true; } }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const key = (id: string) => mdata.keyOf(mdata.issueById.get(id)!);
  const snapNow = async () => fetchData(mbl);
  await waitFor('Today', f => f.includes('Needs you') && f.includes(key(morning.review)));
  const f0 = stdout.last;
  const once = (re: RegExp) => f0.split('\n').filter(l => re.test(l)).length === 1;
  check('Today lists each thing that needs me once: ✓ review, ✕ blocked, @ mention', once(new RegExp(`✓ ${key(morning.review)}\\s.*review`)) && once(new RegExp(`✕ ${key(morning.blocked)}\\s.*blocked`)) && once(new RegExp(`@ ${key(morning.mention)}\\s.*Ada`)), f0);
  check('In flight shows the agent at work with did and left', new RegExp(`${key(morning.working)}\\s.*agent`).test(f0) && f0.includes('did list --json · left search flags'));
  check('Up next shows the next issues with their reasons', /Up next\s+\d/.test(f0) && /Todo|due|blocks|in this cycle/.test(f0.split('Up next')[1] ?? ''));
  check('the tab says how many things need me', /1 Today \d/.test(f0.split('\n')[0]!));

  const needs = issueNeeds(mdata, now);
  const idx = needs.findIndex(r => r.issue.id === morning.review);
  stdin.press('j'.repeat(idx));
  await waitFor('cursor on the review', f => /│ enter review\s+d Done\s+b Send back/.test(f));
  check('the pane beside a review row shows the agent\'s summary, PR and what it noticed, and d/b/enter', /│ summary\s+Weighted prefix/.test(stdout.last) && /│ pr\s+#41 · open · checks ✓ · 3 commits/.test(stdout.last) && /│ noticed\s+2 follow-up drafts/.test(stdout.last));
  stdin.press('\r');
  await waitFor('review page', f => f.includes('What the agent did'));
  check('enter opens the issue page at what the agent did, with "n of N needs you"', stdout.last.includes(`${idx + 1} of ${needs.length} needs you`) && stdout.last.includes('#41 Cmd+K scoring · open · checks ✓ · 3 commits') && stdout.last.includes('It also noticed'));

  stdin.press('f');
  await waitFor('follow-ups sheet', f => f.includes(`File follow-ups from ${key(morning.review)}`) && f.includes('enter files 1 follow-up'));
  stdin.press('\r');
  await waitFor('done toast', f => f.includes(`${key(morning.review)} Done · 1 follow-up filed as`) && f.includes('u undo'));
  let live = await snapNow();
  check('f enter files the ticked follow-up from its draft and moves the issue to Done', live.stateById.get(live.issueById.get(morning.review)!.stateId)?.type === 'completed' &&
    live.drafts.filter(d => d.fromIssueId === morning.review).length === 1 && live.issues.some(i => i.title === followupsOf(mdata, morning.review)[0]!.title));
  check('…and it left Needs you', !issueNeeds(live, Date.now()).some(r => r.issue.id === morning.review));

  // auto-advance: the item now in the reviewed one's place opens without a key
  const after = needs.filter(r => r.issue.id !== morning.review);
  const plan = [after[Math.min(idx, after.length - 1)]!];
  check(`after Done the next thing that needs me opens by itself (${key(plan[0]!.issue.id)})`, await waitFor('next item', f => new RegExp(`› ${key(plan[0]!.issue.id)}`).test(f.split('\n')[0]!) && /needs you/.test(f.split('\n')[0]!)));
  for (let step = 0; step < 2; step++) {
    const r = issueNeeds(await snapNow(), Date.now());
    const id = (stdout.last.split('\n')[0]!.match(/› (\S+)/)?.[1]) ?? '';
    const row = r.find(x => key(x.issue.id) === id);
    if (!row) break;
    if (row.kind === 'blocked') {
      check('the blocked agent\'s page says what it asked', stdout.last.includes('The agent is blocked') && stdout.last.includes('SQLITE_BUSY'));
      stdin.press('b');
      await waitFor('answer sheet', f => f.includes(`Answer and rerun ${id}`));
      stdin.press('Single writer queue. Keep retries out of the store layer.');
      await waitFor('typed answer', f => f.includes('Single writer queue.'));
      stdin.press('\t');
      await new Promise(res => setTimeout(res, 60));
      stdin.press('\r');
      await waitFor('answered', f => f.includes(`Answered ${id} in a comment`));
      live = await snapNow();
      check('b, type, tab to "only post the comment", enter: the answer is a comment and the item leaves Needs you', live.comments.some(c => c.issueId === row.issue.id && c.body === 'Single writer queue. Keep retries out of the store layer.') &&
        !issueNeeds(live, Date.now()).some(x => x.issue.id === row.issue.id));
    } else if (row.kind === 'mention') {
      await waitFor('reply sheet', f => f.includes(`Reply to Ada on ${id}`));
      check('a mention opens at Ada\'s comment with the reply sheet open', stdout.last.includes('mentions you') && stdout.last.includes('should the theme persist'), stdout.last);
      stdin.press('Per account, with the device setting as a fallback.');
      await waitFor('typed reply', f => f.includes('Per account, with the device'));
      stdin.press('\r');
      await waitFor('replied', f => f.includes(`Replied on ${id} to Ada`));
      live = await snapNow();
      check('the reply is threaded under Ada\'s comment', live.comments.some(c => c.issueId === row.issue.id && c.parentId === morning.mentionCommentId && c.body.startsWith('Per account')));
    }
    await waitFor('moved on', f => !f.split('\n')[0]!.includes(`› ${id}`));
  }
  await waitFor('Today again', f => f.includes('Needs you') && f.includes('Up next'));
  check('with nothing left that needs me, I land back on Today', /Needs you/.test(stdout.last) && !/needs you/.test(stdout.last.split('\n')[0]!) && !new RegExp(`@ ${key(morning.mention)}\\s`).test(stdout.last));

  live = await snapNow();
  const rows = todayRows(todayModel(live, Date.now()), false);
  const nextAt = rows.findIndex(r => r.kind === 'next');
  const next = rows[nextAt]!;
  const nextKey = live.keyOf((next as { row: { issue: Issue } }).row.issue);
  stdin.press('g');
  if (nextAt) stdin.press('j'.repeat(nextAt));
  await waitFor('cursor on Up next', f => new RegExp(`▌ \\S ${nextKey}\\s`).test(f));
  stdin.press('\r');
  await waitFor('start sheet', f => f.includes(`Start ${nextKey}`) && /→ In Progress, yours/.test(f));
  check('the start sheet shows the branch and Todo → In Progress; without tmux, a pane needs tmux and here is the default', /branch\s+\S+/.test(stdout.last) && /needs tmux/.test(stdout.last) && /2 .*here.*default/.test(stdout.last));
  stdin.press('4');
  await waitFor('started', f => f.includes(`Started ${nextKey}`));
  live = await snapNow();
  const startedIssue = live.issues.find(i => live.keyOf(i) === nextKey)!;
  check('4 starts it the way baseline work does: In Progress, mine, its branch checked out', live.stateById.get(startedIssue.stateId)?.type === 'started' && startedIssue.assigneeId === live.currentUser.id && checkouts.length === 1);

  stdin.press('/');
  await waitFor('find', f => f.includes('try typing'));
  stdin.press('standup');
  await waitFor('standup offer', f => f.includes('Standup: what you did since yesterday'));
  stdin.press('\r');
  await waitFor('standup sheet', f => /Since \d{4}-/.test(f));
  stdin.press('c');
  await waitFor('copied', f => f.includes('Copied the standup'));
  check('/ standup shows what baseline standup prints, and c copies it', copied.some(t => t.startsWith('Since ') && t.includes(key(morning.review))));
  stdin.press('\x1b');
  await waitFor('sheet closed', f => !/Since \d{4}-/.test(f));

  stdin.press('/');
  await waitFor('find again', f => f.includes('try typing'));
  stdin.press('notifications');
  await waitFor('notifications offer', f => f.includes('All notifications'));
  stdin.press('\r');
  await waitFor('notifications sheet', f => /╭─ All notifications/.test(f));
  const sheet = stdout.last.split('\n').filter(l => l.includes('│') && l.includes(`${key(morning.review)} `));
  check('/ notifications lists one row per issue', sheet.length === 1, sheet.join('\n'));
  stdin.press('\x1b');
  await waitFor('sheet closed again', f => !/╭─ All notifications/.test(f));
  stdin.press('2');
  await waitFor('team', f => /2 Core/.test(f) && /In Progress\s+\d/.test(f));
  stdin.press('\x1b');
  check('esc from a team list is Today', await waitFor('today from team', f => /Needs you/.test(f)));
  app.unmount();
}

{
  // send finished work back with a note, then undo it
  const path = join(work, 'sendback.db');
  { const db = openDb(path); seedWorkspace(db); db.close(); }
  const m = await seedMorning(path);
  const sbl = await connect({ db: path });
  const stdout = new FakeStdout();
  stdout.rows = 40;
  const stdin = new FakeStdin();
  const waitFor = async (what: string, ok: (frame: string) => boolean, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (ok(stdout.last)) return true; await new Promise(r => setTimeout(r, 25)); }
    check(`(timed out waiting for ${what})`, false, stdout.last);
    return false;
  };
  const app = render(createElement(App, { bl: await connect({ db: path }), pollMs: 60_000, animate: false, tmux: false }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const d0 = await fetchData(sbl);
  const key = d0.keyOf(d0.issueById.get(m.review)!);
  const idx = issueNeeds(d0, Date.now()).findIndex(r => r.issue.id === m.review);
  await waitFor('Today', f => f.includes('Needs you'));
  stdin.press('j'.repeat(idx));
  await waitFor('review row', f => /│ enter review/.test(f));
  stdin.press('d');
  await waitFor('done from Today', f => f.includes(`${key} Done`) && f.includes('u undo'));
  let live = await fetchData(sbl);
  check('d on a Today row moves it to Done and takes it off Needs you, staying on Today', live.stateById.get(live.issueById.get(m.review)!.stateId)?.type === 'completed' && !issueNeeds(live, Date.now()).some(r => r.issue.id === m.review) && /Needs you/.test(stdout.last));
  stdin.press('u');
  await waitFor('undone', f => f.includes(`Undone: ${key}`));
  live = await fetchData(sbl);
  check('u puts it back In Review', live.stateById.get(live.issueById.get(m.review)!.stateId)?.name === 'In Review');

  // open it from the team list (not Needs you any more): b sends it back, the page stays
  stdin.press('/');
  await waitFor('find', f => f.includes('try typing'));
  stdin.press(key);
  await waitFor('key', f => f.includes(`› ${key}`));
  stdin.press('\r');
  await waitFor('review page', f => f.includes('What the agent did'));
  stdin.press('b');
  await waitFor('send back sheet', f => f.includes(`Send back ${key}`) && f.includes('moves to In Progress'));
  stdin.press('Exact key matches first, please.');
  await waitFor('typed', f => f.includes('Exact key matches first'));
  stdin.press('\r');
  await waitFor('sent back', f => f.includes(`${key} sent back to In Progress, with your note`) && f.includes('u undo'));
  live = await fetchData(sbl);
  check('b, a note, enter: the note is a comment and the issue is In Progress, with u undo', live.comments.some(c => c.issueId === m.review && c.body === 'Exact key matches first, please.') &&
    live.stateById.get(live.issueById.get(m.review)!.stateId)?.name === 'In Progress');
  check('…and the page no longer asks for a review (no agent section, no decision footer)', await waitFor('plain page', f => !f.includes('What the agent did') && /esc back/.test(f.split('\n').slice(-1)[0]!)));
  stdin.press('u');
  await waitFor('undone again', f => f.includes(`Undone: ${key}`));
  live = await fetchData(sbl);
  check('u after a send-back puts it back In Review (the note stays)', live.stateById.get(live.issueById.get(m.review)!.stateId)?.name === 'In Review');
  check('…and the review section is back', await waitFor('review again', f => f.includes('What the agent did')));
  stdin.press('r');
  await waitFor('read', f => f.includes('is waiting on you') || f.includes('marked read'));
  check('r on something that no longer needs you says so', stdout.last.includes(`Nothing about ${key} is waiting on you`));
  app.unmount();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
