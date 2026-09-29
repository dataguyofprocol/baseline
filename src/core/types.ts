// Domain model shared by server, CLI and web surfaces.

export type WorkflowStateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

/** 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low */
export type Priority = 0 | 1 | 2 | 3 | 4;

export type ProjectStatus = 'planned' | 'started' | 'completed' | 'paused';
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
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

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
}

export interface ViewFilters {
  states?: string[];        // state ids
  stateTypes?: WorkflowStateType[];
  priority?: Priority[];
  assigneeIds?: string[];
  labelIds?: string[];
  projectIds?: string[];
  query?: string;
}

export type GroupBy = 'status' | 'priority' | 'assignee' | 'label' | 'project' | 'cycle' | 'none';
export type OrderBy = 'priority' | 'updated' | 'created' | 'due' | 'manual' | 'title';

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
  | 'projectUpdate'
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
  createdAt: string;
}

export type ActivityType =
  | 'created' | 'renamed' | 'described' | 'stateChanged' | 'priorityChanged'
  | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'projected'
  | 'parented' | 'commented' | 'archived' | 'restored' | 'dueChanged'
  | 'estimateChanged' | 'related' | 'cycleChanged' | 'locationChanged' | 'projectCreated' | 'projectUpdated' | 'projectHealth';

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
}

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
  relations: IssueRelation[];
  projects: Project[];
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
