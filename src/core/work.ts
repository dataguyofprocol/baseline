// Agent work: the server side of the agent operations (src/ops). An extension module like
// planning or git (extensions.ts): its own tables, plugged into the store, no UI of its own.
//
// - work_threads: one row per (issue, agent, person, session). It holds the living progress
//   comment, the branch, the last progress fields and the links already attached. Repeated calls
//   converge on it, and two agents (or two sessions) never share a row or a comment.
// - agent_ops: one row per agent write that changed something. Its activity rows carry its id
//   (activity.op_id), which is what undo replays; before/after hold what activity doesn't
//   (the thread, the comment text, the draft).
// - project_update_drafts: a status update an agent drafted. A separate table, so nothing that
//   reads project_updates can show a draft. Only a person publishes one, from the web app.
import type { DatabaseSync } from 'node:sqlite';
import { attributing, currentOp, type Attribution } from './actor.js';
import { appBaseUrl } from './handoff.js';
import type { Store } from './store.js';
import { id, nowIso } from './util.js';
import type { Issue, Project, WorkflowStateType } from './types.js';
import type {
  DraftFacts, DraftResult, FinishWorkResult, FollowupResult, Health, ProgressFields, ProgressPatch, ProgressResult,
  ProjectUpdateDraft, StartWorkResult, UndoResult, WorkOutcome, WorkThread,
} from './work-types.js';

export const WORK_TABLES = ['agent_ops', 'project_update_drafts', 'work_threads'];

