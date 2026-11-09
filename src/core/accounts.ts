// Accounts: who may sign in, as whom, and the sessions that remember them.
// Sessions live server-side: the browser holds a random token, the database only its SHA-256,
// so a leaked database can't be replayed as cookies.
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { getMeta, setMeta } from './db.js';
import { id } from './util.js';
import type { Store } from './store.js';

const SESSION_DAYS = 30;
const DAY = 86400_000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** a Google identity whose ID token has been verified (aud, iss, nonce, expiry, verified email).
 *  `hd` is the Google Workspace domain that manages the account; personal accounts have none. */
export interface GoogleIdentity { sub: string; email: string; name: string; picture: string; hd?: string }

export type SignInError = 'not-invited' | 'suspended' | 'invite-mismatch' | 'invite-expired';
/** a password sign-in never says which half was wrong */
export type PasswordSignInError = 'invalid' | 'suspended';
export type InviteAcceptError = 'invite-expired' | 'invite-mismatch' | 'already-member';
export type SignInResult =
  | { userId: string; joined?: 'owner' | 'invite' | 'domain'; invitedBy?: string | null }
  | { error: SignInError };

/** a rule the caller broke (shown to the person as is) */
export class AccountError extends Error {
  constructor(readonly code: 'last-admin' | 'self' | 'not-found', message: string) { super(message); }
}

export interface InviteRow {
  id: string; email: string; admin: number; team_ids: string; invited_by: string | null; code: string;
  created_at: string; expires_at: string; accepted_at: string | null; accepted_user_id: string | null; revoked_at: string | null;
}
const INVITE_DAYS = 7;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export { isEmail } from './types.js';

