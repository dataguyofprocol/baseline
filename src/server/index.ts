import { Hono, type Context, type Next } from 'hono';
import { serve as nodeServe, type ServerType } from '@hono/node-server';
import { getMeta, openDb, resolveDbPath } from '../core/db.js';
import { normalizeDir, Store } from '../core/store.js';
import { blankWorkspace, seedWorkspace } from '../core/seed.js';
import { installedTerminals, isDirectory, LaunchError, openInClaudeCode, pickDirectories } from './launch.js';
import { authConfigFromEnv, cookieSessions, mountAuth, signInMethods, type AuthConfig } from './auth.js';
import { setupToken } from './setup.js';
import { attributedActor, authenticate, hostOf, isLoopback, originHostOf, principalOf, principalUser, Refusal } from './principal.js';
import { mountMembers } from './members.js';
import { mountCliAuth } from './cli-auth.js';
import { MCP_PATH, mountMcpHttp } from '../mcp/http.js';
import { ChangeFeed, startScheduler } from './live.js';
import { streamSSE } from 'hono/streaming';
import { inviteAcceptedEmail, mailerFromEnv, type Mailer } from './mail.js';
import { Accounts, AccountError } from '../core/accounts.js';
import { attributing, type Attribution } from '../core/actor.js';
import { laneOf, WorkError } from '../core/work.js';
import { SESSION_KEY, WORK_OUTCOMES } from '../core/work-types.js';
import { z } from 'zod';
import { setMeta } from '../core/db.js';
import { id } from '../core/util.js';
import { isSnapshotSection, type FileOwnerType, type Priority, type Snapshot, type WorkflowStateType, type RelationType } from '../core/types.js';
import { WEBHOOK_MAX_BYTES, WEBHOOK_PATH } from '../core/webhooks.js';
import { FileError, FileService, MAX_EMOJI_BYTES, MAX_IMAGE_BYTES, fileHeaders, formatBytes } from '../core/files.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

export interface ServeOptions {
  port?: number;
  dbPath?: string;
  open?: boolean;
  seedIfEmpty?: boolean;
}

const WEB_DIST = resolve(fileURLToPath(import.meta.url), '../../../web/dist');

/** BASELINE_HOST opens the server beyond this machine (e.g. 0.0.0.0); unset = loopback only */
const LISTEN_HOST = process.env.BASELINE_HOST?.trim() || '';
const LAN_OPEN = !!LISTEN_HOST && !isLoopback(LISTEN_HOST);

