import { useApp } from './store.js';
import { api } from './api.js';
import { playExit } from './motion.js';
import type { Issue } from '../../src/core/types.js';

/* Every issue mutation the UI makes goes through here, so each one:
   - lands optimistically (the snapshot changes before the request returns),
   - can be undone with ⌘Z (the inverse patch is recorded first),
   - refreshes from the server afterwards so derived data (activity, notifications) catches up. */

type IssuePatch = Partial<Pick<Issue, 'stateId' | 'priority' | 'assigneeId' | 'labelIds' | 'projectId' | 'milestoneId' | 'cycleId' | 'estimate' | 'dueDate' | 'parentId' | 'title' | 'description' | 'locationId'>>;

interface UndoEntry { label: string; revert: () => Promise<void> }
const undoStack: UndoEntry[] = [];
const UNDO_LIMIT = 50;

export function pushUndo(entry: UndoEntry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

/** ⌘Z: revert the most recent change made in this tab. The entry is only dropped once the
 *  revert worked, so a failed undo can be tried again. */
export async function undoLast() {
  const entry = undoStack[undoStack.length - 1];
  const s = useApp.getState();
  if (!entry) { s.toast({ title: 'Nothing to undo' }); return; }
  try { await entry.revert(); } finally { await s.bootstrap(); }
  const at = undoStack.lastIndexOf(entry);
  if (at >= 0) undoStack.splice(at, 1);
  s.toast({ title: `Undid: ${entry.label}` });
}

/** a toast's Undo button: run that entry's revert and take it off the ⌘Z stack, so a later ⌘Z
 *  undoes the change before it instead of replaying this one */
async function undoEntry(entry: UndoEntry) {
  await entry.revert();
  const at = undoStack.lastIndexOf(entry);
  if (at >= 0) undoStack.splice(at, 1);
  await useApp.getState().bootstrap();
}

function issuesById(ids: string[]): Issue[] {
  const snap = useApp.getState().snap;
  return ids.map(id => snap?.issues.find(i => i.id === id)).filter(Boolean) as Issue[];
}

function applyLocal(ids: string[], patchFor: (i: Issue) => Partial<Issue>) {
  const snap = useApp.getState().snap;
  if (!snap) return;
  const set = new Set(ids);
  useApp.setState({ snap: { ...snap, issues: snap.issues.map(i => set.has(i.id) ? { ...i, ...patchFor(i), updatedAt: new Date().toISOString() } : i) } });
}

const FIELD_LABELS: Record<string, string> = {
  stateId: 'status', priority: 'priority', assigneeId: 'assignee', labelIds: 'labels', projectId: 'project',
  milestoneId: 'milestone', cycleId: 'cycle', estimate: 'estimate', dueDate: 'due date', parentId: 'parent',
  title: 'title', description: 'description', locationId: 'location',
};

/** set the same properties on one or more issues */
export async function setIssueProps(ids: string[], patch: IssuePatch, opts: { undoable?: boolean } = {}) {
  const before = issuesById(ids);
  if (!before.length) return;
  const keys = Object.keys(patch) as Array<keyof IssuePatch>;
  if (opts.undoable !== false) {
    const prev = before.map(i => ({ id: i.id, patch: Object.fromEntries(keys.map(k => [k, i[k]])) }));
    pushUndo({
      label: `${keys.map(k => FIELD_LABELS[k] ?? k).join(', ')} change${before.length > 1 ? ` on ${before.length} issues` : ''}`,
      revert: async () => { for (const p of prev) await api.updateIssue(p.id, p.patch); },
    });
  }
  applyLocal(ids, () => patch);
  for (const i of before) await api.updateIssue(i.id, patch);
  await useApp.getState().bootstrap();
  if (patch.stateId) celebrateClosedMilestone(ids);
}

/* A word at the round numbers of the work you've closed: the 1st, 10th, 25th, 50th, 100th…
   Exact hits only, so a workspace that already had 4 done says nothing at the 5th. Remembered
   per browser, so undoing and redoing doesn't say it twice. */
const MILESTONES: Record<number, string> = {
  1: 'The first of many.', 10: 'Double digits. Nice rhythm.', 25: 'A quarter-century of done.',
  50: 'Halfway to a hundred.', 100: 'Triple digits. Take a bow.', 250: 'Still shipping.', 500: 'Five hundred. Legendary.', 1000: 'A thousand. Unreal.',
};
function celebrateClosedMilestone(ids: string[]) {
  const s = useApp.getState();
  const snap = s.snap;
  if (!snap) return;
  const me = snap.currentUser.id;
  const done = new Set(snap.states.filter(st => st.type === 'completed').map(st => st.id));
  if (!ids.some(id => { const i = snap.issues.find(x => x.id === id); return i && i.assigneeId === me && done.has(i.stateId); })) return;
  const count = snap.issues.filter(i => i.assigneeId === me && done.has(i.stateId) && !i.deletedAt).length;
  const line = MILESTONES[count];
  if (!line) return;
  const key = `baseline:closed-milestone:${me}`;
  try { if (Number(localStorage.getItem(key) ?? 0) >= count) return; localStorage.setItem(key, String(count)); } catch { /* still worth saying once */ }
  s.toast({ title: count === 1 ? 'Your first issue, closed' : `${count} issues closed`, line });
}

/** labels add/remove across issues: if every issue has the label it comes off all, otherwise it goes on all */
export async function toggleLabel(ids: string[], labelId: string) {
  const issues = issuesById(ids);
  const all = issues.every(i => i.labelIds.includes(labelId));
  const prev = issues.map(i => ({ id: i.id, labelIds: i.labelIds }));
  pushUndo({ label: 'labels change', revert: async () => { for (const p of prev) await api.updateIssue(p.id, { labelIds: p.labelIds }); } });
  const next = (i: Issue) => all ? i.labelIds.filter(l => l !== labelId) : [...new Set([...i.labelIds, labelId])];
  applyLocal(ids, i => ({ labelIds: next(i) }));
  for (const i of issues) await api.updateIssue(i.id, { labelIds: next(i) });
  await useApp.getState().bootstrap();
}

export async function assignToMe(ids: string[]) {
  const me = useApp.getState().snap?.currentUser.id;
  if (!me) return;
  const issues = issuesById(ids);
  // I on an issue that's already yours un-assigns it, like Linear
  const already = issues.every(i => i.assigneeId === me);
  await setIssueProps(ids, { assigneeId: already ? null : me });
}

function keyOf(i: Issue): string {
  const t = useApp.getState().snap?.teams.find(t2 => t2.id === i.teamId);
  return `${t?.key ?? 'ISS'}-${i.number}`;
}

function describe(issues: Issue[]): React.ReactNode {
  return issues.length === 1 ? <>{keyOf(issues[0])} — {issues[0].title}</> : <>{issues.length} issues</>;
}

export async function archiveIssues(ids: string[]) {
  const issues = issuesById(ids);
  if (!issues.length) return;
  await playExit(ids);
  for (const i of issues) await api.archiveIssue(i.id);
  const revert = async () => { for (const i of issues) await api.unarchiveIssue(i.id); };
  const entry: UndoEntry = { label: issues.length === 1 ? 'archive' : `archive of ${issues.length} issues`, revert };
  pushUndo(entry);
  const s = useApp.getState();
  await s.bootstrap();
  s.toast({
    title: issues.length === 1 ? 'Issue archived' : `${issues.length} issues archived`, line: describe(issues),
    actions: [{ label: 'Undo', onClick: () => undoEntry(entry) }],
  });
}

export async function deleteIssues(ids: string[]) {
  const issues = issuesById(ids);
  if (!issues.length) return;
  await playExit(ids);
  for (const i of issues) await api.deleteIssue(i.id);
  const revert = async () => { for (const i of issues) await api.restoreIssue(i.id); };
  const entry: UndoEntry = { label: issues.length === 1 ? 'delete' : `delete of ${issues.length} issues`, revert };
  pushUndo(entry);
  const s = useApp.getState();
  await s.bootstrap();
  s.toast({
    title: issues.length === 1 ? 'Issue moved to trash' : `${issues.length} issues moved to trash`, line: describe(issues),
    actions: [{ label: 'Undo', onClick: () => undoEntry(entry) }],
  });
}

export async function toggleSubscription(issueId: string) {
  const s = useApp.getState();
  const me = s.snap?.currentUser.id;
  if (!me) return;
  const on = !!s.snap?.subscriptions.some(x => x.issueId === issueId && x.userId === me);
  const snap = s.snap!;
  useApp.setState({ snap: { ...snap, subscriptions: on ? snap.subscriptions.filter(x => !(x.issueId === issueId && x.userId === me)) : [...snap.subscriptions, { issueId, userId: me }] } });
  await api.setSubscribed(issueId, !on);
  await s.bootstrap();
  s.toast({ title: on ? 'Unsubscribed' : 'Subscribed', line: on ? 'You won’t be notified about this issue' : 'You’ll be notified about updates to this issue' });
}

export async function toggleFavoriteIssue(issueId: string) {
  const s = useApp.getState();
  const was = !!s.snap?.favorites.some(f => f.type === 'issue' && f.refId === issueId);
  await api.toggleFavorite('issue', issueId);
  await s.bootstrap();
  s.toast({ title: was ? 'Removed from favorites' : 'Added to favorites' });
}

export async function moveIssueToTeam(issueId: string, teamId: string, navigate?: (to: string) => void) {
  const s = useApp.getState();
  const issue = s.snap?.issues.find(i => i.id === issueId);
  if (!issue || issue.teamId === teamId) return;
  const fromKey = keyOf(issue);
  const fromTeam = issue.teamId;
  const { issue: moved } = await api.moveIssueToTeam(issueId, teamId);
  pushUndo({ label: 'team move', revert: async () => { await api.moveIssueToTeam(issueId, fromTeam); } });
  await s.bootstrap();
  const toKey = keyOf(moved);
  s.toast({ title: 'Issue moved', line: <>{fromKey} is now {toKey}</> });
  if (navigate && location.hash.includes(`/issue/${fromKey}`)) navigate(`/issue/${toKey}`);
}

/** cancel the issue and link it to the one it repeats */
export async function markDuplicate(issueId: string, ofIssueId: string) {
  const s = useApp.getState();
  const issue = s.snap?.issues.find(i => i.id === issueId);
  if (!issue) return;
  const canceled = s.snap!.states.find(st => st.teamId === issue.teamId && st.type === 'canceled');
  await api.addRelation(issueId, ofIssueId, 'duplicate');
  if (canceled) await api.updateIssue(issueId, { stateId: canceled.id });
  await s.bootstrap();
  const of = s.snap!.issues.find(i => i.id === ofIssueId);
  s.toast({ title: 'Marked as duplicate', line: of ? <>of {keyOf(of)} — {of.title}</> : undefined });
}

/** turn an issue into a project (its sub-issues come along as the project's issues) */
export async function convertToProject(issueId: string, navigate?: (to: string) => void) {
  const s = useApp.getState();
  const issue = s.snap?.issues.find(i => i.id === issueId);
  if (!issue) return;
  const { project, moved } = await api.convertToProject(issueId);
  const revert = async () => {
    await api.unarchiveIssue(issueId);
    for (const id of moved) await api.updateIssue(id, { parentId: issueId });
    await api.deleteProject(project.id);
  };
  const entry: UndoEntry = { label: 'convert to project', revert };
  pushUndo(entry);
  await s.bootstrap();
  s.toast({
    title: 'Converted to project', line: <>{project.name}{moved.length ? ` · ${moved.length} sub-issue${moved.length === 1 ? '' : 's'} moved in` : ''}</>,
    actions: [{ label: 'Undo', onClick: () => undoEntry(entry) }],
  });
  navigate?.(`/projects/${project.id}`);
}

/** save an issue's title and description as a team issue template */
export async function convertToTemplate(issueId: string) {
  const s = useApp.getState();
  const issue = s.snap?.issues.find(i => i.id === issueId);
  if (!issue) return;
  await api.createTemplate({ teamId: issue.teamId, name: issue.title, title: issue.title, description: issue.description });
  await s.bootstrap();
  s.toast({ title: 'Template created', line: <>{issue.title}</>, link: { label: 'Open templates', to: '/settings/templates' } });
}

export const CADENCE_LABELS = { daily: 'Every day', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' } as const;

/** file a copy of this issue again on a cadence; this issue counts as the first one */
export async function makeRecurring(issueId: string, cadence: keyof typeof CADENCE_LABELS) {
  const s = useApp.getState();
  const issue = s.snap?.issues.find(i => i.id === issueId);
  if (!issue) return;
  await api.createRecurring({
    teamId: issue.teamId, title: issue.title, description: issue.description, priority: issue.priority,
    assigneeId: issue.assigneeId, labelIds: issue.labelIds, projectId: issue.projectId, cadence,
  });
  await s.bootstrap();
  const team = s.snap?.teams.find(t => t.id === issue.teamId);
  s.toast({ title: 'Recurring issue set up', line: <>{CADENCE_LABELS[cadence]} — {issue.title}</>, link: team ? { label: 'Manage', to: `/settings/team/${team.key}` } : undefined });
}

/* Triage decisions, shared by the Triage page and the banner on a triaged issue so both land the
   issue in the same place. Accept sends it to the team's first Backlog state (the queue sits
   "before the backlog"), falling back to its first Todo state; Decline cancels it. */
function firstState(teamId: string, types: string[]) {
  const states = useApp.getState().snap?.states ?? [];
  for (const type of types) {
    const s = states.filter(x => x.teamId === teamId && x.type === type).sort((a, b) => a.position - b.position)[0];
    if (s) return s;
  }
  return undefined;
}
export async function triageDecide(issue: Issue, decision: 'accept' | 'decline') {
  const s = firstState(issue.teamId, decision === 'accept' ? ['backlog', 'unstarted'] : ['canceled']);
  const toast = useApp.getState().toast;
  if (!s) { toast({ title: decision === 'accept' ? 'This team has no Backlog or Todo state to accept into' : 'This team has no Canceled state', line: 'Add one in team settings › Issue statuses.' }); return; }
  await setIssueProps([issue.id], { stateId: s.id });
  toast({ title: decision === 'accept' ? `Accepted into ${s.name}` : 'Declined', line: issue.title });
}
