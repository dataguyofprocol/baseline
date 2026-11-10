import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';
import { openDb } from '../src/core/db.js';
import { Store } from '../src/core/store.js';
import { HttpBaseline } from '../src/client/baseline.js';
import type { Transport } from '../src/client/transport.js';
import { OPERATIONS } from '../src/ops/index.js';
import { agentActor, actorFrom } from '../src/ops/identity.js';
import { annotationsOf, OP_ALIASES, OpError, runOp, type AnyOperation, type OpContext, type OpName, type SessionKey } from '../src/ops/operation.js';

const work = mkdtempSync(join(tmpdir(), 'baseline-ops-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const { app, store, db } = createApp(join(work, 'ops.db'), { mode: 'local' }, { configured: false, send: async () => {} });
store.ext.git.ensureInReview();
const snap0 = store.snapshot();
const owner = snap0.currentUser;
const agent = snap0.users.find(u => u.id === store.agentUserId())!;
const ada = snap0.users.find(u => u.name === 'Ada Osei')!;
const key = store.ext.apiKeys.create({ name: 'ops test', userId: owner.id, scopes: ['read', 'write'] });

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || detail === '' ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

const transport = (token: string | null): Transport => ({
  async request(method, path, opts) {
    const q = new URLSearchParams(Object.entries(opts?.query ?? {}).filter((e): e is [string, string] => e[1] !== undefined));
    const res = await app.request(`http://localhost${path}${q.size ? `?${q}` : ''}`, {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts?.json !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: opts?.json !== undefined ? JSON.stringify(opts.json) : undefined,
    });
    return { status: res.status, body: await res.json() };
  },
});
const bl = new HttpBaseline({ kind: 'remote', url: new URL('http://localhost'), token: key.token, source: 'env' }, transport(key.token));
const ctxFor = async (as: string | undefined, session: string | null = null): Promise<OpContext> => ({ bl, actor: await actorFrom(bl, as), session: session as SessionKey | null });
const agentCtx: OpContext = { bl, actor: await agentActor(bl, undefined), session: 's1' as SessionKey };
const op = (name: OpName) => OPERATIONS.find(o => o.name === name)! as AnyOperation;
const call = (name: OpName, input: unknown, ctx: OpContext = agentCtx) => runOp(op(name), ctx, input) as Promise<Record<string, any>>;
const refused = async (name: OpName, input: unknown, ctx: OpContext = agentCtx): Promise<OpError | undefined> => {
  try { await call(name, input, ctx); return undefined; } catch (e) { if (e instanceof OpError) return e; throw e; }
};

const issueByKey = (k: string) => store.getByKey(k)!;
const stateOf = (k: string) => store.snapshot().states.find(s => s.id === issueByKey(k).stateId)!.name;
const count = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const todo = store.listIssues({ teamId: snap0.teams.find(t => t.key === 'CORE')!.id }).find(i => snap0.states.find(s => s.id === i.stateId)?.type === 'unstarted' && !i.assigneeId)
  ?? store.createIssue({ teamId: snap0.teams.find(t => t.key === 'CORE')!.id, title: 'Unassigned todo for the ops test' }, owner.id);
const K = store.keyOf(todo);

check('14 operations, unique names', OPERATIONS.length === 14 && new Set(OPERATIONS.map(o => o.name)).size === 14);
check('annotations derive from effect: reads read-only, undo destructive, all idempotent',
  annotationsOf(op('get_issue')).readOnlyHint && !annotationsOf(op('start_issue')).readOnlyHint && annotationsOf(op('undo')).destructiveHint && OPERATIONS.every(o => annotationsOf(o).idempotentHint));
check('a malformed issue key is refused at the boundary', (await refused('get_issue', { issue: 'not a key' }))?.code === 'invalid');
check('an MCP client with no BASELINE_AS writes as the workspace\'s Agent', agentCtx.actor.kind === 'agent' && agentCtx.actor.userId === agent.id && agent.name === 'Agent', agentCtx.actor);
check('the workspace has one built-in agent user', store.snapshot().users.filter(u => u.kind === 'agent' && ['Agent', 'Claude Code', 'Codex', 'pi'].includes(u.name)).length === 1);
check('BASELINE_AS naming no user (and no coding tool) is refused', await ctxFor('Nobody Bot').then(() => false, e => e instanceof OpError && /BASELINE_AS/.test(e.message) && /Claude Code/.test(e.message)));
const codexCtx = await ctxFor('Codex');
const codexUser = store.snapshot().users.find(u => u.name === 'Codex');
check('BASELINE_AS naming a coding tool makes its agent user on first use', codexCtx.actor.kind === 'agent' && codexUser?.kind === 'agent' && codexCtx.actor.userId === codexUser.id, codexCtx.actor);
check('…once: asking again finds the same user', (await ctxFor('codex')).actor.kind === 'agent' && store.snapshot().users.filter(u => u.name === 'Codex').length === 1);
const ccCtx: OpContext = { bl, actor: await agentActor(bl, undefined, 'claude-code'), session: null };
check('an MCP client named claude-code writes as "Claude Code"', ccCtx.actor.kind === 'agent' && ccCtx.actor.name === 'Claude Code', ccCtx.actor);
{
  const reopened = new Store(openDb(join(work, 'ops.db')));
  check('a reopened database keeps the per-tool agent users (only the old @local ones fold into Agent)', reopened.snapshot().users.some(u => u.name === 'Claude Code' && u.kind === 'agent'));
}
check('BASELINE_AS naming a person is refused', await ctxFor('Ada Osei').then(() => false, e => e instanceof OpError && /a person/.test(e.message)));

const s1 = await call('start_issue', { issue: K });
check(`start_issue ${K}: moves to In Progress, assigns the person, attributed to the agent via the person`,
  !!s1.op_id && s1.state === 'In Progress' && s1.assignee === owner.name && s1.attributed_to === `Agent via ${owner.name}`, s1);
check('start_issue returns a branch and the brief', typeof s1.branch === 'string' && s1.branch.length > 0 && s1.brief.includes(K));
check('start_issue without a local repo returns the git command to run', s1.git.status === 'manual' && s1.git.command === `git checkout -b ${s1.branch}`, s1.git);
const s2 = await call('start_issue', { issue: K });
check('start_issue twice: no op, already_started, still one state change', s2.op_id === null && s2.already_started
  && count("SELECT COUNT(*) n FROM activity WHERE issue_id = ? AND type = 'stateChanged'", todo.id) === 1, s2);
check('start_issue twice: the short answer, without the brief', s2.brief === null && op('start_issue').text(s2, 'mcp').length < 400, op('start_issue').text(s2, 'mcp'));
const asked: string[] = [];
const localCtx: OpContext = { ...agentCtx, local: { team: 'CORE', checkout: async b => { asked.push(b); return { status: 'created', branch: b, command: `git checkout --no-track -b ${b} main` }; } } };
const s3 = await call('start_issue', { issue: K }, localCtx);
check('start_issue with a local repo checks the issue\'s branch out', s3.git.status === 'created' && asked[0] === s1.branch, s3.git);

const adas = store.createIssue({ teamId: todo.teamId, title: 'Ada\'s own work', assigneeId: ada.id, stateId: store.stateOfType(todo.teamId, 'started') }, ada.id);
const AdaK = store.keyOf(adas);
const theirs = await refused('start_issue', { issue: AdaK });
check('start_issue on another person\'s started issue: refused, says whose, asks to take it over', theirs?.code === 'needs-human' && /Ada Osei/.test(theirs.message) && /take_over/.test(theirs.message), theirs?.message);
check('…and nothing changed', issueByKey(AdaK).assigneeId === ada.id && count('SELECT COUNT(*) n FROM work_threads WHERE issue_id = ?', adas.id) === 0);
const take = await call('start_issue', { issue: AdaK, take_over: true });
check('take_over: true reassigns it to the person and starts it', !!take.op_id && take.assignee === owner.name && take.warnings.some((w: string) => /was Ada Osei/.test(w)), take);
const untake = await call('undo', { op_id: take.op_id });
check('undo the take-over: Ada has it again', !!untake.op_id && issueByKey(AdaK).assigneeId === ada.id, untake);

const p1 = await call('post_progress', { issue: K, did: 'Reproduced the bug', left: 'Fix and test' });
const p2 = await call('post_progress', { issue: K, did: 'Fixed it', pr_url: 'https://github.com/o/r/pull/12' });
const p3 = await call('post_progress', { issue: K, did: 'Fixed it', links: ['https://github.com/o/r/pull/12'] });
const comments = () => db.prepare('SELECT * FROM comments WHERE issue_id = ? AND user_id = ?').all(todo.id, agent.id) as Array<{ body: string; via_user_id: string | null }>;
check('post_progress: the first call creates the note, the second rewrites it', p1.created && !!p1.op_id && !p2.created && !!p2.op_id, { p1, p2 });
check('post_progress: fields merge (left kept), the PR link attached once', p2.progress.left === 'Fix and test' && p2.links_added === 1 && p3.links_added === 0);
check('post_progress with the same text again: no op', p3.op_id === null, p3);
check('one living comment, by Agent via the person', comments().length === 1 && comments()[0]!.via_user_id === owner.id && comments()[0]!.body.includes('Fixed it'), comments());
check('the PR link is attached once', count('SELECT COUNT(*) n FROM attachments WHERE issue_id = ? AND url = ?', todo.id, 'https://github.com/o/r/pull/12') === 1);
await call('post_progress', { issue: K, did: 'Second session' }, await ctxFor('Agent', 's2'));
check('another BASELINE_SESSION keeps its own note', comments().length === 2);
check('an empty string clears a field', (await call('post_progress', { issue: K, left: '' })).progress.left === null);

const sub1 = await call('create_sub_issues', { issue: K, titles: ['Write the retry helper', 'Wire it into the importer'] });
const kids = () => store.listIssues({ teamId: todo.teamId }).filter(i => i.parentId === todo.id && !i.deletedAt);
check('create_sub_issues: one per title, under the started issue, with its assignee, in Todo', !!sub1.op_id && sub1.created.length === 2 && kids().length === 2
  && kids().every(c => c.assigneeId === owner.id && store.snapshot().states.find(s => s.id === c.stateId)?.type === 'unstarted'), sub1);
const sub2 = await call('create_sub_issues', { issue: K, titles: ['write the retry helper!'] });
check('create_sub_issues again with a title it has: no op, reported as existing', sub2.op_id === null && sub2.existing.length === 1 && kids().length === 2, sub2);
const notStarted = store.createIssue({ teamId: todo.teamId, title: 'Not started yet', stateId: store.stateOfType(todo.teamId, 'unstarted') }, owner.id);
check('create_sub_issues on an issue that isn\'t started is refused', /start_issue/.test((await refused('create_sub_issues', { issue: store.keyOf(notStarted), titles: ['x y z'] }))?.message ?? ''));
const subUndo = await call('undo', { op_id: sub1.op_id });
check('undo create_sub_issues: both sub-issues deleted', !!subUndo.op_id && kids().length === 0, subUndo);

const ago = store.listIssues({ teamId: snap0.teams.find(t => t.key === 'AGO')!.id }).find(i => !i.deletedAt)!;
const AK = store.keyOf(ago);
const issuesBefore = count('SELECT COUNT(*) n FROM issues');
const f1 = await call('propose_followup', { from_issue: AK, title: 'Session cookie lacks SameSite', description: 'src/auth.ts:88' });
const f2 = await call('propose_followup', { from_issue: AK, title: 'fix: session cookie lacks SameSite!' });
check('propose_followup stores a draft and files nothing', !!f1.op_id && f1.draft_id.startsWith('dr_') && f1.filed === false && count('SELECT COUNT(*) n FROM issues') === issuesBefore, f1);
check('propose_followup twice (same title, case and punctuation aside): the same draft, no op', f2.draft_id === f1.draft_id && f2.deduplicated && f2.op_id === null, f2);
const fAlias = await call('propose_followup', { from_issue: K, title: 'Importer logs leak tokens' });
check('a team with triage off: noting a follow-up never fails', !!fAlias.op_id, fAlias);
const finK = await call('finish_issue', { issue: K, outcome: 'stopped', summary: 'paused for review', left: 'tests' });
check('finish_issue lists the pending follow-ups and says to ask once', finK.pending_followups.length === 1 && finK.pending_followups[0].draft_id === fAlias.draft_id
  && /Ask the person once/.test(op('finish_issue').text(finK, 'cli')), finK);
await call('undo', { op_id: finK.op_id });
const filedOff = await call('create_issue', { draft_id: fAlias.draft_id });
check('an approved follow-up on a team with triage off goes to Backlog, unassigned, related to the source', filedOff.state === 'Backlog' && filedOff.assignee === null
  && count("SELECT COUNT(*) n FROM relations WHERE issue_id = ? AND related_id = ? AND type = 'related'", issueByKey(filedOff.key).id, todo.id) === 1, filedOff);
check('the filed draft no longer shows at finish', (await bl.drafts({ status: 'pending', fromIssueId: todo.id })).length === 0);
const filedAgain = await call('create_issue', { draft_id: fAlias.draft_id });
check('create_issue with the same draft again: the same issue, no op', filedAgain.key === filedOff.key && filedAgain.deduplicated && filedAgain.op_id === null, filedAgain);
store.updateTeam(ago.teamId, { triageEnabled: true });
const f1Filed = await call('create_issue', { draft_id: f1.draft_id });
check('an approved follow-up on a team with triage goes to Triage', f1Filed.state === 'Triage' && !!f1Filed.op_id, f1Filed);

const fin1 = await call('finish_issue', { issue: K, outcome: 'in_review', summary: 'PR #12 fixes it; tests pass' });
const fin2 = await call('finish_issue', { issue: K, outcome: 'in_review', summary: 'PR #12 fixes it; tests pass' });
check('finish_issue in_review: In Review', fin1.state === 'In Review' && !!fin1.op_id, fin1);
check('finish_issue twice: no op, one move to In Review', fin2.op_id === null
  && count("SELECT COUNT(*) n FROM activity WHERE issue_id = ? AND type = 'stateChanged'", todo.id) === 2, fin2);
check('the living comment became the final summary', comments().some(c => c.body.startsWith('**Finished: ready for review**')));
check('…keeping the last progress under it, collapsed', comments().some(c => c.body.startsWith('**Finished') && /<details><summary>Progress before finishing<\/summary>\n\n\*\*Did:\*\*/.test(c.body)));
{
  const { renderFinal } = await import('../src/core/work.js');
  const body = renderFinal('in_review', 'done', null, [], { stays: 'CORE-1 stays In Progress: its team has no In Review status.' });
  check('a finish whose status can\'t follow says so under the heading', body.split('\n\n')[1] === '_CORE-1 stays In Progress: its team has no In Review status._', body);
}
check('stopped without left is refused', (await refused('finish_issue', { issue: K, outcome: 'stopped', summary: 'gave up' }))?.code === 'invalid');

const u1 = await call('undo', { op_id: fin1.op_id });
check('undo finish_issue: state back to In Progress, note back to progress', !!u1.op_id && stateOf(K) === 'In Progress' && comments().some(c => c.body.startsWith('**Progress**')) && !comments().some(c => c.body.startsWith('**Finished')), u1);
check('undo twice: already undone, nothing written', (await call('undo', { op_id: fin1.op_id })).already_undone);
check('the undo is attributed to Agent via the person', count("SELECT COUNT(*) n FROM activity WHERE op_id = ? AND user_id = ? AND via_user_id = ?", u1.op_id, agent.id, owner.id) >= 1);

const other = store.createIssue({ teamId: todo.teamId, title: 'Undo refuses a changed field', stateId: store.stateOfType(todo.teamId, 'unstarted') }, owner.id);
const OK = store.keyOf(other);
const so = await call('start_issue', { issue: OK });
store.updateIssue(other.id, { stateId: store.stateOfType(todo.teamId, 'completed') }, ada.id);
const conflict = await refused('undo', { op_id: so.op_id });
check('undo refuses when a person changed the field since', conflict?.code === 'conflict' && /state is Done now/.test(conflict.message), conflict?.message);
check('a refused undo changes nothing', stateOf(OK) === 'Done' && issueByKey(OK).assigneeId === owner.id && count('SELECT COUNT(*) n FROM agent_ops WHERE id = ? AND undone_at IS NULL', so.op_id) === 1);

const fuDraft = await call('propose_followup', { from_issue: AK, title: 'A follow-up a person accepts' });
const fu = await call('create_issue', { draft_id: fuDraft.draft_id });
store.updateIssue(issueByKey(fu.key).id, { stateId: store.stateOfType(ago.teamId, 'unstarted') }, owner.id);
check('undo refuses to delete a follow-up a person already accepted', (await refused('undo', { op_id: fu.op_id }))?.code === 'conflict');
const u2 = await call('undo', { op_id: f1Filed.op_id });
check('undo create_issue (a follow-up): the untouched issue is deleted, its relation removed, the draft pending again', !!u2.op_id && !!issueByKey(f1Filed.key).deletedAt
  && count('SELECT COUNT(*) n FROM relations WHERE issue_id = ?', issueByKey(f1Filed.key).id) === 0
  && (await bl.drafts({ status: 'pending' })).some(d => d.id === f1.draft_id), u2);
const u3 = await call('undo', { op_id: f1.op_id });
check('undo propose_followup: the draft is gone', !!u3.op_id && !(await bl.drafts({})).some(d => d.id === f1.draft_id), u3);
const f3 = await call('propose_followup', { from_issue: AK, title: 'Session cookie lacks SameSite' });
check('after undo, noting the same title makes a new draft', !f3.deduplicated && f3.draft_id !== f1.draft_id);
const aliasOut = await runOp(op('propose_followup'), agentCtx, { from_issue: AK, title: 'Old tool name still works' }) as Record<string, any>;
check('file_followup is an alias of propose_followup', OP_ALIASES.file_followup === 'propose_followup' && !!aliasOut.draft_id);

const created0 = count('SELECT COUNT(*) n FROM issues');
const pi1 = await call('propose_issue', { title: 'Fix login redirect after SSO', team: 'CORE', priority: 'high' });
const pi2 = await call('propose_issue', { title: 'fix login redirect after sso', team: 'CORE' });
check('propose_issue: a draft only, nothing created', !!pi1.op_id && pi1.created === false && pi1.priority === 'High' && count('SELECT COUNT(*) n FROM issues') === created0, pi1);
check('propose_issue twice: the same draft', pi2.draft_id === pi1.draft_id && pi2.op_id === null);
check('propose_issue says to ask, and to create only on yes', /Ask the person/.test(op('propose_issue').text(pi1, 'mcp')) && /yes/.test(op('propose_issue').text(pi1, 'mcp')));
check('a draft is visible to nobody else: Ada\'s drafts are empty', (store.ext.work.agentDrafts(ada.id)).length === 0 && store.ext.work.agentDrafts(owner.id).some(d => d.id === pi1.draft_id));
const ci1 = await call('create_issue', { draft_id: pi1.draft_id, start: true }, localCtx);
check('create_issue from the draft, started: In Progress, assigned to the person, branch checked out', !!ci1.op_id && ci1.title === 'Fix login redirect after SSO'
  && ci1.state === 'In Progress' && ci1.assignee === owner.name && ci1.started && ci1.git?.status === 'created' && issueByKey(ci1.key).priority === 2, ci1);
check('…with a work thread open, so post_progress lands on it', count('SELECT COUNT(*) n FROM work_threads WHERE issue_id = ?', issueByKey(ci1.key).id) === 1);
const ciUndo = await call('undo', { op_id: ci1.op_id });
check('undo create_issue: the issue deleted, the thread removed, the draft pending again', !!ciUndo.op_id && !!issueByKey(ci1.key).deletedAt
  && count('SELECT COUNT(*) n FROM work_threads WHERE issue_id = ?', issueByKey(ci1.key).id) === 0
  && (await bl.drafts({ status: 'pending' })).some(d => d.id === pi1.draft_id), ciUndo);
const ci2 = await call('create_issue', { title: 'Dictated by the person', team: 'CORE' });
const ci3 = await call('create_issue', { title: 'dictated by the person', team: 'CORE' });
check('create_issue from fields: Todo, assigned; again: the same issue', ci2.state === 'Todo' && ci2.assignee === owner.name && ci3.key === ci2.key && ci3.op_id === null, [ci2, ci3]);
check('create_issue with neither draft_id nor title is refused', (await refused('create_issue', {}))?.code === 'invalid');
check('create_issue with someone else\'s draft id is refused', (await refused('create_issue', { draft_id: 'dr_nope' }))?.code === 'not-found');
const piUndo = await call('undo', { op_id: pi1.op_id });
check('undo propose_issue: the draft is discarded', !!piUndo.op_id && !store.ext.work.agentDraft(pi1.draft_id), piUndo);

check('a receipt says `baseline agent undo` on the CLI and the undo tool over MCP', /baseline agent undo op_/.test(op('create_issue').text(ci2, 'cli'))
  && /call the undo tool with op_id op_/.test(op('create_issue').text(ci2, 'mcp')) && !/baseline agent/.test(op('create_issue').text(ci2, 'mcp')));

const project = store.snapshot().projects[0]!;
const updates = () => count('SELECT COUNT(*) n FROM project_updates WHERE project_id = ?', project.id);
const before = updates();
const d1 = await call('draft_project_update', { project: project.name, health: 'atRisk' });
const d2 = await call('draft_project_update', { project: project.name, health: 'atRisk' });
check('draft_project_update writes a draft from the facts, unpublished', !!d1.op_id && d1.published === false && d1.body.startsWith('Since') && d1.health === 'atRisk', d1);
const someKey = [...d1.facts.in_progress, ...d1.facts.filed, ...d1.facts.completed][0];
check('the draft names the issues\' titles, not only their keys', !!someKey && d1.body.includes(`${someKey} ${d1.facts.titles[someKey]}`), d1.body);
check('draft_project_update twice: no op, one draft, no project update', d2.op_id === null && updates() === before
  && count('SELECT COUNT(*) n FROM project_update_drafts WHERE project_id = ? AND person_id = ? AND author_id = ?', project.id, owner.id, agent.id) === 1, d2);
const pubKey = await transport(key.token).request('POST', `/api/projects/${project.id}/update-draft/publish`, { json: {} });
check('publishing with an API key is refused (403), and nothing is published', pubKey.status === 403 && updates() === before, pubKey);
const pubLocal = await transport(null).request('POST', `/api/projects/${project.id}/update-draft/publish`, { json: {} });
check('the person (this machine, no key) publishes it: one update, by them, draft gone', pubLocal.status === 201 && updates() === before + 1
  && count('SELECT COUNT(*) n FROM project_update_drafts WHERE project_id = ?', project.id) === 0
  && count('SELECT COUNT(*) n FROM project_updates WHERE project_id = ? AND user_id = ? AND via_user_id IS NULL', project.id, owner.id) >= 1, pubLocal);

check('every activity row by Agent is via the person', count('SELECT COUNT(*) n FROM activity WHERE user_id = ? AND op_id IS NOT NULL AND (via_user_id IS NULL OR via_user_id != ?)', agent.id, owner.id) === 0
  && count('SELECT COUNT(*) n FROM activity WHERE user_id = ? AND op_id IS NOT NULL', agent.id) > 0);

const g = await call('get_issue', { issue: K.toLowerCase() });
check('get_issue shows the agent work threads', g.issue.key === K && g.agent_work.length === 2 && g.agent_work.some((w: { session: string | null; via: string }) => w.session === 's1' && w.via === owner.name), g.agent_work);
const waits = store.createIssue({ teamId: todo.teamId, title: 'Waits on another' }, owner.id);
store.setRelation(waits.id, todo.id, 'blocked_by');
const gb = await call('get_issue', { issue: store.keyOf(waits) });
store.createIssue({ teamId: todo.teamId, title: 'A child', parentId: todo.id }, owner.id);
const gk = await call('get_issue', { issue: K });
const gkText = op('get_issue').text(gk, 'cli');
check('get_issue text lists sub-issues, blockers and links', /sub-issues:\n {2}\S+ \[\w+\] A child/.test(gkText) && /links:\n.*github\.com\/o\/r\/pull\/12/.test(gkText)
  && /blocked by: /.test(op('get_issue').text(gb, 'cli')), gkText);
const l = await call('list_issues', {});
check('list_issues defaults to the person\'s open issues', l.issues.length > 0 && l.issues.every((i: { assignee: string; state: string }) => i.assignee === owner.name && !['Done', 'Canceled'].includes(i.state)), l.issues.slice(0, 3));
check('list_issues: an unknown state lists the valid ones', /valid states: open, all/.test((await refused('list_issues', { state: 'Doing' }))?.message ?? ''));
const loginIssue = store.createIssue({ teamId: todo.teamId, title: 'Fix login redirect loop', description: 'After SSO the app bounces back to /login', stateId: store.stateOfType(todo.teamId, 'unstarted') }, ada.id);
const lq = await call('list_issues', { query: 'login redirect' });
check('list_issues with a query searches everyone\'s issues, not only the person\'s', lq.issues.some((i: { key: string }) => i.key === store.keyOf(loginIssue)) && /anyone/.test(lq.filter), lq);

const fi = await call('find_issues', { query: 'the redirect bug on login' });
check('find_issues: word order and filler words don\'t matter, unassigned issues found, says what it searched', fi.issues[0]?.key === store.keyOf(loginIssue)
  && fi.searched.words.join() === 'redirect,login' && fi.searched.issues > 0 && /Searched \d+ open issue/.test(op('find_issues').text(fi, 'cli')), fi);
const fiNone = await call('find_issues', { query: 'quantum teleportation' });
check('find_issues with no match says so and points at propose_issue', fiNone.issues.length === 0 && /propose_issue/.test(op('find_issues').text(fiNone, 'cli')), fiNone);
const fiRepo = await call('find_issues', { query: 'login redirect' }, localCtx);
check('find_issues defaults to the repo\'s team', fiRepo.searched.teams.join() === 'CORE', fiRepo.searched);

const blocker = store.createIssue({ teamId: todo.teamId, title: 'Blocker', stateId: store.stateOfType(todo.teamId, 'unstarted') }, owner.id);
const urgentTodo = store.createIssue({ teamId: todo.teamId, title: 'Urgent but blocked', priority: 1, assigneeId: owner.id, stateId: store.stateOfType(todo.teamId, 'unstarted') }, owner.id);
store.setRelation(urgentTodo.id, blocker.id, 'blocked_by');
const nx = await call('next_issue', { limit: 10 });
const tierOf = (why: string) => why.startsWith('in progress') ? 0 : why.startsWith('Todo') ? 1 : 2;
check('next_issue: in progress first, then Todo, unblocked only', nx.issues.length > 0 && nx.issues.every((i: { why: string }, n: number) => n === 0 || tierOf(nx.issues[n - 1].why) <= tierOf(i.why))
  && !nx.issues.some((i: { key: string }) => i.key === store.keyOf(urgentTodo)) && nx.blocked_skipped >= 1, nx);
check('next_issue defaults to 3', (await call('next_issue', {})).issues.length <= 3);

await call('start_issue', { issue: store.keyOf(blocker) });
await call('post_progress', { issue: store.keyOf(blocker), did: 'Found the cause' });
const act = await call('my_activity', { since: '1d' });
check('my_activity: the person\'s issues and their agents\' work since then, as standup lines', act.issues[0]?.key === store.keyOf(blocker)
  && act.issues[0].did.includes('started') && act.issues[0].did.includes('progress') && act.issues[0].progress === 'Found the cause'
  && /^Since /.test(op('my_activity').text(act, 'cli')), act.issues.slice(0, 3));
check('my_activity: a bad since is refused with the valid forms', /yesterday, today/.test((await refused('my_activity', { since: 'whenever' }))?.message ?? ''));


{
  const path = join(work, 'fold.db');
  let mdb = openDb(path);
  let ms = new Store(mdb);
  const agentId = ms.agentUserId();
  const tool = (name: string, email: string) => { const u = ms.createUser(name, email, false, 'agent'); return u.id; };
  const cc = tool('Claude Code', 'claude-code@local'), cx = tool('Codex', 'codex@local'), pi = tool('pi', 'pi@local');
  mdb.prepare("UPDATE meta SET value = ? WHERE key = 'agentUserId'").run(cc);
  const team = ms.createTeam('MIG', 'Migration');
  ms.addTeamMember(team.id, agentId);
  ms.addTeamMember(team.id, cx);
  const issue = ms.createIssue({ teamId: team.id, title: 'Folded' }, cc);
  ms.updateIssue(issue.id, { assigneeId: cx }, cc);
  mdb.close();
  const fingerprint = (d: typeof mdb) => JSON.stringify(['users', 'activity', 'subscriptions', 'team_members', 'meta'].map(t => d.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
  mdb = openDb(path);
  ms = new Store(mdb);
  const one = (sql: string, ...a: string[]) => mdb.prepare(sql).get(...a) as Record<string, unknown> | undefined;
  check('migrate: one built-in agent user left, named Agent, and it is the workspace agent',
    (one("SELECT COUNT(*) n FROM users WHERE kind = 'agent' AND (email IN ('agent@local', 'claude-code@local', 'codex@local', 'pi@local'))")!.n === 1)
    && ms.agentUserId() === agentId && ms.snapshot().users.find(u => u.id === agentId)?.name === 'Agent'
    && !one('SELECT 1 FROM users WHERE id IN (?, ?, ?)', cc, cx, pi));
  check('migrate: the Codex issue is assigned to Agent, Claude Code\'s activity is Agent\'s',
    ms.getIssue(issue.id)?.assigneeId === agentId && ms.getIssue(issue.id)?.creatorId === agentId
    && one('SELECT COUNT(*) n FROM activity WHERE issue_id = ? AND user_id != ?', issue.id, agentId)!.n === 0
    && (one('SELECT COUNT(*) n FROM activity WHERE issue_id = ?', issue.id)!.n as number) > 0);
  check('migrate: a duplicate team membership is dropped, not doubled', one('SELECT COUNT(*) n FROM team_members WHERE team_id = ? AND user_id = ?', team.id, agentId)!.n === 1);
  const after = fingerprint(mdb);
  mdb.close();
  mdb = openDb(path);
  check('migrate a second time: nothing changes', fingerprint(mdb) === after);
  mdb.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
