// Sign-in for a hosted Baseline: email and password always, Google OAuth (authorization code +
// PKCE) when a client is configured, and the cookie sessions both lead to.
// Without BASELINE_PUBLIC_URL the server stays in local mode: this machine only, no sign-in.
import type { Context, Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHash, randomBytes } from 'node:crypto';
import type { Accounts, GoogleIdentity } from '../core/accounts.js';
import type { Store } from '../core/store.js';
import type { SignInMethod } from '../core/types.js';
import type { Mailer } from './mail.js';
import { mountPasswordAuth } from './password-auth.js';
import type { SetupToken } from './setup.js';
import { clientIp, limiter } from './ratelimit.js';

export interface GoogleClient { clientId: string; clientSecret: string }

export type AuthConfig =
  | { mode: 'local' }
  | { mode: 'hosted'; publicUrl: URL; google: GoogleClient | null; ownerEmail: string };
export type HostedAuth = Extract<AuthConfig, { mode: 'hosted' }>;

export const signInMethods = (cfg: HostedAuth): SignInMethod[] => cfg.google ? ['password', 'google'] : ['password'];

/** BASELINE_PUBLIC_URL makes a server hosted. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET add Google
 *  sign-in; a half-configured Google client refuses to start rather than run without it. */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const rawUrl = env.BASELINE_PUBLIC_URL?.trim();
  if (clientId && !clientSecret) throw new Error('GOOGLE_CLIENT_ID is set, so GOOGLE_CLIENT_SECRET is required too');
  if (clientSecret && !clientId) throw new Error('GOOGLE_CLIENT_SECRET is set, so GOOGLE_CLIENT_ID is required too');
  if (!rawUrl) {
    if (clientId) throw new Error('GOOGLE_CLIENT_ID is set, so BASELINE_PUBLIC_URL is required too');
    return { mode: 'local' };
  }
  let publicUrl: URL;
  try { publicUrl = new URL(rawUrl); } catch { throw new Error(`BASELINE_PUBLIC_URL isn't a URL: ${rawUrl}`); }
  if (publicUrl.protocol !== 'https:' && publicUrl.protocol !== 'http:') throw new Error(`BASELINE_PUBLIC_URL must be http(s): ${rawUrl}`);
  return {
    mode: 'hosted', publicUrl, ownerEmail: env.BASELINE_OWNER_EMAIL?.trim() ?? '',
    google: clientId && clientSecret ? { clientId, clientSecret } : null,
  };
}

/** Only same-site paths: an absolute or protocol-relative `next` would make sign-in an open
 *  redirect, and browsers read a backslash as a slash (`/\\evil.example` is `//evil.example`). */
export const safeNext = (next: unknown): string =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/[\u0000-\u001f]/.test(next) ? next : '/';

const b64url = (buf: Buffer) => buf.toString('base64url');
const random = () => b64url(randomBytes(32));

/** The hosted session cookie, read by `authenticate` (principal.ts) and written by sign-in. */
export interface Sessions {
  /** the person behind this request's cookie; re-sets the cookie when the session slid */
  resolve(c: Context): { userId: string } | null;
  set(c: Context, token: string, expiresAt: string): void;
  /** a new session for this person, cookie included (every way of signing in ends here) */
  start(c: Context, userId: string): void;
  end(c: Context): void;
}

export function cookieSessions(cfg: HostedAuth, accounts: Accounts): Sessions {
  const secure = cfg.publicUrl.protocol === 'https:';
  // __Host- pins the cookie to this exact host over HTTPS (no Domain, Path=/); plain http is for local testing
  const name = secure ? '__Host-baseline_session' : 'baseline_session';
  const set = (c: Context, token: string, expiresAt: string) =>
    setCookie(c, name, token, { path: '/', httpOnly: true, secure, sameSite: 'Lax', expires: new Date(expiresAt) });
  return {
    resolve(c) {
      const token = getCookie(c, name);
      const session = accounts.resolveSession(token);
      if (!session) return null;
      if (session.renewed) set(c, token!, session.expiresAt);
      return { userId: session.userId };
    },
    set,
    start(c, userId) {
      const session = accounts.createSession(userId, { userAgent: c.req.header('user-agent'), ip: clientIp(c) });
      set(c, session.token, session.expiresAt);
    },
    end(c) {
      accounts.deleteSession(getCookie(c, name));
      deleteCookie(c, name, { path: '/', secure });
    },
  };
}

