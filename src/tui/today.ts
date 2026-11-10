// Today: what needs you, what is in flight and what to start next, across every team you're on. Pure:
// computed from TuiData, so the screen, the reducer's auto-advance and the tests read the same rows.
import { inboxRows, needsYou, visibleNotifications } from '../core/inbox.js';
import { mentionedIds } from '../core/mentions.js';
import type { Issue, Notification, NotificationType, PullRequest } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import { rankNextIssues, type NextWhy } from '../ops/index.js';
import type { TuiData } from './data.js';

/** review: an agent finished for you; blocked: it stopped on a question; mention, pr (a review asked of you),
 *  ask (a reply, reminder, SLA or access request); triage: a team you lead has issues waiting */
export type NeedKind = 'review' | 'blocked' | 'mention' | 'pr' | 'ask' | 'triage';

export interface NeedRow {
  /** the issue id; `triage:<teamId>`, or `n:<notificationId>` for an ask about no issue */
  id: string;
  kind: NeedKind;
  issue: Issue | null;
  teamId: string | null;
  /** every unread notification the row stands for: acting on the row marks them all read */
  notificationIds: string[];
  /** the short word after the title: review, blocked, Ada, PR review… */
  reason: string;
  /** when it started waiting on you (the newest notification) */
  at: string;
  /** the agent's work behind a review or blocked row */
  thread: WorkThread | null;
  /** for a mention: the comment that mentions you, when there is one to reply to */
  commentId: string | null;
  actorId: string | null;
  /** the subject when there is no issue */
  text: string;
  /** triage rows: how many wait */
  count: number;
}

export interface FlightRow { id: string; issue: Issue; thread: WorkThread | null; at: string }
export interface NextRow { id: string; issue: Issue; reason: string; why: NextWhy }
export interface DoneRow { id: string; issue: Issue; at: string }

export interface TodayModel { needs: NeedRow[]; flight: FlightRow[]; next: NextRow[]; done: DoneRow[] }

export const DONE_GROUP = 'group:done';
export const NEXT_LIMIT = 3;
const WEEK = 7 * 86_400_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const stateType = (data: TuiData, i: Issue) => data.stateById.get(i.stateId)?.type;
const firstName = (data: TuiData, id: string | null) => (id ? data.userById.get(id)?.name.split(/\s+/)[0] : undefined) ?? 'Someone';

