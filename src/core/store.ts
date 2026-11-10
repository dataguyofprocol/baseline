import type { DatabaseSync } from 'node:sqlite';
import { getMeta, migrateDirectoriesToLocations, setMeta, ensureDefaults, ensureWorkspaceAgent } from './db.js';
import { id, nowIso, midSort, normalizeDir } from './util.js';
import { buildHandoff, DEFAULT_PROMPT_TEMPLATE } from './handoff.js';
import { actingUser, currentOp, viaFor } from './actor.js';
import { mentionedIds, plainMentions, plainText } from './mentions.js';
import type {
  ActivityItem, ActivityType, Attachment, RecurringIssue, Doc, TerminalApp, Comment, Location, Cycle, Favorite, Handoff, Preferences, PreferencesPatch, EstimateScale,
  Issue, IssueRelation, IssueTemplate, Label, Milestone, Notification, NotificationType, Priority, Project, ProjectUpdate,
  RelationType, SavedView, Snapshot, Team, User, ViewFilters, GroupBy, OrderBy,
  WorkflowState, WorkflowStateType, UpdateCadence, ProjectStatusDef, ProjectSubscription, ProjectLabel,
  WorkspaceFeatures,
} from './types.js';
import { toTerminalApp, DEFAULT_PREFERENCES, DEFAULT_FEATURES, DEFAULT_SECURITY, type GettingStarted, type WorkspaceSecurity } from './types.js';
import { createExtensions, type Extensions } from './extensions.js';

interface TeamRow { id: string; key: string; name: string; icon: string; color: string; description: string; position: number; triage_enabled: number; auto_cycles: number; cycle_duration: number; cycle_cooldown: number; cycle_upcoming: number; cycle_rollover: number; estimate_scale: string; estimate_zero?: number; estimate_extended?: number; estimate_count_unestimated?: number }
interface CommentRow { id: string; issue_id: string; user_id: string; via_user_id: string | null; body: string; created_at: string; edited_at: string | null; reactions: string; resolved_at: string | null; parent_id: string | null }
interface AttachmentRow { id: string; issue_id: string; user_id: string; kind: string; url: string; title: string; mime: string; size: number; created_at: string }
const DAY = 86400000;
/** activity types of removed features: old databases keep the rows, the timeline no longer shows them */
const RETIRED_ACTIVITY = ['releaseChanged', 'askSubmitted'].map(t => `'${t}'`).join(', ');

interface IssueRow { id: string; team_id: string; number: number; title: string; description: string; state_id: string; priority: number; assignee_id: string | null; project_id: string | null; cycle_id: string | null; parent_id: string | null; location_id: string | null; milestone_id: string | null; creator_id: string | null; snoozed_until: string | null; estimate: number | null; due_date: string | null; sort_order: number; labels: string; created_at: string; updated_at: string; archived_at: string | null; completed_at: string | null; canceled_at: string | null; deleted_at: string | null; sla_rule_id?: string | null; sla_breaches_at?: string | null; }
interface TemplateRow { id: string; team_id: string; name: string; title: string; description: string; position: number; created_at: string; }

function ts(): string { return nowIso(); }
/** notification kinds whose body is text someone wrote (stored as a plain-text preview) */
const PLAIN_BODY = new Set<NotificationType>(['issueCommented', 'issueMentioned', 'issueReplied', 'commentReacted', 'projectUpdate', 'agentFinished', 'agentBlocked']);
function clip(s: string, n: number): string { return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; }

/** Stored first-run state over the defaults, keeping only today's keys: rows from the old step
 *  wizard carry keys it no longer has, and some lack `flow`. */
function gettingStartedFrom(raw: unknown): GettingStarted {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof GettingStarted, unknown>>;
  const d = DEFAULT_PREFERENCES.gettingStarted;
  return {
    onboarding: r.onboarding === 'pending' || r.onboarding === 'done' ? r.onboarding : d.onboarding,
    flow: r.flow === 'join' || r.flow === 'create' ? r.flow : d.flow,
    since: typeof r.since === 'string' ? r.since : d.since,
  };
}

export { normalizeDir };

/** PATCH bodies reach the store raw from the server, so only whitelisted keys may build SQL */
function sqlPairs<T extends object>(patch: T, allowed: Array<keyof T>): Array<[string, unknown]> {
  return Object.entries(patch).filter(([k]) => (allowed as string[]).includes(k));
}

/** the issue fields updateIssue accepts; everything else on an Issue is derived or fixed */
const ISSUE_PATCH_KEYS = new Set<string>(['title', 'description', 'stateId', 'priority', 'assigneeId', 'projectId', 'parentId', 'cycleId', 'locationId', 'milestoneId', 'estimate', 'dueDate', 'labelIds', 'sortOrder', 'archivedAt']);

export class Store {
  /** extension modules (initiatives, SLAs, loops, git); see extensions.ts */
  readonly ext: Extensions;
  /** called after every issue create (before = null) and update */
  readonly issueHooks: Array<(before: Issue | null, after: Issue, actorId?: string) => void> = [];
  /** called on every tick */
  readonly tickHooks: Array<(now: Date) => void> = [];
  constructor(private db: DatabaseSync) { this.ext = createExtensions(this, db); }

  // ---------- mappers ----------
  private mapIssue = (r: IssueRow): Issue => ({
    id: r.id, teamId: r.team_id, number: r.number, title: r.title, description: r.description,
    stateId: r.state_id, priority: r.priority as Priority, assigneeId: r.assignee_id,
    projectId: r.project_id, cycleId: r.cycle_id, parentId: r.parent_id, locationId: r.location_id ?? null,
    milestoneId: r.milestone_id ?? null, creatorId: r.creator_id ?? null, snoozedUntil: r.snoozed_until ?? null, estimate: r.estimate,
    dueDate: r.due_date, sortOrder: r.sort_order, labelIds: JSON.parse(r.labels),
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at,
    completedAt: r.completed_at, canceledAt: r.canceled_at, deletedAt: r.deleted_at,
    slaRuleId: r.sla_rule_id ?? null, slaBreachesAt: r.sla_breaches_at ?? null,
  });

