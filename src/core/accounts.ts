// Accounts: who may sign in, as whom, and the sessions that remember them.
// Sessions live server-side: the browser holds a random token, the database only its SHA-256,
// so a leaked database can't be replayed as cookies.
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { getMeta, setMeta } from './db.js';
import type { Store } from './store.js';

const SESSION_DAYS = 30;
const DAY = 86400_000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** a Google identity whose ID token has been verified (signature via TLS to Google, aud, iss, nonce, expiry) */
export interface GoogleIdentity { sub: string; email: string; name: string; picture: string }

export type SignInResult = { userId: string } | { error: 'not-invited' | 'suspended' };

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

  isAdmin(userId: string): boolean {
    return !!(this.db.prepare('SELECT admin FROM users WHERE id = ?').get(userId) as { admin: number } | undefined)?.admin;
  }

  /** Who a verified Google identity signs in as, in order:
   *  1. the person already linked to this Google account;
   *  2. a person with the same email who has never signed in (seeded or imported data) — linked now;
   *  3. the workspace owner (BASELINE_OWNER_EMAIL) signing in for the first time — created as admin.
   *  Anyone else is turned away until invites land. */
  signInWithGoogle(g: GoogleIdentity, ownerEmail = ''): SignInResult {
    const email = g.email.trim().toLowerCase();
    const isOwner = !!ownerEmail && email === ownerEmail.trim().toLowerCase();
    type Row = { id: string; status: string };
    let user = this.db.prepare('SELECT id, status FROM users WHERE google_sub = ?').get(g.sub) as Row | undefined;
    if (!user) {
      user = this.db.prepare("SELECT id, status FROM users WHERE kind = 'human' AND google_sub IS NULL AND lower(email) = ? ORDER BY rowid LIMIT 1").get(email) as Row | undefined;
      if (user) this.db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, user.id);
    }
    if (!user && isOwner) {
      const created = this.store.createUser(g.name || email, email, true);
      this.db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(g.sub, created.id);
      user = { id: created.id, status: 'active' };
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
    return { userId: user.id };
  }
}
