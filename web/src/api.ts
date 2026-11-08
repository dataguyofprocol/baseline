import { markCreated } from './motion.js';
import type { Snapshot, Issue, Comment, Project, SavedView, Team, User, Label, WorkflowState, Priority, Cycle, Milestone, Handoff, IssueTemplate, Location, TerminalApp, Attachment, StoredFile, PreferencesPatch, ProjectLabel, ProjectStatusDef, DocTemplate, CustomEmoji, Initiative, SlaRule, Loop, LoopRun, PrAutomation, ApiKey, ApiKeyScope, WebhookConfig, WebhookDelivery, Invite, InviteResult, WorkspaceSecurity, SignInMethod } from '../../src/core/types.js';

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
  addTeamMembers: (id: string, userIds: string[]) => req<{ added: string[] }>('POST', `/api/teams/${id}/members`, { userIds }),
  removeTeamMember: (id: string, userId: string) => req<{ ok: true }>('DELETE', `/api/teams/${id}/members/${userId}`),
  updateSecurity: (b: Partial<WorkspaceSecurity>) => req<{ security: WorkspaceSecurity }>('PATCH', '/api/security', b),
  /** what an invite link points at, before signing in (no session needed) */
  inviteInfo: async (code: string) => {
    const res = await fetch(`/auth/invite/${encodeURIComponent(code)}`);
    return res.json().catch(() => ({ state: 'unknown' })) as Promise<{ state: 'valid' | 'expired' | 'accepted' | 'revoked' | 'unknown'; workspace?: string; inviter?: string | null; email?: string }>;
  },
  /** an admin's one-use link that sets a member's password (shared by hand; no email needed) */
  passwordResetLink: (userId: string) => req<{ link: string; expiresAt: string }>('POST', `/api/members/${userId}/reset-link`, {}),
  changePassword: (b: { current: string; next: string }) => req<{ ok: true }>('POST', '/api/me/password', b),
  me: () => req<{ hasPassword: boolean | null }>('GET', '/api/me'),
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
  startIssue: (id: string) => req<{ moved: boolean; assigned: boolean; stateName?: string }>('POST', `/api/issues/${id}/start`, {}),
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
  /** a picture for an editor (owner = "issue:<id>", "doc:<id>", "project:<id>", "initiative:<id>", "team:<id>") */
  uploadImage: async (owner: string, file: File) => {
    const res = await fetch(`/api/files?owner=${encodeURIComponent(owner)}&name=${encodeURIComponent(file.name || 'pasted-image.png')}`, {
      method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
    return res.json() as Promise<{ file: StoredFile }>;
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
  /** the signed-in person's own draft (an agent wrote it): published as an update by them, with their edits */
  publishUpdateDraft: (id: string, edits: { body: string; health: string }) => req<{ published: unknown }>('POST', `/api/projects/${id}/update-draft/publish`, edits),
  discardUpdateDraft: (id: string) => req<{ ok: boolean }>('DELETE', `/api/projects/${id}/update-draft`),
  createMilestone: (b: Record<string, unknown>) => req<{ milestone: Milestone }>('POST', '/api/milestones', b),
  updateMilestone: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/milestones/${id}`, patch),
  deleteMilestone: (id: string) => req<{ ok: true }>('DELETE', `/api/milestones/${id}`),
  createInitiative: (b: Record<string, unknown>) => req<{ initiative: Initiative }>('POST', '/api/initiatives', b),
  updateInitiative: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/initiatives/${id}`, b),
  deleteInitiative: (id: string) => req<{ ok: true }>('DELETE', `/api/initiatives/${id}`),
  addInitiativeProject: (id: string, projectId: string) => req<{ ok: true }>('POST', `/api/initiatives/${id}/projects`, { projectId }),
  removeInitiativeProject: (id: string, projectId: string) => req<{ ok: true }>('DELETE', `/api/initiatives/${id}/projects/${projectId}`),
  addInitiativeUpdate: (id: string, body: string, health?: string | null) => req<{ ok: true }>('POST', `/api/initiatives/${id}/updates`, { body, health }),
  toggleInitiativeUpdateReaction: (updateId: string, reaction: string) => req<{ ok: true }>('PATCH', `/api/initiative-updates/${updateId}`, { reaction }),
  addInitiativeLink: (id: string, url: string, title?: string) => req<{ ok: true }>('POST', `/api/initiatives/${id}/links`, { url, title }),
  deleteInitiativeLink: (id: string) => req<{ ok: true }>('DELETE', `/api/initiative-links/${id}`),
  createInitiativeLabel: (b: Record<string, unknown>) => req<{ ok: true }>('POST', '/api/initiative-labels', b),
  updateInitiativeLabel: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/initiative-labels/${id}`, b),
  deleteInitiativeLabel: (id: string) => req<{ ok: true }>('DELETE', `/api/initiative-labels/${id}`),
  createSlaRule: (b: Record<string, unknown>) => req<{ rule: SlaRule }>('POST', '/api/sla-rules', b),
  updateSlaRule: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/sla-rules/${id}`, b),
  deleteSlaRule: (id: string) => req<{ ok: true }>('DELETE', `/api/sla-rules/${id}`),
  createLoop: (b: Record<string, unknown>) => req<{ loop: Loop }>('POST', '/api/loops', b),
  updateLoop: (id: string, b: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/loops/${id}`, b),
  deleteLoop: (id: string) => req<{ ok: true }>('DELETE', `/api/loops/${id}`),
  runLoop: (id: string, issueId?: string | null) => req<{ run: LoopRun }>('POST', `/api/loops/${id}/run`, { issueId: issueId ?? null }),
  setTeamSubscription: (teamId: string, flags: Record<string, boolean>) => req<{ ok: true }>('PUT', `/api/teams/${teamId}/subscription`, flags),
  gitStatus: () => req<{ ghInstalled: boolean; ghUser: string | null; repos: Array<{ location: string; path: string; repo: string | null }>; lastSyncAt: string | null; lastError: string | null }>('GET', '/api/git/status'),
  gitSync: () => req<{ prs: number; commits: number; error?: string }>('POST', '/api/git/sync'),
  gitAutomation: (teamId: string) => req<PrAutomation>('GET', `/api/git/automation/${teamId}`),
  setGitAutomation: (teamId: string, b: Partial<PrAutomation>) => req<{ ok: true }>('PUT', `/api/git/automation/${teamId}`, b),
  unlinkPr: (issueId: string, prId: string) => req<{ ok: true }>('POST', '/api/git/unlink', { issueId, prId }),
  webhookConfig: () => req<WebhookConfig>('GET', '/api/github/webhook/config'),
  setWebhookUrl: (publicUrl: string) => req<WebhookConfig>('PUT', '/api/github/webhook/config', { publicUrl }),
  rotateWebhookSecret: () => req<{ secret: string }>('POST', '/api/github/webhook/secret'),
  turnOffWebhooks: () => req<{ ok: true }>('DELETE', '/api/github/webhook/secret'),
  webhookDeliveries: (limit = 20) => req<{ deliveries: WebhookDelivery[] }>('GET', `/api/github/webhook/deliveries?limit=${limit}`),
  importGithubIssues: (repo: string, teamId: string, follow: boolean) => req<{ imported: number; skipped: number }>('POST', '/api/github/issues/import', { repo, teamId, follow }),
  followGithubIssues: (repo: string, teamId: string | null) => req<WebhookConfig>('PUT', '/api/github/issues/follow', { repo, teamId }),
  apiKeys: (all = false) => req<{ keys: ApiKey[] }>('GET', `/api/api-keys${all ? '?all=1' : ''}`),
  createApiKey: (b: { name: string; scopes: ApiKeyScope[] | null; teamIds: string[] | null }) => req<{ key: ApiKey; token: string }>('POST', '/api/api-keys', b),
  renameApiKey: (id: string, name: string) => req<{ ok: true }>('PATCH', `/api/api-keys/${id}`, { name }),
  revokeApiKey: (id: string) => req<{ ok: true }>('DELETE', `/api/api-keys/${id}`),
  setTeamWorkflow: (teamId: string, patch: Record<string, unknown>) => req<{ workflow: unknown }>('PUT', `/api/teams/${teamId}/workflow`, patch),
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
  uploadAvatar: async (userId: string, file: File | null) => {
    const res = await fetch(`/api/users/${userId}/avatar${file ? `?file=${encodeURIComponent(file.name || 'avatar.png')}` : ''}`, { method: 'POST', headers: { 'Content-Type': file?.type || 'image/png' }, body: file ?? '' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
    return res.json() as Promise<{ avatarUrl: string | null }>;
  },
  deleteEmoji: (id: string) => req<{ ok: true }>('DELETE', `/api/emojis/${id}`),
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
  updatePreferences: (patch: PreferencesPatch) => req<{ ok: true }>('PATCH', '/api/preferences', patch),
  updateUser: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/users/${id}`, patch),
  updateCycle: (id: string, patch: Record<string, unknown>) => req<{ ok: true }>('PATCH', `/api/cycles/${id}`, patch),
  updateWorkspace: (b: Record<string, unknown>) => req<{ ok: true }>('PATCH', '/api/workspace', b),
  importWorkspace: (json: string) => req<{ ok: true }>('POST', '/api/import', { json }),
  search: (q: string) => req<{ issues: Issue[]; projects: Project[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  reseed: () => req<{ ok: true }>('POST', '/api/seed', {}),
  /** the sample workspace, added next to what's already here (once per workspace) */
  loadSampleData: () => req<{ ok: true; already?: boolean }>('POST', '/api/seed', { into: true }),
};

export type { Snapshot, Issue, Comment, Project, SavedView, Team, User, Label, WorkflowState, Priority, Cycle, Milestone, Handoff, IssueTemplate };

/** The signed-out side of a hosted server (/auth/*, no session needed). Plain fetches: a refused
 *  password is an answer to show, not a lost session. */
export const authApi = {
  config: async (): Promise<{ methods: SignInMethod[]; setup: boolean; mail: boolean }> => {
    const res = await fetch('/auth/config');
    return res.ok ? res.json() : { methods: ['password'], setup: false, mail: false };
  },
  resetInfo: async (token: string) => {
    const res = await fetch(`/auth/reset/${encodeURIComponent(token)}`);
    return res.json().catch(() => ({ state: 'invalid' })) as Promise<{ state: 'valid' | 'invalid'; name?: string; email?: string }>;
  },
  post: async (path: string, body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string; code?: string }> => {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) return { ok: false, error: 'Can’t reach the server — check your connection and try again.' };
    if (res.ok) return { ok: true };
    const j = await res.json().catch(() => ({})) as { error?: string; code?: string };
    return { ok: false, error: j.error ?? `Something went wrong (${res.status})`, code: j.code };
  },
};
