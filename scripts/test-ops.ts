// The agent operations end to end: each op through runOp and the real client, over the app's own
// routes with an API key (the person) and BASELINE_AS = Claude Code. Checks that repeats converge
// (one comment, one follow-up, one state change), that follow-ups are forced into Triage, that undo
// refuses a field someone changed since, and that a key can draft but never publish a project update.
// Throwaway database — never touches ~/.baseline.
//
//   npx tsx scripts/test-ops.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';
import { HttpBaseline } from '../src/client/baseline.js';
import type { Transport } from '../src/client/transport.js';
import { OPERATIONS } from '../src/ops/index.js';
import { actorForClient, actorFrom, agentForClient } from '../src/ops/identity.js';
import { annotationsOf, OpError, runOp, type AnyOperation, type OpContext, type OpName, type SessionKey } from '../src/ops/operation.js';

const work = mkdtempSync(join(tmpdir(), 'baseline-ops-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const { app, store, db } = createApp(join(work, 'ops.db'), { mode: 'local' }, { configured: false, send: async () => {} });
store.ext.git.ensureInReview();
const snap0 = store.snapshot();
const owner = snap0.currentUser;
const claude = snap0.users.find(u => u.name === 'Claude Code') ?? snap0.users.find(u => u.id === store.claudeCodeUserId())!;
const ada = snap0.users.find(u => u.name === 'Ada Osei')!;
const key = store.ext.apiKeys.create({ name: 'ops test', userId: owner.id, scopes: ['read', 'write'] });

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || detail === '' ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

/** the app over HTTP semantics, with the key as a bearer token (or as this machine, with no key) */
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
const agentCtx = await ctxFor('Claude Code', 's1');
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

// ---------- the registry ----------
check('8 operations, unique names', OPERATIONS.length === 8 && new Set(OPERATIONS.map(o => o.name)).size === 8);
check('annotations derive from effect: reads read-only, undo destructive, all idempotent',
  annotationsOf(op('get_issue')).readOnlyHint && !annotationsOf(op('start_issue')).readOnlyHint && annotationsOf(op('undo')).destructiveHint && OPERATIONS.every(o => annotationsOf(o).idempotentHint));
check('a malformed issue key is refused at the boundary', (await refused('get_issue', { issue: 'not a key' }))?.code === 'invalid');
check('clientInfo names map to agents: claude-code → Claude Code, codex-mcp-client → Codex, others → none',
  agentForClient('claude-code') === 'Claude Code' && agentForClient('codex-mcp-client') === 'Codex' && agentForClient('cursor') === undefined);
const noAdmin = await actorForClient(bl, undefined, 'codex-mcp-client').then(() => undefined, (e: unknown) => e);
check('a key that may not add users gets a needs-human error naming BASELINE_AS, and no Codex user is added',
  noAdmin instanceof OpError && noAdmin.code === 'needs-human' && /only an admin can add one/.test(noAdmin.message) && /BASELINE_AS/.test(noAdmin.message)
  && !store.snapshot().users.some(u => u.name === 'Codex'), noAdmin instanceof Error ? noAdmin.message : noAdmin);
check('BASELINE_AS naming a person is refused', await ctxFor('Ada Osei').then(() => false, e => e instanceof OpError && /a person/.test(e.message)));

// ---------- start_issue ----------
const s1 = await call('start_issue', { issue: K });
check(`start_issue ${K}: moves to In Progress, assigns the person, attributed to the agent via the person`,
  !!s1.op_id && s1.state === 'In Progress' && s1.assignee === owner.name && s1.attributed_to === `Claude Code via ${owner.name}`, s1);
check('start_issue returns a branch and the brief', typeof s1.branch === 'string' && s1.branch.length > 0 && s1.brief.includes(K));
const s2 = await call('start_issue', { issue: K });
check('start_issue twice: no op, already_started, still one state change', s2.op_id === null && s2.already_started
  && count("SELECT COUNT(*) n FROM activity WHERE issue_id = ? AND type = 'stateChanged'", todo.id) === 1, s2);

// ---------- post_progress ----------
const p1 = await call('post_progress', { issue: K, did: 'Reproduced the bug', left: 'Fix and test' });
const p2 = await call('post_progress', { issue: K, did: 'Fixed it', pr_url: 'https://github.com/o/r/pull/12' });
const p3 = await call('post_progress', { issue: K, did: 'Fixed it', links: ['https://github.com/o/r/pull/12'] });
const comments = () => db.prepare('SELECT * FROM comments WHERE issue_id = ? AND user_id = ?').all(todo.id, claude.id) as Array<{ body: string; via_user_id: string | null }>;
check('post_progress: the first call creates the note, the second rewrites it', p1.created && !!p1.op_id && !p2.created && !!p2.op_id, { p1, p2 });
check('post_progress: fields merge (left kept), the PR link attached once', p2.progress.left === 'Fix and test' && p2.links_added === 1 && p3.links_added === 0);
check('post_progress with the same text again: no op', p3.op_id === null, p3);
check('one living comment, by Claude Code via the person', comments().length === 1 && comments()[0]!.via_user_id === owner.id && comments()[0]!.body.includes('Fixed it'), comments());
check('the PR link is attached once', count('SELECT COUNT(*) n FROM attachments WHERE issue_id = ? AND url = ?', todo.id, 'https://github.com/o/r/pull/12') === 1);
await call('post_progress', { issue: K, did: 'Second session' }, await ctxFor('Claude Code', 's2'));
check('another BASELINE_SESSION keeps its own note', comments().length === 2);
check('an empty string clears a field', (await call('post_progress', { issue: K, left: '' })).progress.left === null);

// ---------- file_followup: forced into Triage, deduplicated ----------
const ago = store.listIssues({ teamId: snap0.teams.find(t => t.key === 'AGO')!.id }).find(i => !i.deletedAt)!;
const AK = store.keyOf(ago);
const f1 = await call('file_followup', { from_issue: AK, title: 'Session cookie lacks SameSite', description: 'src/auth.ts:88' });
const f2 = await call('file_followup', { from_issue: AK, title: 'fix: session cookie lacks SameSite!' });
check('file_followup lands in Triage, related to the source', f1.state === 'Triage' && !!f1.op_id && !f1.deduplicated
  && count("SELECT COUNT(*) n FROM relations WHERE issue_id = ? AND related_id = ? AND type = 'related'", issueByKey(f1.key).id, ago.id) === 1, f1);
check('file_followup twice (same title, case and punctuation aside): the same issue, no op', f2.key === f1.key && f2.deduplicated && f2.op_id === null, f2);
check('one follow-up issue exists', count("SELECT COUNT(*) n FROM issues WHERE title = 'Session cookie lacks SameSite'") === 1);
const triageOff = await refused('file_followup', { from_issue: K, title: 'Something on a team without triage' });
check('a team with triage off refuses (needs-human) instead of skipping review', triageOff?.code === 'needs-human', triageOff?.message);
store.updateTeam(todo.teamId, { triageEnabled: true });
const own = await call('file_followup', { from_issue: K, title: 'Filed by the person, not an agent' }, await ctxFor(undefined));
check('Triage is forced even for the person\'s own follow-up (store default would be Todo)', own.state === 'Triage' && own.attributed_to === owner.name, own);

// ---------- finish_issue ----------
const fin1 = await call('finish_issue', { issue: K, outcome: 'in_review', summary: 'PR #12 fixes it; tests pass' });
const fin2 = await call('finish_issue', { issue: K, outcome: 'in_review', summary: 'PR #12 fixes it; tests pass' });
check('finish_issue in_review: In Review', fin1.state === 'In Review' && !!fin1.op_id, fin1);
check('finish_issue twice: no op, one move to In Review', fin2.op_id === null
  && count("SELECT COUNT(*) n FROM activity WHERE issue_id = ? AND type = 'stateChanged'", todo.id) === 2, fin2);
check('the living comment became the final summary', comments().some(c => c.body.startsWith('**Finished: ready for review**')));
check('stopped without left is refused', (await refused('finish_issue', { issue: K, outcome: 'stopped', summary: 'gave up' }))?.code === 'invalid');

// ---------- undo ----------
const u1 = await call('undo', { op_id: fin1.op_id });
check('undo finish_issue: state back to In Progress, note back to progress', !!u1.op_id && stateOf(K) === 'In Progress' && comments().some(c => c.body.startsWith('**Progress**')) && !comments().some(c => c.body.startsWith('**Finished')), u1);
check('undo twice: already undone, nothing written', (await call('undo', { op_id: fin1.op_id })).already_undone);
check('the undo is attributed to Claude Code via the person', count("SELECT COUNT(*) n FROM activity WHERE op_id = ? AND user_id = ? AND via_user_id = ?", u1.op_id, claude.id, owner.id) >= 1);

const other = store.createIssue({ teamId: todo.teamId, title: 'Undo refuses a changed field', stateId: store.stateOfType(todo.teamId, 'unstarted') }, owner.id);
const OK = store.keyOf(other);
const so = await call('start_issue', { issue: OK });
store.updateIssue(other.id, { stateId: store.stateOfType(todo.teamId, 'completed') }, ada.id);
const conflict = await refused('undo', { op_id: so.op_id });
check('undo refuses when a person changed the field since', conflict?.code === 'conflict' && /state is Done now/.test(conflict.message), conflict?.message);
check('a refused undo changes nothing', stateOf(OK) === 'Done' && issueByKey(OK).assigneeId === owner.id && count('SELECT COUNT(*) n FROM agent_ops WHERE id = ? AND undone_at IS NULL', so.op_id) === 1);

const fu = await call('file_followup', { from_issue: AK, title: 'A follow-up a person accepts' });
store.updateIssue(issueByKey(fu.key).id, { stateId: store.stateOfType(ago.teamId, 'unstarted') }, owner.id);
check('undo refuses to delete a follow-up a person already accepted', (await refused('undo', { op_id: fu.op_id }))?.code === 'conflict');
const u2 = await call('undo', { op_id: f1.op_id });
check('undo file_followup: the untouched follow-up is deleted, its relation removed', !!u2.op_id && !!issueByKey(f1.key).deletedAt
  && count('SELECT COUNT(*) n FROM relations WHERE issue_id = ?', issueByKey(f1.key).id) === 0, u2);
const f3 = await call('file_followup', { from_issue: AK, title: 'Session cookie lacks SameSite' });
check('after undo, filing the same title files a new one', !f3.deduplicated && f3.key !== f1.key);

// ---------- draft_project_update: drafted by a key, published only by a person ----------
const project = store.snapshot().projects[0]!;
const updates = () => count('SELECT COUNT(*) n FROM project_updates WHERE project_id = ?', project.id);
const before = updates();
const d1 = await call('draft_project_update', { project: project.name, health: 'atRisk' });
const d2 = await call('draft_project_update', { project: project.name, health: 'atRisk' });
check('draft_project_update writes a draft from the facts, unpublished', !!d1.op_id && d1.published === false && d1.body.startsWith('Since') && d1.health === 'atRisk', d1);
check('draft_project_update twice: no op, one draft, no project update', d2.op_id === null && updates() === before
  && count('SELECT COUNT(*) n FROM project_update_drafts WHERE project_id = ? AND person_id = ? AND author_id = ?', project.id, owner.id, claude.id) === 1, d2);
const pubKey = await transport(key.token).request('POST', `/api/projects/${project.id}/update-draft/publish`, { json: {} });
check('publishing with an API key is refused (403), and nothing is published', pubKey.status === 403 && updates() === before, pubKey);
const pubLocal = await transport(null).request('POST', `/api/projects/${project.id}/update-draft/publish`, { json: {} });
check('the person (this machine, no key) publishes it: one update, by them, draft gone', pubLocal.status === 201 && updates() === before + 1
  && count('SELECT COUNT(*) n FROM project_update_drafts WHERE project_id = ?', project.id) === 0
  && count('SELECT COUNT(*) n FROM project_updates WHERE project_id = ? AND user_id = ? AND via_user_id IS NULL', project.id, owner.id) >= 1, pubLocal);

// ---------- attribution, across everything above ----------
check('every activity row by Claude Code is via the person', count('SELECT COUNT(*) n FROM activity WHERE user_id = ? AND op_id IS NOT NULL AND (via_user_id IS NULL OR via_user_id != ?)', claude.id, owner.id) === 0
  && count('SELECT COUNT(*) n FROM activity WHERE user_id = ? AND op_id IS NOT NULL', claude.id) > 0);

// ---------- read ops ----------
const g = await call('get_issue', { issue: K.toLowerCase() });
check('get_issue shows the agent work threads', g.issue.key === K && g.agent_work.length === 2 && g.agent_work.some((w: { session: string | null; via: string }) => w.session === 's1' && w.via === owner.name), g.agent_work);
const l = await call('list_issues', {});
check('list_issues defaults to the person\'s open issues', l.issues.length > 0 && l.issues.every((i: { assignee: string; state: string }) => i.assignee === owner.name && !['Done', 'Canceled'].includes(i.state)), l.issues.slice(0, 3));
check('list_issues: an unknown state lists the valid ones', /valid states: open, all/.test((await refused('list_issues', { state: 'Doing' }))?.message ?? ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
