import type { ProjectUpdateDraft } from './work-types.js';

export type WorkflowStateType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

/** 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low */
export type Priority = 0 | 1 | 2 | 3 | 4;

export type ProjectStatus = 'backlog' | 'planned' | 'started' | 'paused' | 'completed' | 'canceled';
export type ProjectHealth = 'onTrack' | 'atRisk' | 'offTrack';
export type RelationType = 'blocks' | 'blocked_by' | 'related' | 'duplicate';

export interface User {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  admin: boolean;
  kind: 'human' | 'agent';
  title?: string;
  username?: string;
  githubUsername?: string;
  avatarUrl?: string | null;
  status: 'active' | 'suspended';
  createdAt: string | null;
  lastSeenAt: string | null;
}

export interface Team {
  id: string;
  key: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  position: number;
  triageEnabled: boolean;
  autoCycles: boolean;
  /** weeks per cycle */
  cycleDuration: number;
  /** weeks of cooldown between cycles */
  cycleCooldown: number;
  cycleUpcoming: number;
  cycleRollover: boolean;
  estimateScale: EstimateScale;
  memberIds: string[];
  leadIds: string[];
  estimateZero?: boolean;
  estimateExtended?: boolean;
  estimateCountUnestimated?: boolean;
}

export type EstimateScale = 'none' | 'linear' | 'exponential' | 'fibonacci' | 'tshirt';
export const ESTIMATE_SCALES: Record<EstimateScale, Array<{ value: number; label: string }>> = {
  none: [],
  linear: [1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) })),
  exponential: [1, 2, 4, 8, 16].map(v => ({ value: v, label: String(v) })),
  fibonacci: [1, 2, 3, 5, 8].map(v => ({ value: v, label: String(v) })),
  tshirt: [[1, 'XS'], [2, 'S'], [3, 'M'], [5, 'L'], [8, 'XL']].map(([v, l]) => ({ value: v as number, label: l as string })),
};
const EXTENDED: Record<EstimateScale, Array<{ value: number; label: string }>> = {
  none: [],
  linear: [6, 7, 8, 9, 10].map(v => ({ value: v, label: String(v) })),
  exponential: [32, 64].map(v => ({ value: v, label: String(v) })),
  fibonacci: [13, 21].map(v => ({ value: v, label: String(v) })),
  tshirt: [[13, 'XXL'], [21, 'XXXL']].map(([v, l]) => ({ value: v as number, label: l as string })),
};
export function teamScale(team: Pick<Team, 'estimateScale' | 'estimateZero' | 'estimateExtended'> | undefined): Array<{ value: number; label: string }> {
  const scale = team?.estimateScale ?? 'fibonacci';
  if (scale === 'none') return [];
  return [...(team?.estimateZero ? [{ value: 0, label: '0' }] : []), ...ESTIMATE_SCALES[scale], ...(team?.estimateExtended ? EXTENDED[scale] : [])];
}
export function pointsOf(issue: { estimate: number | null; teamId: string }, teams: Array<Pick<Team, 'id' | 'estimateCountUnestimated'>>): number {
  return issue.estimate ?? (teams.find(t => t.id === issue.teamId)?.estimateCountUnestimated ? 1 : 0);
}

export interface WorkflowState {
  id: string;
  teamId: string;
  name: string;
  type: WorkflowStateType;
  color: string;
  position: number;
}

export interface Label {
  id: string;
  teamId: string;
  name: string;
  color: string;
  description: string;
}

export interface Issue {
  id: string;
  teamId: string;
  number: number;
  title: string;
  /** Markdown string (agent-friendly storage format). */
  description: string;
  stateId: string;
  priority: Priority;
  assigneeId: string | null;
  projectId: string | null;
  cycleId: string | null;
  parentId: string | null;
  locationId: string | null;
  milestoneId: string | null;
  creatorId: string | null;
  snoozedUntil: string | null;
  slaRuleId?: string | null;
  slaBreachesAt?: string | null;
  estimate: number | null;
  dueDate: string | null;
  sortOrder: number;
  labelIds: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  deletedAt: string | null;
}