export function migrateWork(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_threads (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      session_key TEXT NOT NULL DEFAULT '',
      comment_id TEXT,
      branch TEXT NOT NULL,
      did TEXT,
      left_text TEXT,
      blocked TEXT,
      links TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      outcome TEXT,
      summary TEXT,
      finished_at TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (issue_id, agent_id, person_id, session_key),
      CHECK ((status = 'active' AND outcome IS NULL AND summary IS NULL AND finished_at IS NULL)
          OR (status = 'finished' AND outcome IN ('in_review', 'done', 'stopped') AND summary IS NOT NULL AND finished_at IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS agent_ops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      issue_id TEXT,
      project_id TEXT,
      thread_id TEXT,
      actor_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      session_key TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT,
      result_id TEXT,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      undoes TEXT,
      created_at TEXT NOT NULL,
      undone_at TEXT,
      undone_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_ops_dedupe ON agent_ops(name, issue_id, dedupe_key);
    CREATE TABLE IF NOT EXISTS project_update_drafts (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      via_user_id TEXT,
      body TEXT NOT NULL,
      health TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, person_id)
    );
  `);
}

/** A request the work routes refuse; the server answers `{ error, code }` with this status. */
export class WorkError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, readonly code: 'invalid' | 'not-found' | 'forbidden' | 'conflict' | 'needs-human', message: string) { super(message); }
}

/** whose work a thread is: the agent (or the person themself), the person, and the session */
export interface Lane { agentId: string; personId: string; sessionKey: string | null }

export function laneOf(who: Attribution, sessionKey: string | null): Lane {
  return { agentId: who.actorId, personId: who.actor === 'agent' ? who.viaUserId : who.actorId, sessionKey };
}

type OpName = 'start_issue' | 'post_progress' | 'file_followup' | 'finish_issue' | 'draft_project_update' | 'undo';

/** what activity rows don't hold, so undo can put it back: the thread row, the living comment's text, the draft */
interface OpState { thread?: WorkThread | null; commentBody?: string | null; draft?: ProjectUpdateDraft | null }

interface ThreadRow {
  id: string; issue_id: string; agent_id: string; person_id: string; session_key: string; comment_id: string | null; branch: string;
  did: string | null; left_text: string | null; blocked: string | null; links: string; status: string; outcome: string | null;
  summary: string | null; finished_at: string | null; started_at: string; updated_at: string;
}
interface OpRow {
  id: string; name: OpName; issue_id: string | null; project_id: string | null; thread_id: string | null; actor_id: string; person_id: string;
  session_key: string; dedupe_key: string | null; result_id: string | null; before_json: string; after_json: string; undoes: string | null;
  created_at: string; undone_at: string | null;
}
interface DraftRow { project_id: string; person_id: string; author_id: string; body: string; health: Health | null; updated_at: string }

const NOT_STARTED = new Set<WorkflowStateType>(['triage', 'backlog', 'unstarted']);
const CLOSED = new Set<WorkflowStateType>(['completed', 'canceled']);
const OUTCOME_HEADING: Record<WorkOutcome, string> = { in_review: 'Finished: ready for review', done: 'Finished: done', stopped: 'Stopped before finishing' };

export class Work {
  constructor(private store: Store, private db: DatabaseSync) {}

  // ---------- reads ----------
  threads(issueId: string): WorkThread[] {
    return (this.db.prepare('SELECT * FROM work_threads WHERE issue_id = ? ORDER BY started_at').all(issueId) as unknown as ThreadRow[]).map(mapThread);
  }

  draft(projectId: string, personId: string): ProjectUpdateDraft | null {
    const r = this.db.prepare('SELECT * FROM project_update_drafts WHERE project_id = ? AND person_id = ?').get(projectId, personId) as DraftRow | undefined;
    return r ? mapDraft(r) : null;
  }

  /** every draft waiting for this person, newest first; nobody else's */
  draftsFor(personId: string): ProjectUpdateDraft[] {
    return (this.db.prepare('SELECT * FROM project_update_drafts WHERE person_id = ? ORDER BY updated_at DESC').all(personId) as unknown as DraftRow[]).map(mapDraft);
  }

  /** the lane an op was written in, so the route can check who may undo it */
  opOwner(opId: string): { actorId: string; personId: string; teamId: string | null } | undefined {
    const r = this.db.prepare('SELECT o.actor_id, o.person_id, i.team_id FROM agent_ops o LEFT JOIN issues i ON i.id = o.issue_id WHERE o.id = ?').get(opId) as { actor_id: string; person_id: string; team_id: string | null } | undefined;
    return r && { actorId: r.actor_id, personId: r.person_id, teamId: r.team_id };
  }

  // ---------- the work loop ----------
  /** Moves a not-started issue to the team's first started state and assigns the person if nobody
   *  is assigned; opens (or reopens) this lane's thread. Nothing to do: no writes, opId null. */
  start(issueId: string, lane: Lane, who: Attribution, baseUrl?: string): StartWorkResult {
    return this.write(who, () => {
      const issue = this.liveIssue(issueId);
      const key = this.store.keyOf(issue);
      const type = this.store.stateType(issue.stateId);
      const warnings: string[] = [];
      const target = type && NOT_STARTED.has(type) ? this.store.stateOfType(issue.teamId, 'started') : undefined;
      if (type && NOT_STARTED.has(type) && !target) warnings.push(`${key}'s team has no started state, so its state was not changed.`);
      if (type && CLOSED.has(type)) warnings.push(`${key} is ${this.stateName(issue.stateId)}; its state was not changed.`);
      const assign = !issue.assigneeId;
      if (issue.assigneeId && issue.assigneeId !== lane.personId) warnings.push(`${key} is assigned to ${this.userName(issue.assigneeId)}; it was not reassigned.`);
      const before = this.thread(issueId, lane);
      const handoff = this.store.handoffFor(issueId, baseUrl)!;
      const changed = !!target || assign || !before || before.state.status === 'finished';
      const opId = changed ? this.op('start_issue', lane, { issueId, threadBefore: before }, () => {
        if (target || assign) this.store.updateIssue(issueId, { ...(target ? { stateId: target } : {}), ...(assign ? { assigneeId: lane.personId } : {}) }, who.actorId);
        return { thread: this.saveThread(issueId, lane, before, { branch: handoff.branchName, state: { status: 'active' } }) };
      }) : null;
      const thread = this.thread(issueId, lane)!;
      return {
        opId, attributedTo: this.attributedTo(who), issue: this.store.getIssue(issueId)!, url: handoff.url, thread,
        branch: thread.branch, brief: handoff.prompt, changed: { moved: !!target && !!opId, assigned: assign && !!opId }, warnings,
      };
    });
  }

  /** The lane's living comment: created on the first call, rewritten in place after (quietly: an
   *  edit notifies nobody). Fields merge: omitted keeps, "" clears. New links are attached once. */
  progress(issueId: string, lane: Lane, patch: ProgressPatch, links: readonly string[], who: Attribution, baseUrl?: string): ProgressResult {
    return this.write(who, () => {
      const issue = this.liveIssue(issueId);
      const before = this.thread(issueId, lane);
      const progress = mergeProgress(before?.progress ?? { did: null, left: null, blocked: null }, patch);
      if (!progress.did && !progress.left && !progress.blocked) throw new WorkError(400, 'invalid', 'A progress note needs at least one of did, left or blocked');
      const allLinks = [...new Set([...(before?.links ?? []), ...links])];
      const body = renderProgress(progress, allLinks);
      const comment = this.livingComment(before);
      const fresh = this.unattached(issueId, links);
      const changed = !before || !comment || comment.body !== body || fresh.length > 0 || before.state.status === 'finished';
      let created = false;
      const opId = changed ? this.op('post_progress', lane, { issueId, threadBefore: before, commentBefore: comment?.body ?? null }, () => {
        let commentId = comment?.id;
        if (comment) this.store.updateComment(comment.id, body);
        else { commentId = this.store.addComment(issueId, who.actorId, body).id; created = true; }
        for (const url of fresh) this.store.addAttachment({ issueId, kind: 'link', url, title: linkTitle(url) }, who.actorId);
        const branch = before?.branch ?? this.store.handoffFor(issueId, baseUrl)!.branchName;
        const thread = this.saveThread(issueId, lane, before, { branch, commentId: commentId!, progress, links: allLinks, state: { status: 'active' } });
        return { thread, commentBody: body };
      }) : null;
      return { opId, attributedTo: this.attributedTo(who), issue, url: this.issueUrl(issue, baseUrl), thread: this.thread(issueId, lane)!, created, linksAdded: opId ? fresh.length : 0 };
    });
  }

  /** The final word: the living comment becomes the summary, the state follows the outcome
   *  (never backwards out of a closed state), the thread closes. Same outcome and text again: no writes. */
  finish(issueId: string, lane: Lane, input: { outcome: WorkOutcome; summary: string; left?: string; links: readonly string[] }, who: Attribution, baseUrl?: string): FinishWorkResult {
    return this.write(who, () => {
      if (input.outcome === 'stopped' && !input.left?.trim()) throw new WorkError(400, 'invalid', 'outcome "stopped" needs left: what remains to be done');
      const issue = this.liveIssue(issueId);
      const key = this.store.keyOf(issue);
      const type = this.store.stateType(issue.stateId);
      const warnings: string[] = [];
      let target: string | undefined;
      if (input.outcome !== 'stopped') {
        target = input.outcome === 'done' ? this.store.stateOfType(issue.teamId, 'completed') : this.inReviewState(issue.teamId);
        if (!target && input.outcome === 'in_review') warnings.push(`${key}'s team has no "In Review" state, so ${key} stays ${this.stateName(issue.stateId)}.`);
        if (target && target !== issue.stateId && type && CLOSED.has(type)) {
          warnings.push(`${key} is already ${this.stateName(issue.stateId)}; its state was not changed.`);
          target = undefined;
        }
        if (target === issue.stateId) target = undefined;
      }
      const before = this.thread(issueId, lane);
      const summary = input.summary.trim();
      const left = input.left?.trim() || null;
      const allLinks = [...new Set([...(before?.links ?? []), ...input.links])];
      const body = renderFinal(input.outcome, summary, left, allLinks);
      const comment = this.livingComment(before);
      const fresh = this.unattached(issueId, input.links);
      const same = before?.state.status === 'finished' && before.state.outcome === input.outcome && before.state.summary === summary && before.progress.left === left;
      const changed = !!target || !comment || comment.body !== body || fresh.length > 0 || !same;
      const opId = changed ? this.op('finish_issue', lane, { issueId, threadBefore: before, commentBefore: comment?.body ?? null }, () => {
        if (target) this.store.updateIssue(issueId, { stateId: target }, who.actorId);
        let commentId = comment?.id;
        if (comment) this.store.updateComment(comment.id, body);
        else commentId = this.store.addComment(issueId, who.actorId, body).id;
        for (const url of fresh) this.store.addAttachment({ issueId, kind: 'link', url, title: linkTitle(url) }, who.actorId);
        const branch = before?.branch ?? this.store.handoffFor(issueId, baseUrl)!.branchName;
        const thread = this.saveThread(issueId, lane, before, {
          branch, commentId: commentId!, links: allLinks,
          progress: { did: before?.progress.did ?? null, left, blocked: null },
          state: { status: 'finished', outcome: input.outcome, summary, finishedAt: nowIso() },
        });
        return { thread, commentBody: body };
      }) : null;
      const after = this.store.getIssue(issueId)!;
      return { opId, attributedTo: this.attributedTo(who), issue: after, url: this.issueUrl(after, baseUrl), thread: this.thread(issueId, lane)!, warnings };
    });
  }

  /** New work found along the way. It always lands in the team's Triage state, where a person
   *  accepts or declines it, related to the issue it came from. The same title from the same
   *  lane and issue again returns the first one. */
  followup(sourceIssueId: string, lane: Lane, input: { title: string; description?: string; teamId?: string }, who: Attribution, baseUrl?: string): FollowupResult {
    return this.write(who, () => {
      const source = this.liveIssue(sourceIssueId);
      const team = this.store.getTeam(input.teamId ?? source.teamId);
      if (!team) throw new WorkError(404, 'not-found', `No team ${input.teamId}`);
      const triage = this.store.stateOfType(team.id, 'triage');
      if (!triage) throw new WorkError(409, 'needs-human', `${team.key} has triage turned off, so a follow-up there would skip a person's review. Ask the person to turn it on (\`baseline team update ${team.key} --triage on\`), or to file it themselves.`);
      const dedupeKey = normalizeTitle(input.title);
      const prior = this.db.prepare(`SELECT result_id FROM agent_ops WHERE name = 'file_followup' AND issue_id = ? AND actor_id = ? AND person_id = ? AND session_key = ? AND dedupe_key = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1`)
        .get(source.id, lane.agentId, lane.personId, lane.sessionKey ?? '', dedupeKey) as { result_id: string } | undefined;
      const existing = prior ? this.store.getIssue(prior.result_id) : undefined;
      if (existing && !existing.deletedAt) return { opId: null, attributedTo: this.attributedTo(who), issue: existing, url: this.issueUrl(existing, baseUrl), source, deduplicated: true };
      let created: Issue | undefined;
      const opId = this.op('file_followup', lane, { issueId: source.id, dedupeKey }, () => {
        created = this.store.createIssue({ teamId: team.id, title: input.title.trim(), description: input.description, stateId: triage, projectId: source.projectId }, who.actorId);
        // "related" is stored one way (store.setRelation), and an issue page lists its own rows: both pages should show the link
        this.store.setRelation(created.id, source.id, 'related', who.actorId);
        this.store.setRelation(source.id, created.id, 'related', who.actorId);
        return { resultId: created.id };
      });
      return { opId, attributedTo: this.attributedTo(who), issue: created!, url: this.issueUrl(created!, baseUrl), source, deduplicated: false };
    });
  }

  // ---------- project status ----------
  /** One draft per (project, person), replaced on each call. Never published here: the publish
   *  route takes a person's browser session only. */
  draftUpdate(projectId: string, lane: Lane, input: { body?: string; health?: Health }, who: Attribution, baseUrl?: string): DraftResult {
    return this.write(who, () => {
      const project = this.store.snapshot().projects.find(p => p.id === projectId);
      if (!project) throw new WorkError(404, 'not-found', `No project ${projectId}`);
      const facts = this.facts(project);
      const body = input.body?.trim() || composeDraft(facts);
      const health = input.health ?? null;
      const before = this.draft(projectId, lane.personId);
      const changed = !before || before.body !== body || before.health !== health || before.authorId !== who.actorId;
      const opId = changed ? this.op('draft_project_update', lane, { projectId, draftBefore: before }, () => {
        const now = nowIso();
        this.db.prepare(`INSERT INTO project_update_drafts (project_id, person_id, author_id, via_user_id, body, health, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (project_id, person_id) DO UPDATE SET author_id = excluded.author_id, via_user_id = excluded.via_user_id, body = excluded.body, health = excluded.health, updated_at = excluded.updated_at`)
          .run(projectId, lane.personId, who.actorId, who.viaUserId, body, health, now, now);
        return { draft: this.draft(projectId, lane.personId) };
      }) : null;
      return { opId, attributedTo: this.attributedTo(who), project, url: `${appBaseUrl(baseUrl)}/#/projects/${project.id}`, draft: this.draft(projectId, lane.personId)!, facts };
    });
  }

  /** the person publishes their draft: it becomes a project update by them, and the draft is gone.
   *  `edits` is what the person changed in the composer before publishing. */
  publishDraft(projectId: string, personId: string, edits: { body?: string; health?: Health } = {}): ProjectUpdateDraft & { updateId: string } {
    return this.store.transaction(() => {
      const stored = this.draft(projectId, personId);
      if (!stored) throw new WorkError(404, 'not-found', 'There is no draft update for this project');
      const d = { ...stored, body: edits.body?.trim() || stored.body, health: edits.health ?? stored.health };
      const u = this.store.addProjectUpdate(projectId, personId, d.body, d.health ?? undefined);
      this.db.prepare('DELETE FROM project_update_drafts WHERE project_id = ? AND person_id = ?').run(projectId, personId);
      return { ...d, updateId: u.id };
    });
  }

  discardDraft(projectId: string, personId: string): boolean {
    return Number(this.db.prepare('DELETE FROM project_update_drafts WHERE project_id = ? AND person_id = ?').run(projectId, personId).changes) > 0;
  }

  // ---------- undo ----------
  /** Replays the op's activity rows backwards. A field someone changed since (an issue's state or
   *  assignee, a filed issue a person touched) refuses the whole undo; the thread, the living
   *  comment and a draft are put back only when nothing changed them since, else left as they are. */
  undo(opId: string, who: Attribution): UndoResult {
    return this.write(who, () => {
      const op = this.db.prepare('SELECT * FROM agent_ops WHERE id = ?').get(opId) as OpRow | undefined;
      if (!op) throw new WorkError(404, 'not-found', `No change ${opId}`);
      const undid = { opId: op.id, name: op.name };
      if (op.undone_at) return { opId: null, undid, reverted: [], leftAsIs: [], alreadyUndone: true };
      if (op.name === 'undo') throw new WorkError(409, 'invalid', 'An undo can\'t be undone; make the change again instead');
      const before = JSON.parse(op.before_json) as OpState;
      const after = JSON.parse(op.after_json) as OpState;
      const conflicts: string[] = [], reverted: string[] = [], leftAsIs: string[] = [];
      const steps: Array<() => void> = [];
      const rows = this.db.prepare('SELECT * FROM activity WHERE op_id = ? ORDER BY created_at DESC, rowid DESC').all(opId) as Array<{ issue_id: string | null; type: string; data: string }>;
      let createdComment: string | undefined;
      for (const row of rows) {
        const data = JSON.parse(row.data) as Record<string, string | null>;
        const issue = row.issue_id ? this.store.getIssue(row.issue_id) : undefined;
        if (!issue || issue.deletedAt) { leftAsIs.push(`${row.type}: the issue is deleted`); continue; }
        const key = this.store.keyOf(issue);
        switch (row.type) {
          case 'stateChanged': case 'triageAccepted': {
            const from = row.type === 'stateChanged' ? data.from : this.store.stateOfType(issue.teamId, 'triage');
            if (issue.stateId !== data.to) conflicts.push(`${key}'s state is ${this.stateName(issue.stateId)} now, not ${this.stateName(data.to ?? '')}`);
            else if (from) { steps.push(() => this.store.updateIssue(issue.id, { stateId: from }, who.actorId)); reverted.push(`${key} state: back to ${this.stateName(from)}`); }
            break;
          }
          case 'assigned': case 'unassigned':
            if (issue.assigneeId !== (data.to ?? null)) conflicts.push(`${key}'s assignee is ${this.userName(issue.assigneeId)} now, not ${this.userName(data.to ?? null)}`);
            else { steps.push(() => this.store.updateIssue(issue.id, { assigneeId: data.from ?? null }, who.actorId)); reverted.push(`${key} assignee: back to ${this.userName(data.from ?? null)}`); }
            break;
          case 'created': {
            const since = this.db.prepare('SELECT a.type, u.name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.issue_id = ? AND (a.op_id IS NULL OR a.op_id != ?) LIMIT 1').get(issue.id, opId) as { type: string; name: string | null } | undefined;
            const commented = this.db.prepare('SELECT 1 FROM comments WHERE issue_id = ? LIMIT 1').get(issue.id);
            if (since || commented) conflicts.push(`${key} was changed since (${since ? `${since.type}${since.name ? ` by ${since.name}` : ''}` : 'commented'})`);
            else { steps.push(() => this.store.deleteIssue(issue.id)); reverted.push(`${key}: deleted (it can be restored from Trash)`); }
            break;
          }
          case 'related': {
            const rels = this.db.prepare('SELECT id FROM relations WHERE issue_id = ? AND related_id = ? AND type = ?').all(issue.id, data.relatedId, data.type) as Array<{ id: string }>;
            for (const r of rels) steps.push(() => this.store.removeRelation(r.id));
            if (rels.length) reverted.push(`${key}: relation removed`);
            break;
          }
          case 'commented': {
            const c = this.db.prepare('SELECT body FROM comments WHERE id = ?').get(data.commentId) as { body: string } | undefined;
            if (!c) leftAsIs.push(`the comment on ${key}: already deleted`);
            else if (c.body !== after.commentBody) leftAsIs.push(`the progress note on ${key}: updated since`);
            else { createdComment = data.commentId!; steps.push(() => this.store.deleteComment(data.commentId!)); reverted.push(`${key}: progress note deleted`); }
            break;
          }
          case 'attached':
            if (this.store.getAttachment(data.attachmentId!)) { steps.push(() => this.store.deleteAttachment(data.attachmentId!)); reverted.push(`${key}: link removed (${data.title ?? ''})`); }
            break;
          default: leftAsIs.push(`${row.type} on ${key}`);
        }
      }
      // a living comment this op only edited goes back to its earlier text
      const commentId = after.thread?.commentId;
      if (commentId && commentId !== createdComment && typeof before.commentBody === 'string') {
        const c = this.db.prepare('SELECT body FROM comments WHERE id = ?').get(commentId) as { body: string } | undefined;
        const earlier = before.commentBody;
        if (c && c.body === after.commentBody) { steps.push(() => this.store.updateComment(commentId, earlier)); reverted.push('progress note: back to its earlier text'); }
        else leftAsIs.push('the progress note: edited since');
      }
      if (after.thread) {
        const t = after.thread;
        if (this.threadById(t.id)?.updatedAt === t.updatedAt) {
          const prev = before.thread;
          steps.push(() => { if (prev) this.writeThread(prev); else this.db.prepare('DELETE FROM work_threads WHERE id = ?').run(t.id); });
          reverted.push(prev ? `work thread: back to ${prev.state.status}` : 'work thread: removed');
        } else leftAsIs.push('the work thread: updated since');
      }
      if (after.draft && op.project_id) {
        const projectId = op.project_id, personId = op.person_id, prev = before.draft;
        if (this.draft(projectId, personId)?.updatedAt === after.draft.updatedAt) {
          steps.push(() => { if (prev) this.writeDraft(prev); else this.discardDraft(projectId, personId); });
          reverted.push(prev ? 'project update draft: back to its earlier text' : 'project update draft: discarded');
        } else leftAsIs.push('the project update draft: changed since');
      }
      if (conflicts.length) throw new WorkError(409, 'conflict', `Not undone, because someone changed it since: ${conflicts.join('; ')}`);
      const lane = laneOf(who, op.session_key || null);
      const undoId = this.op('undo', lane, { issueId: op.issue_id ?? undefined, projectId: op.project_id ?? undefined, undoes: op.id }, () => {
        for (const s of steps) s();
        return {};
      });
      this.db.prepare('UPDATE agent_ops SET undone_at = ?, undone_by = ? WHERE id = ?').run(nowIso(), undoId, op.id);
      return { opId: undoId, undid, reverted, leftAsIs, alreadyUndone: false };
    });
  }

  // ---------- internals ----------
  /** one SQLite transaction, under the write's attribution */
  private write<T>(who: Attribution, fn: () => T): T {
    return attributing.run(who, () => this.store.transaction(fn));
  }

  /** runs one op's writes under its id (stamped on every activity row they log) and records it */
  private op(name: OpName, lane: Lane,
    at: { issueId?: string; projectId?: string; threadBefore?: WorkThread | null; commentBefore?: string | null; draftBefore?: ProjectUpdateDraft | null; dedupeKey?: string; undoes?: string },
    fn: () => OpState & { resultId?: string }): string {
    const opId = id('op');
    const { resultId, ...after } = currentOp.run(opId, fn);
    const before: OpState = {
      ...('threadBefore' in at ? { thread: at.threadBefore } : {}),
      ...('commentBefore' in at ? { commentBody: at.commentBefore } : {}),
      ...('draftBefore' in at ? { draft: at.draftBefore } : {}),
    };
    this.db.prepare(`INSERT INTO agent_ops (id, name, issue_id, project_id, thread_id, actor_id, person_id, session_key, dedupe_key, result_id, before_json, after_json, undoes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(opId, name, at.issueId ?? null, at.projectId ?? null, after.thread?.id ?? null, lane.agentId, lane.personId, lane.sessionKey ?? '', at.dedupeKey ?? null, resultId ?? null,
        JSON.stringify(before), JSON.stringify(after), at.undoes ?? null, nowIso());
    return opId;
  }

  private liveIssue(issueId: string): Issue {
    const issue = this.store.getIssue(issueId);
    if (!issue || issue.deletedAt) throw new WorkError(404, 'not-found', `No issue ${issueId}`);
    if (issue.archivedAt) throw new WorkError(409, 'invalid', `${this.store.keyOf(issue)} is archived`);
    return issue;
  }

  private thread(issueId: string, lane: Lane): WorkThread | null {
    const r = this.db.prepare('SELECT * FROM work_threads WHERE issue_id = ? AND agent_id = ? AND person_id = ? AND session_key = ?')
      .get(issueId, lane.agentId, lane.personId, lane.sessionKey ?? '') as ThreadRow | undefined;
    return r ? mapThread(r) : null;
  }
  private threadById(threadId: string): WorkThread | null {
    const r = this.db.prepare('SELECT * FROM work_threads WHERE id = ?').get(threadId) as ThreadRow | undefined;
    return r ? mapThread(r) : null;
  }

  private saveThread(issueId: string, lane: Lane, before: WorkThread | null, patch: Partial<Pick<WorkThread, 'commentId' | 'progress' | 'links' | 'state'>> & { branch: string }): WorkThread {
    const now = nowIso();
    const t: WorkThread = {
      id: before?.id ?? id('wt'), issueId, agentId: lane.agentId, personId: lane.personId, sessionKey: lane.sessionKey,
      commentId: patch.commentId ?? before?.commentId ?? null, branch: before?.branch ?? patch.branch,
      progress: patch.progress ?? before?.progress ?? { did: null, left: null, blocked: null },
      links: patch.links ?? before?.links ?? [], state: patch.state ?? before?.state ?? { status: 'active' },
      startedAt: before?.startedAt ?? now, updatedAt: now,
    };
    this.writeThread(t);
    return t;
  }
  private writeThread(t: WorkThread): void {
    const fin = t.state.status === 'finished' ? t.state : null;
    this.db.prepare(`INSERT INTO work_threads (id, issue_id, agent_id, person_id, session_key, comment_id, branch, did, left_text, blocked, links, status, outcome, summary, finished_at, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET comment_id = excluded.comment_id, did = excluded.did, left_text = excluded.left_text, blocked = excluded.blocked, links = excluded.links,
        status = excluded.status, outcome = excluded.outcome, summary = excluded.summary, finished_at = excluded.finished_at, updated_at = excluded.updated_at`)
      .run(t.id, t.issueId, t.agentId, t.personId, t.sessionKey ?? '', t.commentId, t.branch, t.progress.did, t.progress.left, t.progress.blocked, JSON.stringify(t.links),
        t.state.status, fin?.outcome ?? null, fin?.summary ?? null, fin?.finishedAt ?? null, t.startedAt, t.updatedAt);
  }
  private writeDraft(d: ProjectUpdateDraft): void {
    this.db.prepare(`INSERT INTO project_update_drafts (project_id, person_id, author_id, body, health, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, person_id) DO UPDATE SET author_id = excluded.author_id, body = excluded.body, health = excluded.health, updated_at = excluded.updated_at`)
      .run(d.projectId, d.personId, d.authorId, d.body, d.health, d.updatedAt, d.updatedAt);
  }

  /** the lane's comment, unless a person deleted it (then the next write starts a new one) */
  private livingComment(t: WorkThread | null): { id: string; body: string } | undefined {
    return t?.commentId ? this.db.prepare('SELECT id, body FROM comments WHERE id = ?').get(t.commentId) as { id: string; body: string } | undefined : undefined;
  }

  /** links not yet attached to the issue, each once */
  private unattached(issueId: string, links: readonly string[]): string[] {
    const have = new Set((this.db.prepare('SELECT url FROM attachments WHERE issue_id = ?').all(issueId) as Array<{ url: string }>).map(r => r.url));
    return [...new Set(links)].filter(u => !have.has(u));
  }

  private inReviewState(teamId: string): string | undefined {
    return (this.db.prepare("SELECT id FROM states WHERE team_id = ? AND lower(name) = 'in review' ORDER BY position LIMIT 1").get(teamId) as { id: string } | undefined)?.id;
  }
  private stateName(stateId: string): string {
    return (this.db.prepare('SELECT name FROM states WHERE id = ?').get(stateId) as { name: string } | undefined)?.name ?? '?';
  }
  private userName(userId: string | null): string {
    if (!userId) return 'nobody';
    return (this.db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string } | undefined)?.name ?? '?';
  }
  /** "Claude Code via Parth Batra", or the person's own name */
  private attributedTo(who: Attribution): string {
    return who.actor === 'agent' ? `${this.userName(who.actorId)} via ${this.userName(who.viaUserId)}` : this.userName(who.actorId);
  }
  private issueUrl(issue: Issue, baseUrl?: string): string {
    return `${appBaseUrl(baseUrl)}/#/issue/${this.store.keyOf(issue)}`;
  }

  /** what happened in a project since its last published update (since it started, if none) */
  private facts(project: Project): DraftFacts {
    const since = (this.db.prepare('SELECT MAX(created_at) at FROM project_updates WHERE project_id = ?').get(project.id) as { at: string | null }).at;
    const from = since ?? project.createdAt;
    const rows = this.db.prepare(`SELECT i.id, i.team_id, i.number, i.created_at, i.completed_at, s.type, lower(s.name) AS state FROM issues i JOIN states s ON s.id = i.state_id
      WHERE i.project_id = ? AND i.deleted_at IS NULL AND i.archived_at IS NULL ORDER BY i.team_id, i.number`).all(project.id) as Array<{ id: string; team_id: string; number: number; created_at: string; completed_at: string | null; type: WorkflowStateType; state: string }>;
    const key = (r: { team_id: string; number: number }) => this.store.keyOf({ teamId: r.team_id, number: r.number });
    const blocked = new Set((this.db.prepare(`SELECT r.issue_id FROM relations r JOIN issues o ON o.id = r.related_id JOIN states s ON s.id = o.state_id
      WHERE r.type = 'blocked_by' AND o.deleted_at IS NULL AND s.type NOT IN ('completed', 'canceled')`).all() as Array<{ issue_id: string }>).map(r => r.issue_id));
    const open = rows.filter(r => !CLOSED.has(r.type));
    return {
      since,
      completed: rows.filter(r => r.type === 'completed' && (r.completed_at ?? '') >= from).map(key),
      inProgress: open.filter(r => r.type === 'started' && r.state !== 'in review').map(key),
      inReview: open.filter(r => r.state === 'in review').map(key),
      blocked: open.filter(r => blocked.has(r.id)).map(key),
      filed: rows.filter(r => r.created_at >= from).map(key),
    };
  }
}

// ---------- pure helpers ----------
function mapThread(r: ThreadRow): WorkThread {
  return {
    id: r.id, issueId: r.issue_id, agentId: r.agent_id, personId: r.person_id, sessionKey: r.session_key || null, commentId: r.comment_id, branch: r.branch,
    progress: { did: r.did, left: r.left_text, blocked: r.blocked }, links: JSON.parse(r.links) as string[],
    state: r.status === 'finished' ? { status: 'finished', outcome: r.outcome as WorkOutcome, summary: r.summary!, finishedAt: r.finished_at! } : { status: 'active' },
    startedAt: r.started_at, updatedAt: r.updated_at,
  };
}
function mapDraft(r: DraftRow): ProjectUpdateDraft {
  return { projectId: r.project_id, personId: r.person_id, authorId: r.author_id, body: r.body, health: r.health, updatedAt: r.updated_at };
}

/** omitted keeps the last value, "" clears it */
export function mergeProgress(prev: ProgressFields, patch: ProgressPatch): ProgressFields {
  const pick = (k: keyof ProgressFields) => { const v = patch[k]; return v === undefined ? prev[k] : (v.trim() || null); };
  return { did: pick('did'), left: pick('left'), blocked: pick('blocked') };
}

/** "PR #12 (o/r)" for a GitHub pull request, else the URL */
export function linkTitle(url: string): string {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return m ? `PR #${m[2]} (${m[1]})` : url;
}

const section = (title: string, text: string | null) => text ? [`**${title}:** ${text}`] : [];
const linkList = (links: readonly string[]) => links.length ? [`**Links:** ${links.map(u => `[${linkTitle(u)}](${u})`).join(', ')}`] : [];

/** The living comment while the work goes on. Fixed headings, so a person scans it and the next
 *  session resumes from it. */
export function renderProgress(p: ProgressFields, links: readonly string[]): string {
  return ['**Progress**', ...section('Did', p.did), ...section('Left', p.left), ...section('Blocked', p.blocked), ...linkList(links)].join('\n\n');
}

export function renderFinal(outcome: WorkOutcome, summary: string, left: string | null, links: readonly string[]): string {
  return [`**${OUTCOME_HEADING[outcome]}**`, summary, ...section('Left', left), ...linkList(links)].join('\n\n');
}

/** the dedupe key for a follow-up title: case, punctuation and a leading "fix:" / "todo:" don't count */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/^\s*(fix|todo|bug|chore)\s*:\s*/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** one "**Completed:** CORE-1, CORE-2" line per group that has any */
export function composeDraft(f: DraftFacts): string {
  const groups = [['Completed', f.completed], ['In review', f.inReview], ['In progress', f.inProgress], ['Blocked', f.blocked], ['New', f.filed]] as const;
  const lines = groups.filter(([, keys]) => keys.length).map(([label, keys]) => `- **${label}:** ${keys.join(', ')}`);
  return [`Since ${f.since ? f.since.slice(0, 10) : 'the project started'}:`, ...(lines.length ? lines : ['- No issue changes.'])].join('\n');
}
