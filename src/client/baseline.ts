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
  locationId?: string | null;
}

export type IssuePatch = Partial<Pick<Issue,
  'title' | 'description' | 'stateId' | 'priority' | 'assigneeId' | 'projectId' | 'parentId' |
  'cycleId' | 'locationId' | 'milestoneId' | 'estimate' | 'dueDate' | 'labelIds'>>;

export interface Me {
  user: User;
  workspace: { id: string; name: string };
  via: 'key' | 'session' | 'local';
  scopes: ApiKeyScope[] | null;
  teamIds: string[] | null;
  keyId: string | null;
}

export interface Baseline {
  readonly target: Target;
  snapshot<K extends SnapshotSection>(sections: readonly K[]): Promise<Pick<Snapshot, K>>;
  me(): Promise<Me>;
  getByKey(key: string): Promise<Issue | undefined>;
  getIssue(id: string): Promise<Issue | undefined>;
  listIssues(filter: IssueFilter): Promise<Issue[]>;
  handoffFor(issueId: string): Promise<Handoff | undefined>;
  search(q: string): Promise<{ issues: Issue[]; projects: Project[] }>;
  createIssue(input: NewIssue, actorId?: string): Promise<Issue>;
  updateIssue(id: string, patch: IssuePatch, actorId?: string): Promise<Issue>;
  addComment(issueId: string, actorId: string | undefined, body: string, parentId: string | null): Promise<Comment>;
  addProjectUpdate(projectId: string, actorId: string | undefined, body: string, health?: Project['health']): Promise<ProjectUpdate>;
  createLocation(path: string): Promise<Location>;
  revokeOwnKey(): Promise<void>;
  markNotificationRead(notificationId: string, read?: boolean): Promise<void>;
  markAllNotificationsRead(): Promise<void>;

  startWork(issueId: string, input: { session: string | null; takeOver?: boolean }, actorId?: string): Promise<StartWorkResult>;
  postProgress(issueId: string, input: ProgressPatch & { session: string | null; links: readonly string[] }, actorId?: string): Promise<ProgressResult>;
  finishWork(issueId: string, input: { session: string | null; outcome: WorkOutcome; summary: string; left?: string; links: readonly string[] }, actorId?: string): Promise<FinishWorkResult>;
  fileFollowup(sourceIssueId: string, input: { session: string | null; title: string; description?: string; teamId?: string }, actorId?: string): Promise<FollowupResult>;
  workThreads(issueId: string): Promise<WorkThread[]>;
  draftProjectUpdate(projectId: string, input: { body?: string; health?: Health }, actorId?: string): Promise<DraftResult>;
  undoOp(opId: string, actorId?: string): Promise<UndoResult>;
  createSubIssues(parentId: string, input: { session: string | null; titles: readonly string[] }, actorId?: string): Promise<SubIssuesResult>;
  propose(input: { session: string | null; kind: AgentDraftKind; teamId: string; title: string; description?: string; priority?: number; fromIssueId?: string }, actorId?: string): Promise<ProposeResult>;
  drafts(filter: { status?: 'pending' | 'filed'; kind?: AgentDraftKind; fromIssueId?: string }): Promise<AgentDraft[]>;
  createAgentIssue(input: { session: string | null; teamId: string; draftId?: string; title?: string; description?: string; priority?: number; projectId?: string | null; start?: boolean }, actorId?: string): Promise<CreateIssueResult>;
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
