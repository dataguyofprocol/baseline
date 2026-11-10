// What `/` offers for a query: things to do with the issue under the cursor, view changes, and issues.
// Every query word has to start a word of a result, so "done" finds "Move CORE-4 to Done" and
// "assign ada" finds "Assign CORE-4 to Ada Osei". Pure.
import { PRIORITY_LABELS, STATE_TYPE_LABELS, type Issue, type Priority } from '../core/types.js';
import type { TuiData } from './data.js';
import type { FieldId } from './detail.js';
import { directBinding, type CommandId } from './keys.js';
import { MENUS, rowLabel, type MenuCtx } from './menus.js';
import { allTabs, GROUP_BYS, GROUP_MODES, isListRoute, PRESET_LABEL, PRESETS, type GroupBy, type Preset } from './model.js';
import type { Route, TuiState } from './state.js';

export type FindRun =
  | { command: CommandId }
  | { change: { field: FieldId; patch: Partial<Issue> } }
  | { create: string }
  | { route: Route }
  | { view: { groupBy?: GroupBy; preset?: Preset } }
  | { markAllRead: true };

export interface FindItem {
  id: string;
  label: string;
  /** the key that does the same from the list ("s", or "w h" through a submenu) */
  key?: string;
  /** a dim note after the label */
  detail?: string;
  run: FindRun;
  /** set on issue results */
  issue?: Issue;
  /** the agent preview shows under the panel while this row is selected */
  agent?: boolean;
  /** what the query words are matched against */
  search: string;
}

export interface FindSection { title: string; items: FindItem[] }

/** shown under an empty prompt, as things to type */
export const FIND_SUGGESTIONS = ['done', 'assign …', 'agent', 'new …'];

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** how well `query` matches `text`: null unless every query word starts a word of the text; whole words and early words score higher */
export function wordMatch(query: string, text: string): number | null {
  const q = words(query);
  if (!q.length) return 0;
  const t = words(text);
  let score = 0;
  for (const w of q) {
    const at = t.findIndex(x => x.startsWith(w));
    if (at < 0) return null;
    score += (t[at] === w ? 3 : 1) + 1 / (1 + at);
  }
  return score;
}

const keyText = (c: CommandId) => directBinding(c)?.keys[0];

function issueActions(issue: Issue, data: TuiData, mc: MenuCtx | undefined): FindItem[] {
  const key = data.keyOf(issue);
  const out: FindItem[] = [];
  const change = (id: string, label: string, search: string, cmd: CommandId, field: FieldId, patch: Partial<Issue>, detail?: string) =>
    out.push({ id, label, search: `${label.replace(key, '')} ${search}`, key: keyText(cmd), run: { change: { field, patch } }, detail });

  for (const st of data.states.filter(x => x.teamId === issue.teamId && x.id !== issue.stateId).sort((a, b) => a.position - b.position)) {
    change(`state:${st.id}`, `Move ${key} to ${st.name}`, `status ${STATE_TYPE_LABELS[st.type]}`, 'setState', 'state', { stateId: st.id });
  }
  const me = data.currentUser;
  if (issue.assigneeId !== me.id) change('assign:me', `Assign ${key} to me`, `assignee mine ${me.name}`, 'setAssignee', 'assignee', { assigneeId: me.id });
  for (const u of data.users.filter(x => x.id !== me.id && x.id !== issue.assigneeId && x.status !== 'suspended')) {
    change(`assign:${u.id}`, `Assign ${key} to ${u.name}`, `assignee ${u.kind === 'agent' ? 'agent' : ''}`, 'setAssignee', 'assignee', { assigneeId: u.id });
  }
  if (issue.assigneeId) change('assign:none', `Unassign ${key}`, 'assign assignee none remove nobody', 'setAssignee', 'assignee', { assigneeId: null });
  for (const p of [1, 2, 3, 4, 0] as Priority[]) {
    if (p !== issue.priority) change(`priority:${p}`, `Set ${key} priority to ${PRIORITY_LABELS[p]}`, '', 'setPriority', 'priority', { priority: p });
  }
  for (const l of data.labels.filter(x => x.teamId === issue.teamId)) {
    const on = issue.labelIds.includes(l.id);
    change(`label:${l.id}`, on ? `Remove label ${l.name} from ${key}` : `Add label ${l.name} to ${key}`, 'labels tag', 'setLabels', 'labels',
      { labelIds: on ? issue.labelIds.filter(x => x !== l.id) : [...issue.labelIds, l.id] });
  }
  for (const p of data.projects.filter(x => x.id !== issue.projectId && x.status !== 'completed' && x.status !== 'canceled')) {
    out.push({ id: `project:${p.id}`, label: `Move ${key} to project ${p.name}`, search: `Move to project ${p.name}`, run: { change: { field: 'project', patch: { projectId: p.id } } } });
  }
  if (issue.projectId) out.push({ id: 'project:none', label: `Remove ${key} from its project`, search: 'project remove none', run: { change: { field: 'project', patch: { projectId: null } } } });

  out.push({ id: 'comment', label: `Comment on ${key}`, search: 'comment reply note', key: keyText('comment'), run: { command: 'comment' } });
  out.push({ id: 'title', label: `Rename ${key}`, search: 'rename edit title', key: 'e t', run: { command: 'editTitle' } });
  out.push({ id: 'description', label: `Edit ${key}'s description`, search: 'edit description editor', key: 'e d', run: { command: 'editDescription' } });
  if (mc) {
    for (const r of MENUS.agent.rows) {
      const ok = r.enabled?.(mc) ?? true;
      out.push({ id: `agent:${r.key}`, label: rowLabel(r, mc), search: `agent claude work ${rowLabel(r, mc)}`, key: `w ${r.key}`, run: { command: r.command },
        detail: ok === true ? undefined : 'needs tmux', agent: r.command === 'agentHere' });
    }
    for (const r of MENUS.copy.rows) if (r.command !== 'copyBranch') out.push({ id: `copy:${r.key}`, label: rowLabel(r, mc), search: `${rowLabel(r, mc)} copy clipboard`, key: `c ${r.key}`, run: { command: r.command } });
  }
  out.push({ id: 'browser', label: `Open ${key} in the browser`, search: 'open browser web', key: keyText('openBrowser'), run: { command: 'openBrowser' } });
  return out;
}

