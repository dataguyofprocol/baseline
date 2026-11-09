import type { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.js';
import { getMeta, setMeta } from './db.js';
import { id } from './util.js';
import { DEFAULT_TEAM_WORKFLOW, type Issue, type Loop, type LoopAction, type LoopRun, type LoopTrigger, type Priority, type SlaRule, type TeamSubscription, type TeamWorkflow, type WorkflowStateType } from './types.js';

const ts = () => new Date().toISOString();
const HOUR = 3600_000;

/** an agent identity automatic changes are attributed to (never the person whose request ran the tick) */
export function agentUser(store: Store, db: DatabaseSync, name: string): string {
  const row = db.prepare("SELECT id FROM users WHERE kind = 'agent' AND name = ?").get(name) as { id: string } | undefined;
  return row?.id ?? store.createUser(name, '', false, 'agent').id;
}

/* SLAs (deadlines from rules) and Loops (workflows that run on a schedule or when issues change). */
export class Automation {
  /** set by the server: opens an interactive Claude Code session for an issue (the CLI has none) */
  launcher: ((issueId: string) => Promise<void>) | null = null;
  /** why a run with no launcher skips the Claude Code action */
  launcherMissing = 'the app isn’t running';
  private running = false;

  constructor(private store: Store, private db: DatabaseSync) {
    store.issueHooks.push((before, after, actorId) => { this.applySla(after); this.notifyTeam(before, after, actorId); this.applyWorkflow(before, after); if (!this.running) this.fireIssueLoops(before, after, actorId); });
    store.tickHooks.push(now => { this.checkBreaches(now); this.runScheduledLoops(now); this.sweepWorkflows(now); });
  }

  private rows<T>(sql: string, ...args: Array<string | number | null>): T[] { return this.db.prepare(sql).all(...args) as unknown as T[]; }
  private stateType(stateId: string): WorkflowStateType | undefined { return (this.db.prepare('SELECT type FROM states WHERE id = ?').get(stateId) as { type: WorkflowStateType } | undefined)?.type; }
  private firstStateOfType(teamId: string, type: WorkflowStateType): string | undefined { return (this.db.prepare('SELECT id FROM states WHERE team_id = ? AND type = ? ORDER BY position LIMIT 1').get(teamId, type) as { id: string } | undefined)?.id; }

  snapshot() {
    const slaRules: SlaRule[] = this.rows<{ id: string; name: string; team_id: string | null; priorities: string; labels: string; hours: number; enabled: number; created_at: string }>('SELECT * FROM sla_rules ORDER BY created_at')
      .map(r => ({ id: r.id, name: r.name, teamId: r.team_id, priorities: JSON.parse(r.priorities), labelIds: JSON.parse(r.labels), hours: r.hours, enabled: !!r.enabled, createdAt: r.created_at }));
    const loops: Loop[] = this.rows<{ id: string; name: string; team_id: string | null; trigger: string; actions: string; enabled: number; last_run_at: string | null; created_at: string }>('SELECT * FROM loops ORDER BY created_at')
      .map(l => ({ id: l.id, name: l.name, teamId: l.team_id, trigger: JSON.parse(l.trigger), actions: JSON.parse(l.actions), enabled: !!l.enabled, lastRunAt: l.last_run_at, createdAt: l.created_at }));
    const loopRuns: LoopRun[] = this.rows<{ id: string; loop_id: string; issue_id: string | null; ok: number; detail: string; created_at: string }>('SELECT * FROM loop_runs ORDER BY created_at DESC LIMIT 200')
      .map(r => ({ id: r.id, loopId: r.loop_id, issueId: r.issue_id, ok: !!r.ok, detail: r.detail, createdAt: r.created_at }));
    return { slaRules, loops, loopRuns, teamSubscriptions: this.teamSubscriptions(), teamWorkflows: this.teamWorkflows() };
  }

  // ================= team workflows & automations =================
  teamWorkflows(): Record<string, TeamWorkflow> {
    let saved: Record<string, Partial<TeamWorkflow>> = {};
    try { saved = JSON.parse(getMeta(this.db, 'teamWorkflows') ?? '{}'); } catch { /* defaults */ }
    const out: Record<string, TeamWorkflow> = {};
    for (const t of this.rows<{ id: string }>('SELECT id FROM teams')) out[t.id] = { ...DEFAULT_TEAM_WORKFLOW, ...(saved[t.id] ?? {}) };
    return out;
  }
  setTeamWorkflow(teamId: string, patch: Partial<TeamWorkflow>): TeamWorkflow {
    let saved: Record<string, Partial<TeamWorkflow>> = {};
    try { saved = JSON.parse(getMeta(this.db, 'teamWorkflows') ?? '{}'); } catch { /* start over */ }
    saved[teamId] = { ...DEFAULT_TEAM_WORKFLOW, ...(saved[teamId] ?? {}), ...patch };
    setMeta(this.db, 'teamWorkflows', JSON.stringify(saved));
    return saved[teamId] as TeamWorkflow;
  }
  private wfRunning = false;
  private closed = (stateId: string) => { const t = this.stateType(stateId); return t === 'completed' || t === 'canceled'; };
  /** auto-close parents / sub-issues and re-order on status changes, as the Automation agent */
  private applyWorkflow(before: Issue | null, after: Issue): void {
    if (!before || before.stateId === after.stateId || this.wfRunning) return;
    const wf = this.teamWorkflows()[after.teamId];
    if (!wf) return;
    this.wfRunning = true;
    try {
      const bot = () => agentUser(this.store, this.db, 'Automation');
      const type = this.stateType(after.stateId);
      // re-order: an issue moving forward lands at the top (or bottom) of its new status; a hand-placed drop wins
      if (wf.reorder !== 'none' && before.sortOrder === after.sortOrder) {
        const order = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];
        const forward = order.indexOf(type ?? '') >= order.indexOf(this.stateType(before.stateId) ?? '');
        const edge = this.db.prepare(`SELECT ${wf.reorder === 'last' && forward ? 'MAX' : 'MIN'}(sort_order) v FROM issues WHERE team_id = ? AND state_id = ? AND id != ?`).get(after.teamId, after.stateId, after.id) as { v: number | null };
        if (edge.v != null) this.store.updateIssue(after.id, { sortOrder: wf.reorder === 'last' && forward ? edge.v + 1024 : edge.v - 1024 });
      }
      if (!this.closed(after.stateId) || this.closed(before.stateId)) return;
      if (wf.closeSubIssues) {
        for (const child of this.rows<{ id: string; team_id: string; state_id: string }>('SELECT id, team_id, state_id FROM issues WHERE parent_id = ? AND deleted_at IS NULL', after.id)) {
          if (this.closed(child.state_id)) continue;
          const target = this.firstStateOfType(child.team_id, type as WorkflowStateType);
          if (target) this.store.updateIssue(child.id, { stateId: target }, bot());
        }
      }
      if (wf.closeParent && after.parentId) {
        const parent = this.store.getIssue(after.parentId);
        const open = this.rows<{ state_id: string }>('SELECT state_id FROM issues WHERE parent_id = ? AND deleted_at IS NULL', after.parentId).some(c => !this.closed(c.state_id));
        const target = parent && this.firstStateOfType(parent.teamId, 'completed');
        if (parent && !open && !this.closed(parent.stateId) && target) this.store.updateIssue(parent.id, { stateId: target }, bot());
      }
    } finally { this.wfRunning = false; }
  }
  /** hourly: close stale issues and archive long-closed ones */
  private sweepWorkflows(now: Date): void {
    const last = getMeta(this.db, 'workflowSweepAt');
    if (last && now.getTime() - Date.parse(last) < HOUR) return;
    setMeta(this.db, 'workflowSweepAt', now.toISOString());
    const monthsAgo = (m: number) => { const d = new Date(now); d.setMonth(d.getMonth() - m); return d.toISOString(); };
    for (const [teamId, wf] of Object.entries(this.teamWorkflows())) {
      if (wf.closeStale && wf.staleMonths > 0) {
        const target = (wf.staleStateId && this.stateType(wf.staleStateId) ? wf.staleStateId : null) ?? this.firstStateOfType(teamId, 'canceled');
        const stale = this.rows<{ id: string; state_id: string }>("SELECT id, state_id FROM issues WHERE team_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND updated_at < ?", teamId, monthsAgo(wf.staleMonths));
        for (const i of stale) if (target && !this.closed(i.state_id) && this.stateType(i.state_id) !== 'triage') this.store.updateIssue(i.id, { stateId: target }, agentUser(this.store, this.db, 'Automation'));
      }
      if (wf.archiveMonths > 0) {
        const cutoff = monthsAgo(wf.archiveMonths);
        const done = this.rows<{ id: string; project_id: string | null }>('SELECT id, project_id FROM issues WHERE team_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND COALESCE(completed_at, canceled_at) < ?', teamId, cutoff);
        for (const i of done) {
          // an issue in a project waits until the project itself has been closed that long
          if (i.project_id) {
            const p = this.db.prepare('SELECT status, completed_at FROM projects WHERE id = ?').get(i.project_id) as { status: string; completed_at: string | null } | undefined;
            if (p && !((p.status === 'completed' || p.status === 'canceled') && (p.completed_at ?? '') < cutoff)) continue;
          }
          this.store.updateIssue(i.id, { archivedAt: now.toISOString() }, agentUser(this.store, this.db, 'Automation'));
        }
      }
    }
  }

  // ================= team bell =================
  /** someone's team bells (the acting person's by default), by team */
  teamSubscriptions(userId = this.store.actor()): Record<string, TeamSubscription> {
    const rows = this.rows<{ team_id: string; issue_added: number; issue_closed: number; triage: number }>('SELECT * FROM team_subscriptions WHERE user_id = ?', userId);
    return Object.fromEntries(rows.map(r => [r.team_id, { issueAdded: !!r.issue_added, issueClosed: !!r.issue_closed, triage: !!r.triage }]));
  }
  setTeamSubscription(teamId: string, flags: Partial<TeamSubscription>, userId = this.store.actor()): void {
    const v: TeamSubscription = Object.assign({ issueAdded: false, issueClosed: false, triage: false }, this.teamSubscriptions(userId)[teamId], flags);
    this.db.prepare('INSERT INTO team_subscriptions (team_id, user_id, issue_added, issue_closed, triage) VALUES (?, ?, ?, ?, ?) ON CONFLICT(team_id, user_id) DO UPDATE SET issue_added = excluded.issue_added, issue_closed = excluded.issue_closed, triage = excluded.triage')
      .run(teamId, userId, v.issueAdded ? 1 : 0, v.issueClosed ? 1 : 0, v.triage ? 1 : 0);
  }
  /** each person with the team's bell on hears about the events they chose, but never about their own */
  private notifyTeam(before: Issue | null, after: Issue, actorId?: string): void {
    const type = this.stateType(after.stateId);
    const key = this.store.keyOf(after);
    const closed = !!before && before.stateId !== after.stateId && (type === 'completed' || type === 'canceled');
    for (const s of this.rows<{ user_id: string; issue_added: number; issue_closed: number; triage: number }>('SELECT * FROM team_subscriptions WHERE team_id = ?', after.teamId)) {
      const body = !before && s.triage && type === 'triage' ? `added ${key} to triage`
        : !before && s.issue_added ? `added ${key} to the team`
        : closed && s.issue_closed ? `${type === 'completed' ? 'completed' : 'canceled'} ${key}` : null;
      if (body) this.store.notifyEach([s.user_id], 'teamActivity', { actorId, issueId: after.id, body });
    }
  }

  // ================= SLAs =================
  createSlaRule(input: { name: string; teamId?: string | null; priorities?: Priority[]; labelIds?: string[]; hours: number }): SlaRule {
    const r: SlaRule = { id: id('sla'), name: input.name.trim(), teamId: input.teamId ?? null, priorities: input.priorities ?? [], labelIds: input.labelIds ?? [], hours: input.hours, enabled: true, createdAt: ts() };
    this.db.prepare('INSERT INTO sla_rules (id, name, team_id, priorities, labels, hours, enabled, created_at) VALUES (?,?,?,?,?,?,1,?)').run(r.id, r.name, r.teamId, JSON.stringify(r.priorities), JSON.stringify(r.labelIds), r.hours, r.createdAt);
    this.reapplyAll();
    return r;
  }
  updateSlaRule(ruleId: string, patch: Partial<Pick<SlaRule, 'name' | 'teamId' | 'priorities' | 'labelIds' | 'hours' | 'enabled'>>): void {
    const map: Record<string, [string, (v: unknown) => string | number | null]> = {
      name: ['name', v => v as string], teamId: ['team_id', v => v as string | null], priorities: ['priorities', v => JSON.stringify(v)],
      labelIds: ['labels', v => JSON.stringify(v)], hours: ['hours', v => v as number], enabled: ['enabled', v => (v ? 1 : 0)],
    };
    const sets: string[] = []; const vals: Array<string | number | null> = [];
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && map[k]) { sets.push(`${map[k][0]} = ?`); vals.push(map[k][1](v)); }
    if (!sets.length) return;
    vals.push(ruleId);
    this.db.prepare(`UPDATE sla_rules SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    this.reapplyAll();
  }
  deleteSlaRule(ruleId: string): void {
    this.db.prepare('DELETE FROM sla_rules WHERE id = ?').run(ruleId);
    this.db.prepare('UPDATE issues SET sla_rule_id = NULL, sla_breaches_at = NULL WHERE sla_rule_id = ?').run(ruleId);
    this.reapplyAll();
  }
  private matchRule(i: Issue): SlaRule | undefined {
    return this.snapshot().slaRules.find(r => r.enabled
      && (!r.teamId || r.teamId === i.teamId)
      && (!r.priorities.length || r.priorities.includes(i.priority))
      && (!r.labelIds.length || r.labelIds.some(l => i.labelIds.includes(l))));
  }
  /** the deadline starts when an issue first matches a rule; closing it clears the SLA */
  applySla(i: Issue): void {
    const type = this.stateType(i.stateId);
    const cur = this.db.prepare('SELECT sla_rule_id, sla_breaches_at FROM issues WHERE id = ?').get(i.id) as { sla_rule_id: string | null; sla_breaches_at: string | null } | undefined;
    if (!cur) return;
    const rule = type === 'completed' || type === 'canceled' || i.archivedAt ? undefined : this.matchRule(i);
    if (!rule) { if (cur.sla_rule_id) this.db.prepare('UPDATE issues SET sla_rule_id = NULL, sla_breaches_at = NULL WHERE id = ?').run(i.id); return; }
    if (cur.sla_rule_id === rule.id) return;
    const at = new Date(Date.now() + rule.hours * HOUR).toISOString();
    this.db.prepare('UPDATE issues SET sla_rule_id = ?, sla_breaches_at = ? WHERE id = ?').run(rule.id, at, i.id);
    this.store.logActivity({ issueId: i.id, type: 'slaApplied', data: { rule: rule.name, breachesAt: at } }, agentUser(this.store, this.db, 'Automation'));
  }
  private reapplyAll(): void {
    for (const i of this.store.listIssues({ limit: 100000 })) this.applySla(i);
  }
  private checkBreaches(now: Date): void {
    const due = this.rows<{ id: string; assignee_id: string | null; title: string }>('SELECT id, assignee_id, title FROM issues WHERE sla_breaches_at IS NOT NULL AND sla_breaches_at <= ? AND deleted_at IS NULL AND archived_at IS NULL', now.toISOString());
    for (const i of due) {
      if (this.db.prepare("SELECT 1 FROM activity WHERE issue_id = ? AND type = 'slaBreached'").get(i.id)) continue;
      const bot = agentUser(this.store, this.db, 'Automation');
      this.store.logActivity({ issueId: i.id, type: 'slaBreached', data: {} }, bot);
      this.store.notifyEach([i.assignee_id], 'slaBreached', { actorId: bot, issueId: i.id, body: 'SLA breached' });
    }
  }

  // ================= Loops =================
  createLoop(input: { name: string; teamId?: string | null; trigger: LoopTrigger; actions: LoopAction[] }): Loop {
    const l: Loop = { id: id('loop'), name: input.name.trim(), teamId: input.teamId ?? null, trigger: input.trigger, actions: input.actions, enabled: true, lastRunAt: null, createdAt: ts() };
    this.db.prepare('INSERT INTO loops (id, name, team_id, trigger, actions, enabled, last_run_at, created_at) VALUES (?,?,?,?,?,1,NULL,?)').run(l.id, l.name, l.teamId, JSON.stringify(l.trigger), JSON.stringify(l.actions), l.createdAt);
    return l;
  }
  updateLoop(loopId: string, patch: Partial<Pick<Loop, 'name' | 'teamId' | 'trigger' | 'actions' | 'enabled'>>): void {
    const map: Record<string, [string, (v: unknown) => string | number | null]> = {
      name: ['name', v => v as string], teamId: ['team_id', v => v as string | null], trigger: ['trigger', v => JSON.stringify(v)], actions: ['actions', v => JSON.stringify(v)], enabled: ['enabled', v => (v ? 1 : 0)],
    };
    const sets: string[] = []; const vals: Array<string | number | null> = [];
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && map[k]) { sets.push(`${map[k][0]} = ?`); vals.push(map[k][1](v)); }
    if (!sets.length) return;
    vals.push(loopId);
    this.db.prepare(`UPDATE loops SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteLoop(loopId: string): void { this.db.prepare('DELETE FROM loops WHERE id = ?').run(loopId); }

  private fireIssueLoops(before: Issue | null, after: Issue, _actorId?: string): void {
    for (const l of this.snapshot().loops) {
      if (!l.enabled || (l.teamId && l.teamId !== after.teamId)) continue;
      const t = l.trigger;
      const hit = (t.kind === 'issueCreated' && !before)
        || (t.kind === 'labelAdded' && after.labelIds.includes(t.labelId) && !(before?.labelIds ?? []).includes(t.labelId))
        || (t.kind === 'statusChanged' && !!before && before.stateId !== after.stateId && this.stateType(after.stateId) === t.stateType);
      if (hit) this.runLoop(l.id, after.id);
    }
  }
  private runScheduledLoops(now: Date): void {
    const every = { hourly: HOUR, daily: 24 * HOUR, weekly: 7 * 24 * HOUR };
    for (const l of this.snapshot().loops) {
      if (!l.enabled || l.trigger.kind !== 'schedule') continue;
      const last = l.lastRunAt ? new Date(l.lastRunAt).getTime() : new Date(l.createdAt).getTime();
      if (now.getTime() - last >= every[l.trigger.cadence]) this.runLoop(l.id, null, now);
    }
  }
  /** run a loop's actions on an issue (or, for schedules, on the issue its createIssue action files) */
  runLoop(loopId: string, issueId: string | null, now = new Date()): LoopRun {
    const l = this.snapshot().loops.find(x => x.id === loopId);
    if (!l) throw new Error('Unknown loop');
    const bot = agentUser(this.store, this.db, 'Automation');
    const done: string[] = [];
    let ok = true; let target = issueId;
    this.running = true;
    try {
      for (const a of l.actions) {
        if (a.kind === 'createIssue') {
          const teamId = l.teamId ?? (this.db.prepare('SELECT id FROM teams ORDER BY position LIMIT 1').get() as { id: string }).id;
          const fill = (s: string) => s.replace(/\{date\}/g, now.toISOString().slice(0, 10));
          target = this.store.createIssue({ teamId, title: fill(a.title), description: fill(a.description) }, bot).id;
          done.push(`filed ${this.store.keyOf(this.store.getIssue(target)!)}`);
          continue;
        }
        const issue = target ? this.store.getIssue(target) : undefined;
        if (!issue) { done.push(`${a.kind}: no issue`); continue; }
        const key = this.store.keyOf(issue);
        if (a.kind === 'assign') { this.store.updateIssue(issue.id, { assigneeId: a.userId }, bot); done.push('assigned'); }
        else if (a.kind === 'label') { if (!issue.labelIds.includes(a.labelId)) this.store.updateIssue(issue.id, { labelIds: [...issue.labelIds, a.labelId] }, bot); done.push('labelled'); }
        else if (a.kind === 'status') { const s = this.firstStateOfType(issue.teamId, a.stateType); if (s) this.store.updateIssue(issue.id, { stateId: s }, bot); done.push(`moved to ${a.stateType}`); }
        else if (a.kind === 'comment') { this.store.addComment(issue.id, bot, a.body.replace(/\{issue\.key\}/g, key).replace(/\{issue\.title\}/g, issue.title)); done.push('commented'); }
        else if (a.kind === 'claudeCode') {
          if (this.launcher) { void this.launcher(issue.id).catch(() => {}); done.push('opened Claude Code'); }
          else { done.push(`Claude Code: ${this.launcherMissing}, skipped`); ok = false; }
        }
      }
    } catch (e) { ok = false; done.push(`error: ${(e as Error).message}`); }
    finally { this.running = false; }
    const run: LoopRun = { id: id('lr'), loopId, issueId: target, ok, detail: done.join(' · '), createdAt: ts() };
    this.db.prepare('INSERT INTO loop_runs (id, loop_id, issue_id, ok, detail, created_at) VALUES (?,?,?,?,?,?)').run(run.id, loopId, target, ok ? 1 : 0, run.detail, run.createdAt);
    this.db.prepare('UPDATE loops SET last_run_at = ? WHERE id = ?').run(now.toISOString(), loopId);
    if (target) this.store.logActivity({ issueId: target, type: 'loopRan', data: { loop: l.name, detail: run.detail } }, bot);
    // loops are workspace settings, so a failing one is the admins' to look at
    if (!ok) this.store.notifyEach(this.rows<{ id: string }>("SELECT id FROM users WHERE admin = 1 AND kind != 'agent' AND status = 'active'").map(u => u.id), 'loopFailed', { actorId: bot, issueId: target, body: `${l.name}: ${run.detail}` });
    return run;
  }
}
