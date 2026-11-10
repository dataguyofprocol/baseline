// The terminal UI: its pure view-model, its reducer and keymap, and one end-to-end run of the real
// App rendered by Ink against a scratch database, read back through a fresh client.
// Runs against a throwaway local database under $TMPDIR and never touches ~/.baseline.
//
//   npm run test:tui
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink';
import { createElement } from 'react';
import { connect } from '../src/client/index.js';
import { openDb } from '../src/core/db.js';
import { seedWorkspace } from '../src/core/seed.js';
import type { Issue } from '../src/core/types.js';
import { App } from '../src/tui/App.js';
import { buildData, fetchData, type TuiData } from '../src/tui/data.js';
import { BINDINGS, contextsFor, helpSections, isChordPrefix, lookup, type Context } from '../src/tui/keys.js';
import { agentCommand, agentEnv, shellPreview } from '../src/tui/launch.js';
import { peekLines } from '../src/tui/detail.js';
import {
  CLOSED_TYPES, defaultExpanded, displayWidth, fuzzyFilter, fuzzyMatch, groupIssues, issuesForRoute, lineWidth, listRows,
  markdownLines, selectableIds, sortIssues, truncate, wrap,
} from '../src/tui/model.js';
import { cycleDraft, filteredPalette, newDraft, pickerOptions } from '../src/tui/overlays.js';
import { initialState, reducer, routeKey, type Action, type TuiState } from '../src/tui/state.js';
import { editField, emptyField, fieldOf } from '../src/tui/textfield.js';

