// `baseline mcp` over the real protocol: spawns the CLI's MCP server on a scratch database, runs
// initialize, tools/list and tools/call through the SDK's client, then re-reads the database.
// Checks that every op is a tool with its schemas and annotations, that Claude Code writes as "Claude Code via
// <person>" and any other client as the workspace's "Agent via <person>" (BASELINE_AS picks another agent user),
// that with no login and no database it refuses instead of seeding one, that repeated progress converges on one comment
// edited in place, that errors are tool errors listing valid values, and that stdout has only protocol messages.
// Then the hosted endpoint, /mcp over Streamable HTTP: keys only, the same tools, a key's scopes and
// teams enforced by every tool, and the whole work loop re-read from the database.
// Runs against a throwaway database and never touches ~/.baseline.
//
//   npx tsx scripts/test-mcp.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { serve as nodeServe } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/core/db.js';
import { createApp } from '../src/server/index.js';
import { OPERATIONS } from '../src/ops/index.js';
import { annotationsOf, type AnyOperation } from '../src/ops/operation.js';
import { toolOf } from '../src/mcp/server.js';
import { AS_HEADER } from '../src/mcp/http.js';

const root = join(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'baseline-mcp-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const dbPath = join(work, 'mcp.db');

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || detail === '' ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}`}`);
};

// a workspace with one unstarted, unassigned issue
const { store: store0, db: db0 } = createApp(dbPath, { mode: 'local' }, { configured: false, send: async () => {} });
const owner = store0.snapshot().currentUser;
const team = store0.snapshot().teams[0]!;
const todo = store0.createIssue({ teamId: team.id, title: 'Wire the MCP server', stateId: store0.stateOfType(team.id, 'unstarted') }, owner.id);
const K = store0.keyOf(todo);
store0.createUser('Reviewer Bot', '', false, 'agent');
db0.close();