export interface Comment {
  id: string;
  issueId: string;
  userId: string;
  viaUserId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  reactions: Record<string, string[]>;
  resolvedAt: string | null;
  /** thread root this comment replies to (null = top-level comment) */
  parentId: string | null;
}

export interface Attachment {
  id: string;
  issueId: string;
  userId: string;
  kind: 'link' | 'file';
  url: string;
  title: string;
  mime: string;
  size: number;
  createdAt: string;
}

export type FileOwnerType = 'issue' | 'doc' | 'project' | 'initiative' | 'team' | 'avatar' | 'workspace';
export const FILE_OWNER_TYPES: FileOwnerType[] = ['issue', 'doc', 'project', 'initiative', 'team', 'avatar', 'workspace'];

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  ownerType: FileOwnerType;
  /** the issue/doc/project… id; a user id for avatars; '' for workspace */
  ownerId: string;
  uploadedBy: string | null;
  createdAt: string;
  url: string;
}

export interface Subscription {
  issueId: string;
  userId: string;
}

export interface IssueTemplate {
  id: string;
  teamId: string;
  name: string;
  title: string;
  description: string;
  position: number;
  createdAt: string;
}

export interface Handoff {
  key: string;
  title: string;
  branchName: string;
  url: string;
  prompt: string;
}

export interface IssueRelation {
  id: string;
  issueId: string;
  relatedIssueId: string;
  type: RelationType;
}

