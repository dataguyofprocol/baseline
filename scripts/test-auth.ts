// End-to-end tests for hosted mode: Google sign-in (with Google's token endpoint stubbed),
// sessions, the CSRF and host guards, admin-only routes, and who writes are attributed to.
// Runs against a throwaway database — never touches ~/.baseline.
//
//   npx tsx scripts/test-auth.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';
import type { MailMessage } from '../src/server/mail.js';
import { DatabaseSync } from 'node:sqlite';

const ORIGIN = 'https://baseline.example.com';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const OWNER = 'owner@example.com';

const work = mkdtempSync(join(tmpdir(), 'baseline-auth-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
// email goes to this list instead of an SMTP server
const sent: MailMessage[] = [];
const dbFile = join(work, 'hosted.db');
const { app, store, db, changes } = createApp(dbFile, {
  mode: 'google', publicUrl: new URL(ORIGIN), clientId: CLIENT_ID, clientSecret: 'secret', ownerEmail: OWNER,
}, { configured: true, send: async (m) => { sent.push(m); } });

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
// each sign-in comes from its own address, so the sign-in rate limit only bites where a test means it to
let ipSeq = 0;
async function signIn(claims: Record<string, unknown>, opts: { tamperState?: boolean; next?: string; invite?: string; ip?: string } = {}) {
  const ip = opts.ip ?? `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  const start = await req(`/auth/google?next=${encodeURIComponent(opts.next ?? '/#/inbox')}${opts.invite ? `&invite=${opts.invite}` : ''}`, { headers: { 'x-forwarded-for': ip } });
  const google = new URL(start.headers.get('location')!);
  const oauthCookie = cookiesFrom(start)['baseline_oauth']!;
  nextIdentity = {
    iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600,
    nonce: google.searchParams.get('nonce'), email_verified: true, ...claims,
  };
  const state = opts.tamperState ? 'forged' : google.searchParams.get('state');
  const res = await req(`/auth/google/callback?code=abc&state=${state}`, { cookie: `baseline_oauth=${oauthCookie}`, headers: { 'x-forwarded-for': ip } });
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

// ---- per-person state ----
const patch = (path: string, body: unknown, cookie: string) => req(path, { ...json(body), method: 'PATCH', cookie });
type Boot = { favorites: Array<{ refId: string }>; views: Array<{ id: string; shared: boolean }>; notifications: Array<{ id: string; type: string; body: string; readAt: string | null; issueId: string | null }>; workspace: { preferences: { homeView: string } } };
const bootOf = async (cookie: string) => await (await req('/api/bootstrap', { cookie })).json() as Boot;
{
  await req('/api/favorites/toggle', { ...json({ type: 'issue', refId: issue.id }), cookie: ownerCookie });
  check('a favorite is yours alone', (await bootOf(ownerCookie)).favorites.some(f => f.refId === issue.id) && !(await bootOf(adaCookie)).favorites.length);

  const personal = (await (await req('/api/views', { ...json({ name: 'Mine', filters: {}, shared: false }), cookie: adaCookie })).json() as { view: { id: string } }).view;
  const shared = (await (await req('/api/views', { ...json({ name: 'Ours', filters: {} }), cookie: adaCookie })).json() as { view: { id: string } }).view;
  const ownerViews = (await bootOf(ownerCookie)).views.map(v => v.id);
  check('a personal view is hidden from others; a shared one isn\'t', !ownerViews.includes(personal.id) && ownerViews.includes(shared.id));
  check('…and others can\'t edit or delete it', (await patch(`/api/views/${personal.id}`, { name: 'x' }, ownerCookie)).status === 404
    && (await req(`/api/views/${personal.id}`, { method: 'DELETE', cookie: ownerCookie, headers: { origin: ORIGIN } })).status === 404);
  await patch(`/api/views/${shared.id}`, { shared: false }, ownerCookie);
  check('only a view\'s owner can make it personal', (await bootOf(ownerCookie)).views.some(v => v.id === shared.id && v.shared));
  await patch(`/api/views/${personal.id}`, { shared: true }, adaCookie);
  check('…and its owner can share it', (await bootOf(ownerCookie)).views.some(v => v.id === personal.id));

  await patch('/api/preferences', { homeView: 'my-issues' }, adaCookie);
  check('preferences are per person', (await bootOf(adaCookie)).workspace.preferences.homeView === 'my-issues' && (await bootOf(ownerCookie)).workspace.preferences.homeView !== 'my-issues');

  await req(`/api/issues/${issue.id}/remind`, { ...json({ at: new Date(Date.now() - 1000).toISOString() }), cookie: adaCookie });
  const adaInbox = (await bootOf(adaCookie)).notifications;
  check('a reminder lands in the inbox of whoever set it', adaInbox.some(n => n.type === 'issueReminder') && !(await bootOf(ownerCookie)).notifications.some(n => n.type === 'issueReminder'));
  await req('/api/notifications/read-all', { ...json({}), cookie: ownerCookie });
  check('marking all read only touches your own inbox', (await bootOf(adaCookie)).notifications.some(n => n.type === 'issueReminder' && !n.readAt));
  const reminder = adaInbox.find(n => n.type === 'issueReminder')!;
  const nid = (db.prepare("SELECT id FROM notifications WHERE type = 'issueReminder'").get() as { id: string }).id;
  await req(`/api/notifications/${nid}`, { method: 'DELETE', cookie: ownerCookie, headers: { origin: ORIGIN } });
  check('nobody can delete someone else\'s notification', !!reminder && !!db.prepare('SELECT 1 FROM notifications WHERE id = ?').get(nid));

  // ---- mentions ----
  const ownerId = boot.currentUser.id;
  const subscribed = (uid: string) => store.isSubscribed(issue.id, uid);
  store.unsubscribe(issue.id, ownerId);
  db.prepare("DELETE FROM notifications WHERE type = 'issueMentioned'").run();
  await req(`/api/issues/${issue.id}/comments`, { ...json({ body: `ping @[Owner Person](user:${ownerId}) please` }), cookie: adaCookie });
  const mention = (await bootOf(ownerCookie)).notifications.find(n => n.type === 'issueMentioned');
  check('an id mention subscribes and notifies that person', subscribed(ownerId) && !!mention);
  check('…and the inbox line reads as a plain name', mention?.body === 'ping @Owner Person please', mention?.body);
  const samA = store.createUser('Sam Lee', 'sam.a@example.com'), samB = store.createUser('Sam Lee', 'sam.b@example.com');
  await req(`/api/issues/${issue.id}/comments`, { ...json({ body: 'hey @Sam Lee' }), cookie: adaCookie });
  check('a plain name two people share mentions nobody', !subscribed(samA.id) && !subscribed(samB.id));
  await req(`/api/issues/${issue.id}/comments`, { ...json({ body: `hey @[Sam Lee](user:${samB.id})` }), cookie: adaCookie });
  check('…while an id mention picks exactly one of them', !subscribed(samA.id) && subscribed(samB.id));
  const solo = store.createUser('Priya Nair', 'priya@example.com'), priyaShort = store.createUser('Priya', 'p2@example.com');
  await req(`/api/issues/${issue.id}/comments`, { ...json({ body: 'cc @Priya Nair' }), cookie: adaCookie });
  check('a plain unique name still works (CLI-written text), longest name first', subscribed(solo.id) && !subscribed(priyaShort.id));
  const handoff = await (await req(`/api/issues/${issue.id}/handoff`, { cookie: adaCookie })).json() as { handoff: { prompt: string } };
  check('hand-off prompts carry the readable form', !handoff.handoff.prompt.includes('](user:'));

  // ---- uploaded files (only real images are stored; their type comes from the bytes, not the uploader) ----
  const up = (name: string, type: string, body: string | Uint8Array) => req(`/api/files?owner=issue:${issue.id}&name=${name}`, { method: 'POST', body, headers: { 'content-type': type, origin: ORIGIN }, cookie: adaCookie });
  check('an HTML file is refused', (await up('evil.html', 'image/png', '<script>alert(1)</script>')).status === 415);
  const svgUp = await (await up('x.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).json() as { file: { url: string } };
  const svg = await req(svgUp.file.url, { cookie: adaCookie });
  check('an SVG (which can carry script) is served with nosniff and a sandboxing CSP', svg.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(svg.headers.get('content-security-policy') ?? '') && !/allow-scripts/.test(svg.headers.get('content-security-policy') ?? ''));
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const pngUp = await (await up('a.png', 'text/html', pngBytes)).json() as { file: { url: string } };
  const png = await req(pngUp.file.url, { cookie: adaCookie });
  check('a PNG shows inline as image/png, whatever type the upload claimed', png.headers.get('content-type') === 'image/png' && png.headers.get('content-disposition')!.startsWith('inline'));
  check('files need a session', (await req(pngUp.file.url)).status === 401);
}

// ---- each person's own inbox: two people on one issue ----
{
  const ownerId = boot.currentUser.id;
  type Row = Boot['notifications'][number];
  const inbox = async (cookie: string, issueId: string) => (await bootOf(cookie)).notifications.filter(n => n.issueId === issueId);
  const has = (rows: Row[], type: string) => rows.some(n => n.type === type);
  const shared = (await (await req('/api/issues', { ...json({ teamId: team.team.id, title: 'Shared work' }), cookie: ownerCookie })).json() as { issue: { id: string } }).issue;

  await patch(`/api/issues/${shared.id}`, { assigneeId: ada.id }, ownerCookie);
  let [o, a] = [await inbox(ownerCookie, shared.id), await inbox(adaCookie, shared.id)];
  check('assigning Ada lands in Ada\'s inbox, not the assigner\'s', has(a, 'issueAssignedToYou') && !has(o, 'issueAssignedToYou'));

  await req(`/api/issues/${shared.id}/comments`, { ...json({ body: `@[Ada Osei](user:${ada.id}) can you look?` }), cookie: ownerCookie });
  [o, a] = [await inbox(ownerCookie, shared.id), await inbox(adaCookie, shared.id)];
  check('a mention reaches the person mentioned, not the writer', has(a, 'issueMentioned') && !has(o, 'issueMentioned'));
  check('…once: no plain comment notification on top of the mention', !has(a, 'issueCommented'));
  await req(`/api/issues/${shared.id}/comments`, { ...json({ body: `@[Owner Person](user:${ownerId}) on it` }), cookie: adaCookie });
  [o, a] = [await inbox(ownerCookie, shared.id), await inbox(adaCookie, shared.id)];
  check('Ada mentioning the owner lands in the owner\'s inbox only', has(o, 'issueMentioned') && a.filter(n => n.type === 'issueMentioned').length === 1);

  const root = (await (await req(`/api/issues/${shared.id}/comments`, { ...json({ body: 'Plan: ship it Friday' }), cookie: ownerCookie })).json() as { comment: { id: string } }).comment;
  [o, a] = [await inbox(ownerCookie, shared.id), await inbox(adaCookie, shared.id)];
  check('a plain comment reaches the other subscriber (the assignee)', has(a, 'issueCommented') && !has(o, 'issueCommented'));
  const reply = (await (await req(`/api/issues/${shared.id}/comments`, { ...json({ body: 'Friday works', parentId: root.id }), cookie: adaCookie })).json() as { comment: { id: string } }).comment;
  [o, a] = [await inbox(ownerCookie, shared.id), await inbox(adaCookie, shared.id)];
  check('a reply reaches the thread\'s author as a reply, not the replier', has(o, 'issueReplied') && !has(o, 'issueCommented') && !has(a, 'issueReplied'));

  await patch(`/api/comments/${root.id}`, { reaction: '👍' }, adaCookie);
  [o, a] = [await inbox(ownerCookie, shared.id), await inbox(adaCookie, shared.id)];
  check('a reaction reaches the comment\'s author, not the reactor', has(o, 'commentReacted') && !has(a, 'commentReacted'));
  await patch(`/api/comments/${reply.id}`, { reaction: '🎉' }, ownerCookie);
  [o, a] = [await inbox(ownerCookie, shared.id), await inbox(adaCookie, shared.id)];
  check('…both ways', has(a, 'commentReacted') && o.filter(n => n.type === 'commentReacted').length === 1);

  await patch(`/api/issues/${shared.id}`, { stateId: store.stateOfType(team.team.id, 'started') }, ownerCookie);
  [o, a] = [await inbox(ownerCookie, shared.id), await inbox(adaCookie, shared.id)];
  check('a status change reaches subscribers other than whoever changed it', has(a, 'issueStatusChanged') && !has(o, 'issueStatusChanged'));

  const rows = (uid: string) => (db.prepare('SELECT id FROM notifications WHERE issue_id = ? AND user_id = ?').all(shared.id, uid) as Array<{ id: string }>).map(r => r.id).sort();
  const ids = (rs: Row[]) => rs.map(n => n.id).sort().join();
  check('each inbox is exactly that person\'s rows, and the two never overlap', ids(o) === rows(ownerId).join() && ids(a) === rows(ada.id).join() && !o.some(n => a.some(m => m.id === n.id)), `${o.length}/${a.length}`);

  const adaRow = a[0]!;
  await req(`/api/notifications/${adaRow.id}/read`, { ...json({ read: true }), cookie: ownerCookie });
  await req(`/api/notifications/${adaRow.id}/snooze`, { ...json({ until: new Date(Date.now() + 86400_000).toISOString() }), cookie: ownerCookie });
  const after = db.prepare('SELECT read_at, snoozed_until FROM notifications WHERE id = ?').get(adaRow.id) as { read_at: string | null; snoozed_until: string | null };
  check('nobody can read or snooze someone else\'s notification', !after.read_at && !after.snoozed_until);

  // team bells are per person too
  await req(`/api/teams/${team.team.id}/subscription`, { ...json({ issueAdded: true }), method: 'PUT', cookie: ownerCookie });
  const added = (await (await req('/api/issues', { ...json({ teamId: team.team.id, title: 'From Ada' }), cookie: adaCookie })).json() as { issue: { id: string } }).issue;
  const adaTeams = (await (await req('/api/bootstrap', { cookie: adaCookie })).json() as { teamSubscriptions: Record<string, unknown> }).teamSubscriptions;
  check('a team bell is yours alone, and hears about others\' new issues', has(await inbox(ownerCookie, added.id), 'teamActivity') && !adaTeams[team.team.id]);
}

// ---- live updates ----
{
  check('the event stream needs a session', (await req('/api/events')).status === 401);
  const res = await req('/api/events', { cookie: ownerCookie });
  check('it is a server-sent event stream', (res.headers.get('content-type') ?? '').startsWith('text/event-stream'));
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  /** the next `version` event's number, or null if none arrives within a second */
  const nextVersion = async (): Promise<number | null> => {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      const m = /event: version\ndata: (\{[^\n]*\})\n\n/.exec(buffered);
      if (m) { buffered = buffered.slice(m.index + m[0].length); return (JSON.parse(m[1]!) as { v: number }).v; }
      const chunk = await Promise.race([reader.read(), new Promise<null>(r => setTimeout(() => r(null), deadline - Date.now()))]);
      if (!chunk || chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
    }
    return null;
  };
  const first = await nextVersion();
  check('…which opens with the current version', first === changes.current, `${first} vs ${changes.current}`);
  await req('/api/issues', { ...json({ teamId: team.team.id, title: 'Live one' }), cookie: adaCookie });
  const second = await nextVersion();
  check('a write through the API announces a new version straight away', second !== null && second > first!);
  // the CLI and agents write to the file from another process: another connection stands in for them
  const other = new DatabaseSync(dbFile);
  other.prepare("UPDATE issues SET title = 'Changed from the CLI' WHERE title = 'Live one'").run();
  other.close();
  check('a write from another process is noticed', changes.check());
  const third = await nextVersion();
  check('…and announced', third !== null && third > second!);
  check('nothing changed, nothing announced', !changes.check() && (await nextVersion()) === null);
  await reader.cancel();
  await new Promise(r => setTimeout(r, 10));
  check('a closed stream stops listening', changes.subscribers === 0, String(changes.subscribers));
  const t0 = new Date();
  db.prepare("INSERT INTO notifications (id, type, body, created_at, user_id, snoozed_until) VALUES ('n_wake', 'issueReminder', 'x', ?, ?, ?)").run(t0.toISOString(), boot.currentUser.id, new Date(t0.getTime() + 30_000).toISOString());
  check('the clock sees a reminder coming due', store.wokeBetween(t0, new Date(t0.getTime() + 60_000)) && !store.wokeBetween(new Date(t0.getTime() + 60_000), new Date(t0.getTime() + 120_000)));
}

// ---- rate limits ----
{
  let last = '';
  for (let i = 0; i < 31; i++) last = (await req('/auth/google?next=/', { headers: { 'x-forwarded-for': '203.0.113.9' } })).headers.get('location') ?? '';
  check('the 31st sign-in attempt from one address in 10 minutes is turned back', last.endsWith('?auth_error=rate-limited'), last);
  const other = (await req('/auth/google?next=/', { headers: { 'x-forwarded-for': '203.0.113.10' } })).headers.get('location') ?? '';
  check('…without affecting other addresses', other.startsWith('https://accounts.google.com/'));
}

// ---- invites ----
type Result = { email: string; status: string; emailed?: string; invite?: { id: string; link: string; teamIds: string[] } };
{
  const r = await req('/api/invites', { ...json({ emails: 'ben@example.com, cara@example.com\nnot-an-email, ada@example.com, BEN@example.com', teamIds: [team.team.id, 'nope'] }), cookie: ownerCookie });
  const { results } = await r.json() as { results: Result[] };
  const by = (e: string) => results.find(x => x.email === e);
  check('inviting takes a pasted list, deduplicated case-insensitively', r.status === 201 && results.length === 4, JSON.stringify(results));
  check('…flags a bad address and an existing member', by('not-an-email')?.status === 'invalid' && by('ada@example.com')?.status === 'already-member');
  check('…emails each new invite', by('ben@example.com')?.emailed === 'sent' && sent.filter(m => m.to === 'ben@example.com').length === 1);
  check('…and keeps only real teams', JSON.stringify(by('ben@example.com')?.invite?.teamIds) === JSON.stringify([team.team.id]));
  const mail = sent.find(m => m.to === 'cara@example.com')!;
  const link = by('cara@example.com')!.invite!.link;
  check('the email carries the invite link and the inviter', mail.text.includes(link) && mail.subject.startsWith('Owner Person invited you'), mail.subject);
  const info = await (await req(`/auth/invite/${new URL(link).searchParams.get('invite')}`)).json() as { state: string; inviter: string; email: string };
  check('an invite link shows who sent it, with the address masked', info.state === 'valid' && info.inviter === 'Owner Person' && info.email === 'ca•••@example.com', JSON.stringify(info));
  const list = await (await req('/api/invites', { cookie: ownerCookie })).json() as { invites: Array<{ email: string }> };
  check('open invites are listed', list.invites.map(i => i.email).sort().join() === 'ben@example.com,cara@example.com');

  const caraCode = new URL(link).searchParams.get('invite')!;
  const wrong = await signIn({ sub: 'g-dan', email: 'dan@example.com', name: 'Dan' }, { invite: caraCode });
  check('opening someone else\'s invite with another account says so', wrong.location.endsWith('?auth_error=invite-mismatch') && !wrong.session, wrong.location);
  sent.length = 0;
  const cara = await signIn({ sub: 'g-cara', email: 'Cara@Example.com', name: 'Cara Diaz' }, { invite: caraCode });
  check('the invited account joins', !!cara.session, cara.location);
  const caraUser = store.snapshot().users.find(u => u.email === 'cara@example.com')!;
  check('…as a member of the invite\'s teams', !caraUser.admin && store.getTeam(team.team.id)!.memberIds.includes(caraUser.id));
  check('…and the inviter hears about it', await new Promise(r => setTimeout(r, 10)).then(() => sent.some(m => m.to === OWNER && m.subject.startsWith('Cara Diaz accepted'))));
  const after = await (await req('/api/invites', { cookie: ownerCookie })).json() as { invites: Array<{ email: string }> };
  check('…and the invite is no longer open', !after.invites.some(i => i.email === 'cara@example.com'));
  const reuse = await (await req(`/auth/invite/${caraCode}`)).json() as { state: string };
  check('an accepted invite link reports as accepted', reuse.state === 'accepted');

  const ben = by('ben@example.com')!.invite!;
  await req(`/api/invites/${ben.id}`, { method: 'DELETE', cookie: ownerCookie, headers: { origin: ORIGIN } });
  const revoked = await signIn({ sub: 'g-ben', email: 'ben@example.com', name: 'Ben' }, { invite: new URL(ben.link).searchParams.get('invite')! });
  check('a revoked invite can\'t be used', revoked.location.endsWith('?auth_error=invite-expired') && !revoked.session, revoked.location);

  const r2 = await req('/api/invites', { ...json({ emails: ['eve@example.com'] }), cookie: ownerCookie });
  const eve = (await r2.json() as { results: Result[] }).results[0]!.invite!;
  db.prepare("UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(eve.id);
  const late = await signIn({ sub: 'g-eve', email: 'eve@example.com', name: 'Eve' });
  check('an expired invite doesn\'t let anyone in', late.location.endsWith('?auth_error=not-invited') && !late.session);
  const resent = await (await req(`/api/invites/${eve.id}/resend`, { ...json({}), cookie: ownerCookie })).json() as { emailed: string; invite: { expired: boolean } };
  check('resending renews the invite and emails it again', resent.emailed === 'sent' && !resent.invite.expired);
  const eveIn = await signIn({ sub: 'g-eve', email: 'eve@example.com', name: 'Eve' });
  check('…after which it works', !!eveIn.session);
  const caraCookie = `__Host-baseline_session=${cara.session}`;
  check('a member can\'t invite while only admins may', (await req('/api/invites', { ...json({ emails: 'x@example.com' }), cookie: caraCookie })).status === 403);
  check('a member can\'t change who may join', (await patch('/api/security', { whoCanInvite: 'members' }, caraCookie)).status === 403);
  await patch('/api/security', { whoCanInvite: 'members' }, ownerCookie);
  check('once members may invite, they can', (await req('/api/invites', { ...json({ emails: 'x@example.com' }), cookie: caraCookie })).status === 201);
  check('…but never as admins', (await req('/api/invites', { ...json({ emails: 'y@example.com', admin: true }), cookie: caraCookie })).status === 403);
  const xInvite = (await (await req('/api/invites', { cookie: ownerCookie })).json() as { invites: Array<{ id: string; email: string }> }).invites.find(i => i.email === 'x@example.com')!;
  const ownerSent = await (await req('/api/invites', { ...json({ emails: 'z@example.com' }), cookie: ownerCookie })).json() as { results: Result[] };
  check('a member can revoke their own invite but not someone else\'s',
    (await req(`/api/invites/${xInvite.id}`, { method: 'DELETE', cookie: caraCookie, headers: { origin: ORIGIN } })).status === 200
    && (await req(`/api/invites/${ownerSent.results[0]!.invite!.id}`, { method: 'DELETE', cookie: caraCookie, headers: { origin: ORIGIN } })).status === 403);

  // ---- approved domains (Google Workspace hd claim) ----
  const sec = await (await patch('/api/security', { approvedDomains: ['@Acme.dev ', 'bad domain', 'acme.dev'], domainTeamIds: [team.team.id] }, ownerCookie)).json() as { security: { approvedDomains: string[] } };
  check('approved domains are cleaned up and deduplicated', JSON.stringify(sec.security.approvedDomains) === '["acme.dev"]', JSON.stringify(sec.security));
  const managed = await signIn({ sub: 'g-raj', email: 'raj@acme.dev', name: 'Raj', hd: 'acme.dev' });
  const raj = store.snapshot().users.find(u => u.email === 'raj@acme.dev');
  check('a Workspace account at an approved domain joins as a member of the default teams', !!managed.session && !!raj && !raj.admin && store.getTeam(team.team.id)!.memberIds.includes(raj.id));
  const personal = await signIn({ sub: 'g-sam', email: 'sam@acme.dev', name: 'Sam' });
  check('…but an account Google doesn\'t manage for that domain (no hd) doesn\'t', personal.location.endsWith('?auth_error=not-invited'));
  const other = await signIn({ sub: 'g-kim', email: 'kim@other.com', name: 'Kim', hd: 'other.com' });
  check('…nor does another Workspace domain', other.location.endsWith('?auth_error=not-invited'));

  // ---- roles, suspension, teams ----
  const ownerId = boot.currentUser.id;
  const demoteSelf = await patch(`/api/members/${ownerId}`, { admin: false }, ownerCookie);
  check('the last admin can\'t step down', demoteSelf.status === 400);
  check('a member can\'t change roles', (await patch(`/api/members/${caraUser.id}`, { admin: true }, caraCookie)).status === 403);
  check('an admin can make someone admin', (await patch(`/api/members/${caraUser.id}`, { admin: true }, ownerCookie)).status === 200 && store.snapshot().users.find(u => u.id === caraUser.id)!.admin);
  check('…and with another admin around, can step down', (await patch(`/api/members/${ownerId}`, { admin: false }, ownerCookie)).status === 200);
  await patch(`/api/members/${ownerId}`, { admin: true }, caraCookie);
  check('nobody can suspend themselves', (await patch(`/api/members/${ownerId}`, { suspended: true }, ownerCookie)).status === 400);
  const rajCookie = `__Host-baseline_session=${managed.session}`;
  await patch(`/api/members/${raj!.id}`, { suspended: true }, ownerCookie);
  check('suspending someone signs them out', (await req('/api/bootstrap', { cookie: rajCookie })).status === 401);
  await patch(`/api/members/${raj!.id}`, { suspended: false }, ownerCookie);
  check('…and reactivating lets them back in', !!(await signIn({ sub: 'g-raj', email: 'raj@acme.dev', name: 'Raj', hd: 'acme.dev' })).session);
  const t2 = await (await req('/api/teams', { ...json({ key: 'OPS', name: 'Ops' }), cookie: caraCookie })).json() as { team: { id: string; memberIds: string[] } };
  check('whoever creates a team is on it', JSON.stringify(t2.team.memberIds) === JSON.stringify([caraUser.id]));
  await req(`/api/teams/${t2.team.id}/join`, { ...json({}), cookie: ownerCookie });
  check('anyone can join a team', store.getTeam(t2.team.id)!.memberIds.includes(ownerId));
  await req(`/api/teams/${t2.team.id}/leave`, { ...json({}), cookie: ownerCookie });
  check('…and leave it', !store.getTeam(t2.team.id)!.memberIds.includes(ownerId));
  await patch(`/api/members/${raj!.id}`, { teamIds: [t2.team.id] }, ownerCookie);
  check('an admin can set someone\'s teams', !store.getTeam(team.team.id)!.memberIds.includes(raj!.id) && store.getTeam(t2.team.id)!.memberIds.includes(raj!.id));
  await patch(`/api/users/${caraUser.id}`, { name: 'Cara <script>alert(1)</script>' }, caraCookie);
  sent.length = 0;
  await req('/api/invites', { ...json({ emails: 'q@example.com' }), cookie: caraCookie });
  const html = sent[0]?.html ?? '';
  check('names in email HTML are escaped', html.includes('Cara &lt;script&gt;') && !/<script/i.test(html), html.slice(0, 200));
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
