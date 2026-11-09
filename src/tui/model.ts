// Pure view-model: what each screen shows, computed from TuiData. No Ink, no I/O, so it is testable.
import { homedir } from 'node:os';
import { PRIORITY_LABELS, STATE_TYPE_LABELS, type ActivityItem, type Issue, type Notification, type NotificationType, type Project, type ProjectStatus, type WorkflowStateType } from '../core/types.js';
import { plainMentions } from '../core/mentions.js';
import type { TuiData } from './data.js';
import type { Route } from './state.js';

// ---------- text ----------

export interface Seg { text: string; color?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }
export type Line = Seg[];

function charWidth(cp: number): number {
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x0300 && cp <= 0x036f)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/** cut to `width` cells, ending in an ellipsis when something was cut */
export function truncate(s: string, width: number): string {
  if (width <= 0) return '';
  if (displayWidth(s) <= width) return s;
  let out = '', w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > width - 1) break;
    out += ch; w += cw;
  }
  return `${out}…`;
}

export const padEnd = (s: string, width: number) => {
  const t = truncate(s, width);
  return t + ' '.repeat(Math.max(0, width - displayWidth(t)));
};
export const padStart = (s: string, width: number) => {
  const t = truncate(s, width);
  return ' '.repeat(Math.max(0, width - displayWidth(t))) + t;
};

export const lineWidth = (line: Line) => line.reduce((n, s) => n + displayWidth(s.text), 0);

/** greedy word wrap of styled segments; words wider than the line are broken */
export function wrapSegs(segs: Line, width: number, indent = ''): Line[] {
  const lines: Line[] = [];
  const room = Math.max(1, width);
  let cur: Line = [], w = 0;
  const push = (seg: Seg) => {
    const last = cur[cur.length - 1];
    if (last && sameStyle(last, seg)) last.text += seg.text; else cur.push({ ...seg });
    w += displayWidth(seg.text);
  };
  const newline = () => {
    while (cur.length && /^\s*$/.test(cur[cur.length - 1].text)) cur.pop();
    const lastSeg = cur[cur.length - 1];
    if (lastSeg) lastSeg.text = lastSeg.text.replace(/\s+$/, '');
    lines.push(cur);
    cur = indent ? [{ text: indent }] : [];
    w = displayWidth(indent);
  };
  for (const seg of segs) {
    for (const part of seg.text.split(/(\n)/)) {
      if (part === '\n') { newline(); continue; }
      for (const word of part.split(/(\s+)/).filter(Boolean)) {
        const ww = displayWidth(word);
        if (/^\s+$/.test(word)) { if (w > displayWidth(indent) && w + ww <= room) push({ ...seg, text: ' ' }); continue; }
        if (w + ww > room && w > displayWidth(indent)) newline();
        if (ww > room - w) {
          let chunk = '';
          for (const ch of word) {
            if (w + displayWidth(chunk + ch) > room) { push({ ...seg, text: chunk }); newline(); chunk = ''; }
            chunk += ch;
          }
          if (chunk) push({ ...seg, text: chunk });
        } else push({ ...seg, text: word });
      }
    }
  }
  if (cur.length && !(cur.length === 1 && cur[0].text === indent)) lines.push(cur);
  return lines.length ? lines : [[]];
}

const sameStyle = (a: Seg, b: Seg) =>
  a.color === b.color && !!a.bold === !!b.bold && !!a.dim === !!b.dim && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.strike === !!b.strike;

export const wrap = (text: string, width: number, style: Omit<Seg, 'text'> = {}): Line[] => wrapSegs([{ ...style, text }], width);

export const tildePath = (p: string) => { const h = homedir(); return p === h || p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p; };

