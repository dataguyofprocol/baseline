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
import { BINDINGS, contextsFor, lookup, type Context } from '../src/tui/keys.js';
import { helpSections, MENUS, menuTrail, rowLabel } from '../src/tui/menus.js';
import { agentCommand, agentEnv, paneCommand, shellPreview } from '../src/tui/launch.js';
import { findSections } from '../src/tui/commands.js';
import { findItems, wordMatch } from '../src/tui/find.js';
import { prepareStart } from '../src/tui/index.js';
import { sessionPath, sessionWriter, targetId, workspaceDir, type SessionFile } from '../src/tui/session.js';
import {
  CLOSED_TYPES, DEFAULT_VIEW, defaultExpanded, displayWidth, GROUP_BYS, inboxItems, listRowsFor, fuzzyFilter, fuzzyMatch, groupIssues, issuesForRoute, lineWidth, listRows,
  markdownLines, selectableIds, sortIssues, truncate, wrap,
} from '../src/tui/model.js';
import { cycleDraft, newDraft, pickerOptions } from '../src/tui/overlays.js';
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

{
  const base = data.issues[0];
  const fake = ([1, 0, 4, 2, 3] as const).map((priority, n) => ({ ...base, id: `x${n}`, number: 900 + n, priority, sortOrder: n }));
  check('sortIssues: urgent, high, medium, low, then no priority', sortIssues(fake).map(i => i.priority).join() === '1,2,3,4,0', sortIssues(fake).map(i => i.priority).join());

  const mine = issuesForRoute({ kind: 'my' }, data);
  check('My work holds exactly the current user\'s issues', mine.length > 0 && mine.every(i => i.assigneeId === data.currentUser.id));
  const groups = groupIssues(mine, data);
  const order = groups.map(g => g.key as WorkflowStateType);
  check('groups follow Linear order: In Progress before Todo before Backlog, closed last',
    order.indexOf('started') < order.indexOf('unstarted') && order.indexOf('unstarted') < order.indexOf('backlog') && order.slice(-2).every(t => CLOSED_TYPES.has(t)), order.join());
  check('every issue lands in the group of its state type', groups.every(g => g.issues.every(i => typeOf(i) === g.key)));
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
  const active = listRowsFor({ kind: 'my' }, data, { ...DEFAULT_VIEW, preset: 'active' }).filter(r => r.kind === 'issue');
  check('the Active preset shows only started and unstarted issues', active.length > 0 && active.every(r => r.kind === 'issue' && ['started', 'unstarted'].includes(typeOf(r.issue))));

  const rows = listRows(groups, defaultExpanded);
  const doneRow = rows.find(r => r.kind === 'group' && r.group.key === 'completed');
  check('Done starts collapsed: its header shows, its issues do not', !!doneRow && !rows.some(r => r.kind === 'issue' && typeOf(r.issue) === 'completed'));
  const open = listRows(groups, () => true);
  check('expanding shows the closed issues', open.some(r => r.kind === 'issue' && typeOf(r.issue) === 'completed'));
  const ids = selectableIds({ kind: 'my' }, data, DEFAULT_VIEW, now);
  check('the cursor skips open group headers but stops on collapsed ones', !ids.includes('group:status:started') && ids.includes('group:status:completed'));

  check('fuzzy: a subsequence matches across words', !!fuzzyMatch('cmdk', 'Cmd+K fuzzy search scoring'));
  check('fuzzy: letters out of order don\'t match', fuzzyMatch('zq', 'Cmd+K fuzzy search scoring') === null);
  const ranked = fuzzyFilter(['Persist theme choice per device', 'Theme switching without reload', 'Audit color tokens for both themes'], 'theme', t => t);
  check('fuzzy: an early word-start match ranks first', ranked[0]?.item === 'Theme switching without reload', ranked.map(r => r.item).join(' | '));
  check('fuzzy: the key is searchable ("core4" finds CORE-4)', !!fuzzyMatch('core4', 'CORE-4 Cmd+K fuzzy search scoring'));

  check('truncate ends in an ellipsis inside the width', truncate('Theme switching without reload', 10) === 'Theme swi…');
  check('wide characters count as two cells', displayWidth('漢字ab') === 6 && displayWidth(truncate('漢字漢字漢字', 5)) <= 5);
  const text = 'One CLI covering the whole store so coding agents never need the UI, with a verylongunbreakablewordthatmustbesplit.';
  check('wrap never exceeds the width', [12, 20, 33].every(w => wrap(text, w).every(l => lineWidth(l) <= w)));

  const md = markdownLines('# Plan\n\n- first `code`\n- [x] done\n\n| a | bb |\n| --- | --- |\n| 1 | 2 |\n\n```\nconst x = 1;\n```', 40);
  check('markdown: headings are bold', md[0].every(s => s.bold) && md[0].map(s => s.text).join('') === 'Plan');
  check('markdown: bullets and task items get glyphs', md.some(l => l[0]?.text.startsWith('• ')) && md.some(l => l[0]?.text.includes('☑')));
  check('markdown: tables align their columns', md.some(l => l.map(s => s.text).join('') === 'a │ bb') && md.some(l => l.map(s => s.text).join('') === '1 │ 2 '));
  check('markdown: fenced code is dim', md.some(l => l[0]?.dim && l[0].text.includes('const x = 1;')));
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
  const s0 = run(initialState(), { type: 'loaded', data, at: now });
  check('loading data marks the app ready', s0.status === 'ready' && s0.data === data && s0.syncedAt === now);
  const issue = issuesForRoute({ kind: 'my' }, data)[0];
  const s1 = run(s0, { type: 'navigate', route: { kind: 'issue', issueId: issue.id } });
  check('navigate pushes the previous route', s1.route.kind === 'issue' && s1.stack.length === 1 && s1.stack[0].kind === 'my');
  check('back pops it', run(s1, { type: 'back' }).route.kind === 'my' && run(s1, { type: 'back' }).stack.length === 0);
  check('back on a top-level screen stays put', run(s0, { type: 'back' }).route.kind === 'my');
  const team = data.teams[0];
  check('switching views clears the stack', run(s1, { type: 'switchView', route: { kind: 'team', teamId: team.id } }).stack.length === 0);

  const count = selectableIds({ kind: 'my' }, data, DEFAULT_VIEW, now).length;
  const moved = run(s0, { type: 'move', delta: 3, count }, { type: 'move', delta: 999, count });
  check('moving clamps to the last row', moved.cursor.my === count - 1);
  check('moving up clamps to the first row', run(moved, { type: 'move', delta: -999, count }).cursor.my === 0);

  const at2 = run(s0, { type: 'move', delta: 2, count });
  const idAt2 = selectableIds({ kind: 'my' }, data, DEFAULT_VIEW, now)[2];
  const urgent: Issue = { ...issue, id: 'i_new_urgent', number: 999, priority: 1, sortOrder: -1, stateId: data.issueById.get(idAt2)!.stateId };
  const grown: TuiData = buildData({ ...data, issues: [urgent, ...data.issues] });
  const after = run(at2, { type: 'loaded', data: grown, at: now + 1 });
  check('a refetch that inserts a row above keeps the cursor on the same issue', selectableIds({ kind: 'my' }, grown, DEFAULT_VIEW, now)[after.cursor.my] === idAt2);

  const gone = run(s1, { type: 'loaded', data: buildData({ ...data, issues: data.issues.filter(i => i.id !== issue.id) }), at: now + 2 });
  check('an open issue that disappears goes back with a note', gone.route.kind === 'my' && gone.toast?.tone === 'info');

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
  check('on My work a new issue is assigned to me', newDraft({ route: { kind: 'my' }, stack: [] }, data).assigneeId === data.currentUser.id);
  const otherTeam = data.teams[1];
  const switched = cycleDraft('team', draft, 1, data);
  check('changing the team resets the state to that team\'s', switched.teamId === otherTeam.id && data.stateById.get(switched.stateId!)?.teamId === otherTeam.id);
  const compose = run(s0, { type: 'openOverlay', overlay: { kind: 'compose', target: 'issue', field: 'title', input: emptyField, draft } }, { type: 'composeField', delta: -1 });
  check('shift-tab from the title wraps to the last field', compose.overlay.kind === 'compose' && compose.overlay.target === 'issue' && compose.overlay.field === 'project');

  const opts = pickerOptions('assignee', issue, data);
  check('the assignee picker offers Me first and unassign last', opts[0].id === data.currentUser.id && opts[0].label === 'Me' && opts[opts.length - 1].label === 'No assignee');
  check('routeKey separates routes of the same kind', routeKey({ kind: 'team', teamId: 'a' }) !== routeKey({ kind: 'team', teamId: 'b' }));

  const firstGroup = groupIssues(issuesForRoute({ kind: 'my' }, data), data)[0];
  const folded = run(s0, { type: 'toggleGroup', groupId: firstGroup.id });
  check('folding a group puts the cursor on its header', cursorRow(folded)?.id === `group:${firstGroup.id}` &&
    !listRowsFor({ kind: 'my' }, data, listViewOf(folded, { kind: 'my' })).some(r => r.kind === 'issue' && firstGroup.issues.some(i => i.id === r.id)));
  check('toggling again unfolds it', run(folded, { type: 'toggleGroup', groupId: firstGroup.id }).expanded[`my|${firstGroup.id}`] === true);
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
  check('removed keys answer nothing: g, D, J, z, ctrl-b, ctrl-k', ['g', 'D', 'J', 'z', 'ctrl+b', 'ctrl+k', 'g i'].every(k => !lookup(['list', 'global'], k)));
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
  const st = run(initialState(), { type: 'loaded', data, at: now });
  const target = data.issueById.get(selectableIds({ kind: 'my' }, data, DEFAULT_VIEW, now)[0])!;
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
  check('the space menu has the list\'s own letters: s a p l m e w c o n', MENUS.actions.rows.map(r => r.key).join(' ') === 's a p l m e w c o n');
  check('…and each of them works on the list without space', MENUS.actions.rows.every(r => lookup(['list', 'global'], r.key)?.command === r.command));
  check('the agent menu: h here, n new pane, p prompt, b branch', MENUS.agent.rows.map(r => `${r.key}:${r.command}`).join() === 'h:agentHere,n:agentPane,p:copyPrompt,b:copyBranch');
  const mc = { issue: target, data, handoff: undefined, env: {}, where: { cwd: '/x', note: null }, now };
  const pane = MENUS.agent.rows.find(r => r.key === 'n')!;
  check('a new pane needs tmux: off without $TMUX, with a reason', pane.enabled!(mc) !== true && pane.enabled!({ ...mc, env: { TMUX: '/tmp/tmux' } }) === true);
  check('$BASELINE_AGENT keeps the label generic', rowLabel(MENUS.agent.rows[0], mc) === 'Start Claude Code here' && rowLabel(MENUS.agent.rows[0], { ...mc, env: { BASELINE_AGENT: 'codex' } }) === 'Start the agent here');
  check('the menu trail names the keys that led there', menuTrail(['actions', 'agent']).join(' ') === 'space w' && menuTrail(['copy']).join(' ') === 'c');
  const menu = run(st, { type: 'openOverlay', overlay: { kind: 'menu', path: ['actions'], issueId: target.id, cursor: 0 } }, { type: 'menuPush', menu: 'agent' });
  check('backspace steps out of a submenu, then closes the menu', menu.overlay.kind === 'menu' && run(menu, { type: 'menuBack' }).overlay.kind === 'menu' && run(menu, { type: 'menuBack' }, { type: 'menuBack' }).overlay.kind === 'none');
  check('paneCommand splits tmux beside this pane in the issue\'s directory', paneCommand(['claude', 'go'], { cwd: '/w', target: { kind: 'local', dbPath: '/d.db', source: 'flag' }, issueKey: 'CORE-1' }).join(' ') ===
    'tmux split-window -h -c /w -e BASELINE_ISSUE=CORE-1 -e BASELINE_DB=/d.db -e BASELINE_URL= -e BASELINE_TOKEN= claude go');

  const entry = (n: number) => ({ issueId: `i${n}`, key: `K-${n}`, field: 'state' as const, before: {}, after: {}, label: '' });
  const stacked = Array.from({ length: 25 }, (_, n) => n).reduce((x, n) => run(x, { type: 'pushUndo', entry: entry(n) }), st);
  check('the undo stack keeps the newest 20', stacked.undo.length === 20 && stacked.undo[19].issueId === 'i24' && stacked.undo[0].issueId === 'i5');
  check('popping undo drops the newest', run(stacked, { type: 'popUndo' }).undo[18].issueId === 'i23');
  const help = helpSections().map(sec => sec.group);
  check('help is grouped by task', help.join() === 'Move around,Change an issue,Agents and copying,Find and views');
  check('help lists each submenu\'s letters under its key', helpSections().some(sec => sec.rows.some(r => r.key === 'w h')));
}

