// `baseline mcp` over the real protocol: spawns the CLI's MCP server on a scratch database, runs
// initialize, tools/list and tools/call through the SDK's client, then re-reads the database.
// Checks that every op is a tool with its schemas and annotations, that a client named like Claude
// Code writes as "Claude Code via <person>", that repeated progress converges on one living
// comment, that errors are tool errors listing valid values, and that stdout carries only protocol.
// Throwaway database — never touches ~/.baseline.
//
//   npx tsx scripts/test-mcp.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openDb } from '../src/core/db.js';
import { createApp } from '../src/server/index.js';
import { OPERATIONS } from '../src/ops/index.js';
import { annotationsOf, type AnyOperation } from '../src/ops/operation.js';
import { toolOf } from '../src/mcp/server.js';

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
db0.close();

async function session(clientName: string, env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: join(root, 'node_modules/.bin/tsx'), args: [join(root, 'src/cli/index.ts'), 'mcp', '--db', dbPath],
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

// ---------- initialize, tools/list ----------
const claude = await session('claude-code');
check('initialize: server is baseline, with instructions naming the work loop', claude.getServerVersion()?.name === 'baseline' && /start_issue/.test(claude.getInstructions() ?? ''));
const { tools } = await claude.listTools();
check(`tools/list: ${OPERATIONS.length} tools, one per op, in registry order`, tools.length === 8 && tools.map(t => t.name).join() === OPERATIONS.map(o => o.name).join(), tools.map(t => t.name));
for (const op of OPERATIONS as readonly AnyOperation[]) {
  const t = tools.find(x => x.name === op.name);
  const want = toolOf(op);
  check(`${op.name}: description, input/output schema and annotations match the op`, !!t && t.description === op.description
    && JSON.stringify(t.inputSchema) === JSON.stringify(want.inputSchema) && JSON.stringify(t.outputSchema) === JSON.stringify(want.outputSchema)
    && JSON.stringify(t.annotations) === JSON.stringify(annotationsOf(op)), t);
}
check('reads are readOnlyHint, undo destructiveHint, writes neither', tools.filter(t => t.annotations?.readOnlyHint).map(t => t.name).join() === 'get_issue,list_issues'
  && tools.filter(t => t.annotations?.destructiveHint).map(t => t.name).join() === 'undo');

// ---------- the work loop ----------
const s = await call(claude, 'start_issue', { issue: K });
check(`start_issue ${K}: In Progress, attributed to Claude Code via the person, structuredContent`, !s.isError && s.structuredContent?.state === 'In Progress'
  && s.structuredContent?.attributed_to === `Claude Code via ${owner.name}` && /Started/.test(s.content[0]!.text), s);
const p1 = await call(claude, 'post_progress', { issue: K, did: 'Investigated the stdio transport', left: 'Wire the tools' });
const p2 = await call(claude, 'post_progress', { issue: K, did: 'Wired the tools', left: 'Tests' });
check('post_progress twice: created, then rewritten', p1.structuredContent?.created === true && p2.structuredContent?.created === false && !!p2.structuredContent?.op_id, [p1, p2]);
const f = await call(claude, 'finish_issue', { issue: K, outcome: 'done', summary: 'MCP server wired; scripts/test-mcp.ts passes' });
check('finish_issue done: Done', !f.isError && f.structuredContent?.state === 'Done', f);

// ---------- errors are tool errors, with valid values ----------
const bad = await call(claude, 'list_issues', { state: 'Doing' });
check('an unknown state is a tool error listing the valid states', !!bad.isError && /valid states: open, all/.test(bad.content[0]!.text), bad);
const badKey = await call(claude, 'get_issue', { issue: 'not a key' });
check('a malformed key is a tool error', !!badKey.isError && /issue key such as ENG-42/.test(badKey.content[0]!.text), badKey);
const unknownTool = await call(claude, 'publish_update', {});
check('an unknown tool lists the valid tools', !!unknownTool.isError && /Valid tools: get_issue, list_issues/.test(unknownTool.content[0]!.text), unknownTool);
await claude.close();

// ---------- identity ----------
const codex = await session('codex-mcp-client');
const cs = await call(codex, 'post_progress', { issue: K, did: 'Codex looked too' });
check('a Codex client adds the Codex agent user (local) and writes as "Codex via <person>"', cs.structuredContent?.attributed_to === `Codex via ${owner.name}`, cs);
await codex.close();
const stranger = await session('some-other-client');
const sr = await call(stranger, 'get_issue', { issue: K });
const sw = await call(stranger, 'post_progress', { issue: K, did: 'x' });
check('an unknown client can read, and a write says to set BASELINE_AS', !sr.isError && !!sw.isError && /Set BASELINE_AS/.test(sw.content[0]!.text), sw);
await stranger.close();
const named = await session('some-other-client', { BASELINE_AS: 'pi' });
const nw = await call(named, 'post_progress', { issue: K, did: 'pi via BASELINE_AS' });
check('BASELINE_AS wins over clientInfo (pi, added on first use)', nw.structuredContent?.attributed_to === `pi via ${owner.name}`, nw);
await named.close();

// ---------- the database, read again ----------
const db = openDb(dbPath);
const rows = db.prepare(`SELECT u.name agent, c.body, c.via_user_id via FROM comments c JOIN users u ON u.id = c.user_id WHERE c.issue_id = ? ORDER BY c.created_at`).all(todo.id) as Array<{ agent: string; body: string; via: string }>;
const mine = rows.filter(r => r.agent === 'Claude Code');
check('one living comment by Claude Code, via the person, holding the final summary', mine.length === 1 && mine[0]!.via === owner.id && /scripts\/test-mcp\.ts passes/.test(mine[0]!.body), rows);
check('Codex and pi each have their own note', rows.filter(r => r.agent === 'Codex').length === 1 && rows.filter(r => r.agent === 'pi').length === 1, rows.map(r => r.agent));
const state = db.prepare('SELECT s.name FROM issues i JOIN states s ON s.id = i.state_id WHERE i.id = ?').get(todo.id) as { name: string };
check(`${K} is Done in the database`, state.name === 'Done', state);
const acts = db.prepare("SELECT COUNT(*) n FROM activity WHERE issue_id = ? AND user_id = (SELECT id FROM users WHERE name = 'Claude Code') AND via_user_id = ?").get(todo.id, owner.id) as { n: number };
check('activity rows by Claude Code are via the person', acts.n > 0, acts);
db.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
