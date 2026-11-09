// What the TUI reads from a workspace: snapshot sections plus indexes built once per fetch.
import type { Baseline } from '../client/index.js';
import { issueKey, type Issue, type Label, type Project, type Snapshot, type Team, type User, type WorkflowState } from '../core/types.js';

export const TUI_SECTIONS = [
  'workspace', 'teams', 'states', 'users', 'currentUser', 'issues', 'projects', 'labels',
  'comments', 'activity', 'notifications', 'cycles', 'milestones', 'locations',
] as const;

export type TuiSnapshot = Pick<Snapshot, typeof TUI_SECTIONS[number]>;

export interface TuiData extends TuiSnapshot {
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

export function buildData(snap: TuiSnapshot): TuiData {
  const teams = [...snap.teams].sort((a, b) => a.position - b.position);
  const issues = snap.issues.filter(i => !i.archivedAt && !i.deletedAt);
  const issuesByTeam = new Map<string, Issue[]>();
  for (const i of issues) {
    const list = issuesByTeam.get(i.teamId);
    if (list) list.push(i); else issuesByTeam.set(i.teamId, [i]);
  }
  return {
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

export async function fetchData(bl: Baseline): Promise<TuiData> {
  return buildData(await bl.snapshot(TUI_SECTIONS));
}

/** the data with one issue changed locally, ahead of the server's answer */
export function patchIssue(data: TuiData, issueId: string, patch: Partial<Issue>): TuiData {
  return buildData({ ...data, issues: data.issues.map(i => (i.id === issueId ? { ...i, ...patch } : i)) });
}
