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
  mode: 'hosted', publicUrl: new URL(ORIGIN), google: { clientId: CLIENT_ID, clientSecret: 'secret' }, ownerEmail: OWNER,
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
check('workspace reports hosted auth and hides the server home dir', boot.workspace.auth === 'hosted' && !boot.workspace.homeDir);
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
{
  const commentsBefore = (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE issue_id = ?').get(issue.id) as { n: number }).n;
  const asOwner = await req(`/api/issues/${issue.id}/comments`, { ...json({ body: 'hi', userId: boot.currentUser.id }), cookie: adaCookie });
  const commentsAfter = (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE issue_id = ?').get(issue.id) as { n: number }).n;
  check('a comment as someone else is refused, not rewritten', asOwner.status === 403 && commentsAfter === commentsBefore, String(asOwner.status));
  const asSelf = await (await req(`/api/issues/${issue.id}/comments`, { ...json({ body: 'hi', userId: ada.id }), cookie: adaCookie })).json() as { comment: { userId: string } };
  check('…while naming yourself works', asSelf.comment?.userId === ada.id);
  const sub = await req(`/api/issues/${issue.id}/subscribe`, { ...json({ subscribed: true, userId: boot.currentUser.id }), cookie: adaCookie });
  check('subscribing someone else is refused', sub.status === 403 && !store.isSubscribed(issue.id, boot.currentUser.id));
  await req(`/api/issues/${issue.id}/subscribe`, { ...json({ subscribed: true }), cookie: adaCookie });
  check('subscribing subscribes yourself', store.isSubscribed(issue.id, ada.id));
  const patchAs = await req(`/api/issues/${issue.id}`, { ...json({ title: 'Renamed as owner', actorId: boot.currentUser.id }), method: 'PATCH', cookie: adaCookie });
  check('an issue update as someone else is refused (actorId is not ignored)', patchAs.status === 403 && store.getIssue(issue.id)?.title === 'Hello');
}
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

// ---- team and workspace configuration is admins' (TEAM_PLAN.md › Who changes what) ----
{
  const send = (cookie: string, method: string, path: string, body?: unknown) =>
    req(path, { method, cookie, headers: { 'content-type': 'application/json', origin: ORIGIN }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const idOf = async (r: Response, key: string) => ((await r.json()) as Record<string, { id: string }>)[key]!.id;
  // what members still do: start a team, and add a label from an issue's (or project's, or initiative's) picker
  const own = await send(adaCookie, 'POST', '/api/teams', { key: 'ADA', name: 'Ada\'s team' });
  check('a member can create a team', own.status === 201);
  const ownId = await idOf(own, 'team');
  const labelRes = await send(adaCookie, 'POST', '/api/labels', { teamId: team.team.id, name: 'bug', color: '#eb5757' });
  const projectLabelRes = await send(adaCookie, 'POST', '/api/project-labels', { name: 'Q3' });
  const initiativeLabelRes = await send(adaCookie, 'POST', '/api/initiative-labels', { name: 'Bet' });
  check('…and add issue, project and initiative labels', labelRes.status === 201 && projectLabelRes.status === 201 && initiativeLabelRes.status === 201,
    `${labelRes.status}/${projectLabelRes.status}/${initiativeLabelRes.status}`);
  const ids: Record<string, string> = {
    team: team.team.id, doomed: store.createTeam('TMP', 'Temporary').id, label: await idOf(labelRes, 'label'),
    projectLabel: await idOf(projectLabelRes, 'label'), initiativeLabel: await idOf(initiativeLabelRes, 'label'),
    emoji: store.addEmoji('shipit', '/files/shipit.png').id,
  };

  // each route a member is refused and an admin isn't; `save` keeps the id an admin's create returns
  const routes: Array<{ name: string; method: string; path: () => string; body?: unknown; save?: [string, string]; adminStatus?: number }> = [
    { name: 'rename a team', method: 'PATCH', path: () => `/api/teams/${ids.team}`, body: { name: 'Engineering' } },
    { name: 'change a team\'s workflow automations', method: 'PUT', path: () => `/api/teams/${ids.team}/workflow`, body: { autoCloseDays: 30 } },
    { name: 'add a workflow state', method: 'POST', path: () => '/api/states', body: { teamId: ids.team, name: 'QA', type: 'started', color: '#f2c94c' }, save: ['state', 'state'] },
    { name: 'edit a workflow state', method: 'PATCH', path: () => `/api/states/${ids.state}`, body: { name: 'Testing' } },
    { name: 'remove a workflow state', method: 'DELETE', path: () => `/api/states/${ids.state}` },
    { name: 'edit a label', method: 'PATCH', path: () => `/api/labels/${ids.label}`, body: { name: 'Bug' } },
    { name: 'remove a label', method: 'DELETE', path: () => `/api/labels/${ids.label}` },
    { name: 'edit a project label', method: 'PATCH', path: () => `/api/project-labels/${ids.projectLabel}`, body: { name: 'Q4' } },
    { name: 'remove a project label', method: 'DELETE', path: () => `/api/project-labels/${ids.projectLabel}` },
    { name: 'edit an initiative label', method: 'PATCH', path: () => `/api/initiative-labels/${ids.initiativeLabel}`, body: { name: 'Big bet' } },
    { name: 'remove an initiative label', method: 'DELETE', path: () => `/api/initiative-labels/${ids.initiativeLabel}` },
    { name: 'add a project status', method: 'POST', path: () => '/api/project-statuses', body: { name: 'On ice', type: 'paused' }, save: ['status', 'projectStatus'] },
    { name: 'edit a project status', method: 'PATCH', path: () => `/api/project-statuses/${ids.projectStatus}`, body: { name: 'Frozen' } },
    { name: 'remove a project status', method: 'DELETE', path: () => `/api/project-statuses/${ids.projectStatus}` },
    { name: 'add an issue template', method: 'POST', path: () => '/api/issue-templates', body: { teamId: ids.team, name: 'Bug report' }, save: ['template', 'issueTemplate'] },
    { name: 'edit an issue template', method: 'PATCH', path: () => `/api/issue-templates/${ids.issueTemplate}`, body: { name: 'Bug' } },
    { name: 'remove an issue template', method: 'DELETE', path: () => `/api/issue-templates/${ids.issueTemplate}` },
    { name: 'add a project template', method: 'POST', path: () => '/api/project-templates', body: { name: 'Launch' }, save: ['template', 'projectTemplate'] },
    { name: 'edit a project template', method: 'PATCH', path: () => `/api/project-templates/${ids.projectTemplate}`, body: { name: 'Big launch' } },
    { name: 'remove a project template', method: 'DELETE', path: () => `/api/project-templates/${ids.projectTemplate}` },
    { name: 'add a document template', method: 'POST', path: () => '/api/doc-templates', body: { name: 'RFC' }, save: ['template', 'docTemplate'] },
    { name: 'edit a document template', method: 'PATCH', path: () => `/api/doc-templates/${ids.docTemplate}`, body: { name: 'Design doc' } },
    { name: 'remove a document template', method: 'DELETE', path: () => `/api/doc-templates/${ids.docTemplate}` },
    { name: 'add an SLA', method: 'POST', path: () => '/api/sla-rules', body: { name: 'Urgent', priorities: [1], hours: 24 }, save: ['rule', 'sla'] },
    { name: 'edit an SLA', method: 'PATCH', path: () => `/api/sla-rules/${ids.sla}`, body: { hours: 12 } },
    { name: 'remove an SLA', method: 'DELETE', path: () => `/api/sla-rules/${ids.sla}` },
    { name: 'add an Ask form', method: 'POST', path: () => '/api/asks', body: { name: 'IT request', teamId: ids.team }, save: ['form', 'ask'] },
    { name: 'edit an Ask form', method: 'PATCH', path: () => `/api/asks/${ids.ask}`, body: { name: 'IT help' } },
    { name: 'remove an Ask form', method: 'DELETE', path: () => `/api/asks/${ids.ask}` },
    { name: 'add a loop', method: 'POST', path: () => '/api/loops', body: { name: 'Triage bot', trigger: { kind: 'labelAdded', labelId: 'none' } }, save: ['loop', 'loop'] },
    { name: 'edit a loop', method: 'PATCH', path: () => `/api/loops/${ids.loop}`, body: { name: 'Triage helper' } },
    { name: 'run a loop', method: 'POST', path: () => `/api/loops/${ids.loop}/run`, body: { issueId: issue.id } },
    { name: 'remove a loop', method: 'DELETE', path: () => `/api/loops/${ids.loop}` },
    { name: 'change PR automations', method: 'PUT', path: () => `/api/git/automation/${ids.team}`, body: { linkOnBranch: false } },
    { name: 'set the GitHub webhook URL', method: 'PUT', path: () => '/api/github/webhook/config', body: { publicUrl: ORIGIN } },
    { name: 'make a GitHub webhook secret', method: 'POST', path: () => '/api/github/webhook/secret' },
    { name: 'turn GitHub webhooks off', method: 'DELETE', path: () => '/api/github/webhook/secret' },
    // the admin gets past the gate to the repo-name check (a real import would run gh)
    { name: 'import GitHub issues', method: 'POST', path: () => '/api/github/issues/import', body: { repo: 'not a repo', teamId: ids.team }, adminStatus: 400 },
    { name: 'follow a GitHub repo\'s issues', method: 'PUT', path: () => '/api/github/issues/follow', body: { repo: 'acme/app', teamId: ids.team } },
    { name: 'remove a custom emoji', method: 'DELETE', path: () => `/api/emojis/${ids.emoji}` },
    { name: 'add a customer status', method: 'POST', path: () => '/api/customer-attrs/status', body: { name: 'Churned' }, save: ['id', 'customerStatus'] },
    { name: 'edit a customer status', method: 'PATCH', path: () => `/api/customer-attrs/status/${ids.customerStatus}`, body: { name: 'Lost' } },
    { name: 'remove a customer status', method: 'DELETE', path: () => `/api/customer-attrs/status/${ids.customerStatus}` },
    { name: 'delete a team', method: 'DELETE', path: () => `/api/teams/${ids.doomed}` },
  ];
  for (const r of routes) {
    const member = await send(adaCookie, r.method, r.path(), r.body);
    const admin = await send(ownerCookie, r.method, r.path(), r.body);
    const want = r.adminStatus ?? (r.method === 'POST' && r.save ? 201 : null);
    const adminOk = want ? admin.status === want : admin.status === 200 || admin.status === 201;
    if (r.save && admin.ok) { const b = await admin.json() as Record<string, unknown>; const v = b[r.save[0]]; ids[r.save[1]] = typeof v === 'string' ? v : (v as { id: string }).id; }
    check(`a member can't ${r.name}; an admin can`, member.status === 403 && adminOk, `member ${member.status}, admin ${admin.status}`);
  }
  // (on their own team, so Eng's bells stay as the inbox tests expect)
  check('a member can still subscribe to a team and add its resources',
    (await send(adaCookie, 'PUT', `/api/teams/${ownId}/subscription`, { issueAdded: true })).status === 200
    && (await send(adaCookie, 'POST', `/api/teams/${ownId}/links`, { url: 'https://example.com/runbook' })).status === 201);
}

// ---- coding agents: nothing runs on, or reaches into, the server's machine ----
{
  // a location left over from a laptop workspace moved onto the server
  const loc = store.createLocation(work, 'Old checkout');
  const at = (cookie: string, method: string, body?: unknown) => req(`/api/locations/${loc.id}`, { method, cookie, headers: { 'content-type': 'application/json', origin: ORIGIN }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const rename = await at(adaCookie, 'PATCH', { name: 'Mine now' });
  const remove = await at(adaCookie, 'DELETE');
  check('a member can\'t rename or remove a location', rename.status === 403 && remove.status === 403 && store.getLocation(loc.id)?.name === 'Old checkout', `${rename.status}/${remove.status}`);
  const renamed = await at(ownerCookie, 'PATCH', { name: 'Archive' });
  check('…an admin can rename one', renamed.status === 200 && store.getLocation(loc.id)?.name === 'Archive');
  check('…and remove it', (await at(ownerCookie, 'DELETE')).status === 200 && !store.getLocation(loc.id));

  check('loops get no launcher on a hosted server', store.ext.automation.launcher === null);
  const loop = (await (await req('/api/loops', { ...json({ name: 'Hand off', trigger: { kind: 'labelAdded', labelId: 'none' }, actions: [{ kind: 'claudeCode' }] }), cookie: ownerCookie })).json() as { loop: { id: string } }).loop;
  const run = (await (await req(`/api/loops/${loop.id}/run`, { ...json({ issueId: issue.id }), cookie: ownerCookie })).json() as { run: { ok: boolean; detail: string } }).run;
  check('a loop\'s Open in Claude Code is skipped, saying it needs the companion', !run.ok && /needs a connected companion, skipped/.test(run.detail), run.detail);

  const sync = await (await req('/api/git/sync', { ...json({}), cookie: ownerCookie })).json() as { prs: number; error?: string };
  check('git sync doesn\'t run gh on a hosted server', sync.prs === 0 && /webhooks/.test(sync.error ?? ''), JSON.stringify(sync));
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

// ---- API keys on a hosted server (the CLI's way in) ----
{
  const { apiKeys } = store.ext;
  const ownerId = boot.currentUser.id;
  const keyReq = (path: string, token: string, init: RequestInit = {}) =>
    req(path, { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  const full = apiKeys.create({ name: 'cli', userId: ownerId, scopes: ['read', 'write'] });
  check('a hosted server accepts a valid key', (await keyReq('/api/bootstrap?sections=teams', full.token)).status === 200);
  check('a bad key is 401', (await keyReq('/api/bootstrap', 'bl_api_nope')).status === 401);
  const rebound = await app.fetch(new Request('https://rebound.example.net/api/bootstrap', { headers: { authorization: `Bearer ${full.token}` } }));
  check('a key still has to address the public host', rebound.status === 403);
  const t = (await keyReq('/api/issues', full.token, { method: 'POST', body: JSON.stringify({ teamId: team.team.id, title: 'From the CLI' }) }));
  const made = (await t.json() as { issue: { id: string; creatorId: string } }).issue;
  check('a key writes without Origin or cookie, as its owner', t.status === 201 && made.creatorId === ownerId);
  const me = await (await keyReq('/api/me', full.token)).json() as { user: { id: string }; via: string; scopes: string[]; keyId: string };
  check('/api/me names the key\'s owner and limits', me.user.id === ownerId && me.via === 'key' && me.scopes.join() === 'read,write' && me.keyId === full.key.id);
  check('a key can\'t mint keys', (await keyReq('/api/api-keys', full.token, { method: 'POST', body: JSON.stringify({ name: 'x' }) })).status === 403);
  check('…or approve a CLI sign-in', (await keyReq('/api/cli-auth/approve', full.token, { method: 'POST', body: JSON.stringify({}) })).status === 403);
  check('a read+write key can\'t change workspace settings', (await keyReq('/api/workspace', full.token, { method: 'PATCH', body: JSON.stringify({ name: 'x' }) })).status === 403);
  const patchAs = await keyReq(`/api/issues/${made.id}`, full.token, { method: 'PATCH', body: JSON.stringify({ title: 'as Ada', actorId: ada.id }) });
  check('a key can\'t write as another user', patchAs.status === 403 && store.getIssue(made.id)?.title === 'From the CLI');
  const byKey = await (await keyReq(`/api/issues/by-key/${store.keyOf(made)}`, full.token)).json() as { issue: { id: string } };
  check('an issue can be read by its key', byKey.issue?.id === made.id);
  const sections = await (await keyReq('/api/bootstrap?sections=teams,currentUser', full.token)).json() as Record<string, unknown>;
  check('bootstrap returns only the sections asked for', Object.keys(sections).sort().join() === 'currentUser,teams');
  check('an unknown section is 400', (await keyReq('/api/bootstrap?sections=nope', full.token)).status === 400);

  // a key limited to one team
  const other = store.createTeam('OTH', 'Other');
  const foreign = store.createIssue({ teamId: other.id, title: 'Not yours' }, ownerId);
  store.addComment(foreign.id, ownerId, 'secret comment');
  const limited = apiKeys.create({ name: 'eng only', userId: ownerId, scopes: ['read', 'write'], teamIds: [team.team.id] });
  check('a team-limited key can\'t update another team\'s issue', (await keyReq(`/api/issues/${foreign.id}`, limited.token, { method: 'PATCH', body: JSON.stringify({ title: 'x' }) })).status === 403);
  check('…or comment on it', (await keyReq(`/api/issues/${foreign.id}/comments`, limited.token, { method: 'POST', body: JSON.stringify({ body: 'x' }) })).status === 403);
  check('…or read it by key', (await keyReq(`/api/issues/by-key/${store.keyOf(foreign)}`, limited.token)).status === 404);
  const list = await (await keyReq('/api/issues', limited.token)).json() as { issues: Array<{ id: string }> };
  check('…and its issue list leaves it out', list.issues.length > 0 && !list.issues.some(i => i.id === foreign.id));
  const partial = await (await keyReq('/api/bootstrap?sections=comments,teams', limited.token)).json() as { comments: Array<{ body: string }>; teams: Array<{ id: string }> };
  check('…and a sectioned bootstrap still drops its comments and team', !partial.comments.some(c => c.body === 'secret comment') && !partial.teams.some(x => x.id === other.id));

  const gone = await keyReq('/api/me/key', full.token, { method: 'DELETE' });
  check('a key can revoke itself', gone.status === 200 && !apiKeys.get(full.key.id));
  check('…and then stops working', (await keyReq('/api/me', full.token)).status === 401);
  check('DELETE /api/me/key with a cookie is refused', (await req('/api/me/key', { method: 'DELETE', headers: { origin: ORIGIN }, cookie: ownerCookie })).status === 400);
}

// ---- agents: a key or a session may write as an agent user, recorded as "<agent> via <person>" ----
{
  const ownerId = boot.currentUser.id;
  const agent = store.createUser('Claude Code', '', false, 'agent');
  const key = store.ext.apiKeys.create({ name: 'agent cli', userId: ownerId, scopes: ['read', 'write'] });
  const keyReq = (path: string, init: RequestInit = {}) =>
    req(path, { ...init, headers: { authorization: `Bearer ${key.token}`, 'content-type': 'application/json' } });
  const row = (sql: string, ...args: string[]) => db.prepare(sql).get(...args) as { user_id: string; via_user_id: string | null } | undefined;

  const made = await keyReq('/api/issues', { method: 'POST', body: JSON.stringify({ teamId: team.team.id, title: 'Filed by an agent', actorId: agent.id }) });
  const issue = (await made.json() as { issue: { id: string; creatorId: string } }).issue;
  const created = row("SELECT user_id, via_user_id FROM activity WHERE issue_id = ? AND type = 'created'", issue.id);
  check('a key acting as an agent creates as the agent, via the key\'s owner', made.status === 201 && issue.creatorId === agent.id && created?.user_id === agent.id && created.via_user_id === ownerId, JSON.stringify(created));

  const todo = store.snapshot().states.find(s => s.teamId === team.team.id && s.type === 'started')!;
  await keyReq(`/api/issues/${issue.id}`, { method: 'PATCH', body: JSON.stringify({ stateId: todo.id, actorId: agent.id }) });
  const moved = row("SELECT user_id, via_user_id FROM activity WHERE issue_id = ? AND type = 'stateChanged'", issue.id);
  check('…an update records the agent and the via', moved?.user_id === agent.id && moved.via_user_id === ownerId, JSON.stringify(moved));

  const posted = await keyReq(`/api/issues/${issue.id}/comments`, { method: 'POST', body: JSON.stringify({ body: 'on it', userId: agent.id }) });
  const comment = (await posted.json() as { comment: { id: string; userId: string; viaUserId: string | null } }).comment;
  const stored = row('SELECT user_id, via_user_id FROM comments WHERE id = ?', comment.id);
  check('…and so does a comment, in the response and the database', comment.userId === agent.id && comment.viaUserId === ownerId && stored?.via_user_id === ownerId);

  const asAda = await keyReq(`/api/issues/${issue.id}/comments`, { method: 'POST', body: JSON.stringify({ body: 'as Ada', userId: ada.id }) });
  check('a key acting as another person is still refused', asAda.status === 403 && !row('SELECT user_id, via_user_id FROM comments WHERE body = ?', 'as Ada'));

  const mine = await (await keyReq(`/api/issues/${issue.id}/comments`, { method: 'POST', body: JSON.stringify({ body: 'by the owner' }) })).json() as { comment: { viaUserId: string | null } };
  check('a key\'s own write has no via', mine.comment.viaUserId === null);

  const sections = await (await keyReq('/api/bootstrap?sections=comments,activity')).json() as { comments: Array<{ id: string; viaUserId: string | null }>; activity: Array<{ issueId: string; type: string; viaUserId: string | null }> };
  check('bootstrap exposes viaUserId on comments and activity',
    sections.comments.find(c => c.id === comment.id)?.viaUserId === ownerId && sections.activity.find(a => a.issueId === issue.id && a.type === 'created')?.viaUserId === ownerId);

  const project = store.createProject({ name: 'Agent project', teamId: team.team.id });
  const update = await (await keyReq(`/api/projects/${project.id}/updates`, { method: 'POST', body: JSON.stringify({ body: 'Shipped', health: 'onTrack', userId: agent.id }) })).json() as { update: { id: string; viaUserId: string | null } };
  const health = row("SELECT user_id, via_user_id FROM activity WHERE project_id = ? AND type = 'projectHealth'", project.id);
  check('a project update as an agent records the via, on the update and its health change',
    update.update.viaUserId === ownerId && row('SELECT user_id, via_user_id FROM project_updates WHERE id = ?', update.update.id)?.via_user_id === ownerId && health?.user_id === agent.id && health.via_user_id === ownerId);

  const bySession = await (await req(`/api/issues/${issue.id}/comments`, { ...json({ body: 'from Ada\'s browser agent', userId: agent.id }), cookie: adaCookie })).json() as { comment: { userId: string; viaUserId: string | null } };
  check('a session acting as an agent is recorded via that person', bySession.comment.userId === agent.id && bySession.comment.viaUserId === ada.id);
  const sessionAsOwner = await req(`/api/issues/${issue.id}`, { ...json({ title: 'x', actorId: ownerId }), method: 'PATCH', cookie: adaCookie });
  check('…and a session acting as another person is refused', sessionAsOwner.status === 403);

  // a drafted project update is its person's alone: only they see it, only they publish it
  type Drafts = { updateDrafts?: Array<{ projectId: string; personId: string; authorId: string; body: string }> };
  const drafted = await keyReq(`/api/projects/${project.id}/update-draft`, { method: 'PUT', body: JSON.stringify({ body: 'Owner\'s draft', health: 'atRisk', actorId: agent.id }) });
  const ownerDrafts = (await (await req('/api/bootstrap', { cookie: ownerCookie })).json() as Drafts).updateDrafts ?? [];
  check('bootstrap shows a person the draft an agent wrote for them',
    drafted.status === 200 && ownerDrafts.length === 1 && ownerDrafts[0]!.projectId === project.id && ownerDrafts[0]!.authorId === agent.id, JSON.stringify(ownerDrafts));
  const adaDrafts = (await (await req('/api/bootstrap', { cookie: adaCookie })).json() as Drafts).updateDrafts;
  const adaSection = (await (await req('/api/bootstrap?sections=updateDrafts', { cookie: adaCookie })).json() as Drafts).updateDrafts;
  const adaOne = await (await req(`/api/projects/${project.id}/update-draft`, { cookie: adaCookie })).json() as { draft: unknown };
  check('…and another person sees none of it, in bootstrap, its section or the project\'s draft route',
    Array.isArray(adaDrafts) && adaDrafts.length === 0 && Array.isArray(adaSection) && adaSection.length === 0 && adaOne.draft === null, JSON.stringify({ adaDrafts, adaSection, adaOne }));
  const adaPublish = await req(`/api/projects/${project.id}/update-draft/publish`, { ...json({ body: 'hijacked' }), cookie: adaCookie });
  const adaDiscard = await req(`/api/projects/${project.id}/update-draft`, { method: 'DELETE', headers: { origin: ORIGIN }, cookie: adaCookie });
  check('…can\'t publish or discard it', adaPublish.status === 404 && (await adaDiscard.json() as { ok: boolean }).ok === false && !!store.ext.work.draft(project.id, ownerId));
  const published = await req(`/api/projects/${project.id}/update-draft/publish`, { ...json({ body: 'Owner\'s edited draft', health: 'onTrack' }), cookie: ownerCookie });
  const pub = (await published.json() as { published: { updateId: string } }).published;
  const pubRow = db.prepare('SELECT user_id, via_user_id, body, health FROM project_updates WHERE id = ?').get(pub.updateId) as { user_id: string; via_user_id: string | null; body: string; health: string };
  check('the person publishes it, with their edits, as their own update; the draft is gone',
    published.status === 201 && pubRow.user_id === ownerId && pubRow.via_user_id === null && pubRow.body === 'Owner\'s edited draft' && pubRow.health === 'onTrack' && !store.ext.work.draft(project.id, ownerId), JSON.stringify(pubRow));
  store.ext.apiKeys.revoke(key.key.id);
}
{
  // local mode: any actor is honored; an agent acts for this machine's current user
  const local = createApp(join(work, 'local.db'), { mode: 'local' }, { configured: false, send: async () => {} });
  const me = local.store.workspaceMeta().currentUser;
  const agent = local.store.createUser('Codex', '', false, 'agent');
  const issueId = local.store.snapshot().issues[0]!.id;
  const res = await local.app.fetch(new Request(`http://127.0.0.1/api/issues/${issueId}/comments`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'local agent', userId: agent.id }),
  }));
  const c = (await res.json() as { comment: { id: string; userId: string; viaUserId: string | null } }).comment;
  const act = local.db.prepare("SELECT via_user_id FROM activity WHERE type = 'commented' AND data LIKE ?").get(`%${c.id}%`) as { via_user_id: string | null };
  check('local mode: an agent writes via the current user', c.userId === agent.id && c.viaUserId === me && act.via_user_id === me && !!me);
  const other = local.store.snapshot().users.find(u => u.kind === 'human' && u.id !== me)!;
  const asOther = await (await local.app.fetch(new Request(`http://127.0.0.1/api/issues/${issueId}/comments`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'local person', userId: other.id }),
  }))).json() as { comment: { userId: string; viaUserId: string | null } };
  check('…and another person is still honored, with no via', asOther.comment.userId === other.id && asOther.comment.viaUserId === null);
}

// ---- `baseline login`: browser approval, loopback redirect, PKCE ----
{
  const { createHash, randomBytes } = await import('node:crypto');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const ask = { port: 54321, state: randomBytes(18).toString('base64url'), challenge, device: 'test-laptop' };
  const page = await req(`/cli/authorize?${new URLSearchParams({ ...ask, port: String(ask.port) })}`);
  check('the CLI sign-in page is served', page.status === 200 && (await page.text()).includes('Sign in the Baseline CLI'));
  check('…and refuses an incomplete link', (await req('/cli/authorize?port=1')).status === 400);
  check('approving needs a session', (await req('/api/cli-auth/approve', json(ask))).status === 401);
  check('…from this site', (await req('/api/cli-auth/approve', { ...json(ask), headers: { 'content-type': 'application/json' }, cookie: ownerCookie })).status === 403);
  const approved = await (await req('/api/cli-auth/approve', { ...json(ask), cookie: ownerCookie })).json() as { redirect: string };
  const back = new URL(approved.redirect);
  check('approval redirects to the CLI on loopback with the state', back.origin === 'http://127.0.0.1:54321' && back.pathname === '/cb' && back.searchParams.get('state') === ask.state && !!back.searchParams.get('code'));
  const code = back.searchParams.get('code')!;
  const trade = (body: unknown) => req('/auth/cli/token', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  check('a wrong verifier gets no key', (await trade({ code, verifier: randomBytes(32).toString('base64url') })).status === 400);
  const got = await (await trade({ code, verifier })).json() as { token: string; keyId: string; user: { id: string } };
  const key = store.ext.apiKeys.get(got.keyId);
  check('code + verifier trade for a key as the approver', got.token?.startsWith('bl_api_') && got.user.id === boot.currentUser.id && key?.userId === boot.currentUser.id);
  check('…named for the device, read and write only', key?.name === 'CLI on test-laptop' && key.scopes?.join() === 'read,write');
  check('a code works once', (await trade({ code, verifier })).status === 400);
  check('the key works on the API', (await req('/api/me', { headers: { authorization: `Bearer ${got.token}` } })).status === 200);
  store.ext.apiKeys.revoke(got.keyId);
}

// ---- sessions ----
{
  const out = await req('/api/auth/logout', { ...json({}), cookie: adaCookie });
  check('logout succeeds', out.status === 200);
  check('…and the session no longer works', (await req('/api/bootstrap', { cookie: adaCookie })).status === 401);
  const relog = await signIn({ sub: 'g-ada', email: 'ada@example.com', name: 'Ada' });
  const adaKey = store.ext.apiKeys.create({ name: 'ada cli', userId: ada.id });
  db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(ada.id);
  check('a suspended person\'s session stops working', (await req('/api/bootstrap', { cookie: `__Host-baseline_session=${relog.session}` })).status === 401);
  check('…and so do their API keys', (await req('/api/bootstrap', { headers: { authorization: `Bearer ${adaKey.token}` } })).status === 401);
  const again = await signIn({ sub: 'g-ada', email: 'ada@example.com', name: 'Ada' });
  check('…and they can\'t sign in again', again.location.endsWith('?auth_error=suspended') && !again.session);
  db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  check('an expired session is rejected', (await req('/api/bootstrap', { cookie: ownerCookie })).status === 401);
  const stored = db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>;
  check('the database stores token hashes, not tokens', stored.every(s => s.id !== owner.session));
}

// ---- forgot password, on the Google + SMTP server above ----
{
  const cfg = await (await req('/auth/config')).json() as { methods: string[]; setup: boolean; mail: boolean };
  check('a server with a Google client offers password and Google, and is set up once the owner signed in', cfg.methods.join() === 'password,google' && !cfg.setup && cfg.mail, JSON.stringify(cfg));
  const before = sent.length;
  const forgot = (email: string) => req('/auth/forgot', json({ email }));
  const known = await forgot(OWNER), unknown = await forgot('nobody@example.com');
  await new Promise(r => setTimeout(r, 20));
  const mail = sent.slice(before);
  check('"forgot password" answers the same for a member and a stranger', known.status === 200 && unknown.status === 200);
  check('…and emails a reset link only to the member', mail.length === 1 && mail[0]!.to === OWNER && /\?reset=/.test(mail[0]!.text), JSON.stringify(mail.map(m => m.to)));
}

// ---- password sign-in on a server with only BASELINE_PUBLIC_URL (no Google, no SMTP) ----
{
  const { authConfigFromEnv } = await import('../src/server/auth.js');
  const { readSetupToken } = await import('../src/server/setup.js');
  const envCfg = authConfigFromEnv({ BASELINE_PUBLIC_URL: 'https://pw.example.com' });
  check('BASELINE_PUBLIC_URL alone makes a hosted server with password sign-in only', envCfg.mode === 'hosted' && envCfg.google === null);
  check('no BASELINE_PUBLIC_URL stays local', authConfigFromEnv({}).mode === 'local');
  let threw = false; try { authConfigFromEnv({ BASELINE_PUBLIC_URL: 'https://pw.example.com', GOOGLE_CLIENT_ID: 'x' }); } catch { threw = true; }
  check('a Google client id without its secret refuses to start', threw);

  const PW = 'https://pw.example.com';
  const pwDb = join(work, 'password.db');
  const pw = createApp(pwDb, envCfg, { configured: false, send: async () => { throw new Error('no smtp'); } });
  let ip = 0;
  const preq = (path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set('cookie', init.cookie);
    headers.set('x-forwarded-for', init.ip ?? `198.51.100.${++ip % 250}`);
    return pw.app.fetch(new Request(new URL(path, PW), { ...init, headers }));
  };
  const post = (path: string, body: unknown, extra: { cookie?: string; ip?: string; origin?: string | null } = {}) => preq(path, {
    method: 'POST', body: JSON.stringify(body), cookie: extra.cookie, ip: extra.ip,
    headers: { 'content-type': 'application/json', ...(extra.origin === null ? {} : { origin: extra.origin ?? PW }) },
  });
  const sessionOf = (res: Response) => cookiesFrom(res)['__Host-baseline_session'];
  const errOf = async (res: Response) => (await res.json() as { error?: string; code?: string });

  const cfg = await (await preq('/auth/config')).json() as { methods: string[]; setup: boolean; mail: boolean };
  check('a fresh password server asks for setup, offers only passwords, has no email', cfg.methods.join() === 'password' && cfg.setup && !cfg.mail, JSON.stringify(cfg));
  const g = await preq('/auth/google?next=/');
  check('a server without Google refuses /auth/google', g.status === 404 && (await errOf(g)).code === 'google-off');
  check('…and its callback', (await preq('/auth/google/callback?code=x&state=y')).status === 404);
  check('the API is closed before setup', (await preq('/api/bootstrap')).status === 401);

  const token = pw.setup.ensure();
  check('the setup token is kept beside the database for `baseline setup-token`', readSetupToken(pwDb) === token && /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(token), token);
  check('…and is the same after a restart', pw.setup.ensure() === token);
  const owner = { name: 'Olu Owner', email: 'Olu@Example.com', password: 'correct horse battery', workspaceName: 'Acme' };
  check('setup without the token is refused', (await post('/auth/setup', owner)).status === 403);
  check('setup with a wrong token is refused', (await post('/auth/setup', { ...owner, token: 'AAAAA-BBBBB-CCCCC-DDDDD' })).status === 403);
  check('setup from another site is refused', (await post('/auth/setup', { ...owner, token }, { origin: 'https://evil.example' })).status === 403);
  const weak = await post('/auth/setup', { ...owner, token, password: 'short' });
  check('setup refuses a short password', weak.status === 400 && (await errOf(weak)).code === 'weak-password');
  const done = await post('/auth/setup', { ...owner, token: token.toLowerCase() });
  const ownerSession = sessionOf(done);
  check('setup with the token (any case) creates the owner and signs them in', done.status === 201 && !!ownerSession);
  const ownerCookie2 = `__Host-baseline_session=${ownerSession}`;
  const oBoot = await (await preq('/api/bootstrap', { cookie: ownerCookie2 })).json() as { currentUser: { name: string; email: string; admin: boolean }; workspace: { name: string; auth: string; signInMethods: string[] } };
  check('…as an admin, with the workspace named', oBoot.currentUser.admin && oBoot.currentUser.email === 'olu@example.com' && oBoot.workspace.name === 'Acme', JSON.stringify(oBoot.currentUser));
  check('…and bootstrap says how people sign in here', oBoot.workspace.auth === 'hosted' && oBoot.workspace.signInMethods.join() === 'password');
  check('setup is one-shot: the token file is gone', readSetupToken(pwDb) === null);
  const again = await post('/auth/setup', { ...owner, email: 'thief@example.com', token });
  check('…and the route refuses a second owner', again.status === 409 && (await errOf(again)).code === 'already-set-up');
  check('…and /auth/config no longer asks for setup', !((await (await preq('/auth/config')).json()) as { setup: boolean }).setup);
  const users = pw.db.prepare("SELECT password_hash FROM users WHERE kind = 'human'").all() as Array<{ password_hash: string }>;
  check('the password is stored as a salted scrypt hash', users.length === 1 && users[0]!.password_hash.startsWith('scrypt$') && !users[0]!.password_hash.includes(owner.password));

  // two setups racing with the token: exactly one owner
  {
    const raceDb = join(work, 'race.db');
    const race = createApp(raceDb, envCfg, { configured: false, send: async () => {} });
    const t = race.setup.ensure();
    const go = (email: string, n: number) => race.app.fetch(new Request(`${PW}/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: PW, 'x-forwarded-for': `192.0.2.${n}` }, body: JSON.stringify({ ...owner, email, token: t }) }));
    const results = await Promise.all([go('a@example.com', 1), go('b@example.com', 2)]);
    const admins = (race.db.prepare("SELECT COUNT(*) n FROM users WHERE kind = 'human' AND admin = 1").get() as { n: number }).n;
    check('two setups racing with the token make exactly one owner', results.map(r => r.status).sort().join() === '201,409' && Number(admins) === 1, results.map(r => r.status).join());
  }

  // sign in
  const signInPw = (email: string, password: string, ipAddr?: string) => post('/auth/password', { email, password }, { ip: ipAddr });
  const ok = await signInPw('olu@example.com', owner.password);
  check('the owner signs in with email and password', ok.status === 200 && !!sessionOf(ok));
  check('…and that session works on the API', (await preq('/api/me', { cookie: `__Host-baseline_session=${sessionOf(ok)}` })).status === 200);
  const wrong = await signInPw('olu@example.com', 'not the password');
  const nobody = await signInPw('nobody@example.com', 'not the password');
  const wrongBody = await errOf(wrong), nobodyBody = await errOf(nobody);
  check('a wrong password is refused with no session', wrong.status === 401 && !sessionOf(wrong));
  check('…with the same message as an unknown email', nobody.status === 401 && wrongBody.error === nobodyBody.error && wrongBody.code === 'invalid', JSON.stringify([wrongBody, nobodyBody]));
  check('password sign-in from another site is refused', (await post('/auth/password', { email: 'olu@example.com', password: owner.password }, { origin: null })).status === 403);
  {
    // per account: 10 tries in 15 minutes, from any number of addresses
    const target = 'victim@example.com';
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await signInPw(target, 'guess-' + i, `203.0.113.${100 + i}`)).status);
    check('the 11th password guess for one account is rate-limited, across addresses', codes.slice(0, 10).every(c => c === 401) && codes[10] === 429, codes.join());
    // per address: 30 tries in 10 minutes, across accounts
    const ipCodes: number[] = [];
    for (let i = 0; i < 31; i++) ipCodes.push((await signInPw(`spray${i}@example.com`, 'guess', '203.0.113.250')).status);
    check('the 31st sign-in from one address is rate-limited, across accounts', ipCodes.slice(0, 30).every(c => c === 401) && ipCodes[30] === 429, ipCodes.slice(28).join());
    const fresh = await signInPw('olu@example.com', owner.password, '203.0.113.251');
    check('…and another address still signs in', fresh.status === 200);
  }

  // invite by link (no SMTP), accepted with a password
  const team = await (await post('/api/teams', { key: 'ACM', name: 'Acme' }, { cookie: ownerCookie2 })).json() as { team: { id: string } };
  const inv = await (await post('/api/invites', { emails: 'Tia@example.com', teamIds: [team.team.id] }, { cookie: ownerCookie2 })).json() as { results: Array<{ status: string; emailed: string; invite: { link: string } }> };
  const r0 = inv.results[0]!;
  check('without SMTP an invite isn\'t emailed, and comes back with its link', r0.status === 'invited' && r0.emailed === 'off' && r0.invite.link.startsWith(`${PW}/?invite=`), JSON.stringify(r0));
  const code = new URL(r0.invite.link).searchParams.get('invite')!;
  const accept = (body: Record<string, unknown>, c = code) => post(`/auth/invite/${c}/accept`, body);
  const tia = { email: 'tia@example.com', name: 'Tia Teammate', password: 'tia has a long password' };
  const mismatch = await accept({ ...tia, email: 'someone@example.com' });
  check('accepting an invite needs the address it was sent to', mismatch.status === 400 && (await errOf(mismatch)).code === 'invite-mismatch');
  check('…and a long enough password', (await accept({ ...tia, password: 'short' })).status === 400);
  check('…and comes from this site', (await post(`/auth/invite/${code}/accept`, tia, { origin: 'https://evil.example' })).status === 403);
  const joined = await accept({ ...tia, email: 'TIA@example.com' });
  const tiaCookie = `__Host-baseline_session=${sessionOf(joined)}`;
  check('accepting the invite sets the password and signs them in', joined.status === 201 && !!sessionOf(joined));
  const tBoot = await (await preq('/api/bootstrap', { cookie: tiaCookie })).json() as { currentUser: { id: string; name: string; admin: boolean }; teams: Array<{ id: string; memberIds: string[] }> };
  check('…as a member of the invited team, not an admin', tBoot.currentUser.name === 'Tia Teammate' && !tBoot.currentUser.admin && tBoot.teams.find(t => t.id === team.team.id)?.memberIds.includes(tBoot.currentUser.id) === true);
  check('…and both see the same workspace', (await (await preq('/api/bootstrap', { cookie: ownerCookie2 })).json() as { users: Array<{ email: string }> }).users.some(u => u.email === 'tia@example.com'));
  const reuse = await accept(tia);
  check('an accepted invite can\'t be used again', reuse.status === 400 && (await errOf(reuse)).code === 'invite-expired');
  check('the teammate signs in with that password later', (await signInPw('tia@example.com', tia.password)).status === 200);
  const tiaId = tBoot.currentUser.id;

  // reset links
  const ownerId = pw.store.snapshot().users.find(u => u.email === 'olu@example.com')!.id;
  check('a member can\'t make a reset link', (await post(`/api/members/${ownerId}/reset-link`, {}, { cookie: tiaCookie })).status === 403);
  const adminKey = pw.store.ext.apiKeys.create({ name: 'k', userId: ownerId });
  check('an API key can\'t make a reset link', (await pw.app.fetch(new Request(`${PW}/api/members/${tiaId}/reset-link`, { method: 'POST', headers: { authorization: `Bearer ${adminKey.token}` } }))).status === 403);
  const mk = async () => (await (await post(`/api/members/${tiaId}/reset-link`, {}, { cookie: ownerCookie2 })).json() as { link: string; expiresAt: string });
  const first = await mk();
  const resetToken = (link: string) => new URL(link).searchParams.get('reset')!;
  check('an admin makes a reset link for a member, valid for a day', first.link.startsWith(`${PW}/?reset=`) && Math.abs(Date.parse(first.expiresAt) - Date.now() - 86400_000) < 60_000, JSON.stringify(first));
  const second = await mk();
  check('a newer link replaces the older one', (await preq(`/auth/reset/${resetToken(first.link)}`)).status === 404 && (await preq(`/auth/reset/${resetToken(second.link)}`)).status === 200);
  const resetInfo = await (await preq(`/auth/reset/${resetToken(second.link)}`)).json() as { state: string; email: string };
  check('…and says whose password it sets', resetInfo.state === 'valid' && resetInfo.email === 'tia@example.com');
  check('a reset refuses a short password', (await post(`/auth/reset/${resetToken(second.link)}`, { password: 'short' })).status === 400);
  const reset = await post(`/auth/reset/${resetToken(second.link)}`, { password: 'tia chose another password' });
  check('the reset link sets the password and signs them in', reset.status === 200 && !!sessionOf(reset));
  check('…signing out their other sessions', (await preq('/api/bootstrap', { cookie: tiaCookie })).status === 401);
  check('…the old password stops working', (await signInPw('tia@example.com', tia.password)).status === 401);
  check('…the new one works', (await signInPw('tia@example.com', 'tia chose another password')).status === 200);
  check('a reset link works once', (await post(`/auth/reset/${resetToken(second.link)}`, { password: 'a third long password' })).status === 400);
  const third = await mk();
  pw.db.prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  check('an expired reset link is refused', (await preq(`/auth/reset/${resetToken(third.link)}`)).status === 404 && (await post(`/auth/reset/${resetToken(third.link)}`, { password: 'a third long password' })).status === 400);
  check('reset links are stored hashed', !(pw.db.prepare('SELECT token_hash FROM password_resets').all() as Array<{ token_hash: string }>).some(r => r.token_hash === resetToken(third.link)));
  const forgotOff = await post('/auth/forgot', { email: 'tia@example.com' });
  check('without SMTP "forgot password" says to ask an admin', forgotOff.status === 400 && (await errOf(forgotOff)).code === 'mail-off');

  // change your own password
  const tiaNow = sessionOf(await signInPw('tia@example.com', 'tia chose another password'))!;
  const tiaOther = sessionOf(await signInPw('tia@example.com', 'tia chose another password'))!;
  const change = (cookie: string, body: unknown) => post('/api/me/password', body, { cookie: `__Host-baseline_session=${cookie}` });
  const badCurrent = await change(tiaNow, { current: 'nope', next: 'brand new password here' });
  check('changing your password needs the current one (400, not a sign-out)', badCurrent.status === 400 && (await errOf(badCurrent)).code === 'invalid');
  const changed = await change(tiaNow, { current: 'tia chose another password', next: 'brand new password here' });
  const tiaNew = sessionOf(changed);
  check('changing your password keeps this browser signed in', changed.status === 200 && !!tiaNew && (await preq('/api/me', { cookie: `__Host-baseline_session=${tiaNew}` })).status === 200);
  check('…and signs out the others', (await preq('/api/me', { cookie: `__Host-baseline_session=${tiaOther}` })).status === 401);
  check('an API key can\'t change a password', (await pw.app.fetch(new Request(`${PW}/api/me/password`, { method: 'POST', headers: { authorization: `Bearer ${adminKey.token}`, 'content-type': 'application/json' }, body: '{}' }))).status === 403);
  const me = await (await preq('/api/me', { cookie: `__Host-baseline_session=${tiaNew}` })).json() as { hasPassword: boolean };
  check('/api/me says a password is set', me.hasPassword === true);

  // `baseline login` approved from a password session
  {
    const { createHash, randomBytes } = await import('node:crypto');
    const verifier = randomBytes(32).toString('base64url');
    const ask = { port: 54322, state: randomBytes(18).toString('base64url'), challenge: createHash('sha256').update(verifier).digest('base64url'), device: 'pw-laptop' };
    const page = await (await preq(`/cli/authorize?${new URLSearchParams({ ...ask, port: String(ask.port) })}`)).text();
    check('the CLI sign-in page sends a signed-out browser to the app\'s sign-in screen, not Google', page.includes("'/?next='") && !page.includes('/auth/google'));
    const approved = await (await post('/api/cli-auth/approve', ask, { cookie: `__Host-baseline_session=${tiaNew}` })).json() as { redirect: string };
    const back = new URL(approved.redirect);
    const got = await (await pw.app.fetch(new Request(`${PW}/auth/cli/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: back.searchParams.get('code'), verifier }) }))).json() as { token: string; user: { id: string } };
    check('CLI login is approved from a password session and gets a key as that person', got.token?.startsWith('bl_api_') && got.user.id === tiaId, JSON.stringify(got));
  }

  // suspension still wins over a right password
  pw.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(tiaId);
  const susp = await signInPw('tia@example.com', 'brand new password here');
  check('a suspended person can\'t sign in with the right password', susp.status === 403 && (await errOf(susp)).code === 'suspended' && !sessionOf(susp));
  const suspWrong = await signInPw('tia@example.com', 'wrong password');
  check('…and a wrong password for them is the usual refusal', suspWrong.status === 401);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