const work = mkdtempSync(join(tmpdir(), 'baseline-tui-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
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
  check('My Issues holds exactly the current user\'s issues', mine.length > 0 && mine.every(i => i.assigneeId === data.currentUser.id));
  const groups = groupIssues(mine, data);
  const order = groups.map(g => g.type);
  check('groups follow Linear order: In Progress before Todo before Backlog, closed last',
    order.indexOf('started') < order.indexOf('unstarted') && order.indexOf('unstarted') < order.indexOf('backlog') && order.slice(-2).every(t => CLOSED_TYPES.has(t)), order.join());
  check('every issue lands in the group of its state type', groups.every(g => g.issues.every(i => typeOf(i) === g.type)));
  check('group headers carry a count and the state color', groups.every(g => g.issues.length > 0 && /^#/.test(g.color)));

  const rows = listRows(groups, defaultExpanded);
  const doneRow = rows.find(r => r.kind === 'group' && r.group.type === 'completed');
  check('Done starts collapsed: its header shows, its issues do not', !!doneRow && !rows.some(r => r.kind === 'issue' && typeOf(r.issue) === 'completed'));
  const open = listRows(groups, () => true);
  check('expanding shows the closed issues', open.some(r => r.kind === 'issue' && typeOf(r.issue) === 'completed'));
  const ids = selectableIds({ kind: 'my' }, data, defaultExpanded, now);
  check('the cursor skips open group headers but stops on collapsed ones', !ids.includes('group:started') && ids.includes('group:completed'));

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
  const described = [...data.issues].sort((a, b) => b.description.length - a.description.length).find(i => data.comments.some(c => c.issueId === i.id)) ?? data.issues[0];
  const peek = peekLines(described, data, 40, 18, now);
  const peekText = peek.map(l => l.map(x => x.text).join('')).join('\n');
  check('peek: fits its box, shows key, meta, description and the last comment', peek.length <= 18 && peek.every(l => lineWidth(l) <= 40) &&
    peekText.includes(data.keyOf(described)) && peekText.includes('Status') && peekText.includes('Description') && /Comments \d+/.test(peekText), peekText);
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

  const count = selectableIds({ kind: 'my' }, data, defaultExpanded, now).length;
  const moved = run(s0, { type: 'move', delta: 3, count }, { type: 'move', delta: 999, count });
  check('moving clamps to the last row', moved.cursor.my === count - 1);
  check('moving up clamps to the first row', run(moved, { type: 'move', delta: -999, count }).cursor.my === 0);

  const at2 = run(s0, { type: 'move', delta: 2, count });
  const idAt2 = selectableIds({ kind: 'my' }, data, defaultExpanded, now)[2];
  const urgent: Issue = { ...issue, id: 'i_new_urgent', number: 999, priority: 1, sortOrder: -1, stateId: data.issueById.get(idAt2)!.stateId };
  const grown: TuiData = buildData({ ...data, issues: [urgent, ...data.issues] });
  const after = run(at2, { type: 'loaded', data: grown, at: now + 1 });
  check('a refetch that inserts a row above keeps the cursor on the same issue', selectableIds({ kind: 'my' }, grown, defaultExpanded, now)[after.cursor.my] === idAt2);

  const gone = run(s1, { type: 'loaded', data: buildData({ ...data, issues: data.issues.filter(i => i.id !== issue.id) }), at: now + 2 });
  check('an open issue that disappears goes back with a note', gone.route.kind === 'my' && gone.toast?.tone === 'info');

  const picker = run(s0, { type: 'openOverlay', overlay: { kind: 'picker', field: 'state', issueId: issue.id, input: emptyField, cursor: 0, selected: [] } });
  check('opening a picker sets the overlay', picker.overlay.kind === 'picker');
  const wrapped = run(picker, { type: 'overlayMove', delta: -1, count: 5 });
  check('picker movement wraps around', wrapped.overlay.kind === 'picker' && wrapped.overlay.cursor === 4);
  const filtered = run(wrapped, { type: 'editInput', input: fieldOf('do') });
  check('typing a filter resets the picker cursor', filtered.overlay.kind === 'picker' && filtered.overlay.cursor === 0 && filtered.overlay.input.value === 'do');
  check('closing returns to no overlay', run(filtered, { type: 'closeOverlay' }).overlay.kind === 'none');

  const labels = run(s0, { type: 'openOverlay', overlay: { kind: 'picker', field: 'labels', issueId: issue.id, input: emptyField, cursor: 0, selected: ['l1'] } }, { type: 'pickerToggle', id: 'l2' }, { type: 'pickerToggle', id: 'l1' });
  check('the labels picker toggles a set', labels.overlay.kind === 'picker' && labels.overlay.selected.join() === 'l2');

  const draft = newDraft({ route: { kind: 'team', teamId: team.id }, stack: [] }, data);
  check('a new issue defaults to the team in view', draft.teamId === team.id && draft.assigneeId === null);
  check('on My Issues a new issue is assigned to me', newDraft({ route: { kind: 'my' }, stack: [] }, data).assigneeId === data.currentUser.id);
  const otherTeam = data.teams[1];
  const switched = cycleDraft('team', draft, 1, data);
  check('changing the team resets the state to that team\'s', switched.teamId === otherTeam.id && data.stateById.get(switched.stateId!)?.teamId === otherTeam.id);
  const compose = run(s0, { type: 'openOverlay', overlay: { kind: 'compose', target: 'issue', field: 'title', input: emptyField, draft } }, { type: 'composeField', delta: -1 });
  check('shift-tab from the title wraps to the last field', compose.overlay.kind === 'compose' && compose.overlay.target === 'issue' && compose.overlay.field === 'project');

  const opts = pickerOptions('assignee', issue, data);
  check('the assignee picker offers me first and unassign last', opts[0].id === data.currentUser.id && opts[0].hint === 'me' && opts[opts.length - 1].label === 'No assignee');
  check('routeKey separates routes of the same kind', routeKey({ kind: 'team', teamId: 'a' }) !== routeKey({ kind: 'team', teamId: 'b' }));

  const visible = selectableIds({ kind: 'my' }, data, defaultExpanded, now);
  const onFirst = run(s0, { type: 'navigate', route: { kind: 'issue', issueId: visible[0] } });
  const stepped = run(onFirst, { type: 'stepIssue', delta: 1, now });
  check('J on an issue page opens the next issue of the list it came from', stepped.route.kind === 'issue' && stepped.route.issueId === visible[1] && stepped.stack.length === 1);
  check('…and back lands the list cursor on that issue', run(stepped, { type: 'back' }).cursor.my === 1);
  check('K on the first issue stays put with a note', run(onFirst, { type: 'stepIssue', delta: -1, now }).route === onFirst.route && run(onFirst, { type: 'stepIssue', delta: -1, now }).toast?.tone === 'info');

  const key4 = data.keyOf(issue);
  const pal = (q: string) => filteredPalette({ kind: 'palette', input: fieldOf(q), cursor: 0 }, s0, data, now).map(r => r.item);
  check('the palette finds an issue by its key and jumps there', pal(key4)[0]?.id === `issue:${issue.id}`, pal(key4).slice(0, 3).map(i => i.label).join(' | '));
  check('> in the palette lists commands only', pal('>').length > 0 && pal('>').every(i => 'command' in i.run) && pal('>status').every(i => 'command' in i.run));
  check('palette commands show their key', pal('>assign to me')[0]?.hint === 'i');
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
  check('j moves on lists and scrolls the issue page, through one binding', lookup(['detail', 'global'], 'j') === lookup(['list', 'global'], 'j') && lookup(['list', 'global'], 'j')?.command === 'down');
  check('Linear keys: i assigns to me, r renames, e edits the description, b copies the branch, Y the URL',
    lookup(['list', 'global'], 'i')?.command === 'assignMe' && lookup(['detail', 'global'], 'r')?.command === 'editTitle' && lookup(['list', 'global'], 'e')?.command === 'editDescription' &&
    lookup(['list', 'global'], 'b')?.command === 'copyBranch' && lookup(['detail', 'global'], 'Y')?.command === 'copyUrl' && lookup(['inbox', 'global'], 'r')?.command === 'markRead');
  check('g starts a chord on lists but is text in a search box', isChordPrefix(['list', 'global'], 'g') && !isChordPrefix(['finder'], 'g') && lookup(['list', 'global'], 'g i')?.command === 'gotoInbox');
  const help = helpSections().flatMap(sec => sec.rows.map(r => `${sec.group}|${r.key}|${r.label}`));
  check('the help overlay has no duplicate rows, and one j/k row for lists and the issue page',
    new Set(help).size === help.length && help.filter(r => r.startsWith('Move|j/k')).length === 1, help.filter((r, i) => help.indexOf(r) !== i).join(', '));
  const pickerState = run(st, { type: 'openOverlay', overlay: { kind: 'picker', field: 'priority', issueId: data.issues[0].id, input: emptyField, cursor: 0, selected: [] } });
  check('a picker takes digits and j/k until you type, then they are text',
    lookup(contextsFor(pickerState, true), '3')?.command === 'pickerPick' && lookup(contextsFor(pickerState, true), 'j')?.command === 'overlayDown' &&
    lookup(contextsFor(run(pickerState, { type: 'editInput', input: fieldOf('h') }), true), 'j') === undefined);
  check('letters typed into a search box are text, not commands', lookup(['finder'], 's') === undefined && lookup(['finder'], 'q') === undefined);
  check('space toggles in the labels picker only', lookup(['multipicker', 'picker'], 'space')?.command === 'pickerToggle' && lookup(['picker'], 'space') === undefined);
  check('ctrl-c quits from anywhere, even inside an overlay', ['boot', 'finder', 'picker', 'compose', 'help', 'confirm'].every(c => lookup([c as Context], 'ctrl+c')?.command === 'quit'));
  check('a compose title field is a text context', contextsFor(run(st, { type: 'openOverlay', overlay: { kind: 'compose', target: 'issue', field: 'title', input: emptyField, draft: newDraft(st, data) } }), true).join() === 'compose-issue,compose');
  check('the sidebar takes keys only when it is visible', contextsFor({ ...st, focus: 'sidebar' }, false)[0] === 'list' && contextsFor({ ...st, focus: 'sidebar' }, true)[0] === 'sidebar');
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
    check(`(timed out waiting for ${what})`, false, stdout.last.split('\n').slice(0, 12).join('\n'));
    return false;
  };

  const app = render(createElement(App, { bl: await connect({ db: dbPath }), pollMs: 60_000 }), {
    stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });

  const mine = issuesForRoute({ kind: 'my' }, data);
  const openKeys = mine.filter(i => !CLOSED_TYPES.has(typeOf(i))).map(i => data.keyOf(i));
  await waitFor('My Issues', f => f.includes('My Issues') && f.includes(openKeys[0]));
  const frame = stdout.last;
  check('My Issues renders every open issue assigned to me', openKeys.every(k => frame.includes(k)), openKeys.filter(k => !frame.includes(k)).join(', '));
  check('group headers render with counts', /In Progress\s+\d+/.test(frame) && /Todo\s+\d+/.test(frame));
  check('the footer shows hints from the keymap', frame.includes('s status') && frame.includes('? help'));
  check('the sidebar lists every team at 120 columns', data.teams.every(t => frame.includes(t.name)));

  const target = data.issueById.get(selectableIds({ kind: 'my' }, data, defaultExpanded, now)[0])!;
  const next = data.states.filter(s => s.teamId === target.teamId && s.id !== target.stateId).sort((a, b) => a.position - b.position).find(s => s.type === 'completed')!;
  stdin.press('s');
  await waitFor('status picker', f => f.includes('Change status'));
  stdin.press(next.name);
  await waitFor('filtered picker', f => f.includes(`› ${next.name}`));
  stdin.press('\r');
  await waitFor('state toast', f => f.includes(`${data.keyOf(target)} → ${next.name}`));
  const fresh = await connect({ db: dbPath });
  check('s → choosing a state changes it, as a fresh client reads it', (await fresh.getIssue(target.id))?.stateId === next.id);

  stdin.press('/');
  await waitFor('search', f => f.includes('Search'));
  const other = mine.find(i => i.id !== target.id)!;
  stdin.press(data.keyOf(other));
  await waitFor('search results', f => f.includes('match'));
  stdin.press('\r');
  await waitFor('issue page', f => f.includes('Description') && f.includes(other.title));
  check('/ → typing a key → enter opens that issue', stdout.last.includes(data.keyOf(other)));

  stdin.press('m');
  await waitFor('comment box', f => f.includes('Comment'));
  stdin.press('Reviewed from the terminal');
  await waitFor('typed comment', f => f.includes('Reviewed from the terminal'));
  stdin.press('\r');
  await waitFor('comment toast', f => f.includes(`Commented on ${data.keyOf(other)}`));
  const snap = await fresh.snapshot(['comments']);
  check('m → a comment is saved on the open issue', snap.comments.some(c => c.issueId === other.id && c.body === 'Reviewed from the terminal'));

  stdin.press('\x1b');
  await waitFor('back to the list', f => f.includes('My Issues') && !f.includes('Description'));
  stdin.press('c');
  await waitFor('new issue form', f => f.includes('New issue'));
  stdin.press('Filed from the TUI test');
  await waitFor('typed title', f => f.includes('Filed from the TUI test'));
  stdin.press('\r');
  await waitFor('created toast', f => f.includes('Created') && f.includes('Filed from the TUI test'));
  const created = (await fresh.listIssues({ query: 'Filed from the TUI test' }))[0];
  check('c → enter creates the issue, assigned to me from My Issues', !!created && created.assigneeId === data.currentUser.id);

  const second = selectableIds({ kind: 'my' }, data, defaultExpanded, now)[1];
  const secondTitle = (await fresh.getIssue(second))!.title;
  stdin.press('ggj\r');
  await waitFor('burst opens the second issue', f => f.includes('Description') && f.includes(secondTitle));
  check('a burst of keys in one chunk (tmux send-keys) acts as separate presses', stdout.last.includes(secondTitle));
  const third = selectableIds({ kind: 'my' }, await fetchData(fresh), defaultExpanded, now)[2];
  const thirdTitle = (await fresh.getIssue(third))!.title;
  stdin.press('J');
  await waitFor('J opens the next issue', f => f.includes('Description') && f.includes(thirdTitle));
  check('J on the issue page opens the next issue in the list', stdout.last.includes(thirdTitle));
  stdin.press('\x1b');
  await waitFor('back to the list again', f => f.includes('My Issues') && !f.includes('Description'));

  stdin.press('g');
  await waitFor('chord pending', f => f.includes('g…'));
  check('the footer shows g… and the chord endings while g waits', stdout.last.includes('g…') && stdout.last.includes('Inbox'));
  stdin.press('i');
  await waitFor('Inbox', f => /Inbox\s+(\d+ unread|all read)/.test(f));
  check('g i goes to the Inbox', /Inbox\s+(\d+ unread|all read)/.test(stdout.last));
  stdin.press('g');
  await waitFor('chord pending again', f => f.includes('g…'));
  stdin.press('m');
  await waitFor('My Issues again', f => /My Issues\s+\d+ open/.test(f));

  const live = await fetchData(fresh);
  const pick = live.issueById.get(selectableIds({ kind: 'my' }, live, defaultExpanded, now)[0])!;
  stdin.press('ggp');
  await waitFor('priority picker', f => f.includes('Set priority'));
  stdin.press('4');
  await waitFor('priority toast', f => f.includes(`${live.keyOf(pick)} → Low`));
  check('a digit in a picker picks that option (p 4 → Low)', (await fresh.getIssue(pick.id))?.priority === 4);

  check('no peek pane at 120 columns with the sidebar', !stdout.last.includes('── Description'));
  stdin.press(' ');
  await waitFor('peek pane', f => f.includes('── Description') && f.includes('Status'));
  check('space opens the peek pane beside the list, on the issue under the cursor', stdout.last.includes(pick.title.slice(0, 20)) && /My Issues\s+\d+ open/.test(stdout.last));
  stdin.press('j');
  const relisted = await fetchData(fresh);
  const ids = selectableIds({ kind: 'my' }, relisted, defaultExpanded, now);
  const nextRow = relisted.issueById.get(ids[ids.indexOf(pick.id) + 1])!;
  await waitFor('peek follows the cursor', f => f.includes(`${live.keyOf(nextRow)}  `) && f.split(live.keyOf(nextRow)).length > 2);
  check('the peek pane follows the cursor', stdout.last.split(live.keyOf(nextRow)).length > 2);
  stdin.press(' ');
  await waitFor('peek closed', f => !f.includes('── Description'));

  stdin.press('q');
  const exited = await Promise.race([app.waitUntilExit().then(() => true), new Promise(r => setTimeout(() => r(false), 3000))]);
  check('q on a top-level screen exits', exited === true);
}

const root = join(import.meta.dirname, '..');
const cli = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(join(root, 'node_modules/.bin/tsx'), [join(root, 'src/cli/index.ts'), ...args], { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TSX_TSCONFIG_PATH: join(root, 'tsconfig.node.json'), ...env } });

{
  const r = cli([], { BASELINE_DB: dbPath });
  check('bare `baseline` without a terminal prints help instead of opening the TUI', `${r.stdout}${r.stderr}`.includes('Usage: baseline') && !`${r.stdout}${r.stderr}`.includes('needs an interactive terminal'), r.stderr.slice(0, 200));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
