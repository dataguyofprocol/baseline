import type { Context, MiddlewareHandler } from 'hono';
import { actingUser, attributionOf, type Attribution } from '../core/actor.js';
import type { ApiKeys } from '../core/apikeys.js';
import type { Store } from '../core/store.js';
import { API_KEY_SCOPES, type ApiKey } from '../core/types.js';
import type { AuthConfig, Sessions } from './auth.js';

export type Principal =
  | { via: 'key'; key: ApiKey; userId: string }
  | { via: 'session'; userId: string }
  | { via: 'local' };

/** A request the server answers with an error. Thrown from a handler, it becomes `{ error, code }`. */
export class Refusal extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404, readonly code: string, message: string) { super(message); }
}

export const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
// the node adapter builds the request URL from the Host header, so this is the Host the client sent
export const hostOf = (c: Context) => { try { return new URL(c.req.url).hostname; } catch { return ''; } };
export const originHostOf = (c: Context): string | null => {
  const origin = c.req.header('origin');
  if (!origin) return null;
  try { return new URL(origin).hostname; } catch { return '?'; }
};
const isRead = (method: string) => method === 'GET' || method === 'HEAD';

const KEYLESS = /^\/api\/(api-keys|cli-auth|me\/password|me\/github|members\/[^/]+\/reset-link)(\/|$)/;
const PUBLISH = /^\/api\/projects\/[^/]+\/update-draft\/publish$/;
const MCP = '/mcp';
const needsKey = (c: Context) => c.json({ error: 'Baseline\'s MCP endpoint needs an API key: send Authorization: Bearer <key> (create one in Settings › Account & API keys)', code: 'unauthorized' }, 401);

const principals = new WeakMap<Request, Principal>();

export function principalOf(c: Context): Principal {
  const p = principals.get(c.req.raw);
  if (!p) throw new Error(`no principal for ${c.req.method} ${c.req.path}: authenticate must run before every /api route`);
  return p;
}

export function principalUser(c: Context, store: Store): string {
  const p = principalOf(c);
  return p.via === 'local' ? store.actor() : p.userId;
}

export function attributedActor(c: Context, requested: unknown, store: Store): Attribution | undefined {
  const p = principalOf(c);
  if (typeof requested !== 'string' || !requested) {
    return p.via === 'key' ? { actor: 'person', actorId: p.userId, viaUserId: null } : undefined;
  }
  const self = p.via === 'local' ? store.actor() : p.userId;
  if (requested === self) return { actor: 'person', actorId: self, viaUserId: null };
  const kind = store.userKind(requested);
  if (p.via === 'local') return attributionOf({ id: requested, kind: kind ?? 'human' }, self);
  if (kind === 'agent') return attributionOf({ id: requested, kind }, self);
  throw new Refusal(403, 'forbidden', 'This server attributes writes to whoever signed in: --as / BASELINE_AS may name an agent (recorded as "<agent> via you"), not another person');
}

export interface AuthenticateDeps {
  auth: AuthConfig;
  sessions: Sessions | null;
  apiKeys: ApiKeys;
  store: Store;
  lanOpen: boolean;
}

/**
 * The /api/* and /mcp guard. Register it before any /api route: Hono runs handlers in registration order.
 * 1. Host: hosted, the public name (DNS rebinding); local, loopback unless opened to the LAN.
 * 2. A bearer key: verified, then scopes, teams and response scoping. No Origin check: a browser
 *    can't attach this header cross-site without a CORS preflight, which this server never grants.
 * 3. Hosted without a key: same-origin writes (CSRF) and a live session cookie.
 * 4. Local without a key: no cross-site writes; the machine's own app.
 */
export function authenticate(d: AuthenticateDeps): MiddlewareHandler {
  const { auth, apiKeys, store } = d;
  const forbid = (c: Context, error: string) => c.json({ error, code: 'forbidden' }, 403);

  const withKey = async (c: Context, next: () => Promise<void>, header: string) => {
    const key = apiKeys.verify(header.replace(/^Bearer\s+/i, ''));
    if (!key) return c.json({ error: 'Invalid API key', code: 'unauthorized' }, 401);
    const path = c.req.path;
    if (KEYLESS.test(path)) return forbid(c, path.startsWith('/api/me/github') ? 'Your GitHub connection is set in the app (Settings › Integrations › GitHub), not with an API key' : 'API keys are managed in Settings › Account & API keys, not with an API key');
    if (PUBLISH.test(path)) return forbid(c, 'A person publishes project updates from the project page in Baseline; an API key can only draft them');
    const missing = apiKeys.missingScope(key, c.req.method, path);
    if (missing) return forbid(c, `This API key doesn't have the “${API_KEY_SCOPES.find(([k]) => k === missing)?.[1]}” permission`);
    if (path === MCP) {
      principals.set(c.req.raw, { via: 'key', key, userId: key.userId });
      return actingUser.run(key.userId, next);
    }
    const body = !isRead(c.req.method) && (c.req.header('content-type') ?? '').includes('application/json')
      ? await c.req.json().catch(() => null) as Record<string, unknown> | null : null;
    if (!apiKeys.teamAllowed(key, path, body)) return forbid(c, 'This API key can’t access that team');
    principals.set(c.req.raw, { via: 'key', key, userId: key.userId });
    await actingUser.run(key.userId, next);
    if (key.teamIds && (c.res.headers.get('content-type') ?? '').includes('application/json')) {
      const scoped = apiKeys.scopeResponse(key, await c.res.json());
      c.res = new Response(JSON.stringify(scoped), { status: (scoped as { error?: string }).error ? 404 : c.res.status, headers: { 'content-type': 'application/json' } });
    }
  };

  return async (c, next) => {
    const host = hostOf(c);
    const header = c.req.header('authorization')?.trim();
    if (auth.mode === 'hosted') {
      if (host !== auth.publicUrl.hostname) return forbid(c, 'Unknown host');
      if (header) return withKey(c, next, header);
      if (c.req.path === MCP) return needsKey(c);
      // CSRF: browsers send Origin on every non-GET fetch; a write without ours is cross-site (or not a browser)
      if (!isRead(c.req.method) && c.req.header('origin') !== auth.publicUrl.origin) return forbid(c, 'Cross-site requests are not allowed');
      const session = d.sessions!.resolve(c);
      if (!session) return c.json({ error: 'Sign in to continue', code: 'unauthenticated' }, 401);
      principals.set(c.req.raw, { via: 'session', userId: session.userId });
      return actingUser.run(session.userId, next);
    }
    if (!d.lanOpen && !isLoopback(host)) return forbid(c, 'Baseline only accepts requests from this machine (set BASELINE_HOST to change that)');
    if (header) return withKey(c, next, header);
    if (c.req.path === MCP) return needsKey(c);
    const originHost = originHostOf(c);
    if (!isRead(c.req.method) && originHost !== null && !isLoopback(originHost) && originHost !== host.replace(/^\[|\]$/g, '')) {
      return forbid(c, 'Cross-site requests are not allowed');
    }
    if (d.lanOpen && !isLoopback(host) && store.getFeatures().apiKeyRequiredRemote) {
      return c.json({ error: 'Requests from other devices need an API key: send Authorization: Bearer <key>', code: 'unauthorized' }, 401);
    }
    principals.set(c.req.raw, { via: 'local' });
    await next();
  };
}
