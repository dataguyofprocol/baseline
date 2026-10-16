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
 *  `hd` is the Google Workspace domain the account is managed by — absent for personal accounts. */
export interface GoogleIdentity { sub: string; email: string; name: string; picture: string; hd?: string }

export type SignInError = 'not-invited' | 'suspended' | 'invite-mismatch' | 'invite-expired';
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
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

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
   *  2. a person with the same email who has never signed in (seeded or imported data) — linked now;
   *  3. the workspace owner (BASELINE_OWNER_EMAIL) — created as admin;
   *  4. someone with a pending invite for this email — created with the invite's role and teams;
   *  5. an account managed by an approved Google Workspace domain — created as a member.
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
    // a fresh hosted workspace has no "own" user yet: the first person in becomes it (the inbox
    // owner and the CLI's default identity on the server until notifications go per person)
    const own = getMeta(this.db, 'currentUser');
    if (!own || !this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(own)) setMeta(this.db, 'currentUser', user.id);
    return { userId: user.id, joined, invitedBy };
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
   *  The link's code isn't a credential — joining still takes the invited Google account — so it's
   *  stored as is and can be copied again later. */
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
  /** open invites (not accepted or revoked), newest first — expired ones included so they can be renewed */
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
