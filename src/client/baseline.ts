// The client the CLI (and next, an MCP server) calls. Method names are the Store methods they
// replace; each maps to exactly one route, so authorization is always the server's.
import type { ApiKeyScope, Comment, Handoff, Issue, Location, Priority, Project, Snapshot, SnapshotSection, User } from '../core/types.js';
import { BaselineError } from './errors.js';
import type { Target } from './target.js';
import type { Transport, WireRequest } from './transport.js';

export interface IssueFilter {
  teamId?: string; stateId?: string; assigneeId?: string; projectId?: string;
  priority?: Priority; query?: string; includeArchived?: boolean; limit?: number;
}

export interface NewIssue {
  teamId: string; title: string; description?: string; stateId?: string; priority?: Priority;
  assigneeId?: string | null; projectId?: string | null; parentId?: string | null; labelIds?: string[];
  estimate?: number | null; dueDate?: string | null; cycleId?: string | null; milestoneId?: string | null;
  /** omitted: a sub-issue inherits its parent's; null: explicitly none */
  locationId?: string | null;
}

export type IssuePatch = Partial<Pick<Issue,
  'title' | 'description' | 'stateId' | 'priority' | 'assigneeId' | 'projectId' | 'parentId' |
  'cycleId' | 'locationId' | 'milestoneId' | 'estimate' | 'dueDate' | 'labelIds'>>;

/** who this client acts as, and within what limits (null: unrestricted) */
export interface Me {
  user: User;
  workspace: { id: string; name: string };
  via: 'key' | 'session' | 'local';
  scopes: ApiKeyScope[] | null;
  teamIds: string[] | null;
  keyId: string | null;
}

/**
 * Writes take ids, never issue keys: only getByKey takes a key. `actorId` is who the write is
 * attributed to (from --as / BASELINE_AS); the server honors it or refuses the write.
 * Every method returns core/types shapes and throws BaselineError for anything the server refused.
 */
export interface Baseline {
  readonly target: Target;
  /** GET /api/bootstrap?sections= — only the parts a command reads */
  snapshot<K extends SnapshotSection>(sections: readonly K[]): Promise<Pick<Snapshot, K>>;
  /** GET /api/me */
  me(): Promise<Me>;
  /** GET /api/issues/by-key/:key — archived and deleted included; undefined when there's none */
  getByKey(key: string): Promise<Issue | undefined>;
  /** GET /api/issues/:id */
  getIssue(id: string): Promise<Issue | undefined>;
  /** GET /api/issues */
  listIssues(filter: IssueFilter): Promise<Issue[]>;
  /** GET /api/issues/:id/handoff */
  handoffFor(issueId: string): Promise<Handoff | undefined>;
  /** GET /api/search */
  search(q: string): Promise<{ issues: Issue[]; projects: Project[] }>;
  /** POST /api/issues */
  createIssue(input: NewIssue, actorId?: string): Promise<Issue>;
  /** PATCH /api/issues/:id */
  updateIssue(id: string, patch: IssuePatch, actorId?: string): Promise<Issue>;
  /** POST /api/issues/:id/comments — no actorId: the request's own person */
  addComment(issueId: string, actorId: string | undefined, body: string, parentId: string | null): Promise<Comment>;
  /** POST /api/locations — a path on the server's disk; a hosted server refuses */
  createLocation(path: string): Promise<Location>;
  /** DELETE /api/me/key — the key this client authenticates with */
  revokeOwnKey(): Promise<void>;
}

export class HttpBaseline implements Baseline {
  constructor(readonly target: Target, private wire: Transport) {}

  private async call<T>(method: string, path: string, opts: WireRequest & { unwrap?: string; missing?: 'undefined' } = {}): Promise<T> {
    const { status, body } = await this.wire.request(method, path, opts);
    if (status === 404 && opts.missing === 'undefined') return undefined as T;
    if (status >= 400) throw BaselineError.fromResponse(status, body);
    return (opts.unwrap ? (body as Record<string, unknown>)[opts.unwrap] : body) as T;
  }

  snapshot<K extends SnapshotSection>(sections: readonly K[]): Promise<Pick<Snapshot, K>> {
    return this.call('GET', '/api/bootstrap', { query: { sections: [...new Set(sections)].join(',') } });
  }
  me(): Promise<Me> { return this.call('GET', '/api/me'); }
  getByKey(key: string): Promise<Issue | undefined> {
    return this.call('GET', `/api/issues/by-key/${encodeURIComponent(key)}`, { unwrap: 'issue', missing: 'undefined' });
  }
  getIssue(id: string): Promise<Issue | undefined> {
    return this.call('GET', `/api/issues/${encodeURIComponent(id)}`, { unwrap: 'issue', missing: 'undefined' });
  }
  listIssues(f: IssueFilter): Promise<Issue[]> {
    return this.call('GET', '/api/issues', {
      unwrap: 'issues',
      query: {
        teamId: f.teamId, stateId: f.stateId, assigneeId: f.assigneeId, projectId: f.projectId,
        priority: f.priority === undefined ? undefined : String(f.priority), query: f.query,
        includeArchived: f.includeArchived ? 'true' : undefined, limit: f.limit === undefined ? undefined : String(f.limit),
      },
    });
  }
  handoffFor(issueId: string): Promise<Handoff | undefined> {
    return this.call('GET', `/api/issues/${encodeURIComponent(issueId)}/handoff`, { unwrap: 'handoff', missing: 'undefined' });
  }
  search(q: string): Promise<{ issues: Issue[]; projects: Project[] }> {
    return this.call('GET', '/api/search', { query: { q } });
  }
  createIssue(input: NewIssue, actorId?: string): Promise<Issue> {
    return this.call('POST', '/api/issues', { json: { ...input, actorId }, unwrap: 'issue' });
  }
  updateIssue(id: string, patch: IssuePatch, actorId?: string): Promise<Issue> {
    return this.call('PATCH', `/api/issues/${encodeURIComponent(id)}`, { json: { ...patch, actorId }, unwrap: 'issue' });
  }
  addComment(issueId: string, actorId: string | undefined, body: string, parentId: string | null): Promise<Comment> {
    return this.call('POST', `/api/issues/${encodeURIComponent(issueId)}/comments`, { json: { body, parentId, userId: actorId }, unwrap: 'comment' });
  }
  createLocation(path: string): Promise<Location> {
    return this.call('POST', '/api/locations', { json: { path }, unwrap: 'location' });
  }
  async revokeOwnKey(): Promise<void> { await this.call('DELETE', '/api/me/key'); }
}
