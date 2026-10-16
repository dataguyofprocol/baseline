import { markCreated } from './motion.js';
import type { Snapshot, Issue, Comment, Project, SavedView, Team, User, Label, WorkflowState, Priority, Cycle, Milestone, Handoff, IssueTemplate, Location, TerminalApp, Attachment, Preferences, ProjectLabel, ProjectStatusDef, DocTemplate, CustomEmoji, Customer, CustomerRequest, Invite, InviteResult, WorkspaceSecurity } from '../../src/core/types.js';

/** a failed API call; `status` 401 means the session is gone and the person must sign in again */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) window.dispatchEvent(new Event('baseline:signed-out'));
  if (!res.ok) {
    // the server's own sentence when it sent one ("The workspace needs at least one admin")
    const said = await res.json().then((j: { error?: unknown }) => typeof j.error === 'string' ? j.error : null).catch(() => null);
    throw new ApiError(said ?? `${method} ${path} → ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  bootstrap: () => req<Snapshot>('GET', '/api/bootstrap'),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),
  // people (hosted workspaces)
  listInvites: () => req<{ invites: Invite[] }>('GET', '/api/invites'),
  createInvites: (b: { emails: string; admin: boolean; teamIds: string[] }) => req<{ results: InviteResult[] }>('POST', '/api/invites', b),
  resendInvite: (id: string) => req<{ invite: Invite; emailed?: InviteResult['emailed']; error?: string }>('POST', `/api/invites/${id}/resend`, {}),
  revokeInvite: (id: string) => req<{ ok: true }>('DELETE', `/api/invites/${id}`),
  updateMember: (id: string, b: { admin?: boolean; suspended?: boolean; teamIds?: string[] }) => req<{ ok: true }>('PATCH', `/api/members/${id}`, b),
  joinTeam: (id: string) => req<{ ok: true }>('POST', `/api/teams/${id}/join`, {}),
  leaveTeam: (id: string) => req<{ ok: true }>('POST', `/api/teams/${id}/leave`, {}),
  updateSecurity: (b: Partial<WorkspaceSecurity>) => req<{ security: WorkspaceSecurity }>('PATCH', '/api/security', b),
  /** what an invite link points at, before signing in (no session needed) */
  inviteInfo: async (code: string) => {
    const res = await fetch(`/auth/invite/${encodeURIComponent(code)}`);
    return res.json().catch(() => ({ state: 'unknown' })) as Promise<{ state: 'valid' | 'expired' | 'accepted' | 'revoked' | 'unknown'; workspace?: string; inviter?: string | null; email?: string }>;
  },
  createIssue: async (b: Partial<Issue> & { teamId: string; title: string }) => {
    const r = await req<{ issue: Issue }>('POST', '/api/issues', b);
    markCreated(r.issue.id);   // the row plays its enter + flash when it lands
    return r;
  },
  updateIssue: (id: string, patch: Record<string, unknown>) => req<{ issue: Issue }>('PATCH', `/api/issues/${id}`, patch),
  deleteIssue: (id: string) => req<{ ok: true }>('DELETE', `/api/issues/${id}`),
  restoreIssue: (id: string) => req<{ ok: true }>('POST', `/api/issues/${id}/restore`),
  archiveIssue: (id: string) => req<{ ok: true }>('POST', `/api/issues/${id}/archive`),
  unarchiveIssue: (id: string) => req<{ ok: true }>('POST', `/api/issues/${id}/unarchive`),
  bulkIssues: (b: { ids: string[]; patch?: Record<string, unknown>; delete?: boolean; archive?: boolean }) => req<{ ok: true; count: number }>('POST', '/api/issues/bulk', b),
  moveIssue: (id: string, beforeId: string | null, afterId: string | null) => req<{ ok: true }>('POST', `/api/issues/${id}/move`, { beforeId, afterId }),
  getHandoff: (id: string) => req<{ handoff: Handoff }>('GET', `/api/issues/${id}/handoff`),
  /** errors come back as values — the caller reacts to `code` (e.g. no-directory → open the picker) */
  openClaude: async (id: string, b: { locationId?: string; directory?: string }) => {
    const res = await fetch(`/api/issues/${id}/open-claude`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    return res.json().catch(() => ({ error: `Server error (${res.status})`, code: 'server' })) as Promise<{ key: string; directory: string; location: { id: string; name: string }; pinned: boolean; error?: undefined } | { error: string; code: string }>;
  },
  pickDirectory: async (prompt?: string, multiple = false) => {
    const res = await fetch('/api/directories/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, multiple }) });
    return res.json().catch(() => ({ directory: null, directories: [], error: `Server error (${res.status})` })) as Promise<{ directory: string | null; directories: string[]; error?: string }>;
  },
  installedTerminals: () => req<{ installed: TerminalApp[] }>('GET', '/api/terminals'),
  checkDirectory: (directory: string) => req<{ exists: boolean }>('POST', '/api/directories/check', { directory }),
  createLocation: async (path: string, name?: string) => {
    const res = await fetch('/api/locations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, name }) });
    return res.json().catch(() => ({ error: `Server error (${res.status})` })) as Promise<{ location: Location; error?: undefined } | { error: string }>;
  },
  renameLocation: async (id: string, name: string) => {
    const res = await fetch(`/api/locations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    return res.json().catch(() => ({ error: `Server error (${res.status})` })) as Promise<{ ok: true; error?: undefined } | { error: string }>;
  },
  deleteLocation: (id: string) => req<{ ok: true }>('DELETE', `/api/locations/${id}`),
  setProjectLocations: (projectId: string, locationIds: string[]) => req<{ ok: true }>('PATCH', `/api/projects/${projectId}`, { locationIds }),
  createDoc: (b: Record<string, unknown>) => req<{ doc: { id: string } }>('POST', '/api/docs', b),
  updateDoc: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/docs/${id}`, patch),
  deleteDoc: (id: string) => req<{ ok: true }>('DELETE', `/api/docs/${id}`),
  addTeamLink: (teamId: string, url: string, title?: string) => req<{ ok: true }>('POST', `/api/teams/${teamId}/links`, { url, title }),
  deleteTeamLink: (id: string) => req<{ ok: true }>('DELETE', `/api/team-links/${id}`),
  createProjectTemplate: (b: Record<string, unknown>) => req<{ template: { id: string } }>('POST', '/api/project-templates', b),
  updateProjectTemplate: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/project-templates/${id}`, patch),
  deleteProjectTemplate: (id: string) => req<{ ok: true }>('DELETE', `/api/project-templates/${id}`),
  applyProjectTemplate: (projectId: string, templateId: string) => req<{ ok: true }>('POST', `/api/projects/${projectId}/apply-template`, { templateId }),
  addProjectDependency: (projectId: string, b: { blocks?: string; blockedBy?: string }) => req<{ ok: true }>('POST', `/api/projects/${projectId}/dependencies`, b),
  removeProjectDependency: (id: string) => req<{ ok: true }>('DELETE', `/api/project-dependencies/${id}`),
  createRecurring: (b: Record<string, unknown>) => req<{ recurring: { id: string } }>('POST', '/api/recurring', b),
  updateRecurring: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/recurring/${id}`, patch),
  deleteRecurring: (id: string) => req<{ ok: true }>('DELETE', `/api/recurring/${id}`),
  createTemplate: (b: { teamId: string; name: string; title?: string; description?: string }) => req<{ template: IssueTemplate }>('POST', '/api/issue-templates', b),
  updateTemplate: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/issue-templates/${id}`, patch),
  deleteTemplate: (id: string) => req<{ ok: true }>('DELETE', `/api/issue-templates/${id}`),
  addComment: (issueId: string, body: string, parentId?: string | null) => req<{ comment: Comment }>('POST', `/api/issues/${issueId}/comments`, { body, parentId: parentId ?? null }),
  resolveComment: (commentId: string, resolved: boolean) => req<{ ok: true }>('PATCH', `/api/comments/${commentId}`, { resolved }),
  snoozeIssue: (issueId: string, until: string | null) => req<{ ok: true }>('POST', `/api/issues/${issueId}/snooze`, { until }),
  remindIssue: (issueId: string, at: string) => req<{ ok: true }>('POST', `/api/issues/${issueId}/remind`, { at }),
  setSubscribed: (issueId: string, subscribed: boolean) => req<{ ok: true }>('POST', `/api/issues/${issueId}/subscribe`, { subscribed }),
  convertToProject: (issueId: string) => req<{ project: Project; moved: string[] }>('POST', `/api/issues/${issueId}/convert-project`),
  moveIssueToTeam: (issueId: string, teamId: string) => req<{ issue: Issue }>('POST', `/api/issues/${issueId}/team`, { teamId }),
  archivedIssues: (teamId?: string) => req<{ issues: Issue[] }>('GET', `/api/issues/archived${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`),
  deletedIssues: (teamId?: string) => req<{ issues: Issue[] }>('GET', `/api/issues/deleted${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`),
  purgeIssue: (id: string) => req<{ ok: true }>('DELETE', `/api/issues/${id}/purge`),
  addLink: (issueId: string, url: string, title?: string) => req<{ attachment: Attachment }>('POST', `/api/issues/${issueId}/attachments`, { url, title }),
  uploadFile: async (issueId: string, file: File) => {
    const res = await fetch(`/api/issues/${issueId}/files?name=${encodeURIComponent(file.name || 'pasted-image.png')}`, {
      method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
    return res.json() as Promise<{ attachment: Attachment }>;
  },
  renameAttachment: (id: string, title: string) => req<{ ok: true }>('PATCH', `/api/attachments/${id}`, { title }),
  deleteAttachment: (id: string) => req<{ ok: true }>('DELETE', `/api/attachments/${id}`),
  updateComment: (commentId: string, body: string) => req<{ ok: true }>('PATCH', `/api/comments/${commentId}`, { body }),
  deleteComment: (commentId: string) => req<{ ok: true }>('DELETE', `/api/comments/${commentId}`),
  toggleReaction: (commentId: string, reaction: string) => req<{ ok: true }>('PATCH', `/api/comments/${commentId}`, { reaction }),
  addRelation: (issueId: string, relatedIssueId: string, type: string) => req<{ ok: true }>('POST', `/api/issues/${issueId}/relations`, { relatedIssueId, type }),
  removeRelation: (relationId: string) => req<{ ok: true }>('DELETE', `/api/relations/${relationId}`),
  createProject: (b: Record<string, unknown>) => req<{ project: Project }>('POST', '/api/projects', b),
  updateProject: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),
  addProjectLink: (id: string, url: string, title?: string) => req<{ ok: true }>('POST', `/api/projects/${id}/links`, { url, title }),
  deleteProjectLink: (id: string) => req<{ ok: true }>('DELETE', `/api/project-links/${id}`),
  addProjectUpdate: (id: string, body: string, health?: string) => req<{ ok: true }>('POST', `/api/projects/${id}/updates`, { body, health }),
  createMilestone: (b: Record<string, unknown>) => req<{ milestone: Milestone }>('POST', '/api/milestones', b),
  updateMilestone: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/milestones/${id}`, patch),
  deleteMilestone: (id: string) => req<{ ok: true }>('DELETE', `/api/milestones/${id}`),
  setFeatures: (patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', '/api/features', patch),
  createProjectLabel: (b: Record<string, unknown>) => req<{ label: ProjectLabel }>('POST', '/api/project-labels', b),
  updateProjectLabel: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/project-labels/${id}`, b),
  deleteProjectLabel: (id: string) => req<{ ok: true }>('DELETE', `/api/project-labels/${id}`),
  createProjectStatus: (b: Record<string, unknown>) => req<{ status: ProjectStatusDef }>('POST', '/api/project-statuses', b),
  updateProjectStatus: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/project-statuses/${id}`, b),
  deleteProjectStatus: (id: string) => req<{ ok: true }>('DELETE', `/api/project-statuses/${id}`),
  setProjectSubscription: (projectId: string, flags: Record<string, boolean>) => req<{ ok: true }>('PUT', `/api/projects/${projectId}/subscription`, flags),
  createDocTemplate: (b: Record<string, unknown>) => req<{ template: DocTemplate }>('POST', '/api/doc-templates', b),
  updateDocTemplate: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/doc-templates/${id}`, b),
  deleteDocTemplate: (id: string) => req<{ ok: true }>('DELETE', `/api/doc-templates/${id}`),
  uploadEmoji: async (name: string, file: File) => {
    const res = await fetch(`/api/emojis?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file.name || 'emoji.png')}`, { method: 'POST', headers: { 'Content-Type': file.type || 'image/png' }, body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
    return res.json() as Promise<{ emoji: CustomEmoji }>;
  },
  deleteEmoji: (id: string) => req<{ ok: true }>('DELETE', `/api/emojis/${id}`),
  createCustomer: (b: Record<string, unknown>) => req<{ customer: Customer }>('POST', '/api/customers', b),
  updateCustomer: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/customers/${id}`, b),
  deleteCustomer: (id: string) => req<{ ok: true }>('DELETE', `/api/customers/${id}`),
  createCustomerAttr: (kind: 'status' | 'tier', b: Record<string, unknown>) => req<{ id: string }>('POST', `/api/customer-attrs/${kind}`, b),
  updateCustomerAttr: (kind: 'status' | 'tier', id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/customer-attrs/${kind}/${id}`, b),
  deleteCustomerAttr: (kind: 'status' | 'tier', id: string) => req<{ ok: true }>('DELETE', `/api/customer-attrs/${kind}/${id}`),
  addCustomerRequest: (b: Record<string, unknown>) => req<{ request: CustomerRequest }>('POST', '/api/customer-requests', b),
  updateCustomerRequest: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/customer-requests/${id}`, b),
  deleteCustomerRequest: (id: string) => req<{ ok: true }>('DELETE', `/api/customer-requests/${id}`),
  createTeam: (b: Record<string, unknown>) => req<{ team: Team }>('POST', '/api/teams', b),
  updateTeam: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/teams/${id}`, patch),
  deleteTeam: (id: string) => req<{ ok: true }>('DELETE', `/api/teams/${id}`),
  createState: (b: Record<string, unknown>) => req<{ state: WorkflowState }>('POST', '/api/states', b),
  updateState: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/states/${id}`, patch),
  deleteState: (id: string) => req<{ ok: true; movedTo: string | null }>('DELETE', `/api/states/${id}`),
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
  deleteNotification: (id: string) => req<{ ok: true }>('DELETE', `/api/notifications/${id}`),
  deleteReadNotifications: () => req<{ ok: true }>('POST', '/api/notifications/delete-read'),
  snoozeNotification: (id: string, until: string | null) => req<{ ok: true }>('POST', `/api/notifications/${id}/snooze`, { until }),
  updatePreferences: (patch: Partial<Preferences>) => req<{ ok: true }>('PATCH', '/api/preferences', patch),
  updateUser: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/users/${id}`, patch),
  updateCycle: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/cycles/${id}`, patch),
  updateWorkspace: (b: Record<string, unknown>) => req<{ ok: true }>('PATCH', '/api/workspace', b),
  importWorkspace: (json: string) => req<{ ok: true }>('POST', '/api/import', { json }),
  search: (q: string) => req<{ issues: Issue[]; projects: Project[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  reseed: () => req<{ ok: true }>('POST', '/api/seed', {}),
};

export type { Snapshot, Issue, Comment, Project, SavedView, Team, User, Label, WorkflowState, Priority, Cycle, Milestone, Handoff, IssueTemplate };
