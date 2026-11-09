// The client the CLI (and next, an MCP server) calls. Method names are the Store methods they
// replace; each maps to exactly one route, so authorization is always the server's.
import type { ApiKeyScope, Comment, Handoff, Issue, Location, Priority, Project, ProjectUpdate, Snapshot, SnapshotSection, User } from '../core/types.js';
import type {
  AgentDraft, AgentDraftKind, CreateIssueResult, ProposeResult, SubIssuesResult,
  DraftResult, FinishWorkResult, FollowupResult, Health, ProgressPatch, ProgressResult, StartWorkResult, UndoResult, WorkOutcome, WorkThread,
} from '../core/work-types.js';
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
  /** GET /api/bootstrap?sections=, only the parts a command reads */
  snapshot<K extends SnapshotSection>(sections: readonly K[]): Promise<Pick<Snapshot, K>>;
  /** GET /api/me */
  me(): Promise<Me>;
  /** GET /api/issues/by-key/:key, archived and deleted included; undefined when there's none */
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
  /** POST /api/issues/:id/comments; with no actorId, the request's own person writes it */
  addComment(issueId: string, actorId: string | undefined, body: string, parentId: string | null): Promise<Comment>;
  /** POST /api/projects/:id/updates; with no actorId, the request's own person writes it */
  addProjectUpdate(projectId: string, actorId: string | undefined, body: string, health?: Project['health']): Promise<ProjectUpdate>;
  /** POST /api/locations with a path on the server's disk; a hosted server refuses */
  createLocation(path: string): Promise<Location>;
  /** DELETE /api/me/key revokes the key this client authenticates with */
  revokeOwnKey(): Promise<void>;
  /** POST /api/notifications/:id/read; read false marks it unread again. Always the request's own inbox */
  markNotificationRead(notificationId: string, read?: boolean): Promise<void>;
  /** POST /api/notifications/read-all */
  markAllNotificationsRead(): Promise<void>;

  // Agent work (core/work.ts). Each is one route and one server transaction; a repeat that changes
  // nothing answers with opId null. `session` is BASELINE_SESSION, or null for the default lane.
  /** POST /api/issues/:id/work/start */
  startWork(issueId: string, input: { session: string | null; takeOver?: boolean }, actorId?: string): Promise<StartWorkResult>;
  /** POST /api/issues/:id/work/progress */
  postProgress(issueId: string, input: ProgressPatch & { session: string | null; links: readonly string[] }, actorId?: string): Promise<ProgressResult>;
  /** POST /api/issues/:id/work/finish */
  finishWork(issueId: string, input: { session: string | null; outcome: WorkOutcome; summary: string; left?: string; links: readonly string[] }, actorId?: string): Promise<FinishWorkResult>;
  /** POST /api/issues/:id/followups */
  fileFollowup(sourceIssueId: string, input: { session: string | null; title: string; description?: string; teamId?: string }, actorId?: string): Promise<FollowupResult>;
  /** GET /api/issues/:id/work */
  workThreads(issueId: string): Promise<WorkThread[]>;
  /** PUT /api/projects/:id/update-draft, which never publishes */
  draftProjectUpdate(projectId: string, input: { body?: string; health?: Health }, actorId?: string): Promise<DraftResult>;
  /** POST /api/ops/:id/undo */
  undoOp(opId: string, actorId?: string): Promise<UndoResult>;
  /** POST /api/issues/:id/sub-issues */
  createSubIssues(parentId: string, input: { session: string | null; titles: readonly string[] }, actorId?: string): Promise<SubIssuesResult>;
  /** POST /api/agent-drafts: a proposal only the person sees */
  propose(input: { session: string | null; kind: AgentDraftKind; teamId: string; title: string; description?: string; priority?: number; fromIssueId?: string }, actorId?: string): Promise<ProposeResult>;
  /** GET /api/agent-drafts: the requesting person's drafts */
  drafts(filter: { status?: 'pending' | 'filed'; kind?: AgentDraftKind; fromIssueId?: string }): Promise<AgentDraft[]>;
  /** POST /api/agent-issues: create what the person said yes to (a draft, or fields) */
  createAgentIssue(input: { session: string | null; teamId: string; draftId?: string; title?: string; description?: string; priority?: number; projectId?: string | null; start?: boolean }, actorId?: string): Promise<CreateIssueResult>;
  /** POST /api/agent-users: the coding tool's own agent user, made on first use */
  ensureAgentUser(name: string): Promise<User>;
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
  addProjectUpdate(projectId: string, actorId: string | undefined, body: string, health?: Project['health']): Promise<ProjectUpdate> {
    return this.call('POST', `/api/projects/${encodeURIComponent(projectId)}/updates`, { json: { body, health, userId: actorId }, unwrap: 'update' });
  }
  createLocation(path: string): Promise<Location> {
    return this.call('POST', '/api/locations', { json: { path }, unwrap: 'location' });
  }
  async revokeOwnKey(): Promise<void> { await this.call('DELETE', '/api/me/key'); }
  async markNotificationRead(notificationId: string, read = true): Promise<void> {
    await this.call('POST', `/api/notifications/${encodeURIComponent(notificationId)}/read`, { json: { read } });
  }
  async markAllNotificationsRead(): Promise<void> { await this.call('POST', '/api/notifications/read-all'); }

  startWork(issueId: string, input: { session: string | null; takeOver?: boolean }, actorId?: string): Promise<StartWorkResult> {
    return this.call('POST', `/api/issues/${encodeURIComponent(issueId)}/work/start`, { json: { ...input, actorId } });
  }
  postProgress(issueId: string, input: ProgressPatch & { session: string | null; links: readonly string[] }, actorId?: string): Promise<ProgressResult> {
    return this.call('POST', `/api/issues/${encodeURIComponent(issueId)}/work/progress`, { json: { ...input, actorId } });
  }
  finishWork(issueId: string, input: { session: string | null; outcome: WorkOutcome; summary: string; left?: string; links: readonly string[] }, actorId?: string): Promise<FinishWorkResult> {
    return this.call('POST', `/api/issues/${encodeURIComponent(issueId)}/work/finish`, { json: { ...input, actorId } });
  }
  fileFollowup(sourceIssueId: string, input: { session: string | null; title: string; description?: string; teamId?: string }, actorId?: string): Promise<FollowupResult> {
    return this.call('POST', `/api/issues/${encodeURIComponent(sourceIssueId)}/followups`, { json: { ...input, actorId } });
  }
  workThreads(issueId: string): Promise<WorkThread[]> {
    return this.call('GET', `/api/issues/${encodeURIComponent(issueId)}/work`, { unwrap: 'threads' });
  }
  draftProjectUpdate(projectId: string, input: { body?: string; health?: Health }, actorId?: string): Promise<DraftResult> {
    return this.call('PUT', `/api/projects/${encodeURIComponent(projectId)}/update-draft`, { json: { ...input, actorId } });
  }
  undoOp(opId: string, actorId?: string): Promise<UndoResult> {
    return this.call('POST', `/api/ops/${encodeURIComponent(opId)}/undo`, { json: { actorId } });
  }
  createSubIssues(parentId: string, input: { session: string | null; titles: readonly string[] }, actorId?: string): Promise<SubIssuesResult> {
    return this.call('POST', `/api/issues/${encodeURIComponent(parentId)}/sub-issues`, { json: { ...input, actorId } });
  }
  propose(input: { session: string | null; kind: AgentDraftKind; teamId: string; title: string; description?: string; priority?: number; fromIssueId?: string }, actorId?: string): Promise<ProposeResult> {
    return this.call('POST', '/api/agent-drafts', { json: { ...input, actorId } });
  }
  drafts(filter: { status?: 'pending' | 'filed'; kind?: AgentDraftKind; fromIssueId?: string }): Promise<AgentDraft[]> {
    return this.call('GET', '/api/agent-drafts', { query: { ...filter }, unwrap: 'drafts' });
  }
  createAgentIssue(input: { session: string | null; teamId: string; draftId?: string; title?: string; description?: string; priority?: number; projectId?: string | null; start?: boolean }, actorId?: string): Promise<CreateIssueResult> {
    return this.call('POST', '/api/agent-issues', { json: { ...input, actorId } });
  }
  ensureAgentUser(name: string): Promise<User> {
    return this.call('POST', '/api/agent-users', { json: { name }, unwrap: 'user' });
  }
}
