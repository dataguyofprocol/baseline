import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.js';
import { id } from './util.js';
import { API_KEY_SCOPES, type ApiKey, type ApiKeyScope } from './types.js';

const ts = () => new Date().toISOString();
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export const API_KEY_PREFIX = 'bl_api_';

type Row = { id: string; name: string; user_id: string; token_hash: string; hint: string; scopes: string | null; team_ids: string | null; created_at: string; last_used_at: string | null };

// settings and anything that starts local processes; reads of these stay under `read`
const ADMIN_ROUTES = /^\/api\/(workspace|features|users|states|import|seed|locations|directories|sla-rules|loops|git\/(automation|sync|pull-requests|commits)|github\/(webhook|issues)\/[^/]+|github\/(token|repos)|issues\/[^/]+\/open-claude)(\/|$)/;
const TEAM_ADMIN = /^\/api\/teams(\/[^/]+)?$/;
/** snapshot parts keyed by team id rather than listed */
const TEAM_KEYED = new Set(['teamWorkflows', 'teamSubscriptions']);

/* Personal API keys, like Linear's: a key is shown once, stored as a sha256 hash, acts as the
   person who made it, and can be limited to some permissions and some teams. */
export class ApiKeys {
  constructor(private store: Store, private db: DatabaseSync) {}

  private map(r: Row): ApiKey {
    return { id: r.id, name: r.name, userId: r.user_id, hint: r.hint, scopes: r.scopes ? JSON.parse(r.scopes) : null, teamIds: r.team_ids ? JSON.parse(r.team_ids) : null, createdAt: r.created_at, lastUsedAt: r.last_used_at };
  }

