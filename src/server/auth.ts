// Sign-in for a hosted Baseline: Google OAuth (authorization code + PKCE) and cookie sessions.
// With no Google client configured the server stays in local mode: this machine only, no sign-in.
import type { Context, Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHash, randomBytes } from 'node:crypto';
import type { Accounts, GoogleIdentity } from '../core/accounts.js';
import type { Store } from '../core/store.js';
import { clientIp, limiter } from './ratelimit.js';

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

/** The hosted session cookie, read by `authenticate` (principal.ts) and written by sign-in. */
export interface Sessions {
  /** the person behind this request's cookie; re-sets the cookie when the session slid */
  resolve(c: Context): { userId: string } | null;
  set(c: Context, token: string, expiresAt: string): void;
  end(c: Context): void;
}

export function cookieSessions(cfg: AuthConfig & { mode: 'google' }, accounts: Accounts): Sessions {
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
    end(c) {
      accounts.deleteSession(getCookie(c, name));
      deleteCookie(c, name, { path: '/', secure });
    },
  };
}

/** The sign-in routes. The /api/* guard is `authenticate` (principal.ts), registered before these. */
export function mountAuth(app: Hono, cfg: AuthConfig & { mode: 'google' }, accounts: Accounts, store: Store, sessions: Sessions, hooks: {
  /** someone joined through an invite — tell whoever sent it */
  onInviteAccepted?: (userId: string, invitedBy: string) => void;
} = {}): void {
  const secure = cfg.publicUrl.protocol === 'https:';
  const OAUTH_COOKIE = 'baseline_oauth';
  const redirectUri = new URL('/auth/google/callback', cfg.publicUrl).toString();
  const home = (query = '') => new URL(`/${query}`, cfg.publicUrl).toString();

  // per address: starting or finishing a sign-in, and looking up invite links (codes are random,
  // but there's no reason to let anyone try them by the thousand)
  const signInLimit = limiter(30, 10 * 60_000);
  const inviteLookupLimit = limiter(60, 10 * 60_000);

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
      client_id: cfg.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
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
      body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier }),
    }).catch(() => null);
    if (!res?.ok) return fail('google');
    const { id_token } = await res.json() as { id_token?: string };
    // the token came straight from Google's token endpoint over TLS, so its claims can be read
    // without checking the signature (OpenID Connect Core §3.1.3.7) — the rest still needs checking
    let claims: { iss?: string; aud?: string; exp?: number; nonce?: string; sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string; hd?: string };
    try { claims = JSON.parse(Buffer.from(id_token!.split('.')[1]!, 'base64url').toString()); } catch { return fail('google'); }
    const valid = (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com')
      && claims.aud === cfg.clientId && (claims.exp ?? 0) * 1000 > Date.now() && claims.nonce === saved.nonce
      && !!claims.sub && !!claims.email && claims.email_verified === true;
    if (!valid) return fail('google');

    const identity: GoogleIdentity = { sub: claims.sub!, email: claims.email!, name: claims.name ?? '', picture: claims.picture ?? '', hd: claims.hd };
    const result = accounts.signInWithGoogle(identity, { ownerEmail: cfg.ownerEmail, inviteCode: saved.invite || undefined });
    if ('error' in result) return fail(result.error);
    if (result.joined === 'invite' && result.invitedBy) hooks.onInviteAccepted?.(result.userId, result.invitedBy);
    const session = accounts.createSession(result.userId, { userAgent: c.req.header('user-agent'), ip: clientIp(c) });
    sessions.set(c, session.token, session.expiresAt);
    deleteCookie(c, OAUTH_COOKIE, { path: '/auth' });
    // only same-site paths: an absolute or protocol-relative `next` would make this an open redirect
    const next = saved.next.startsWith('/') && !saved.next.startsWith('//') ? saved.next : '/';
    return c.redirect(new URL(next, cfg.publicUrl).toString());
  });

  // signing out is a write, so it sits behind authenticate's same-origin check
  app.post('/api/auth/logout', (c) => {
    sessions.end(c);
    return c.json({ ok: true });
  });
}
