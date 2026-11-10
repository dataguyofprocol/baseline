// What the TUI reads from a workspace: snapshot sections plus indexes built once per fetch.
import type { Baseline } from '../client/index.js';
import { needsYou } from '../core/inbox.js';
import { issueKey, type Issue, type Label, type Project, type Snapshot, type Team, type User, type WorkflowState } from '../core/types.js';
import type { AgentDraft, WorkThread } from '../core/work-types.js';

export const TUI_SECTIONS = [
  'workspace', 'teams', 'states', 'users', 'currentUser', 'issues', 'projects', 'labels',
  'comments', 'activity', 'notifications', 'cycles', 'milestones', 'locations',
  'relations', 'pullRequests', 'issuePrs', 'issueCommits',
] as const;

export type TuiSnapshot = Pick<Snapshot, typeof TUI_SECTIONS[number]>;

/** what the snapshot doesn't carry: agent work on the issues Today watches, and the person's follow-up drafts */
export interface TuiExtras {
  threads: ReadonlyMap<string, WorkThread[]>;
  drafts: AgentDraft[];
}

export interface TuiData extends TuiSnapshot, TuiExtras {
  stateById: ReadonlyMap<string, WorkflowState>;
  userById: ReadonlyMap<string, User>;
  teamById: ReadonlyMap<string, Team>;
  labelById: ReadonlyMap<string, Label>;
  projectById: ReadonlyMap<string, Project>;
  issueById: ReadonlyMap<string, Issue>;
  issuesByTeam: ReadonlyMap<string, Issue[]>;
  keyOf: (issue: Pick<Issue, 'teamId' | 'number'>) => string;
}

const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map(x => [x.id, x]));

const NO_EXTRAS: TuiExtras = { threads: new Map(), drafts: [] };

export function buildData(snap: TuiSnapshot & Partial<TuiExtras>): TuiData {
  const teams = [...snap.teams].sort((a, b) => a.position - b.position);
  const issues = snap.issues.filter(i => !i.archivedAt && !i.deletedAt);
  const issuesByTeam = new Map<string, Issue[]>();
  for (const i of issues) {
    const list = issuesByTeam.get(i.teamId);
    if (list) list.push(i); else issuesByTeam.set(i.teamId, [i]);
  }
  return {
    ...NO_EXTRAS,
    ...snap,
    teams,
    issues,
    stateById: byId(snap.states),
    userById: byId(snap.users),
    teamById: byId(teams),
    labelById: byId(snap.labels),
    projectById: byId(snap.projects),
    issueById: byId(issues),
    issuesByTeam,
    keyOf: i => issueKey(i, teams),
  };
}

/** the issues whose agent work Today shows: my started issues, and the issues of what needs me */
export function watchedIssueIds(snap: TuiSnapshot): string[] {
  const started = new Set(snap.states.filter(s => s.type === 'started').map(s => s.id));
  const ids = new Set<string>();
  for (const i of snap.issues) if (i.assigneeId === snap.currentUser.id && started.has(i.stateId) && !i.archivedAt && !i.deletedAt) ids.add(i.id);
  for (const n of snap.notifications) if (n.issueId && !n.readAt && needsYou(n)) ids.add(n.issueId);
  return [...ids];
}

/** the snapshot, plus agent threads and drafts; a key that can't read those still gets the rest */
export async function fetchData(bl: Baseline): Promise<TuiData> {
  const snap = await bl.snapshot(TUI_SECTIONS);
  const ids = watchedIssueIds(snap);
  const [threads, drafts] = await Promise.all([
    Promise.all(ids.map(async id => [id, await bl.workThreads(id).catch(() => [] as WorkThread[])] as const)),
    bl.drafts({ status: 'pending', kind: 'followup' }).catch(() => [] as AgentDraft[]),
  ]);
  return buildData({ ...snap, threads: new Map(threads), drafts });
}

/** the data with one issue changed locally, ahead of the server's answer */
export function patchIssue(data: TuiData, issueId: string, patch: Partial<Issue>): TuiData {
  return buildData({ ...data, issues: data.issues.map(i => (i.id === issueId ? { ...i, ...patch } : i)) });
}