  list(userId?: string): ApiKey[] {
    const rows = (userId ? this.db.prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) : this.db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all()) as unknown as Row[];
    return rows.map(r => this.map(r));
  }

  /** returns the token once; only its hash is kept */
  create(input: { name: string; userId: string; scopes?: ApiKeyScope[] | null; teamIds?: string[] | null }): { key: ApiKey; token: string } {
    const name = input.name.trim();
    if (!name) throw new Error('A key name is required');
    const scopes = input.scopes?.length ? [...new Set(input.scopes)].filter(s => API_KEY_SCOPES.some(([k]) => k === s)) : null;
    if (input.scopes && input.scopes.length && !scopes?.length) throw new Error('Unknown permissions');
    const teamIds = input.teamIds?.length ? input.teamIds.filter(t => this.store.getTeam(t)) : null;
    if (input.teamIds?.length && !teamIds?.length) throw new Error('Unknown teams');
    const token = API_KEY_PREFIX + randomBytes(24).toString('base64url');
    const r: Row = { id: id('key'), name, user_id: input.userId, token_hash: hash(token), hint: token.slice(-4), scopes: scopes ? JSON.stringify(scopes) : null, team_ids: teamIds ? JSON.stringify(teamIds) : null, created_at: ts(), last_used_at: null };
    this.db.prepare('INSERT INTO api_keys (id, name, user_id, token_hash, hint, scopes, team_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(r.id, r.name, r.user_id, r.token_hash, r.hint, r.scopes, r.team_ids, r.created_at);
    return { key: this.map(r), token };
  }

  rename(keyId: string, name: string): void { if (name.trim()) this.db.prepare('UPDATE api_keys SET name = ? WHERE id = ?').run(name.trim(), keyId); }
  revoke(keyId: string): void { this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(keyId); }
  get(keyId: string): ApiKey | undefined { const r = this.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(keyId) as Row | undefined; return r ? this.map(r) : undefined; }

  /** the key a token belongs to, stamping when it was last used (at most once a minute) */
  verify(token: string): ApiKey | null {
    const r = this.db.prepare('SELECT * FROM api_keys WHERE token_hash = ?').get(hash(token.trim())) as Row | undefined;
    if (!r) return null;
    if (!this.db.prepare('SELECT 1 FROM users WHERE id = ? AND (status IS NULL OR status != \'suspended\')').get(r.user_id)) return null;
    const now = new Date();
    if (!r.last_used_at || now.getTime() - Date.parse(r.last_used_at) > 60_000) {
      r.last_used_at = now.toISOString();
      this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(r.last_used_at, r.id);
    }
    return this.map(r);
  }

  /** the permission a request needs and the key lacks, or null when it is allowed */
  missingScope(key: ApiKey, method: string, path: string): ApiKeyScope | null {
    const s = key.scopes;
    if (!s) return null;
    const read = method === 'GET' || method === 'HEAD';
    // the export, and which repos the server's GitHub token can see, are reads only admins make
    if (path === '/api/export' || path === '/api/github/repos/available') return s.includes('admin') ? null : 'admin';
    // the MCP endpoint itself only needs a key that reads; each tool call is an /api request checked on its own
    if (path === '/mcp') return s.includes('read') || s.includes('write') ? null : 'read';
    if (!read && (ADMIN_ROUTES.test(path) || TEAM_ADMIN.test(path))) return s.includes('admin') ? null : 'admin';
    if (read) return s.includes('read') || s.includes('write') ? null : 'read';
    if (s.includes('write')) return null;
    if (s.includes('createIssues') && ((method === 'POST' && path === '/api/issues') || (method === 'PATCH' && /^\/api\/issues\/[^/]+$/.test(path)))) return null;
    if (s.includes('createComments') && method === 'POST' && /^\/api\/issues\/[^/]+\/comments$/.test(path)) return null;
    return 'write';
  }

  /** false when a team-limited key touches an issue or team outside its teams */
  teamAllowed(key: ApiKey, path: string, body: Record<string, unknown> | null): boolean {
    const teams = key.teamIds;
    if (!teams) return true;
    const issueId = /^\/api\/issues\/([^/]+)/.exec(path)?.[1];
    if (issueId && !['archived', 'deleted', 'bulk', 'by-key'].includes(issueId)) {
      const issue = this.store.getIssue(decodeURIComponent(issueId));
      if (issue && !teams.includes(issue.teamId)) return false;
    }
    const teamId = /^\/api\/(?:teams|git\/automation)\/([^/]+)/.exec(path)?.[1];
    if (teamId && !teams.includes(teamId)) return false;
    // an uploaded file or attachment belongs to its issue's (or team's) team
    const fileId = /^\/api\/(?:files|attachments|emoji-files)\/([^/]+)/.exec(path)?.[1];
    if (fileId) {
      const fid = decodeURIComponent(fileId);
      const f = this.db.prepare('SELECT owner_type AS type, owner_id AS owner FROM files WHERE id = ?').get(fid) as { type: string; owner: string } | undefined
        ?? (this.db.prepare("SELECT 'issue' AS type, issue_id AS owner FROM attachments WHERE id = ?").get(fid) as { type: string; owner: string } | undefined);
      const ownerTeam = f?.type === 'issue' ? this.store.getIssue(f.owner)?.teamId : f?.type === 'team' ? f.owner : undefined;
      if (ownerTeam && !teams.includes(ownerTeam)) return false;
    }
    if (body) {
      if (typeof body.teamId === 'string' && !teams.includes(body.teamId)) return false;
      if (Array.isArray(body.teamIds) && body.teamIds.some(t => typeof t === 'string' && !teams.includes(t))) return false;
      if (Array.isArray(body.ids) && body.ids.some(i => { const issue = typeof i === 'string' ? this.store.getIssue(i) : undefined; return issue && !teams.includes(issue.teamId); })) return false;
    }
    return true;
  }

  /** drops what lies outside a team-limited key's teams from a JSON response */
  scopeResponse(key: ApiKey, data: unknown): unknown {
    const teams = key.teamIds;
    if (!teams || !data || typeof data !== 'object') return data;
    const d = data as Record<string, unknown>;
    if (d.issue && typeof d.issue === 'object' && !teams.includes((d.issue as { teamId: string }).teamId)) return { error: 'not found' };
    const issues = Array.isArray(d.issues) ? (d.issues as Array<{ id: string; teamId: string }>).filter(i => teams.includes(i.teamId)) : null;
    const issueIds = issues ? new Set(issues.map(i => i.id)) : null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) {
      if (TEAM_KEYED.has(k) && v && typeof v === 'object') { out[k] = Object.fromEntries(Object.entries(v).filter(([teamId]) => teams.includes(teamId))); continue; }
      if (!Array.isArray(v)) { out[k] = v; continue; }
      if (k === 'issues') { out[k] = issues; continue; }
      if (k === 'teams') { out[k] = (v as Array<{ id: string }>).filter(t => teams.includes(t.id)); continue; }
      out[k] = v.filter(item => {
        if (!item || typeof item !== 'object') return true;
        const o = item as { teamId?: string | null; issueId?: string | null };
        if (o.teamId && !teams.includes(o.teamId)) return false;
        if (o.issueId && issueIds && !issueIds.has(o.issueId)) return false;
        return true;
      });
    }
    return out;
  }
}