/** the latest agent thread on an issue that is for me (or about my issue) */
export function myThread(data: TuiData, issueId: string): WorkThread | null {
  const me = data.currentUser.id;
  const all = data.threads.get(issueId) ?? [];
  const mine = all.filter(t => t.personId === me && t.agentId !== me);
  const list = mine.length ? mine : all.filter(t => t.agentId !== t.personId);
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

/** what the agent's latest work asks of you: blocked on a question, finished for review, or nothing */
export function threadAsk(t: WorkThread | null): 'review' | 'blocked' | null {
  if (!t) return null;
  if (t.state.status === 'active') return t.progress.blocked ? 'blocked' : null;
  if (t.state.outcome === 'stopped') return 'blocked';
  return 'review';
}

const KIND_OF: Partial<Record<NotificationType, NeedKind>> = {
  agentBlocked: 'blocked', agentFinished: 'review', issueMentioned: 'mention', prActivity: 'pr',
};
const RANK: NeedKind[] = ['blocked', 'review', 'mention', 'pr', 'ask'];

/** the newest comment on an issue that mentions me */
export function mentionComment(data: TuiData, issueId: string): string | null {
  const me = data.currentUser.id;
  const list = data.comments.filter(c => c.issueId === issueId && c.userId !== me && mentionedIds(c.body, data.users).includes(me))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list[0]?.id ?? null;
}

function reasonFor(kind: NeedKind, n: Notification, data: TuiData): string {
  switch (kind) {
    case 'review': return 'review';
    case 'blocked': return 'blocked';
    case 'mention': return firstName(data, n.actorId);
    case 'pr': return 'PR review';
    case 'triage': return 'triage';
    case 'ask':
      return n.type === 'issueReplied' ? `${firstName(data, n.actorId)} replied` : n.type === 'issueReminder' ? 'reminder'
        : n.type === 'slaBreached' ? 'SLA' : n.type === 'accessRequested' ? 'access' : 'needs you';
  }
}

/** the teams I lead (a team with no leads is led by the admins) and how many of their issues wait in Triage */
function triageRows(data: TuiData): NeedRow[] {
  const me = data.currentUser;
  return data.teams.filter(t => t.triageEnabled && (t.leadIds.includes(me.id) || (!t.leadIds.length && me.admin))).flatMap(t => {
    const triage = new Set(data.states.filter(s => s.teamId === t.id && s.type === 'triage').map(s => s.id));
    const waiting = (data.issuesByTeam.get(t.id) ?? []).filter(i => triage.has(i.stateId));
    if (!waiting.length) return [];
    const at = waiting.map(i => i.createdAt).sort().reverse()[0]!;
    return [{ id: `triage:${t.id}`, kind: 'triage' as const, issue: null, teamId: t.id, notificationIds: [], reason: 'triage', at, thread: null, commentId: null, actorId: null, text: `${waiting.length} to triage in ${t.name}`, count: waiting.length }];
  });
}

/** Needs you: one row per issue, newest first, from the notifications that ask something of you (the web's
 *  My work rule), then a row per team you lead with Triage waiting */
export function needRows(data: TuiData, now: number): NeedRow[] {
  const asks = visibleNotifications(data.notifications, new Date(now).toISOString()).filter(n => !n.readAt && needsYou(n));
  const rows: NeedRow[] = [];
  for (const r of inboxRows(asks)) {
    const issue = r.lead.issueId ? data.issueById.get(r.lead.issueId) ?? null : null;
    // a notification about an issue that is gone (archived, deleted) waits on nothing
    if (r.lead.issueId && !issue) continue;
    const merged = asks.filter(n => r.ids.includes(n.id));
    const thread = issue ? myThread(data, issue.id) : null;
    const fromThread = threadAsk(thread);
    const fromNotes = merged.map(n => KIND_OF[n.type] ?? 'ask').sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] ?? 'ask';
    // the agent's latest state wins over an older notification about it (blocked, then answered and finished)
    const kind: NeedKind = fromThread && (fromNotes === 'review' || fromNotes === 'blocked') ? fromThread : fromNotes;
    const lead = merged.find(n => KIND_OF[n.type] === kind) ?? r.lead;
    rows.push({
      id: issue?.id ?? `n:${r.lead.id}`, kind, issue, teamId: issue?.teamId ?? null, notificationIds: r.ids, reason: reasonFor(kind, lead, data),
      at: r.lead.createdAt, thread: kind === 'review' || kind === 'blocked' ? thread : null,
      commentId: kind === 'mention' && issue ? mentionComment(data, issue.id) : null, actorId: lead.actorId,
      text: issue?.title ?? lead.body.replace(/^[^|]*\|/, ''), count: 1,
    });
  }
  return [...rows, ...triageRows(data)];
}

/** the Needs you rows the issue page can open: the ones about an issue */
export const issueNeeds = (data: TuiData, now: number) => todayModel(data, now).needs.filter((r): r is NeedRow & { issue: Issue } => !!r.issue);

/** the open agent thread on an issue (the agent is working on it now) */
export function activeThread(data: TuiData, issueId: string): WorkThread | null {
  const t = myThread(data, issueId);
  return t && t.state.status === 'active' ? t : null;
}

/** In flight: my started issues, without the ones already in Needs you; agent work first, then by recency */
export function flightRows(data: TuiData, needs: readonly NeedRow[]): FlightRow[] {
  const me = data.currentUser.id;
  const asked = new Set(needs.map(n => n.issue?.id).filter(Boolean));
  return data.issues.filter(i => i.assigneeId === me && stateType(data, i) === 'started' && !asked.has(i.id)).map(i => {
    const thread = activeThread(data, i.id);
    return { id: i.id, issue: i, thread, at: thread?.updatedAt ?? i.updatedAt };
  }).sort((a, b) => Number(!!b.thread) - Number(!!a.thread) || b.at.localeCompare(a.at));
}

/** "due Thu" within the week, "due today", "overdue"; null further out */
export function dueSoon(due: string | null, now: number): string | null {
  if (!due) return null;
  const [y, m, d] = due.slice(0, 10).split('-').map(Number);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const day = new Date(y!, m! - 1, d!);
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return days < 7 ? `due ${DAYS[day.getDay()]}` : null;
}