function viewActions(s: Pick<TuiState, 'route' | 'groupBy' | 'preset'>, data: TuiData, now: number): FindItem[] {
  const out: FindItem[] = [];
  if (isListRoute(s.route)) {
    for (const g of GROUP_BYS) if (g !== s.groupBy) out.push({ id: `group:${g}`, label: g === 'none' ? 'No grouping' : `Group ${GROUP_MODES[g].label}`, search: `group by ${g} view none`, run: { view: { groupBy: g } } });
    for (const p of PRESETS) if (p !== s.preset) out.push({ id: `show:${p}`, label: `Show ${PRESET_LABEL[p].toLowerCase()} issues`, search: `show ${p} view filter`, run: { view: { preset: p } } });
  }
  if (s.route.kind === 'inbox') out.push({ id: 'readall', label: 'Mark every notification read', search: 'mark all read inbox notifications', run: { markAllRead: true } });
  allTabs(data, now).forEach(t => out.push({ id: `go:${t.id}`, label: `Go to ${t.label}`, search: `go to tab ${t.label}`, run: { route: t.route } }));
  for (const p of data.projects) out.push({ id: `go:project:${p.id}`, label: `Go to project ${p.name}`, search: `go to project ${p.name}`, run: { route: { kind: 'project', projectId: p.id } } });
  return out;
}

const ranked = (items: FindItem[], query: string, limit: number) => items
  .map((item, i) => ({ item, i, score: wordMatch(query, item.search) }))
  .filter((x): x is { item: FindItem; i: number; score: number } => x.score !== null)
  .sort((a, b) => b.score - a.score || a.i - b.i)
  .slice(0, limit)
  .map(x => x.item);

export function issueResults(query: string, data: TuiData, limit: number): FindItem[] {
  const q = query.trim();
  const compact = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  const pool = q
    ? data.issues.map(i => {
      const key = data.keyOf(i);
      const keyHit = compact.length >= 2 && key.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(compact);
      return { i, score: keyHit ? 100 - key.length : wordMatch(q, i.title) };
    }).filter((x): x is { i: Issue; score: number } => x.score !== null).sort((a, b) => b.score - a.score).map(x => x.i)
    : [...data.issues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return pool.slice(0, limit).map(i => ({ id: `issue:${i.id}`, label: i.title, search: i.title, issue: i, run: { route: { kind: 'issue', issueId: i.id } } }));
}

/** the sections `/` shows for `query`, about `issue` (the one under the cursor) when there is one */
export function findResults(query: string, s: Pick<TuiState, 'route' | 'stack' | 'groupBy' | 'preset'>, data: TuiData, issue: Issue | undefined, mc: MenuCtx | undefined, now: number, team: { id: string; name: string } | undefined): FindSection[] {
  if (!query.trim()) return [{ title: 'Recently updated', items: issueResults('', data, 6) }];
  const sections: FindSection[] = [];
  const doWith: FindItem[] = [];
  const title = /^\s*new\s+(.+)$/i.exec(query)?.[1]?.trim();
  if (title && team) doWith.push({ id: 'create', label: `Create “${title}” in ${team.name}`, search: query, key: keyText('create'), run: { create: title } });
  else if (/^\s*new\s*$/i.test(query)) doWith.push({ id: 'create', label: 'New issue…', search: 'new', key: keyText('create'), run: { command: 'create' } });
  // a query that is an issue key is looking for that issue, not for things to do
  const isKey = /^\s*[a-z]+-?\d+\s*$/i.test(query) && data.issues.some(i => data.keyOf(i).toLowerCase().replace('-', '').startsWith(query.trim().toLowerCase().replace('-', '')));
  if (issue && !title && !isKey) doWith.push(...ranked(issueActions(issue, data, mc), query, 6));
  if (doWith.length) sections.push({ title: issue && !doWith.some(x => x.id === 'create') ? `Do with ${data.keyOf(issue)}` : 'Do', items: doWith });
  const views = title || isKey ? [] : ranked(viewActions(s, data, now), query, 4);
  if (views.length) sections.push({ title: 'Views', items: views });
  const issues = title ? [] : issueResults(query, data, 8);
  sections.push({ title: 'Issues', items: issues });
  return sections;
}

export const findItems = (sections: readonly FindSection[]) => sections.flatMap(x => x.items);