// ---------- time ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function relTime(iso: string, now: number, { ago = false } = {}): string {
  const t = Date.parse(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  const sfx = ago ? ' ago' : '';
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m${sfx}`;
  if (s < 86400) return `${Math.round(s / 3600)}h${sfx}`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d${sfx}`;
  const d = new Date(t), n = new Date(now);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** a due date as a short label and how urgent it is */
export function dueLabel(due: string, now: number): { text: string; tone: 'overdue' | 'soon' | 'later' } {
  const [y, m, d] = due.slice(0, 10).split('-').map(Number);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
  const text = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : `${MONTHS[m - 1]} ${d}`;
  return { text, tone: days < 0 ? 'overdue' : days <= 2 ? 'soon' : 'later' };
}

// ---------- issues ----------

/** Linear's list order; triage first because it is waiting on a decision */
export const STATE_ORDER: WorkflowStateType[] = ['triage', 'started', 'unstarted', 'backlog', 'completed', 'canceled'];
export const CLOSED_TYPES: ReadonlySet<WorkflowStateType> = new Set(['completed', 'canceled']);

const PRIORITY_RANK = [5, 1, 2, 3, 4];

export function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sortOrder - b.sortOrder || a.number - b.number);
}

export interface IssueGroup { type: WorkflowStateType; label: string; color: string; issues: Issue[] }

export function groupIssues(issues: readonly Issue[], data: Pick<TuiData, 'stateById' | 'states'>): IssueGroup[] {
  const byType = new Map<WorkflowStateType, Issue[]>();
  for (const i of issues) {
    const type = data.stateById.get(i.stateId)?.type ?? 'backlog';
    const list = byType.get(type);
    if (list) list.push(i); else byType.set(type, [i]);
  }
  return STATE_ORDER.filter(t => byType.has(t)).map(type => {
    const list = sortIssues(byType.get(type)!);
    return { type, label: STATE_TYPE_LABELS[type], color: data.stateById.get(list[0].stateId)?.color ?? 'gray', issues: list };
  });
}

export const isListRoute = (r: Route): r is Extract<Route, { kind: 'my' | 'team' | 'project' }> => r.kind === 'my' || r.kind === 'team' || r.kind === 'project';

export function issuesForRoute(route: Route, data: TuiData): Issue[] {
  switch (route.kind) {
    case 'my': return data.issues.filter(i => i.assigneeId === data.currentUser.id);
    case 'team': return data.issuesByTeam.get(route.teamId) ?? [];
    case 'project': return data.issues.filter(i => i.projectId === route.projectId);
    default: return [];
  }
}

export type ListRow =
  | { kind: 'group'; id: string; group: IssueGroup; expanded: boolean; selectable: boolean }
  | { kind: 'issue'; id: string; issue: Issue };

/** group headers and issue rows; closed groups start collapsed and their header is what the cursor toggles */
export function listRows(groups: readonly IssueGroup[], isExpanded: (type: WorkflowStateType) => boolean): ListRow[] {
  const rows: ListRow[] = [];
  for (const g of groups) {
    const expanded = isExpanded(g.type);
    rows.push({ kind: 'group', id: `group:${g.type}`, group: g, expanded, selectable: CLOSED_TYPES.has(g.type) });
    if (expanded) for (const i of g.issues) rows.push({ kind: 'issue', id: i.id, issue: i });
  }
  return rows;
}

export const defaultExpanded = (type: WorkflowStateType) => !CLOSED_TYPES.has(type);

// ---------- inbox ----------

const VERBS: Record<NotificationType, string> = {
  issueAssignedToYou: 'assigned you', issueAssigned: 'assigned', issueCommented: 'commented', issueMentioned: 'mentioned you',
  issueStatusChanged: 'changed status', issueReplied: 'replied', issueReminder: 'reminder', projectUpdate: 'project update',
  projectIssueAdded: 'added to project', projectIssueClosed: 'closed in project', projectChanged: 'changed project',
  initiativeUpdateReminder: 'update due', projectUpdateReminder: 'update due', updatesDigest: 'updates digest',
  slaBreached: 'SLA breached', prActivity: 'pull request', loopFailed: 'loop failed', teamActivity: 'team activity',
  teamMemberAdded: 'added you to a team', commentReacted: 'reacted', docChanged: 'changed a doc', systemUpdate: 'Baseline',
};
const BODY_HAS_ID: ReadonlySet<NotificationType> = new Set(['initiativeUpdateReminder', 'teamMemberAdded', 'docChanged']);