/** why an issue is up next, in a few words: a due date, an issue waiting on it, the cycle, else next_issue's own reason */
export function nextReason(i: Issue, why: NextWhy, data: TuiData, now: number): string {
  const due = dueSoon(i.dueDate, now);
  if (due) return due;
  const open = (id: string) => { const x = data.issueById.get(id); return x && !['completed', 'canceled'].includes(stateType(data, x) ?? '') ? x : undefined; };
  const waits = data.relations.flatMap(r => (r.type === 'blocks' && r.issueId === i.id ? [open(r.relatedIssueId)] : r.type === 'blocked_by' && r.relatedIssueId === i.id ? [open(r.issueId)] : []))
    .filter((x): x is Issue => !!x);
  if (waits[0]) return `blocks ${data.keyOf(waits[0])}`;
  const nowIso = new Date(now).toISOString();
  const cycle = i.cycleId ? data.cycles.find(c => c.id === i.cycleId) : undefined;
  if (cycle && !cycle.completedAt && cycle.startsAt <= nowIso && nowIso < cycle.endsAt) return why === 'current cycle, unassigned' ? 'in this cycle, unassigned' : 'in this cycle';
  return why === 'Todo, yours' ? 'Todo' : 'unassigned';
}

/** Up next: next_issue's ranking (the same function the op runs), without what is already started or needs you */
export function nextRows(data: TuiData, needs: readonly NeedRow[], now: number, limit = NEXT_LIMIT): NextRow[] {
  const asked = new Set(needs.map(n => n.issue?.id).filter(Boolean));
  const ranked = rankNextIssues(data, { limit: 50, now: new Date(now).toISOString() }).issues;
  return ranked.filter(x => x.why !== 'in progress, yours' && !asked.has(x.issue.id)).slice(0, limit)
    .map(x => ({ id: x.issue.id, issue: x.issue, why: x.why, reason: nextReason(x.issue, x.why, data, now) }));
}

/** Done this week: what I closed in the last seven days, newest first */
export function doneRows(data: TuiData, now: number): DoneRow[] {
  const me = data.currentUser.id;
  return data.issues.filter(i => i.assigneeId === me && ['completed', 'canceled'].includes(stateType(data, i) ?? ''))
    .map(i => ({ id: i.id, issue: i, at: i.completedAt ?? i.canceledAt ?? i.updatedAt }))
    .filter(r => now - Date.parse(r.at) < WEEK)
    .sort((a, b) => b.at.localeCompare(a.at));
}

const cache = new WeakMap<TuiData, { minute: number; model: TodayModel }>();

/** the model for this data, worked out once a minute per fetch (the tabs, the cursor and the screen all ask) */
export function todayModel(data: TuiData, now: number): TodayModel {
  const minute = Math.floor(now / 60_000);
  const hit = cache.get(data);
  if (hit && hit.minute === minute) return hit.model;
  const needs = needRows(data, now);
  const model = { needs, flight: flightRows(data, needs), next: nextRows(data, needs, now), done: doneRows(data, now) };
  cache.set(data, { minute, model });
  return model;
}

export type TodayRow =
  | { kind: 'need'; id: string; row: NeedRow }
  | { kind: 'flight'; id: string; row: FlightRow }
  | { kind: 'next'; id: string; row: NextRow }
  | { kind: 'doneHeader'; id: string; count: number; expanded: boolean }
  | { kind: 'done'; id: string; row: DoneRow };

/** every row the cursor can rest on, top to bottom; ids are issue ids, so the cursor follows an issue across a refetch */
export function todayRows(m: TodayModel, doneOpen: boolean): TodayRow[] {
  return [
    ...m.needs.map(row => ({ kind: 'need' as const, id: row.id, row })),
    ...m.flight.map(row => ({ kind: 'flight' as const, id: row.id, row })),
    ...m.next.map(row => ({ kind: 'next' as const, id: row.id, row })),
    ...(m.done.length ? [{ kind: 'doneHeader' as const, id: DONE_GROUP, count: m.done.length, expanded: doneOpen }] : []),
    ...(doneOpen ? m.done.map(row => ({ kind: 'done' as const, id: row.id, row })) : []),
  ];
}

/** the PR linked to an issue: an open one first, else the newest */
export function prOf(data: TuiData, issueId: string): PullRequest | null {
  const ids = new Set(data.issuePrs.filter(l => l.issueId === issueId && !l.dismissed).map(l => l.prId));
  const prs = data.pullRequests.filter(p => ids.has(p.id)).sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || b.updatedAt.localeCompare(a.updatedAt));
  return prs[0] ?? null;
}

export const commitCount = (data: TuiData, issueId: string) => data.issueCommits.filter(c => c.issueId === issueId).length;

/** pending follow-up drafts an agent noted while working on this issue */
export const followupsOf = (data: TuiData, issueId: string) => data.drafts.filter(d => d.kind === 'followup' && d.status === 'pending' && d.fromIssueId === issueId);
