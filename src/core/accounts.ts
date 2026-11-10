import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { getMeta, setMeta } from './db.js';
import { id } from './util.js';
import type { Store } from './store.js';
import { SMALL_WORKSPACE } from './types.js';

const SESSION_DAYS = 30;
const DAY = 86400_000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface GoogleIdentity { sub: string; email: string; name: string; picture: string; hd?: string }

export type SignInError = 'not-invited' | 'suspended' | 'invite-mismatch' | 'invite-expired';
export type PasswordSignInError = 'invalid' | 'suspended';
export type InviteAcceptError = 'invite-expired' | 'invite-mismatch' | 'already-member';
export type SignInResult =
  | { userId: string; joined?: 'owner' | 'invite' | 'domain' | 'link'; invitedBy?: string | null }
  | { error: SignInError };

export class AccountError extends Error {
  constructor(readonly code: 'last-admin' | 'self' | 'not-found', message: string) { super(message); }
}

export interface JoinLinkRow { id: string; team_id: string; code: string; created_by: string | null; created_at: string; revoked_at: string | null }

export interface InviteRow {
  id: string; email: string; admin: number; team_ids: string; invited_by: string | null; code: string;
  created_at: string; expires_at: string; accepted_at: string | null; accepted_user_id: string | null; revoked_at: string | null;
}
const INVITE_DAYS = 7;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export { isEmail } from './types.js';

