import type { DatabaseSync } from 'node:sqlite';
import { getMeta, setMeta } from './db.js';
import { id, nowIso, midSort } from './util.js';
import { buildHandoff, DEFAULT_PROMPT_TEMPLATE } from './handoff.js';
import type {
  ActivityItem, ActivityType, AgentRunner, Comment, Cycle, Favorite, Handoff,
  Issue, IssueRelation, IssueTemplate, Label, Milestone, Notification, NotificationType, Priority, Project, ProjectUpdate,
  RelationType, SavedView, Snapshot, Team, User, ViewFilters, GroupBy, OrderBy,
  WorkflowState, WorkflowStateType,
} from './types.js';

interface IssueRow { id: string; team_id: string; number: number; title: string; description: string; state_id: string; priority: number; assignee_id: string | null; project_id: string | null; cycle_id: string | null; parent_id: string | null; estimate: number | null; due_date: string | null; sort_order: number; labels: string; created_at: string; updated_at: string; archived_at: string | null; completed_at: string | null; canceled_at: string | null; deleted_at: string | null; }
interface TemplateRow { id: string; team_id: string; name: string; title: string; description: string; position: number; created_at: string; }

function ts(): string { return nowIso(); }

/** PATCH bodies reach the store raw from the server, so only whitelisted keys may build SQL */
function sqlPairs<T extends object>(patch: T, allowed: Array<keyof T>): Array<[string, unknown]> {
  return Object.entries(patch).filter(([k]) => (allowed as string[]).includes(k));
}

export class Store {
  constructor(private db: DatabaseSync) {}

  // ---------- mappers ----------
  private mapIssue = (r: IssueRow): Issue => ({
    id: r.id, teamId: r.team_id, number: r.number, title: r.title, description: r.description,
    stateId: r.state_id, priority: r.priority as Priority, assigneeId: r.assignee_id,
    projectId: r.project_id, cycleId: r.cycle_id, parentId: r.parent_id, estimate: r.estimate,
    dueDate: r.due_date, sortOrder: r.sort_order, labelIds: JSON.parse(r.labels),
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at,
    completedAt: r.completed_at, canceledAt: r.canceled_at, deletedAt: r.deleted_at,
  });