async function session(clientName: string, env: Record<string, string> = {}, args = ['--db', dbPath]) {
  const transport = new StdioClientTransport({
    command: join(root, 'node_modules/.bin/tsx'), args: [join(root, 'src/cli/index.ts'), 'mcp', ...args],
    env: { PATH: process.env.PATH ?? '', HOME: work, ...env }, stderr: 'pipe', cwd: root,
  });
  const client = new Client({ name: clientName, version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  return r as { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: Record<string, any> };
};

// ---------- no login, no database: a loud refusal, never a sample workspace ----------
{
  const home = join(work, 'empty-home');
  mkdirSync(home);
  const none = await session('claude-code', { HOME: home }, []);
  const listed = (await none.listTools()).tools.length;
  const r = await call(none, 'next_issue', {});
  check('no login and no BASELINE_DB: tools list, and a call says to log in', listed === OPERATIONS.length && !!r.isError && /Not connected to Baseline\. Run `baseline login --server <url>`/.test(r.content[0]!.text), r);
  await none.close();
  const missing = join(work, 'never-made.db');
  const m = await session('claude-code', { HOME: home }, ['--db', missing]);
  const mr = await call(m, 'get_issue', { issue: 'CORE-1' });
  check('--db naming a file that doesn\'t exist: refused, and no file made', !!mr.isError && /doesn't exist/.test(mr.content[0]!.text) && !existsSync(missing), mr);
  await m.close();
  check('…and nothing was written under HOME (no ~/.baseline database)', !existsSync(join(home, '.baseline')) && readdirSync(home).length === 0, readdirSync(home));
}

// ---------- initialize, tools/list ----------
const claude = await session('claude-code');
check('initialize: server is baseline, with instructions naming the work loop', claude.getServerVersion()?.name === 'baseline' && /start_issue/.test(claude.getInstructions() ?? ''));
const { tools } = await claude.listTools();
check(`tools/list: ${OPERATIONS.length} tools, one per op, in registry order`, tools.length === 14 && tools.map(t => t.name).join() === OPERATIONS.map(o => o.name).join(), tools.map(t => t.name));
for (const op of OPERATIONS as readonly AnyOperation[]) {
  const t = tools.find(x => x.name === op.name);
  const want = toolOf(op);
  check(`${op.name}: description, input/output schema and annotations match the op`, !!t && t.description === op.description
    && JSON.stringify(t.inputSchema) === JSON.stringify(want.inputSchema) && JSON.stringify(t.outputSchema) === JSON.stringify(want.outputSchema)
    && JSON.stringify(t.annotations) === JSON.stringify(annotationsOf(op)), t);
}
check('reads are readOnlyHint, undo destructiveHint, writes neither', tools.filter(t => t.annotations?.readOnlyHint).map(t => t.name).join() === 'next_issue,find_issues,get_issue,list_issues,my_activity'
  && tools.filter(t => t.annotations?.destructiveHint).map(t => t.name).join() === 'undo');

// ---------- the work loop ----------
const s = await call(claude, 'start_issue', { issue: K });
check(`start_issue ${K}: In Progress, attributed to "Claude Code via the person" (made on first use), structuredContent`, !s.isError && s.structuredContent?.state === 'In Progress'
  && s.structuredContent?.attributed_to === `Claude Code via ${owner.name}` && /Started/.test(s.content[0]!.text), s);
check('the receipt over MCP names the undo tool, not the CLI', /call the undo tool with op_id op_/.test(s.content[0]!.text) && !/baseline agent undo/.test(s.content[0]!.text), s.content[0]!.text);
check('start_issue in a stdio session reports what it did to the branch', ['checked_out', 'created', 'already_on', 'manual'].includes(s.structuredContent?.git?.status), s.structuredContent?.git);
const p1 = await call(claude, 'post_progress', { issue: K, did: 'Investigated the stdio transport', left: 'Wire the tools' });
const p2 = await call(claude, 'post_progress', { issue: K, did: 'Wired the tools', left: 'Tests' });
check('post_progress twice: created, then rewritten', p1.structuredContent?.created === true && p2.structuredContent?.created === false && !!p2.structuredContent?.op_id, [p1, p2]);
const f = await call(claude, 'finish_issue', { issue: K, outcome: 'done', summary: 'MCP server wired; scripts/test-mcp.ts passes' });
check('finish_issue done: Done', !f.isError && f.structuredContent?.state === 'Done', f);

// ---------- the new tools, each over stdio, and undo of each new write ----------
{
  const tool = (name: string, args: Record<string, unknown>) => call(claude, name, args);
  const n = await tool('next_issue', {});
  check('next_issue over MCP', !n.isError && Array.isArray(n.structuredContent?.issues), n);
  const fi = await tool('find_issues', { query: 'wire mcp server', state: 'all' });
  check('find_issues over MCP finds the issue and says what it searched', !fi.isError && fi.structuredContent?.issues[0]?.key === K && /Searched/.test(fi.content[0]!.text), fi);
  const a = await tool('my_activity', { since: '1d' });
  check('my_activity over MCP', !a.isError && a.structuredContent?.issues.some((i: { key: string }) => i.key === K), a);
  const pi = await tool('propose_issue', { title: 'Expire idle stdio sessions', team: team.key });
  const ci = await tool('create_issue', { draft_id: pi.structuredContent?.draft_id, start: true });
  check('propose_issue then create_issue (start) over MCP', !pi.isError && !ci.isError && ci.structuredContent?.state === 'In Progress' && ci.structuredContent?.started, [pi, ci]);
  const sub = await tool('create_sub_issues', { issue: ci.structuredContent?.key, titles: ['Measure idle time', 'Close idle sessions'] });
  check('create_sub_issues over MCP', !sub.isError && sub.structuredContent?.created.length === 2, sub);
  const pf = await tool('propose_followup', { from_issue: ci.structuredContent?.key, title: 'Document session limits' });
  const legacy = await tool('file_followup', { from_issue: ci.structuredContent?.key, title: 'An old CLAUDE.md block calls this' });
  check('propose_followup over MCP, and file_followup still answers as its alias', !pf.isError && !!pf.structuredContent?.draft_id && !legacy.isError && !!legacy.structuredContent?.draft_id, [pf, legacy]);
  const fin = await tool('finish_issue', { issue: ci.structuredContent?.key, outcome: 'stopped', summary: 'half way', left: 'the closing' });
  check('finish_issue over MCP lists the pending follow-ups', fin.structuredContent?.pending_followups.length === 2 && /Ask the person once/.test(fin.content[0]!.text), fin);
  const undos = await Promise.all([fin, sub, legacy, pf].map(x => tool('undo', { op_id: x.structuredContent?.op_id })));
  // a fresh proposal, created and undone before anyone writes on it (a commented issue isn't deleted by undo)
  const pi2 = await tool('propose_issue', { title: 'Log MCP client names', team: team.key });
  const ci2 = await tool('create_issue', { draft_id: pi2.structuredContent?.draft_id });
  const undoCi = await tool('undo', { op_id: ci2.structuredContent?.op_id });
  const undoPi = await tool('undo', { op_id: pi2.structuredContent?.op_id });
  check('undo over MCP reverses finish, sub-issues, follow-up notes, the created issue and the proposal', [...undos, undoCi, undoPi].every(u => !u.isError && !!u.structuredContent?.op_id), [...undos, undoCi, undoPi].map(u => u.content[0]!.text));
}

// ---------- errors are tool errors, with valid values ----------
const bad = await call(claude, 'list_issues', { state: 'Doing' });
check('an unknown state is a tool error listing the valid states', !!bad.isError && /valid states: open, all/.test(bad.content[0]!.text), bad);
const badKey = await call(claude, 'get_issue', { issue: 'not a key' });
check('a malformed key is a tool error', !!badKey.isError && /issue key such as ENG-42/.test(badKey.content[0]!.text), badKey);
const unknownTool = await call(claude, 'publish_update', {});
check('an unknown tool lists the valid tools', !!unknownTool.isError && /Valid tools: next_issue, find_issues, get_issue/.test(unknownTool.content[0]!.text), unknownTool);
await claude.close();

// ---------- identity ----------
const stranger = await session('some-other-client', { BASELINE_SESSION: 'other' });
const sr = await call(stranger, 'get_issue', { issue: K });
const sw = await call(stranger, 'post_progress', { issue: K, did: 'Another client looked too' });
check('any other client reads, and writes as "Agent via <person>" too', !sr.isError && sw.structuredContent?.attributed_to === `Agent via ${owner.name}`, sw);
await stranger.close();
const named = await session('some-other-client', { BASELINE_AS: 'Reviewer Bot' });
const nw = await call(named, 'post_progress', { issue: K, did: 'Reviewer Bot via BASELINE_AS' });
check('BASELINE_AS picks another agent user', nw.structuredContent?.attributed_to === `Reviewer Bot via ${owner.name}`, nw);
await named.close();
const unknown = await session('some-other-client', { BASELINE_AS: 'Nobody Bot' });
const uw = await call(unknown, 'post_progress', { issue: K, did: 'x' });
check('BASELINE_AS naming no user (and no coding tool) is a tool error, and adds nobody', !!uw.isError && /BASELINE_AS/.test(uw.content[0]!.text), uw);
await unknown.close();
const codex = await session('some-other-client', { BASELINE_AS: 'Codex' });
const cw = await call(codex, 'post_progress', { issue: K, did: 'Codex via BASELINE_AS' });
check('BASELINE_AS naming a coding tool makes its agent user: "Codex via <person>"', cw.structuredContent?.attributed_to === `Codex via ${owner.name}`, cw);
await codex.close();

// ---------- the database, read again ----------
const db = openDb(dbPath);
const rows = db.prepare(`SELECT u.name agent, c.body, c.via_user_id via FROM comments c JOIN users u ON u.id = c.user_id WHERE c.issue_id = ? ORDER BY c.created_at`).all(todo.id) as Array<{ agent: string; body: string; via: string }>;
const cc = rows.filter(r => r.agent === 'Claude Code'), ag = rows.filter(r => r.agent === 'Agent');
check('Claude Code has one living comment, via the person, holding the final summary; the other client wrote as Agent', cc.length === 1 && cc[0]!.via === owner.id && /scripts\/test-mcp\.ts passes/.test(cc[0]!.body)
  && ag.length === 1 && ag[0]!.via === owner.id, rows);
check('Reviewer Bot and Codex have their own notes, and there is one Claude Code user', rows.filter(r => r.agent === 'Reviewer Bot').length === 1 && rows.filter(r => r.agent === 'Codex').length === 1
  && (db.prepare("SELECT COUNT(*) n FROM users WHERE name = 'Claude Code' AND kind = 'agent'").get() as { n: number }).n === 1, rows.map(r => r.agent));
const state = db.prepare('SELECT s.name FROM issues i JOIN states s ON s.id = i.state_id WHERE i.id = ?').get(todo.id) as { name: string };
check(`${K} is Done in the database`, state.name === 'Done', state);
const acts = db.prepare("SELECT COUNT(*) n FROM activity WHERE issue_id = ? AND user_id = (SELECT id FROM users WHERE name = 'Claude Code') AND via_user_id = ?").get(todo.id, owner.id) as { n: number };
check('activity rows by Claude Code are via the person ("Claude Code via <person>" in the log)', acts.n > 0, acts);
db.close();

// ================================================================ hosted: Streamable HTTP at /mcp
// A hosted (Google sign-in) server, called through its own fetch: the Host check, keys only, a
// session bound to its key, and every tool call made as an /api request with that key.
const ORIGIN = 'https://baseline.example.com';
const httpDbPath = join(work, 'http.db');
const hosted = createApp(httpDbPath, { mode: 'hosted', publicUrl: new URL(ORIGIN), google: null, ownerEmail: '' }, { configured: false, send: async () => {} });
const hs = hosted.store;
const person = hs.createUser('Ada Owner', 'ada@example.com', true);
hs.createUser('Reviewer Bot', '', false, 'agent');
const mineTeam = hs.createTeam('MINE', 'Mine'), otherTeam = hs.createTeam('OTH', 'Other');
const hIssue = hs.createIssue({ teamId: mineTeam.id, title: 'Serve MCP over HTTP', stateId: hs.stateOfType(mineTeam.id, 'unstarted') }, person.id);
const otherIssue = hs.createIssue({ teamId: otherTeam.id, title: 'Another team\'s work', stateId: hs.stateOfType(otherTeam.id, 'unstarted') }, person.id);
hs.updateTeam(mineTeam.id, { triageEnabled: true });
hs.createState(mineTeam.id, 'In Review', 'started', '#4cb782');
const hProject = hs.createProject({ name: 'Hosted MCP', teamId: mineTeam.id, leadId: person.id });
const HK = hs.keyOf(hIssue), OK = hs.keyOf(otherIssue);
const fullKey = hs.ext.apiKeys.create({ name: 'agent', userId: person.id });
const teamKey = hs.ext.apiKeys.create({ name: 'mine only', userId: person.id, teamIds: [mineTeam.id] });
const readKey = hs.ext.apiKeys.create({ name: 'read only', userId: person.id, scopes: ['read'] });
const hostedFetch = (input: string | URL | Request, init?: RequestInit) => Promise.resolve(hosted.app.fetch(new Request(input, init)));

async function httpSession(clientName: string, token: string, headers: Record<string, string> = {}) {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', ORIGIN), { fetch: hostedFetch, requestInit: { headers: { authorization: `Bearer ${token}`, ...headers } } });
  const client = new Client({ name: clientName, version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}
const raw = (headers: Record<string, string>, body: unknown) => hostedFetch(`${ORIGIN}/mcp`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
});
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '0' } } };

// ---------- who may open a session ----------
check('/mcp without a key: 401, even with no cookie to fall back to', (await raw({}, INIT)).status === 401);
check('/mcp with a bad key: 401', (await raw({ authorization: 'Bearer bl_nope' }, INIT)).status === 401);
check('/mcp on another Host: refused before the key is looked at', (await hosted.app.fetch(new Request('https://evil.example.com/mcp', { method: 'POST', headers: { authorization: `Bearer ${fullKey.token}`, 'content-type': 'application/json' }, body: JSON.stringify(INIT) }))).status === 403);
const discover = await raw({ authorization: `Bearer ${fullKey.token}` }, { jsonrpc: '2.0', id: 'd', method: 'server/discover', params: {} });
check('a server/discover probe gets "method not found", so a 2026-07-28 client falls back to initialize', ((await discover.json()) as { error?: { code: number } }).error?.code === -32601);

// ---------- initialize, tools/list ----------
const { client: hc, transport: ht } = await httpSession('claude-code', fullKey.token);
check('HTTP initialize: server is baseline, a session id, the agent guide as instructions', hc.getServerVersion()?.name === 'baseline' && !!ht.sessionId && /start_issue/.test(hc.getInstructions() ?? ''));
const hTools = (await hc.listTools()).tools;
check(`HTTP tools/list: the same ${OPERATIONS.length} tools as stdio, schemas and annotations included`, JSON.stringify(hTools) === JSON.stringify(tools), hTools.map(t => t.name));
const hijack = await raw({ authorization: `Bearer ${readKey.token}`, 'mcp-session-id': ht.sessionId!, 'mcp-protocol-version': '2025-06-18' }, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
check('another key can\'t use this session: 404, like an unknown session', hijack.status === 404);

// ---------- every tool, the whole loop ----------
const hl = await call(hc, 'list_issues', { assignee: 'any', state: 'all' });
check('list_issues over HTTP', !hl.isError && hl.structuredContent?.issues.some((i: { key: string }) => i.key === HK), hl);
const hg = await call(hc, 'get_issue', { issue: HK });
check('get_issue over HTTP', !hg.isError && hg.structuredContent?.issue.key === HK, hg);
const hStart = await call(hc, 'start_issue', { issue: HK });
check(`start_issue ${HK}: In Progress, "Claude Code via Ada Owner"`, !hStart.isError && hStart.structuredContent?.state === 'In Progress' && hStart.structuredContent?.attributed_to === 'Claude Code via Ada Owner', hStart);
check('start_issue over hosted HTTP can\'t touch a repo: it returns the git command', hStart.structuredContent?.git?.status === 'manual' && /^git checkout -b /.test(hStart.structuredContent?.git?.command), hStart.structuredContent?.git);
const hp1 = await call(hc, 'post_progress', { issue: HK, did: 'Mounted /mcp', left: 'Tests' });
const hp2 = await call(hc, 'post_progress', { issue: HK, did: 'Mounted /mcp and wrote tests', left: 'Real agents' });
check('post_progress twice over HTTP: one note, rewritten', hp1.structuredContent?.created === true && hp2.structuredContent?.created === false, [hp1, hp2]);
const hpf = await call(hc, 'propose_followup', { from_issue: HK, title: 'Expire idle MCP sessions sooner' });
const hf = await call(hc, 'create_issue', { draft_id: hpf.structuredContent?.draft_id });
check('propose_followup, then create_issue on the person\'s yes, over HTTP: Triage', !hpf.isError && !hf.isError && hf.structuredContent?.state === 'Triage', [hpf, hf]);
const hFin = await call(hc, 'finish_issue', { issue: HK, outcome: 'in_review', summary: 'PR open; test-mcp passes' });
check('finish_issue in_review over HTTP', !hFin.isError && hFin.structuredContent?.state === 'In Review', hFin);
const hd = await call(hc, 'draft_project_update', { project: hProject.name, health: 'onTrack' });
check('draft_project_update over HTTP: a draft, unpublished', !hd.isError && hd.structuredContent?.published === false, hd);
const hu = await call(hc, 'undo', { op_id: hFin.structuredContent?.op_id });
check('undo the finish over HTTP: back to In Progress', !hu.isError && hs.getIssue(hIssue.id)!.stateId === hs.stateOfType(mineTeam.id, 'started'), hu);
const noPublish = await call(hc, 'publish_project_update', { project: hProject.name });
check('there is no publish tool', !!noPublish.isError && /Unknown tool/.test(noPublish.content[0]!.text));
const pub = await hostedFetch(`${ORIGIN}/api/projects/${hProject.id}/update-draft/publish`, { method: 'POST', headers: { authorization: `Bearer ${fullKey.token}`, 'content-type': 'application/json' }, body: '{}' });
check('the same key is refused for publishing the draft (403)', pub.status === 403);

// ---------- the Baseline-As header picks another agent user ----------
const { client: pc } = await httpSession('pi', fullKey.token, { [AS_HEADER]: 'Reviewer Bot' });
const pp = await call(pc, 'post_progress', { issue: HK, did: 'Reviewer Bot checked the HTTP endpoint' });
check('a Baseline-As header writes as that agent user: "Reviewer Bot via Ada Owner"', pp.structuredContent?.attributed_to === 'Reviewer Bot via Ada Owner', pp);
await pc.close();

// ---------- a key's limits apply to every tool ----------
const { client: tc } = await httpSession('codex-mcp-client', teamKey.token);
const tl = await call(tc, 'list_issues', { assignee: 'any', state: 'all' });
const ts = await call(tc, 'start_issue', { issue: OK });
check('a team-limited key: list_issues shows only its team', !tl.isError && tl.structuredContent?.issues.length > 0 && tl.structuredContent?.issues.every((i: { key: string }) => i.key.startsWith('MINE-')), tl);
check('a team-limited key: start_issue on another team\'s issue is refused, and the issue is unchanged', !!ts.isError && hs.getIssue(otherIssue.id)!.stateId === otherIssue.stateId, ts);
await tc.close();
const { client: rc } = await httpSession('claude-code', readKey.token);
const rg = await call(rc, 'get_issue', { issue: HK });
const rw = await call(rc, 'post_progress', { issue: HK, did: 'should not land' });
check('a read-only key: reads work, a write is a tool error naming the missing permission', !rg.isError && !!rw.isError && /permission/.test(rw.content[0]!.text), rw);
await rc.close();
await hc.close();

// ---------- a real socket, local mode ----------
{
  const local = createApp(join(work, 'socket.db'), { mode: 'local' }, { configured: false, send: async () => {} });
  const lk = local.store.ext.apiKeys.create({ name: 'socket', userId: local.store.snapshot().currentUser.id });
  const srv = nodeServe({ fetch: local.app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise(r => srv.once('listening', r));
  const url = new URL(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`);
  const noKey = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(INIT) });
  check('local mode: /mcp needs a key too (this machine\'s app isn\'t an MCP client)', noKey.status === 401);
  const t = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${lk.token}` } } });
  const c = new Client({ name: 'claude-code', version: '1' });
  await c.connect(t);
  const r = await call(c, 'list_issues', { assignee: 'any', limit: 2 });
  check('a real HTTP socket: initialize, tools/list and a call', (await c.listTools()).tools.length === OPERATIONS.length && !r.isError && r.structuredContent?.issues.length === 2, r);
  await t.terminateSession();
  const after = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${lk.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': t.sessionId ?? 'gone' }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) });
  check('DELETE ends the session: its id is unknown afterwards', after.status === 404);
  await c.close();
  srv.close();
  local.db.close();
}

// ---------- the hosted database, read again ----------
const hdb = openDb(httpDbPath);
const one = <T>(sql: string, ...p: string[]) => hdb.prepare(sql).get(...p) as T;
const agentId = (name: string) => one<{ id: string }>('SELECT id FROM users WHERE name = ? AND kind = \'agent\'', name).id;
const living = hdb.prepare('SELECT body, via_user_id via FROM comments WHERE issue_id = ? AND user_id = ?').all(hIssue.id, agentId('Claude Code')) as Array<{ body: string; via: string }>;
check('HTTP: one living comment by Claude Code, via the person', living.length === 1 && living[0]!.via === person.id, living);
const fu = one<{ state: string; via: string }>(`SELECT s.name state, a.via_user_id via FROM issues i JOIN states s ON s.id = i.state_id
  JOIN activity a ON a.issue_id = i.id AND a.type = 'created' WHERE i.id = (SELECT id FROM issues WHERE number = ? AND team_id = ?) AND a.user_id = ?`,
  String(hf.structuredContent?.key.split('-')[1]), mineTeam.id, agentId('Claude Code'));
check('HTTP: the follow-up is in Triage, created by Claude Code via the person', fu?.state === 'Triage' && fu.via === person.id, fu);
const draft = one<{ n: number }>('SELECT COUNT(*) n FROM project_update_drafts WHERE project_id = ? AND author_id = ? AND via_user_id = ?', hProject.id, agentId('Claude Code'), person.id);
const published = one<{ n: number }>('SELECT COUNT(*) n FROM project_updates WHERE project_id = ?', hProject.id);
check('HTTP: the draft is there, by Claude Code via the person, and nothing is published', draft.n === 1 && published.n === 0, [draft, published]);
const undone = one<{ n: number }>('SELECT COUNT(*) n FROM agent_ops WHERE id = ? AND undone_at IS NOT NULL', hFin.structuredContent?.op_id);
const hState = one<{ name: string }>('SELECT s.name FROM issues i JOIN states s ON s.id = i.state_id WHERE i.id = ?', hIssue.id);
check('HTTP: the finish is undone, the issue In Progress', undone.n === 1 && hState.name === 'In Progress', [undone, hState]);
const notVia = one<{ n: number }>('SELECT COUNT(*) n FROM activity WHERE user_id IN (SELECT id FROM users WHERE kind = \'agent\') AND (via_user_id IS NULL OR via_user_id != ?)', person.id);
check('HTTP: every activity row by an agent is via the person', notVia.n === 0, notVia);
hdb.close();
hosted.db.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