export interface InboxItem {
  id: string;
  notification: Notification;
  unread: boolean;
  who: string;
  verb: string;
  subject: string;
  key: string | null;
  body: string;
  issueId: string | null;
}

export function inboxItems(data: TuiData, now: number): InboxItem[] {
  return data.notifications
    .filter(n => !n.snoozedUntil || Date.parse(n.snoozedUntil) <= now)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(n => {
      const issue = n.issueId ? data.issueById.get(n.issueId) : undefined;
      const project = n.projectId ? data.projectById.get(n.projectId) : undefined;
      const body = plainMentions(BODY_HAS_ID.has(n.type) ? n.body.replace(/^[^|]*\|/, '') : n.body).replace(/\s+/g, ' ').trim();
      return {
        id: n.id, notification: n, unread: !n.readAt,
        who: n.actorId ? data.userById.get(n.actorId)?.name ?? 'Someone' : 'Baseline',
        verb: VERBS[n.type] ?? n.type,
        subject: issue?.title ?? project?.name ?? body,
        key: issue ? data.keyOf(issue) : null,
        body, issueId: issue?.id ?? null,
      };
    });
}

export const unreadCount = (data: TuiData, now: number) => inboxItems(data, now).filter(i => i.unread).length;

// ---------- projects ----------

const PROJECT_STATUS_ORDER: ProjectStatus[] = ['started', 'planned', 'backlog', 'paused', 'completed', 'canceled'];

export interface ProjectRow { id: string; project: Project; done: number; total: number; lead: string | null }

export function projectProgress(projectId: string, data: TuiData): { done: number; total: number } {
  let done = 0, total = 0;
  for (const i of data.issues) {
    if (i.projectId !== projectId) continue;
    const type = data.stateById.get(i.stateId)?.type;
    if (type === 'canceled') continue;
    total++;
    if (type === 'completed') done++;
  }
  return { done, total };
}

export function projectRows(data: TuiData): ProjectRow[] {
  return [...data.projects]
    .sort((a, b) => PROJECT_STATUS_ORDER.indexOf(a.status) - PROJECT_STATUS_ORDER.indexOf(b.status) || a.position - b.position)
    .map(p => ({ id: p.id, project: p, ...projectProgress(p.id, data), lead: p.leadId ? data.userById.get(p.leadId)?.name ?? null : null }));
}

export function progressBar(done: number, total: number, width: number): { filled: string; empty: string } {
  const n = total ? Math.round((done / total) * width) : 0;
  return { filled: '█'.repeat(n), empty: '░'.repeat(width - n) };
}

// ---------- sidebar ----------

export interface NavItem { id: string; label: string; route: Route; count: number | null; color?: string; icon: string }

export function navItems(data: TuiData, now: number): NavItem[] {
  const open = (i: Issue) => !CLOSED_TYPES.has(data.stateById.get(i.stateId)?.type ?? 'backlog');
  return [
    { id: 'my', label: 'My Issues', route: { kind: 'my' }, count: data.issues.filter(i => i.assigneeId === data.currentUser.id && open(i)).length, icon: '◉' },
    { id: 'inbox', label: 'Inbox', route: { kind: 'inbox' }, count: unreadCount(data, now), icon: '✉' },
    ...data.teams.map((t): NavItem => ({
      id: `team:${t.id}`, label: t.name, route: { kind: 'team', teamId: t.id },
      count: (data.issuesByTeam.get(t.id) ?? []).filter(open).length, color: t.color, icon: '■',
    })),
    { id: 'projects', label: 'Projects', route: { kind: 'projects' }, count: data.projects.length, icon: '◆' },
  ];
}

/** which sidebar entry a route belongs to (an issue or project belongs to whatever it was opened from) */
export function navIdFor(route: Route, stack: readonly Route[]): string | null {
  for (const r of [route, ...[...stack].reverse()]) {
    if (r.kind === 'my' || r.kind === 'inbox' || r.kind === 'projects') return r.kind;
    if (r.kind === 'team') return `team:${r.teamId}`;
    if (r.kind === 'project') return 'projects';
  }
  return null;
}

