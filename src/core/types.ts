// Domain model shared by server, CLI and web surfaces.

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
}

export type EstimateScale = 'none' | 'linear' | 'exponential' | 'fibonacci' | 'tshirt';
/** point values offered for each scale; t-shirt sizes store their point equivalents */
export const ESTIMATE_SCALES: Record<EstimateScale, Array<{ value: number; label: string }>> = {
  none: [],
  linear: [1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) })),
  exponential: [1, 2, 4, 8, 16].map(v => ({ value: v, label: String(v) })),
  fibonacci: [0, 1, 2, 3, 5, 8, 13, 21].map(v => ({ value: v, label: String(v) })),
  tshirt: [[1, 'XS'], [2, 'S'], [3, 'M'], [5, 'L'], [8, 'XL']].map(([v, l]) => ({ value: v as number, label: l as string })),
};

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
  pulseEnabled: boolean;
  /** Pulse summary notifications */
  pulseSchedule: 'daily' | 'weekly' | 'never';
  customerRequestsEnabled: boolean;
  /** new issues created from a customer page go to this team's triage or backlog */
  customerDefaultTeamId: string | null;
}
export const DEFAULT_FEATURES: WorkspaceFeatures = { updateCadence: 'none', pulseEnabled: true, pulseSchedule: 'never', customerRequestsEnabled: false, customerDefaultTeamId: null };

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
  type: 'issue' | 'project' | 'view' | 'cycle';
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
  | 'projectUpdateReminder'
  /** Pulse summary of recent project updates */
  | 'pulseDigest'
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
  | 'projectCreated' | 'projectUpdated' | 'projectHealth';

export interface ActivityItem {
  id: string;
  issueId: string | null;
  projectId: string | null;
  userId: string;
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
  /** the "Claude Code" agent user — interactive sessions post under it */
  agentUserId: string | null;
  /** the server's home directory, so the web app can show paths as ~/… (server memory) */
  homeDir?: string;
  preferences: Preferences;
  features: WorkspaceFeatures;
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
  /** Customize sidebar: badge style, and when each item shows (hidden ones move to More) */
  sidebar: { badgeStyle: 'count' | 'dot' | 'none'; items: Record<string, SidebarVisibility> };
}
export type SidebarVisibility = 'show' | 'badged' | 'hide';
export const SIDEBAR_DEFAULTS: Record<string, SidebarVisibility> = { inbox: 'show', 'my-issues': 'show', drafts: 'badged', projects: 'show', views: 'show', pulse: 'show', customers: 'show', teams: 'hide', members: 'hide' };

export const DEFAULT_PREFERENCES: Preferences = {
  homeView: 'inbox', firstDayOfWeek: 1,
  notify: { assigned: true, statusChanged: true, comments: true, mentions: true },
  sidebar: { badgeStyle: 'count', items: {} },
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
}

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
