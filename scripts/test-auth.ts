// End-to-end tests for hosted mode: Google sign-in (with Google's token endpoint stubbed),
// sessions, the CSRF and host guards, admin-only routes, and who writes are attributed to.
// Runs against a throwaway database — never touches ~/.baseline.
//
//   npx tsx scripts/test-auth.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';

const ORIGIN = 'https://baseline.example.com';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const OWNER = 'owner@example.com';

const work = mkdtempSync(join(tmpdir(), 'baseline-auth-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const { app, store, db } = createApp(join(work, 'hosted.db'), {
  mode: 'google', publicUrl: new URL(ORIGIN), clientId: CLIENT_ID, clientSecret: 'secret', ownerEmail: OWNER,
});

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};

// ---- Google's token endpoint, stubbed: whatever identity the next sign-in should return ----
let nextIdentity: Record<string, unknown> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (String(input) === 'https://oauth2.googleapis.com/token') {
    const payload = Buffer.from(JSON.stringify(nextIdentity)).toString('base64url');
    return new Response(JSON.stringify({ id_token: `e30.${payload}.sig` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
}) as typeof fetch;

const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return app.fetch(new Request(new URL(path, ORIGIN), { ...init, headers }));
};
const cookiesFrom = (res: Response): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv!.indexOf('='); out[kv!.slice(0, i)] = kv!.slice(i + 1); }
  return out;
};

/** run the whole browser dance: /auth/google → (Google) → /auth/google/callback; returns the final redirect and cookies */
async function signIn(claims: Record<string, unknown>, opts: { tamperState?: boolean; next?: string } = {}) {
  const start = await req(`/auth/google?next=${encodeURIComponent(opts.next ?? '/#/inbox')}`);
  const google = new URL(start.headers.get('location')!);
  const oauthCookie = cookiesFrom(start)['baseline_oauth']!;
  nextIdentity = {
    iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600,
    nonce: google.searchParams.get('nonce'), email_verified: true, ...claims,
  };
  const state = opts.tamperState ? 'forged' : google.searchParams.get('state');
  const res = await req(`/auth/google/callback?code=abc&state=${state}`, { cookie: `baseline_oauth=${oauthCookie}` });
  const session = cookiesFrom(res)['__Host-baseline_session'];
  return { location: res.headers.get('location') ?? '', session, google };
}
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: ORIGIN } });

// ---------- tests ----------
{
  const r = await req('/api/bootstrap');
  check('API without a session is 401', r.status === 401);
}
{
  const { google } = await signIn({ sub: 'g-owner', email: OWNER, name: 'Owner Person' }).then(x => x);
  check('sign-in redirects to Google with PKCE S256', google.searchParams.get('code_challenge_method') === 'S256' && !!google.searchParams.get('code_challenge'));
  check('redirect_uri is the public callback', google.searchParams.get('redirect_uri') === `${ORIGIN}/auth/google/callback`);
}
const stranger = await signIn({ sub: 'g-stranger', email: 'stranger@elsewhere.com', name: 'Stranger' });
check('an unknown Google account is turned away', stranger.location.endsWith('?auth_error=not-invited') && !stranger.session, stranger.location);

const forged = await signIn({ sub: 'g-owner', email: OWNER, name: 'Owner' }, { tamperState: true });
check('a callback whose state doesn\'t match is refused', forged.location.endsWith('?auth_error=expired') && !forged.session);

const unverified = await signIn({ sub: 'g-owner', email: OWNER, name: 'Owner', email_verified: false });
check('an unverified Google email is refused', unverified.location.endsWith('?auth_error=google') && !unverified.session);

const wrongAud = await signIn({ sub: 'g-owner', email: OWNER, name: 'Owner', aud: 'someone-else' });
check('an ID token for another client is refused', wrongAud.location.endsWith('?auth_error=google') && !wrongAud.session);

