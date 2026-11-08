// Domain model shared by server, CLI and web surfaces.
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
  /** job title or role (Settings › Profile) */
  title?: string;
  /** one word, like a nickname — used for {username} in branch names */
  username?: string;
  /** GitHub login (Settings › Profile): PRs by this login are attributed to and assign this user */
  githubUsername?: string;
  /** uploaded profile picture, or the Google one on a hosted server (null/'' = show initials) */
  avatarUrl?: string | null;
  /** suspended people can't sign in; their work stays */
  status: 'active' | 'suspended';
  /** when they joined the workspace (null for people from before this was recorded) */
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
  /** issues from agents and other teams wait in a Triage state until someone accepts them */
  triageEnabled: boolean;
  /** cycle automation: keep the current cycle plus `cycleUpcoming` future ones scheduled */
  autoCycles: boolean;
  /** weeks per cycle */
  cycleDuration: number;
  /** weeks of cooldown between cycles */
  cycleCooldown: number;
  /** how many future cycles automation keeps scheduled */
  cycleUpcoming: number;
  /** unfinished issues move into the next cycle when a cycle ends */
  cycleRollover: boolean;
  estimateScale: EstimateScale;
  /** people who belong to the team (its "Your teams" entry); anyone can still open the team */
  memberIds: string[];
  /** issues can be estimated with zero points */
  estimateZero?: boolean;
  /** the scale goes further (13, 21… / 32, 64…) */
  estimateExtended?: boolean;
  /** unestimated issues count as 1 point in totals */
  estimateCountUnestimated?: boolean;
}

export type EstimateScale = 'none' | 'linear' | 'exponential' | 'fibonacci' | 'tshirt';
/** point values offered for each scale; t-shirt sizes store their point equivalents */
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
/** the points a team offers, with its zero / extended options applied */
export function teamScale(team: Pick<Team, 'estimateScale' | 'estimateZero' | 'estimateExtended'> | undefined): Array<{ value: number; label: string }> {
  const scale = team?.estimateScale ?? 'fibonacci';
  if (scale === 'none') return [];
  return [...(team?.estimateZero ? [{ value: 0, label: '0' }] : []), ...ESTIMATE_SCALES[scale], ...(team?.estimateExtended ? EXTENDED[scale] : [])];
}
/** an issue's weight in point totals: unestimated counts as 1 where the team says so */
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
  /** where coding agents work on this issue — one location per task (null = not set) */
  locationId: string | null;
  /** project milestone this issue counts toward (only meaningful with a project) */
  milestoneId: string | null;
  /** who created it (null for issues older than creator tracking) */
  creatorId: string | null;
  /** triage: hidden from the queue until this time */
  snoozedUntil: string | null;
  /** the release it ships in */
  releaseId?: string | null;
  /** the Ask form it was filed through */
  askFormId?: string | null;
  /** SLA: the rule that applies and when it breaches (cleared once the issue closes) */
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
  /** the person an agent user wrote this for ("Agent via Parth"); null when a person wrote it */
  viaUserId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** emoji -> user ids */
  reactions: Record<string, string[]>;
  resolvedAt: string | null;
  /** thread root this comment replies to (null = top-level comment) */
  parentId: string | null;
}

/** a link or an uploaded file hanging off an issue */
export interface Attachment {
  id: string;
  issueId: string;
  userId: string;
  kind: 'link' | 'file';
  /** links: the target; files: the app URL serving the file */
  url: string;
  title: string;
  mime: string;
  size: number;
  createdAt: string;
}

/** what an uploaded file belongs to; the file is deleted when its owner is */
export type FileOwnerType = 'issue' | 'doc' | 'project' | 'initiative' | 'team' | 'avatar' | 'emoji' | 'workspace';
export const FILE_OWNER_TYPES: FileOwnerType[] = ['issue', 'doc', 'project', 'initiative', 'team', 'avatar', 'emoji', 'workspace'];

/** an uploaded image (profile picture, emoji, picture pasted into an editor); its bytes live in SQLite */
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
  /** the app URL serving it */
  url: string;
}

/** issue → users who get notified about it */
export interface Subscription {
  issueId: string;
  userId: string;
}

/** Team-scoped starter text for new issues. Empty title = leave the title alone on apply. */
export interface IssueTemplate {
  id: string;
  teamId: string;
  name: string;
  title: string;
  description: string;
  position: number;
  createdAt: string;
}