export function emailProblem(email: string): string {
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return `${email} isn't an email address`;
  if (!email.slice(at + 1).includes('.')) return `${email} has no domain ending (like ${email.slice(0, at)}@example.com)`;
  return `${email} isn't a valid email address`;
}


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

  signInWithGoogle(g: GoogleIdentity, opts: { ownerEmail?: string; inviteCode?: string; joinCode?: string } = {}): SignInResult {
    const email = normalizeEmail(g.email);
    const isOwner = !!opts.ownerEmail && email === normalizeEmail(opts.ownerEmail);
    type Row = { id: string; status: string };
    let user = this.db.prepare('SELECT id, status FROM users WHERE google_sub = ?').get(g.sub) as Row | undefined;
    if (!user) {
      user = this.db.prepare("SELECT id, status FROM users WHERE kind = 'human' AND google_sub IS NULL AND lower(email) = ? ORDER BY rowid LIMIT 1").get(email) as Row | undefined;
      if (user) this.db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, user.id);
    }
    let joined: 'owner' | 'invite' | 'domain' | 'link' | undefined;
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
        this.db.prepare('UPDATE invites SET accepted_at = ?, accepted_user_id = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL')
          .run(new Date().toISOString(), user.id, email);
        joined = 'invite';
        invitedBy = invite.invited_by;
      }
    }
    if (!user && opts.joinCode) {
      const link = this.joinLinkByCode(opts.joinCode);
      if (!link) return { error: 'invite-expired' };
      user = this.join(g, false, [link.team_id]);
      joined = 'link';
      invitedBy = link.created_by;
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
    if (isOwner) this.db.prepare('UPDATE users SET admin = 1 WHERE id = ?').run(user.id);
    if (g.picture) this.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(g.picture, user.id);
    this.claimOwnUser(user.id);
    return { userId: user.id, joined, invitedBy };
  }

  private claimOwnUser(userId: string): void {
    const own = getMeta(this.db, 'currentUser');
    if (!own || !this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(own)) setMeta(this.db, 'currentUser', userId);
  }

  passwordFor(email: string): { id: string; status: string; hash: string | null } | undefined {
    const row = this.db.prepare("SELECT id, status, password_hash FROM users WHERE kind = 'human' AND lower(email) = ? ORDER BY rowid LIMIT 1")
      .get(normalizeEmail(email)) as { id: string; status: string; password_hash: string | null } | undefined;
    return row && { id: row.id, status: row.status, hash: row.password_hash };
  }
  passwordHashOf(userId: string): string | null {
    return (this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string | null } | undefined)?.password_hash ?? null;
  }
  setPassword(userId: string, hash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    this.revokeUserSessions(userId);
  }
  passwordSignIn(user: { id: string; status: string } | undefined, matched: boolean): { userId: string } | { error: PasswordSignInError } {
    if (!user || !matched) return { error: 'invalid' };
    if (user.status === 'suspended') return { error: 'suspended' };
    this.claimOwnUser(user.id);
    return { userId: user.id };
  }

  needsSetup(): boolean {
    return !this.db.prepare("SELECT 1 FROM users WHERE kind = 'human' AND status = 'active' AND (password_hash IS NOT NULL OR google_sub IS NOT NULL) LIMIT 1").get();
  }
  completeSetup(o: { name: string; email: string; passwordHash: string; workspaceName: string }): { userId: string } | { error: 'already-set-up' } {
    if (!this.needsSetup()) return { error: 'already-set-up' };
    const email = normalizeEmail(o.email);
    const existing = this.memberByEmail(email);
    const userId = existing?.id ?? this.store.createUser(o.name, email, true).id;
    this.startOnboarding(userId);
    this.db.prepare("UPDATE users SET admin = 1, status = 'active', name = ?, password_hash = ? WHERE id = ?").run(o.name, o.passwordHash, userId);
    if (o.workspaceName) this.store.setWorkspaceName(o.workspaceName);
    this.claimOwnUser(userId);
    return { userId };
  }

  acceptInvite(code: string, o: { email: string; name: string; passwordHash: string }): { userId: string; invitedBy: string | null } | { error: InviteAcceptError } {
    const email = normalizeEmail(o.email);
    const inv = this.inviteByCode(code);
    if (!inv || inv.revoked_at || inv.accepted_at || Date.parse(inv.expires_at) <= Date.now()) return { error: 'invite-expired' };
    if (inv.email !== email) return { error: 'invite-mismatch' };
    if (this.memberByEmail(email)) return { error: 'already-member' };
    const created = this.store.createUser(o.name || email, email, !!inv.admin);
    this.startOnboarding(created.id);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(o.passwordHash, created.id);
    this.store.setUserTeams(created.id, JSON.parse(inv.team_ids) as string[]);
    this.db.prepare('UPDATE invites SET accepted_at = ?, accepted_user_id = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .run(new Date().toISOString(), created.id, email);
    this.claimOwnUser(created.id);
    return { userId: created.id, invitedBy: inv.invited_by };
  }

  createPasswordReset(userId: string, createdBy: string | null, ttlMs: number): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(userId, now.toISOString());
    this.db.prepare('INSERT INTO password_resets (token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(hashToken(token), userId, createdBy, now.toISOString(), expiresAt);
    return { token, expiresAt };
  }
  passwordReset(token: string): { userId: string; name: string; email: string } | null {
    const row = this.db.prepare("SELECT r.user_id, u.name, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.status = 'active' AND u.kind = 'human'")
      .get(hashToken(token), new Date().toISOString()) as { user_id: string; name: string; email: string } | undefined;
    return row ? { userId: row.user_id, name: row.name, email: row.email } : null;
  }
  usePasswordReset(token: string, passwordHash: string): string | null {
    const valid = this.passwordReset(token);
    if (!valid) return null;
    const spent = this.db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(new Date().toISOString(), hashToken(token));
    if (Number(spent.changes) !== 1) return null;
    this.setPassword(valid.userId, passwordHash);
    return valid.userId;
  }

  private startOnboarding(userId: string): void {
    const flow = this.db.prepare('SELECT 1 FROM teams LIMIT 1').get() ? 'join' : 'create';
    this.store.setPreferences({ gettingStarted: { onboarding: 'pending', flow, since: new Date().toISOString() } }, userId);
  }

  private join(g: GoogleIdentity, admin: boolean, teamIds: string[]): { id: string; status: string } {
    const created = this.store.createUser(g.name || normalizeEmail(g.email), normalizeEmail(g.email), admin);
    this.startOnboarding(created.id);
    this.db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, created.id);
    this.store.setUserTeams(created.id, teamIds);
    return { id: created.id, status: 'active' };
  }

  memberByEmail(email: string): { id: string; status: string } | undefined {
    return this.db.prepare("SELECT id, status FROM users WHERE kind = 'human' AND lower(email) = ? LIMIT 1").get(normalizeEmail(email)) as { id: string; status: string } | undefined;
  }
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
  openInvites(): InviteRow[] {
    return this.db.prepare('SELECT * FROM invites WHERE accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC').all() as unknown as InviteRow[];
  }
  invitesSentBy(userId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM invites WHERE invited_by = ? AND revoked_at IS NULL').get(userId) as { n: number }).n);
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
  renewInvite(inviteId: string): InviteRow | undefined {
    this.db.prepare('UPDATE invites SET expires_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .run(new Date(Date.now() + INVITE_DAYS * DAY).toISOString(), inviteId);
    return this.getInvite(inviteId);
  }
  revokeInvite(inviteId: string): void {
    this.db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL').run(new Date().toISOString(), inviteId);
  }

  joinLinkFor(teamId: string): JoinLinkRow | undefined {
    return this.db.prepare('SELECT * FROM team_join_links WHERE team_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1').get(teamId) as JoinLinkRow | undefined;
  }
  joinLinkByCode(code: string): JoinLinkRow | undefined {
    return this.db.prepare('SELECT l.* FROM team_join_links l JOIN teams t ON t.id = l.team_id WHERE l.code = ? AND l.revoked_at IS NULL').get(code) as JoinLinkRow | undefined;
  }
  createJoinLink(teamId: string, createdBy: string): JoinLinkRow {
    this.revokeJoinLink(teamId);
    const row: JoinLinkRow = { id: id('jl'), team_id: teamId, code: randomBytes(18).toString('base64url'), created_by: createdBy, created_at: new Date().toISOString(), revoked_at: null };
    this.db.prepare('INSERT INTO team_join_links (id, team_id, code, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(row.id, row.team_id, row.code, row.created_by, row.created_at);
    return row;
  }
  revokeJoinLink(teamId: string): void {
    this.db.prepare('UPDATE team_join_links SET revoked_at = ? WHERE team_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), teamId);
  }
  joinWithLink(code: string, o: { email: string; name: string; passwordHash: string }): { userId: string; invitedBy: string | null; teamId: string } | { error: 'invite-expired' | 'already-member' } {
    const email = normalizeEmail(o.email);
    const link = this.joinLinkByCode(code);
    if (!link) return { error: 'invite-expired' };
    if (this.memberByEmail(email)) return { error: 'already-member' };
    const created = this.store.createUser(o.name || email, email, false);
    this.startOnboarding(created.id);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(o.passwordHash, created.id);
    this.store.setUserTeams(created.id, [link.team_id]);
    this.db.prepare('UPDATE invites SET accepted_at = ?, accepted_user_id = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .run(new Date().toISOString(), created.id, email);
    this.claimOwnUser(created.id);
    return { userId: created.id, invitedBy: link.created_by, teamId: link.team_id };
  }

  isActivePerson(userId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM users WHERE id = ? AND kind = 'human' AND status = 'active'").get(userId);
  }
  canInvite(userId: string): boolean {
    const u = this.db.prepare("SELECT admin, status, kind FROM users WHERE id = ?").get(userId) as { admin: number; status: string; kind: string } | undefined;
    if (!u || u.status === 'suspended' || u.kind !== 'human') return false;
    const sec = this.store.getSecurity();
    if (u.admin || sec.whoCanInvite === 'members') return true;
    return sec.smallTeamInvites && (this.db.prepare("SELECT COUNT(*) n FROM users WHERE kind = 'human' AND status = 'active'").get() as { n: number }).n < SMALL_WORKSPACE;
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
  setSuspended(userId: string, suspended: boolean, actorId: string): void {
    const u = this.person(userId);
    if (userId === actorId) throw new AccountError('self', 'You can\'t suspend yourself');
    if (suspended && u.admin && u.status === 'active' && this.activeAdmins() <= 1) throw new AccountError('last-admin', 'The workspace needs at least one admin');
    this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(suspended ? 'suspended' : 'active', userId);
    if (suspended) {
      this.revokeUserSessions(userId);
      this.db.prepare('DELETE FROM user_github_tokens WHERE user_id = ?').run(userId);
    }
  }
}