const owner = await signIn({ sub: 'g-owner', email: OWNER.toUpperCase(), name: 'Owner Person', picture: 'https://lh3.example/p.png' }, { next: '/#/issue/X-1' });
check('the owner email signs in (case-insensitively)', !!owner.session, owner.location);
check('…and lands on the page they asked for', owner.location === `${ORIGIN}/#/issue/X-1`, owner.location);
const ownerCookie = `__Host-baseline_session=${owner.session}`;
const boot = await (await req('/api/bootstrap', { cookie: ownerCookie })).json() as { currentUser: { id: string; name: string; admin: boolean; avatarUrl: string }; workspace: { auth: string; homeDir?: string }; teams: unknown[] };
check('bootstrap returns the signed-in person as currentUser', boot.currentUser.name === 'Owner Person' && boot.currentUser.admin);
check('the Google picture becomes the avatar', boot.currentUser.avatarUrl === 'https://lh3.example/p.png');
check('workspace reports google auth and hides the server home dir', boot.workspace.auth === 'google' && !boot.workspace.homeDir);
check('a hosted workspace starts empty (no sample data)', boot.teams.length === 0);

const ownerAgain = await signIn({ sub: 'g-owner', email: OWNER, name: 'Owner Person' }, { next: '//evil.example.com/x' });
check('a protocol-relative next can\'t be used as an open redirect', ownerAgain.location === `${ORIGIN}/`, ownerAgain.location);

// a teammate who exists from imported data (no Google link yet) signs in by email
const ada = store.createUser('Ada Osei', 'ada@example.com');
const adaIn = await signIn({ sub: 'g-ada', email: 'ada@example.com', name: 'Ada O.' });
check('an existing person with a matching email is linked on first sign-in', !!adaIn.session);
const adaCookie = `__Host-baseline_session=${adaIn.session}`;
const adaBoot = await (await req('/api/bootstrap', { cookie: adaCookie })).json() as { currentUser: { id: string; admin: boolean } };
check('…as that same person, not an admin', adaBoot.currentUser.id === ada.id && !adaBoot.currentUser.admin);
const imposter = await signIn({ sub: 'g-other', email: 'ada@example.com', name: 'Not Ada' });
check('a second Google account with the same email can\'t take over a linked person', !imposter.session, imposter.location);