// ---------- cursor targets ----------

/** the ids the cursor moves over on a route, in order; the reducer keeps the cursor on the same id across refetches */
export function selectableIds(route: Route, data: TuiData, isExpanded: (type: WorkflowStateType) => boolean, now: number): string[] {
  if (isListRoute(route)) return listRows(groupIssues(issuesForRoute(route, data), data), isExpanded).filter(r => r.kind === 'issue' || r.selectable).map(r => r.id);
  if (route.kind === 'inbox') return inboxItems(data, now).map(i => i.id);
  if (route.kind === 'projects') return projectRows(data).map(p => p.id);
  return [];
}

// ---------- fuzzy ----------

export interface FuzzyMatch { score: number; indices: number[] }

const isBoundary = (text: string, i: number) => i === 0 || /[^a-z0-9]/i.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

/** subsequence match; word starts, runs and early matches score higher */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  let best: FuzzyMatch | null = null;
  for (let start = t.indexOf(q[0]); start !== -1; start = t.indexOf(q[0], start + 1)) {
    const indices = [start];
    let ti = start + 1;
    for (let qi = 1; qi < q.length; qi++) {
      while (ti < t.length && t[ti] !== q[qi]) ti++;
      if (ti >= t.length) break;
      indices.push(ti++);
    }
    if (indices.length < q.length) break;
    let score = 0;
    indices.forEach((ix, n) => {
      score += 1;
      if (isBoundary(text, ix)) score += 8;
      if (n > 0 && ix === indices[n - 1] + 1) score += 5;
      else if (n > 0) score -= Math.min(3, (ix - indices[n - 1]) * 0.2);
    });
    score -= start * 0.1;
    if (t.includes(query.toLowerCase().trim())) score += 15;
    if (!best || score > best.score) best = { score, indices };
  }
  return best;
}

export function fuzzyFilter<T>(items: readonly T[], query: string, text: (t: T) => string): Array<{ item: T; match: FuzzyMatch }> {
  if (!query.trim()) return items.map(item => ({ item, match: { score: 0, indices: [] } }));
  const out: Array<{ item: T; match: FuzzyMatch }> = [];
  for (const item of items) {
    const match = fuzzyMatch(query, text(item));
    if (match) out.push({ item, match });
  }
  return out.sort((a, b) => b.match.score - a.match.score);
}

/** split text into plain and matched runs for highlighting; `offset` shifts indices that were computed on a longer string */
export function highlight(text: string, indices: readonly number[], offset = 0): Array<{ text: string; hit: boolean }> {
  const hits = new Set(indices.map(i => i - offset));
  const runs: Array<{ text: string; hit: boolean }> = [];
  [...text].forEach((ch, i) => {
    const hit = hits.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += ch; else runs.push({ text: ch, hit });
  });
  return runs;
}

// ---------- activity ----------