{
  check('BASELINE_AGENT may carry flags; the prompt is the last argument', agentCommand('do it', { BASELINE_AGENT: 'claude --model opus' }).join('|') === 'claude|--model|opus|do it');
  check('the agent defaults to claude', agentCommand('p', {})[0] === 'claude');
  const env = agentEnv({ kind: 'local', dbPath: '/tmp/x.db', source: 'flag' }, 'CORE-1', { BASELINE_URL: 'https://x', BASELINE_TOKEN: 't' });
  check('an agent started from a --db TUI writes to that same database', env.BASELINE_DB === '/tmp/x.db' && !env.BASELINE_URL && env.BASELINE_ISSUE === 'CORE-1');
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
  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000, clipboard: (t: string) => { copied.push(t); return true; } }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const fresh = await connect({ db: dbPath });

  const mine = issuesForRoute({ kind: 'my' }, data);
  const openKeys = mine.filter(i => !CLOSED_TYPES.has(typeOf(i))).map(i => data.keyOf(i));
  await waitFor('My work', f => f.includes('1 My work') && f.includes(openKeys[0]));
  const frame = stdout.last;
  check('My work renders every open issue assigned to me', openKeys.every(k => frame.includes(k)), openKeys.filter(k => !frame.includes(k)).join(', '));
  check('group headers render with counts', /In Progress\s+\d+/.test(frame) && /Todo\s+\d+/.test(frame));
  check('the tab bar numbers My work, Inbox, each team and Projects', new RegExp(`1 My work \\d+\\s+2 Inbox.*3 ${data.teams[0].name}\\s+4 ${data.teams[1].name}\\s+5 Projects`).test(frame), frame.split('\n')[0]);
  check('the footer is one line: ↑↓ move, enter open, 1-5 tabs, / find, space all actions, ? help', /↑↓ move\s+enter open\s+1-5 tabs\s+\/ find\s+space all actions\s+\? help/.test(frame), frame.split('\n').slice(-2).join('\n'));
  check('the detail pane shows the issue under the cursor with a key on each field', /│ s Status/.test(frame) && /│ a Assignee/.test(frame) && /│ p Priority/.test(frame) && /│ l Labels/.test(frame) && /│ w Work on it with an agent\s+c copy/.test(frame));

  const inbox = inboxItems(data, now);
  stdin.press('2');
  await waitFor('Inbox', f => f.includes(inbox[0].subject.slice(0, 20)) && f.includes(`${inbox[0].who} ${inbox[0].verb}`));
  check('2 goes to the Inbox, and the pane shows the selected notification and its issue', stdout.last.includes(inbox[0].subject.slice(0, 20)) && /│ s Status/.test(stdout.last));
  stdin.press('1');
  await waitFor('My work again', f => f.includes(openKeys[0]) && /◐ In Progress/.test(f));

  const target = data.issueById.get(selectableIds({ kind: 'my' }, data, DEFAULT_VIEW, now)[0])!;
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
  await waitFor('space menu', f => f.includes('space › _') && f.includes('waiting for the next key: s a p l m e w c o n'));
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

  const opened = mine.find(i => i.id !== target.id && !CLOSED_TYPES.has(typeOf(i)))!;
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
  await waitFor('back to the list', f => f.includes('1 My work') && !f.includes('── Description'));
  stdin.press('n');
  await waitFor('new issue form', f => f.includes('New issue'));
  stdin.press('Filed from the TUI test');
  await waitFor('typed title', f => f.includes('Filed from the TUI test'));
  stdin.press('\r');
  await waitFor('created toast', f => f.includes('Created') && f.includes('Filed from the TUI test'));
  const created = (await fresh.listIssues({ query: 'Filed from the TUI test' }))[0];
  check('n → enter creates the issue, assigned to me from My work', !!created && created.assigneeId === data.currentUser.id);

  const liveIds = selectableIds({ kind: 'my' }, await fetchData(fresh), DEFAULT_VIEW, now);
  const secondTitle = (await fresh.getIssue(liveIds[1]))!.title;
  stdin.press(`${'k'.repeat(20)}j\r`);
  await waitFor('burst opens the second issue', f => f.includes('── Description') && f.includes(secondTitle));
  check('a burst of keys in one chunk (tmux send-keys) acts as separate presses', stdout.last.includes(secondTitle));
  stdin.press('\x1b');
  await waitFor('list once more', f => !f.includes('── Description'));

  const live = await fetchData(fresh);
  const pick = live.issueById.get(selectableIds({ kind: 'my' }, live, DEFAULT_VIEW, now)[0])!;
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
  for (const k of ['g', 'D', 'J', 'z', 'G']) stdin.press(k);
  await settle(400);
  check('removed keys (g, D, J, z, G) do nothing', body(stdout.last) === before && !stdout.last.includes('by priority'), body(stdout.last).split('\n').slice(0, 6).join('\n'));

  stdin.press('?');
  await waitFor('help card', f => f.includes('Baseline, in your terminal'));
  stdin.press('jjjjjjjjjjjjjjjjjjjjjjjj');
  await waitFor('every key', f => f.includes('Move around') && f.includes('Agents and copying'));
  check('? shows the card, then every key grouped by task', stdout.last.includes('Change an issue') && stdout.last.includes('Find and views'));
  stdin.press('\r');
  await waitFor('help closed', f => !f.includes('Agents and copying'));

  stdin.press('q');
  const exited = await Promise.race([app.waitUntilExit().then(() => true), new Promise(r => setTimeout(() => r(false), 3000))]);
  check('q on a tab exits', exited === true);
}