// ---- CSRF and host ----
{
  const r = await req('/api/teams', { method: 'POST', body: JSON.stringify({ key: 'ENG', name: 'Eng' }), headers: { 'content-type': 'application/json' }, cookie: ownerCookie });
  check('a write without Origin is refused', r.status === 403);
  const r2 = await req('/api/teams', { method: 'POST', body: JSON.stringify({ key: 'ENG', name: 'Eng' }), headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' }, cookie: ownerCookie });
  check('a write from another origin is refused', r2.status === 403);
  const r3 = await app.fetch(new Request('https://rebound.example.net/api/bootstrap', { headers: { cookie: ownerCookie } }));
  check('a request addressed to another host is refused', r3.status === 403);
}

// ---- attribution: writes are the signed-in person's ----
const team = await (await req('/api/teams', { ...json({ key: 'ENG', name: 'Eng' }), cookie: ownerCookie })).json() as { team: { id: string } };
check('a same-origin write with a session works', !!team.team?.id);
const issue = (await (await req('/api/issues', { ...json({ teamId: team.team.id, title: 'Hello' }), cookie: adaCookie })).json() as { issue: { id: string; creatorId?: string } }).issue;
const creator = (db.prepare('SELECT creator_id FROM issues WHERE id = ?').get(issue.id) as { creator_id: string }).creator_id;
check('an issue created by Ada is Ada\'s', creator === ada.id, creator);
const created = db.prepare("SELECT user_id FROM activity WHERE issue_id = ? AND type = 'created'").get(issue.id) as { user_id: string };
check('…and so is its activity', created.user_id === ada.id);
const comment = await (await req(`/api/issues/${issue.id}/comments`, { ...json({ body: 'hi', userId: boot.currentUser.id }), cookie: adaCookie })).json() as { comment: { userId: string } };
check('a comment can\'t be posted as someone else (body userId ignored)', comment.comment.userId === ada.id);
await req(`/api/issues/${issue.id}/subscribe`, { ...json({ subscribed: true, userId: boot.currentUser.id }), cookie: adaCookie });
check('subscribing subscribes yourself, not the userId sent', store.isSubscribed(issue.id, ada.id));
{
  // in flight together, so the per-request acting user has to survive interleaved awaits
  const [a, o] = await Promise.all([
    req('/api/issues', { ...json({ teamId: team.team.id, title: 'A' }), cookie: adaCookie }),
    req('/api/issues', { ...json({ teamId: team.team.id, title: 'B' }), cookie: ownerCookie }),
  ]);
  const [ia, io] = [await a.json() as { issue: { id: string } }, await o.json() as { issue: { id: string } }];
  const by = (id: string) => (db.prepare('SELECT creator_id FROM issues WHERE id = ?').get(id) as { creator_id: string }).creator_id;
  check('two people writing at once are each attributed correctly', by(ia.issue.id) === ada.id && by(io.issue.id) === boot.currentUser.id);
}

// ---- admin-only ----
{
  const r = await req('/api/users', { ...json({ name: 'Sneaky', admin: true }), cookie: adaCookie });
  check('a member can\'t add people', r.status === 403);
  const r2 = await req(`/api/users/${ada.id}`, { ...json({ admin: true }), method: 'PATCH', cookie: adaCookie });
  const stillMember = !(db.prepare('SELECT admin FROM users WHERE id = ?').get(ada.id) as { admin: number }).admin;
  check('a member can\'t make themselves admin', r2.status === 200 && stillMember);
  const r3 = await req(`/api/users/${boot.currentUser.id}`, { ...json({ name: 'Renamed' }), method: 'PATCH', cookie: adaCookie });
  check('a member can\'t edit someone else', r3.status === 403);
  const r4 = await req(`/api/users/${ada.id}`, { ...json({ name: 'Ada Osei', email: 'other@x.com' }), method: 'PATCH', cookie: adaCookie });
  const row = db.prepare('SELECT name, email FROM users WHERE id = ?').get(ada.id) as { name: string; email: string };
  check('a member can rename themselves, but not change their email', r4.status === 200 && row.name === 'Ada Osei' && row.email === 'ada@example.com');
  check('a member can\'t export the workspace', (await req('/api/export', { cookie: adaCookie })).status === 403);
  check('a member can\'t import over it', (await req('/api/import', { ...json({ json: '{}' }), cookie: adaCookie })).status === 403);
  check('nobody can reseed a hosted workspace', (await req('/api/seed', { ...json({}), cookie: ownerCookie })).status === 403);
  check('the admin can export', (await req('/api/export', { cookie: ownerCookie })).status === 200);
  check('the hosted server won\'t open programs or probe its disk', (await req(`/api/issues/${issue.id}/open-claude`, { ...json({}), cookie: ownerCookie })).status === 403
    && (await req('/api/locations', { ...json({ path: '/etc' }), cookie: ownerCookie })).status === 403);
}

// ---- sessions ----
{
  const out = await req('/api/auth/logout', { ...json({}), cookie: adaCookie });
  check('logout succeeds', out.status === 200);
  check('…and the session no longer works', (await req('/api/bootstrap', { cookie: adaCookie })).status === 401);
  const relog = await signIn({ sub: 'g-ada', email: 'ada@example.com', name: 'Ada' });
  db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(ada.id);
  check('a suspended person\'s session stops working', (await req('/api/bootstrap', { cookie: `__Host-baseline_session=${relog.session}` })).status === 401);
  const again = await signIn({ sub: 'g-ada', email: 'ada@example.com', name: 'Ada' });
  check('…and they can\'t sign in again', again.location.endsWith('?auth_error=suspended') && !again.session);
  db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  check('an expired session is rejected', (await req('/api/bootstrap', { cookie: ownerCookie })).status === 401);
  const stored = db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>;
  check('the database stores token hashes, not tokens', stored.every(s => s.id !== owner.session));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