  private mapTeam = (t: TeamRow): Team => ({
    id: t.id, key: t.key, name: t.name, icon: t.icon, color: t.color, description: t.description, position: t.position,
    triageEnabled: !!t.triage_enabled, autoCycles: !!t.auto_cycles, cycleDuration: t.cycle_duration ?? 2,
    cycleCooldown: t.cycle_cooldown ?? 0, cycleUpcoming: t.cycle_upcoming ?? 2, cycleRollover: t.cycle_rollover !== 0,
    estimateScale: (t.estimate_scale as EstimateScale) ?? 'fibonacci',
    memberIds: (this.db.prepare('SELECT user_id FROM team_members WHERE team_id = ? ORDER BY created_at').all(t.id) as Array<{ user_id: string }>).map(r => r.user_id),
    leadIds: (this.db.prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role = 'lead' ORDER BY created_at").all(t.id) as Array<{ user_id: string }>).map(r => r.user_id),
    estimateZero: !!t.estimate_zero, estimateExtended: !!t.estimate_extended, estimateCountUnestimated: !!t.estimate_count_unestimated,
  });
  private mapComment = (c: CommentRow): Comment => ({
    id: c.id, issueId: c.issue_id, userId: c.user_id, viaUserId: c.via_user_id ?? null, body: c.body, createdAt: c.created_at, editedAt: c.edited_at,
    reactions: JSON.parse(c.reactions), resolvedAt: c.resolved_at, parentId: c.parent_id ?? null,
  });
  private mapAttachment = (a: AttachmentRow): Attachment => ({
    id: a.id, issueId: a.issue_id, userId: a.user_id, kind: a.kind === 'file' ? 'file' : 'link', url: a.url,
    title: a.title, mime: a.mime, size: a.size, createdAt: a.created_at,
  });

  private mapProject(p: Record<string, unknown>, locs = this.projectLocationMap()): Project {
    return {
      id: p.id as string, teamId: (p.team_id as string | null) ?? null, name: p.name as string, summary: (p.summary as string) ?? '',
      description: p.description as string, icon: p.icon as string, color: p.color as string,
      status: p.status as Project['status'], health: p.health as Project['health'],
      priority: (p.priority as number ?? 0) as Priority, locationIds: locs.get(p.id as string) ?? [], startDate: (p.start_date as string | null) ?? null,
      targetDate: (p.target_date as string | null) ?? null, leadId: (p.lead_id as string | null) ?? null,
      memberIds: JSON.parse((p.members as string) ?? '[]'), labelIds: JSON.parse((p.labels as string) ?? '[]'),
      statusId: (p.status_id as string | null) ?? null, updateCadence: (p.update_cadence as UpdateCadence | null) ?? null,
      position: p.position as number, createdAt: p.created_at as string, updatedAt: p.updated_at as string, completedAt: (p.completed_at as string | null) ?? null,
    };
  }

  // ---------- snapshot ----------
  snapshot(): Snapshot {
    const rows = <T>(sql: string, ...params: string[]): T[] => this.db.prepare(sql).all(...params) as unknown as T[];
    const me = this.actor();
    const projectLocs = this.projectLocationMap();
    const users = rows<{ id: string; name: string; email: string; initials: string; color: string; admin: number; kind: string; title: string | null; username: string | null; github_username: string | null; avatar_url: string | null; status: string | null; created_at: string | null; last_seen_at: string | null }>('SELECT * FROM users ORDER BY rowid').map(u => ({ id: u.id, name: u.name, email: u.email, initials: u.initials, color: u.color, admin: !!u.admin, kind: (u.kind as User['kind']) ?? 'human', title: u.title ?? '', username: u.username ?? '', githubUsername: u.github_username ?? '', avatarUrl: u.avatar_url || null, status: u.status === 'suspended' ? 'suspended' as const : 'active' as const, createdAt: u.created_at, lastSeenAt: u.last_seen_at }));
    const workspaceId = getMeta(this.db, 'workspaceId') ?? '';
    const workspace = { id: workspaceId, name: getMeta(this.db, 'workspaceName') ?? 'Workspace', createdAt: getMeta(this.db, 'workspaceCreatedAt') ?? ts(), handoffPromptTemplate: getMeta(this.db, 'handoffPromptTemplate') ?? DEFAULT_PROMPT_TEMPLATE, ...this.getAgentConfig(), preferences: this.getPreferences(), features: this.getFeatures(), security: this.getSecurity() };
    const currentUser = users.find(u => u.id === this.actor()) ?? users[0];
    return {
      workspace, users, currentUser: currentUser!,
      teams: rows<TeamRow>('SELECT * FROM teams ORDER BY position').map(this.mapTeam),
      states: rows<{ id: string; team_id: string; name: string; type: WorkflowStateType; color: string; position: number }>('SELECT * FROM states ORDER BY position').map(s => ({ id: s.id, teamId: s.team_id, name: s.name, type: s.type, color: s.color, position: s.position })),
      labels: rows<{ id: string; team_id: string; name: string; color: string; description: string }>('SELECT * FROM labels').map(l => ({ id: l.id, teamId: l.team_id, name: l.name, color: l.color, description: l.description })),
      templates: rows<TemplateRow>('SELECT * FROM issue_templates ORDER BY position, created_at').map(t => ({ id: t.id, teamId: t.team_id, name: t.name, title: t.title, description: t.description, position: t.position, createdAt: t.created_at })),
      issues: rows<IssueRow>('SELECT * FROM issues WHERE archived_at IS NULL AND deleted_at IS NULL').map(this.mapIssue),
      comments: rows<CommentRow>('SELECT * FROM comments ORDER BY created_at').map(this.mapComment),
      attachments: rows<AttachmentRow>('SELECT * FROM attachments ORDER BY created_at').map(this.mapAttachment),
      subscriptions: rows<{ issue_id: string; user_id: string }>('SELECT * FROM subscriptions').map(r => ({ issueId: r.issue_id, userId: r.user_id })),
      relations: rows<{ id: string; issue_id: string; related_id: string; type: string }>('SELECT * FROM relations').map(r => ({ id: r.id, issueId: r.issue_id, relatedIssueId: r.related_id, type: r.type as RelationType })),
      projects: rows<Record<string, unknown>>('SELECT * FROM projects ORDER BY position, created_at').map(p => this.mapProject(p, projectLocs)),
      projectLabels: rows<{ id: string; name: string; color: string; description: string; parent_id: string | null; is_group: number; created_at: string }>('SELECT * FROM project_labels ORDER BY name').map(l => ({ id: l.id, name: l.name, color: l.color, description: l.description, parentId: l.parent_id, isGroup: !!l.is_group, createdAt: l.created_at })),
      projectStatuses: rows<{ id: string; type: Project['status']; name: string; color: string; description: string; position: number }>('SELECT * FROM project_statuses ORDER BY position').map(x => ({ id: x.id, type: x.type, name: x.name, color: x.color, description: x.description, position: x.position })),
      projectSubscriptions: rows<{ project_id: string; user_id: string; issue_added: number; issue_closed: number; comments: number; updates: number }>('SELECT * FROM project_subscriptions').map(x => ({ projectId: x.project_id, userId: x.user_id, issueAdded: !!x.issue_added, issueClosed: !!x.issue_closed, comments: !!x.comments, updates: !!x.updates })),
      recurring: rows<{ id: string; team_id: string; title: string; description: string; priority: number; assignee_id: string | null; labels: string; project_id: string | null; cadence: string; next_at: string; created_at: string }>('SELECT * FROM recurring_issues ORDER BY created_at').map(r => ({ id: r.id, teamId: r.team_id, title: r.title, description: r.description, priority: r.priority as Priority, assigneeId: r.assignee_id, labelIds: JSON.parse(r.labels), projectId: r.project_id, cadence: r.cadence as RecurringIssue['cadence'], nextAt: r.next_at, createdAt: r.created_at })),
      docs: rows<{ id: string; title: string; icon: string; content: string; project_id: string | null; team_id: string | null; initiative_id: string | null; creator_id: string | null; created_at: string; updated_at: string }>('SELECT * FROM documents ORDER BY updated_at DESC').map(d => ({ id: d.id, title: d.title, icon: d.icon, content: d.content, projectId: d.project_id, teamId: d.team_id, initiativeId: d.initiative_id ?? null, creatorId: d.creator_id, createdAt: d.created_at, updatedAt: d.updated_at })),
      teamLinks: rows<{ id: string; team_id: string; url: string; title: string; created_at: string }>('SELECT * FROM team_links ORDER BY created_at').map(l => ({ id: l.id, teamId: l.team_id, url: l.url, title: l.title, createdAt: l.created_at })),
      projectLinks: rows<{ id: string; project_id: string; url: string; title: string; created_at: string }>('SELECT * FROM project_links ORDER BY created_at').map(l => ({ id: l.id, projectId: l.project_id, url: l.url, title: l.title, createdAt: l.created_at })),
      locations: this.listLocations(),
      milestones: rows<{ id: string; project_id: string; name: string; target_date: string | null; status: Milestone['status']; position: number; created_at: string }>('SELECT * FROM milestones ORDER BY position, created_at').map(m => ({ id: m.id, projectId: m.project_id, name: m.name, targetDate: m.target_date, status: m.status, position: m.position, createdAt: m.created_at })),
      projectUpdates: rows<{ id: string; project_id: string; user_id: string; via_user_id: string | null; body: string; health: ProjectUpdate['health']; created_at: string }>('SELECT * FROM project_updates ORDER BY created_at DESC').map(u => ({ id: u.id, projectId: u.project_id, userId: u.user_id, viaUserId: u.via_user_id ?? null, body: u.body, health: u.health, createdAt: u.created_at })),
      cycles: rows<{ id: string; team_id: string; number: number; name: string; starts_at: string; ends_at: string; completed_at: string | null }>('SELECT * FROM cycles ORDER BY number').map(c => ({ id: c.id, teamId: c.team_id, number: c.number, name: c.name, startsAt: c.starts_at, endsAt: c.ends_at, completedAt: c.completed_at })),
      views: rows<{ id: string; team_id: string | null; name: string; icon: string; filters: string; group_by: string; order_by: string; layout: string; position: number; kind: string; project_options: string | null; owner_id: string | null; shared: number }>('SELECT * FROM views WHERE shared = 1 OR owner_id = ? ORDER BY position', me).map(v => ({ ownerId: v.owner_id, shared: !!v.shared, id: v.id, teamId: v.team_id, name: v.name, icon: v.icon, filters: JSON.parse(v.filters), groupBy: v.group_by as GroupBy, orderBy: v.order_by as OrderBy, layout: v.layout as 'list' | 'board', position: v.position, kind: (v.kind === 'projects' ? 'projects' : 'issues') as SavedView['kind'], projectOptions: v.project_options ? JSON.parse(v.project_options) : null })),
      favorites: rows<{ id: string; type: Favorite['type']; ref_id: string; position: number }>('SELECT * FROM favorites WHERE user_id = ? ORDER BY position', me).map(f => ({ id: f.id, type: f.type, refId: f.ref_id, position: f.position })),
      notifications: rows<{ id: string; type: Notification['type']; actor_id: string | null; issue_id: string | null; project_id: string | null; body: string; read_at: string | null; snoozed_until: string | null; created_at: string }>('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 500', me).map(n => ({ id: n.id, type: n.type, actorId: n.actor_id, issueId: n.issue_id, projectId: n.project_id, body: n.body, readAt: n.read_at, snoozedUntil: n.snoozed_until ?? null, createdAt: n.created_at })),
      activity: rows<{ id: string; issue_id: string | null; project_id: string | null; user_id: string; via_user_id: string | null; type: ActivityType; data: string; created_at: string }>(`SELECT * FROM activity WHERE type NOT IN (${RETIRED_ACTIVITY}) ORDER BY created_at DESC LIMIT 2000`).map(a => ({ id: a.id, issueId: a.issue_id, projectId: a.project_id, userId: a.user_id, viaUserId: a.via_user_id ?? null, type: a.type, data: JSON.parse(a.data), createdAt: a.created_at })),
      ...this.ext.snapshot(),
    };
  }

  // ---------- users ----------
  userKind(userId: string): User['kind'] | undefined {
    return (this.db.prepare('SELECT kind FROM users WHERE id = ?').get(userId) as { kind: User['kind'] } | undefined)?.kind;
  }
  createUser(name: string, email = '', admin = false, kind: User['kind'] = 'human'): User {
    const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const colors = ['#5e6ad2', '#c770f4', '#f2994a', '#4cb782', '#eb5757', '#307ec6'];
    const user: User = { id: id('u'), name, email, initials, color: colors[Math.floor(Math.random() * colors.length)], admin, kind, avatarUrl: '', status: 'active', createdAt: ts(), lastSeenAt: null };
    this.db.prepare('INSERT INTO users (id, name, email, initials, color, admin, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, user.name, user.email, user.initials, user.color, admin ? 1 : 0, kind, ts());
    return user;
  }

  // ---------- teams ----------
  createTeam(key: string, name: string, icon = '📦', color = '#5e6ad2'): Team {
    const position = (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM teams').get() as { p: number }).p;
    const tid = id('t');
    this.db.prepare('INSERT INTO teams (id, key, name, icon, color, description, position) VALUES (?, ?, ?, ?, ?, ?, ?)').run(tid, key.toUpperCase(), name, icon, color, '', position);
    const team = this.getTeam(tid)!;
    const defaults: Array<[string, WorkflowStateType, string]> = [
      ['Backlog', 'backlog', '#95a2b3'], ['Todo', 'unstarted', '#e2e2e2'], ['In Progress', 'started', '#f2c94c'],
      ['In Review', 'started', '#4cb782'], ['Done', 'completed', '#5e6ad2'], ['Canceled', 'canceled', '#7d8084'],
    ];
    defaults.forEach(([name2, type, color2], i) => this.createState(team.id, name2, type, color2, i + 1));
    // whoever makes a team belongs to it and leads it (agents aren't members; they're assigned, not on teams)
    const me = this.actor();
    if (me && (this.db.prepare("SELECT 1 FROM users WHERE id = ? AND kind = 'human'").get(me))) { this.addTeamMember(tid, me); this.setTeamLead(tid, me, true); }
    return this.getTeam(tid)!;
  }

  getTeam(teamId: string): Team | undefined {
    const row = this.db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow | undefined;
    return row ? this.mapTeam(row) : undefined;
  }
  updateTeam(teamId: string, patch: Partial<Pick<Team, 'key' | 'name' | 'icon' | 'color' | 'description' | 'position' | 'triageEnabled' | 'autoCycles' | 'cycleDuration' | 'cycleCooldown' | 'cycleUpcoming' | 'cycleRollover' | 'estimateScale' | 'estimateZero' | 'estimateExtended' | 'estimateCountUnestimated'>>): void {
    const col: Record<string, string> = {
      triageEnabled: 'triage_enabled', autoCycles: 'auto_cycles', cycleDuration: 'cycle_duration', cycleCooldown: 'cycle_cooldown',
      cycleUpcoming: 'cycle_upcoming', cycleRollover: 'cycle_rollover', estimateScale: 'estimate_scale',
      estimateZero: 'estimate_zero', estimateExtended: 'estimate_extended', estimateCountUnestimated: 'estimate_count_unestimated',
    };
    const sets: string[] = []; const vals: (string | number)[] = [];
    for (const [k, v] of sqlPairs(patch, ['key', 'name', 'icon', 'color', 'description', 'position', 'triageEnabled', 'autoCycles', 'cycleDuration', 'cycleCooldown', 'cycleUpcoming', 'cycleRollover', 'estimateScale', 'estimateZero', 'estimateExtended', 'estimateCountUnestimated'])) {
      sets.push(`${col[k] ?? k} = ?`);
      vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : k === 'key' ? String(v).toUpperCase() : v as string | number);
    }
    if (!sets.length) return;
    vals.push(teamId);
    this.db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    // triage is a workflow state of its own: turning it on adds one, turning it off sends
    // anything still waiting to the backlog and removes it
    if (patch.triageEnabled === true && !this.stateOfType(teamId, 'triage')) this.createState(teamId, 'Triage', 'triage', '#fc7840', 0);
    if (patch.triageEnabled === false) {
      const triage = this.stateOfType(teamId, 'triage');
      if (triage) this.deleteState(triage);
    }
    if (patch.autoCycles) this.scheduleCycles(teamId);
  }
  addTeamMember(teamId: string, userId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, created_at) VALUES (?, ?, ?)').run(teamId, userId, ts());
  }
  /** make a team's member its lead, or a member again (adds them to the team first) */
  setTeamLead(teamId: string, userId: string, lead: boolean): void {
    this.addTeamMember(teamId, userId);
    this.db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(lead ? 'lead' : 'member', teamId, userId);
  }
  removeTeamMember(teamId: string, userId: string): void {
    this.db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId);
  }
  /** replace someone's teams with exactly these (unknown team ids are ignored) */
  setUserTeams(userId: string, teamIds: string[]): void {
    const known = new Set((this.db.prepare('SELECT id FROM teams').all() as Array<{ id: string }>).map(r => r.id));
    const want = new Set(teamIds.filter(t => known.has(t)));
    for (const r of this.db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').all(userId) as Array<{ team_id: string }>) {
      if (!want.has(r.team_id)) this.removeTeamMember(r.team_id, userId);
    }
    for (const t of want) this.addTeamMember(t, userId);
  }
  deleteTeam(teamId: string): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(teamId); // issues cascade
  }

  // ---------- users ----------
  /** profile fields only; admin rights go through Accounts.setAdmin, which keeps at least one admin */
  updateUser(userId: string, patch: Partial<Pick<User, 'name' | 'email' | 'color' | 'title' | 'username' | 'githubUsername' | 'avatarUrl'>>): void {
    const cur = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as { name: string; email: string } | undefined;
    if (!cur) return;
    const name = patch.name ?? cur.name;
    const initials = patch.name ? name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() : undefined;
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'email', 'color', 'title', 'username'])) { sets.push(`${k} = ?`); vals.push(k === 'username' ? String(v).trim().split(/\s+/)[0] ?? '' : v as string | number); }
    if ('avatarUrl' in patch) { sets.push('avatar_url = ?'); vals.push(patch.avatarUrl ?? null); }
    if (patch.githubUsername !== undefined) { sets.push('github_username = ?'); vals.push(String(patch.githubUsername ?? '').trim().replace(/^@/, '')); }
    if (initials) { sets.push('initials = ?'); vals.push(initials); }
    if (!sets.length) return;
    vals.push(userId);
    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  // ---------- states ----------
  createState(teamId: string, name: string, type: WorkflowStateType, color: string, position?: number): WorkflowState {
    const pos = position ?? (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM states WHERE team_id=?').get(teamId) as { p: number }).p;
    const state: WorkflowState = { id: id('s'), teamId, name, type, color, position: pos };
    this.db.prepare('INSERT INTO states (id, team_id, name, type, color, position) VALUES (?, ?, ?, ?, ?, ?)').run(state.id, teamId, name, type, color, pos);
    return state;
  }
  updateState(stateId: string, patch: Partial<Pick<WorkflowState, 'name' | 'type' | 'color' | 'position'>>): void {
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'type', 'color', 'position'])) { sets.push(`${k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())} = ?`); vals.push(v as string | number); }
    if (!sets.length) return;
    vals.push(stateId);
    this.db.prepare(`UPDATE states SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteState(stateId: string): string | undefined {
    // migrate the state's issues to another state of the same team. Prefer the backlog,
    // and fall back to the first remaining state. The last state of a team cannot be deleted
    const others = this.db.prepare('SELECT id, type FROM states WHERE team_id = (SELECT team_id FROM states WHERE id = ?) AND id != ? ORDER BY position').all(stateId, stateId) as Array<{ id: string; type: string }>;
    if (!others.length) throw new Error('Cannot delete the only workflow state of a team');
    const movedTo = (others.find(s => s.type === 'backlog') ?? others[0]).id;
    this.db.prepare('UPDATE issues SET state_id = ? WHERE state_id = ?').run(movedTo, stateId);
    this.db.prepare('DELETE FROM states WHERE id = ?').run(stateId);
    return movedTo;
  }

  // ---------- labels ----------
  createLabel(teamId: string, name: string, color: string, description = ''): Label {
    const label: Label = { id: id('l'), teamId, name, color, description };
    this.db.prepare('INSERT INTO labels (id, team_id, name, color, description) VALUES (?, ?, ?, ?, ?)').run(label.id, teamId, name, color, description);
    return label;
  }
  updateLabel(labelId: string, patch: Partial<Pick<Label, 'name' | 'color' | 'description'>>): void {
    const pairs = sqlPairs(patch, ['name', 'color', 'description']);
    if (!pairs.length) return;
    this.db.prepare(`UPDATE labels SET ${pairs.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...(pairs.map(([, v]) => v) as string[]), labelId);
  }
  deleteLabel(labelId: string): void {
    const rows = this.db.prepare('SELECT id, labels FROM issues').all() as { id: string; labels: string }[];
    for (const r of rows) {
      const arr: string[] = JSON.parse(r.labels);
      if (arr.includes(labelId)) this.db.prepare('UPDATE issues SET labels = ? WHERE id = ?').run(JSON.stringify(arr.filter(x => x !== labelId)), r.id);
    }
    this.db.prepare('DELETE FROM labels WHERE id = ?').run(labelId);
  }

  // ---------- issue templates ----------
  createTemplate(teamId: string, name: string, title = '', description = ''): IssueTemplate {
    const t: IssueTemplate = { id: id('tpl'), teamId, name, title, description, position: (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM issue_templates WHERE team_id = ?').get(teamId) as { p: number }).p, createdAt: ts() };
    this.db.prepare('INSERT INTO issue_templates (id, team_id, name, title, description, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(t.id, t.teamId, t.name, t.title, t.description, t.position, t.createdAt);
    return t;
  }
  updateTemplate(templateId: string, patch: Partial<Pick<IssueTemplate, 'name' | 'title' | 'description' | 'position'>>): void {
    const sets: string[] = []; const vals: (string | number)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'title', 'description', 'position'])) { sets.push(`${k} = ?`); vals.push(v as string | number); }
    if (!sets.length) return;
    vals.push(templateId);
    this.db.prepare(`UPDATE issue_templates SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteTemplate(templateId: string): void {
    this.db.prepare('DELETE FROM issue_templates WHERE id = ?').run(templateId);
  }

  // ---------- handoff ----------
  handoffFor(issueId: string, baseUrl?: string): Handoff | undefined {
    const issue = this.getIssue(issueId);
    if (!issue) return undefined;
    const snap = this.snapshot();
    const template = getMeta(this.db, 'handoffPromptTemplate') ?? DEFAULT_PROMPT_TEMPLATE;
    return buildHandoff(issue, { teams: snap.teams, states: snap.states, projects: snap.projects, labels: snap.labels, branchFormat: snap.workspace.features.branchFormat, username: snap.currentUser?.username || snap.currentUser?.name, baseUrl }, template);
  }
  /** null resets to the built-in default */
  setHandoffTemplate(template: string | null): void {
    if (template == null) this.db.prepare('DELETE FROM meta WHERE key = ?').run('handoffPromptTemplate');
    else setMeta(this.db, 'handoffPromptTemplate', template);
  }

  // ---------- coding tools ----------
  getAgentConfig(): { agentUserId: string | null; terminalApp: TerminalApp } {
    return {
      agentUserId: getMeta(this.db, 'agentUserId'),
      terminalApp: toTerminalApp(getMeta(this.db, 'terminalApp')),
    };
  }
  setAgentConfig(patch: { terminalApp?: TerminalApp }): void {
    if (patch.terminalApp !== undefined) setMeta(this.db, 'terminalApp', toTerminalApp(patch.terminalApp));
  }
  /** the one location an issue's agent works in, never a guess; unset means "ask" */
  locationFor(issue: Pick<Issue, 'locationId'>): Location | undefined {
    return issue.locationId ? this.getLocation(issue.locationId) : undefined;
  }

  // ---------- locations ----------
  listLocations(): Location[] {
    return (this.db.prepare('SELECT * FROM locations ORDER BY name COLLATE NOCASE').all() as Array<{ id: string; name: string; path: string; created_at: string }>)
      .map(l => ({ id: l.id, name: l.name, path: l.path, createdAt: l.created_at }));
  }
  getLocation(locationId: string): Location | undefined { return this.listLocations().find(l => l.id === locationId); }
  /** by id, exact name (case-insensitive), or path */
  resolveLocation(ref: string): Location | undefined {
    const all = this.listLocations();
    const path = normalizeDir(ref);
    return all.find(l => l.id === ref) ?? all.find(l => l.name.toLowerCase() === ref.trim().toLowerCase()) ?? all.find(l => l.path === path);
  }
  /** registers a directory (idempotent by path); the name defaults to the folder name, made unique */
  createLocation(rawPath: string, name?: string): Location {
    const path = normalizeDir(rawPath);
    if (!path) throw new Error('A location needs a path');
    const existing = this.listLocations().find(l => l.path === path);
    if (existing) return existing;
    const base = (name?.trim() || path.split('/').pop() || path);
    let unique = base;
    for (let n = 2; this.listLocations().some(l => l.name.toLowerCase() === unique.toLowerCase()); n++) unique = `${base}-${n}`;
    const loc: Location = { id: id('loc'), name: unique, path, createdAt: ts() };
    this.db.prepare('INSERT INTO locations (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(loc.id, loc.name, loc.path, loc.createdAt);
    return loc;
  }
  renameLocation(locationId: string, name: string): void {
    const n = name.trim();
    if (!n) return;
    if (this.listLocations().some(l => l.id !== locationId && l.name.toLowerCase() === n.toLowerCase())) throw new Error(`A location named "${n}" already exists`);
    this.db.prepare('UPDATE locations SET name = ? WHERE id = ?').run(n, locationId);
  }
  /** unregisters it: projects drop it and issues pinned to it go back to "no location" */
  deleteLocation(locationId: string): void {
    this.db.prepare('UPDATE issues SET location_id = NULL WHERE location_id = ?').run(locationId);
    this.db.prepare('DELETE FROM project_locations WHERE location_id = ?').run(locationId);
    this.db.prepare('DELETE FROM locations WHERE id = ?').run(locationId);
  }
  private projectLocationMap(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const r of this.db.prepare('SELECT project_id, location_id FROM project_locations ORDER BY position, rowid').all() as Array<{ project_id: string; location_id: string }>) {
      m.set(r.project_id, [...(m.get(r.project_id) ?? []), r.location_id]);
    }
    return m;
  }
  setProjectLocations(projectId: string, locationIds: string[]): void {
    const known = new Set(this.listLocations().map(l => l.id));
    this.db.prepare('DELETE FROM project_locations WHERE project_id = ?').run(projectId);
    [...new Set(locationIds)].filter(l => known.has(l)).forEach((lid, n) =>
      this.db.prepare('INSERT INTO project_locations (project_id, location_id, position) VALUES (?, ?, ?)').run(projectId, lid, n));
  }
  /** where a new issue starts: a sub-issue where its parent happens; anything else has no location
   *  until someone picks one. A project's locations are suggestions, never defaults */
  defaultLocationFor(input: { parentId?: string | null }): string | null {
    const parent = input.parentId ? this.getIssue(input.parentId) : undefined;
    return parent?.locationId ?? null;
  }
  /** the workspace's agent user: agent sessions write as it, on a person's behalf */
  agentUserId(): string {
    const uid = getMeta(this.db, 'agentUserId');
    return uid && this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid) ? uid : ensureWorkspaceAgent(this.db);
  }
  /** first state of a type by position, e.g. the team's "In Progress" for 'started' */
  stateOfType(teamId: string, type: WorkflowStateType): string | undefined {
    return (this.db.prepare('SELECT id FROM states WHERE team_id = ? AND type = ? ORDER BY position LIMIT 1').get(teamId, type) as { id: string } | undefined)?.id;
  }
  stateType(stateId: string): WorkflowStateType | undefined {
    return (this.db.prepare('SELECT type FROM states WHERE id = ?').get(stateId) as { type: WorkflowStateType } | undefined)?.type;
  }

  // ---------- issues ----------
  private nextNumber(teamId: string): number {
    return (this.db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM issues WHERE team_id = ?').get(teamId) as { n: number }).n;
  }
  private defaultState(teamId: string): string {
    const s = this.db.prepare("SELECT id FROM states WHERE team_id = ? AND type = 'unstarted'").get(teamId) as { id: string } | undefined
      ?? this.db.prepare('SELECT id FROM states WHERE team_id = ? ORDER BY position LIMIT 1').get(teamId) as { id: string };
    return s.id;
  }

  createIssue(input: { teamId: string; title: string; description?: string; stateId?: string; priority?: Priority; assigneeId?: string | null; projectId?: string | null; parentId?: string | null; cycleId?: string | null; labelIds?: string[]; dueDate?: string | null; estimate?: number | null; locationId?: string | null; milestoneId?: string | null }, actorId?: string): Issue {
    const now = ts();
    const creatorId = actorId ?? this.actor();
    // with triage on, work filed by anyone but you (agents, teammates on the CLI) waits for review
    const triage = this.getTeam(input.teamId)?.triageEnabled && creatorId !== this.actor() ? this.stateOfType(input.teamId, 'triage') : undefined;
    const stateId = input.stateId ?? triage ?? this.defaultState(input.teamId);
    const maxOrder = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM issues WHERE team_id = ?').get(input.teamId) as { m: number }).m;
    const issue: Issue = {
      id: id('i'), teamId: input.teamId, number: this.nextNumber(input.teamId), title: input.title,
      description: input.description ?? '', stateId, priority: input.priority ?? 0,
      assigneeId: input.assigneeId ?? null, projectId: input.projectId ?? null, cycleId: input.cycleId ?? null,
      parentId: input.parentId ?? null,
      locationId: input.locationId !== undefined ? (input.locationId && this.getLocation(input.locationId) ? input.locationId : null) : this.defaultLocationFor(input),
      milestoneId: input.projectId ? input.milestoneId ?? null : null, creatorId: creatorId ?? null, snoozedUntil: null,
      estimate: input.estimate ?? null, dueDate: input.dueDate ?? null,
      sortOrder: maxOrder + 1024, labelIds: input.labelIds ?? [],
      createdAt: now, updatedAt: now, archivedAt: null, completedAt: null, canceledAt: null, deletedAt: null,
    };
    this.db.prepare(`INSERT INTO issues (id, team_id, number, title, description, state_id, priority, assignee_id, project_id, cycle_id, parent_id, location_id, milestone_id, creator_id, estimate, due_date, sort_order, labels, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(issue.id, issue.teamId, issue.number, issue.title, issue.description, issue.stateId, issue.priority, issue.assigneeId, issue.projectId, issue.cycleId, issue.parentId, issue.locationId, issue.milestoneId, issue.creatorId, issue.estimate, issue.dueDate, issue.sortOrder, JSON.stringify(issue.labelIds), now, now);
    this.logActivity({ issueId: issue.id, type: 'created', data: { title: issue.title } }, actorId);
    if (issue.creatorId) this.subscribe(issue.id, issue.creatorId);
    if (issue.assigneeId) { this.subscribe(issue.id, issue.assigneeId); this.notifyAssign(issue.id, issue.assigneeId, actorId); }
    // a mention notifies once; it doesn't follow the issue for them (commenting does)
    for (const uid of this.mentions(issue.description)) this.notifyMention(issue.id, uid, creatorId, issue.title);
    if (issue.projectId) this.notifyProject(issue.projectId, 'issueAdded', 'projectIssueAdded', creatorId, issue.title, issue.id);
    for (const h of this.issueHooks) h(null, issue, actorId);
    return issue;
  }

  updateIssue(issueId: string, rawPatch: Partial<Pick<Issue, 'title' | 'description' | 'stateId' | 'priority' | 'assigneeId' | 'projectId' | 'parentId' | 'cycleId' | 'locationId' | 'milestoneId' | 'estimate' | 'dueDate' | 'labelIds' | 'sortOrder' | 'archivedAt'>>, actorId?: string): Issue | undefined {
    // keep only the fields a caller may set, and drop explicitly-undefined keys so partial
    // patches never clobber values. The REST route hands us the raw request body: without the
    // allow-list, `completedAt`/`canceledAt` (or `teamId`, `number`…) would be spread into
    // `next` and persisted, giving e.g. a Todo issue a completion date. Those timestamps are
    // only ever derived from a state change below.
    const patch = Object.fromEntries(Object.entries(rawPatch).filter(([k, v]) => v !== undefined && ISSUE_PATCH_KEYS.has(k))) as typeof rawPatch;
    const row = this.db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId) as IssueRow | undefined;
    if (!row) return undefined;
    const before = this.mapIssue(row);
    const now = ts();
    const next: Issue = { ...before, ...patch, updatedAt: now };
    if (patch.locationId !== undefined && patch.locationId !== null && !this.getLocation(patch.locationId)) next.locationId = before.locationId;
    // a parent can't be the issue itself or one of its own sub-issues (at any depth): that makes a loop
    if (patch.parentId && patch.parentId !== before.parentId) {
      for (let at: string | null = patch.parentId, hops = 0; at && hops < 1000; hops++) {
        if (at === issueId) throw new Error('An issue can’t be the parent of its own parent issue');
        at = (this.db.prepare('SELECT parent_id FROM issues WHERE id = ?').get(at) as { parent_id: string | null } | undefined)?.parent_id ?? null;
      }
    }
    // a milestone belongs to one project: leaving the project (or picking a milestone of another) clears it
    if (next.milestoneId) {
      const ms = this.db.prepare('SELECT project_id FROM milestones WHERE id = ?').get(next.milestoneId) as { project_id: string } | undefined;
      if (!ms || ms.project_id !== next.projectId) next.milestoneId = null;
    }

    // state side-effects
    if (patch.stateId && patch.stateId !== before.stateId) {
      const st = this.db.prepare('SELECT type FROM states WHERE id = ?').get(patch.stateId) as { type: WorkflowStateType };
      next.completedAt = st.type === 'completed' ? now : null;
      next.canceledAt = st.type === 'canceled' ? now : null;
      // Preferences › On move to started status, assign to yourself (people only: the GitHub and
      // Automation agents move issues too, and must never become the assignee)
      const me = actorId ?? this.actor();
      if (st.type === 'started' && !next.assigneeId && patch.assigneeId === undefined && me && this.getPreferences(me).assignOnStart
        && this.db.prepare("SELECT 1 FROM users WHERE id = ? AND kind = 'human'").get(me)) {
        next.assigneeId = me; patch.assigneeId = me;
      }
    }
    this.db.prepare(`UPDATE issues SET title=?, description=?, state_id=?, priority=?, assignee_id=?, project_id=?, cycle_id=?, parent_id=?, location_id=?, milestone_id=?, estimate=?, due_date=?, sort_order=?, labels=?, updated_at=?, completed_at=?, canceled_at=?, archived_at=? WHERE id=?`)
      .run(next.title, next.description, next.stateId, next.priority, next.assigneeId, next.projectId, next.cycleId, next.parentId, next.locationId, next.milestoneId, next.estimate, next.dueDate, next.sortOrder, JSON.stringify(next.labelIds), now, next.completedAt, next.canceledAt, next.archivedAt, issueId);

    // activity diffs
    const acts: Array<[ActivityType, Record<string, unknown>]> = [];
    if (patch.title !== undefined && patch.title !== before.title) acts.push(['renamed', { from: before.title, to: next.title }]);
    if (patch.description !== undefined && patch.description !== before.description) {
      acts.push(['described', {}]);
      const had = new Set(this.mentions(before.description));
      for (const uid of this.mentions(next.description)) if (!had.has(uid)) this.notifyMention(issueId, uid, actorId, next.title);
    }
    if (patch.stateId !== undefined && patch.stateId !== before.stateId) {
      const fromType = this.stateType(before.stateId);
      const toType = this.stateType(next.stateId);
      if (fromType === 'triage' && toType !== 'triage') acts.push([toType === 'canceled' ? 'triageDeclined' : 'triageAccepted', { to: next.stateId }]);
      else acts.push(['stateChanged', { from: before.stateId, to: next.stateId }]);
      this.notifySubscribed(issueId, 'issueStatusChanged', actorId, (this.db.prepare('SELECT name FROM states WHERE id = ?').get(next.stateId) as { name: string } | undefined)?.name ?? '', 'statusChanged');
    }
    if (patch.priority !== undefined && patch.priority !== before.priority) acts.push(['priorityChanged', { from: before.priority, to: next.priority }]);
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
      acts.push([next.assigneeId ? 'assigned' : 'unassigned', { to: next.assigneeId, from: before.assigneeId }]);
      if (next.assigneeId) { this.subscribe(issueId, next.assigneeId); this.notifyAssign(issueId, next.assigneeId, actorId); }
    }
    if (patch.projectId !== undefined && patch.projectId !== before.projectId) {
      acts.push(['projected', { to: next.projectId }]);
      if (next.projectId) this.notifyProject(next.projectId, 'issueAdded', 'projectIssueAdded', actorId, next.title, issueId);
    }
    if (next.projectId && next.stateId !== before.stateId && (next.completedAt || next.canceledAt) && !(before.completedAt || before.canceledAt)) {
      this.notifyProject(next.projectId, 'issueClosed', 'projectIssueClosed', actorId, `${next.completedAt ? 'Completed' : 'Canceled'}: ${next.title}`, issueId);
    }
    if (patch.parentId !== undefined && patch.parentId !== before.parentId) acts.push(['parented', { to: next.parentId, from: before.parentId }]);
    if (patch.cycleId !== undefined && patch.cycleId !== before.cycleId) acts.push(['cycleChanged', { to: next.cycleId, from: before.cycleId }]);
    if (next.locationId !== before.locationId) acts.push(['locationChanged', { to: next.locationId, from: before.locationId }]);
    if (patch.dueDate !== undefined && patch.dueDate !== before.dueDate) acts.push(['dueChanged', { to: next.dueDate }]);
    if (patch.estimate !== undefined && patch.estimate !== before.estimate) acts.push(['estimateChanged', { to: next.estimate }]);
    if (next.milestoneId !== before.milestoneId) acts.push(['milestoneChanged', { to: next.milestoneId, from: before.milestoneId }]);
    if (patch.labelIds !== undefined) {
      for (const lid of patch.labelIds) if (!before.labelIds.includes(lid)) acts.push(['labeled', { labelId: lid }]);
      for (const lid of before.labelIds) if (!patch.labelIds.includes(lid)) acts.push(['unlabeled', { labelId: lid }]);
    }
    if (patch.archivedAt !== undefined) acts.push([patch.archivedAt ? 'archived' : 'restored', {}]);
    for (const [type, data] of acts) this.logActivity({ issueId, type, data }, actorId);
    for (const h of this.issueHooks) h(before, next, actorId);
    return next;
  }

  /** Linear's "on git branch copy, move issue to started status": an issue still in backlog or
   *  unstarted moves to its team's first started state, and an unassigned one goes to `userId` */
  startIssue(issueId: string, userId: string): { moved: boolean; assigned: boolean; stateName?: string } {
    const issue = this.getIssue(issueId);
    const type = issue && this.stateType(issue.stateId);
    const target = issue && this.stateOfType(issue.teamId, 'started');
    if (!issue || !target || (type !== 'backlog' && type !== 'unstarted')) return { moved: false, assigned: false };
    const assigned = !issue.assigneeId;
    this.updateIssue(issueId, { stateId: target, ...(assigned ? { assigneeId: userId } : {}) }, userId);
    const stateName = (this.db.prepare('SELECT name FROM states WHERE id = ?').get(target) as { name: string }).name;
    return { moved: true, assigned, stateName };
  }
  getByKey(key: string): Issue | undefined {
    const m = /^(.+)-(\d+)$/.exec(key.trim().toUpperCase());
    if (!m) return undefined;
    const team = this.db.prepare('SELECT id FROM teams WHERE key = ?').get(m[1]) as { id: string } | undefined;
    if (!team) return undefined;
    const row = this.db.prepare('SELECT * FROM issues WHERE team_id = ? AND number = ?').get(team.id, Number(m[2])) as IssueRow | undefined;
    return row ? this.mapIssue(row) : undefined;
  }

  getIssue(issueId: string): Issue | undefined {
    const row = this.db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId) as IssueRow | undefined;
    return row ? this.mapIssue(row) : undefined;
  }

  listIssues(filter: { teamId?: string; stateType?: WorkflowStateType; stateId?: string; assigneeId?: string | 'me'; projectId?: string; priority?: Priority; query?: string; includeArchived?: boolean; includeDeleted?: boolean; limit?: number }): Issue[] {
    const where: string[] = []; const vals: (string | number | bigint | null)[] = [];
    if (!filter.includeArchived) where.push('archived_at IS NULL');
    if (!filter.includeDeleted) where.push('deleted_at IS NULL');
    if (filter.teamId) { where.push('team_id = ?'); vals.push(filter.teamId); }
    if (filter.stateId) { where.push('state_id = ?'); vals.push(filter.stateId); }
    if (filter.stateType) { where.push('state_id IN (SELECT id FROM states WHERE type = ?)'); vals.push(filter.stateType); }
    if (filter.assigneeId && filter.assigneeId !== 'me') { where.push('assignee_id = ?'); vals.push(filter.assigneeId); }
    if (filter.projectId) { where.push('project_id = ?'); vals.push(filter.projectId); }
    if (filter.priority !== undefined) { where.push('priority = ?'); vals.push(filter.priority); }
    if (filter.query) { where.push('(title LIKE ? OR description LIKE ?)'); const q = `%${filter.query}%`; vals.push(q, q); }
    let sql = `SELECT * FROM issues ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (priority = 0), priority, sort_order`;
    if (filter.limit) sql += ` LIMIT ${filter.limit}`;
    return (this.db.prepare(sql).all(...vals) as unknown as IssueRow[]).map(this.mapIssue);
  }

  moveIssue(issueId: string, beforeId: string | null, afterId: string | null): void {
    const before = beforeId ? this.getIssue(beforeId) : null;
    const after = afterId ? this.getIssue(afterId) : null;
    const sortOrder = midSort(after?.sortOrder ?? null, before?.sortOrder ?? null);
    this.updateIssue(issueId, { sortOrder });
  }

  /** soft-delete: keeps the row (and the children's parent_id) so undo restores everything;
      deleted issues are hidden at snapshot level, so detached-looking children never show */
  deleteIssue(issueId: string): void {
    this.db.prepare('UPDATE issues SET deleted_at = ? WHERE id = ?').run(ts(), issueId);
  }
  /** triage snooze: out of the queue until `until` (null brings it back now) */
  snoozeIssue(issueId: string, until: string | null): void {
    this.db.prepare('UPDATE issues SET snoozed_until = ? WHERE id = ?').run(until, issueId);
  }
  /** archived (not deleted) issues, newest first, for the team's Archive view */
  listArchived(teamId?: string): Issue[] {
    const rows = teamId
      ? this.db.prepare('SELECT * FROM issues WHERE archived_at IS NOT NULL AND deleted_at IS NULL AND team_id = ? ORDER BY archived_at DESC').all(teamId)
      : this.db.prepare('SELECT * FROM issues WHERE archived_at IS NOT NULL AND deleted_at IS NULL ORDER BY archived_at DESC').all();
    return (rows as unknown as IssueRow[]).map(this.mapIssue);
  }
  /** soft-deleted issues, newest first, for the Trash view; they can be restored or purged */
  listDeleted(teamId?: string): Issue[] {
    const rows = teamId
      ? this.db.prepare('SELECT * FROM issues WHERE deleted_at IS NOT NULL AND team_id = ? ORDER BY deleted_at DESC').all(teamId)
      : this.db.prepare('SELECT * FROM issues WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all();
    return (rows as unknown as IssueRow[]).map(this.mapIssue);
  }
  /** move an issue to another team: it takes the next number there, its status maps to the
   *  new team's first state of the same type, and team-scoped labels and cycles drop off */
  moveIssueToTeam(issueId: string, teamId: string, actorId?: string): Issue | undefined {
    const issue = this.getIssue(issueId);
    if (!issue || issue.teamId === teamId || !this.getTeam(teamId)) return issue;
    const fromKey = this.keyOf(issue);
    const type = this.stateType(issue.stateId) ?? 'backlog';
    const stateId = this.stateOfType(teamId, type) ?? this.defaultState(teamId);
    const labelIds = issue.labelIds.filter(l => (this.db.prepare('SELECT team_id FROM labels WHERE id = ?').get(l) as { team_id: string } | undefined)?.team_id === teamId);
    const number = this.nextNumber(teamId);
    this.db.prepare('UPDATE issues SET team_id = ?, number = ?, state_id = ?, labels = ?, cycle_id = NULL, updated_at = ? WHERE id = ?')
      .run(teamId, number, stateId, JSON.stringify(labelIds), ts(), issueId);
    const moved = this.getIssue(issueId)!;
    this.logActivity({ issueId, type: 'teamChanged', data: { from: fromKey, to: this.keyOf(moved) } }, actorId);
    return moved;
  }
  /** Linear's "Convert to project": the issue's title, description, lead and priority become a
   *  project, its sub-issues become that project's issues, and the issue itself is archived */
  convertIssueToProject(issueId: string, actorId?: string): { project: Project; moved: string[] } | undefined {
    const issue = this.getIssue(issueId);
    if (!issue) return undefined;
    const p = this.createProject({
      name: issue.title, description: issue.description, teamId: issue.teamId,
      leadId: issue.assigneeId ?? actorId ?? this.actor(), priority: issue.priority,
      targetDate: issue.dueDate,
    });
    const kids = this.db.prepare('SELECT id FROM issues WHERE parent_id = ? AND deleted_at IS NULL').all(issueId) as Array<{ id: string }>;
    for (const k of kids) this.updateIssue(k.id, { projectId: p.id, parentId: null }, actorId);
    this.updateIssue(issueId, { archivedAt: ts() }, actorId);
    return { project: p, moved: kids.map(k => k.id) };
  }
  keyOf(issue: Pick<Issue, 'teamId' | 'number'>): string {
    const t = this.db.prepare('SELECT key FROM teams WHERE id = ?').get(issue.teamId) as { key: string } | undefined;
    return `${t?.key ?? 'ISS'}-${issue.number}`;
  }
  restoreIssue(issueId: string): void {
    this.db.prepare('UPDATE issues SET deleted_at = NULL, archived_at = NULL WHERE id = ?').run(issueId);
  }
  /** hard delete: cascades comments/relations and detaches children */
  purgeIssue(issueId: string): void {
    this.db.prepare('DELETE FROM activity WHERE issue_id = ?').run(issueId);
    this.db.prepare('DELETE FROM notifications WHERE issue_id = ?').run(issueId);
    this.db.prepare('UPDATE issues SET parent_id = NULL WHERE parent_id = ?').run(issueId);
    this.db.prepare('DELETE FROM relations WHERE issue_id = ? OR related_id = ?').run(issueId, issueId);
    this.db.prepare('DELETE FROM comments WHERE issue_id = ?').run(issueId);
    this.db.prepare('DELETE FROM issues WHERE id = ?').run(issueId);
  }

  // ---------- comments ----------
  addComment(issueId: string, userId: string, body: string, parentId: string | null = null): Comment {
    const now = ts();
    // replies hang off the thread's root, never off another reply
    const root = parentId ? this.db.prepare('SELECT id, parent_id, user_id FROM comments WHERE id = ?').get(parentId) as { id: string; parent_id: string | null; user_id: string } | undefined : undefined;
    const threadId = root ? root.parent_id ?? root.id : null;
    const c: Comment = { id: id('c'), issueId, userId, viaUserId: viaFor(userId), body, createdAt: now, editedAt: null, reactions: {}, resolvedAt: null, parentId: threadId };
    this.db.prepare('INSERT INTO comments (id, issue_id, user_id, via_user_id, body, created_at, reactions, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, issueId, userId, c.viaUserId, body, now, '{}', threadId);
    this.logActivity({ issueId, type: 'commented', data: { commentId: c.id } }, userId);
    // commenting follows the issue; being mentioned only notifies, once (replying is what subscribes)
    this.subscribe(issueId, userId);
    const mentioned = this.mentions(body);
    // a mention outranks a reply, which outranks the plain comment notification, so never raise two for one person
    const threadAuthors = threadId ? (this.db.prepare('SELECT DISTINCT user_id FROM comments WHERE id = ? OR parent_id = ?').all(threadId, threadId) as Array<{ user_id: string }>).map(r => r.user_id) : [];
    for (const uid of mentioned) this.notifyMention(issueId, uid, userId, body);
    const replied = threadAuthors.filter(u => !mentioned.includes(u));
    this.notifyEach(replied, 'issueReplied', { actorId: userId, issueId, body, createdAt: now });
    this.notifySubscribed(issueId, 'issueCommented', userId, body, 'comments', [...mentioned, ...replied]);
    return c;
  }
  /** an edit notifies nobody, except people it newly mentions (once each, as a fresh mention would) */
  updateComment(commentId: string, body: string): void {
    const before = this.db.prepare('SELECT issue_id, user_id, body FROM comments WHERE id = ?').get(commentId) as { issue_id: string; user_id: string; body: string } | undefined;
    this.db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, ts(), commentId);
    if (!before) return;
    const had = new Set(this.mentions(before.body));
    for (const uid of this.mentions(body)) if (!had.has(uid)) this.notifyMention(before.issue_id, uid, before.user_id, body);
  }
  /** resolving closes a whole thread (its root carries the mark) */
  resolveComment(commentId: string, resolved: boolean): void {
    const row = this.db.prepare('SELECT id, parent_id FROM comments WHERE id = ?').get(commentId) as { id: string; parent_id: string | null } | undefined;
    if (!row) return;
    this.db.prepare('UPDATE comments SET resolved_at = ? WHERE id = ?').run(resolved ? ts() : null, row.parent_id ?? row.id);
  }
  deleteComment(commentId: string): void { this.db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').run(commentId, commentId); }

  // ---------- subscriptions ----------
  subscribe(issueId: string, userId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO subscriptions (issue_id, user_id) VALUES (?, ?)').run(issueId, userId);
  }
  unsubscribe(issueId: string, userId: string): void {
    this.db.prepare('DELETE FROM subscriptions WHERE issue_id = ? AND user_id = ?').run(issueId, userId);
  }
  isSubscribed(issueId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM subscriptions WHERE issue_id = ? AND user_id = ?').get(issueId, userId);
  }

  // ---------- attachments ----------
  addAttachment(input: { issueId: string; kind: 'link' | 'file'; url: string; title?: string; mime?: string; size?: number; id?: string }, userId?: string): Attachment {
    const a: Attachment = {
      id: input.id ?? id('att'), issueId: input.issueId, userId: userId ?? this.actor(), kind: input.kind,
      url: input.url, title: input.title?.trim() || input.url, mime: input.mime ?? '', size: input.size ?? 0, createdAt: ts(),
    };
    this.db.prepare('INSERT INTO attachments (id, issue_id, user_id, kind, url, title, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.id, a.issueId, a.userId, a.kind, a.url, a.title, a.mime, a.size, a.createdAt);
    this.logActivity({ issueId: a.issueId, type: 'attached', data: { attachmentId: a.id, title: a.title, kind: a.kind } }, userId);
    return a;
  }
  getAttachment(attachmentId: string): Attachment | undefined {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId) as AttachmentRow | undefined;
    return row ? this.mapAttachment(row) : undefined;
  }
  updateAttachment(attachmentId: string, title: string): void {
    this.db.prepare('UPDATE attachments SET title = ? WHERE id = ?').run(title, attachmentId);
  }
  deleteAttachment(attachmentId: string): void { this.db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId); }
  toggleReaction(commentId: string, emoji: string, userId: string): void {
    const row = this.db.prepare('SELECT reactions FROM comments WHERE id = ?').get(commentId) as { reactions: string } | undefined;
    if (!row) return;
    const r: Record<string, string[]> = JSON.parse(row.reactions);
    const arr = r[emoji] ?? [];
    r[emoji] = arr.includes(userId) ? arr.filter(u => u !== userId) : [...arr, userId];
    if (r[emoji].length === 0) delete r[emoji];
    this.db.prepare('UPDATE comments SET reactions = ? WHERE id = ?').run(JSON.stringify(r), commentId);
    // someone else reacting to your comment reaches your inbox (Notifications › Reactions)
    const c = this.db.prepare('SELECT issue_id, user_id, body FROM comments WHERE id = ?').get(commentId) as { issue_id: string; user_id: string; body: string };
    if (!arr.includes(userId)) this.notifyEach([c.user_id], 'commentReacted', { actorId: userId, issueId: c.issue_id, body: `${emoji} ${c.body}` });
  }

  // ---------- relations ----------
  setRelation(issueId: string, relatedId: string, type: RelationType, actorId?: string): IssueRelation {
    // blocks/blocked_by are directional; store the inverse row too so both issues see it
    const rel: IssueRelation = { id: id('r'), issueId, relatedIssueId: relatedId, type };
    this.db.prepare('INSERT INTO relations (id, issue_id, related_id, type) VALUES (?, ?, ?, ?)').run(rel.id, issueId, relatedId, type);
    if (type === 'blocks' || type === 'blocked_by') {
      const inverse: RelationType = type === 'blocks' ? 'blocked_by' : 'blocks';
      this.db.prepare('INSERT INTO relations (id, issue_id, related_id, type) VALUES (?, ?, ?, ?)').run(id('r'), relatedId, issueId, inverse);
    }
    this.logActivity({ issueId, type: 'related', data: { relatedId, type } }, actorId);
    return rel;
  }
  removeRelation(relationId: string): void {
    const row = this.db.prepare('SELECT * FROM relations WHERE id = ?').get(relationId) as { id: string; issue_id: string; related_id: string; type: RelationType } | undefined;
    if (!row) return;
    if (row.type === 'blocks' || row.type === 'blocked_by') {
      const inverse: RelationType = row.type === 'blocks' ? 'blocked_by' : 'blocks';
      this.db.prepare('DELETE FROM relations WHERE issue_id = ? AND related_id = ? AND type = ?').run(row.related_id, row.issue_id, inverse);
    }
    this.db.prepare('DELETE FROM relations WHERE id = ?').run(relationId);
    this.logActivity({ issueId: row.issue_id, type: 'unrelated', data: { relatedId: row.related_id, type: row.type } });
  }

  // ---------- projects ----------
  createProject(input: { name: string; teamId?: string | null; summary?: string; description?: string; icon?: string; color?: string; status?: Project['status']; leadId?: string | null; targetDate?: string | null; startDate?: string | null; priority?: Priority; memberIds?: string[]; locationIds?: string[]; labelIds?: string[]; statusId?: string | null }): Project {
    const now = ts();
    const p: Project = {
      id: id('p'), teamId: input.teamId ?? null, name: input.name, summary: input.summary ?? '', description: input.description ?? '',
      icon: input.icon ?? '🧊', color: input.color ?? '#5e6ad2', status: input.status ?? 'planned', health: 'onTrack',
      priority: input.priority ?? 0, locationIds: [],
      startDate: input.startDate ?? null, targetDate: input.targetDate ?? null, leadId: input.leadId ?? null,
      memberIds: input.memberIds ?? [], labelIds: input.labelIds ?? [], statusId: null, updateCadence: null,
      position: (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM projects').get() as { p: number }).p,
      createdAt: now, updatedAt: now, completedAt: input.status === 'completed' ? now : null,
    };
    const named = input.statusId ? this.projectStatus(input.statusId) : undefined;
    if (named) p.status = named.type;
    p.statusId = named?.id ?? this.defaultProjectStatus(p.status)?.id ?? null;
    this.db.prepare('INSERT INTO projects (id, team_id, name, summary, description, icon, color, status, health, priority, start_date, target_date, lead_id, members, position, created_at, updated_at, labels, status_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(p.id, p.teamId, p.name, p.summary, p.description, p.icon, p.color, p.status, p.health, p.priority, p.startDate, p.targetDate, p.leadId, JSON.stringify(p.memberIds), p.position, now, now, JSON.stringify(p.labelIds), p.statusId);
    // the person who makes a project follows it (the bell on the project page)
    const me = this.actor();
    if (me) this.setProjectSubscription(p.id, me, { comments: true, updates: true });
    this.logActivity({ projectId: p.id, type: 'projectCreated', data: {} });
    if (input.locationIds?.length) { this.setProjectLocations(p.id, input.locationIds); p.locationIds = this.projectLocationMap().get(p.id) ?? []; }
    return p;
  }
  updateProject(projectId: string, rawPatch: Partial<Pick<Project, 'name' | 'summary' | 'teamId' | 'description' | 'icon' | 'color' | 'status' | 'statusId' | 'health' | 'priority' | 'startDate' | 'targetDate' | 'leadId' | 'memberIds' | 'labelIds' | 'updateCadence' | 'position' | 'completedAt'>>, actorId?: string): void {
    const cur = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown> | undefined;
    if (!cur) return;
    const patch = { ...rawPatch };
    // a named status carries its category; a bare category picks that category's first status
    if (patch.statusId) { const st = this.projectStatus(patch.statusId); if (st) patch.status = st.type; else delete patch.statusId; }
    else if (patch.status && patch.status !== cur.status) patch.statusId = this.defaultProjectStatus(patch.status)?.id ?? null;
    if (patch.status && patch.status !== cur.status && patch.completedAt === undefined) patch.completedAt = patch.status === 'completed' ? ts() : null;
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    const col: Record<string, string> = { startDate: 'start_date', targetDate: 'target_date', leadId: 'lead_id', memberIds: 'members', labelIds: 'labels', completedAt: 'completed_at', teamId: 'team_id', statusId: 'status_id', updateCadence: 'update_cadence' };
    for (const [k, v] of sqlPairs(patch, ['name', 'summary', 'teamId', 'description', 'icon', 'color', 'status', 'statusId', 'health', 'priority', 'startDate', 'targetDate', 'leadId', 'memberIds', 'labelIds', 'updateCadence', 'position', 'completedAt'])) { const c = col[k] ?? k.replace(/[A-Z]/g, m => '_' + m.toLowerCase()); sets.push(`${c} = ?`); vals.push(k === 'memberIds' || k === 'labelIds' ? JSON.stringify(v) : v as string | number | null); }
    if (patch.description !== undefined && patch.description !== cur.description) this.notifyProject(projectId, 'comments', 'projectChanged', actorId, 'Project description changed');
    sets.push('updated_at = ?'); vals.push(ts(), projectId);
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    this.logActivity({ projectId, type: 'projectUpdated', data: { fields: Object.keys(patch) } }, actorId);
    if (patch.health) this.logActivity({ projectId, type: 'projectHealth', data: { to: patch.health } }, actorId);
  }
  // ---------- documents & team links ----------
  createDoc(input: { title?: string; content?: string; icon?: string; projectId?: string | null; teamId?: string | null; initiativeId?: string | null }, actorId?: string): Doc {
    const now = ts();
    const d: Doc = { id: id('doc'), title: input.title ?? '', icon: input.icon ?? '', content: input.content ?? '', projectId: input.projectId ?? null, teamId: input.teamId ?? null, initiativeId: input.initiativeId ?? null, creatorId: actorId ?? this.actor(), createdAt: now, updatedAt: now };
    this.db.prepare('INSERT INTO documents (id, title, icon, content, project_id, team_id, initiative_id, creator_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(d.id, d.title, d.icon, d.content, d.projectId, d.teamId, d.initiativeId, d.creatorId, now, now);
    if (d.projectId) this.logActivity({ projectId: d.projectId, type: 'projectUpdated', data: { fields: ['document'] } }, actorId);
    return d;
  }
  updateDoc(docId: string, patch: Partial<Pick<Doc, 'title' | 'content' | 'icon'>>, actorId?: string): void {
    const pairs = sqlPairs(patch, ['title', 'content', 'icon']);
    if (!pairs.length) return;
    this.db.prepare(`UPDATE documents SET ${pairs.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...(pairs.map(([, v]) => v) as string[]), ts(), docId);
    // someone else (an agent, a teammate) changing a document you wrote reaches your inbox
    const d = this.db.prepare('SELECT title, creator_id, project_id FROM documents WHERE id = ?').get(docId) as { title: string; creator_id: string | null; project_id: string | null } | undefined;
    if (d?.creator_id && actorId && actorId !== d.creator_id) {
      // one notification per document per hour, not one per keystroke
      const recent = this.db.prepare("SELECT 1 FROM notifications WHERE type = 'docChanged' AND user_id = ? AND body LIKE ? AND created_at > ?").get(d.creator_id, `${docId}|%`, new Date(Date.now() - 3600_000).toISOString());
      if (!recent) this.notifyEach([d.creator_id], 'docChanged', { actorId, projectId: d.project_id, body: `${docId}|${d.title || 'Untitled document'}` });
    }
  }
  deleteDoc(docId: string): void { this.db.prepare('DELETE FROM documents WHERE id = ?').run(docId); }
  addTeamLink(teamId: string, url: string, title?: string): void {
    this.db.prepare('INSERT INTO team_links (id, team_id, url, title, created_at) VALUES (?, ?, ?, ?, ?)').run(id('tl'), teamId, url, title?.trim() || url, ts());
  }
  deleteTeamLink(linkId: string): void { this.db.prepare('DELETE FROM team_links WHERE id = ?').run(linkId); }


  addProjectLink(projectId: string, url: string, title?: string): void {
    this.db.prepare('INSERT INTO project_links (id, project_id, url, title, created_at) VALUES (?, ?, ?, ?, ?)').run(id('pl'), projectId, url, title?.trim() || url, ts());
  }
  deleteProjectLink(linkId: string): void { this.db.prepare('DELETE FROM project_links WHERE id = ?').run(linkId); }
  deleteProject(projectId: string): void {
    this.db.prepare('UPDATE issues SET project_id = NULL WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM project_updates WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  }
  addProjectUpdate(projectId: string, userId: string, body: string, health?: Project['health']): ProjectUpdate {
    const now = ts();
    const u: ProjectUpdate = { id: id('pu'), projectId, userId, viaUserId: viaFor(userId), body, health: health ?? null, createdAt: now };
    this.db.prepare('INSERT INTO project_updates (id, project_id, user_id, via_user_id, body, health, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(u.id, projectId, userId, u.viaUserId, body, u.health, now);
    if (health) this.updateProject(projectId, { health }, userId);
    const pname = (this.db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined)?.name ?? '';
    this.notifyProject(projectId, 'updates', 'projectUpdate', userId, `New update on ${pname}: ${body.replace(/\s+/g, ' ').slice(0, 120)}`);
    return u;
  }

  /** who posted a project update (the route lets only them, or an admin, change it); null when it's gone */
  projectUpdateAuthor(updateId: string): string | null {
    return (this.db.prepare('SELECT user_id FROM project_updates WHERE id = ?').get(updateId) as { user_id: string } | undefined)?.user_id ?? null;
  }
  /** fix a posted update's text (a typo was permanent before) */
  editProjectUpdate(updateId: string, body: string): void {
    this.db.prepare('UPDATE project_updates SET body = ? WHERE id = ?').run(body, updateId);
  }
  deleteProjectUpdate(updateId: string): void {
    this.db.prepare('DELETE FROM project_updates WHERE id = ?').run(updateId);
  }

  projectProgress(projectId: string): { total: number; done: number; percent: number } {
    const rows = this.db.prepare(`SELECT s.type AS type, COUNT(*) AS n FROM issues i JOIN states s ON s.id = i.state_id WHERE i.project_id = ? AND i.archived_at IS NULL GROUP BY s.type`).all(projectId) as Array<{ type: string; n: number }>;
    const by = Object.fromEntries(rows.map(r => [r.type, r.n]));
    const total = rows.reduce((a, r) => a + r.n, 0);
    const done = (by['completed'] ?? 0) + (by['canceled'] ?? 0);
    return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  // ---------- cycles ----------
  createCycle(teamId: string, number: number, startsAt: string, endsAt: string, name = ''): Cycle {
    const c: Cycle = { id: id('cy'), teamId, number, name, startsAt, endsAt, completedAt: null };
    this.db.prepare('INSERT INTO cycles (id, team_id, number, name, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)').run(c.id, teamId, number, name, startsAt, endsAt);
    return c;
  }
  updateCycle(cycleId: string, patch: Partial<Pick<Cycle, 'name' | 'startsAt' | 'endsAt' | 'completedAt'>>): void {
    const col: Record<string, string> = { startsAt: 'starts_at', endsAt: 'ends_at', completedAt: 'completed_at' };
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'startsAt', 'endsAt', 'completedAt'])) { sets.push(`${col[k] ?? k.replace(/[A-Z]/g, m => '_' + m.toLowerCase())} = ?`); vals.push(v as string | number | null); }
    vals.push(cycleId);
    this.db.prepare(`UPDATE cycles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteCycle(cycleId: string): void {
    this.db.prepare('UPDATE issues SET cycle_id = NULL WHERE cycle_id = ?').run(cycleId);
    this.db.prepare('DELETE FROM cycles WHERE id = ?').run(cycleId);
  }
  /** keep a team on its cadence: with automation on, the running cycle plus `cycleUpcoming`
   *  future cycles always exist, laid end to end (cooldown weeks between them) */
  scheduleCycles(teamId: string, now = new Date()): void {
    const team = this.getTeam(teamId);
    if (!team?.autoCycles) return;
    const len = Math.max(1, team.cycleDuration) * 7 * DAY;
    const gap = Math.max(0, team.cycleCooldown) * 7 * DAY;
    const cycles = (this.db.prepare('SELECT * FROM cycles WHERE team_id = ? ORDER BY starts_at').all(teamId) as Array<{ number: number; starts_at: string; ends_at: string }>);
    let number = cycles.length ? Math.max(...cycles.map(c => c.number)) : 0;
    let start: number;
    if (cycles.length) start = new Date(cycles[cycles.length - 1].ends_at).getTime() + 1000 + gap;
    else {
      // the first cycle starts on the most recent Monday
      const d = new Date(now); d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      start = d.getTime();
    }
    // catch up from a long gap without back-filling empty cycles
    while (start + len < now.getTime()) start += len + gap;
    const future = () => (this.db.prepare('SELECT COUNT(*) n FROM cycles WHERE team_id = ? AND ends_at > ?').get(teamId, now.toISOString()) as { n: number }).n;
    for (let guard = 0; future() < team.cycleUpcoming + 1 && guard < 12; guard++) {
      number++;
      const end = start + len - 1000;
      this.createCycle(teamId, number, new Date(start).toISOString(), new Date(end).toISOString());
      start = end + 1000 + gap;
    }
  }
  /** close cycles whose time is up; with rollover on, their unfinished issues move to the next cycle */
  completeEndedCycles(now = new Date()): void {
    const ended = this.db.prepare('SELECT c.id, c.team_id, c.ends_at, t.cycle_rollover FROM cycles c JOIN teams t ON t.id = c.team_id WHERE c.completed_at IS NULL AND c.ends_at < ?').all(now.toISOString()) as Array<{ id: string; team_id: string; ends_at: string; cycle_rollover: number }>;
    for (const c of ended) {
      if (c.cycle_rollover) {
        const next = this.db.prepare('SELECT id FROM cycles WHERE team_id = ? AND starts_at > ? ORDER BY starts_at LIMIT 1').get(c.team_id, c.ends_at) as { id: string } | undefined;
        if (next) {
          const open = this.db.prepare("SELECT i.id FROM issues i JOIN states s ON s.id = i.state_id WHERE i.cycle_id = ? AND s.type NOT IN ('completed', 'canceled') AND i.archived_at IS NULL AND i.deleted_at IS NULL").all(c.id) as Array<{ id: string }>;
          for (const i of open) this.updateIssue(i.id, { cycleId: next.id });
        }
      }
      this.db.prepare('UPDATE cycles SET completed_at = ? WHERE id = ?').run(now.toISOString(), c.id);
    }
  }
  /** periodic upkeep run before each snapshot: cycle cadence and rollover, recurring issues */
  /** did anything snoozed (an inbox row, a "Remind me", an issue in triage) come due in (from, to]? */
  wokeBetween(from: Date, to: Date): boolean {
    const [a, b] = [from.toISOString(), to.toISOString()];
    return !!this.db.prepare('SELECT 1 FROM notifications WHERE snoozed_until > ? AND snoozed_until <= ? LIMIT 1').get(a, b)
      || !!this.db.prepare('SELECT 1 FROM issues WHERE snoozed_until > ? AND snoozed_until <= ? LIMIT 1').get(a, b);
  }

  tick(now = new Date()): void {
    for (const t of this.db.prepare('SELECT id FROM teams WHERE auto_cycles = 1').all() as Array<{ id: string }>) this.scheduleCycles(t.id, now);
    this.completeEndedCycles(now);
    this.fileRecurring(now);
    this.remindUpdates(now);
    this.updatesDigest(now);
    for (const h of this.tickHooks) h(now);
  }

  // ---------- recurring issues ----------
  static nextOccurrence(from: Date, cadence: RecurringIssue['cadence']): Date {
    const d = new Date(from);
    if (cadence === 'daily') d.setDate(d.getDate() + 1);
    else if (cadence === 'weekly') d.setDate(d.getDate() + 7);
    else if (cadence === 'biweekly') d.setDate(d.getDate() + 14);
    else d.setMonth(d.getMonth() + 1);
    return d;
  }
  createRecurring(input: { teamId: string; title: string; description?: string; priority?: Priority; assigneeId?: string | null; labelIds?: string[]; projectId?: string | null; cadence: RecurringIssue['cadence']; startAt?: string }): RecurringIssue {
    const r: RecurringIssue = {
      id: id('rec'), teamId: input.teamId, title: input.title, description: input.description ?? '', priority: input.priority ?? 0,
      assigneeId: input.assigneeId ?? null, labelIds: input.labelIds ?? [], projectId: input.projectId ?? null, cadence: input.cadence,
      nextAt: input.startAt ?? Store.nextOccurrence(new Date(), input.cadence).toISOString(), createdAt: ts(),
    };
    this.db.prepare('INSERT INTO recurring_issues (id, team_id, title, description, priority, assignee_id, labels, project_id, cadence, next_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(r.id, r.teamId, r.title, r.description, r.priority, r.assigneeId, JSON.stringify(r.labelIds), r.projectId, r.cadence, r.nextAt, r.createdAt);
    return r;
  }
  updateRecurring(recId: string, patch: Partial<Pick<RecurringIssue, 'title' | 'description' | 'cadence' | 'nextAt' | 'priority' | 'assigneeId'>>): void {
    const col: Record<string, string> = { nextAt: 'next_at', assigneeId: 'assignee_id' };
    const pairs = sqlPairs(patch, ['title', 'description', 'cadence', 'nextAt', 'priority', 'assigneeId']);
    if (!pairs.length) return;
    this.db.prepare(`UPDATE recurring_issues SET ${pairs.map(([k]) => `${col[k] ?? k} = ?`).join(', ')} WHERE id = ?`).run(...(pairs.map(([, v]) => v) as Array<string | number | null>), recId);
  }
  deleteRecurring(recId: string): void { this.db.prepare('DELETE FROM recurring_issues WHERE id = ?').run(recId); }
  /** file every recurring issue whose time has come (once each, so a long gap doesn't flood the backlog) */
  fileRecurring(now = new Date()): void {
    const due = this.db.prepare('SELECT * FROM recurring_issues WHERE next_at <= ?').all(now.toISOString()) as Array<{ id: string; team_id: string; title: string; description: string; priority: number; assignee_id: string | null; labels: string; project_id: string | null; cadence: RecurringIssue['cadence']; next_at: string }>;
    for (const r of due) {
      this.createIssue({ teamId: r.team_id, title: r.title, description: r.description, priority: r.priority as Priority, assigneeId: r.assignee_id, labelIds: JSON.parse(r.labels), projectId: r.project_id, stateId: this.stateOfType(r.team_id, 'unstarted') });
      let next = Store.nextOccurrence(new Date(r.next_at), r.cadence);
      while (next <= now) next = Store.nextOccurrence(next, r.cadence);
      this.db.prepare('UPDATE recurring_issues SET next_at = ? WHERE id = ?').run(next.toISOString(), r.id);
    }
  }

  // ---------- milestones ----------
  createMilestone(projectId: string, name: string, targetDate: string | null = null): Milestone {
    const m: Milestone = { id: id('ms'), projectId, name, targetDate, status: 'planned', position: (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM milestones WHERE project_id = ?').get(projectId) as { p: number }).p, createdAt: ts() };
    this.db.prepare('INSERT INTO milestones (id, project_id, name, target_date, status, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(m.id, projectId, name, targetDate, m.status, m.position, m.createdAt);
    return m;
  }
  updateMilestone(milestoneId: string, patch: Partial<Pick<Milestone, 'name' | 'targetDate' | 'status' | 'position'>>): void {
    const col: Record<string, string> = { targetDate: 'target_date' };
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'targetDate', 'status', 'position'])) { sets.push(`${col[k] ?? k.replace(/[A-Z]/g, mm => '_' + mm.toLowerCase())} = ?`); vals.push(v as string | number | null); }
    vals.push(milestoneId);
    this.db.prepare(`UPDATE milestones SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteMilestone(milestoneId: string): void {
    this.db.prepare('DELETE FROM milestones WHERE id = ?').run(milestoneId);
  }

  // ---------- views ----------
  createView(name: string, filters: ViewFilters, opts: { teamId?: string | null; icon?: string; groupBy?: GroupBy; orderBy?: OrderBy; layout?: 'list' | 'board'; kind?: SavedView['kind']; projectOptions?: Record<string, unknown> | null; shared?: boolean }): SavedView {
    const v: SavedView = {
      ownerId: this.actor() || null, shared: opts.shared !== false,
      id: id('v'), teamId: opts.teamId ?? null, name, icon: opts.icon ?? '', filters,
      groupBy: opts.groupBy ?? 'status', orderBy: opts.orderBy ?? 'priority', layout: opts.layout ?? 'list',
      position: (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM views').get() as { p: number }).p,
      kind: opts.kind === 'projects' ? 'projects' : 'issues', projectOptions: opts.projectOptions ?? null,
    };
    this.db.prepare('INSERT INTO views (id, team_id, name, icon, filters, group_by, order_by, layout, position, created_at, kind, project_options, owner_id, shared) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(v.id, v.teamId, v.name, v.icon, JSON.stringify(v.filters), v.groupBy, v.orderBy, v.layout, v.position, ts(), v.kind, v.projectOptions ? JSON.stringify(v.projectOptions) : null, v.ownerId, v.shared ? 1 : 0);
    return v;
  }
  /** a view you can see: shared with the workspace, or yours */
  private visibleView(viewId: string): { owner_id: string | null; shared: number } | undefined {
    return this.db.prepare('SELECT owner_id, shared FROM views WHERE id = ? AND (shared = 1 OR owner_id = ?)').get(viewId, this.actor()) as { owner_id: string | null; shared: number } | undefined;
  }
  /** anyone may edit a shared view; only its owner decides whether it's shared */
  updateView(viewId: string, patch: Partial<Pick<SavedView, 'name' | 'icon' | 'filters' | 'groupBy' | 'orderBy' | 'layout' | 'position' | 'projectOptions' | 'shared'>>): boolean {
    const view = this.visibleView(viewId);
    if (!view) return false;
    const col: Record<string, string> = { groupBy: 'group_by', orderBy: 'order_by', projectOptions: 'project_options' };
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'icon', 'filters', 'groupBy', 'orderBy', 'layout', 'position', 'projectOptions'])) { const c = col[k] ?? k.replace(/[A-Z]/g, m => '_' + m.toLowerCase()); sets.push(`${c} = ?`); vals.push(k === 'filters' || k === 'projectOptions' ? (v == null ? null : JSON.stringify(v)) : v as string | number | null); }
    if (typeof patch.shared === 'boolean' && view.owner_id === this.actor()) { sets.push('shared = ?'); vals.push(patch.shared ? 1 : 0); }
    if (!sets.length) return true;
    vals.push(viewId);
    this.db.prepare(`UPDATE views SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return true;
  }
  deleteView(viewId: string): boolean {
    if (!this.visibleView(viewId)) return false;
    this.db.prepare('DELETE FROM views WHERE id = ?').run(viewId);
    this.db.prepare("DELETE FROM favorites WHERE type = 'view' AND ref_id = ?").run(viewId);
    return true;
  }

  // ---------- favorites ----------
  /** star or unstar for whoever is acting; everyone keeps their own favorites */
  toggleFavorite(type: Favorite['type'], refId: string): void {
    const me = this.actor();
    const existing = this.db.prepare('SELECT id FROM favorites WHERE type = ? AND ref_id = ? AND user_id = ?').get(type, refId, me) as { id: string } | undefined;
    if (existing) this.db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
    else this.db.prepare('INSERT INTO favorites (id, type, ref_id, position, user_id) VALUES (?, ?, ?, ?, ?)').run(id('f'), type, refId, (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM favorites WHERE user_id = ?').get(me) as { p: number }).p, me);
  }

  // ---------- notifications ----------
  // only notify when someone else assigned it to you, never for self-assignment
  private notifyAssign(issueId: string, assigneeId: string, actorId?: string): void {
    // the actor is who the inbox row leads with; without it the row falls back
    // to the app's own tile, which reads as a system message it isn't
    this.notifyEach([assigneeId], 'issueAssignedToYou', { actorId, issueId, body: 'You were assigned this issue' });
  }
  /** single insert point for every notification the store raises; `userId` is whose inbox it lands in */
  notify(type: NotificationType, o: { userId: string; actorId?: string | null; issueId?: string | null; projectId?: string | null; body?: string; createdAt?: string }): void {
    // text people wrote is a preview line: plain text, not markdown or mention tokens. Other
    // bodies are structured ("<docId>|<title>") and keep their exact text.
    const raw = o.body ?? '';
    const body = PLAIN_BODY.has(type) ? clip(plainText(raw), 160) : plainMentions(raw);
    this.db.prepare('INSERT INTO notifications (id, type, actor_id, issue_id, project_id, body, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id('n'), type, o.actorId ?? null, o.issueId ?? null, o.projectId ?? null, body, o.createdAt ?? ts(), o.userId);
  }
  /** one notification in each recipient's inbox: once per person, never to agents (they have no
   *  inbox), and never to whoever is acting unless `selfToo` (as in Linear: your own action isn't news).
   *  An agent acting for someone counts as that person here: their own agent's moves aren't news
   *  to them either (only its finish and blocked reports are, which pass `selfToo`). */
  notifyEach(recipients: Iterable<string | null | undefined>, type: NotificationType, o: { actorId?: string | null; issueId?: string | null; projectId?: string | null; body?: string; createdAt?: string; selfToo?: boolean }): void {
    const { selfToo, ...rest } = o;
    const actorId = o.actorId === undefined ? this.actor() : o.actorId;
    const agent = this.db.prepare("SELECT 1 FROM users WHERE id = ? AND kind = 'agent'");
    const forPerson = actorId ? viaFor(actorId) : null;
    for (const userId of new Set(recipients)) {
      if (!userId || (!selfToo && (userId === actorId || userId === forPerson)) || agent.get(userId)) continue;
      this.notify(type, { ...rest, actorId, userId });
    }
  }
  /** who a text mentions: `@[Name](user:id)` tokens, plus plain "@Name" when the name is unambiguous */
  private mentions(body: string): string[] {
    return mentionedIds(body, this.db.prepare('SELECT id, name FROM users').all() as unknown as Array<{ id: string; name: string }>);
  }
  /** everyone following an issue */
  subscribers(issueId: string): string[] {
    return (this.db.prepare('SELECT user_id FROM subscriptions WHERE issue_id = ?').all(issueId) as Array<{ user_id: string }>).map(r => r.user_id);
  }
  /** raise one for each person following the issue, except whoever acted and anyone who muted
   *  this kind (`Preferences.notify`, e.g. status changes, switched from the inbox's display
   *  options). `skip`: people a stronger notification already reached. */
  private notifySubscribed(issueId: string, type: NotificationType, actorId: string | undefined, body: string, pref: keyof Preferences['notify'], skip: Iterable<string> = []): void {
    const done = new Set(skip);
    this.notifyEach(this.subscribers(issueId).filter(u => !done.has(u) && this.getPreferences(u).notify[pref] !== false), type, { actorId, issueId, body });
  }
  private notifyMention(issueId: string, userId: string, actorId: string | undefined, body: string): void {
    this.notifyEach([userId], 'issueMentioned', { actorId, issueId, body });
  }
  listNotifications(): Notification[] { return this.snapshot().notifications; }
  // everyone reads, snoozes and clears only their own inbox
  markNotificationRead(notificationId: string, read = true): void { this.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(read ? ts() : null, notificationId, this.actor()); }
  markAllNotificationsRead(): void { this.db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND user_id = ?').run(ts(), this.actor()); }
  deleteNotification(notificationId: string): void { this.db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(notificationId, this.actor()); }
  deleteReadNotifications(): void { this.db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND user_id = ?').run(this.actor()); }
  /** "Remind me": a notification in your own inbox that stays hidden until `at` */
  remindIssue(issueId: string, at: string): void {
    this.db.prepare('INSERT INTO notifications (id, type, actor_id, issue_id, body, snoozed_until, created_at, user_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
      .run(id('n'), 'issueReminder', issueId, 'Reminder', at, at, this.actor());
  }
  /** null wakes it now; a snoozed notification comes back unread */
  snoozeNotification(notificationId: string, until: string | null): void {
    this.db.prepare('UPDATE notifications SET snoozed_until = ?, read_at = NULL WHERE id = ? AND user_id = ?').run(until, notificationId, this.actor());
  }

  // ---------- preferences ----------
  /** someone's own preferences (the acting person's by default) over the defaults */
  getPreferences(userId = this.actor()): Preferences {
    try {
      const row = this.db.prepare('SELECT json FROM user_preferences WHERE user_id = ?').get(userId) as { json: string } | undefined;
      const raw = JSON.parse(row?.json ?? '{}') as Partial<Preferences>;
      // push.browser was stored as push.desktop before the rename
      const { desktop, ...rawPush } = (raw.push ?? {}) as Partial<Preferences['push']> & { desktop?: boolean };
      return { ...DEFAULT_PREFERENCES, ...raw, notify: { ...DEFAULT_PREFERENCES.notify, ...(raw.notify ?? {}) }, push: { ...DEFAULT_PREFERENCES.push, ...(desktop === undefined ? {} : { browser: desktop }), ...rawPush, types: { ...DEFAULT_PREFERENCES.push.types, ...(raw.push?.types ?? {}) } }, sidebar: { ...DEFAULT_PREFERENCES.sidebar, ...(raw.sidebar ?? {}), items: { ...(raw.sidebar?.items ?? {}) } }, gettingStarted: gettingStartedFrom(raw.gettingStarted) };
    } catch { return DEFAULT_PREFERENCES; }
  }
  setPreferences(patch: PreferencesPatch, userId = this.actor()): void {
    if (!userId) return;
    const cur = this.getPreferences(userId);
    const next = { ...cur, ...patch, notify: { ...cur.notify, ...(patch.notify ?? {}) }, push: { ...cur.push, ...(patch.push ?? {}), types: { ...cur.push.types, ...(patch.push?.types ?? {}) } }, sidebar: { ...cur.sidebar, ...(patch.sidebar ?? {}), items: { ...cur.sidebar.items, ...(patch.sidebar?.items ?? {}) } }, gettingStarted: gettingStartedFrom({ ...cur.gettingStarted, ...(patch.gettingStarted ?? {}) }) };
    this.db.prepare('INSERT INTO user_preferences (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json').run(userId, JSON.stringify(next));
  }

  getFeatures(): WorkspaceFeatures {
    // keys of switches that no longer exist are dropped, so old workspaces don't leak them
    let stored: Record<string, unknown> = {};
    try { stored = JSON.parse(getMeta(this.db, 'features') ?? '{}') as Record<string, unknown>; } catch { /* defaults */ }
    return { ...DEFAULT_FEATURES, ...this.featuresInUse(stored), ...Object.fromEntries(Object.entries(stored).filter(([k]) => k in DEFAULT_FEATURES)) } as WorkspaceFeatures;
  }
  /** the off-by-default switches nobody has set yet start on when the workspace already uses them,
   *  so a workspace from before Settings › Features (or the sample workspace) keeps what it has */
  private featuresInUse(stored: Record<string, unknown>): Partial<WorkspaceFeatures> {
    const has = (sql: string) => { try { return !!this.db.prepare(sql).get(); } catch { return false; } };
    const probes: Array<[keyof WorkspaceFeatures, string]> = [
      ['cyclesEnabled', 'SELECT 1 FROM cycles UNION ALL SELECT 1 FROM teams WHERE auto_cycles = 1 LIMIT 1'],
      ['estimatesEnabled', 'SELECT 1 FROM issues WHERE estimate IS NOT NULL LIMIT 1'],
      ['templatesEnabled', 'SELECT 1 FROM issue_templates LIMIT 1'],
      ['documentsEnabled', 'SELECT 1 FROM documents LIMIT 1'],
      ['recurringEnabled', 'SELECT 1 FROM recurring_issues LIMIT 1'],
      ['projectUpdatesEnabled', 'SELECT 1 FROM project_updates LIMIT 1'],
      ['initiativesEnabled', 'SELECT 1 FROM initiatives LIMIT 1'],
      ['slasEnabled', 'SELECT 1 FROM sla_rules LIMIT 1'],
      ['loopsEnabled', 'SELECT 1 FROM loops LIMIT 1'],
    ];
    return Object.fromEntries(probes.filter(([k]) => !(k in stored)).map(([k, sql]) => [k, has(sql)]));
  }
  setFeatures(patch: Partial<WorkspaceFeatures>): void { setMeta(this.db, 'features', JSON.stringify({ ...this.getFeatures(), ...patch })); }

  getSecurity(): WorkspaceSecurity {
    try { return { ...DEFAULT_SECURITY, ...(JSON.parse(getMeta(this.db, 'security') ?? '{}') as Partial<WorkspaceSecurity>) }; } catch { return DEFAULT_SECURITY; }
  }
  setSecurity(patch: Partial<WorkspaceSecurity>): WorkspaceSecurity {
    const cur = this.getSecurity();
    const next: WorkspaceSecurity = {
      // "@Acme.dev " and "acme.dev" are the same domain
      approvedDomains: patch.approvedDomains ? [...new Set(patch.approvedDomains.map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))] : cur.approvedDomains,
      domainTeamIds: patch.domainTeamIds ?? cur.domainTeamIds,
      whoCanInvite: patch.whoCanInvite === 'members' || patch.whoCanInvite === 'admins' ? patch.whoCanInvite : cur.whoCanInvite,
      smallTeamInvites: typeof patch.smallTeamInvites === 'boolean' ? patch.smallTeamInvites : cur.smallTeamInvites,
    };
    setMeta(this.db, 'security', JSON.stringify(next));
    return next;
  }

  // ---------- project labels ----------
  createProjectLabel(input: { name: string; color?: string; description?: string; parentId?: string | null; isGroup?: boolean }): ProjectLabel {
    const l: ProjectLabel = { id: id('pl'), name: input.name.trim(), color: input.color ?? '#8a8f98', description: input.description ?? '', parentId: input.parentId ?? null, isGroup: !!input.isGroup, createdAt: ts() };
    this.db.prepare('INSERT INTO project_labels (id, name, color, description, parent_id, is_group, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(l.id, l.name, l.color, l.description, l.parentId, l.isGroup ? 1 : 0, l.createdAt);
    return l;
  }
  updateProjectLabel(labelId: string, patch: Partial<Pick<ProjectLabel, 'name' | 'color' | 'description' | 'parentId'>>): void {
    const col: Record<string, string> = { parentId: 'parent_id' };
    const sets: string[] = []; const vals: (string | null)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'color', 'description', 'parentId'])) { sets.push(`${col[k] ?? k} = ?`); vals.push(v as string | null); }
    if (!sets.length) return;
    vals.push(labelId);
    this.db.prepare(`UPDATE project_labels SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  /** deleting a group deletes the labels in it; every project loses the removed labels */
  deleteProjectLabel(labelId: string): void {
    const gone = [labelId, ...(this.db.prepare('SELECT id FROM project_labels WHERE parent_id = ?').all(labelId) as Array<{ id: string }>).map(r => r.id)];
    for (const l of gone) this.db.prepare('DELETE FROM project_labels WHERE id = ?').run(l);
    for (const p of this.db.prepare('SELECT id, labels FROM projects').all() as Array<{ id: string; labels: string }>) {
      const cur = JSON.parse(p.labels ?? '[]') as string[];
      const next = cur.filter(x => !gone.includes(x));
      if (next.length !== cur.length) this.db.prepare('UPDATE projects SET labels = ? WHERE id = ?').run(JSON.stringify(next), p.id);
    }
  }

  // ---------- project statuses ----------
  projectStatus(statusId: string): ProjectStatusDef | undefined {
    const x = this.db.prepare('SELECT * FROM project_statuses WHERE id = ?').get(statusId) as { id: string; type: Project['status']; name: string; color: string; description: string; position: number } | undefined;
    return x ? { id: x.id, type: x.type, name: x.name, color: x.color, description: x.description, position: x.position } : undefined;
  }
  defaultProjectStatus(type: Project['status']): ProjectStatusDef | undefined {
    const x = this.db.prepare('SELECT id FROM project_statuses WHERE type = ? ORDER BY position LIMIT 1').get(type) as { id: string } | undefined;
    return x ? this.projectStatus(x.id) : undefined;
  }
  createProjectStatus(input: { type: Project['status']; name: string; color?: string; description?: string }): ProjectStatusDef {
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 p FROM project_statuses WHERE type = ?').get(input.type) as { p: number }).p;
    const st: ProjectStatusDef = { id: id('ps'), type: input.type, name: input.name.trim(), color: input.color ?? '#8a8f98', description: input.description ?? '', position: pos };
    this.db.prepare('INSERT INTO project_statuses (id, type, name, color, description, position) VALUES (?, ?, ?, ?, ?, ?)').run(st.id, st.type, st.name, st.color, st.description, st.position);
    return st;
  }
  updateProjectStatus(statusId: string, patch: Partial<Pick<ProjectStatusDef, 'name' | 'color' | 'description' | 'position'>>): void {
    const sets: string[] = []; const vals: (string | number)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'color', 'description', 'position'])) { sets.push(`${k} = ?`); vals.push(v as string | number); }
    if (!sets.length) return;
    vals.push(statusId);
    this.db.prepare(`UPDATE project_statuses SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  /** a category keeps at least one status; projects on a deleted status move to the category's first */
  deleteProjectStatus(statusId: string): boolean {
    const st = this.projectStatus(statusId);
    if (!st) return false;
    const others = this.db.prepare('SELECT id FROM project_statuses WHERE type = ? AND id != ? ORDER BY position').all(st.type, statusId) as Array<{ id: string }>;
    if (!others.length) return false;
    this.db.prepare('UPDATE projects SET status_id = ? WHERE status_id = ?').run(others[0].id, statusId);
    this.db.prepare('DELETE FROM project_statuses WHERE id = ?').run(statusId);
    return true;
  }

  // ---------- project subscriptions (the bell) ----------
  setProjectSubscription(projectId: string, userId: string, flags: Partial<Omit<ProjectSubscription, 'projectId' | 'userId'>>): void {
    const cur = this.db.prepare('SELECT * FROM project_subscriptions WHERE project_id = ? AND user_id = ?').get(projectId, userId) as { issue_added: number; issue_closed: number; comments: number; updates: number } | undefined;
    const v = {
      issue_added: flags.issueAdded ?? !!cur?.issue_added, issue_closed: flags.issueClosed ?? !!cur?.issue_closed,
      comments: flags.comments ?? (cur ? !!cur.comments : true), updates: flags.updates ?? (cur ? !!cur.updates : true),
    };
    if (!v.issue_added && !v.issue_closed && !v.comments && !v.updates) { this.db.prepare('DELETE FROM project_subscriptions WHERE project_id = ? AND user_id = ?').run(projectId, userId); return; }
    this.db.prepare('INSERT INTO project_subscriptions (project_id, user_id, issue_added, issue_closed, comments, updates) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, user_id) DO UPDATE SET issue_added = excluded.issue_added, issue_closed = excluded.issue_closed, comments = excluded.comments, updates = excluded.updates')
      .run(projectId, userId, v.issue_added ? 1 : 0, v.issue_closed ? 1 : 0, v.comments ? 1 : 0, v.updates ? 1 : 0);
  }
  /** notify everyone following a project for this kind of event, but never about their own changes */
  private notifyProject(projectId: string, flag: 'issueAdded' | 'issueClosed' | 'comments' | 'updates', type: NotificationType, actorId: string | undefined | null, body: string, issueId?: string): void {
    const col = { issueAdded: 'issue_added', issueClosed: 'issue_closed', comments: 'comments', updates: 'updates' }[flag];
    let subs = this.db.prepare(`SELECT user_id FROM project_subscriptions WHERE project_id = ? AND ${col} = 1`).all(projectId) as Array<{ user_id: string }>;
    // project updates reach a person one way: in their summary while summaries are on, one by one only when off
    if (flag === 'updates') subs = subs.filter(r => this.getPreferences(r.user_id).updatesSummary === 'off');
    this.notifyEach(subs.map(r => r.user_id), type, { actorId: actorId ?? this.actor(), projectId, issueId: issueId ?? null, body });
  }

  // ---------- update schedule & summaries ----------
  private cadenceDays(c: UpdateCadence): number | null { return c === 'weekly' ? 7 : c === 'biweekly' ? 14 : c === 'monthly' ? 30 : null; }
  /** when the next update is due on a project (null: no expectation) */
  updateDueAt(project: Pick<Project, 'id' | 'updateCadence' | 'createdAt'>): string | null {
    const days = this.cadenceDays(project.updateCadence ?? this.getFeatures().updateCadence);
    if (!days) return null;
    const last = this.db.prepare('SELECT MAX(created_at) t FROM project_updates WHERE project_id = ?').get(project.id) as { t: string | null };
    return new Date(new Date(last.t ?? project.createdAt).getTime() + days * 86400000).toISOString();
  }
  /** each project's lead gets one inbox reminder each time an update falls due */
  private remindUpdates(now: Date): void {
    for (const row of this.db.prepare("SELECT * FROM projects WHERE lead_id IS NOT NULL AND status NOT IN ('completed', 'canceled')").all() as Array<Record<string, unknown>>) {
      const p = this.mapProject(row);
      const due = this.updateDueAt(p);
      if (!due || due > now.toISOString()) continue;
      const already = this.db.prepare("SELECT 1 FROM notifications WHERE type = 'projectUpdateReminder' AND project_id = ? AND user_id = ? AND created_at >= ?").get(p.id, p.leadId, due);
      if (!already) this.notifyEach([p.leadId], 'projectUpdateReminder', { actorId: null, projectId: p.id, body: `An update on ${p.name} is due`, createdAt: now.toISOString() });
    }
  }
  /** each active person gets a summary of new updates on projects they lead, are a member of, or
   *  follow, on their own schedule (Settings › Notifications); nothing new, no summary */
  private updatesDigest(now: Date): void {
    for (const { id: userId } of this.db.prepare("SELECT id FROM users WHERE kind != 'agent' AND status = 'active'").all() as Array<{ id: string }>) {
      const schedule = this.getPreferences(userId).updatesSummary;
      if (schedule === 'off') continue;
      const days = schedule === 'daily' ? 1 : 7;
      const last = (this.db.prepare("SELECT MAX(created_at) t FROM notifications WHERE type = 'updatesDigest' AND user_id = ?").get(userId) as { t: string | null }).t;
      if (last && now.getTime() - new Date(last).getTime() < days * 86400000) continue;
      const since = last ?? new Date(now.getTime() - days * 86400000).toISOString();
      const n = this.summaryUpdates(userId, since, now.toISOString()).length;
      if (n) this.notify('updatesDigest', { userId, body: `${n} project update${n === 1 ? '' : 's'} since your last summary`, createdAt: now.toISOString() });
    }
  }
  /** the updates a person's summary covers: posted in (since, until] on projects they're on or follow */
  private summaryUpdates(userId: string, since: string, until: string): Array<{ id: string }> {
    return this.db.prepare(`SELECT u.id FROM project_updates u JOIN projects p ON p.id = u.project_id
      WHERE u.created_at > ? AND u.created_at <= ? AND (p.lead_id = ? OR EXISTS (SELECT 1 FROM json_each(p.members) WHERE value = ?)
        OR EXISTS (SELECT 1 FROM project_subscriptions s WHERE s.project_id = p.id AND s.user_id = ? AND s.updates = 1))
      ORDER BY u.created_at DESC`).all(since, until, userId, userId, userId) as Array<{ id: string }>;
  }

  // ---------- activity ----------
  logActivity(e: { issueId?: string; projectId?: string; type: ActivityType; data?: Record<string, unknown> }, actorId?: string): void {
    const uid = actorId ?? this.actor();
    this.db.prepare('INSERT INTO activity (id, issue_id, project_id, user_id, via_user_id, type, data, created_at, op_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id('a'), e.issueId ?? null, e.projectId ?? null, uid, viaFor(uid), e.type, JSON.stringify(e.data ?? {}), ts(), currentOp.getStore() ?? null);
  }
  issueActivity(issueId: string): ActivityItem[] { return this.snapshot().activity.filter(a => a.issueId === issueId).reverse(); }

  // ---------- search ----------
  search(q: string): { issues: Issue[]; projects: Project[] } {
    const issues = this.listIssues({ query: q, limit: 20 });
    const projects = (this.db.prepare('SELECT * FROM projects WHERE name LIKE ? ORDER BY position LIMIT 10').all(`%${q}%`) as Array<Record<string, unknown>>).map(p => this.mapProject(p as Record<string, unknown>));
    return { issues, projects };
  }

  // ---------- workspace meta ----------
  workspaceMeta(): { id: string; name: string; createdAt: string; currentUser: string } {
    return {
      id: getMeta(this.db, 'workspaceId') ?? '', name: getMeta(this.db, 'workspaceName') ?? 'Workspace',
      createdAt: getMeta(this.db, 'workspaceCreatedAt') ?? '', currentUser: getMeta(this.db, 'currentUser') ?? '',
    };
  }
  setWorkspaceName(name: string): void { setMeta(this.db, 'workspaceName', name); }
  /** who this write is by: the signed-in person on a server request, else the workspace's own user */
  actor(): string { return actingUser.getStore() ?? getMeta(this.db, 'currentUser') ?? ''; }
  setCurrentUser(userId: string): void { setMeta(this.db, 'currentUser', userId); }

  // ---------- export / import / reset ----------
  exportJson(): string {
    const snap = this.snapshot();
    // the snapshot hides archived and trashed issues; a backup keeps them
    const issues = (this.db.prepare('SELECT * FROM issues').all() as unknown as IssueRow[]).map(this.mapIssue);
    // uploaded images are included as base64; they're small, so the JSON stays a complete backup
    const files = (this.db.prepare('SELECT * FROM files ORDER BY created_at').all() as Array<Record<string, unknown>>).map(f => ({
      id: f.id, name: f.name, mime: f.mime, size: f.size, sha256: f.sha256,
      ownerType: f.owner_type, ownerId: f.owner_id, uploadedBy: f.uploaded_by, createdAt: f.created_at,
      data: Buffer.from(f.data as Uint8Array).toString('base64'),
    }));
    return JSON.stringify({ exportedAt: ts(), ...snap, issues, files }, null, 2);
  }
  /** restore a full workspace from an exportJson payload (keeps ids) */
  importJson(json: string): void {
    const data = JSON.parse(json) as Record<string, unknown>;
    // all-or-nothing: the wipe and every insert commit together, so a bad backup leaves the
    // current workspace exactly as it was instead of wiped and half-restored
    this.transaction(() => this.restore(data));
  }
  /** run `fn` in one SQLite transaction (rolled back if it throws); nested calls join the outer one */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth++;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.txDepth--;
    }
  }
  private txDepth = 0;
  private restore(data: Record<string, unknown>): void {
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
    this.wipe();
    const ws = data.workspace as Partial<Snapshot['workspace']> | undefined;
    if (ws) {
      if (ws.id) setMeta(this.db, 'workspaceId', ws.id);
      if (ws.name) setMeta(this.db, 'workspaceName', ws.name);
      if (ws.createdAt) setMeta(this.db, 'workspaceCreatedAt', ws.createdAt);
      // restore the coding-tools settings too
      if (ws.handoffPromptTemplate && ws.handoffPromptTemplate !== DEFAULT_PROMPT_TEMPLATE) setMeta(this.db, 'handoffPromptTemplate', ws.handoffPromptTemplate);
      if (ws.terminalApp) setMeta(this.db, 'terminalApp', toTerminalApp(ws.terminalApp));
      // exports from before locations carried a default directory and recent picks; hand them to the migration below
      const legacy = ws as { agentCwd?: string; recentDirectories?: string[] };
      if (legacy.agentCwd) setMeta(this.db, 'agentCwd', normalizeDir(legacy.agentCwd));
      if (Array.isArray(legacy.recentDirectories)) setMeta(this.db, 'recentDirectories', JSON.stringify(legacy.recentDirectories.map(normalizeDir).filter(Boolean)));
    }
    const insert = (table: string, cols: string[], row: Record<string, unknown>) => {
      this.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => row[c] as string | number | null));
    };
    for (const u of arr<Record<string, unknown>>(data.users)) insert('users', ['id', 'name', 'email', 'initials', 'color', 'admin', 'kind', 'title', 'username', 'github_username', 'avatar_url'], { ...u, admin: u.admin ? 1 : 0, kind: u.kind ?? 'human', title: u.title ?? '', username: u.username ?? '', github_username: u.githubUsername ?? '', avatar_url: u.avatarUrl ?? null });
    if (ws?.agentUserId && arr<{ id: string }>(data.users).some(u => u.id === ws.agentUserId)) setMeta(this.db, 'agentUserId', ws.agentUserId);
    const cu = data.currentUser as { id?: string } | undefined;
    if (cu?.id) setMeta(this.db, 'currentUser', cu.id);
    for (const t of arr<Record<string, unknown>>(data.teams)) insert('teams', ['id', 'key', 'name', 'icon', 'color', 'description', 'position', 'triage_enabled', 'auto_cycles', 'cycle_duration', 'cycle_cooldown', 'cycle_upcoming', 'cycle_rollover', 'estimate_scale', 'estimate_zero', 'estimate_extended', 'estimate_count_unestimated'],
      { ...t, estimate_zero: t.estimateZero ? 1 : 0, estimate_extended: t.estimateExtended ? 1 : 0, estimate_count_unestimated: t.estimateCountUnestimated ? 1 : 0, triage_enabled: t.triageEnabled ? 1 : 0, auto_cycles: t.autoCycles ? 1 : 0, cycle_duration: t.cycleDuration ?? 2, cycle_cooldown: t.cycleCooldown ?? 0, cycle_upcoming: t.cycleUpcoming ?? 2, cycle_rollover: t.cycleRollover === false ? 0 : 1, estimate_scale: t.estimateScale ?? 'fibonacci' });
    // memberships travel on the teams; an export from before memberships puts every person on every team
    const humans = arr<Record<string, unknown>>(data.users).filter(u => (u.kind ?? 'human') === 'human').map(u => String(u.id));
    for (const t of arr<Record<string, unknown>>(data.teams)) for (const uid of Array.isArray(t.memberIds) ? t.memberIds as string[] : humans) {
      if (humans.includes(uid)) this.addTeamMember(String(t.id), uid);
    }
    for (const s of arr<Record<string, unknown>>(data.states)) insert('states', ['id', 'team_id', 'name', 'type', 'color', 'position'], { ...s, team_id: s.teamId });
    for (const l of arr<Record<string, unknown>>(data.labels)) insert('labels', ['id', 'team_id', 'name', 'color', 'description'], { ...l, team_id: l.teamId });
    for (const t of arr<Record<string, unknown>>(data.templates)) insert('issue_templates', ['id', 'team_id', 'name', 'title', 'description', 'position', 'created_at'], { ...t, team_id: t.teamId, title: t.title ?? '', description: t.description ?? '', position: t.position ?? 0, created_at: t.createdAt ?? ts() });
    for (const i of arr<Record<string, unknown>>(data.issues)) insert('issues',
      ['id', 'team_id', 'number', 'title', 'description', 'state_id', 'priority', 'assignee_id', 'project_id', 'cycle_id', 'parent_id', 'location_id', 'milestone_id', 'creator_id', 'snoozed_until', 'estimate', 'due_date', 'sort_order', 'labels', 'created_at', 'updated_at', 'archived_at', 'completed_at', 'canceled_at', 'deleted_at'],
      { ...i, team_id: i.teamId, state_id: i.stateId, assignee_id: i.assigneeId, project_id: i.projectId, cycle_id: i.cycleId, parent_id: i.parentId, location_id: i.locationId ?? null, milestone_id: i.milestoneId ?? null, creator_id: i.creatorId ?? null, snoozed_until: i.snoozedUntil ?? null, due_date: i.dueDate, sort_order: i.sortOrder, labels: JSON.stringify(i.labelIds ?? []), created_at: i.createdAt, updated_at: i.updatedAt, archived_at: i.archivedAt, completed_at: i.completedAt, canceled_at: i.canceledAt, deleted_at: i.deletedAt });
    for (const c of arr<Record<string, unknown>>(data.comments)) insert('comments', ['id', 'issue_id', 'user_id', 'via_user_id', 'body', 'created_at', 'edited_at', 'reactions', 'resolved_at', 'parent_id'], { ...c, issue_id: c.issueId, user_id: c.userId, via_user_id: c.viaUserId ?? null, created_at: c.createdAt, edited_at: c.editedAt, reactions: JSON.stringify(c.reactions ?? {}), resolved_at: c.resolvedAt, parent_id: c.parentId ?? null });
    for (const a of arr<Record<string, unknown>>(data.attachments)) insert('attachments', ['id', 'issue_id', 'user_id', 'kind', 'url', 'title', 'mime', 'size', 'created_at'], { ...a, issue_id: a.issueId, user_id: a.userId, mime: a.mime ?? '', size: a.size ?? 0, created_at: a.createdAt ?? ts() });
    for (const sub of arr<Record<string, unknown>>(data.subscriptions)) this.db.prepare('INSERT OR IGNORE INTO subscriptions (issue_id, user_id) VALUES (?, ?)').run(sub.issueId as string, sub.userId as string);
    for (const r of arr<Record<string, unknown>>(data.relations)) insert('relations', ['id', 'issue_id', 'related_id', 'type'], { ...r, issue_id: r.issueId, related_id: r.relatedIssueId });
    for (const p of arr<Record<string, unknown>>(data.projects)) insert('projects',
      ['id', 'team_id', 'name', 'summary', 'description', 'icon', 'color', 'status', 'health', 'priority', 'directory', 'start_date', 'target_date', 'lead_id', 'members', 'position', 'created_at', 'updated_at', 'completed_at'],
      { ...p, team_id: p.teamId, summary: p.summary ?? '', status: p.status ?? 'planned', health: p.health ?? 'onTrack', priority: p.priority ?? 0, directory: normalizeDir(p.directory as string | undefined), start_date: p.startDate, target_date: p.targetDate, lead_id: p.leadId, members: JSON.stringify(p.memberIds ?? []), position: p.position ?? 0, created_at: p.createdAt ?? ts(), updated_at: p.updatedAt ?? ts(), completed_at: p.completedAt });
    for (const l of arr<Record<string, unknown>>(data.locations)) insert('locations', ['id', 'name', 'path', 'created_at'], { ...l, path: normalizeDir(l.path as string), created_at: l.createdAt ?? ts() });
    for (const p of arr<{ id: string; locationIds?: string[] }>(data.projects)) (p.locationIds ?? []).forEach((lid, n) => insert('project_locations', ['project_id', 'location_id', 'position'], { project_id: p.id, location_id: lid, position: n }));
    for (const d of arr<Record<string, unknown>>(data.docs)) insert('documents', ['id', 'title', 'icon', 'content', 'project_id', 'team_id', 'initiative_id', 'creator_id', 'created_at', 'updated_at'], { ...d, project_id: d.projectId ?? null, team_id: d.teamId ?? null, initiative_id: d.initiativeId ?? null, creator_id: d.creatorId ?? null, created_at: d.createdAt ?? ts(), updated_at: d.updatedAt ?? ts() });
    for (const l of arr<Record<string, unknown>>(data.teamLinks)) insert('team_links', ['id', 'team_id', 'url', 'title', 'created_at'], { ...l, team_id: l.teamId, created_at: l.createdAt ?? ts() });
    for (const r of arr<Record<string, unknown>>(data.recurring)) insert('recurring_issues', ['id', 'team_id', 'title', 'description', 'priority', 'assignee_id', 'labels', 'project_id', 'cadence', 'next_at', 'created_at'], { ...r, team_id: r.teamId, assignee_id: r.assigneeId ?? null, labels: JSON.stringify(r.labelIds ?? []), project_id: r.projectId ?? null, next_at: r.nextAt, created_at: r.createdAt ?? ts() });
    for (const l of arr<Record<string, unknown>>(data.projectLinks)) insert('project_links', ['id', 'project_id', 'url', 'title', 'created_at'], { ...l, project_id: l.projectId, created_at: l.createdAt ?? ts() });
    for (const u of arr<Record<string, unknown>>(data.projectUpdates)) insert('project_updates', ['id', 'project_id', 'user_id', 'via_user_id', 'body', 'health', 'created_at'], { ...u, project_id: u.projectId, user_id: u.userId, via_user_id: u.viaUserId ?? null, created_at: u.createdAt });
    for (const m of arr<Record<string, unknown>>(data.milestones)) insert('milestones', ['id', 'project_id', 'name', 'target_date', 'status', 'position', 'created_at'], { ...m, project_id: m.projectId, target_date: m.targetDate, position: m.position ?? 0, created_at: m.createdAt ?? ts() });
    for (const cy of arr<Record<string, unknown>>(data.cycles)) insert('cycles', ['id', 'team_id', 'number', 'name', 'starts_at', 'ends_at', 'completed_at'], { ...cy, team_id: cy.teamId, starts_at: cy.startsAt, ends_at: cy.endsAt, completed_at: cy.completedAt });
    const ownId = cu?.id ?? null;
    for (const v of arr<Record<string, unknown>>(data.views)) insert('views', ['id', 'team_id', 'name', 'icon', 'filters', 'group_by', 'order_by', 'layout', 'position', 'created_at', 'kind', 'project_options', 'owner_id', 'shared'], { ...v, owner_id: v.ownerId ?? ownId, shared: v.shared === false ? 0 : 1, team_id: v.teamId, icon: v.icon ?? '', filters: JSON.stringify(v.filters ?? {}), kind: v.kind === 'projects' ? 'projects' : 'issues', project_options: v.projectOptions ? JSON.stringify(v.projectOptions) : null, group_by: v.groupBy ?? 'status', order_by: v.orderBy ?? 'priority', layout: v.layout ?? 'list', position: v.position ?? 0, created_at: ts() });
    for (const f of arr<Record<string, unknown>>(data.favorites)) insert('favorites', ['id', 'type', 'ref_id', 'position', 'user_id'], { ...f, ref_id: f.refId, position: f.position ?? 0, user_id: ownId });
    for (const n of arr<Record<string, unknown>>(data.notifications)) insert('notifications', ['id', 'type', 'actor_id', 'issue_id', 'project_id', 'body', 'read_at', 'snoozed_until', 'created_at', 'user_id'], { ...n, user_id: ownId, actor_id: n.actorId, issue_id: n.issueId, project_id: n.projectId, read_at: n.readAt, snoozed_until: n.snoozedUntil ?? null, created_at: n.createdAt });
    if (ownId && ws && (ws as { preferences?: Preferences }).preferences) this.setPreferences((ws as { preferences?: Preferences }).preferences!, ownId);
    for (const a of arr<Record<string, unknown>>(data.activity)) insert('activity', ['id', 'issue_id', 'project_id', 'user_id', 'via_user_id', 'type', 'data', 'created_at'], { ...a, issue_id: a.issueId, project_id: a.projectId, user_id: a.userId, via_user_id: a.viaUserId ?? null, data: JSON.stringify(a.data ?? {}), created_at: a.createdAt });
    for (const l of arr<Record<string, unknown>>(data.projectLabels)) insert('project_labels', ['id', 'name', 'color', 'description', 'parent_id', 'is_group', 'created_at'], { ...l, description: l.description ?? '', parent_id: l.parentId ?? null, is_group: l.isGroup ? 1 : 0, created_at: l.createdAt ?? ts() });
    // the export's statuses replace the defaults wipe() put back
    if (arr(data.projectStatuses).length) this.db.exec('DELETE FROM project_statuses');
    for (const x of arr<Record<string, unknown>>(data.projectStatuses)) insert('project_statuses', ['id', 'type', 'name', 'color', 'description', 'position'], { ...x, description: x.description ?? '', position: x.position ?? 0 });
    for (const x of arr<Record<string, unknown>>(data.projectSubscriptions)) insert('project_subscriptions', ['project_id', 'user_id', 'issue_added', 'issue_closed', 'comments', 'updates'], { project_id: x.projectId, user_id: x.userId, issue_added: x.issueAdded ? 1 : 0, issue_closed: x.issueClosed ? 1 : 0, comments: x.comments ? 1 : 0, updates: x.updates ? 1 : 0 });
    for (const f of arr<Record<string, unknown>>(data.files)) {
      if (typeof f.data !== 'string') continue;
      const bytes = Buffer.from(f.data, 'base64');
      this.db.prepare('INSERT INTO files (id, name, mime, size, sha256, owner_type, owner_id, uploaded_by, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(String(f.id), String(f.name ?? 'image'), String(f.mime ?? 'application/octet-stream'), bytes.length, String(f.sha256 ?? ''), String(f.ownerType), String(f.ownerId ?? ''), (f.uploadedBy as string | null) ?? null, String(f.createdAt ?? ts()), bytes);
    }
    for (const p of arr<Record<string, unknown>>(data.projects)) this.db.prepare('UPDATE projects SET labels = ?, status_id = ?, update_cadence = ? WHERE id = ?').run(JSON.stringify(p.labelIds ?? []), (p.statusId as string | null) ?? null, (p.updateCadence as string | null) ?? null, p.id as string);
    if (ws && (ws as { features?: WorkspaceFeatures }).features) setMeta(this.db, 'features', JSON.stringify((ws as { features?: WorkspaceFeatures }).features));
    this.ext.importData(data, insert);
    for (const i of arr<Record<string, unknown>>(data.issues)) this.db.prepare('UPDATE issues SET sla_rule_id = ?, sla_breaches_at = ? WHERE id = ?').run((i.slaRuleId as string | null) ?? null, (i.slaBreachesAt as string | null) ?? null, i.id as string);
    ensureDefaults(this.db);
    // a pre-locations export: its project directories and default become locations, as on upgrade
    migrateDirectoriesToLocations(this.db);
    // an export from when each coding tool had its own agent user
    ensureWorkspaceAgent(this.db);
  }
  wipe(): void {
    for (const t of this.ext.tables) this.db.exec(`DELETE FROM ${t};`);
    for (const t of ['project_labels', 'project_statuses', 'project_subscriptions', 'documents', 'team_links', 'recurring_issues', 'project_links', 'files', 'attachments', 'subscriptions', 'activity', 'notifications', 'favorites', 'views', 'issue_templates', 'milestones', 'cycles', 'project_updates', 'project_locations', 'locations', 'projects', 'relations', 'comments', 'issues', 'labels', 'states', 'team_join_links', 'team_members', 'teams', 'invites', 'sessions', 'user_preferences', 'users', 'meta']) {
      this.db.exec(`DELETE FROM ${t};`);
    }
    ensureDefaults(this.db);
  }
}
