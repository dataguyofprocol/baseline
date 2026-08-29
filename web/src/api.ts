import type { Snapshot, Issue, Comment, Project, SavedView, Team, User, Label, WorkflowState, Priority, Cycle, Milestone, Handoff, IssueTemplate } from '../../src/core/types.js';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  bootstrap: () => req<Snapshot>('GET', '/api/bootstrap'),
  createIssue: (b: Partial<Issue> & { teamId: string; title: string }) => req<{ issue: Issue }>('POST', '/api/issues', b),
  updateIssue: (id: string, patch: Record<string, unknown>) => req<{ issue: Issue }>('PATCH', `/api/issues/${id}`, patch),
  deleteIssue: (id: string) => req<{ ok: true }>('DELETE', `/api/issues/${id}`),
  restoreIssue: (id: string) => req<{ ok: true }>('POST', `/api/issues/${id}/restore`),
  archiveIssue: (id: string) => req<{ ok: true }>('POST', `/api/issues/${id}/archive`),
  unarchiveIssue: (id: string) => req<{ ok: true }>('POST', `/api/issues/${id}/unarchive`),
  bulkIssues: (b: { ids: string[]; patch?: Record<string, unknown>; delete?: boolean; archive?: boolean }) => req<{ ok: true; count: number }>('POST', '/api/issues/bulk', b),
  moveIssue: (id: string, beforeId: string | null, afterId: string | null) => req<{ ok: true }>('POST', `/api/issues/${id}/move`, { beforeId, afterId }),
  getHandoff: (id: string) => req<{ handoff: Handoff }>('GET', `/api/issues/${id}/handoff`),
  createTemplate: (b: { teamId: string; name: string; title?: string; description?: string }) => req<{ template: IssueTemplate }>('POST', '/api/issue-templates', b),
  updateTemplate: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/issue-templates/${id}`, patch),
  deleteTemplate: (id: string) => req<{ ok: true }>('DELETE', `/api/issue-templates/${id}`),
  addComment: (issueId: string, body: string) => req<{ comment: Comment }>('POST', `/api/issues/${issueId}/comments`, { body }),
  updateComment: (commentId: string, body: string) => req<{ ok: true }>('PATCH', `/api/comments/${commentId}`, { body }),
  deleteComment: (commentId: string) => req<{ ok: true }>('DELETE', `/api/comments/${commentId}`),
  toggleReaction: (commentId: string, reaction: string) => req<{ ok: true }>('PATCH', `/api/comments/${commentId}`, { reaction }),
  addRelation: (issueId: string, relatedIssueId: string, type: string) => req<{ ok: true }>('POST', `/api/issues/${issueId}/relations`, { relatedIssueId, type }),
  removeRelation: (relationId: string) => req<{ ok: true }>('DELETE', `/api/relations/${relationId}`),
  createProject: (b: Record<string, unknown>) => req<{ project: Project }>('POST', '/api/projects', b),
  updateProject: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),
  addProjectUpdate: (id: string, body: string, health?: string) => req<{ ok: true }>('POST', `/api/projects/${id}/updates`, { body, health }),
  createMilestone: (b: Record<string, unknown>) => req<{ milestone: Milestone }>('POST', '/api/milestones', b),
  updateMilestone: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/milestones/${id}`, patch),
  deleteMilestone: (id: string) => req<{ ok: true }>('DELETE', `/api/milestones/${id}`),
  createTeam: (b: Record<string, unknown>) => req<{ team: Team }>('POST', '/api/teams', b),
  updateTeam: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/teams/${id}`, patch),
  deleteTeam: (id: string) => req<{ ok: true }>('DELETE', `/api/teams/${id}`),
  createState: (b: Record<string, unknown>) => req<{ state: WorkflowState }>('POST', '/api/states', b),
  updateState: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/states/${id}`, patch),
  deleteState: (id: string) => req<{ ok: true }>('DELETE', `/api/states/${id}`),
  createLabel: (b: Record<string, unknown>) => req<{ label: Label }>('POST', '/api/labels', b),
  updateLabel: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/labels/${id}`, patch),
  deleteLabel: (id: string) => req<{ ok: true }>('DELETE', `/api/labels/${id}`),
  createUser: (b: Record<string, unknown>) => req<{ user: User }>('POST', '/api/users', b),
  createCycle: (b: Record<string, unknown>) => req<{ cycle: Cycle }>('POST', '/api/cycles', b),
  deleteCycle: (id: string) => req<{ ok: true }>('DELETE', `/api/cycles/${id}`),
  createView: (b: Record<string, unknown>) => req<{ view: SavedView }>('POST', '/api/views', b),
  updateView: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/views/${id}`, patch),
  deleteView: (id: string) => req<{ ok: true }>('DELETE', `/api/views/${id}`),
  toggleFavorite: (type: string, refId: string) => req<{ ok: true }>('POST', '/api/favorites/toggle', { type, refId }),
  markNotificationRead: (id: string, read = true) => req<{ ok: true }>('POST', `/api/notifications/${id}/read`, { read }),
  markAllNotificationsRead: () => req<{ ok: true }>('POST', '/api/notifications/read-all'),
  updateWorkspace: (b: Record<string, unknown>) => req<{ ok: true }>('PATCH', '/api/workspace', b),
  importWorkspace: (json: string) => req<{ ok: true }>('POST', '/api/import', { json }),
  search: (q: string) => req<{ issues: Issue[]; projects: Project[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  reseed: () => req<{ ok: true }>('POST', '/api/seed', {}),
};

export type { Snapshot, Issue, Comment, Project, SavedView, Team, User, Label, WorkflowState, Priority, Cycle, Milestone, Handoff, IssueTemplate };