/** `blank`: a new database starts empty for the web app's first-run flow instead of seeded */
export function createApp(dbPath: string, auth: AuthConfig = authConfigFromEnv(), mailer: Mailer = mailerFromEnv(), opts: { blank?: boolean } = {}) {
  const db = openDb(dbPath);
  const store = new Store(db);
  const accounts = new Accounts(db, store);
  const changes = new ChangeFeed(db);
  const hosted = auth.mode === 'hosted';
  const { planning, automation, git, apiKeys, webhooks, work } = store.ext;
  // images (avatars, emoji, pasted pictures) live in the database; pick up any from the old uploads folder
  const files = new FileService(db, join(dirname(dbPath), 'attachments'));
  const moved = files.migrateLegacy();
  if (moved) console.error(`[baseline] moved ${moved} upload(s) into the database`);
  // Loops' "Open in Claude Code" action opens the same interactive session as the manual hand-off.
  // Hosted, that would open it on the server's machine, so it waits for a companion on each person's laptop
  if (hosted) automation.launcherMissing = 'needs a connected companion';
  else automation.launcher = async (issueId: string) => { openInClaudeCode(store, dbPath, issueId, {}); };
  // the git integration polls gh / git log in each location every two minutes while it's on.
  // Those are this machine's folders, so a hosted server leaves GitHub to its webhooks
  if (!hosted) setInterval(() => { if (store.getFeatures().githubEnabled) void git.sync().catch(() => {}); }, 120_000).unref();

  // first run: a laptop gets the sample workspace to play with; a hosted one starts empty.
  // Its owner is created on the setup screen (or by Google sign-in), and onboarding asks for the first team
  const hasWorkspace = db.prepare('SELECT COUNT(*) AS n FROM meta').get() as { n: number };
  if (Number(hasWorkspace.n) === 0 && hosted) {
    setMeta(db, 'workspaceId', id('w'));
    setMeta(db, 'workspaceName', process.env.BASELINE_WORKSPACE_NAME?.trim() || 'Baseline');
    setMeta(db, 'workspaceCreatedAt', new Date().toISOString());
    store.agentUserId();
  } else if (Number(hasWorkspace.n) === 0) {
    if (opts.blank) blankWorkspace(db);
    else {
      seedWorkspace(db);
      console.error('[baseline] seeded a sample workspace — run `baseline seed --reset` to reseed');
    }
  }

  const app = new Hono();

  // liveness for Docker and load balancers: outside /api, so no Host check, session or key
  app.get('/healthz', (c) => {
    db.prepare('SELECT 1').get();
    return c.json({ ok: true });
  });

  // GitHub webhooks are the one door open to other hosts (GitHub reaches this machine through
  // a tunnel): they carry no cookies or keys and are authenticated by their HMAC signature alone
  app.post(WEBHOOK_PATH, async (c) => {
    if (Number(c.req.header('content-length') ?? 0) > WEBHOOK_MAX_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const raw = await c.req.text();
    if (raw.length > WEBHOOK_MAX_BYTES) return c.json({ error: 'Payload too large' }, 413);
    const r = webhooks.receive({ event: c.req.header('x-github-event'), delivery: c.req.header('x-github-delivery'), signature: c.req.header('x-hub-signature-256') }, raw);
    return c.json(r.body, r.status as 200);
  });

  // who every /api request is (key, session or this machine). It runs before any /api route; see principal.ts
  const sessions = hosted ? cookieSessions(auth, accounts) : null;
  const guard = authenticate({ auth, sessions, apiKeys, store, lanOpen: LAN_OPEN });
  app.use('/api/*', guard);
  // the agent operations as MCP tools over HTTP, for an API key (src/mcp/http.ts)
  app.use(MCP_PATH, guard);
  mountMcpHttp(app);
  app.onError((err, c) => {
    if (err instanceof Refusal || err instanceof WorkError) return c.json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    return c.text('Internal Server Error', 500);
  });
  // hosted, nobody can sign in yet: whoever holds this token creates the owner (see setup.ts)
  const setup = setupToken(dbPath);
  if (hosted && !accounts.needsSetup()) setup.clear();
  if (hosted) mountAuth(app, auth, { accounts, store, sessions: sessions!, mailer, setup }, {
    onInviteAccepted: (userId, invitedBy) => {
      const who = accounts.userBrief(userId), inviter = accounts.userBrief(invitedBy);
      if (!mailer.configured || !who || !inviter?.email) return;
      mailer.send(inviteAcceptedEmail({ to: inviter.email, who: who.name, workspace: store.workspaceMeta().name, link: auth.publicUrl.toString() }))
        .catch(err => console.error('[baseline] invite-accepted email failed:', (err as Error).message));
    },
  });

  const actor = (c: Context) => principalUser(c, store);
  /** run a write under its attribution (see attributedActor): `write` gets the actor to pass the
   *  store (undefined: the store's default), and the store records the via beside that actor's rows */
  const attributed = <T>(c: Context, requested: unknown, write: (actorId: string | undefined) => T): T => {
    const a = attributedActor(c, requested, store);
    return a ? attributing.run(a, () => write(a.actorId)) : write(undefined);
  };
  /** the same for writes that need an actor id: the one asked for, else the request's own */
  const attributedTo = <T>(c: Context, requested: unknown, write: (actorId: string) => T): T =>
    attributed(c, requested, (actorId) => write(actorId ?? actor(c)));
  const isAdmin = (userId: string) => !!(db.prepare('SELECT admin FROM users WHERE id = ?').get(userId) as { admin: number } | undefined)?.admin;

  // a delete may have taken an image's owner with it (an issue purged, a doc, a team, an emoji):
  // sweep orphaned images after each delete, and hourly for deletes that happen on their own (trash expiry)
  const sweepFiles = () => { const n = files.gc(); if (n) console.error(`[baseline] deleted ${n} image(s) whose owner is gone`); };
  app.use('/api/*', async (c, next) => {
    await next();
    if (c.req.method === 'DELETE') sweepFiles();
  });
  setInterval(sweepFiles, 3_600_000).unref();

  // ---------- API keys ----------
  app.get('/api/api-keys', (c) => {
    const me = actor(c);
    if (c.req.query('all') && !isAdmin(me)) return c.json({ error: 'Only admins can see every API key', code: 'forbidden' }, 403);
    return c.json({ keys: apiKeys.list(c.req.query('all') ? undefined : me) });
  });
  app.post('/api/api-keys', async (c) => {
    const b = await c.req.json();
    const me = actor(c);
    if (store.getFeatures().apiKeyCreation === 'admins' && !isAdmin(me)) return c.json({ error: 'Only admins can create API keys in this workspace', code: 'forbidden' }, 403);
    try { return c.json(apiKeys.create({ name: String(b.name ?? ''), userId: me, scopes: b.scopes ?? null, teamIds: b.teamIds ?? null }), 201); }
    catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });
  const ownKey = (c: Context) => { const k = apiKeys.get(c.req.param('id')!); return k && (k.userId === actor(c) || isAdmin(actor(c))) ? k : null; };
  app.patch('/api/api-keys/:id', async (c) => { if (!ownKey(c)) return c.json({ error: 'not found' }, 404); apiKeys.rename(c.req.param('id'), String((await c.req.json()).name ?? '')); return c.json({ ok: true }); });
  app.delete('/api/api-keys/:id', (c) => { if (!ownKey(c)) return c.json({ error: 'not found' }, 404); apiKeys.revoke(c.req.param('id')); return c.json({ ok: true }); });

  // a write tells open tabs at once, rather than at the feed's next look
  app.use('/api/*', async (c, next) => {
    await next();
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') changes.check();
  });

  // workspace-wide settings, people and whole-workspace data are admins' (everyone is, in local mode)
  const adminOnly = async (c: Context, next: Next) => {
    if (hosted && !accounts.isAdmin(store.actor())) return c.json({ error: 'Only admins can do that', code: 'forbidden' }, 403);
    await next();
  };
  for (const path of ['/api/workspace', '/api/features', '/api/export', '/api/import', '/api/seed']) app.use(path, adminOnly);
  app.post('/api/users', adminOnly);
  // so is how teams and the workspace are set up (TEAM_PLAN.md › Who changes what). Issues, projects,
  // docs, cycles and comments stay everyone's, and so does creating a team or adding a label from a picker
  const configRoutes: Array<[string, string]> = [
    ['PATCH', '/api/teams/:id'], ['DELETE', '/api/teams/:id'], ['PUT', '/api/teams/:id/workflow'],
    ['POST', '/api/states'], ['PATCH', '/api/states/:id'], ['DELETE', '/api/states/:id'],
    ['PATCH', '/api/labels/:id'], ['DELETE', '/api/labels/:id'],
    ['PATCH', '/api/project-labels/:id'], ['DELETE', '/api/project-labels/:id'],
    ['PATCH', '/api/initiative-labels/:id'], ['DELETE', '/api/initiative-labels/:id'],
    ['POST', '/api/project-statuses'], ['PATCH', '/api/project-statuses/:id'], ['DELETE', '/api/project-statuses/:id'],
    ['POST', '/api/issue-templates'], ['PATCH', '/api/issue-templates/:id'], ['DELETE', '/api/issue-templates/:id'],
    ['POST', '/api/project-templates'], ['PATCH', '/api/project-templates/:id'], ['DELETE', '/api/project-templates/:id'],
    ['POST', '/api/doc-templates'], ['PATCH', '/api/doc-templates/:id'], ['DELETE', '/api/doc-templates/:id'],
    ['POST', '/api/sla-rules'], ['PATCH', '/api/sla-rules/:id'], ['DELETE', '/api/sla-rules/:id'],
    ['POST', '/api/asks'], ['PATCH', '/api/asks/:id'], ['DELETE', '/api/asks/:id'],
    ['POST', '/api/loops'], ['PATCH', '/api/loops/:id'], ['DELETE', '/api/loops/:id'], ['POST', '/api/loops/:id/run'],
    ['PUT', '/api/git/automation/:teamId'],
    ['PUT', '/api/github/webhook/config'], ['POST', '/api/github/webhook/secret'], ['DELETE', '/api/github/webhook/secret'],
    ['POST', '/api/github/issues/import'], ['PUT', '/api/github/issues/follow'],
    ['DELETE', '/api/emojis/:id'],
    ['POST', '/api/customer-attrs/*'], ['PATCH', '/api/customer-attrs/*'], ['DELETE', '/api/customer-attrs/*'],
  ];
  for (const [method, path] of configRoutes) app.on(method, path, adminOnly);
  mountMembers(app, { store, accounts, mailer, hosted: hosted ? auth : null });
  mountCliAuth(app, { db, store, accounts, apiKeys });

  // ---------- bootstrap ----------
  // ?sections=teams,states,… returns only those parts (a CLI command needs a few, not the whole workspace)
  app.get('/api/bootstrap', (c) => {
    const requested = c.req.query('sections')?.split(',').map(s => s.trim()).filter(Boolean);
    const unknown = requested?.filter(s => !isSnapshotSection(s));
    if (unknown?.length) return c.json({ error: `Unknown bootstrap section(s): ${unknown.join(', ')}`, code: 'invalid' }, 400);
    const snap = store.snapshot();
    snap.workspace.auth = auth.mode;
    if (hosted) { snap.workspace.signInMethods = signInMethods(auth); snap.workspace.mail = mailer.configured; }
    // the home directory only means something when the server is this machine
    if (!hosted) snap.workspace.homeDir = homedir();
    if (LAN_OPEN) snap.workspace.lanHost = LISTEN_HOST;
    snap.updateDrafts = work.draftsFor(actor(c));
    if (!requested) return c.json(snap);
    // scope before picking: a team-limited key's response scoping drops comments and activity by
    // their issue, which it can only do while the issues are in the same response
    const p = principalOf(c);
    const scoped = (p.via === 'key' ? apiKeys.scopeResponse(p.key, snap) : snap) as Record<string, unknown>;
    return c.json(Object.fromEntries(requested.map(s => [s, scoped[s]])));
  });

  // ---------- who am I ----------
  app.get('/api/me', (c) => {
    const p = principalOf(c);
    const user = store.snapshot().users.find(u => u.id === principalUser(c, store));
    if (!user) return c.json({ error: 'not found' }, 404);
    const ws = store.workspaceMeta();
    return c.json({
      user, workspace: { id: ws.id, name: ws.name }, via: p.via,
      scopes: p.via === 'key' ? p.key.scopes : null, teamIds: p.via === 'key' ? p.key.teamIds : null,
      keyId: p.via === 'key' ? p.key.id : null,
      // whether Settings › Account offers "change password" (null: not a signed-in browser)
      hasPassword: p.via === 'session' ? !!accounts.passwordHashOf(p.userId) : null,
    });
  });
  // signing out of the CLI: only ever the key that made the request (other keys are managed in Settings)
  app.delete('/api/me/key', (c) => {
    const p = principalOf(c);
    if (p.via !== 'key') return c.json({ error: 'This request wasn\'t made with an API key', code: 'invalid' }, 400);
    apiKeys.revoke(p.key.id);
    return c.json({ ok: true });
  });

  // ---------- live updates ----------
  // Server-sent events: the current version on connect, every new one after, and a comment every
  // 25s so proxies keep the connection open. Only a number travels, and each tab then fetches its own
  // snapshot, so nobody learns anything here they couldn't already see.
  app.get('/api/events', (c) => streamSSE(c, async (stream) => {
    let open = true;
    const off = changes.subscribe(v => { if (open) void stream.writeSSE({ event: 'version', data: JSON.stringify({ v }) }).catch(() => { open = false; }); });
    stream.onAbort(() => { open = false; off(); });
    await stream.writeSSE({ event: 'version', data: JSON.stringify({ v: changes.current }) });
    while (open) {
      await stream.sleep(25_000);
      if (open) await stream.write(': ping\n\n').catch(() => { open = false; });
    }
    off();
  }));

  // ---------- issues ----------
  app.post('/api/issues', async (c) => {
    const b = await c.req.json();
    const issue = attributed(c, b.actorId, (actorId) => store.createIssue({
      teamId: b.teamId, title: b.title, description: b.description, stateId: b.stateId,
      priority: b.priority, assigneeId: b.assigneeId ?? null, projectId: b.projectId ?? null,
      parentId: b.parentId ?? null, cycleId: b.cycleId ?? null, labelIds: b.labelIds,
      dueDate: b.dueDate ?? null, estimate: b.estimate ?? null, milestoneId: b.milestoneId ?? null,
      // omitted = a sub-issue inherits its parent's (nothing else is defaulted); null = explicitly none
      ...('locationId' in b ? { locationId: b.locationId } : {}),
    }, actorId));
    return c.json({ issue }, 201);
  });
  app.patch('/api/issues/:id', async (c) => {
    const { actorId: requested, ...patch } = await c.req.json();
    const issue = attributed(c, requested, (actorId) => store.updateIssue(c.req.param('id'), patch, actorId));
    if (!issue) return c.json({ error: 'not found' }, 404);
    return c.json({ issue });
  });
  app.get('/api/issues', (c) => {
    const q = (k: string) => c.req.query(k) || undefined;
    const priority = q('priority'), limit = q('limit');
    return c.json({ issues: store.listIssues({
      teamId: q('teamId'), stateId: q('stateId'), assigneeId: q('assigneeId'), projectId: q('projectId'),
      priority: priority === undefined ? undefined : Number(priority) as Priority, query: q('query'),
      includeArchived: q('includeArchived') === 'true', limit: limit === undefined ? undefined : Number(limit),
    }) });
  });
  // by key (CORE-12), archived and deleted included. Writes take ids: a key in a write's path would
  // slip past a team-limited key's check, which looks the path segment up as an issue id
  app.get('/api/issues/by-key/:key', (c) => {
    const issue = store.getByKey(c.req.param('key'));
    return issue ? c.json({ issue }) : c.json({ error: 'not found' }, 404);
  });
  // archive & trash (registered before /api/issues/:id so the words don't read as ids)
  app.get('/api/issues/archived', (c) => c.json({ issues: store.listArchived(c.req.query('teamId') || undefined) }));
  app.get('/api/issues/deleted', (c) => c.json({ issues: store.listDeleted(c.req.query('teamId') || undefined) }));
  app.get('/api/issues/:id', (c) => {
    const issue = store.getIssue(c.req.param('id'));
    return issue ? c.json({ issue }) : c.json({ error: 'not found' }, 404);
  });
  app.delete('/api/issues/:id', (c) => { store.deleteIssue(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/issues/:id/restore', (c) => { store.restoreIssue(c.req.param('id')); return c.json({ ok: true }); });
  app.delete('/api/issues/:id/purge', async (c) => {
    const issueId = c.req.param('id');
    store.purgeIssue(issueId);
    files.removeOwner('issue', issueId);
    return c.json({ ok: true });
  });
  app.post('/api/issues/:id/convert-project', (c) => {
    const r = store.convertIssueToProject(c.req.param('id'));
    return r ? c.json(r) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/issues/:id/team', async (c) => {
    const b = await c.req.json();
    const issue = store.moveIssueToTeam(c.req.param('id'), b.teamId);
    return issue ? c.json({ issue }) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/issues/:id/snooze', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    store.snoozeIssue(c.req.param('id'), b.until ?? null);
    return c.json({ ok: true });
  });
  app.post('/api/issues/:id/remind', async (c) => {
    const b = await c.req.json();
    if (!b.at) return c.json({ error: 'at is required' }, 400);
    store.remindIssue(c.req.param('id'), String(b.at));
    return c.json({ ok: true });
  });
  app.post('/api/issues/:id/subscribe', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    attributedTo(c, b.userId, (uid) => {
      if (b.subscribed === false) store.unsubscribe(c.req.param('id'), uid);
      else store.subscribe(c.req.param('id'), uid);
    });
    return c.json({ ok: true });
  });

  // ---------- images ----------
  /** the request body is the image; a Content-Length over the limit is refused before reading */
  const readUpload = async (c: Context, max: number): Promise<Buffer> => {
    if (Number(c.req.header('content-length')) > max) throw new FileError(`Images are limited to ${formatBytes(max)} — link to bigger files instead`, 413);
    return Buffer.from(await c.req.arrayBuffer());
  };
  const uploadFailed = (c: Context, err: unknown) => err instanceof FileError
    ? c.json({ error: err.message }, err.status)
    : c.json({ error: `Upload failed: ${(err as Error).message}` }, 500);

  // a picture pasted into an issue's, doc's, project's, initiative's or team's editor; ?owner=issue:<id>, ?name= its filename
  const EDITOR_OWNERS: FileOwnerType[] = ['issue', 'doc', 'project', 'initiative', 'team'];
  app.post('/api/files', async (c) => {
    const [type, ownerId = ''] = String(c.req.query('owner') ?? '').split(':');
    if (!EDITOR_OWNERS.includes(type as FileOwnerType)) return c.json({ error: 'owner must be issue:<id>, doc:<id>, project:<id>, initiative:<id> or team:<id>' }, 400);
    try {
      const file = files.upload({ data: await readUpload(c, MAX_IMAGE_BYTES), name: c.req.query('name'), ownerType: type as FileOwnerType, ownerId, uploadedBy: actor(c) });
      return c.json({ file }, 201);
    } catch (err) { return uploadFailed(c, err); }
  });
  const serveFile = (c: Context, fileId: string) => {
    const f = files.get(fileId);
    const data = f && files.data(f.id);
    if (!f || !data) return c.json({ error: 'not found' }, 404);
    const headers = fileHeaders(f);
    if (c.req.header('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers });
    return new Response(c.req.method === 'HEAD' ? null : new Uint8Array(data), { headers: { ...headers, 'Content-Length': String(data.length) } });
  };
  app.get('/api/files/:id/:name?', (c) => serveFile(c, c.req.param('id')));
  // URLs from before images moved into the database, already pasted into descriptions and comments
  app.get('/api/attachments/:id/:name', (c) => serveFile(c, c.req.param('id')));
  app.get('/api/emoji-files/:id/:name', (c) => serveFile(c, c.req.param('id')));

  // ---------- attachments (links; file attachments from older versions stay listed) ----------
  app.post('/api/issues/:id/attachments', async (c) => {
    const b = await c.req.json();
    if (!b.url) return c.json({ error: 'url is required' }, 400);
    const attachment = store.addAttachment({ issueId: c.req.param('id'), kind: 'link', url: String(b.url), title: b.title });
    return c.json({ attachment }, 201);
  });
  app.patch('/api/attachments/:id', async (c) => {
    const b = await c.req.json();
    if (b.title) store.updateAttachment(c.req.param('id'), String(b.title));
    return c.json({ ok: true });
  });
  app.delete('/api/attachments/:id', (c) => {
    const a = store.getAttachment(c.req.param('id'));
    store.deleteAttachment(c.req.param('id'));
    if (a?.kind === 'file') files.remove(a.id);
    return c.json({ ok: true });
  });
  app.post('/api/issues/:id/archive', (c) => {
    const issue = store.updateIssue(c.req.param('id'), { archivedAt: new Date().toISOString() });
    return issue ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/issues/:id/unarchive', (c) => {
    const issue = store.updateIssue(c.req.param('id'), { archivedAt: null });
    return issue ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
  });
  app.post('/api/issues/bulk', async (c) => {
    const b = await c.req.json();
    const ids: string[] = b.ids ?? [];
    for (const issueId of ids) {
      if (b.patch) store.updateIssue(issueId, b.patch);
      if (b.delete) store.deleteIssue(issueId);
      if (b.archive) store.updateIssue(issueId, { archivedAt: new Date().toISOString() });
    }
    return c.json({ ok: true, count: ids.length });
  });
  app.post('/api/issues/:id/move', async (c) => {
    const b = await c.req.json();
    store.moveIssue(c.req.param('id'), b.beforeId ?? null, b.afterId ?? null);
    return c.json({ ok: true });
  });
  // branch copy / hand-off: backlog or unstarted → first started state, unassigned → you
  app.post('/api/issues/:id/start', (c) => c.json(store.startIssue(c.req.param('id'), actor(c))));
  app.get('/api/issues/:id/handoff', (c) => {
    const handoff = store.handoffFor(c.req.param('id'), hosted ? auth.publicUrl.origin : undefined);
    return handoff ? c.json({ handoff }) : c.json({ error: 'not found' }, 404);
  });
  // these routes start local processes (a terminal, a folder picker), so only this machine's own
  // pages may call them. A Host other than localhost means LAN or DNS rebinding, a foreign
  // Origin means another site, and a non-JSON body means a CORS-free "simple" form post
  // (these stay loopback-only even when BASELINE_HOST opens the rest to the LAN)
  const localOnly = async (c: Context, next: Next) => {
    if (hosted) return c.json({ error: 'The hosted app can\'t open programs on your computer yet — copy the prompt instead', code: 'companion-required' }, 403);
    const originHost = originHostOf(c);
    if (!isLoopback(hostOf(c)) || (originHost !== null && !isLoopback(originHost)) || !(c.req.header('content-type') ?? '').includes('application/json')) {
      return c.json({ error: 'Only this machine can do that', code: 'forbidden' }, 403);
    }
    await next();
  };
  app.use('/api/issues/:id/open-claude', localOnly);
  app.use('/api/directories/*', localOnly);
  // PR and commit ingest move issues as the GitHub agent: same rule
  app.use('/api/git/pull-requests', localOnly);
  app.use('/api/git/commits', localOnly);
  app.post('/api/issues/:id/open-claude', async (c) => {
    const b = await c.req.json().catch(() => ({})) as { locationId?: string; directory?: string };
    try {
      return c.json(openInClaudeCode(store, dbPath, c.req.param('id'), b));
    } catch (err) {
      if (err instanceof LaunchError) return c.json({ error: err.message, code: err.code }, err.code === 'not-found' ? 404 : 400);
      throw err;
    }
  });

  // ---------- coding directories ----------
  app.post('/api/directories/pick', async (c) => {
    const b = await c.req.json().catch(() => ({})) as { prompt?: string; multiple?: boolean };
    try {
      const directories = await pickDirectories(b.prompt, !!b.multiple);
      return c.json({ directories, directory: directories[0] ?? null });
    } catch (err) {
      if (err instanceof LaunchError) return c.json({ error: err.message, code: err.code }, 400);
      throw err;
    }
  });
  app.get('/api/terminals', (c) => c.json({ installed: hosted ? [] : installedTerminals() }));
  app.post('/api/directories/check', async (c) => {
    const b = await c.req.json() as { directory?: string };
    return c.json({ exists: isDirectory(normalizeDir(b.directory)) });
  });

  // ---------- locations (directories agents work in) ----------
  app.post('/api/locations', async (c) => {
    // a location is checked against this server's disk, which is meaningless (and a probe) on a hosted server
    if (hosted) return c.json({ error: 'Locations can\'t be added on the hosted app yet', code: 'companion-required' }, 403);
    const b = await c.req.json() as { path?: string; name?: string };
    const path = normalizeDir(b.path);
    if (!isDirectory(path)) return c.json({ error: `Directory not found: ${path || '(empty)'}` }, 400);
    return c.json({ location: store.createLocation(path, b.name) }, 201);
  });
  // existing ones (say, from a laptop workspace moved to a server) can be tidied away, by admins
  app.patch('/api/locations/:id', adminOnly);
  app.delete('/api/locations/:id', adminOnly);
  app.patch('/api/locations/:id', async (c) => {
    const b = await c.req.json() as { name?: string };
    try { if (b.name) store.renameLocation(c.req.param('id'), b.name); } catch (err) { return c.json({ error: (err as Error).message }, 400); }
    return c.json({ ok: true });
  });
  app.delete('/api/locations/:id', (c) => { store.deleteLocation(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- comments ----------
  app.post('/api/issues/:id/comments', async (c) => {
    const b = await c.req.json();
    const comment = attributedTo(c, b.userId, (userId) => store.addComment(c.req.param('id'), userId, b.body, b.parentId ?? null));
    return c.json({ comment }, 201);
  });
  app.patch('/api/comments/:id', async (c) => {
    const b = await c.req.json();
    if (b.reaction) { attributedTo(c, b.userId, (userId) => store.toggleReaction(c.req.param('id'), b.reaction, userId)); return c.json({ ok: true }); }
    if ('resolved' in b) { store.resolveComment(c.req.param('id'), !!b.resolved); return c.json({ ok: true }); }
    store.updateComment(c.req.param('id'), b.body);
    return c.json({ ok: true });
  });
  app.delete('/api/comments/:id', (c) => { store.deleteComment(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- agent work (core/work.ts) ----------
  // One route per agent operation that writes, each one SQLite transaction. The operations in
  // src/ops call these through the client; the server alone decides attribution and convergence.
  const workBase = hosted ? auth.publicUrl.origin : undefined;
  /** the write's attribution: the agent asked for (recorded via the request's person), else that person */
  const workAs = (c: Context, requested: unknown): Attribution =>
    attributedActor(c, requested, store) ?? { actor: 'person', actorId: actor(c), viaUserId: null };
  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    const r = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!r.success) throw new Refusal(400, 'invalid', r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    return r.data;
  };
  const session = z.string().regex(SESSION_KEY, 'BASELINE_SESSION is 1-64 characters of A-Z, a-z, 0-9 and . _ : -').nullish().transform(s => s ?? null);
  const urls = z.array(z.url()).max(10).default([]);
  const actorField = { actorId: z.string().optional(), session };
  app.post('/api/issues/:id/work/start', async (c) => {
    const b = await body(c, z.object(actorField));
    const who = workAs(c, b.actorId);
    return c.json(work.start(c.req.param('id'), laneOf(who, b.session), who, workBase));
  });
  app.post('/api/issues/:id/work/progress', async (c) => {
    const b = await body(c, z.object({ ...actorField, did: z.string().optional(), left: z.string().optional(), blocked: z.string().optional(), links: urls }));
    const who = workAs(c, b.actorId);
    return c.json(work.progress(c.req.param('id'), laneOf(who, b.session), { did: b.did, left: b.left, blocked: b.blocked }, b.links, who, workBase));
  });
  app.post('/api/issues/:id/work/finish', async (c) => {
    const b = await body(c, z.object({ ...actorField, outcome: z.enum(WORK_OUTCOMES), summary: z.string().trim().min(1), left: z.string().optional(), links: urls }));
    const who = workAs(c, b.actorId);
    return c.json(work.finish(c.req.param('id'), laneOf(who, b.session), b, who, workBase));
  });
  app.post('/api/issues/:id/followups', async (c) => {
    const b = await body(c, z.object({ ...actorField, title: z.string().trim().min(3).max(200), description: z.string().optional(), teamId: z.string().optional() }));
    const who = workAs(c, b.actorId);
    const r = work.followup(c.req.param('id'), laneOf(who, b.session), b, who, workBase);
    return c.json(r, r.deduplicated ? 200 : 201);
  });
  app.get('/api/issues/:id/work', (c) => c.json({ threads: work.threads(c.req.param('id')) }));
  app.get('/api/projects/:id/update-draft', (c) => c.json({ draft: work.draft(c.req.param('id'), actor(c)) }));
  app.put('/api/projects/:id/update-draft', async (c) => {
    const b = await body(c, z.object({ actorId: z.string().optional(), body: z.string().optional(), health: z.enum(['onTrack', 'atRisk', 'offTrack']).optional() }));
    const who = workAs(c, b.actorId);
    return c.json(work.draftUpdate(c.req.param('id'), laneOf(who, null), b, who, workBase));
  });
  app.delete('/api/projects/:id/update-draft', (c) => c.json({ ok: work.discardDraft(c.req.param('id'), actor(c)) }));
  // a person's call, made in the web app: authenticate refuses any key here (principal.ts PUBLISH)
  app.post('/api/projects/:id/update-draft/publish', async (c) => {
    const edits = c.req.header('content-type')?.includes('application/json')
      ? await body(c, z.object({ body: z.string().optional(), health: z.enum(['onTrack', 'atRisk', 'offTrack']).optional() }))
      : {};
    return c.json({ published: work.publishDraft(c.req.param('id'), actor(c), edits) }, 201);
  });
  app.post('/api/ops/:id/undo', async (c) => {
    const b = await body(c, z.object({ actorId: z.string().optional() }));
    const owner = work.opOwner(c.req.param('id'));
    if (!owner) throw new WorkError(404, 'not-found', `No change ${c.req.param('id')}`);
    const p = principalOf(c);
    if (p.via !== 'local' && ![owner.actorId, owner.personId].includes(p.userId) && !isAdmin(p.userId)) throw new Refusal(403, 'forbidden', 'Only the person a change was made for (or an admin) can undo it');
    if (p.via === 'key' && p.key.teamIds && owner.teamId && !p.key.teamIds.includes(owner.teamId)) throw new Refusal(403, 'forbidden', 'This API key can’t access that team');
    const who = workAs(c, b.actorId);
    return c.json(work.undo(c.req.param('id'), who));
  });

  // ---------- relations ----------
  app.post('/api/issues/:id/relations', async (c) => {
    const b = await c.req.json();
    const rel = store.setRelation(c.req.param('id'), b.relatedIssueId, b.type as RelationType);
    return c.json({ relation: rel }, 201);
  });
  app.delete('/api/relations/:id', (c) => { store.removeRelation(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- projects ----------
  app.post('/api/projects', async (c) => {
    const b = await c.req.json();
    const project = store.createProject(b);
    return c.json({ project }, 201);
  });
  app.patch('/api/projects/:id', async (c) => {
    const b = await c.req.json();
    store.updateProject(c.req.param('id'), b);
    if (Array.isArray(b.locationIds)) store.setProjectLocations(c.req.param('id'), b.locationIds);
    return c.json({ ok: true });
  });
  app.delete('/api/projects/:id', (c) => { store.deleteProject(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/projects/:id/updates', async (c) => {
    const b = await c.req.json();
    const update = attributedTo(c, b.userId, (userId) => store.addProjectUpdate(c.req.param('id'), userId, b.body, b.health));
    return c.json({ update }, 201);
  });
  app.post('/api/projects/:id/links', async (c) => {
    const b = await c.req.json();
    if (!b.url) return c.json({ error: 'url is required' }, 400);
    store.addProjectLink(c.req.param('id'), String(b.url), b.title);
    return c.json({ ok: true }, 201);
  });
  app.delete('/api/project-links/:id', (c) => { store.deleteProjectLink(c.req.param('id')); return c.json({ ok: true }); });
  app.get('/api/projects/:id/progress', (c) => c.json(store.projectProgress(c.req.param('id'))));

  // ---------- teams / states / labels ----------
  app.post('/api/teams', async (c) => {
    const b = await c.req.json();
    const team = store.createTeam(b.key, b.name, b.icon, b.color);
    return c.json({ team }, 201);
  });
  app.patch('/api/teams/:id', async (c) => {
    const b = await c.req.json();
    store.updateTeam(c.req.param('id'), b);
    return c.json({ ok: true });
  });
  app.delete('/api/teams/:id', (c) => { store.deleteTeam(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/states', async (c) => {
    const b = await c.req.json();
    const state = store.createState(b.teamId, b.name, b.type as WorkflowStateType, b.color);
    return c.json({ state }, 201);
  });
  app.patch('/api/states/:id', async (c) => {
    const b = await c.req.json();
    store.updateState(c.req.param('id'), b);
    return c.json({ ok: true });
  });
  app.delete('/api/states/:id', (c) => {
    const movedTo = store.deleteState(c.req.param('id'));
    return c.json({ ok: true, movedTo: movedTo ?? null });
  });
  app.post('/api/labels', async (c) => {
    const b = await c.req.json();
    const label = store.createLabel(b.teamId, b.name, b.color, b.description);
    return c.json({ label }, 201);
  });
  app.patch('/api/labels/:id', async (c) => {
    const b = await c.req.json();
    store.updateLabel(c.req.param('id'), b);
    return c.json({ ok: true });
  });
  app.delete('/api/labels/:id', (c) => { store.deleteLabel(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- documents & team links ----------
  app.post('/api/docs', async (c) => c.json({ doc: store.createDoc(await c.req.json()) }, 201));
  app.patch('/api/docs/:id', async (c) => { const b = await c.req.json(); attributed(c, b.actorId, (actorId) => store.updateDoc(c.req.param('id'), b, actorId)); return c.json({ ok: true }); });
  app.delete('/api/docs/:id', (c) => { store.deleteDoc(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/teams/:id/links', async (c) => {
    const b = await c.req.json();
    if (!b.url) return c.json({ error: 'url is required' }, 400);
    store.addTeamLink(c.req.param('id'), String(b.url), b.title);
    return c.json({ ok: true }, 201);
  });
  app.delete('/api/team-links/:id', (c) => { store.deleteTeamLink(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- project templates & dependencies ----------
  app.post('/api/project-templates', async (c) => {
    const b = await c.req.json();
    if (!b.name) return c.json({ error: 'name is required' }, 400);
    return c.json({ template: store.createProjectTemplate(b) }, 201);
  });
  app.patch('/api/project-templates/:id', async (c) => { store.updateProjectTemplate(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/project-templates/:id', (c) => { store.deleteProjectTemplate(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/projects/:id/apply-template', async (c) => {
    const b = await c.req.json();
    store.applyProjectTemplate(c.req.param('id'), b.templateId);
    return c.json({ ok: true });
  });
  app.post('/api/projects/:id/dependencies', async (c) => {
    const b = await c.req.json();
    if (b.blocks) store.addProjectDependency(c.req.param('id'), b.blocks);
    if (b.blockedBy) store.addProjectDependency(b.blockedBy, c.req.param('id'));
    return c.json({ ok: true }, 201);
  });
  app.delete('/api/project-dependencies/:id', (c) => { store.removeProjectDependency(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- recurring issues ----------
  app.post('/api/recurring', async (c) => {
    const b = await c.req.json();
    if (!b.teamId || !b.title || !b.cadence) return c.json({ error: 'teamId, title and cadence are required' }, 400);
    return c.json({ recurring: store.createRecurring(b) }, 201);
  });
  app.patch('/api/recurring/:id', async (c) => { store.updateRecurring(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/recurring/:id', (c) => { store.deleteRecurring(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- issue templates ----------
  app.get('/api/issue-templates', (c) => c.json({ templates: store.snapshot().templates }));
  app.post('/api/issue-templates', async (c) => {
    const b = await c.req.json();
    if (!b.teamId || !b.name) return c.json({ error: 'teamId and name are required' }, 400);
    const template = store.createTemplate(b.teamId, b.name, b.title ?? '', b.description ?? '');
    return c.json({ template }, 201);
  });
  app.patch('/api/issue-templates/:id', async (c) => {
    const b = await c.req.json();
    store.updateTemplate(c.req.param('id'), b);
    return c.json({ ok: true });
  });
  app.delete('/api/issue-templates/:id', (c) => { store.deleteTemplate(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- users ----------
  app.post('/api/users', async (c) => {
    const b = await c.req.json();
    const user = store.createUser(b.name, b.email ?? '', b.admin ?? false, b.kind === 'agent' ? 'agent' : 'human');
    return c.json({ user }, 201);
  });
  app.patch('/api/users/:id', async (c) => {
    const b = await c.req.json() as { name?: string; color?: string; email?: string; admin?: boolean };
    const targetId = c.req.param('id');
    const admin = !hosted || accounts.isAdmin(store.actor());
    if (!admin && targetId !== store.actor()) return c.json({ error: 'You can only edit your own profile', code: 'forbidden' }, 403);
    // hosted: the email is the Google account's, so it isn't editable; admin rights are for admins to give
    const patch: Parameters<Store['updateUser']>[1] = {};
    if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
    if (typeof b.color === 'string') patch.color = b.color;
    if (!hosted && typeof b.email === 'string') patch.email = b.email;
    // admin rights go through setAdmin, which refuses to demote the last active admin
    if (admin && typeof b.admin === 'boolean') {
      try { accounts.setAdmin(targetId, b.admin); }
      catch (err) {
        if (err instanceof AccountError) return c.json({ error: err.message, code: err.code }, err.code === 'not-found' ? 404 : 400);
        throw err;
      }
    }
    store.updateUser(targetId, patch);
    return c.json({ ok: true });
  });

  // ---------- cycles ----------
  app.post('/api/cycles', async (c) => {
    const b = await c.req.json();
    const cycle = store.createCycle(b.teamId, b.number, b.startsAt, b.endsAt, b.name ?? '');
    return c.json({ cycle }, 201);
  });
  app.patch('/api/cycles/:id', async (c) => {
    const b = await c.req.json();
    store.updateCycle(c.req.param('id'), b);
    return c.json({ ok: true });
  });
  app.delete('/api/cycles/:id', (c) => { store.deleteCycle(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- milestones ----------
  app.post('/api/milestones', async (c) => {
    const b = await c.req.json();
    const milestone = store.createMilestone(b.projectId, b.name, b.targetDate ?? null);
    return c.json({ milestone }, 201);
  });
  app.patch('/api/milestones/:id', async (c) => {
    const b = await c.req.json();
    store.updateMilestone(c.req.param('id'), b);
    return c.json({ ok: true });
  });
  app.delete('/api/milestones/:id', (c) => { store.deleteMilestone(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- views / favorites ----------
  app.post('/api/views', async (c) => {
    const b = await c.req.json();
    const view = store.createView(b.name, b.filters ?? {}, b);
    return c.json({ view }, 201);
  });
  // someone else's personal view doesn't exist as far as you're concerned
  app.patch('/api/views/:id', async (c) => {
    const b = await c.req.json();
    return store.updateView(c.req.param('id'), b) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
  });
  app.delete('/api/views/:id', (c) => store.deleteView(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404));
  app.post('/api/favorites/toggle', async (c) => {
    const b = await c.req.json();
    store.toggleFavorite(b.type, b.refId);
    return c.json({ ok: true });
  });

  // ---------- notifications ----------
  app.get('/api/notifications', (c) => c.json({ notifications: store.listNotifications() }));
  app.post('/api/notifications/:id/read', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    store.markNotificationRead(c.req.param('id'), b.read ?? true);
    return c.json({ ok: true });
  });
  app.post('/api/notifications/read-all', (c) => { store.markAllNotificationsRead(); return c.json({ ok: true }); });
  app.post('/api/notifications/delete-read', (c) => { store.deleteReadNotifications(); return c.json({ ok: true }); });
  app.delete('/api/notifications/:id', (c) => { store.deleteNotification(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/notifications/:id/snooze', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    store.snoozeNotification(c.req.param('id'), b.until ?? null);
    return c.json({ ok: true });
  });

  // ---------- preferences ----------
  app.patch('/api/preferences', async (c) => {
    store.setPreferences(await c.req.json());
    return c.json({ ok: true });
  });
  app.patch('/api/features', async (c) => {
    const b = await c.req.json();
    store.setFeatures(b);
    // turning GitHub on adds Linear's "In Review" state and syncs straight away
    if (b.githubEnabled === true) { git.ensureInReview(); if (!hosted) void git.sync().catch(() => {}); }
    return c.json({ ok: true });
  });

  // ---------- initiatives ----------
  app.post('/api/initiatives', async (c) => { const b = await c.req.json(); if (!b.name) return c.json({ error: 'name is required' }, 400); return c.json({ initiative: planning.createInitiative(b) }, 201); });
  app.patch('/api/initiatives/:id', async (c) => { planning.updateInitiative(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/initiatives/:id', (c) => { planning.deleteInitiative(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/initiatives/:id/projects', async (c) => { const b = await c.req.json(); planning.addProject(c.req.param('id'), b.projectId); return c.json({ ok: true }, 201); });
  app.delete('/api/initiatives/:id/projects/:projectId', (c) => { planning.removeProject(c.req.param('id'), c.req.param('projectId')); return c.json({ ok: true }); });
  app.post('/api/initiatives/:id/updates', async (c) => { const b = await c.req.json(); if (!b.body) return c.json({ error: 'body is required' }, 400); return c.json({ update: attributedTo(c, b.userId, (userId) => planning.addInitiativeUpdate(c.req.param('id'), userId, b.body, b.health)) }, 201); });
  app.patch('/api/initiative-updates/:id', async (c) => { const b = await c.req.json(); if (!b.reaction) return c.json({ error: 'reaction is required' }, 400); attributedTo(c, b.userId, (userId) => planning.toggleUpdateReaction(c.req.param('id'), String(b.reaction), userId)); return c.json({ ok: true }); });
  app.post('/api/initiatives/:id/links', async (c) => { const b = await c.req.json(); if (!b.url) return c.json({ error: 'url is required' }, 400); return c.json({ link: planning.addLink(c.req.param('id'), String(b.url), b.title) }, 201); });
  app.delete('/api/initiative-links/:id', (c) => { planning.deleteLink(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/initiative-labels', async (c) => { const b = await c.req.json(); if (!b.name) return c.json({ error: 'name is required' }, 400); return c.json({ label: planning.createLabel(b) }, 201); });
  app.patch('/api/initiative-labels/:id', async (c) => { planning.updateLabel(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/initiative-labels/:id', (c) => { planning.deleteLabel(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- releases ----------
  app.post('/api/releases', async (c) => { const b = await c.req.json(); if (!b.name) return c.json({ error: 'name is required' }, 400); return c.json({ release: planning.createRelease(b) }, 201); });
  app.patch('/api/releases/:id', async (c) => { planning.updateRelease(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/releases/:id', (c) => { planning.deleteRelease(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- SLAs, asks, loops ----------
  app.post('/api/sla-rules', async (c) => { const b = await c.req.json(); if (!b.name || !(b.hours > 0)) return c.json({ error: 'name and hours are required' }, 400); return c.json({ rule: automation.createSlaRule(b) }, 201); });
  app.patch('/api/sla-rules/:id', async (c) => { automation.updateSlaRule(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/sla-rules/:id', (c) => { automation.deleteSlaRule(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/asks', async (c) => { const b = await c.req.json(); if (!b.name || !b.teamId) return c.json({ error: 'name and teamId are required' }, 400); return c.json({ form: automation.createAskForm(b) }, 201); });
  app.patch('/api/asks/:id', async (c) => { automation.updateAskForm(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/asks/:id', (c) => { automation.deleteAskForm(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/asks/:id/submit', async (c) => {
    const b = await c.req.json();
    try { return c.json({ issue: automation.submitAsk(c.req.param('id'), b.values ?? {}, b.requesterId) }, 201); }
    catch (err) { return c.json({ error: (err as Error).message }, 400); }
  });
  app.post('/api/loops', async (c) => { const b = await c.req.json(); if (!b.name || !b.trigger) return c.json({ error: 'name and trigger are required' }, 400); return c.json({ loop: automation.createLoop({ ...b, actions: b.actions ?? [] }) }, 201); });
  app.patch('/api/loops/:id', async (c) => { automation.updateLoop(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/loops/:id', (c) => { automation.deleteLoop(c.req.param('id')); return c.json({ ok: true }); });
  app.put('/api/teams/:id/workflow', async (c) => c.json({ workflow: automation.setTeamWorkflow(c.req.param('id'), await c.req.json()) }));
  app.put('/api/teams/:id/subscription', async (c) => { automation.setTeamSubscription(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.post('/api/loops/:id/run', async (c) => { const b = await c.req.json().catch(() => ({})); try { return c.json({ run: automation.runLoop(c.req.param('id'), b.issueId ?? null) }); } catch (err) { return c.json({ error: (err as Error).message }, 400); } });

  // ---------- git / GitHub ----------
  app.get('/api/git/status', async (c) => c.json(await git.status()));
  app.post('/api/git/sync', async (c) => c.json(hosted ? { prs: 0, commits: 0, error: 'The hosted app gets GitHub activity from webhooks, not gh' } : await git.sync()));
  app.get('/api/git/automation/:teamId', (c) => c.json(git.automation(c.req.param('teamId'))));
  app.put('/api/git/automation/:teamId', async (c) => { git.setAutomation(c.req.param('teamId'), await c.req.json()); return c.json({ ok: true }); });
  // webhook setup (the secret is shown once, when it's made) and one-way GitHub Issues import
  app.get('/api/github/webhook/config', (c) => c.json(webhooks.config()));
  app.put('/api/github/webhook/config', async (c) => { try { webhooks.setPublicUrl(String((await c.req.json()).publicUrl ?? '')); return c.json(webhooks.config()); } catch (e) { return c.json({ error: (e as Error).message }, 400); } });
  app.post('/api/github/webhook/secret', (c) => c.json({ secret: webhooks.rotateSecret() }, 201));
  app.delete('/api/github/webhook/secret', (c) => { webhooks.turnOff(); return c.json({ ok: true }); });
  app.get('/api/github/webhook/deliveries', (c) => c.json({ deliveries: webhooks.deliveries(Math.min(100, Number(c.req.query('limit') ?? 30) || 30)) }));
  app.post('/api/github/issues/import', async (c) => {
    const b = await c.req.json();
    try { return c.json(await webhooks.importIssues(String(b.repo ?? ''), String(b.teamId ?? ''), !!b.follow)); } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });
  app.put('/api/github/issues/follow', async (c) => { const b = await c.req.json(); webhooks.setFollow(String(b.repo ?? ''), b.teamId ? String(b.teamId) : null); return c.json(webhooks.config()); });
  app.post('/api/git/unlink', async (c) => { const b = await c.req.json(); git.unlink(b.issueId, b.prId); return c.json({ ok: true }); });
  /** the webhook-shaped entry points, for scripts and (later) a hosted GitHub App */
  app.post('/api/git/pull-requests', async (c) => c.json({ pr: git.ingestPullRequest(await c.req.json()) }, 201));
  app.post('/api/git/commits', async (c) => { const b = await c.req.json(); return c.json({ linked: git.ingestPush(b.commits ?? []) }, 201); });

  // ---------- project labels, statuses, subscriptions ----------
  app.post('/api/project-labels', async (c) => {
    const b = await c.req.json();
    if (!b.name) return c.json({ error: 'name is required' }, 400);
    return c.json({ label: store.createProjectLabel(b) }, 201);
  });
  app.patch('/api/project-labels/:id', async (c) => { store.updateProjectLabel(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/project-labels/:id', (c) => { store.deleteProjectLabel(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/project-statuses', async (c) => {
    const b = await c.req.json();
    if (!b.name || !b.type) return c.json({ error: 'name and type are required' }, 400);
    return c.json({ status: store.createProjectStatus(b) }, 201);
  });
  app.patch('/api/project-statuses/:id', async (c) => { store.updateProjectStatus(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/project-statuses/:id', (c) => store.deleteProjectStatus(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'A category keeps at least one status' }, 400));
  app.put('/api/projects/:id/subscription', async (c) => {
    store.setProjectSubscription(c.req.param('id'), actor(c), await c.req.json());
    return c.json({ ok: true });
  });

  // ---------- document templates, emojis ----------
  app.post('/api/doc-templates', async (c) => {
    const b = await c.req.json();
    if (!b.name) return c.json({ error: 'name is required' }, 400);
    return c.json({ template: store.createDocTemplate(b) }, 201);
  });
  app.patch('/api/doc-templates/:id', async (c) => { store.updateDocTemplate(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/doc-templates/:id', (c) => { store.deleteDocTemplate(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/emojis', async (c) => {
    const name = String(c.req.query('name') ?? '');
    try {
      const f = files.upload({ data: await readUpload(c, MAX_EMOJI_BYTES), name: c.req.query('file') || 'emoji.png', ownerType: 'workspace', ownerId: '', uploadedBy: actor(c), maxBytes: MAX_EMOJI_BYTES });
      try {
        const emoji = store.addEmoji(name, f.url);
        files.reassign(f.id, 'emoji', emoji.id);
        return c.json({ emoji }, 201);
      } catch (err) { files.remove(f.id); return c.json({ error: (err as Error).message }, 400); }
    } catch (err) { return uploadFailed(c, err); }
  });
  // Settings › Profile › Profile picture (an empty body removes it)
  app.post('/api/users/:id/avatar', async (c) => {
    const userId = c.req.param('id');
    if (!files.ownerExists('avatar', userId)) return c.json({ error: 'not found' }, 404);
    try {
      const data = await readUpload(c, MAX_IMAGE_BYTES);
      const previous = files.byOwner('avatar', userId);
      const avatarUrl = data.length ? files.upload({ data, name: c.req.query('file') || 'avatar.png', ownerType: 'avatar', ownerId: userId, uploadedBy: actor(c) }).url : null;
      store.updateUser(userId, { avatarUrl });
      for (const p of previous) files.remove(p.id);
      return c.json({ avatarUrl }, avatarUrl ? 201 : 200);
    } catch (err) { return uploadFailed(c, err); }
  });
  app.delete('/api/emojis/:id', (c) => { store.deleteEmoji(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- customers ----------
  app.post('/api/customers', async (c) => {
    const b = await c.req.json();
    if (!b.name) return c.json({ error: 'name is required' }, 400);
    return c.json({ customer: store.createCustomer(b) }, 201);
  });
  app.patch('/api/customers/:id', async (c) => { store.updateCustomer(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/customers/:id', (c) => { store.deleteCustomer(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/customer-attrs/:kind{status|tier}', async (c) => {
    const b = await c.req.json();
    if (!b.name) return c.json({ error: 'name is required' }, 400);
    return c.json(store.createCustomerAttr(c.req.param('kind') as 'status' | 'tier', b.name, b.color), 201);
  });
  app.patch('/api/customer-attrs/:kind{status|tier}/:id', async (c) => { store.updateCustomerAttr(c.req.param('kind') as 'status' | 'tier', c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/customer-attrs/:kind{status|tier}/:id', (c) => { store.deleteCustomerAttr(c.req.param('kind') as 'status' | 'tier', c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/customer-requests', async (c) => {
    const b = await c.req.json();
    if (!b.customerId || (!b.issueId && !b.projectId)) return c.json({ error: 'customerId and an issueId or projectId are required' }, 400);
    return c.json({ request: store.addCustomerRequest(b) }, 201);
  });
  app.patch('/api/customer-requests/:id', async (c) => { store.updateCustomerRequest(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/customer-requests/:id', (c) => { store.deleteCustomerRequest(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- search ----------
  app.get('/api/search', (c) => c.json(store.search(c.req.query('q') ?? '')));

  // ---------- workspace ----------
  app.patch('/api/workspace', async (c) => {
    const b = await c.req.json();
    if (b.name) store.setWorkspaceName(b.name);
    // "Set as me" is a single-user convenience; hosted, you are whoever signed in
    if (b.currentUserId && !hosted) store.setCurrentUser(b.currentUserId);
    if ('handoffPromptTemplate' in b) store.setHandoffTemplate(b.handoffPromptTemplate ?? null);
    if ('terminalApp' in b) store.setAgentConfig({ terminalApp: b.terminalApp });
    return c.json({ ok: true });
  });

  // ---------- data ----------
  app.get('/api/export', (c) => {
    const json = store.exportJson();
    return c.body(json, 200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="baseline-export.json"' });
  });
  app.post('/api/import', async (c) => {
    const b = await c.req.json();
    if (!b?.json) return c.json({ error: 'missing json payload' }, 400);
    try {
      store.importJson(b.json);
      // an export from before images moved into the database still points at the old folder
      files.migrateLegacy();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });
  app.post('/api/seed', async (c) => {
    if (hosted) return c.json({ error: 'Sample data can\'t replace a hosted workspace', code: 'forbidden' }, 403);
    const b = await c.req.json().catch(() => ({}));
    if (b.into) {
      // onboarding's "Load sample data": once per workspace, alongside what you already set up
      if (getMeta(db, 'seededAt')) return c.json({ ok: true, already: true });
      seedWorkspace(db, { into: true });
      if (store.getFeatures().githubEnabled) git.ensureInReview();
    } else seedWorkspace(db, { workspaceName: b.workspaceName });
    return c.json({ ok: true });
  });

  // ---------- static SPA ----------
  app.get('*', (c) => {
    const url = new URL(c.req.url);
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = resolve(WEB_DIST, '.' + rel);
    if (filePath.startsWith(WEB_DIST) && existsSync(filePath)) {
      const ext = filePath.split('.').pop() ?? '';
      const types: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', json: 'application/json', woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', ico: 'image/x-icon', map: 'application/json' };
      return c.body(readFileSync(filePath), 200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
    }
    return c.body(readFileSync(join(WEB_DIST, 'index.html')), 200, { 'Content-Type': 'text/html' });
  });

  return { app, store, db, accounts, changes, files, setup };
}

export function serve(opts: ServeOptions = {}): { server: ServerType; port: number } {
  const dbPath = resolveDbPath(opts.dbPath);
  const port = opts.port ?? Number(process.env.BASELINE_PORT ?? 7770);
  const auth = authConfigFromEnv();
  // A container publishes its port, so a request from the network arrives looking like this machine's
  // own: local mode there would let anyone who can reach the port act as any user. The image sets this.
  if (auth.mode === 'local' && process.env.BASELINE_REQUIRE_SIGN_IN?.trim() === '1') {
    throw new Error('BASELINE_REQUIRE_SIGN_IN=1 but no sign-in is configured: set BASELINE_PUBLIC_URL (password sign-in; Google is optional), '
      + 'or set BASELINE_REQUIRE_SIGN_IN=0 to run without sign-in (anyone who can reach the port can act as any user)');
  }
  // the browser is where a new workspace gets set up, so a new database starts blank (--seed: sample data)
  const { app, store, changes, accounts, setup } = createApp(dbPath, auth, mailerFromEnv(), { blank: !opts.seedIfEmpty });
  // only the server watches the clock and the file: the CLI uses createApp too, and must exit
  changes.start();
  startScheduler(store, changes);
  // loopback by default: IPv4 and IPv6 each get a listener, since `localhost` may resolve to either
  const server = nodeServe({ fetch: app.fetch, port, hostname: LISTEN_HOST || '127.0.0.1' });
  if (!LISTEN_HOST) {
    const v6 = nodeServe({ fetch: app.fetch, port, hostname: '::1' });
    v6.on('error', () => { /* no IPv6 loopback on this machine; IPv4 alone is fine */ });
  }
  server.once('listening', () => {
    const url = `http://localhost:${port}`;
    console.log(`[baseline] serving on ${url}  (db: ${dbPath})`);
    if (auth.mode === 'hosted') {
      console.log(`[baseline] hosted mode at ${auth.publicUrl.origin}: sign in with ${signInMethods(auth).join(' or ')}`);
      if (accounts.needsSetup()) {
        console.log(`[baseline] first run: open ${auth.publicUrl.origin} and create the owner account with this setup token:\n\n    ${setup.ensure()}\n\n[baseline] (\`baseline setup-token\` prints it again)`);
      }
    }
    if (opts.open) exec(`open ${url}`);
  });
  return { server, port };
}

// runnable directly: node dist/server/index.js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const open = process.argv.includes('--open');
  serve({ open });
}

// keep types referenced
export type { Priority, Snapshot };
void existsSync;
