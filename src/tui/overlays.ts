// What each overlay lists: picker options, search results, new-issue field values. Pure.
import { PRIORITY_LABELS, type Issue, type Priority } from '../core/types.js';
import type { TuiData } from './data.js';
import { fuzzyFilter, type FuzzyMatch, type Seg } from './model.js';
import type { DraftField, IssueDraft, Overlay, PickerField, TuiState } from './state.js';
import { priorityMark, STATE_ICON, theme } from './theme.js';

export const NONE = '__none__';

export interface Option { id: string; label: string; icon?: Seg; hint?: string; current: boolean; search: string }

const PRIORITY_ORDER: Priority[] = [1, 2, 3, 4, 0];

export function pickerOptions(field: PickerField, issue: Issue | undefined, data: TuiData): Option[] {
  if (!issue) return [];
  switch (field) {
    case 'state':
      return data.states.filter(s => s.teamId === issue.teamId).sort((a, b) => a.position - b.position).map(s => ({
        id: s.id, label: s.name, icon: { text: STATE_ICON[s.type], color: s.color }, current: s.id === issue.stateId, search: s.name,
      }));
    case 'priority':
      return PRIORITY_ORDER.map(p => ({ id: String(p), label: PRIORITY_LABELS[p], icon: priorityMark(p), current: p === issue.priority, search: PRIORITY_LABELS[p] }));
    case 'assignee': {
      const me = data.currentUser;
      const others = data.users.filter(u => u.id !== me.id && u.status !== 'suspended')
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'human' ? -1 : 1));
      return [
        { id: me.id, label: 'Me', hint: me.name, icon: { text: '●', color: me.color }, current: issue.assigneeId === me.id, search: `me ${me.name}` },
        ...others.map(u => ({ id: u.id, label: u.name, hint: u.kind === 'agent' ? 'agent' : undefined, icon: { text: '●', color: u.color }, current: issue.assigneeId === u.id, search: u.name })),
        { id: NONE, label: 'No assignee', hint: 'unassign', icon: { text: '○', color: theme.muted }, current: !issue.assigneeId, search: 'unassign none no assignee' },
      ];
    }
    case 'labels':
      return data.labels.filter(l => l.teamId === issue.teamId).sort((a, b) => a.name.localeCompare(b.name)).map(l => ({
        id: l.id, label: l.name, icon: { text: '●', color: l.color }, current: issue.labelIds.includes(l.id), search: l.name,
      }));
    case 'project': {
      const closed = (s: string) => s === 'completed' || s === 'canceled';
      const projects = [...data.projects].sort((a, b) => Number(closed(a.status)) - Number(closed(b.status)) || a.position - b.position);
      return [
        { id: NONE, label: 'No project', icon: { text: '◇', color: theme.muted }, current: !issue.projectId, search: 'none no project' },
        ...projects.map(p => ({ id: p.id, label: p.name, hint: p.status, icon: { text: '◆', color: p.color }, current: issue.projectId === p.id, search: p.name })),
      ];
    }
  }
}

export function filteredOptions(o: Extract<Overlay, { kind: 'picker' }>, data: TuiData): Array<{ option: Option; match: FuzzyMatch }> {
  return fuzzyFilter(pickerOptions(o.field, data.issueById.get(o.issueId), data), o.query.value, x => x.search).map(({ item, match }) => ({ option: item, match }));
}

export const PICKER_TITLE: Record<PickerField, string> = { state: 'Status', priority: 'Priority', assignee: 'Assignee', labels: 'Labels', project: 'Project' };

// ---------- search ----------

export interface SearchResult { issue: Issue; key: string; match: FuzzyMatch }

export function searchResults(query: string, data: TuiData, limit = 50): SearchResult[] {
  const all = query.trim()
    ? fuzzyFilter(data.issues, query, i => `${data.keyOf(i)} ${i.title}`)
    : [...data.issues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => ({ item, match: { score: 0, indices: [] } }));
  return all.slice(0, limit).map(({ item, match }) => ({ issue: item, key: data.keyOf(item), match }));
}