  // ---------- snapshot ----------
  snapshot(): Snapshot {
    const rows = <T>(sql: string): T[] => this.db.prepare(sql).all() as unknown as T[];
    const users = rows<{ id: string; name: string; email: string; initials: string; color: string; admin: number; kind: string }>('SELECT * FROM users ORDER BY rowid').map(u => ({ id: u.id, name: u.name, email: u.email, initials: u.initials, color: u.color, admin: !!u.admin, kind: (u.kind as User['kind']) ?? 'human' }));
    const workspaceId = getMeta(this.db, 'workspaceId') ?? '';
    const workspace = { id: workspaceId, name: getMeta(this.db, 'workspaceName') ?? 'Workspace', createdAt: getMeta(this.db, 'workspaceCreatedAt') ?? ts(), handoffPromptTemplate: getMeta(this.db, 'handoffPromptTemplate') ?? DEFAULT_PROMPT_TEMPLATE, ...this.getAgentConfig(), agentRunningIssueId: null };
    const currentUser = users.find(u => u.id === (getMeta(this.db, 'currentUser') ?? '')) ?? users[0];
    return {
      workspace, users, currentUser: currentUser!,
      teams: rows<{ id: string; key: string; name: string; icon: string; color: string; description: string; position: number }>('SELECT * FROM teams ORDER BY position').map(t => ({ id: t.id, key: t.key, name: t.name, icon: t.icon, color: t.color, description: t.description, position: t.position })),
      states: rows<{ id: string; team_id: string; name: string; type: WorkflowStateType; color: string; position: number }>('SELECT * FROM states ORDER BY position').map(s => ({ id: s.id, teamId: s.team_id, name: s.name, type: s.type, color: s.color, position: s.position })),
      labels: rows<{ id: string; team_id: string; name: string; color: string; description: string }>('SELECT * FROM labels').map(l => ({ id: l.id, teamId: l.team_id, name: l.name, color: l.color, description: l.description })),
      templates: rows<TemplateRow>('SELECT * FROM issue_templates ORDER BY position, created_at').map(t => ({ id: t.id, teamId: t.team_id, name: t.name, title: t.title, description: t.description, position: t.position, createdAt: t.created_at })),
      issues: rows<IssueRow>('SELECT * FROM issues WHERE archived_at IS NULL AND deleted_at IS NULL').map(this.mapIssue),
      comments: rows<{ id: string; issue_id: string; user_id: string; body: string; created_at: string; edited_at: string | null; reactions: string; resolved_at: string | null }>('SELECT * FROM comments ORDER BY created_at').map(c => ({ id: c.id, issueId: c.issue_id, userId: c.user_id, body: c.body, createdAt: c.created_at, editedAt: c.edited_at, reactions: JSON.parse(c.reactions), resolvedAt: c.resolved_at })),
      relations: rows<{ id: string; issue_id: string; related_id: string; type: string }>('SELECT * FROM relations').map(r => ({ id: r.id, issueId: r.issue_id, relatedIssueId: r.related_id, type: r.type as RelationType })),
      projects: rows<{ id: string; team_id: string | null; name: string; description: string; icon: string; color: string; status: Project['status']; health: Project['health']; priority: number; start_date: string | null; target_date: string | null; lead_id: string | null; members: string; position: number; created_at: string; updated_at: string; completed_at: string | null }>('SELECT * FROM projects ORDER BY position, created_at').map(p => ({ id: p.id, teamId: p.team_id, name: p.name, description: p.description, icon: p.icon, color: p.color, status: p.status, health: p.health, priority: p.priority as Priority, startDate: p.start_date, targetDate: p.target_date, leadId: p.lead_id, memberIds: JSON.parse(p.members), position: p.position, createdAt: p.created_at, updatedAt: p.updated_at, completedAt: p.completed_at })),
      milestones: rows<{ id: string; project_id: string; name: string; target_date: string | null; status: Milestone['status']; position: number; created_at: string }>('SELECT * FROM milestones ORDER BY position, created_at').map(m => ({ id: m.id, projectId: m.project_id, name: m.name, targetDate: m.target_date, status: m.status, position: m.position, createdAt: m.created_at })),
      projectUpdates: rows<{ id: string; project_id: string; user_id: string; body: string; health: ProjectUpdate['health']; created_at: string }>('SELECT * FROM project_updates ORDER BY created_at DESC').map(u => ({ id: u.id, projectId: u.project_id, userId: u.user_id, body: u.body, health: u.health, createdAt: u.created_at })),
      cycles: rows<{ id: string; team_id: string; number: number; name: string; starts_at: string; ends_at: string; completed_at: string | null }>('SELECT * FROM cycles ORDER BY number').map(c => ({ id: c.id, teamId: c.team_id, number: c.number, name: c.name, startsAt: c.starts_at, endsAt: c.ends_at, completedAt: c.completed_at })),
      views: rows<{ id: string; team_id: string | null; name: string; icon: string; filters: string; group_by: string; order_by: string; layout: string; position: number }>('SELECT * FROM views ORDER BY position').map(v => ({ id: v.id, teamId: v.team_id, name: v.name, icon: v.icon, filters: JSON.parse(v.filters), groupBy: v.group_by as GroupBy, orderBy: v.order_by as OrderBy, layout: v.layout as 'list' | 'board', position: v.position })),
      favorites: rows<{ id: string; type: Favorite['type']; ref_id: string; position: number }>('SELECT * FROM favorites ORDER BY position').map(f => ({ id: f.id, type: f.type, refId: f.ref_id, position: f.position })),
      notifications: rows<{ id: string; type: Notification['type']; actor_id: string | null; issue_id: string | null; project_id: string | null; body: string; read_at: string | null; created_at: string }>('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 500').map(n => ({ id: n.id, type: n.type, actorId: n.actor_id, issueId: n.issue_id, projectId: n.project_id, body: n.body, readAt: n.read_at, createdAt: n.created_at })),
      activity: rows<{ id: string; issue_id: string | null; project_id: string | null; user_id: string; type: ActivityType; data: string; created_at: string }>('SELECT * FROM activity ORDER BY created_at DESC LIMIT 2000').map(a => ({ id: a.id, issueId: a.issue_id, projectId: a.project_id, userId: a.user_id, type: a.type, data: JSON.parse(a.data), createdAt: a.created_at })),
    };
  }

