// Sign-in for a hosted Baseline: Google OAuth (authorization code + PKCE) and cookie sessions.
// With no Google client configured the server stays in local mode: this machine only, no sign-in.
import type { Context, Hono, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { actingUser } from '../core/actor.js';
import type { Accounts, GoogleIdentity } from '../core/accounts.js';

export type AuthConfig =
  | { mode: 'local' }
  | { mode: 'google'; publicUrl: URL; clientId: string; clientSecret: string; ownerEmail: string };

/** Google mode needs all three of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and BASELINE_PUBLIC_URL —
 *  a half-configured server refuses to start rather than run open. */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) return { mode: 'local' };
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const publicUrl = env.BASELINE_PUBLIC_URL?.trim();
  if (!clientSecret || !publicUrl) throw new Error('GOOGLE_CLIENT_ID is set, so GOOGLE_CLIENT_SECRET and BASELINE_PUBLIC_URL are required too');
  return { mode: 'google', publicUrl: new URL(publicUrl), clientId, clientSecret, ownerEmail: env.BASELINE_OWNER_EMAIL?.trim() ?? '' };
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const random = () => b64url(randomBytes(32));

/** Registers the /api/* guard and the sign-in routes. Call it before any other /api route:
 *  Hono runs handlers in registration order, so a route added earlier would skip the guard. */
export function mountAuth(app: Hono, cfg: AuthConfig & { mode: 'google' }, accounts: Accounts): void {
  const secure = cfg.publicUrl.protocol === 'https:';
  // __Host- pins the cookie to this exact host over HTTPS (no Domain, Path=/); plain http is for local testing
  const SESSION_COOKIE = secure ? '__Host-baseline_session' : 'baseline_session';
  const OAUTH_COOKIE = 'baseline_oauth';
  const redirectUri = new URL('/auth/google/callback', cfg.publicUrl).toString();
  const home = (query = '') => new URL(`/${query}`, cfg.publicUrl).toString();

  const setSession = (c: Context, token: string, expiresAt: string) =>
    setCookie(c, SESSION_COOKIE, token, { path: '/', httpOnly: true, secure, sameSite: 'Lax', expires: new Date(expiresAt) });

  // every /api request: same host, same-origin writes, a live session — then run it as that person
  app.use('/api/*', async (c: Context, next: Next) => {
    // DNS rebinding: the browser must have addressed this server by its public name
    if (new URL(c.req.url).hostname !== cfg.publicUrl.hostname) return c.json({ error: 'Unknown host', code: 'forbidden' }, 403);
    // CSRF: browsers send Origin on every non-GET fetch; a write without ours is cross-site (or not a browser)
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('origin') !== cfg.publicUrl.origin) {
      return c.json({ error: 'Cross-site requests are not allowed', code: 'forbidden' }, 403);
    }
    const token = getCookie(c, SESSION_COOKIE);
    const session = accounts.resolveSession(token);
    if (!session) return c.json({ error: 'Sign in to continue', code: 'unauthenticated' }, 401);
    if (session.renewed) setSession(c, token!, session.expiresAt);
    await actingUser.run(session.userId, next);
  });

  app.get('/auth/google', (c) => {
    const next = c.req.query('next') ?? '/';
    const state = random(), verifier = random(), nonce = random();
    setCookie(c, OAUTH_COOKIE, b64url(Buffer.from(JSON.stringify({ state, verifier, nonce, next }))), {
      path: '/auth', httpOnly: true, secure, sameSite: 'Lax', maxAge: 600,
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: cfg.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return c.redirect(url.toString());
  });

  app.get('/auth/google/callback', async (c) => {
    const fail = (reason: string) => { deleteCookie(c, OAUTH_COOKIE, { path: '/auth' }); return c.redirect(home(`?auth_error=${reason}`)); };
    let saved: { state: string; verifier: string; nonce: string; next: string };
    try { saved = JSON.parse(Buffer.from(getCookie(c, OAUTH_COOKIE) ?? '', 'base64url').toString()); } catch { return fail('expired'); }
    if (c.req.query('error')) return fail('cancelled');
    const code = c.req.query('code');
    if (!code || !saved?.state || c.req.query('state') !== saved.state) return fail('expired');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier }),
    }).catch(() => null);
    if (!res?.ok) return fail('google');
    const { id_token } = await res.json() as { id_token?: string };
    // the token came straight from Google's token endpoint over TLS, so its claims can be read
    // without checking the signature (OpenID Connect Core §3.1.3.7) — the rest still needs checking
    let claims: { iss?: string; aud?: string; exp?: number; nonce?: string; sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
    try { claims = JSON.parse(Buffer.from(id_token!.split('.')[1]!, 'base64url').toString()); } catch { return fail('google'); }
    const valid = (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com')
      && claims.aud === cfg.clientId && (claims.exp ?? 0) * 1000 > Date.now() && claims.nonce === saved.nonce
      && !!claims.sub && !!claims.email && claims.email_verified === true;
    if (!valid) return fail('google');

    const identity: GoogleIdentity = { sub: claims.sub!, email: claims.email!, name: claims.name ?? '', picture: claims.picture ?? '' };
    const result = accounts.signInWithGoogle(identity, cfg.ownerEmail);
    if ('error' in result) return fail(result.error);
    const session = accounts.createSession(result.userId, { userAgent: c.req.header('user-agent'), ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() });
    setSession(c, session.token, session.expiresAt);
    deleteCookie(c, OAUTH_COOKIE, { path: '/auth' });
    // only same-site paths: an absolute or protocol-relative `next` would make this an open redirect
    const next = saved.next.startsWith('/') && !saved.next.startsWith('//') ? saved.next : '/';
    return c.redirect(new URL(next, cfg.publicUrl).toString());
  });

  // signing out is a write, so it sits behind requireSession's same-origin check
  app.post('/api/auth/logout', (c) => {
    accounts.deleteSession(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure });
    return c.json({ ok: true });
  });

}