/** Ready-to-paste prompt + branch for handing an issue to a coding agent. */
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
  /** one-line summary shown under the name and in lists */
  summary: string;
  description: string;
  icon: string;
  color: string;
  status: ProjectStatus;
  health: ProjectHealth;
  /** 0 = no priority, 1 = urgent … 4 = low (same scale as issues) */
  priority: Priority;
  /** locations this project's work happens in (a location can serve several projects) */
  locationIds: string[];
  startDate: string | null;
  targetDate: string | null;
  leadId: string | null;
  memberIds: string[];
  /** workspace project labels (Settings › Projects › Labels) */
  labelIds: string[];
  /** initiatives this project belongs to (derived) */
  initiativeIds?: string[];
  /** the named status (Settings › Projects › Statuses); `status` is its category */
  statusId: string | null;
  /** how often updates are expected; null follows the workspace schedule */
  updateCadence: UpdateCadence | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type UpdateCadence = 'none' | 'weekly' | 'biweekly' | 'monthly';
export const UPDATE_CADENCE_LABELS: Record<UpdateCadence, string> = { none: 'No expectation for updates', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

/* ---------- initiatives ---------- */
export type InitiativeStatus = 'proposed' | 'planned' | 'active' | 'completed' | 'canceled';
/** how precise a target date is: Linear lets a target be a day, a month, a quarter, a half or a year */
export type DateResolution = 'day' | 'month' | 'quarter' | 'half' | 'year';
/** a strategic effort grouping projects (and sub-initiatives), with its own updates and health */
export interface Initiative {
  id: string; name: string; description: string; icon: string; color: string;
  /** one-line summary shown under the name in lists and on the overview */
  summary: string;
  status: InitiativeStatus; health: ProjectHealth | null; ownerId: string | null; targetDate: string | null;
  /** targetDate is the last day of this period (null = a plain day) */
  targetResolution: DateResolution | null;
  parentId: string | null; projectIds: string[]; position: number; createdAt: string; updatedAt: string;
  /** sequential number, shown as I-12 */
  number: number;
  /** 0 = no priority, 1 = urgent … 4 = low (same scale as projects) */
  priority: Priority;
  /** initiative labels (Settings › Initiatives) */
  labelIds: string[];
  /** the team that leads the initiative */
  teamId: string | null;
  /** how often the owner is expected to post an update; null follows the workspace schedule */
  updateCadence: UpdateCadence | null;
}
/** an initiative's key: I-12 */
export const initiativeKey = (ini: Pick<Initiative, 'number'>) => `I-${ini.number}`;
export interface InitiativeUpdate {
  id: string; initiativeId: string; userId: string; body: string; health: ProjectHealth | null; createdAt: string;
  /** emoji -> user ids */
  reactions: Record<string, string[]>;
}
/** workspace initiative label (Settings › Initiatives) */
export interface InitiativeLabel { id: string; name: string; color: string; description: string; createdAt: string }
/** a resource link on an initiative */
export interface InitiativeLink { id: string; initiativeId: string; url: string; title: string; createdAt: string }

/* ---------- releases ---------- */
export type ReleaseStage = 'planned' | 'started' | 'released' | 'canceled';
/** which issues ship in a version */
export interface Release { id: string; name: string; description: string; stage: ReleaseStage; teamId: string | null; targetDate: string | null; releasedAt: string | null; createdAt: string }

/* ---------- SLAs ---------- */
/** an automation rule: issues matching it get a deadline `hours` after they start matching */
export interface SlaRule { id: string; name: string; teamId: string | null; priorities: Priority[]; labelIds: string[]; hours: number; enabled: boolean; createdAt: string }

/* ---------- asks (intake forms) ---------- */
export interface AskField { id: string; label: string; type: 'text' | 'textarea' | 'select'; options: string[]; required: boolean }
/** a structured intake form; each submission becomes an issue in the team's triage */
export interface AskForm { id: string; name: string; description: string; teamId: string; fields: AskField[]; labelIds: string[]; priority: Priority; enabled: boolean; createdAt: string }

/* ---------- loops (automations) ---------- */
export type LoopTrigger = { kind: 'schedule'; cadence: 'hourly' | 'daily' | 'weekly' } | { kind: 'issueCreated' } | { kind: 'labelAdded'; labelId: string } | { kind: 'statusChanged'; stateType: WorkflowStateType };
export type LoopAction =
  | { kind: 'assign'; userId: string }
  | { kind: 'comment'; body: string }
  | { kind: 'label'; labelId: string }
  | { kind: 'status'; stateType: WorkflowStateType }
  | { kind: 'createIssue'; title: string; description: string }
  | { kind: 'claudeCode' };
/** a workflow that runs on a schedule or when issues change — "Agent workflows" in Linear */
export interface Loop { id: string; name: string; teamId: string | null; trigger: LoopTrigger; actions: LoopAction[]; enabled: boolean; lastRunAt: string | null; createdAt: string }
export interface LoopRun { id: string; loopId: string; issueId: string | null; ok: boolean; detail: string; createdAt: string }

/* ---------- git / GitHub (Linear's GitHub integration rules; TEAM_PLAN.md Phase 4) ---------- */
/** a GitHub webhook delivery as Baseline handled it (Settings › GitHub shows the recent ones) */
export interface WebhookDelivery { id: number; delivery: string; event: string; action: string | null; repo: string | null; status: 'processed' | 'ignored' | 'rejected'; detail: string; receivedAt: string }
export interface WebhookConfig { enabled: boolean; secretHint: string | null; publicUrl: string; /** hosted: publicUrl is BASELINE_PUBLIC_URL's and can't be edited */ fixedUrl: boolean; events: readonly string[]; lastDelivery: WebhookDelivery | null; received: number; rejected: number; imports: Array<{ repo: string; teamId: string }> }
export type PrState = 'draft' | 'open' | 'merged' | 'closed';
export interface PullRequest {
  id: string; repo: string; number: number; title: string; body: string; url: string; state: PrState;
  branch: string; base: string; author: string; reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;
  checks: 'success' | 'failure' | 'pending' | null; updatedAt: string; mergedAt: string | null;
}
/** closing links move the issue; ref links only show; related links add a relation-style mention */
export interface IssuePr { issueId: string; prId: string; kind: 'closing' | 'ref' | 'related'; dismissed: boolean }
export interface Commit { sha: string; repo: string; message: string; author: string; branch: string; committedAt: string }
export interface IssueCommit { issueId: string; sha: string }
export interface TeamSubscription { issueAdded: boolean; issueClosed: boolean; triage: boolean }
/** a team's Workflows & automations (Linear's auto-close, auto-archive and re-order settings) */
export interface TeamWorkflow {
  /** close an open parent when its last sub-issue closes */
  closeParent: boolean;
  /** close the open sub-issues when their parent closes */
  closeSubIssues: boolean;
  /** close issues nobody has touched in `staleMonths` */
  closeStale: boolean;
  staleMonths: number;
  /** the status stale issues move to (null: the team's first canceled status) */
  staleStateId: string | null;
  /** archive closed issues this many months after they closed (0: never) */
  archiveMonths: number;
  /** where an issue lands in its new status column when its status moves forward */
  reorder: 'first' | 'last' | 'none';
}
export const DEFAULT_TEAM_WORKFLOW: TeamWorkflow = { closeParent: false, closeSubIssues: false, closeStale: false, staleMonths: 6, staleStateId: null, archiveMonths: 6, reorder: 'first' };
export type ApiKeyScope = 'read' | 'write' | 'createIssues' | 'createComments' | 'admin';
/** a personal API key; the token itself is shown once and never stored */
export interface ApiKey {
  id: string;
  name: string;
  userId: string;
  /** last four characters of the token */
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

/** workspace project label; a label with isGroup holds others (parentId) */
export interface ProjectLabel { id: string; name: string; color: string; description: string; parentId: string | null; isGroup: boolean; createdAt: string }

/** a named project status inside one of the six categories */
export interface ProjectStatusDef { id: string; type: ProjectStatus; name: string; color: string; description: string; position: number }

/** the bell on a project page: which project events reach your inbox */
export interface ProjectSubscription { projectId: string; userId: string; issueAdded: boolean; issueClosed: boolean; comments: boolean; updates: boolean }

/** workspace document templates (Settings › Documents) */
export interface DocTemplate { id: string; name: string; title: string; content: string; createdAt: string }

/** custom emoji, usable as :name: and in reactions */
export interface CustomEmoji { id: string; name: string; url: string; createdAt: string }

export interface Customer { id: string; name: string; domains: string[]; statusId: string | null; tierId: string | null; revenue: number | null; size: number | null; ownerId: string | null; createdAt: string }
export interface CustomerStatus { id: string; name: string; color: string; position: number }
export interface CustomerTier { id: string; name: string; color: string; position: number }
/** a customer asking for an issue or a project, with what they said */
export interface CustomerRequest { id: string; customerId: string; issueId: string | null; projectId: string | null; body: string; important: boolean; creatorId: string | null; createdAt: string }

/** workspace feature settings (Settings › Features and Settings › Projects) */
export interface WorkspaceFeatures {
  /** default project update schedule */
  updateCadence: UpdateCadence;
  /** default initiative update schedule (Settings › Initiatives) */
  initiativeUpdateCadence: UpdateCadence;
  pulseEnabled: boolean;
  /** Pulse summary notifications */
  pulseSchedule: 'daily' | 'weekly' | 'never';
  customerRequestsEnabled: boolean;
  /** new issues created from a customer page go to this team's triage or backlog */
  customerDefaultTeamId: string | null;
  initiativesEnabled: boolean;
  releasesEnabled: boolean;
  /** git / GitHub: poll `gh` for pull requests in your locations' repos */
  githubEnabled: boolean;
  /** branch name format for "Copy git branch": {issueIdentifier} {issueTitle} {username} */
  branchFormat: string;
  /** who may create personal API keys */
  apiKeyCreation: 'all' | 'admins';
  /** when BASELINE_HOST opens Baseline to the network, requests from other devices need an API key */
  apiKeyRequiredRemote: boolean;
}
/** who may join a hosted workspace without a personal invite, and who may invite */
export interface WorkspaceSecurity {
  /** Google Workspace domains (e.g. acme.dev) whose accounts join as members on first sign-in */
  approvedDomains: string[];
  /** teams people joining through an approved domain are added to */
  domainTeamIds: string[];
  whoCanInvite: 'admins' | 'members';
}
export const DEFAULT_SECURITY: WorkspaceSecurity = { approvedDomains: [], domainTeamIds: [], whoCanInvite: 'admins' };

export type AuthMode = 'local' | 'hosted';
/** a hosted server always offers 'password'; 'google' when a Google OAuth client is configured */
export type SignInMethod = 'password' | 'google';
/** shared with the web app so its forms ask for what the server will accept */
export const PASSWORD_MIN = 10;

/** a pending invite as admins see it (joining still needs the invited Google account, or typing the invited address) */
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

/** what happened to one address in an invite request */
export interface InviteResult {
  email: string;
  status: 'invited' | 'already-member' | 'invalid';
  invite?: Invite;
  /** 'off': no SMTP on this server — share the link instead */
  emailed?: 'sent' | 'failed' | 'off';
  error?: string;
}

export const DEFAULT_FEATURES: WorkspaceFeatures = { updateCadence: 'none', initiativeUpdateCadence: 'none', pulseEnabled: true, pulseSchedule: 'never', customerRequestsEnabled: false, customerDefaultTeamId: null, initiativesEnabled: true, releasesEnabled: true, githubEnabled: false, branchFormat: '{username}/{issueIdentifier}-{issueTitle}', apiKeyCreation: 'all', apiKeyRequiredRemote: false };

/** a directory on this machine that coding agents can work in — usually a git repo */
export interface Location {
  id: string;
  name: string;
  /** absolute path */
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

/** a document: a markdown page that lives on a project or a team */
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

/** a resource link on a team's home page */
export interface TeamLink {
  id: string;
  teamId: string;
  url: string;
  title: string;
  createdAt: string;
}

/** starter content for new projects: fields, plus milestones and issues created with it */
export interface ProjectTemplate {
  id: string;
  name: string;
  icon: string;
  summary: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  /** milestone names created with the project */
  milestones: string[];
  /** issue titles filed into the project when it's created */
  issues: string[];
  createdAt: string;
}

/** project → project dependency ("this project blocks that one") */
export interface ProjectRelation {
  id: string;
  projectId: string;
  relatedProjectId: string;
  type: 'blocks';
}

/** an issue that files itself again on a cadence (Linear's recurring issues) */
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
  /** when the next copy is created */
  nextAt: string;
  createdAt: string;
}

/** a resource on a project: a link to a doc, a design, a repo… */
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
  /** the person an agent user wrote this for ("Agent via Parth"); null when a person wrote it */
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
  /** 'projects' views save the projects page's filters and display instead of issue filters */
  kind: 'issues' | 'projects';
  /** the projects page options (filters, grouping, ordering, layout, properties) for project views */
  projectOptions: Record<string, unknown> | null;
  /** who saved it */
  ownerId: string | null;
  /** false: only its owner sees it (a personal view) */
  shared: boolean;
}

export interface ViewFilters {
  states?: string[];        // state ids
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
  /** release ids; 'none' = no release */
  releaseIds?: string[];
  /** SLA status */
  sla?: Array<'breached' | 'risk' | 'ok' | 'none'>;
  /** linked pull request state */
  prs?: Array<'open' | 'draft' | 'merged' | 'none'>;
  /** estimate values; -1 = no estimate */
  estimates?: number[];
  due?: Array<'overdue' | 'today' | 'week' | 'month' | 'none' | 'any'>;
  created?: 'day' | 'week' | 'month' | 'quarter';
  updated?: 'day' | 'week' | 'month' | 'quarter';
  /** structure filters */
  hierarchy?: Array<'parent' | 'subissue' | 'standalone'>;
  relations?: Array<'blocked' | 'blocking' | 'related' | 'duplicate'>;
  /** user ids following the issue; 'me' = the current user */
  subscriberIds?: string[];
  links?: Array<'any' | 'none'>;
  query?: string;
  /** fields negated by the pill's "is not" operator */
  not?: string[];
  /** advanced filter: conditions combined with and/or, groups nest */
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
  /** a reminder you set on an issue ("Remind me", ⇧H) — held back until its time */
  | 'issueReminder'
  | 'projectUpdate'
  /** project bell: an issue joined the project / was completed or canceled / the description or a comment changed */
  | 'projectIssueAdded'
  | 'projectIssueClosed'
  | 'projectChanged'
  /** you lead a project whose update is due */
  /** you own an initiative whose update is due; body is `<initiativeId>|<text>` */
  | 'initiativeUpdateReminder'
  | 'projectUpdateReminder'
  /** Pulse summary of recent project updates */
  | 'pulseDigest'
  /** an issue assigned to you breached (or is about to breach) its SLA */
  | 'slaBreached'
  /** a pull request linked to an issue you follow opened, got reviewed or merged */
  | 'prActivity'
  /** a loop failed to run */
  | 'loopFailed'
  /** team bell: an issue was added to a team you follow, closed, or landed in its triage */
  | 'teamActivity'
  /** someone added you to a team; body is "<teamId>|<team name>" */
  | 'teamMemberAdded'
  /** someone reacted to your comment */
  | 'commentReacted'
  /** someone else changed a document you wrote; body is "<docId>|<title>" */
  | 'docChanged'
  /** raised by the app itself — no human actor, so the inbox row signs with the tile */
  | 'systemUpdate';

export interface Notification {
  id: string;
  type: NotificationType;
  actorId: string | null;
  issueId: string | null;
  projectId: string | null;
  body: string;
  readAt: string | null;
  /** hidden from the inbox until this time */
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
  | 'releaseChanged' | 'slaApplied' | 'slaBreached' | 'prLinked' | 'prStateMoved' | 'commitLinked' | 'loopRan' | 'askSubmitted';

export interface ActivityItem {
  id: string;
  issueId: string | null;
  projectId: string | null;
  userId: string;
  /** the person an agent user wrote this for ("Agent via Parth"); null when a person wrote it */
  viaUserId: string | null;
  type: ActivityType;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  /** resolved handoff prompt template (meta value or code default) */
  handoffPromptTemplate: string;
  /** macOS app that interactive Claude Code sessions open in */
  terminalApp: TerminalApp;
  /** the workspace's agent user — agent sessions write as it, on a person's behalf */
  agentUserId: string | null;
  /** the server's home directory, so the web app can show paths as ~/… (server memory) */
  homeDir?: string;
  /** 'local' = this machine only, no sign-in; 'hosted' = people sign in (see signInMethods) */
  auth?: AuthMode;
  /** hosted only: the ways people can sign in here */
  signInMethods?: SignInMethod[];
  /** hosted only: the server sends email, so invite and reset links are emailed as well as copyable */
  mail?: boolean;
  /** set when BASELINE_HOST opens the server to other devices */
  lanHost?: string;
  preferences: Preferences;
  features: WorkspaceFeatures;
  security: WorkspaceSecurity;
}

/** per-install preferences (one person per local install) */
export interface Preferences {
  /** where the app opens */
  homeView: 'inbox' | 'my-issues' | 'team';
  /** 0 = Sunday, 1 = Monday */
  firstDayOfWeek: 0 | 1;
  /** which events raise inbox notifications */
  notify: {
    assigned: boolean;
    statusChanged: boolean;
    comments: boolean;
    mentions: boolean;
  };
  /** how people's names show: full name, or first name only */
  displayNames: 'full' | 'first';
  /** turn :) and friends into emoji as you type */
  convertEmoticons: boolean;
  /** the key that sends a comment: Enter (⇧↵ for a new line) or ⌘↵ */
  sendCommentsOn: 'enter' | 'mod-enter';
  fontSize: 'small' | 'default' | 'large';
  /** show the hand cursor on clickable things */
  pointerCursors: boolean;
  /** always underline links in text content */
  underlineLinks: boolean;
  /** new issues start assigned to you */
  autoAssign: boolean;
  /** moving an unassigned issue to a started status assigns it to you */
  assignOnStart: boolean;
  /** copying an issue's git branch moves an unstarted / backlog issue to started and assigns you */
  startOnBranchCopy: boolean;
  /** the same for Copy as prompt and Open in Claude Code */
  startOnHandoff: boolean;
  /** Settings › Notifications › Desktop: browser notifications, and which kinds */
  push: { desktop: boolean; types: Record<NotifyCategory, boolean> };
  /** Customize sidebar: badge style, and when each item shows (hidden ones move to More) */
  sidebar: { badgeStyle: 'count' | 'dot' | 'none'; items: Record<string, SidebarVisibility> };
  /** the first-run flow and the help menu's Getting started checklist */
  gettingStarted: GettingStarted;
}
/** a preferences change: nested groups merge, so a patch names only what it changes */
export type PreferencesPatch = Partial<Omit<Preferences, 'gettingStarted'>> & { gettingStarted?: Partial<GettingStarted> };
export interface GettingStarted {
  /** 'pending' keeps the first-run flow up (from `step`) until it ends on the first issue */
  onboarding: 'pending' | 'done';
  step: number;
  /** when the flow ended: issues and projects made after it count toward the checklist */
  since: string | null;
  usedPalette: boolean;
  /** the checklist was closed from the help menu */
  dismissed?: boolean;
}
export type SidebarVisibility = 'show' | 'badged' | 'hide';
/** the kinds Linear's notification settings speak in */
export type NotifyCategory = 'assignments' | 'statusChanges' | 'comments' | 'mentions' | 'reactions' | 'subscriptions' | 'documents' | 'updates' | 'reminders' | 'loops' | 'triage';
export const NOTIFY_CATEGORIES: Array<[NotifyCategory, string, string]> = [
  ['assignments', 'Assignments', 'Assignments, unassignments, and membership changes'],
  ['statusChanges', 'Status changes', 'Changes to the status, priority, and blocking relationships of issues'],
  ['comments', 'Comments and replies', 'Comments, replies, and thread resolutions'],
  ['mentions', 'Mentions', 'Mentions in comments or content'],
  ['reactions', 'Reactions', 'Emoji reactions to your content'],
  ['subscriptions', 'Subscriptions', 'Issues, projects, teams, and pull requests you’re subscribed to'],
  ['documents', 'Document changes', 'Changes to document content, location, and subscriptions'],
  ['updates', 'Updates', 'New project & initiative updates and reminders to post an update'],
  ['reminders', 'Reminders and deadlines', 'Reminders, due dates, and SLA updates'],
  ['loops', 'Loops', 'Messages, responses, and failures from loops'],
  ['triage', 'Triage', 'Issues added to triage'],
];
export function notifyCategory(type: NotificationType, body = ''): NotifyCategory | null {
  switch (type) {
    case 'issueAssignedToYou': case 'issueAssigned': return 'assignments';
    case 'issueStatusChanged': return 'statusChanges';
    case 'issueCommented': case 'issueReplied': return 'comments';
    case 'issueMentioned': return 'mentions';
    case 'commentReacted': return 'reactions';
    case 'docChanged': return 'documents';
    case 'projectIssueAdded': case 'projectIssueClosed': case 'projectChanged': case 'prActivity': return 'subscriptions';
    case 'teamActivity': return /triage/i.test(body) ? 'triage' : 'subscriptions';
    case 'teamMemberAdded': return 'subscriptions';
    case 'projectUpdate': case 'projectUpdateReminder': case 'initiativeUpdateReminder': case 'pulseDigest': return 'updates';
    case 'issueReminder': case 'slaBreached': return 'reminders';
    case 'loopFailed': return 'loops';
    default: return null;
  }
}
export const SIDEBAR_DEFAULTS: Record<string, SidebarVisibility> = { inbox: 'show', 'my-issues': 'show', drafts: 'badged', initiatives: 'show', projects: 'show', views: 'show', releases: 'show', asks: 'hide', pulse: 'show', customers: 'show', teams: 'hide', members: 'hide' };

export const DEFAULT_PREFERENCES: Preferences = {
  homeView: 'inbox', firstDayOfWeek: 1,
  notify: { assigned: true, statusChanged: true, comments: true, mentions: true },
  sidebar: { badgeStyle: 'count', items: {} },
  gettingStarted: { onboarding: 'done', step: 0, since: null, usedPalette: false },
  displayNames: 'full', convertEmoticons: true, sendCommentsOn: 'mod-enter', fontSize: 'default', pointerCursors: false, underlineLinks: false, autoAssign: false, assignOnStart: false, startOnBranchCopy: true, startOnHandoff: true,
  push: { desktop: false, types: { assignments: true, statusChanges: true, comments: true, mentions: true, reactions: false, subscriptions: true, documents: true, updates: true, reminders: true, loops: true, triage: true } },
};

/** macOS terminals interactive sessions can open in, by app name (`open -a <name>`) */
export const TERMINAL_APPS = ['Terminal', 'iTerm', 'Ghostty', 'Warp', 'kitty', 'Alacritty', 'WezTerm'] as const;
export type TerminalApp = typeof TERMINAL_APPS[number];
export function toTerminalApp(v: unknown): TerminalApp {
  return TERMINAL_APPS.includes(v as TerminalApp) ? v as TerminalApp : 'Terminal';
}

/** Full client snapshot — small scale, so the web app boots from one payload. */
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
  projectTemplates: ProjectTemplate[];
  projectRelations: ProjectRelation[];
  projectLabels: ProjectLabel[];
  projectStatuses: ProjectStatusDef[];
  projectSubscriptions: ProjectSubscription[];
  docTemplates: DocTemplate[];
  emojis: CustomEmoji[];
  customers: Customer[];
  customerStatuses: CustomerStatus[];
  customerTiers: CustomerTier[];
  customerRequests: CustomerRequest[];
  initiatives: Initiative[];
  initiativeUpdates: InitiativeUpdate[];
  initiativeLabels: InitiativeLabel[];
  initiativeLinks: InitiativeLink[];
  releases: Release[];
  slaRules: SlaRule[];
  askForms: AskForm[];
  loops: Loop[];
  loopRuns: LoopRun[];
  pullRequests: PullRequest[];
  issuePrs: IssuePr[];
  commits: Commit[];
  issueCommits: IssueCommit[];
  /** the team bell: which team events reach your inbox */
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
  /** current user for this local install */
  currentUser: User;
  /** project updates an agent drafted for the requesting person, never anyone else's. Only
   *  GET /api/bootstrap fills it: the store's own snapshot doesn't know who is asking. */
  updateDrafts?: ProjectUpdateDraft[];
}

export type SnapshotSection = keyof Snapshot;
/** every part of a Snapshot, by name: `GET /api/bootstrap?sections=` accepts exactly these
 *  (a Record over keyof Snapshot, so a new part that isn't listed here fails the build) */
const SNAPSHOT_SECTIONS: Record<SnapshotSection, true> = {
  workspace: true, users: true, teams: true, states: true, labels: true, templates: true, issues: true, comments: true,
  attachments: true, subscriptions: true, relations: true, projects: true, projectLinks: true, docs: true, teamLinks: true,
  projectTemplates: true, projectRelations: true, projectLabels: true, projectStatuses: true, projectSubscriptions: true,
  docTemplates: true, emojis: true, customers: true, customerStatuses: true, customerTiers: true, customerRequests: true,
  initiatives: true, initiativeUpdates: true, initiativeLabels: true, initiativeLinks: true, releases: true, slaRules: true,
  askForms: true, loops: true, loopRuns: true, pullRequests: true, issuePrs: true, commits: true, issueCommits: true,
  teamSubscriptions: true, teamWorkflows: true, recurring: true, locations: true, projectUpdates: true, milestones: true,
  cycles: true, views: true, favorites: true, notifications: true, activity: true, currentUser: true, updateDrafts: true,
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