export interface Project {
  id: string;
  teamId: string | null;
  name: string;
  summary: string;
  description: string;
  icon: string;
  color: string;
  status: ProjectStatus;
  health: ProjectHealth;
  priority: Priority;
  locationIds: string[];
  startDate: string | null;
  targetDate: string | null;
  leadId: string | null;
  memberIds: string[];
  labelIds: string[];
  initiativeIds?: string[];
  statusId: string | null;
  updateCadence: UpdateCadence | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type UpdateCadence = 'none' | 'weekly' | 'biweekly' | 'monthly';
export const UPDATE_CADENCE_LABELS: Record<UpdateCadence, string> = { none: 'No expectation for updates', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

export type InitiativeStatus = 'proposed' | 'planned' | 'active' | 'completed' | 'canceled';
export type DateResolution = 'day' | 'month' | 'quarter' | 'half' | 'year';
export interface Initiative {
  id: string; name: string; description: string; icon: string; color: string;
  summary: string;
  status: InitiativeStatus; health: ProjectHealth | null; ownerId: string | null; targetDate: string | null;
  /** targetDate is the last day of this period (null = a plain day) */
  targetResolution: DateResolution | null;
  parentId: string | null; projectIds: string[]; position: number; createdAt: string; updatedAt: string;
  number: number;
  priority: Priority;
  labelIds: string[];
  teamId: string | null;
  updateCadence: UpdateCadence | null;
}
export const initiativeKey = (ini: Pick<Initiative, 'number'>) => `I-${ini.number}`;
export interface InitiativeUpdate {
  id: string; initiativeId: string; userId: string; body: string; health: ProjectHealth | null; createdAt: string;
  reactions: Record<string, string[]>;
}
export interface InitiativeLabel { id: string; name: string; color: string; description: string; createdAt: string }
export interface InitiativeLink { id: string; initiativeId: string; url: string; title: string; createdAt: string }

export interface SlaRule { id: string; name: string; teamId: string | null; priorities: Priority[]; labelIds: string[]; hours: number; enabled: boolean; createdAt: string }

export type LoopTrigger = { kind: 'schedule'; cadence: 'hourly' | 'daily' | 'weekly' } | { kind: 'issueCreated' } | { kind: 'labelAdded'; labelId: string } | { kind: 'statusChanged'; stateType: WorkflowStateType };
export type LoopAction =
  | { kind: 'assign'; userId: string }
  | { kind: 'comment'; body: string }
  | { kind: 'label'; labelId: string }
  | { kind: 'status'; stateType: WorkflowStateType }
  | { kind: 'createIssue'; title: string; description: string }
  | { kind: 'claudeCode' };
export interface Loop { id: string; name: string; teamId: string | null; trigger: LoopTrigger; actions: LoopAction[]; enabled: boolean; lastRunAt: string | null; createdAt: string }
export interface LoopRun { id: string; loopId: string; issueId: string | null; ok: boolean; detail: string; createdAt: string }

export interface WebhookDelivery { id: number; delivery: string; event: string; action: string | null; repo: string | null; status: 'processed' | 'ignored' | 'rejected'; detail: string; receivedAt: string }
export interface WebhookConfig { enabled: boolean; secretHint: string | null; publicUrl: string; fixedUrl: boolean; events: readonly string[]; lastDelivery: WebhookDelivery | null; received: number; rejected: number; imports: Array<{ repo: string; teamId: string }> }
export type GithubSource =
  | { kind: 'none' }
  | { kind: 'login' }
  | { kind: 'token'; token: string };
export interface GithubTokenInfo { hint: string; login: string; expiresAt: string | null }
export interface TrackedRepo { repo: string; path: string | null; via: 'picked' | 'location'; location: string | null; addedBy: string[]; teamId: string | null }
export interface GithubSummary { repos: number; openPrs: number; linkedPrs: number; authors: number; peopleMatched: number }
export interface GithubAuthor { login: string; prs: number; userId: string | null; suggestedUserId: string | null }
export interface GitStatus {
  source: GithubSource['kind']; token: GithubTokenInfo | null; ghInstalled: boolean; ghUser: string | null;
  repos: TrackedRepo[]; lastSyncAt: string | null; lastError: string | null;
}
export type PrState = 'draft' | 'open' | 'merged' | 'closed';
export interface PullRequest {
  id: string; repo: string; number: number; title: string; body: string; url: string; state: PrState;
  branch: string; base: string; author: string; reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;
  checks: 'success' | 'failure' | 'pending' | null; updatedAt: string; mergedAt: string | null;
}
export interface IssuePr { issueId: string; prId: string; kind: 'closing' | 'ref' | 'related'; dismissed: boolean }
export interface Commit { sha: string; repo: string; message: string; author: string; branch: string; committedAt: string }
export interface IssueCommit { issueId: string; sha: string }
export interface TeamSubscription { issueAdded: boolean; issueClosed: boolean; triage: boolean }
export interface TeamWorkflow {
  closeParent: boolean;
  closeSubIssues: boolean;
  closeStale: boolean;
  staleMonths: number;
  /** the status stale issues move to (null: the team's first canceled status) */
  staleStateId: string | null;
  /** archive closed issues this many months after they closed (0: never) */
  archiveMonths: number;
  reorder: 'first' | 'last' | 'none';
}
export const DEFAULT_TEAM_WORKFLOW: TeamWorkflow = { closeParent: true, closeSubIssues: false, closeStale: false, staleMonths: 6, staleStateId: null, archiveMonths: 6, reorder: 'first' };
export type ApiKeyScope = 'read' | 'write' | 'createIssues' | 'createComments' | 'admin';
export interface ApiKey {
  id: string;
  name: string;
  userId: string;
  hint: string;
  /** null = full access */
  scopes: ApiKeyScope[] | null;
  /** null = every team */
  teamIds: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export const API_KEY_SCOPES: Array<[ApiKeyScope, string, string]> = [
  ['read', 'Read', 'Read all workspace data available to you'],
  ['write', 'Write', 'Read and write all workspace data available to you'],
  ['createIssues', 'Create issues', 'Create and update issues'],
  ['createComments', 'Create comments', 'Create issue comments'],
  ['admin', 'Admin', 'Access admin-only API features'],
];

export type PrEvent = 'draft' | 'opened' | 'review' | 'ready' | 'merged';
/** per team: which workflow state each PR event moves a closing-linked issue to (null = no action) */
export type PrAutomation = Record<PrEvent, string | null> & { branchRules: Array<{ pattern: string; event: PrEvent; stateId: string | null }> };

export interface ProjectLabel { id: string; name: string; color: string; description: string; parentId: string | null; isGroup: boolean; createdAt: string }

export interface ProjectStatusDef { id: string; type: ProjectStatus; name: string; color: string; description: string; position: number }

export interface ProjectSubscription { projectId: string; userId: string; issueAdded: boolean; issueClosed: boolean; comments: boolean; updates: boolean }




export interface WorkspaceFeatures {
  updateCadence: UpdateCadence;
  initiativeUpdateCadence: UpdateCadence;
  initiativesEnabled: boolean;
  githubEnabled: boolean;
  branchFormat: string;
  apiKeyCreation: 'all' | 'admins';
  apiKeyRequiredRemote: boolean;
  estimatesEnabled: boolean;
  cyclesEnabled: boolean;
  templatesEnabled: boolean;
  documentsEnabled: boolean;
  recurringEnabled: boolean;
  projectUpdatesEnabled: boolean;
  slasEnabled: boolean;
  loopsEnabled: boolean;
}
export const FEATURE_SWITCHES: Array<[keyof WorkspaceFeatures, string, string]> = [
  ['cyclesEnabled', 'Cycles', 'Time-boxed iterations per team, with an optional auto-schedule'],
  ['estimatesEnabled', 'Estimates', 'Points on issues, and point totals on boards and cycles'],
  ['templatesEnabled', 'Templates', 'Issue templates in the create modal'],
  ['documentsEnabled', 'Documents', 'Team and project documents'],
  ['recurringEnabled', 'Recurring issues', 'Issues a team files on a schedule'],
  ['projectUpdatesEnabled', 'Project updates', 'An update cadence, reminders and digests for projects'],
  ['initiativesEnabled', 'Initiatives', 'Group projects into initiatives across teams'],
  ['slasEnabled', 'SLAs', 'Deadlines by priority, with breach notifications'],
  ['loopsEnabled', 'Loops', 'Automations that run when an issue changes'],
];
export interface WorkspaceSecurity {
  approvedDomains: string[];
  domainTeamIds: string[];
  whoCanInvite: 'admins' | 'members';
  smallTeamInvites: boolean;
}
export const DEFAULT_SECURITY: WorkspaceSecurity = { approvedDomains: [], domainTeamIds: [], whoCanInvite: 'admins', smallTeamInvites: true };
export const SMALL_WORKSPACE = 10;

export type AuthMode = 'local' | 'hosted';
export type SignInMethod = 'password' | 'google';
export const PASSWORD_MIN = 10;
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export interface Invite {
  id: string;
  email: string;
  admin: boolean;
  teamIds: string[];
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  link: string;
}

export interface TeamJoinLink { teamId: string; link: string; createdBy: string | null; createdAt: string }

export type InviteEntry = { kind: 'member'; userId: string } | { kind: 'email'; email: string };

export interface InviteResult {
  email: string;
  status: 'invited' | 'added-to-teams' | 'already-on-teams' | 'already-in-workspace' | 'invalid';
  userId?: string;
  teamIds?: string[];
  invite?: Invite;
  emailed?: 'sent' | 'failed' | 'off';
  error?: string;
}

export const DEFAULT_FEATURES: WorkspaceFeatures = { updateCadence: 'none', initiativeUpdateCadence: 'none', initiativesEnabled: false, githubEnabled: false, branchFormat: '{username}/{issueIdentifier}-{issueTitle}', apiKeyCreation: 'all', apiKeyRequiredRemote: false,
  estimatesEnabled: false, cyclesEnabled: false, templatesEnabled: false, documentsEnabled: false, recurringEnabled: false, projectUpdatesEnabled: false, slasEnabled: false, loopsEnabled: false };

export interface Location {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  targetDate: string | null;
  status: 'planned' | 'inProgress' | 'done';
  position: number;
  createdAt: string;
}

export interface Doc {
  id: string;
  title: string;
  icon: string;
  content: string;
  projectId: string | null;
  teamId: string | null;
  initiativeId: string | null;
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamLink {
  id: string;
  teamId: string;
  url: string;
  title: string;
  createdAt: string;
}

export interface RecurringIssue {
  id: string;
  teamId: string;
  title: string;
  description: string;
  priority: Priority;
  assigneeId: string | null;
  labelIds: string[];
  projectId: string | null;
  cadence: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  nextAt: string;
  createdAt: string;
}

export interface ProjectLink {
  id: string;
  projectId: string;
  url: string;
  title: string;
  createdAt: string;
}

export interface ProjectUpdate {
  id: string;
  projectId: string;
  userId: string;
  viaUserId: string | null;
  body: string;
  health: ProjectHealth | null;
  createdAt: string;
}

export interface Cycle {
  id: string;
  teamId: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
}

export interface SavedView {
  id: string;
  teamId: string | null;
  name: string;
  icon: string;
  filters: ViewFilters;
  groupBy: GroupBy;
  orderBy: OrderBy;
  layout: 'list' | 'board';
  position: number;
  kind: 'issues' | 'projects';
  projectOptions: Record<string, unknown> | null;
  ownerId: string | null;
  shared: boolean;
}

export interface ViewFilters {
  states?: string[];
  stateTypes?: WorkflowStateType[];
  priority?: Priority[];
  /** user ids; 'none' = unassigned, 'me' = the current user */
  assigneeIds?: string[];
  creatorIds?: string[];
  /** label ids; 'none' = no labels */
  labelIds?: string[];
  /** project ids; 'none' = no project */
  projectIds?: string[];
  /** cycle ids; 'none' = no cycle, 'current' = the team's running cycle */
  cycleIds?: string[];
  milestoneIds?: string[];
  sla?: Array<'breached' | 'risk' | 'ok' | 'none'>;
  prs?: Array<'open' | 'draft' | 'merged' | 'none'>;
  /** estimate values; -1 = no estimate */
  estimates?: number[];
  due?: Array<'overdue' | 'today' | 'week' | 'month' | 'none' | 'any'>;
  created?: 'day' | 'week' | 'month' | 'quarter';
  updated?: 'day' | 'week' | 'month' | 'quarter';
  hierarchy?: Array<'parent' | 'subissue' | 'standalone'>;
  relations?: Array<'blocked' | 'blocking' | 'related' | 'duplicate'>;
  /** user ids following the issue; 'me' = the current user */
  subscriberIds?: string[];
  links?: Array<'any' | 'none'>;
  query?: string;
  not?: string[];
  advanced?: FilterGroup;
}

export interface FilterCondition { field: string; values: string[]; not?: boolean }
export interface FilterGroup { op: 'and' | 'or'; items: Array<FilterCondition | FilterGroup> }

export type GroupBy = 'status' | 'priority' | 'assignee' | 'label' | 'project' | 'cycle' | 'milestone' | 'team' | 'none';
export type OrderBy = 'priority' | 'updated' | 'created' | 'due' | 'manual' | 'title' | 'status' | 'estimate';

export interface Favorite {
  id: string;
  type: 'issue' | 'project' | 'view' | 'cycle' | 'initiative';
  refId: string;
  position: number;
}

export type NotificationType =
  | 'issueAssignedToYou'
  | 'issueAssigned'
  | 'issueCommented'
  | 'issueMentioned'
  | 'issueStatusChanged'
  | 'issueReplied'
  | 'issueReminder'
  | 'projectUpdate'
  | 'projectIssueAdded'
  | 'projectIssueClosed'
  | 'projectChanged'
  /** you own an initiative whose update is due; body is `<initiativeId>|<text>` */
  | 'initiativeUpdateReminder'
  | 'projectUpdateReminder'
  | 'updatesDigest'
  | 'slaBreached'
  | 'prActivity'
  | 'loopFailed'
  | 'teamActivity'
  /** someone added you to a team; body is "<teamId>|<team name>" */
  | 'teamMemberAdded'
  | 'commentReacted'
  /** someone else changed a document you wrote; body is "<docId>|<title>" */
  | 'docChanged'
  | 'systemUpdate'
  | 'agentFinished'
  | 'agentBlocked'
  /** someone asked you (an admin or a team lead) to change a setting they can't; body is "<settings path>|<what>" */
  | 'accessRequested';

export interface Notification {
  id: string;
  type: NotificationType;
  actorId: string | null;
  issueId: string | null;
  projectId: string | null;
  body: string;
  readAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
}

export type ActivityType =
  | 'created' | 'renamed' | 'described' | 'stateChanged' | 'priorityChanged'
  | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'projected'
  | 'parented' | 'commented' | 'archived' | 'restored' | 'dueChanged'
  | 'estimateChanged' | 'related' | 'unrelated' | 'cycleChanged' | 'locationChanged' | 'milestoneChanged' | 'teamChanged'
  | 'attached' | 'triageAccepted' | 'triageDeclined' | 'deleted'
  | 'projectCreated' | 'projectUpdated' | 'projectHealth'
  | 'slaApplied' | 'slaBreached' | 'prLinked' | 'prStateMoved' | 'commitLinked' | 'loopRan';

export interface ActivityItem {
  id: string;
  issueId: string | null;
  projectId: string | null;
  userId: string;
  viaUserId: string | null;
  type: ActivityType;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  handoffPromptTemplate: string;
  terminalApp: TerminalApp;
  agentUserId: string | null;
  homeDir?: string;
  auth?: AuthMode;
  signInMethods?: SignInMethod[];
  mail?: boolean;
  lanHost?: string;
  canInvite?: boolean;
  preferences: Preferences;
  features: WorkspaceFeatures;
  security: WorkspaceSecurity;
}

export interface Preferences {
  homeView: 'my-work' | 'inbox' | 'my-issues' | 'team';
  /** 0 = Sunday, 1 = Monday */
  firstDayOfWeek: 0 | 1;
  notify: {
    assigned: boolean;
    statusChanged: boolean;
    comments: boolean;
    mentions: boolean;
  };
  displayNames: 'full' | 'first';
  convertEmoticons: boolean;
  sendCommentsOn: 'enter' | 'mod-enter';
  fontSize: 'small' | 'default' | 'large';
  pointerCursors: boolean;
  underlineLinks: boolean;
  autoAssign: boolean;
  assignOnStart: boolean;
  startOnBranchCopy: boolean;
  startOnHandoff: boolean;
  updatesSummary: 'daily' | 'weekly' | 'off';
  push: { browser: boolean; types: Record<NotifyCategory, boolean> };
  sidebar: { badgeStyle: 'count' | 'dot' | 'none'; items: Record<string, SidebarVisibility> };
  gettingStarted: GettingStarted;
}
export type PreferencesPatch = Partial<Omit<Preferences, 'gettingStarted'>> & { gettingStarted?: Partial<GettingStarted> };
export interface GettingStarted {
  onboarding: 'pending' | 'done';
  flow: 'create' | 'join';
  since: string | null;
}
export type SidebarVisibility = 'show' | 'badged' | 'hide';
export type NotifyCategory = 'agentWork' | 'assignments' | 'statusChanges' | 'comments' | 'mentions' | 'reactions' | 'subscriptions' | 'documents' | 'updates' | 'reminders' | 'loops' | 'triage';
export function notifyCategory(type: NotificationType, body = ''): NotifyCategory | null {
  switch (type) {
    case 'agentFinished': case 'agentBlocked': return 'agentWork';
    case 'issueAssignedToYou': case 'issueAssigned': return 'assignments';
    case 'issueStatusChanged': return 'statusChanges';
    case 'issueCommented': case 'issueReplied': return 'comments';
    case 'issueMentioned': return 'mentions';
    case 'commentReacted': return 'reactions';
    case 'docChanged': return 'documents';
    case 'projectIssueAdded': case 'projectIssueClosed': case 'projectChanged': case 'prActivity': return 'subscriptions';
    case 'teamActivity': return /triage/i.test(body) ? 'triage' : 'subscriptions';
    case 'teamMemberAdded': return 'subscriptions';
    case 'projectUpdate': case 'projectUpdateReminder': case 'initiativeUpdateReminder': case 'updatesDigest': return 'updates';
    case 'issueReminder': case 'slaBreached': return 'reminders';
    case 'loopFailed': return 'loops';
    default: return null;
  }
}
export const SIDEBAR_DEFAULTS: Record<string, SidebarVisibility> = { inbox: 'show', 'my-issues': 'show', drafts: 'badged', initiatives: 'show', projects: 'show', views: 'show', teams: 'hide', members: 'hide' };

export const DEFAULT_PREFERENCES: Preferences = {
  homeView: 'my-work', firstDayOfWeek: 1,
  notify: { assigned: true, statusChanged: true, comments: true, mentions: true },
  sidebar: { badgeStyle: 'count', items: {} },
  gettingStarted: { onboarding: 'done', flow: 'create', since: null },
  displayNames: 'full', convertEmoticons: true, sendCommentsOn: 'mod-enter', fontSize: 'default', pointerCursors: false, underlineLinks: false, autoAssign: true, assignOnStart: true, startOnBranchCopy: true, startOnHandoff: true, updatesSummary: 'weekly',
  push: { browser: false, types: { agentWork: true, assignments: true, statusChanges: true, comments: true, mentions: true, reactions: false, subscriptions: true, documents: true, updates: true, reminders: true, loops: true, triage: true } },
};

export const TERMINAL_APPS = ['Terminal', 'iTerm', 'Ghostty', 'Warp', 'kitty', 'Alacritty', 'WezTerm'] as const;
export type TerminalApp = typeof TERMINAL_APPS[number];
export function toTerminalApp(v: unknown): TerminalApp {
  return TERMINAL_APPS.includes(v as TerminalApp) ? v as TerminalApp : 'Terminal';
}

export interface Snapshot {
  workspace: Workspace;
  users: User[];
  teams: Team[];
  states: WorkflowState[];
  labels: Label[];
  templates: IssueTemplate[];
  issues: Issue[];
  comments: Comment[];
  attachments: Attachment[];
  subscriptions: Subscription[];
  relations: IssueRelation[];
  projects: Project[];
  projectLinks: ProjectLink[];
  docs: Doc[];
  teamLinks: TeamLink[];
  projectLabels: ProjectLabel[];
  projectStatuses: ProjectStatusDef[];
  projectSubscriptions: ProjectSubscription[];
  initiatives: Initiative[];
  initiativeUpdates: InitiativeUpdate[];
  initiativeLabels: InitiativeLabel[];
  initiativeLinks: InitiativeLink[];
  slaRules: SlaRule[];
  loops: Loop[];
  loopRuns: LoopRun[];
  pullRequests: PullRequest[];
  issuePrs: IssuePr[];
  commits: Commit[];
  issueCommits: IssueCommit[];
  teamSubscriptions: Record<string, TeamSubscription>;
  teamWorkflows: Record<string, TeamWorkflow>;
  recurring: RecurringIssue[];
  locations: Location[];
  projectUpdates: ProjectUpdate[];
  milestones: Milestone[];
  cycles: Cycle[];
  views: SavedView[];
  favorites: Favorite[];
  notifications: Notification[];
  activity: ActivityItem[];
  currentUser: User;
  updateDrafts?: ProjectUpdateDraft[];
  myApiKeys?: ApiKey[];
  invitesSent?: number;
  myGithub?: GithubTokenInfo | null;
}

export type SnapshotSection = keyof Snapshot;
/** every part of a Snapshot, by name: `GET /api/bootstrap?sections=` accepts exactly these */
const SNAPSHOT_SECTIONS: Record<SnapshotSection, true> = {
  workspace: true, users: true, teams: true, states: true, labels: true, templates: true, issues: true, comments: true,
  attachments: true, subscriptions: true, relations: true, projects: true, projectLinks: true, docs: true, teamLinks: true,
  projectLabels: true, projectStatuses: true, projectSubscriptions: true,

  initiatives: true, initiativeUpdates: true, initiativeLabels: true, initiativeLinks: true, slaRules: true,
  loops: true, loopRuns: true, pullRequests: true, issuePrs: true, commits: true, issueCommits: true,
  teamSubscriptions: true, teamWorkflows: true, recurring: true, locations: true, projectUpdates: true, milestones: true,
  cycles: true, views: true, favorites: true, notifications: true, activity: true, currentUser: true, updateDrafts: true, myApiKeys: true, invitesSent: true, myGithub: true,
};
export const isSnapshotSection = (s: string): s is SnapshotSection => Object.hasOwn(SNAPSHOT_SECTIONS, s);

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export const PRIORITY_SHORT: Record<Priority, string> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export const STATE_TYPE_LABELS: Record<WorkflowStateType, string> = {
  triage: 'Triage',
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In Progress',
  completed: 'Done',
  canceled: 'Canceled',
};

export function issueKey(issue: Pick<Issue, 'teamId' | 'number'>, teams: Team[]): string {
  const team = teams.find((t) => t.id === issue.teamId);
  return `${team?.key ?? 'ISS'}-${issue.number}`;
}