/** The sign-in routes. The /api/* guard is `authenticate` (principal.ts), registered before these. */
export function mountAuth(app: Hono, cfg: HostedAuth, d: { accounts: Accounts; store: Store; sessions: Sessions; mailer: Mailer; setup: SetupToken }, hooks: {
  /** someone joined through an invite — tell whoever sent it */
  onInviteAccepted?: (userId: string, invitedBy: string) => void;
} = {}): void {
  const { accounts, store } = d;
  const inviteLookupLimit = limiter(60, 10 * 60_000);

  // what the sign-in screen offers, before anyone is signed in
  app.get('/auth/config', (c) => c.json({ methods: signInMethods(cfg), setup: accounts.needsSetup(), mail: d.mailer.configured }));

  // what an invite link shows before sign-in: whose workspace, who sent it, and to which address
  // (masked — the code is in an email, but links get forwarded)
  app.get('/auth/invite/:code', (c) => {
    if (!inviteLookupLimit.take(clientIp(c))) return c.json({ state: 'unknown', error: 'Too many requests — try again in a few minutes' }, 429);
    const inv = accounts.inviteByCode(c.req.param('code'));
    if (!inv) return c.json({ state: 'unknown' }, 404);
    const inviter = inv.invited_by ? store.snapshot().users.find(u => u.id === inv.invited_by) : undefined;
    const [local = '', domain = ''] = inv.email.split('@');
    const state = inv.accepted_at ? 'accepted' : inv.revoked_at ? 'revoked' : Date.parse(inv.expires_at) <= Date.now() ? 'expired' : 'valid';
    return c.json({ state, workspace: store.workspaceMeta().name, inviter: inviter?.name ?? null, email: `${local.slice(0, 2)}•••@${domain}` });
  });

  mountPasswordAuth(app, cfg, d, hooks);
  if (cfg.google) mountGoogle(app, cfg, cfg.google, d, hooks);
  else {
    // without this the SPA fallback would answer with the app's index page
    const off = (c: Context) => c.json({ error: 'Google sign-in isn\'t set up on this server', code: 'google-off' }, 404);
    app.get('/auth/google', off);
    app.get('/auth/google/callback', off);
  }

  // signing out is a write, so it sits behind authenticate's same-origin check
  app.post('/api/auth/logout', (c) => {
    d.sessions.end(c);
    return c.json({ ok: true });
  });
}

function mountGoogle(app: Hono, cfg: HostedAuth, google: GoogleClient, d: { accounts: Accounts; sessions: Sessions }, hooks: {
  onInviteAccepted?: (userId: string, invitedBy: string) => void;
}): void {
  const { accounts, sessions } = d;
  const secure = cfg.publicUrl.protocol === 'https:';
  const OAUTH_COOKIE = 'baseline_oauth';
  const redirectUri = new URL('/auth/google/callback', cfg.publicUrl).toString();
  const home = (query = '') => new URL(`/${query}`, cfg.publicUrl).toString();
  // per address: starting or finishing a sign-in
  const signInLimit = limiter(30, 10 * 60_000);

  app.get('/auth/google', (c) => {
    if (!signInLimit.take(clientIp(c))) return c.redirect(home('?auth_error=rate-limited'));
    const next = c.req.query('next') ?? '/';
    const invite = c.req.query('invite') ?? '';
    const state = random(), verifier = random(), nonce = random();
    setCookie(c, OAUTH_COOKIE, b64url(Buffer.from(JSON.stringify({ state, verifier, nonce, next, invite }))), {
      path: '/auth', httpOnly: true, secure, sameSite: 'Lax', maxAge: 600,
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return c.redirect(url.toString());
  });

  app.get('/auth/google/callback', async (c) => {
    const fail = (reason: string) => { deleteCookie(c, OAUTH_COOKIE, { path: '/auth' }); return c.redirect(home(`?auth_error=${reason}`)); };
    if (!signInLimit.take(clientIp(c))) return fail('rate-limited');
    let saved: { state: string; verifier: string; nonce: string; next: string; invite?: string };
    try { saved = JSON.parse(Buffer.from(getCookie(c, OAUTH_COOKIE) ?? '', 'base64url').toString()); } catch { return fail('expired'); }
    if (c.req.query('error')) return fail('cancelled');
    const code = c.req.query('code');
    if (!code || !saved?.state || c.req.query('state') !== saved.state) return fail('expired');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier }),
    }).catch(() => null);
    if (!res?.ok) return fail('google');
    const { id_token } = await res.json() as { id_token?: string };
    // the token came straight from Google's token endpoint over TLS, so its claims can be read
    // without checking the signature (OpenID Connect Core §3.1.3.7) — the rest still needs checking
    let claims: { iss?: string; aud?: string; exp?: number; nonce?: string; sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string; hd?: string };
    try { claims = JSON.parse(Buffer.from(id_token!.split('.')[1]!, 'base64url').toString()); } catch { return fail('google'); }
    const valid = (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com')
      && claims.aud === google.clientId && (claims.exp ?? 0) * 1000 > Date.now() && claims.nonce === saved.nonce
      && !!claims.sub && !!claims.email && claims.email_verified === true;
    if (!valid) return fail('google');

    const identity: GoogleIdentity = { sub: claims.sub!, email: claims.email!, name: claims.name ?? '', picture: claims.picture ?? '', hd: claims.hd };
    const result = accounts.signInWithGoogle(identity, { ownerEmail: cfg.ownerEmail, inviteCode: saved.invite || undefined });
    if ('error' in result) return fail(result.error);
    if (result.joined === 'invite' && result.invitedBy) hooks.onInviteAccepted?.(result.userId, result.invitedBy);
    sessions.start(c, result.userId);
    deleteCookie(c, OAUTH_COOKIE, { path: '/auth' });
    return c.redirect(new URL(safeNext(saved.next), cfg.publicUrl).toString());
  });
}
