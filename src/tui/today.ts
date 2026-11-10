import { inboxRows, needsYou, visibleNotifications } from '../core/inbox.js';
import { mentionedIds } from '../core/mentions.js';
import type { Issue, Notification, NotificationType, PullRequest } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import { rankNextIssues, type NextWhy } from '../ops/index.js';
import type { TuiData } from './data.js';

export type NeedKind = 'review' | 'blocked' | 'mention' | 'pr' | 'ask' | 'triage';

export interface NeedRow {
  id: string;
  kind: NeedKind;
  issue: Issue | null;
  teamId: string | null;
  notificationIds: string[];
  reason: string;
  at: string;
  thread: WorkThread | null;
  commentId: string | null;
  actorId: string | null;
  text: string;
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

export function myThread(data: TuiData, issueId: string, threads?: readonly WorkThread[]): WorkThread | null {
  const me = data.currentUser.id;
  const all = threads ?? data.threads.get(issueId) ?? [];
  const mine = all.filter(t => t.personId === me && t.agentId !== me);
  const list = mine.length ? mine : all.filter(t => t.agentId !== t.personId);
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export function threadAsk(t: WorkThread | null): 'review' | 'blocked' | null {
  if (!t) return null;
  if (t.state.status === 'active') return t.progress.blocked ? 'blocked' : null;
  if (t.state.outcome === 'stopped') return 'blocked';
  return 'review';
}

export function agentAsk(data: TuiData, issue: Issue, threads?: readonly WorkThread[]): { ask: 'review' | 'blocked'; thread: WorkThread } | null {
  const thread = myThread(data, issue.id, threads);
  const ask = threadAsk(thread);
  if (!thread || !ask) return null;
  const st = data.stateById.get(issue.stateId);
  if (!st || st.type === 'completed' || st.type === 'canceled') return null;
  if (ask === 'blocked') return { ask, thread };
  const teamHasReview = data.states.some(x => x.teamId === issue.teamId && isReview(x));
  return isReview(st) || (!teamHasReview && st.type === 'started') ? { ask, thread } : null;
}
const isReview = (st: { type: string; name: string }) => st.type === 'started' && st.name.trim().toLowerCase() === 'in review';

const KIND_OF: Partial<Record<NotificationType, NeedKind>> = {
  agentBlocked: 'blocked', agentFinished: 'review', issueMentioned: 'mention', prActivity: 'pr',
};
const RANK: NeedKind[] = ['blocked', 'review', 'mention', 'pr', 'ask'];

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

export function needRows(data: TuiData, now: number): NeedRow[] {
  const asks = visibleNotifications(data.notifications, new Date(now).toISOString()).filter(n => !n.readAt && needsYou(n));
  const rows: NeedRow[] = [];
  for (const r of inboxRows(asks)) {
    const issue = r.lead.issueId ? data.issueById.get(r.lead.issueId) ?? null : null;
    if (r.lead.issueId && !issue) continue;
    const merged = asks.filter(n => r.ids.includes(n.id));
    const agent = issue ? agentAsk(data, issue) : null;
    const thread = agent?.thread ?? null;
    const fromThread = agent?.ask ?? null;
    const fromNotes = merged.map(n => KIND_OF[n.type] ?? 'ask').sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] ?? 'ask';
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

export const issueNeeds = (data: TuiData, now: number) => todayModel(data, now).needs.filter((r): r is NeedRow & { issue: Issue } => !!r.issue);

export interface Pane { id: string; at: string }

export function paneStarting(data: TuiData, issueId: string, pane: Pane | undefined): boolean {
  if (!pane) return false;
  const t = myThread(data, issueId);
  return !t || t.updatedAt < pane.at;
}

export function activeThread(data: TuiData, issueId: string): WorkThread | null {
  const t = myThread(data, issueId);
  return t && t.state.status === 'active' ? t : null;
}

export function flightRows(data: TuiData, needs: readonly NeedRow[]): FlightRow[] {
  const me = data.currentUser.id;
  const asked = new Set(needs.map(n => n.issue?.id).filter(Boolean));
  return data.issues.filter(i => i.assigneeId === me && stateType(data, i) === 'started' && !asked.has(i.id)).map(i => {
    const thread = activeThread(data, i.id);
    return { id: i.id, issue: i, thread, at: thread?.updatedAt ?? i.updatedAt };
  }).sort((a, b) => Number(!!b.thread) - Number(!!a.thread) || b.at.localeCompare(a.at));
}

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

export function nextRows(data: TuiData, needs: readonly NeedRow[], now: number, limit = NEXT_LIMIT): NextRow[] {
  const asked = new Set(needs.map(n => n.issue?.id).filter(Boolean));
  const ranked = rankNextIssues(data, { limit: 50, now: new Date(now).toISOString() }).issues;
  return ranked.filter(x => x.why !== 'in progress, yours' && !asked.has(x.issue.id)).slice(0, limit)
    .map(x => ({ id: x.issue.id, issue: x.issue, why: x.why, reason: nextReason(x.issue, x.why, data, now) }));
}

export function doneRows(data: TuiData, now: number): DoneRow[] {
  const me = data.currentUser.id;
  return data.issues.filter(i => i.assigneeId === me && ['completed', 'canceled'].includes(stateType(data, i) ?? ''))
    .map(i => ({ id: i.id, issue: i, at: i.completedAt ?? i.canceledAt ?? i.updatedAt }))
    .filter(r => now - Date.parse(r.at) < WEEK)
    .sort((a, b) => b.at.localeCompare(a.at));
}

const cache = new WeakMap<TuiData, { minute: number; model: TodayModel }>();

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

export function todayRows(m: TodayModel, doneOpen: boolean): TodayRow[] {
  return [
    ...m.needs.map(row => ({ kind: 'need' as const, id: row.id, row })),
    ...m.flight.map(row => ({ kind: 'flight' as const, id: row.id, row })),
    ...m.next.map(row => ({ kind: 'next' as const, id: row.id, row })),
    ...(m.done.length ? [{ kind: 'doneHeader' as const, id: DONE_GROUP, count: m.done.length, expanded: doneOpen }] : []),
    ...(doneOpen ? m.done.map(row => ({ kind: 'done' as const, id: row.id, row })) : []),
  ];
}

export function prOf(data: TuiData, issueId: string): PullRequest | null {
  const ids = new Set(data.issuePrs.filter(l => l.issueId === issueId && !l.dismissed).map(l => l.prId));
  const prs = data.pullRequests.filter(p => ids.has(p.id)).sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || b.updatedAt.localeCompare(a.updatedAt));
  return prs[0] ?? null;
}

export const commitCount = (data: TuiData, issueId: string) => data.issueCommits.filter(c => c.issueId === issueId).length;

export const followupsOf = (data: TuiData, issueId: string) => data.drafts.filter(d => d.kind === 'followup' && d.status === 'pending' && d.fromIssueId === issueId);