  // ---------- users ----------
  createUser(name: string, email = '', admin = false, kind: User['kind'] = 'human'): User {
    const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const colors = ['#5e6ad2', '#c770f4', '#f2994a', '#4cb782', '#eb5757', '#307ec6'];
    const user: User = { id: id('u'), name, email, initials, color: colors[Math.floor(Math.random() * colors.length)], admin, kind };
    this.db.prepare('INSERT INTO users (id, name, email, initials, color, admin, kind) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, user.name, user.email, user.initials, user.color, admin ? 1 : 0, kind);
    return user;
  }

  // ---------- teams ----------
  createTeam(key: string, name: string, icon = '📦', color = '#5e6ad2'): Team {
    const team: Team = { id: id('t'), key: key.toUpperCase(), name, icon, color, description: '', position: (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM teams').get() as { p: number }).p };
    this.db.prepare('INSERT INTO teams (id, key, name, icon, color, description, position) VALUES (?, ?, ?, ?, ?, ?, ?)').run(team.id, team.key, team.name, team.icon, team.color, team.description, team.position);
    const defaults: Array<[string, WorkflowStateType, string]> = [
      ['Backlog', 'backlog', '#95a2b3'], ['Todo', 'unstarted', '#e2e2e2'], ['In Progress', 'started', '#f2c94c'],
      ['Done', 'completed', '#5e6ad2'], ['Canceled', 'canceled', '#7d8084'],
    ];
    defaults.forEach(([name2, type, color2], i) => this.createState(team.id, name2, type, color2, i + 1));
    return team;
  }

  listTeams(): Team[] { return this.snapshot().teams; }
  updateTeam(teamId: string, patch: Partial<Pick<Team, 'key' | 'name' | 'icon' | 'color' | 'description' | 'position'>>): void {
    const sets: string[] = []; const vals: (string | number)[] = [];
    for (const [k, v] of sqlPairs(patch, ['key', 'name', 'icon', 'color', 'description', 'position'])) { sets.push(`${k} = ?`); vals.push(v as string | number); }
    if (!sets.length) return;
    vals.push(teamId);
    this.db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteTeam(teamId: string): void {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(teamId); // issues cascade
  }

  // ---------- users ----------
  updateUser(userId: string, patch: Partial<Pick<User, 'name' | 'email' | 'color' | 'admin'>>): void {
    const cur = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as { name: string; email: string } | undefined;
    if (!cur) return;
    const name = patch.name ?? cur.name;
    const initials = patch.name ? name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() : undefined;
    const sets: string[] = []; const vals: (string | number)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'email', 'color', 'admin'])) { sets.push(`${k} = ?`); vals.push(k === 'admin' ? (v ? 1 : 0) : v as string | number); }
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
    // migrate the state's issues to another state of the same team — prefer the backlog,
    // fall back to the first remaining state; the last state of a team cannot be deleted
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
  handoffFor(issueId: string): Handoff | undefined {
    const issue = this.getIssue(issueId);
    if (!issue) return undefined;
    const snap = this.snapshot();
    const template = getMeta(this.db, 'handoffPromptTemplate') ?? DEFAULT_PROMPT_TEMPLATE;
    return buildHandoff(issue, { teams: snap.teams, states: snap.states, projects: snap.projects, labels: snap.labels }, template);
  }
  getHandoffTemplate(): string {
    return getMeta(this.db, 'handoffPromptTemplate') ?? DEFAULT_PROMPT_TEMPLATE;
  }
  /** null resets to the built-in default */
  setHandoffTemplate(template: string | null): void {
    if (template == null) this.db.prepare('DELETE FROM meta WHERE key = ?').run('handoffPromptTemplate');
    else setMeta(this.db, 'handoffPromptTemplate', template);
  }

  // ---------- integrated agent ----------
  getAgentConfig(): { agentRunner: AgentRunner; agentCwd: string } {
    const r = getMeta(this.db, 'agentRunner');
    return { agentRunner: r === 'claude' ? r : 'none', agentCwd: getMeta(this.db, 'agentCwd') ?? '' };
  }
  setAgentConfig(patch: { agentRunner?: AgentRunner; agentCwd?: string }): void {
    if (patch.agentRunner !== undefined) setMeta(this.db, 'agentRunner', patch.agentRunner === 'claude' ? 'claude' : 'none');
    if (patch.agentCwd !== undefined) setMeta(this.db, 'agentCwd', patch.agentCwd.trim());
  }
  /** oldest not-yet-started issue assigned to any agent user — the integrated agent's queue */
  nextAgentIssue(): Issue | undefined {
    const row = this.db.prepare(`SELECT i.* FROM issues i
      JOIN users u ON u.id = i.assignee_id AND u.kind = 'agent'
      JOIN states s ON s.id = i.state_id AND s.type IN ('backlog', 'unstarted')
      WHERE i.archived_at IS NULL AND i.deleted_at IS NULL
      ORDER BY i.updated_at LIMIT 1`).get() as IssueRow | undefined;
    return row ? this.mapIssue(row) : undefined;
  }
  /** first state of a type by position — e.g. the team's "In Progress" for 'started' */
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

  createIssue(input: { teamId: string; title: string; description?: string; stateId?: string; priority?: Priority; assigneeId?: string | null; projectId?: string | null; parentId?: string | null; cycleId?: string | null; labelIds?: string[]; dueDate?: string | null; estimate?: number | null }, actorId?: string): Issue {
    const now = ts();
    const stateId = input.stateId ?? this.defaultState(input.teamId);
    const maxOrder = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM issues WHERE team_id = ?').get(input.teamId) as { m: number }).m;
    const issue: Issue = {
      id: id('i'), teamId: input.teamId, number: this.nextNumber(input.teamId), title: input.title,
      description: input.description ?? '', stateId, priority: input.priority ?? 0,
      assigneeId: input.assigneeId ?? null, projectId: input.projectId ?? null, cycleId: input.cycleId ?? null,
      parentId: input.parentId ?? null, estimate: input.estimate ?? null, dueDate: input.dueDate ?? null,
      sortOrder: maxOrder + 1024, labelIds: input.labelIds ?? [],
      createdAt: now, updatedAt: now, archivedAt: null, completedAt: null, canceledAt: null, deletedAt: null,
    };
    this.db.prepare(`INSERT INTO issues (id, team_id, number, title, description, state_id, priority, assignee_id, project_id, cycle_id, parent_id, estimate, due_date, sort_order, labels, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(issue.id, issue.teamId, issue.number, issue.title, issue.description, issue.stateId, issue.priority, issue.assigneeId, issue.projectId, issue.cycleId, issue.parentId, issue.estimate, issue.dueDate, issue.sortOrder, JSON.stringify(issue.labelIds), now, now);
    this.logActivity({ issueId: issue.id, type: 'created', data: { title: issue.title } }, actorId);
    if (issue.assigneeId) this.notifyAssign(issue.id, issue.assigneeId, actorId);
    return issue;
  }

  updateIssue(issueId: string, rawPatch: Partial<Pick<Issue, 'title' | 'description' | 'stateId' | 'priority' | 'assigneeId' | 'projectId' | 'parentId' | 'cycleId' | 'estimate' | 'dueDate' | 'labelIds' | 'sortOrder' | 'archivedAt'>>, actorId?: string): Issue | undefined {
    // drop explicitly-undefined keys so partial patches never clobber values
    const patch = Object.fromEntries(Object.entries(rawPatch).filter(([, v]) => v !== undefined)) as typeof rawPatch;
    const row = this.db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId) as IssueRow | undefined;
    if (!row) return undefined;
    const before = this.mapIssue(row);
    const now = ts();
    const next: Issue = { ...before, ...patch, updatedAt: now };

    // state side-effects
    if (patch.stateId && patch.stateId !== before.stateId) {
      const st = this.db.prepare('SELECT type FROM states WHERE id = ?').get(patch.stateId) as { type: WorkflowStateType };
      next.completedAt = st.type === 'completed' ? now : null;
      next.canceledAt = st.type === 'canceled' ? now : null;
    }
    this.db.prepare(`UPDATE issues SET title=?, description=?, state_id=?, priority=?, assignee_id=?, project_id=?, cycle_id=?, parent_id=?, estimate=?, due_date=?, sort_order=?, labels=?, updated_at=?, completed_at=?, canceled_at=?, archived_at=? WHERE id=?`)
      .run(next.title, next.description, next.stateId, next.priority, next.assigneeId, next.projectId, next.cycleId, next.parentId, next.estimate, next.dueDate, next.sortOrder, JSON.stringify(next.labelIds), now, next.completedAt, next.canceledAt, next.archivedAt, issueId);

    // activity diffs
    const acts: Array<[ActivityType, Record<string, unknown>]> = [];
    if (patch.title !== undefined && patch.title !== before.title) acts.push(['renamed', { from: before.title, to: next.title }]);
    if (patch.description !== undefined && patch.description !== before.description) acts.push(['described', {}]);
    if (patch.stateId !== undefined && patch.stateId !== before.stateId) acts.push(['stateChanged', { from: before.stateId, to: next.stateId }]);
    if (patch.priority !== undefined && patch.priority !== before.priority) acts.push(['priorityChanged', { from: before.priority, to: next.priority }]);
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
      acts.push([next.assigneeId ? 'assigned' : 'unassigned', { to: next.assigneeId, from: before.assigneeId }]);
      if (next.assigneeId) this.notifyAssign(issueId, next.assigneeId, actorId);
    }
    if (patch.projectId !== undefined && patch.projectId !== before.projectId) acts.push(['projected', { to: next.projectId }]);
    if (patch.parentId !== undefined && patch.parentId !== before.parentId) acts.push(['parented', { to: next.parentId, from: before.parentId }]);
    if (patch.cycleId !== undefined && patch.cycleId !== before.cycleId) acts.push(['cycleChanged', { to: next.cycleId, from: before.cycleId }]);
    if (patch.dueDate !== undefined && patch.dueDate !== before.dueDate) acts.push(['dueChanged', { to: next.dueDate }]);
    if (patch.estimate !== undefined && patch.estimate !== before.estimate) acts.push(['estimateChanged', { to: next.estimate }]);
    if (patch.labelIds !== undefined) {
      for (const lid of patch.labelIds) if (!before.labelIds.includes(lid)) acts.push(['labeled', { labelId: lid }]);
      for (const lid of before.labelIds) if (!patch.labelIds.includes(lid)) acts.push(['unlabeled', { labelId: lid }]);
    }
    if (patch.archivedAt !== undefined) acts.push([patch.archivedAt ? 'archived' : 'restored', {}]);
    for (const [type, data] of acts) this.logActivity({ issueId, type, data }, actorId);
    return next;
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
  addComment(issueId: string, userId: string, body: string): Comment {
    const now = ts();
    const c: Comment = { id: id('c'), issueId, userId, body, createdAt: now, editedAt: null, reactions: {}, resolvedAt: null };
    this.db.prepare('INSERT INTO comments (id, issue_id, user_id, body, created_at, reactions) VALUES (?, ?, ?, ?, ?, ?)').run(c.id, issueId, userId, body, now, '{}');
    this.logActivity({ issueId, type: 'commented', data: { commentId: c.id } }, userId);
    const me = getMeta(this.db, 'currentUser');
    if (userId !== me) {
      // a mention outranks the plain comment notification — never raise both
      this.db.prepare('INSERT INTO notifications (id, type, actor_id, issue_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id('n'), (me ? this.mentions(body).includes(me) : false) ? 'issueMentioned' : 'issueCommented', userId, issueId, body.slice(0, 140), now);
    }
    return c;
  }
  updateComment(commentId: string, body: string): void { this.db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, ts(), commentId); }
  deleteComment(commentId: string): void { this.db.prepare('DELETE FROM comments WHERE id = ?').run(commentId); }
  toggleReaction(commentId: string, emoji: string, userId: string): void {
    const row = this.db.prepare('SELECT reactions FROM comments WHERE id = ?').get(commentId) as { reactions: string } | undefined;
    if (!row) return;
    const r: Record<string, string[]> = JSON.parse(row.reactions);
    const arr = r[emoji] ?? [];
    r[emoji] = arr.includes(userId) ? arr.filter(u => u !== userId) : [...arr, userId];
    if (r[emoji].length === 0) delete r[emoji];
    this.db.prepare('UPDATE comments SET reactions = ? WHERE id = ?').run(JSON.stringify(r), commentId);
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
  }

  // ---------- projects ----------
  createProject(input: { name: string; teamId?: string | null; description?: string; icon?: string; color?: string; status?: Project['status']; leadId?: string | null; targetDate?: string | null; startDate?: string | null; priority?: Priority; memberIds?: string[] }): Project {
    const now = ts();
    const p: Project = {
      id: id('p'), teamId: input.teamId ?? null, name: input.name, description: input.description ?? '',
      icon: input.icon ?? '🧊', color: input.color ?? '#5e6ad2', status: input.status ?? 'planned', health: 'onTrack',
      priority: input.priority ?? 0,
      startDate: input.startDate ?? null, targetDate: input.targetDate ?? null, leadId: input.leadId ?? null,
      memberIds: input.memberIds ?? [], position: (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM projects').get() as { p: number }).p,
      createdAt: now, updatedAt: now, completedAt: input.status === 'completed' ? now : null,
    };
    this.db.prepare('INSERT INTO projects (id, team_id, name, description, icon, color, status, health, priority, start_date, target_date, lead_id, members, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(p.id, p.teamId, p.name, p.description, p.icon, p.color, p.status, p.health, p.priority, p.startDate, p.targetDate, p.leadId, JSON.stringify(p.memberIds), p.position, now, now);
    this.logActivity({ projectId: p.id, type: 'projectCreated', data: {} });
    return p;
  }
  updateProject(projectId: string, patch: Partial<Pick<Project, 'name' | 'description' | 'icon' | 'color' | 'status' | 'health' | 'priority' | 'startDate' | 'targetDate' | 'leadId' | 'memberIds' | 'position' | 'completedAt'>>): void {
    const cur = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as unknown as Project | undefined;
    if (!cur) return;
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    const col: Record<string, string> = { startDate: 'start_date', targetDate: 'target_date', leadId: 'lead_id', memberIds: 'members', completedAt: 'completed_at' };
    for (const [k, v] of sqlPairs(patch, ['name', 'description', 'icon', 'color', 'status', 'health', 'priority', 'startDate', 'targetDate', 'leadId', 'memberIds', 'position', 'completedAt'])) { const c = col[k] ?? k.replace(/[A-Z]/g, m => '_' + m.toLowerCase()); sets.push(`${c} = ?`); vals.push(k === 'memberIds' ? JSON.stringify(v) : v as string | number | null); }
    sets.push('updated_at = ?'); vals.push(ts(), projectId);
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    this.logActivity({ projectId, type: 'projectUpdated', data: { fields: Object.keys(patch) } });
    if (patch.health) this.logActivity({ projectId, type: 'projectHealth', data: { to: patch.health } });
  }
  deleteProject(projectId: string): void {
    this.db.prepare('UPDATE issues SET project_id = NULL WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM project_updates WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  }
  addProjectUpdate(projectId: string, userId: string, body: string, health?: Project['health']): ProjectUpdate {
    const now = ts();
    const u: ProjectUpdate = { id: id('pu'), projectId, userId, body, health: health ?? null, createdAt: now };
    this.db.prepare('INSERT INTO project_updates (id, project_id, user_id, body, health, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, projectId, userId, body, u.health, now);
    if (health) this.updateProject(projectId, { health });
    return u;
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
  createView(name: string, filters: ViewFilters, opts: { teamId?: string | null; icon?: string; groupBy?: GroupBy; orderBy?: OrderBy; layout?: 'list' | 'board' }): SavedView {
    const v: SavedView = {
      id: id('v'), teamId: opts.teamId ?? null, name, icon: opts.icon ?? '', filters,
      groupBy: opts.groupBy ?? 'status', orderBy: opts.orderBy ?? 'priority', layout: opts.layout ?? 'list',
      position: (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM views').get() as { p: number }).p,
    };
    this.db.prepare('INSERT INTO views (id, team_id, name, icon, filters, group_by, order_by, layout, position, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(v.id, v.teamId, v.name, v.icon, JSON.stringify(v.filters), v.groupBy, v.orderBy, v.layout, v.position, ts());
    return v;
  }
  updateView(viewId: string, patch: Partial<Pick<SavedView, 'name' | 'icon' | 'filters' | 'groupBy' | 'orderBy' | 'layout' | 'position'>>): void {
    const col: Record<string, string> = { groupBy: 'group_by', orderBy: 'order_by' };
    const sets: string[] = []; const vals: (string | number | null)[] = [];
    for (const [k, v] of sqlPairs(patch, ['name', 'icon', 'filters', 'groupBy', 'orderBy', 'layout', 'position'])) { const c = col[k] ?? k.replace(/[A-Z]/g, m => '_' + m.toLowerCase()); sets.push(`${c} = ?`); vals.push(k === 'filters' ? JSON.stringify(v) : v as string | number | null); }
    vals.push(viewId);
    this.db.prepare(`UPDATE views SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteView(viewId: string): void { this.db.prepare('DELETE FROM views WHERE id = ?').run(viewId); }

  // ---------- favorites ----------
  toggleFavorite(type: Favorite['type'], refId: string): void {
    const existing = this.db.prepare('SELECT id FROM favorites WHERE type = ? AND ref_id = ?').get(type, refId) as { id: string } | undefined;
    if (existing) this.db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
    else this.db.prepare('INSERT INTO favorites (id, type, ref_id, position) VALUES (?, ?, ?, ?)').run(id('f'), type, refId, (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM favorites').get() as { p: number }).p);
  }

  // ---------- notifications ----------
  // only notify when someone else assigned it to you — never for self-assignment
  private notifyAssign(issueId: string, assigneeId: string, actorId?: string): void {
    const me = getMeta(this.db, 'currentUser');
    if (assigneeId === me && assigneeId !== (actorId ?? me)) {
      // the actor is who the inbox row leads with — without it the row falls back
      // to the app's own tile, which reads as a system message it isn't
      this.notify('issueAssignedToYou', { actorId: actorId ?? null, issueId, body: 'You were assigned this issue' });
    }
  }
  /** single insert point for every notification the store raises */
  notify(type: NotificationType, o: { actorId?: string | null; issueId?: string | null; projectId?: string | null; body?: string; createdAt?: string }): void {
    this.db.prepare('INSERT INTO notifications (id, type, actor_id, issue_id, project_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id('n'), type, o.actorId ?? null, o.issueId ?? null, o.projectId ?? null, o.body ?? '', o.createdAt ?? ts());
  }
  /** @Name mentions resolved against the member list — longest name first so
      "@Ada Osei" doesn't match a member called "Ada" and stop there */
  private mentions(body: string): string[] {
    const users = this.db.prepare('SELECT id, name FROM users').all() as unknown as Array<{ id: string; name: string }>;
    const hit: string[] = [];
    for (const u of [...users].sort((a, b) => b.name.length - a.name.length)) {
      if (new RegExp(`@${u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body)) hit.push(u.id);
    }
    return hit;
  }
  listNotifications(): Notification[] { return this.snapshot().notifications; }
  markNotificationRead(notificationId: string, read = true): void { this.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(read ? ts() : null, notificationId); }
  markAllNotificationsRead(): void { this.db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(ts()); }

  // ---------- activity ----------
  logActivity(e: { issueId?: string; projectId?: string; type: ActivityType; data?: Record<string, unknown> }, actorId?: string): void {
    const uid = actorId ?? getMeta(this.db, 'currentUser');
    this.db.prepare('INSERT INTO activity (id, issue_id, project_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id('a'), e.issueId ?? null, e.projectId ?? null, uid, e.type, JSON.stringify(e.data ?? {}), ts());
  }
  issueActivity(issueId: string): ActivityItem[] { return this.snapshot().activity.filter(a => a.issueId === issueId).reverse(); }

  // ---------- search ----------
  search(q: string): { issues: Issue[]; projects: Project[] } {
    const issues = this.listIssues({ query: q, limit: 20 });
    const projects = (this.db.prepare('SELECT * FROM projects WHERE name LIKE ? ORDER BY position LIMIT 10').all(`%${q}%`) as Array<Record<string, unknown>>).map(p => ({
      id: p.id as string, teamId: (p.team_id as string | null) ?? null, name: p.name as string,
      description: p.description as string, icon: p.icon as string, color: p.color as string,
      status: p.status as Project['status'], health: p.health as Project['health'],
      priority: (p.priority as number ?? 0) as Priority, startDate: (p.start_date as string | null) ?? null,
      targetDate: (p.target_date as string | null) ?? null, leadId: (p.lead_id as string | null) ?? null,
      memberIds: JSON.parse((p.members as string) ?? '[]'), position: p.position as number,
      createdAt: p.created_at as string, updatedAt: p.updated_at as string, completedAt: (p.completed_at as string | null) ?? null,
    }));
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
  setCurrentUser(userId: string): void { setMeta(this.db, 'currentUser', userId); }

  // ---------- export / import / reset ----------
  exportJson(): string {
    const snap = this.snapshot();
    return JSON.stringify({ exportedAt: ts(), ...snap }, null, 2);
  }
  /** restore a full workspace from an exportJson payload (keeps ids) */
  importJson(json: string): void {
    const data = JSON.parse(json) as Record<string, unknown>;
    const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
    this.wipe();
    const ws = data.workspace as { id?: string; name?: string; createdAt?: string } | undefined;
    if (ws) {
      if (ws.id) setMeta(this.db, 'workspaceId', ws.id);
      if (ws.name) setMeta(this.db, 'workspaceName', ws.name);
      if (ws.createdAt) setMeta(this.db, 'workspaceCreatedAt', ws.createdAt);
    }
    const insert = (table: string, cols: string[], row: Record<string, unknown>) => {
      this.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => row[c] as string | number | null));
    };
    for (const u of arr<Record<string, unknown>>(data.users)) insert('users', ['id', 'name', 'email', 'initials', 'color', 'admin', 'kind'], { ...u, admin: u.admin ? 1 : 0, kind: u.kind ?? 'human' });
    const cu = data.currentUser as { id?: string } | undefined;
    if (cu?.id) setMeta(this.db, 'currentUser', cu.id);
    for (const t of arr<Record<string, unknown>>(data.teams)) insert('teams', ['id', 'key', 'name', 'icon', 'color', 'description', 'position'], t);
    for (const s of arr<Record<string, unknown>>(data.states)) insert('states', ['id', 'team_id', 'name', 'type', 'color', 'position'], { ...s, team_id: s.teamId });
    for (const l of arr<Record<string, unknown>>(data.labels)) insert('labels', ['id', 'team_id', 'name', 'color', 'description'], { ...l, team_id: l.teamId });
    for (const t of arr<Record<string, unknown>>(data.templates)) insert('issue_templates', ['id', 'team_id', 'name', 'title', 'description', 'position', 'created_at'], { ...t, team_id: t.teamId, title: t.title ?? '', description: t.description ?? '', position: t.position ?? 0, created_at: t.createdAt ?? ts() });
    for (const i of arr<Record<string, unknown>>(data.issues)) insert('issues',
      ['id', 'team_id', 'number', 'title', 'description', 'state_id', 'priority', 'assignee_id', 'project_id', 'cycle_id', 'parent_id', 'estimate', 'due_date', 'sort_order', 'labels', 'created_at', 'updated_at', 'archived_at', 'completed_at', 'canceled_at', 'deleted_at'],
      { ...i, team_id: i.teamId, state_id: i.stateId, assignee_id: i.assigneeId, project_id: i.projectId, cycle_id: i.cycleId, parent_id: i.parentId, due_date: i.dueDate, sort_order: i.sortOrder, labels: JSON.stringify(i.labelIds ?? []), created_at: i.createdAt, updated_at: i.updatedAt, archived_at: i.archivedAt, completed_at: i.completedAt, canceled_at: i.canceledAt, deleted_at: i.deletedAt });
    for (const c of arr<Record<string, unknown>>(data.comments)) insert('comments', ['id', 'issue_id', 'user_id', 'body', 'created_at', 'edited_at', 'reactions', 'resolved_at'], { ...c, issue_id: c.issueId, user_id: c.userId, created_at: c.createdAt, edited_at: c.editedAt, reactions: JSON.stringify(c.reactions ?? {}), resolved_at: c.resolvedAt });
    for (const r of arr<Record<string, unknown>>(data.relations)) insert('relations', ['id', 'issue_id', 'related_id', 'type'], { ...r, issue_id: r.issueId, related_id: r.relatedIssueId });
    for (const p of arr<Record<string, unknown>>(data.projects)) insert('projects',
      ['id', 'team_id', 'name', 'description', 'icon', 'color', 'status', 'health', 'priority', 'start_date', 'target_date', 'lead_id', 'members', 'position', 'created_at', 'updated_at', 'completed_at'],
      { ...p, team_id: p.teamId, status: p.status ?? 'planned', health: p.health ?? 'onTrack', priority: p.priority ?? 0, start_date: p.startDate, target_date: p.targetDate, lead_id: p.leadId, members: JSON.stringify(p.memberIds ?? []), position: p.position ?? 0, created_at: p.createdAt ?? ts(), updated_at: p.updatedAt ?? ts(), completed_at: p.completedAt });
    for (const u of arr<Record<string, unknown>>(data.projectUpdates)) insert('project_updates', ['id', 'project_id', 'user_id', 'body', 'health', 'created_at'], { ...u, project_id: u.projectId, user_id: u.userId, created_at: u.createdAt });
    for (const m of arr<Record<string, unknown>>(data.milestones)) insert('milestones', ['id', 'project_id', 'name', 'target_date', 'status', 'position', 'created_at'], { ...m, project_id: m.projectId, target_date: m.targetDate, position: m.position ?? 0, created_at: m.createdAt ?? ts() });
    for (const cy of arr<Record<string, unknown>>(data.cycles)) insert('cycles', ['id', 'team_id', 'number', 'name', 'starts_at', 'ends_at', 'completed_at'], { ...cy, team_id: cy.teamId, starts_at: cy.startsAt, ends_at: cy.endsAt, completed_at: cy.completedAt });
    for (const v of arr<Record<string, unknown>>(data.views)) insert('views', ['id', 'team_id', 'name', 'icon', 'filters', 'group_by', 'order_by', 'layout', 'position', 'created_at'], { ...v, team_id: v.teamId, icon: v.icon ?? '', filters: JSON.stringify(v.filters ?? {}), group_by: v.groupBy ?? 'status', order_by: v.orderBy ?? 'priority', layout: v.layout ?? 'list', position: v.position ?? 0, created_at: ts() });
    for (const f of arr<Record<string, unknown>>(data.favorites)) insert('favorites', ['id', 'type', 'ref_id', 'position'], { ...f, ref_id: f.refId, position: f.position ?? 0 });
    for (const n of arr<Record<string, unknown>>(data.notifications)) insert('notifications', ['id', 'type', 'actor_id', 'issue_id', 'project_id', 'body', 'read_at', 'created_at'], { ...n, actor_id: n.actorId, issue_id: n.issueId, project_id: n.projectId, read_at: n.readAt, created_at: n.createdAt });
    for (const a of arr<Record<string, unknown>>(data.activity)) insert('activity', ['id', 'issue_id', 'project_id', 'user_id', 'type', 'data', 'created_at'], { ...a, issue_id: a.issueId, project_id: a.projectId, user_id: a.userId, data: JSON.stringify(a.data ?? {}), created_at: a.createdAt });
  }
  wipe(): void {
    for (const t of ['activity', 'notifications', 'favorites', 'views', 'issue_templates', 'milestones', 'cycles', 'project_updates', 'projects', 'relations', 'comments', 'issues', 'labels', 'states', 'teams', 'users', 'meta']) {
      this.db.exec(`DELETE FROM ${t};`);
    }
  }
}
