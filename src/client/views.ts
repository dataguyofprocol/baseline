import { issueKey, PRIORITY_SHORT, type Issue, type RelationType, type Snapshot, type SnapshotSection } from '../core/types.js';

export const ISSUE_JSON_SECTIONS = ['teams', 'states', 'users', 'projects', 'labels', 'locations', 'cycles', 'milestones'] as const satisfies readonly SnapshotSection[];
export const ISSUE_DETAIL_SECTIONS = [...ISSUE_JSON_SECTIONS, 'comments', 'subscriptions', 'attachments', 'activity', 'issues', 'relations'] as const satisfies readonly SnapshotSection[];
export type IssueJsonContext = Pick<Snapshot, typeof ISSUE_JSON_SECTIONS[number]>;
export type IssueDetailContext = Pick<Snapshot, typeof ISSUE_DETAIL_SECTIONS[number]>;

export type IssueIndex = ReadonlyMap<string, Issue>;

export const nameOf = (snap: Pick<Snapshot, 'users'>, userId: string | null): string | null =>
  userId ? snap.users.find(u => u.id === userId)?.name ?? null : null;

export const byline = (snap: Pick<Snapshot, 'users'>, w: { userId: string; viaUserId: string | null }): string => {
  const via = nameOf(snap, w.viaUserId);
  return `${snap.users.find(u => u.id === w.userId)?.name ?? '?'}${via ? ` via ${via}` : ''}`;
};

export function invertRelation(t: RelationType): RelationType {
  return t === 'blocks' ? 'blocked_by' : t === 'blocked_by' ? 'blocks' : t;
}

export function relationRows(snap: Pick<Snapshot, 'relations'>, issueId: string) {
  return snap.relations.filter(r => r.issueId === issueId || r.relatedIssueId === issueId);
}

export function issueJson(i: Issue, snap: IssueJsonContext, index: IssueIndex) {
  return {
    key: issueKey(i, snap.teams), id: i.id, title: i.title, description: i.description,
    state: snap.states.find(s => s.id === i.stateId)?.name ?? null,
    priority: PRIORITY_SHORT[i.priority], assignee: snap.users.find(u => u.id === i.assigneeId)?.name ?? null,
    project: snap.projects.find(p => p.id === i.projectId)?.name ?? null,
    labels: i.labelIds.map(id => snap.labels.find(l => l.id === id)?.name ?? id),
    parentId: i.parentId ? issueKey(index.get(i.parentId)!, snap.teams) : null,
    location: (() => { const l = snap.locations.find(x => x.id === i.locationId); return l ? { name: l.name, path: l.path } : null; })(),
    estimate: i.estimate, dueDate: i.dueDate,
    cycle: (() => { const c = snap.cycles.find(x => x.id === i.cycleId); return c ? c.number : null; })(),
    milestone: snap.milestones.find(m => m.id === i.milestoneId)?.name ?? null,
    creator: snap.users.find(u => u.id === i.creatorId)?.name ?? null,
    createdAt: i.createdAt, updatedAt: i.updatedAt,
    completedAt: i.completedAt, archivedAt: i.archivedAt,
  };
}

export function issueDetail(i: Issue, snap: IssueDetailContext, index: IssueIndex) {
  const comments = snap.comments.filter(c => c.issueId === i.id)
    .map(c => ({ id: c.id, replyTo: c.parentId, author: snap.users.find(u => u.id === c.userId)?.name ?? null, via: nameOf(snap, c.viaUserId), viaUserId: c.viaUserId, body: c.body, createdAt: c.createdAt, editedAt: c.editedAt, reactions: c.reactions, resolvedAt: c.resolvedAt }));
  const subscribers = snap.subscriptions.filter(x => x.issueId === i.id).map(x => snap.users.find(u => u.id === x.userId)?.name ?? x.userId);
  const links = snap.attachments.filter(a => a.issueId === i.id).map(a => ({ kind: a.kind, title: a.title, url: a.url }));
  const activity = snap.activity.filter(a => a.issueId === i.id).reverse().map(a => ({ type: a.type, data: a.data, user: snap.users.find(u => u.id === a.userId)?.name ?? null, via: nameOf(snap, a.viaUserId), viaUserId: a.viaUserId, createdAt: a.createdAt }));
  const children = snap.issues.filter(x => x.parentId === i.id).map(c => issueKey(c, snap.teams));
  const relations = relationRows(snap, i.id).map(r => ({
    type: r.issueId === i.id ? r.type : invertRelation(r.type),
    issue: (() => { const o = snap.issues.find(x => x.id === (r.issueId === i.id ? r.relatedIssueId : r.issueId)); return o ? issueKey(o, snap.teams) : null; })(),
  }));
  return { ...issueJson(i, snap, index), comments, activity, subIssues: children, relations, subscribers, links };
}
