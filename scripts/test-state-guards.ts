// Regression tests for lifecycle invariants that used to be enforced only by convention:
//  - an issue's completedAt/canceledAt come only from its state, never from a raw PATCH body
//  - the workspace always keeps at least one active admin, whichever route changes admin rights
//  - importing a backup is all-or-nothing: a bad file leaves the current workspace untouched
// Runs against a throwaway local-mode database — never touches ~/.baseline.
//
//   npx tsx scripts/test-state-guards.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';

const ORIGIN = 'http://localhost:7327';
const work = mkdtempSync(join(tmpdir(), 'baseline-guards-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const { app, store, db } = createApp(join(work, 'local.db'), { mode: 'local' }, { configured: false, send: async () => {} });

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};
const call = (method: string, path: string, body?: unknown) => app.fetch(new Request(new URL(path, ORIGIN), {
  method, headers: { 'content-type': 'application/json', origin: ORIGIN }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
const row = (issueId: string) => db.prepare('SELECT state_id, completed_at, canceled_at, archived_at, team_id, number FROM issues WHERE id = ?').get(issueId) as
  { state_id: string; completed_at: string | null; canceled_at: string | null; archived_at: string | null; team_id: string; number: number };

// ---------- the sample workspace itself is consistent ----------
{
  const bad = db.prepare(`SELECT COUNT(*) n FROM issues i JOIN states s ON s.id = i.state_id
    WHERE (i.completed_at IS NOT NULL) != (s.type = 'completed') OR (i.canceled_at IS NOT NULL AND s.type != 'canceled')`).get() as { n: number };
  check('seeded issues have a completion date iff they are in a completed state', bad.n === 0, `${bad.n} mismatched`);
  const core = store.snapshot().teams.find(t => t.key === 'CORE')!;
  const done = store.listIssues({ teamId: core.id, stateType: 'completed' });
  check('listIssues honours its stateType filter', done.length > 0 && done.every(i => store.snapshot().states.find(s => s.id === i.stateId)?.type === 'completed'));
}

// ---------- issue PATCH: lifecycle timestamps are derived, not written ----------
{
  const snap = store.snapshot();
  const core = snap.teams.find(t => t.key === 'CORE')!;
  const todo = snap.states.find(s => s.teamId === core.id && s.type === 'unstarted')!;
  const done = snap.states.find(s => s.teamId === core.id && s.type === 'completed')!;
  const issue = snap.issues.find(i => i.teamId === core.id && i.stateId === todo.id)!;
  const before = row(issue.id);

  const r = await call('PATCH', `/api/issues/${issue.id}`, { title: 'Still todo', completedAt: '2020-01-01T00:00:00.000Z', canceledAt: '2020-01-01T00:00:00.000Z', teamId: 'nope', number: 9999 });
  const after = row(issue.id);
  check('a PATCH still applies the fields it may set', r.status === 200 && store.getIssue(issue.id)?.title === 'Still todo');
  check('a PATCH can\'t give a Todo issue a completion or cancel date', after.completed_at === null && after.canceled_at === null, JSON.stringify(after));
  check('a PATCH can\'t move an issue\'s team or number', after.team_id === before.team_id && after.number === before.number);
  const echoed = (await r.json() as { issue: { completedAt: string | null; teamId: string } }).issue;
  check('…and the response matches what was stored', echoed.completedAt === null && echoed.teamId === before.team_id);

  await call('PATCH', `/api/issues/${issue.id}`, { stateId: done.id });
  const closed = row(issue.id);
  check('moving to a completed state still stamps completedAt', !!closed.completed_at && closed.state_id === done.id);
  await call('PATCH', `/api/issues/${issue.id}`, { completedAt: null });
  check('…and a PATCH can\'t clear it while the issue is Done', row(issue.id).completed_at === closed.completed_at);
  await call('PATCH', `/api/issues/${issue.id}`, { stateId: todo.id });
  check('moving back to Todo clears completedAt', row(issue.id).completed_at === null);

  await call('PATCH', `/api/issues/${issue.id}`, { archivedAt: '2026-01-01T00:00:00.000Z' });
  check('archivedAt is still settable (archive is a PATCH)', row(issue.id).archived_at === '2026-01-01T00:00:00.000Z');
  await call('PATCH', `/api/issues/${issue.id}`, { archivedAt: null });
}

// ---------- admin rights: never zero admins ----------
{
  const activeAdmins = () => (db.prepare("SELECT id FROM users WHERE admin = 1 AND status = 'active' AND kind = 'human'").all() as Array<{ id: string }>).map(u => u.id);
  const humans = (db.prepare("SELECT id FROM users WHERE kind = 'human' AND status = 'active'").all() as Array<{ id: string }>).map(u => u.id);
  // reduce to exactly one admin through the route, then try to remove that one too
  const keep = activeAdmins()[0] ?? humans[0]!;
  if (!activeAdmins().length) await call('PATCH', `/api/users/${keep}`, { admin: true });
  for (const id of activeAdmins().filter(id => id !== keep)) await call('PATCH', `/api/users/${id}`, { admin: false });
  check('setup: exactly one active admin', activeAdmins().length === 1 && activeAdmins()[0] === keep, JSON.stringify(activeAdmins()));

  const r = await call('PATCH', `/api/users/${keep}`, { admin: false });
  const body = await r.json() as { code?: string };
  check('PATCH /api/users can\'t demote the last admin', r.status === 400 && body.code === 'last-admin', `${r.status} ${JSON.stringify(body)}`);
  check('…and they are still an admin', activeAdmins().includes(keep));

  const other = humans.find(id => id !== keep)!;
  const promote = await call('PATCH', `/api/users/${other}`, { admin: true });
  check('promoting someone else works', promote.status === 200 && activeAdmins().includes(other));
  const demote = await call('PATCH', `/api/users/${keep}`, { admin: false });
  check('…after which the first admin can step down', demote.status === 200 && !activeAdmins().includes(keep));
  const rename = await call('PATCH', `/api/users/${other}`, { name: 'Still Admin', admin: true });
  check('a profile edit alongside admin still saves the profile', rename.status === 200 && (db.prepare('SELECT name FROM users WHERE id = ?').get(other) as { name: string }).name === 'Still Admin');
}

// ---------- import: all-or-nothing ----------
{
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  const backup = JSON.parse(store.exportJson()) as { issues: unknown[] };
  const before = { issues: count('issues'), teams: count('teams'), users: count('users'), meta: count('meta') };
  // a backup that wipes fine, then breaks partway: the same issue twice violates the primary key
  const broken = JSON.stringify({ ...backup, issues: [...backup.issues, backup.issues[0]] });
  const r = await call('POST', '/api/import', { json: broken });
  check('a broken backup is rejected', r.status === 400);
  const after = { issues: count('issues'), teams: count('teams'), users: count('users'), meta: count('meta') };
  check('…and the workspace is exactly as it was (no wipe, no half-restore)', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check('…and the store still works afterwards', store.snapshot().teams.length === before.teams);

  const ok = await call('POST', '/api/import', { json: JSON.stringify(backup) });
  check('a good backup still imports', ok.status === 200 && count('issues') === before.issues, `${ok.status} ${count('issues')}`);
  check('store.transaction rolls back a throwing body', (() => {
    const n = count('issues');
    try { store.transaction(() => { db.exec('DELETE FROM issues'); throw new Error('boom'); }); } catch { /* expected */ }
    return count('issues') === n;
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