{
  const stdout = new FakeStdout();
  stdout.columns = 80;
  stdout.rows = 24;
  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000 }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: new FakeStdin() as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const until = async (ok: () => boolean, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end && !ok()) await new Promise(r => setTimeout(r, 25)); return ok(); };
  await until(() => stdout.last.includes('1 My work') && /◐ In Progress/.test(stdout.last));
  check('below 100 columns there is no detail pane, the list takes the width', !stdout.last.includes('s Status') && !stdout.last.includes(' │ '), stdout.last);
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
  check('…which shows the five keys and enter start', stdout.last.includes('Baseline, in your terminal') && stdout.last.includes('everything you can do with it') && /enter start/.test(stdout.last));
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

  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000, onContext: writer.update }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await until(() => stdout.last.includes('My work'));
  stdin.press('jj');
  const live = await fetchData(await connect({ db: dbPath }));
  const ids = selectableIds({ kind: 'my' }, live, DEFAULT_VIEW, Date.now());
  const third = live.issueById.get(ids[2])!;
  const thirdKey = live.keyOf(third);
  await until(() => read()?.list?.cursorKey === thirdKey);
  const file = read();
  check('moving the cursor writes the state file: route, list rows and the cursor key', file?.version === 1 && file.route.kind === 'my' && file.list?.cursorKey === thirdKey && file.list.rows.length > 2 && file.pid === process.pid, JSON.stringify(file?.list?.cursorKey));

  const ctx = cli(['context', '--db', dbPath]);
  const marked = ctx.stdout.split('\n').filter(l => l.includes('← cursor'));
  const position = (file?.list?.rows ?? []).findIndex(r => r.key === thirdKey) + 1;
  check('`baseline context` marks the cursor on the right row of the list', ctx.status === 0 && marked.length === 1 && marked[0].startsWith(`${position}. ${thirdKey} `), ctx.stdout + ctx.stderr);
  check('`baseline context` says what is showing and that the TUI is open', ctx.stdout.includes('- Showing: My work') && ctx.stdout.includes(`pid ${process.pid}, open,`), ctx.stdout.split('\n')[0]);
  const json = cli(['context', '--json', '--db', dbPath]);
  check('`baseline context --json` prints the file', json.status === 0 && JSON.parse(json.stdout).list.cursorKey === thirdKey && JSON.parse(json.stdout).open === true);

  stdin.press('\r');
  await until(() => read()?.route.kind === 'issue');
  check('opening an issue records it as the open issue', read()?.openIssue?.key === thirdKey, JSON.stringify(read()?.openIssue));
  app.unmount();
  writer.flush();

  const bl2 = await connect({ db: dbPath });
  const start = await prepareStart(bl2, {}, workspace);
  check('the next start reopens the same issue, grouping and list', start.route?.kind === 'issue' && start.route.issueId === third.id && start.stack?.[0]?.kind === 'my' && start.start?.groupBy === 'status');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
