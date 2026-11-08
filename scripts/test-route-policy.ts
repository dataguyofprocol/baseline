// Every registered /api route must have a row in src/server/route-policy.ts, and every row must match
// what the middleware does: the key permission it needs, and how a key limited to one team is kept
// out of another team's data (by calling the route with such a key). Throwaway database.
//
//   npx tsx scripts/test-route-policy.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';
import { ROUTE_POLICY, type KeyScope, type TeamRule } from '../src/server/route-policy.js';
import type { ApiKey, ApiKeyScope } from '../src/core/types.js';

const ORIGIN = 'https://baseline.example.com';
const work = mkdtempSync(join(tmpdir(), 'baseline-route-policy-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const { app, store } = createApp(join(work, 'policy.db'), {
  mode: 'google', publicUrl: new URL(ORIGIN), clientId: 'c', clientSecret: 's', ownerEmail: '',
}, { configured: false, send: async () => {} });
const { apiKeys } = store.ext;

const owner = store.createUser('Owner', 'owner@example.com', true);
const mine = store.createTeam('MINE', 'Mine');
const other = store.createTeam('OTH', 'Other');
const foreign = store.createIssue({ teamId: other.id, title: 'Other team issue' }, owner.id);
const SECRET = 'other-team-secret-comment';
store.addComment(foreign.id, owner.id, SECRET);
const attachment = store.addAttachment({ issueId: foreign.id, kind: 'link', url: 'https://example.com/x', title: 'x' });
const limited = apiKeys.create({ name: 'limited', userId: owner.id, teamIds: [mine.id] });

let pass = 0, fail = 0;
const problems: string[] = [];
const check = (ok: boolean, what: string) => { if (ok) pass++; else { fail++; problems.push(what); } };

// the routes Hono has, as "METHOD /path" (app.use middleware shows up as ALL)
const registered = [...new Set(app.routes.filter(r => r.method !== 'ALL' && (r.path.startsWith('/api') || r.path === '/mcp')).map(r => `${r.method} ${r.path}`))];
for (const r of registered) check(r in ROUTE_POLICY, `${r} is registered but has no row in src/server/route-policy.ts`);
for (const r of Object.keys(ROUTE_POLICY)) check(registered.includes(r), `${r} has a policy row but no route`);

/** a concrete path for a route pattern, with its first parameter set to `first` */
const pathFor = (pattern: string, first: string) => {
  let used = false;
  return pattern.replace(/:[A-Za-z]+(\{([^}]*)\})?\??|\*/g, (_m, _g, alts?: string) => {
    if (alts) return alts.split('|')[0]!;
    if (used) return 'x';
    used = true;
    return encodeURIComponent(first);
  });
};
const scopeOf = (method: string, path: string): KeyScope => {
  const lacks = (scopes: ApiKeyScope[]) => apiKeys.missingScope({ scopes } as ApiKey, method, path);
  return !lacks(['read']) ? 'read' : !lacks(['write']) ? 'write' : 'admin';
};
const call = (method: string, path: string, body?: unknown) => app.fetch(new Request(new URL(path, ORIGIN), {
  method, headers: { authorization: `Bearer ${limited.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}));
const teamRefusal = async (res: Response) => res.status === 403 && /team/.test(((await res.json().catch(() => ({}))) as { error?: string }).error ?? '');

/** start_issue on the other team's issue, over raw Streamable HTTP with the team-limited key: the issue is invisible to it, and unchanged */
let mcpResult: boolean | undefined;
async function mcpRefusesOtherTeam(): Promise<boolean> {
  if (mcpResult !== undefined) return mcpResult;
  const rpc = (body: unknown, session?: string) => app.fetch(new Request(new URL('/mcp', ORIGIN), {
    method: 'POST', body: JSON.stringify(body),
    headers: { authorization: `Bearer ${limited.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
  }));
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '0' } } });
  const session = init.headers.get('mcp-session-id') ?? undefined;
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  const res = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'start_issue', arguments: { issue: store.keyOf(foreign) } } }, session)).json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
  const noKey = await app.fetch(new Request(new URL('/mcp', ORIGIN), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  mcpResult = !!session && !!res.result?.isError && /No issue OTH-1/.test(res.result.content?.[0]?.text ?? '') && noKey.status === 401
    && store.getIssue(foreign.id)!.stateId === stateBefore;
  if (!mcpResult) console.log('mcp refusal detail:', init.status, session, JSON.stringify(res), noKey.status);
  return mcpResult;
}
const stateBefore = store.getIssue(foreign.id)!.stateId;

// which path shapes the middleware maps to a team (mirrors ApiKeys.teamAllowed)
const NAMES_ISSUE = /^\/api\/issues\/:/;
const NAMES_TEAM = /^\/api\/(teams|git\/automation)\/:/;
const NAMES_FILE = /^\/api\/(files|attachments|emoji-files)\/:/;
const counts: Partial<Record<TeamRule, number>> = {};
const unchecked: string[] = [];

for (const route of registered.filter(r => r in ROUTE_POLICY)) {
  const [method, pattern] = route.split(' ') as [string, string];
  const { scope, team } = ROUTE_POLICY[route]!;
  counts[team] = (counts[team] ?? 0) + 1;
  check(scopeOf(method, pathFor(pattern, 'x')) === scope, `${route}: the row says a key needs "${scope}", the middleware asks for "${scopeOf(method, pathFor(pattern, 'x'))}"`);
  if (team !== 'issue') check(!NAMES_ISSUE.test(pattern) || pattern.startsWith('/api/issues/by-key'), `${route}: an issue id in the path is checked by the middleware — classify it as "issue"`);
  if (team !== 'team') check(!NAMES_TEAM.test(pattern), `${route}: a team id in the path is checked by the middleware — classify it as "team"`);
  if (team !== 'file') check(!NAMES_FILE.test(pattern), `${route}: a file id in the path is checked by the middleware — classify it as "file"`);

  const body = method === 'GET' ? undefined : { teamId: other.id, ids: [foreign.id], title: 'x', name: 'x', key: 'ZZ' };
  switch (team) {
    case 'issue': check(await teamRefusal(await call(method, pathFor(pattern, foreign.id), body && {})), `${route}: a key limited to another team was not refused for this issue`); break;
    case 'team': check(await teamRefusal(await call(method, pathFor(pattern, other.id), body && {})), `${route}: a key limited to another team was not refused for this team`); break;
    case 'file': check(await teamRefusal(await call(method, pathFor(pattern, attachment.id), body && {})), `${route}: a key limited to another team was not refused for this file`); break;
    case 'body': check(await teamRefusal(await call(method, pathFor(pattern, 'x'), body)), `${route}: a body naming another team was not refused`); break;
    case 'response': {
      check(method === 'GET', `${route}: only reads can rely on response scoping`);
      const res = await call(method, pathFor(pattern, store.keyOf(foreign)));
      const text = await res.text();
      check(![foreign.id, other.id, SECRET].some(s => text.includes(s)), `${route}: the response shows another team's data to a team-limited key`);
      break;
    }
    case 'keyless': check((await call(method, pathFor(pattern, 'x'), body && {})).status === 403, `${route}: a key was not refused`); break;
    case 'mcp': check(await mcpRefusesOtherTeam(), `${route}: a key limited to another team reached its issue through an MCP tool`); break;
    case 'unchecked': unchecked.push(route); break;
    case 'workspace': case 'public': break;
  }
}

console.log(`${registered.length} /api routes: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
console.log(`unchecked (team data a team-limited key can still reach — known gaps): ${unchecked.length}\n  ${unchecked.join('\n  ')}`);
for (const p of problems) console.log(`✗ ${p}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