export function activityText(a: ActivityItem, data: TuiData): string {
  const d = a.data as Record<string, unknown>;
  const state = (id: unknown) => (typeof id === 'string' ? data.stateById.get(id)?.name : undefined) ?? '?';
  const user = (id: unknown) => (typeof id === 'string' ? data.userById.get(id)?.name : undefined) ?? 'someone';
  switch (a.type) {
    case 'created': return 'created the issue';
    case 'renamed': return `renamed to “${String(d.to ?? '')}”`;
    case 'described': return 'edited the description';
    case 'stateChanged': return `moved ${state(d.from)} → ${state(d.to)}`;
    case 'priorityChanged': return `set priority to ${PRIORITY_LABELS[(d.to as 0) ?? 0] ?? '?'}`;
    case 'assigned': return `assigned ${user(d.to)}`;
    case 'unassigned': return 'removed the assignee';
    case 'labeled': return `added label ${data.labelById.get(String(d.labelId))?.name ?? ''}`.trim();
    case 'unlabeled': return `removed label ${data.labelById.get(String(d.labelId))?.name ?? ''}`.trim();
    case 'projected': return d.to ? `moved to ${data.projectById.get(String(d.to))?.name ?? 'a project'}` : 'removed from the project';
    case 'commented': return 'commented';
    case 'dueChanged': return d.to ? `set due ${String(d.to).slice(0, 10)}` : 'removed the due date';
    case 'estimateChanged': return 'changed the estimate';
    case 'parented': return 'changed the parent';
    case 'archived': return 'archived the issue';
    case 'restored': return 'restored the issue';
    case 'teamChanged': return `moved ${String(d.from ?? '')} → ${String(d.to ?? '')}`;
    case 'attached': return `attached ${String(d.title ?? 'a link')}`;
    case 'prLinked': return 'linked a pull request';
    case 'prStateMoved': return 'moved by a pull request';
    case 'commitLinked': return 'linked a commit';
    default: return a.type.replace(/([A-Z])/g, ' $1').toLowerCase();
  }
}

// ---------- markdown ----------

function inlineSegs(text: string, base: Omit<Seg, 'text'> = {}): Seg[] {
  const segs: Seg[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(~~[^~]+~~)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) segs.push({ ...base, text: text.slice(last, m.index) });
    if (m[1]) segs.push({ ...base, text: m[1].slice(1, -1), color: '#d19a66' });
    else if (m[2]) segs.push({ ...base, text: m[2].slice(2, -2), bold: true });
    else if (m[3]) segs.push({ ...base, text: m[3].slice(1, -1), italic: true });
    else if (m[4]) segs.push({ ...base, text: m[4].slice(2, -2), strike: true });
    else if (m[5]) {
      segs.push({ ...base, text: m[6], underline: true });
      if (m[7] !== m[6]) segs.push({ ...base, text: ` (${m[7]})`, dim: true });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ ...base, text: text.slice(last) });
  return segs;
}

/** Markdown as terminal lines: headings bold, bullets and quotes indented, code dim; links keep their url */
export function markdownLines(md: string, width: number): Line[] {
  const out: Line[] = [];
  let fence = false;
  const blank = () => { if (out.length && out[out.length - 1].length) out.push([]); };
  for (const raw of plainMentions(md).replace(/\r/g, '').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) { out.push([{ text: `  ${truncate(raw.replace(/\t/g, '  '), width - 2)}`, dim: true }]); continue; }
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { blank(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      blank();
      out.push(...wrapSegs(inlineSegs(m[2], { bold: true, ...(m[1].length <= 2 ? { underline: m[1].length === 1 } : {}) }), width));
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push([{ text: '─'.repeat(Math.max(1, width)), dim: true }]);
    } else if ((m = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/))) {
      const pad = ' '.repeat(Math.min(8, m[1].length));
      const done = m[2] !== ' ';
      out.push(...wrapSegs([{ text: `${pad}${done ? '☑' : '☐'} `, dim: done }, ...inlineSegs(m[3], done ? { dim: true, strike: true } : {})], width, `${pad}  `));
    } else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
      const pad = ' '.repeat(Math.min(8, m[1].length));
      out.push(...wrapSegs([{ text: `${pad}• ` }, ...inlineSegs(m[2])], width, `${pad}  `));
    } else if ((m = line.match(/^(\s*)(\d+[.)])\s+(.*)$/))) {
      const pad = ' '.repeat(Math.min(8, m[1].length));
      out.push(...wrapSegs([{ text: `${pad}${m[2]} ` }, ...inlineSegs(m[3])], width, `${pad}${' '.repeat(m[2].length + 1)}`));
    } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
      out.push(...wrapSegs([{ text: '│ ', dim: true }, ...inlineSegs(m[1], { italic: true })], width, '│ ').map(l => l.map(s => (s.text === '│ ' ? { ...s, dim: true } : s))));
    } else {
      out.push(...wrapSegs(inlineSegs(line.trim()), width));
    }
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}
