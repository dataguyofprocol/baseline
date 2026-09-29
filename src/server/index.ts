import { Hono, type Context, type Next } from 'hono';
import { serve as nodeServe, type ServerType } from '@hono/node-server';
import { openDb, resolveDbPath } from '../core/db.js';
import { normalizeDir, Store } from '../core/store.js';
import { seedWorkspace } from '../core/seed.js';
import { isDirectory, LaunchError, openInClaudeCode, pickDirectories } from './launch.js';
import type { Priority, Snapshot, WorkflowStateType, RelationType } from '../core/types.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

export function createApp(dbPath: string) {
  const db = openDb(dbPath);
  const store = new Store(db);

  // seed on first run
  const hasWorkspace = db.prepare('SELECT COUNT(*) AS n FROM meta').get() as { n: number };
  if (Number(hasWorkspace.n) === 0) {
    seedWorkspace(db);
    console.error('[baseline] seeded a sample workspace — run `baseline seed --reset` to reseed');
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

  // ---------- bootstrap ----------
  app.get('/api/bootstrap', (c) => {
    const snap = store.snapshot();
    snap.workspace.homeDir = homedir();
    return c.json(snap);
  });

  // ---------- issues ----------
  app.post('/api/issues', async (c) => {
    const b = await c.req.json();
    const issue = store.createIssue({
      teamId: b.teamId, title: b.title, description: b.description, stateId: b.stateId,
      priority: b.priority, assigneeId: b.assigneeId ?? null, projectId: b.projectId ?? null,
      parentId: b.parentId ?? null, cycleId: b.cycleId ?? null, labelIds: b.labelIds,
      dueDate: b.dueDate ?? null, estimate: b.estimate ?? null,
      // omitted = a sub-issue inherits its parent's (nothing else is defaulted); null = explicitly none
      ...('locationId' in b ? { locationId: b.locationId } : {}),
    });
    return c.json({ issue }, 201);
  });
  app.patch('/api/issues/:id', async (c) => {
    const b = await c.req.json();
    const issue = store.updateIssue(c.req.param('id'), b);
    if (!issue) return c.json({ error: 'not found' }, 404);
    return c.json({ issue });
  });
  app.get('/api/issues/:id', (c) => {
    const issue = store.getIssue(c.req.param('id'));
    return issue ? c.json({ issue }) : c.json({ error: 'not found' }, 404);
  });
  app.delete('/api/issues/:id', (c) => { store.deleteIssue(c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/issues/:id/restore', (c) => { store.restoreIssue(c.req.param('id')); return c.json({ ok: true }); });
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
      return c.json({ error: 'Launching Claude Code is only allowed from this machine', code: 'forbidden' }, 403);
    }
    await next();
  };
  app.use('/api/issues/:id/open-claude', localOnly);
  app.use('/api/directories/*', localOnly);
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
    const comment = store.addComment(c.req.param('id'), b.userId ?? store.workspaceMeta().currentUser, b.body);
    return c.json({ comment }, 201);
  });
  app.patch('/api/comments/:id', async (c) => {
    const b = await c.req.json();
    if (b.reaction) { store.toggleReaction(c.req.param('id'), b.reaction, b.userId ?? store.workspaceMeta().currentUser); return c.json({ ok: true }); }
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
    const update = store.addProjectUpdate(c.req.param('id'), b.userId ?? store.workspaceMeta().currentUser, b.body, b.health);
    return c.json({ update }, 201);
  });
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
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });
  app.post('/api/seed', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    seedWorkspace(db, { workspaceName: b.workspaceName });
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

  return { app, store, db };
}

export function serve(opts: ServeOptions = {}): { server: ServerType; port: number } {
  const dbPath = resolveDbPath(opts.dbPath);
  const port = opts.port ?? Number(process.env.BASELINE_PORT ?? 7770);
  const { app } = createApp(dbPath);
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
