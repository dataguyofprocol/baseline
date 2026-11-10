// Email and password sign-in on a hosted server: first-run setup, sign-in, joining through an
// invite link, reset links, and changing your own password. Every route that ends signed in goes
// through Sessions.start, the same cookie sessions Google sign-in uses.
import type { Context, Hono } from 'hono';
import { emailProblem, isEmail, normalizeEmail, type Accounts } from '../core/accounts.js';
import { hashPassword, passwordProblem, verifyPassword } from '../core/passwords.js';
import type { Store } from '../core/store.js';
import type { HostedAuth, Sessions } from './auth.js';
import { passwordResetEmail, type Mailer } from './mail.js';
import { principalOf } from './principal.js';
import { clientIp, limiter } from './ratelimit.js';
import type { SetupToken } from './setup.js';

const MIN = 60_000;
/** a forgot-password email is used right away; an admin's link may wait in a chat for a while */
export const RESET_EMAIL_TTL = 60 * MIN;
export const RESET_LINK_TTL = 24 * 60 * MIN;

const NAME_MAX = 80;
const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';

export function mountPasswordAuth(app: Hono, cfg: HostedAuth, d: { accounts: Accounts; store: Store; sessions: Sessions; mailer: Mailer; setup: SetupToken }, hooks: {
  onInviteAccepted?: (userId: string, invitedBy: string) => void;
}): void {
  const { accounts, sessions } = d;
  // per address, across every route here that checks a secret (password, setup token, invite, reset link)
  const ipLimit = limiter(30, 10 * MIN);
  // per account: guessing one person's password from many addresses
  const emailLimit = limiter(10, 15 * MIN);
  const forgotLimit = limiter(3, 60 * MIN);
  const changeLimit = limiter(10, 15 * MIN);
  const lookupLimit = limiter(60, 10 * MIN);

  const tooMany = (c: Context) => c.json({ error: 'Too many sign-in attempts. Try again in a few minutes.', code: 'rate-limited' }, 429);
  const refuse = (c: Context, status: 400 | 401 | 403 | 404 | 409, code: string, error: string) => c.json({ error, code }, status);
  const body = async (c: Context) => await c.req.json().catch(() => ({})) as Record<string, unknown>;
  // these set a session cookie: a cross-site form must not sign a visitor into someone else's account
  const crossSite = (c: Context) => c.req.header('origin') !== cfg.publicUrl.origin;

  app.post('/auth/password', async (c) => {
    if (crossSite(c)) return refuse(c, 403, 'forbidden', 'Cross-site requests are not allowed');
    const b = await body(c);
    const email = normalizeEmail(text(b.email, 320));
    if (!ipLimit.take(clientIp(c)) || !emailLimit.take(email)) return tooMany(c);
    const user = email ? accounts.passwordFor(email) : undefined;
    const matched = await verifyPassword(typeof b.password === 'string' ? b.password : '', user?.hash ?? null);
    const r = accounts.passwordSignIn(user, matched);
    if ('error' in r) {
      return r.error === 'suspended'
        ? refuse(c, 403, 'suspended', 'This account has been suspended. Ask an admin if that’s a mistake.')
        : refuse(c, 401, 'invalid', 'That email and password don’t match.');
    }
    sessions.start(c, r.userId);
    return c.json({ ok: true });
  });

  // ---------- first run ----------
  app.post('/auth/setup', async (c) => {
    if (crossSite(c)) return refuse(c, 403, 'forbidden', 'Cross-site requests are not allowed');
    if (!ipLimit.take(clientIp(c))) return tooMany(c);
    if (!accounts.needsSetup()) return refuse(c, 409, 'already-set-up', 'This workspace is already set up. Sign in instead.');
    const b = await body(c);
    if (!d.setup.matches(b.token)) return refuse(c, 403, 'bad-token', 'That setup token isn’t right. It’s in the server log from when Baseline started, or run `baseline setup-token` on the server.');
    const name = text(b.name, NAME_MAX), email = normalizeEmail(text(b.email, 320)), workspaceName = text(b.workspaceName, NAME_MAX);
    if (!name) return refuse(c, 400, 'invalid', 'Add your name');
    if (!isEmail(email)) return refuse(c, 400, 'invalid', 'That isn’t an email address');
    const problem = passwordProblem(b.password);
    if (problem) return refuse(c, 400, 'weak-password', problem);
    const passwordHash = await hashPassword(b.password as string);
    // re-checked after the await: a second request with the token may have finished meanwhile
    const r = accounts.completeSetup({ name, email, passwordHash, workspaceName });
    if ('error' in r) return refuse(c, 409, 'already-set-up', 'This workspace is already set up. Sign in instead.');
    d.setup.clear();
    console.log(`[baseline] setup done: ${email} is the workspace owner`);
    sessions.start(c, r.userId);
    return c.json({ ok: true }, 201);
  });

  // ---------- joining through an invite ----------
  app.post('/auth/invite/:code/accept', async (c) => {
    if (crossSite(c)) return refuse(c, 403, 'forbidden', 'Cross-site requests are not allowed');
    if (!ipLimit.take(clientIp(c))) return tooMany(c);
    const b = await body(c);
    const email = normalizeEmail(text(b.email, 320)), name = text(b.name, NAME_MAX);
    if (!isEmail(email)) return refuse(c, 400, 'invalid', 'Enter the email address the invite was sent to');
    if (!name) return refuse(c, 400, 'invalid', 'Add your name');
    const problem = passwordProblem(b.password);
    if (problem) return refuse(c, 400, 'weak-password', problem);
    const r = accounts.acceptInvite(c.req.param('code'), { email, name, passwordHash: await hashPassword(b.password as string) });
    if ('error' in r) {
      return r.error === 'invite-mismatch' ? refuse(c, 400, r.error, 'This invite was sent to a different address.')
        : r.error === 'already-member' ? refuse(c, 409, r.error, 'There’s already an account for that address. Sign in instead.')
        : refuse(c, 400, r.error, 'This invite has expired or was revoked. Ask for a new one.');
    }
    if (r.invitedBy) hooks.onInviteAccepted?.(r.userId, r.invitedBy);
    sessions.start(c, r.userId);
    return c.json({ ok: true }, 201);
  });

  // ---------- joining through a team's join link ----------
  app.post('/auth/join/:code/accept', async (c) => {
    if (crossSite(c)) return refuse(c, 403, 'forbidden', 'Cross-site requests are not allowed');
    if (!ipLimit.take(clientIp(c))) return tooMany(c);
    const b = await body(c);
    const email = normalizeEmail(text(b.email, 320)), name = text(b.name, NAME_MAX);
    if (!isEmail(email)) return refuse(c, 400, 'invalid', email ? emailProblem(email) : 'Enter your work email address');
    if (!name) return refuse(c, 400, 'invalid', 'Add your name');
    const problem = passwordProblem(b.password);
    if (problem) return refuse(c, 400, 'weak-password', problem);
    const r = accounts.joinWithLink(c.req.param('code'), { email, name, passwordHash: await hashPassword(b.password as string) });
    if ('error' in r) {
      return r.error === 'already-member' ? refuse(c, 409, r.error, 'There’s already an account for that address. Sign in instead.')
        : refuse(c, 400, r.error, 'This join link was turned off. Ask your team for a new one.');
    }
    if (r.invitedBy) hooks.onInviteAccepted?.(r.userId, r.invitedBy);
    sessions.start(c, r.userId);
    return c.json({ ok: true }, 201);
  });

  // ---------- reset links ----------
  app.get('/auth/reset/:token', (c) => {
    if (!lookupLimit.take(clientIp(c))) return tooMany(c);
    const r = accounts.passwordReset(c.req.param('token'));
    return r ? c.json({ state: 'valid', name: r.name, email: r.email }) : c.json({ state: 'invalid' }, 404);
  });
  app.post('/auth/reset/:token', async (c) => {
    if (crossSite(c)) return refuse(c, 403, 'forbidden', 'Cross-site requests are not allowed');
    if (!ipLimit.take(clientIp(c))) return tooMany(c);
    const b = await body(c);
    const problem = passwordProblem(b.password);
    if (problem) return refuse(c, 400, 'weak-password', problem);
    if (!accounts.passwordReset(c.req.param('token'))) return refuse(c, 400, 'invalid', 'This reset link has expired or was already used. Ask for a new one.');
    const userId = accounts.usePasswordReset(c.req.param('token'), await hashPassword(b.password as string));
    if (!userId) return refuse(c, 400, 'invalid', 'This reset link has expired or was already used. Ask for a new one.');
    sessions.start(c, userId);
    return c.json({ ok: true });
  });
  // the same answer whether or not the address has an account, so this can't be used to find members
  app.post('/auth/forgot', async (c) => {
    if (crossSite(c)) return refuse(c, 403, 'forbidden', 'Cross-site requests are not allowed');
    if (!d.mailer.configured) return refuse(c, 400, 'mail-off', 'Email isn’t set up on this server. Ask an admin for a password reset link.');
    if (!ipLimit.take(clientIp(c))) return tooMany(c);
    const email = normalizeEmail(text((await body(c)).email, 320));
    const user = isEmail(email) && forgotLimit.take(email) ? accounts.passwordFor(email) : undefined;
    if (user && user.status === 'active') {
      const { token } = accounts.createPasswordReset(user.id, null, RESET_EMAIL_TTL);
      // not awaited: how long SMTP takes would tell which addresses have accounts
      d.mailer.send(passwordResetEmail({ to: email, workspace: d.store.workspaceMeta().name, link: resetLink(cfg.publicUrl, token), minutes: RESET_EMAIL_TTL / MIN }))
        .catch(err => console.error('[baseline] password reset email failed:', (err as Error).message));
    }
    return c.json({ ok: true });
  });

  // ---------- your own password (behind authenticate; a key can't reach it, see principal.ts) ----------
  app.post('/api/me/password', async (c) => {
    const p = principalOf(c);
    if (p.via !== 'session') return refuse(c, 403, 'forbidden', 'Change your password from Settings › Account in Baseline');
    if (!changeLimit.take(p.userId)) return tooMany(c);
    const stored = accounts.passwordHashOf(p.userId);
    if (!stored) return refuse(c, 400, 'no-password', 'Your account signs in with Google. An admin can send you a link to set a password.');
    const b = await body(c);
    // 400, not 401: a wrong current password isn't a lost session
    if (!await verifyPassword(typeof b.current === 'string' ? b.current : '', stored)) return refuse(c, 400, 'invalid', 'Your current password isn’t right.');
    const problem = passwordProblem(b.next);
    if (problem) return refuse(c, 400, 'weak-password', problem);
    accounts.setPassword(p.userId, await hashPassword(b.next as string));
    // every other browser is signed out; this one carries on in a new session
    sessions.start(c, p.userId);
    return c.json({ ok: true });
  });
}

export const resetLink = (publicUrl: URL, token: string) => new URL(`/?reset=${token}`, publicUrl).toString();