// ---------- new issue ----------

export function defaultStateId(data: TuiData, teamId: string): string {
  const states = data.states.filter(s => s.teamId === teamId).sort((a, b) => a.position - b.position);
  return (states.find(s => s.type === 'unstarted') ?? states[0])?.id ?? '';
}

/** a new issue starts where you are: this team or project, assigned to you on My work so it shows up there */
export function newDraft(s: Pick<TuiState, 'route' | 'stack'>, data: TuiData): IssueDraft {
  const fromRoute = [s.route, ...[...s.stack].reverse()];
  const issueRoute = fromRoute.find(r => r.kind === 'issue');
  const viewed = issueRoute?.kind === 'issue' ? data.issueById.get(issueRoute.issueId) : undefined;
  const teamRoute = fromRoute.find(r => r.kind === 'team');
  const projectRoute = fromRoute.find(r => r.kind === 'project');
  const projectId = projectRoute?.kind === 'project' ? projectRoute.projectId : null;
  const project = projectId ? data.projectById.get(projectId) : undefined;
  const teamId = teamRoute?.kind === 'team' ? teamRoute.teamId : viewed?.teamId ?? project?.teamId ?? data.teams[0]?.id ?? '';
  const onMine = fromRoute.some(r => r.kind === 'my') && !teamRoute && !projectRoute;
  return { teamId, stateId: defaultStateId(data, teamId), priority: 0, assigneeId: onMine ? data.currentUser.id : null, projectId };
}

export interface DraftChoice { id: string; label: string; icon?: Seg }

export function draftChoices(field: Exclude<DraftField, 'title'>, draft: IssueDraft, data: TuiData): DraftChoice[] {
  switch (field) {
    case 'team': return data.teams.map(t => ({ id: t.id, label: `${t.name} (${t.key})`, icon: { text: '■', color: t.color } }));
    case 'state': return data.states.filter(st => st.teamId === draft.teamId).sort((a, b) => a.position - b.position)
      .map(st => ({ id: st.id, label: st.name, icon: { text: STATE_ICON[st.type], color: st.color } }));
    case 'priority': return PRIORITY_ORDER.map(p => ({ id: String(p), label: PRIORITY_LABELS[p], icon: priorityMark(p) }));
    case 'assignee': return [
      { id: NONE, label: 'No assignee', icon: { text: '○', color: theme.muted } },
      ...data.users.filter(u => u.status !== 'suspended').map(u => ({ id: u.id, label: u.id === data.currentUser.id ? `${u.name} (me)` : u.name, icon: { text: '●', color: u.color } })),
    ];
    case 'project': return [
      { id: NONE, label: 'No project', icon: { text: '◇', color: theme.muted } },
      ...data.projects.filter(p => p.status !== 'completed' && p.status !== 'canceled').map(p => ({ id: p.id, label: p.name, icon: { text: '◆', color: p.color } })),
    ];
  }
}

export function draftValue(field: Exclude<DraftField, 'title'>, draft: IssueDraft): string {
  switch (field) {
    case 'team': return draft.teamId;
    case 'state': return draft.stateId;
    case 'priority': return String(draft.priority);
    case 'assignee': return draft.assigneeId ?? NONE;
    case 'project': return draft.projectId ?? NONE;
  }
}

/** the draft with one field stepped to its next (or previous) value; a new team resets the state */
export function cycleDraft(field: Exclude<DraftField, 'title'>, draft: IssueDraft, delta: number, data: TuiData): Partial<IssueDraft> {
  const choices = draftChoices(field, draft, data);
  if (!choices.length) return {};
  const at = choices.findIndex(c => c.id === draftValue(field, draft));
  const next = choices[((at + delta) % choices.length + choices.length) % choices.length].id;
  switch (field) {
    case 'team': return { teamId: next, stateId: defaultStateId(data, next) };
    case 'state': return { stateId: next };
    case 'priority': return { priority: Number(next) as Priority };
    case 'assignee': return { assigneeId: next === NONE ? null : next };
    case 'project': return { projectId: next === NONE ? null : next };
  }
}
