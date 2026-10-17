import { Hono, type Context, type Next } from 'hono';
import { serve as nodeServe, type ServerType } from '@hono/node-server';
import { getMeta, openDb, resolveDbPath } from '../core/db.js';
import { normalizeDir, Store } from '../core/store.js';
import { blankWorkspace, seedWorkspace } from '../core/seed.js';
import { installedTerminals, isDirectory, LaunchError, openInClaudeCode, pickDirectories } from './launch.js';
import { API_KEY_SCOPES, type ApiKey, type FileOwnerType, type Priority, type Snapshot, type WorkflowStateType, type RelationType } from '../core/types.js';
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
const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
const LAN_OPEN = !!LISTEN_HOST && !isLoopback(LISTEN_HOST);
// the node adapter builds the request URL from the Host header, so this is the Host the client sent
const hostOf = (c: Context) => { try { return new URL(c.req.url).hostname; } catch { return ''; } };
const originHostOf = (c: Context): string | null => {
  const origin = c.req.header('origin');
  if (!origin) return null;
  try { return new URL(origin).hostname; } catch { return '?'; }
};

/** `blank`: a new database starts empty for the web app's first-run flow instead of seeded */
export function createApp(dbPath: string, opts: { blank?: boolean } = {}) {
  const db = openDb(dbPath);
  const store = new Store(db);
  const { planning, automation, git, apiKeys } = store.ext;
  // images (avatars, emoji, pasted pictures) live in the database; pick up any from the old uploads folder
  const files = new FileService(db, join(dirname(dbPath), 'attachments'));
  const moved = files.migrateLegacy();
  if (moved) console.error(`[baseline] moved ${moved} upload(s) into the database`);
  // Loops' "Open in Claude Code" action opens the same interactive session as the manual hand-off
  automation.launcher = async (issueId: string) => { openInClaudeCode(store, dbPath, issueId, {}); };
  // the git integration polls gh / git log every two minutes while it's on
  setInterval(() => { if (store.getFeatures().githubEnabled) void git.sync().catch(() => {}); }, 120_000).unref();

  // seed on first run
  const hasWorkspace = db.prepare('SELECT COUNT(*) AS n FROM meta').get() as { n: number };
  if (Number(hasWorkspace.n) === 0) {
    if (opts.blank) blankWorkspace(db);
    else {
      seedWorkspace(db);
      console.error('[baseline] seeded a sample workspace — run `baseline seed --reset` to reseed');
    }
  }

  const app = new Hono();

  // The tracker is this machine's own: a Host that isn't loopback means a LAN client or a
  // DNS-rebinding page, and a write whose Origin is another site is a cross-site request.
  app.use('/api/*', async (c, next) => {
    const host = hostOf(c);
    if (!LAN_OPEN && !isLoopback(host)) return c.json({ error: 'Baseline only accepts requests from this machine (set BASELINE_HOST to change that)', code: 'forbidden' }, 403);
    const originHost = originHostOf(c);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && originHost !== null && !isLoopback(originHost) && originHost !== host.replace(/^\[|\]$/g, '')) {
      return c.json({ error: 'Cross-site requests are not allowed', code: 'forbidden' }, 403);
    }
    await next();
  });

  // Personal API keys: a request may carry `Authorization: Bearer <key>` (or the bare key, as
  // Linear accepts). A bad key is refused; a good one acts as its owner, within its permissions
  // and teams. Requests without a key are the app's own, unless other devices must use one.
  const keyOf = new WeakMap<Request, ApiKey>();
  const actor = (c: Context) => keyOf.get(c.req.raw)?.userId ?? store.workspaceMeta().currentUser;
  /** the app may act as anyone (agents, other members); a key always acts as its owner */
  const who = (c: Context, given: unknown) => keyOf.has(c.req.raw) || typeof given !== 'string' ? actor(c) : given;
  const isAdmin = (userId: string) => !!(db.prepare('SELECT admin FROM users WHERE id = ?').get(userId) as { admin: number } | undefined)?.admin;
  app.use('/api/*', async (c, next) => {
    const auth = c.req.header('authorization')?.trim();
    if (!auth) {
      if (LAN_OPEN && !isLoopback(hostOf(c)) && store.getFeatures().apiKeyRequiredRemote) return c.json({ error: 'Requests from other devices need an API key: send Authorization: Bearer <key>', code: 'unauthorized' }, 401);
      return next();
    }
    const key = apiKeys.verify(auth.replace(/^Bearer\s+/i, ''));
    if (!key) return c.json({ error: 'Invalid API key', code: 'unauthorized' }, 401);
    const path = c.req.path;
    if (path.startsWith('/api/api-keys')) return c.json({ error: 'API keys are managed in Settings › Security & access, not with an API key', code: 'forbidden' }, 403);
    const missing = apiKeys.missingScope(key, c.req.method, path);
    if (missing) return c.json({ error: `This API key doesn't have the “${API_KEY_SCOPES.find(([k]) => k === missing)?.[1]}” permission`, code: 'forbidden' }, 403);
    const body = c.req.method !== 'GET' && c.req.method !== 'HEAD' && (c.req.header('content-type') ?? '').includes('application/json')
      ? await c.req.json().catch(() => null) as Record<string, unknown> | null : null;
    if (!apiKeys.teamAllowed(key, path, body)) return c.json({ error: 'This API key can’t access that team', code: 'forbidden' }, 403);
    keyOf.set(c.req.raw, key);
    await next();
    if (key.teamIds && (c.res.headers.get('content-type') ?? '').includes('application/json')) {
      const scoped = apiKeys.scopeResponse(key, await c.res.json());
      c.res = new Response(JSON.stringify(scoped), { status: (scoped as { error?: string }).error ? 404 : c.res.status, headers: { 'content-type': 'application/json' } });
    }
  });

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

  // ---------- bootstrap ----------
  app.get('/api/bootstrap', (c) => {
    store.tick();
    const snap = store.snapshot();
    snap.workspace.homeDir = homedir();
    if (LAN_OPEN) snap.workspace.lanHost = LISTEN_HOST;
    return c.json(snap);
  });

  // ---------- issues ----------
  app.post('/api/issues', async (c) => {
    const b = await c.req.json();
    const issue = store.createIssue({
      teamId: b.teamId, title: b.title, description: b.description, stateId: b.stateId,
      priority: b.priority, assigneeId: b.assigneeId ?? null, projectId: b.projectId ?? null,
      parentId: b.parentId ?? null, cycleId: b.cycleId ?? null, labelIds: b.labelIds,
      dueDate: b.dueDate ?? null, estimate: b.estimate ?? null, milestoneId: b.milestoneId ?? null,
      // omitted = a sub-issue inherits its parent's (nothing else is defaulted); null = explicitly none
      ...('locationId' in b ? { locationId: b.locationId } : {}),
    }, keyOf.has(c.req.raw) || typeof b.actorId === 'string' ? who(c, b.actorId) : undefined);
    return c.json({ issue }, 201);
  });
  app.patch('/api/issues/:id', async (c) => {
    const b = await c.req.json();
    const issue = store.updateIssue(c.req.param('id'), b, keyOf.has(c.req.raw) ? actor(c) : undefined);
    if (!issue) return c.json({ error: 'not found' }, 404);
    return c.json({ issue });
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
    const uid = who(c, b.userId);
    if (b.subscribed === false) store.unsubscribe(c.req.param('id'), uid);
    else store.subscribe(c.req.param('id'), uid);
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
    const handoff = store.handoffFor(c.req.param('id'));
    return handoff ? c.json({ handoff }) : c.json({ error: 'not found' }, 404);
  });
  // these routes start local processes (a terminal, a folder picker): only this machine's own
  // pages may call them — a Host other than localhost means LAN or DNS rebinding, a foreign
  // Origin means another site, and a non-JSON body means a CORS-free "simple" form post
  // (these stay loopback-only even when BASELINE_HOST opens the rest to the LAN)
  const localOnly = async (c: Context, next: Next) => {
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
  app.get('/api/terminals', (c) => c.json({ installed: installedTerminals() }));
  app.post('/api/directories/check', async (c) => {
    const b = await c.req.json() as { directory?: string };
    return c.json({ exists: isDirectory(normalizeDir(b.directory)) });
  });

  // ---------- locations (directories agents work in) ----------
  app.post('/api/locations', async (c) => {
    const b = await c.req.json() as { path?: string; name?: string };
    const path = normalizeDir(b.path);
    if (!isDirectory(path)) return c.json({ error: `Directory not found: ${path || '(empty)'}` }, 400);
    return c.json({ location: store.createLocation(path, b.name) }, 201);
  });
  app.patch('/api/locations/:id', async (c) => {
    const b = await c.req.json() as { name?: string };
    try { if (b.name) store.renameLocation(c.req.param('id'), b.name); } catch (err) { return c.json({ error: (err as Error).message }, 400); }
    return c.json({ ok: true });
  });
  app.delete('/api/locations/:id', (c) => { store.deleteLocation(c.req.param('id')); return c.json({ ok: true }); });

  // ---------- comments ----------
  app.post('/api/issues/:id/comments', async (c) => {
    const b = await c.req.json();
    const comment = store.addComment(c.req.param('id'), who(c, b.userId), b.body, b.parentId ?? null);
    return c.json({ comment }, 201);
  });
  app.patch('/api/comments/:id', async (c) => {
    const b = await c.req.json();
    if (b.reaction) { store.toggleReaction(c.req.param('id'), b.reaction, who(c, b.userId)); return c.json({ ok: true }); }
    if ('resolved' in b) { store.resolveComment(c.req.param('id'), !!b.resolved); return c.json({ ok: true }); }
    store.updateComment(c.req.param('id'), b.body);
    return c.json({ ok: true });
  });
  app.delete('/api/comments/:id', (c) => { store.deleteComment(c.req.param('id')); return c.json({ ok: true }); });

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
    const update = store.addProjectUpdate(c.req.param('id'), who(c, b.userId), b.body, b.health);
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
  app.patch('/api/docs/:id', async (c) => { const b = await c.req.json(); store.updateDoc(c.req.param('id'), b, keyOf.has(c.req.raw) || typeof b.actorId === 'string' ? who(c, b.actorId) : undefined); return c.json({ ok: true }); });
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
    const b = await c.req.json();
    store.updateUser(c.req.param('id'), b);
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
  app.patch('/api/views/:id', async (c) => {
    const b = await c.req.json();
    store.updateView(c.req.param('id'), b);
    return c.json({ ok: true });
  });
  app.delete('/api/views/:id', (c) => { store.deleteView(c.req.param('id')); return c.json({ ok: true }); });
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
    if (b.githubEnabled === true) { git.ensureInReview(); void git.sync().catch(() => {}); }
    return c.json({ ok: true });
  });

  // ---------- initiatives ----------
  app.post('/api/initiatives', async (c) => { const b = await c.req.json(); if (!b.name) return c.json({ error: 'name is required' }, 400); return c.json({ initiative: planning.createInitiative(b) }, 201); });
  app.patch('/api/initiatives/:id', async (c) => { planning.updateInitiative(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  app.delete('/api/initiatives/:id', (c) => { planning.deleteInitiative(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/initiatives/:id/projects', async (c) => { const b = await c.req.json(); planning.addProject(c.req.param('id'), b.projectId); return c.json({ ok: true }, 201); });
  app.delete('/api/initiatives/:id/projects/:projectId', (c) => { planning.removeProject(c.req.param('id'), c.req.param('projectId')); return c.json({ ok: true }); });
  app.post('/api/initiatives/:id/updates', async (c) => { const b = await c.req.json(); if (!b.body) return c.json({ error: 'body is required' }, 400); return c.json({ update: planning.addInitiativeUpdate(c.req.param('id'), who(c, b.userId), b.body, b.health) }, 201); });

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
  app.post('/api/git/sync', async (c) => c.json(await git.sync()));
  app.get('/api/git/automation/:teamId', (c) => c.json(git.automation(c.req.param('teamId'))));
  app.put('/api/git/automation/:teamId', async (c) => { git.setAutomation(c.req.param('teamId'), await c.req.json()); return c.json({ ok: true }); });
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
    if (b.currentUserId) store.setCurrentUser(b.currentUserId);
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

  return { app, store, db, files };
}

export function serve(opts: ServeOptions = {}): { server: ServerType; port: number } {
  const dbPath = resolveDbPath(opts.dbPath);
  const port = opts.port ?? Number(process.env.BASELINE_PORT ?? 7770);
  // the browser is where a new workspace gets set up, so a new database starts blank (--seed: sample data)
  const { app } = createApp(dbPath, { blank: !opts.seedIfEmpty });
  // loopback by default: IPv4 and IPv6 each get a listener, since `localhost` may resolve to either
  const server = nodeServe({ fetch: app.fetch, port, hostname: LISTEN_HOST || '127.0.0.1' });
  if (!LISTEN_HOST) {
    const v6 = nodeServe({ fetch: app.fetch, port, hostname: '::1' });
    v6.on('error', () => { /* no IPv6 loopback on this machine — IPv4 alone is fine */ });
  }
  server.once('listening', () => {
    const url = `http://localhost:${port}`;
    console.log(`[baseline] serving on ${url}  (db: ${dbPath})`);
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