export class Accounts {
  constructor(private db: DatabaseSync, private store: Store) {}
  createSession(userId: string, client: { userAgent?: string; ip?: string } = {}): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY).toISOString();
    this.db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(hashToken(token), userId, now.toISOString(), expiresAt, now.toISOString(), (client.userAgent ?? '').slice(0, 300), client.ip ?? '');
    this.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), userId);
    return { token, expiresAt };
  }

  /** the active person behind a session token. Sessions slide: one used a day or more after it
   *  was last extended gets a fresh 30 days (`renewed` tells the caller to re-set the cookie). */
  resolveSession(token: string | undefined): { userId: string; expiresAt: string; renewed: boolean } | null {
    if (!token) return null;
    const sid = hashToken(token);
    const row = this.db.prepare('SELECT s.user_id, s.expires_at, s.last_seen_at, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
      .get(sid) as { user_id: string; expires_at: string; last_seen_at: string; status: string } | undefined;
    if (!row) return null;
    const now = Date.now();
    if (Date.parse(row.expires_at) <= now || row.status === 'suspended') {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      return null;
    }
    let expiresAt = row.expires_at;
    let renewed = false;
    if (now - Date.parse(row.last_seen_at) > 60_000) {
      const nowIso = new Date(now).toISOString();
      if (Date.parse(row.expires_at) - now < (SESSION_DAYS - 1) * DAY) {
        expiresAt = new Date(now + SESSION_DAYS * DAY).toISOString();
        renewed = true;
      }
      this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(nowIso, expiresAt, sid);
      this.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso, row.user_id);
    }
    return { userId: row.user_id, expiresAt, renewed };
  }

  deleteSession(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  }
  revokeUserSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  userBrief(userId: string): { name: string; email: string } | undefined {
    return this.db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId) as { name: string; email: string } | undefined;
  }
  isAdmin(userId: string): boolean {
    return !!(this.db.prepare('SELECT admin FROM users WHERE id = ?').get(userId) as { admin: number } | undefined)?.admin;
  }

  /** Who a verified Google identity signs in as, in order:
   *  1. the person already linked to this Google account;
   *  2. a person with the same email who has never signed in (seeded or imported data), linked now;
   *  3. the workspace owner (BASELINE_OWNER_EMAIL), created as admin;
   *  4. someone with a pending invite for this email, created with the invite's role and teams;
   *  5. an account managed by an approved Google Workspace domain, created as a member.
   *  Anyone else is turned away. Arriving through an invite link that was sent to a different
   *  address, or one that's no longer valid, says so instead of a bare "not invited". */
  signInWithGoogle(g: GoogleIdentity, opts: { ownerEmail?: string; inviteCode?: string } = {}): SignInResult {
    const email = normalizeEmail(g.email);
    const isOwner = !!opts.ownerEmail && email === normalizeEmail(opts.ownerEmail);
    type Row = { id: string; status: string };
    let user = this.db.prepare('SELECT id, status FROM users WHERE google_sub = ?').get(g.sub) as Row | undefined;
    if (!user) {
      user = this.db.prepare("SELECT id, status FROM users WHERE kind = 'human' AND google_sub IS NULL AND lower(email) = ? ORDER BY rowid LIMIT 1").get(email) as Row | undefined;
      if (user) this.db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, user.id);
    }
    let joined: 'owner' | 'invite' | 'domain' | undefined;
    let invitedBy: string | null | undefined;
    if (!user && isOwner) {
      user = this.join(g, true, []);
      joined = 'owner';
    }
    if (!user) {
      if (opts.inviteCode) {
        const linked = this.inviteByCode(opts.inviteCode);
        if (!linked || linked.revoked_at || linked.accepted_at || Date.parse(linked.expires_at) <= Date.now()) {
          if (!this.pendingInviteFor(email)) return { error: 'invite-expired' };
        } else if (linked.email !== email) return { error: 'invite-mismatch' };
      }
      const invite = this.pendingInviteFor(email);
      if (invite) {
        user = this.join(g, !!invite.admin, JSON.parse(invite.team_ids) as string[]);
        // every open invite to this address is now spent
        this.db.prepare('UPDATE invites SET accepted_at = ?, accepted_user_id = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL')
          .run(new Date().toISOString(), user.id, email);
        joined = 'invite';
        invitedBy = invite.invited_by;
      }
    }
    if (!user && g.hd) {
      const sec = this.store.getSecurity();
      // the hd claim, not the address: it proves Google Workspace manages the account for that domain
      if (sec.approvedDomains.includes(g.hd.toLowerCase()) && email.endsWith(`@${g.hd.toLowerCase()}`)) {
        user = this.join(g, false, sec.domainTeamIds);
        joined = 'domain';
      }
    }
    if (!user) return { error: 'not-invited' };
    if (user.status === 'suspended') return { error: 'suspended' };
    // the owner can never be locked out of admin
    if (isOwner) this.db.prepare('UPDATE users SET admin = 1 WHERE id = ?').run(user.id);
    if (g.picture) this.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(g.picture, user.id);
    this.claimOwnUser(user.id);
    return { userId: user.id, joined, invitedBy };
  }

  /** a fresh hosted workspace has no "own" user yet: the first person in becomes it (the inbox
   *  owner and the CLI's default identity on the server until notifications go per person) */
  private claimOwnUser(userId: string): void {
    const own = getMeta(this.db, 'currentUser');
    if (!own || !this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(own)) setMeta(this.db, 'currentUser', userId);
  }

  // ---------- passwords ----------
  /** the stored hash for an address (null: no password set), or undefined when no person has it */
  passwordFor(email: string): { id: string; status: string; hash: string | null } | undefined {
    const row = this.db.prepare("SELECT id, status, password_hash FROM users WHERE kind = 'human' AND lower(email) = ? ORDER BY rowid LIMIT 1")
      .get(normalizeEmail(email)) as { id: string; status: string; password_hash: string | null } | undefined;
    return row && { id: row.id, status: row.status, hash: row.password_hash };
  }
  passwordHashOf(userId: string): string | null {
    return (this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string | null } | undefined)?.password_hash ?? null;
  }
  /** a new password signs the person out everywhere; the caller starts the session they continue in */
  setPassword(userId: string, hash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    this.revokeUserSessions(userId);
  }
  /** the outcome of a password check the caller already ran (verifyPassword is async; this isn't) */
  passwordSignIn(user: { id: string; status: string } | undefined, matched: boolean): { userId: string } | { error: PasswordSignInError } {
    if (!user || !matched) return { error: 'invalid' };
    if (user.status === 'suspended') return { error: 'suspended' };
    this.claimOwnUser(user.id);
    return { userId: user.id };
  }

  // ---------- first run ----------
  /** nobody can sign in yet: no person has a password or a linked Google account */
  needsSetup(): boolean {
    return !this.db.prepare("SELECT 1 FROM users WHERE kind = 'human' AND status = 'active' AND (password_hash IS NOT NULL OR google_sub IS NOT NULL) LIMIT 1").get();
  }
  /** The first admin, created by whoever holds the setup token. Synchronous from the re-check to the
   *  last write, so two racing requests can't both get through (one process, one thread). A person
   *  already in the data with that email (imported) becomes the owner rather than a duplicate. */
  completeSetup(o: { name: string; email: string; passwordHash: string; workspaceName: string }): { userId: string } | { error: 'already-set-up' } {
    if (!this.needsSetup()) return { error: 'already-set-up' };
    const email = normalizeEmail(o.email);
    const existing = this.memberByEmail(email);
    const userId = existing?.id ?? this.store.createUser(o.name, email, true).id;
    this.db.prepare("UPDATE users SET admin = 1, status = 'active', name = ?, password_hash = ? WHERE id = ?").run(o.name, o.passwordHash, userId);
    if (o.workspaceName) this.store.setWorkspaceName(o.workspaceName);
    this.claimOwnUser(userId);
    return { userId };
  }

  /** Joining through an invite link with a password. The link is the credential, so the person also
   *  types the address it was sent to: a forwarded link alone (which shows that address masked)
   *  isn't enough. */
  acceptInvite(code: string, o: { email: string; name: string; passwordHash: string }): { userId: string; invitedBy: string | null } | { error: InviteAcceptError } {
    const email = normalizeEmail(o.email);
    const inv = this.inviteByCode(code);
    if (!inv || inv.revoked_at || inv.accepted_at || Date.parse(inv.expires_at) <= Date.now()) return { error: 'invite-expired' };
    if (inv.email !== email) return { error: 'invite-mismatch' };
    if (this.memberByEmail(email)) return { error: 'already-member' };
    const created = this.store.createUser(o.name || email, email, !!inv.admin);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(o.passwordHash, created.id);
    this.store.setUserTeams(created.id, JSON.parse(inv.team_ids) as string[]);
    this.db.prepare('UPDATE invites SET accepted_at = ?, accepted_user_id = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .run(new Date().toISOString(), created.id, email);
    this.claimOwnUser(created.id);
    return { userId: created.id, invitedBy: inv.invited_by };
  }

  // ---------- password reset links ----------
  /** a one-use link; any earlier unused link for the same person stops working */
  createPasswordReset(userId: string, createdBy: string | null, ttlMs: number): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(userId, now.toISOString());
    this.db.prepare('INSERT INTO password_resets (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(hashToken(token), userId, createdBy, now.toISOString(), expiresAt);
    return { token, expiresAt };
  }
  /** who an unused, unexpired reset link is for (an active person), or null */
  passwordReset(token: string): { userId: string; name: string; email: string } | null {
    const row = this.db.prepare("SELECT r.user_id, u.name, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.status = 'active' AND u.kind = 'human'")
      .get(hashToken(token), new Date().toISOString()) as { user_id: string; name: string; email: string } | undefined;
    return row ? { userId: row.user_id, name: row.name, email: row.email } : null;
  }
  /** spends the link and sets the password; null when it was already used, expired or unknown */
  usePasswordReset(token: string, passwordHash: string): string | null {
    const valid = this.passwordReset(token);
    if (!valid) return null;
    // one use, even when two requests race for it
    const spent = this.db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(new Date().toISOString(), hashToken(token));
    if (Number(spent.changes) !== 1) return null;
    this.setPassword(valid.userId, passwordHash);
    return valid.userId;
  }

  private join(g: GoogleIdentity, admin: boolean, teamIds: string[]): { id: string; status: string } {
    const created = this.store.createUser(g.name || normalizeEmail(g.email), normalizeEmail(g.email), admin);
    this.db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, created.id);
    this.store.setUserTeams(created.id, teamIds);
    return { id: created.id, status: 'active' };
  }

  // ---------- invites ----------
  /** a person (active or suspended) already using this address */
  memberByEmail(email: string): { id: string; status: string } | undefined {
    return this.db.prepare("SELECT id, status FROM users WHERE kind = 'human' AND lower(email) = ? LIMIT 1").get(normalizeEmail(email)) as { id: string; status: string } | undefined;
  }
  /** Invite an address. An earlier open invite to it is replaced, so the newest role and teams win.
   *  The code is kept as is so the link can be copied again later (admins see it anyway); joining
   *  with it still takes the invited Google account, or typing the invited address (acceptInvite). */
  createInvite(email: string, admin: boolean, teamIds: string[], invitedBy: string): InviteRow {
    const addr = normalizeEmail(email);
    const now = new Date();
    this.db.prepare('UPDATE invites SET revoked_at = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL').run(now.toISOString(), addr);
    const row: InviteRow = {
      id: id('inv'), email: addr, admin: admin ? 1 : 0, team_ids: JSON.stringify(teamIds), invited_by: invitedBy,
      code: randomBytes(18).toString('base64url'), created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + INVITE_DAYS * DAY).toISOString(), accepted_at: null, accepted_user_id: null, revoked_at: null,
    };
    this.db.prepare('INSERT INTO invites (id, email, admin, team_ids, invited_by, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.email, row.admin, row.team_ids, row.invited_by, row.code, row.created_at, row.expires_at);
    return row;
  }
  /** open invites (not accepted or revoked), newest first, including expired ones so they can be renewed */
  openInvites(): InviteRow[] {
    return this.db.prepare('SELECT * FROM invites WHERE accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC').all() as unknown as InviteRow[];
  }
  getInvite(inviteId: string): InviteRow | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE id = ?').get(inviteId) as InviteRow | undefined;
  }
  inviteByCode(code: string): InviteRow | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as InviteRow | undefined;
  }
  pendingInviteFor(email: string): InviteRow | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
      .get(normalizeEmail(email), new Date().toISOString()) as InviteRow | undefined;
  }
  /** another 7 days from now (resending an invite) */
  renewInvite(inviteId: string): InviteRow | undefined {
    this.db.prepare('UPDATE invites SET expires_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .run(new Date(Date.now() + INVITE_DAYS * DAY).toISOString(), inviteId);
    return this.getInvite(inviteId);
  }
  revokeInvite(inviteId: string): void {
    this.db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL').run(new Date().toISOString(), inviteId);
  }

  // ---------- roles ----------
  /** a person (not an agent) who can sign in */
  isActivePerson(userId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM users WHERE id = ? AND kind = 'human' AND status = 'active'").get(userId);
  }
  canInvite(userId: string): boolean {
    const u = this.db.prepare("SELECT admin, status, kind FROM users WHERE id = ?").get(userId) as { admin: number; status: string; kind: string } | undefined;
    if (!u || u.status === 'suspended' || u.kind !== 'human') return false;
    return !!u.admin || this.store.getSecurity().whoCanInvite === 'members';
  }
  private activeAdmins(): number {
    return (this.db.prepare("SELECT COUNT(*) n FROM users WHERE admin = 1 AND status = 'active' AND kind = 'human'").get() as { n: number }).n;
  }
  private person(userId: string): { admin: number; status: string } {
    const u = this.db.prepare("SELECT admin, status FROM users WHERE id = ? AND kind = 'human'").get(userId) as { admin: number; status: string } | undefined;
    if (!u) throw new AccountError('not-found', 'No such person');
    return u;
  }
  setAdmin(userId: string, admin: boolean): void {
    const u = this.person(userId);
    if (!admin && u.admin && u.status === 'active' && this.activeAdmins() <= 1) throw new AccountError('last-admin', 'The workspace needs at least one admin');
    this.db.prepare('UPDATE users SET admin = ? WHERE id = ?').run(admin ? 1 : 0, userId);
  }
  /** suspending signs someone out everywhere and keeps them out; their issues and comments stay */
  setSuspended(userId: string, suspended: boolean, actorId: string): void {
    const u = this.person(userId);
    if (userId === actorId) throw new AccountError('self', 'You can\'t suspend yourself');
    if (suspended && u.admin && u.status === 'active' && this.activeAdmins() <= 1) throw new AccountError('last-admin', 'The workspace needs at least one admin');
    this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(suspended ? 'suspended' : 'active', userId);
    if (suspended) this.revokeUserSessions(userId);
  }
}
