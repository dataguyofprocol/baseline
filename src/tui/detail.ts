// The issue page and the detail pane as pre-wrapped lines, so scrolling is exact at any width. Pure.
import { PRIORITY_LABELS, type ActivityItem, type Issue } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import type { TuiData } from './data.js';
import { activityText, displayWidth, dueLabel, markdownLines, padEnd, relTime, tildePath, truncate, wrap, wrapSegs, type Line, type Seg } from './model.js';
import { keySeg, priorityMark, STATE_ICON, theme } from './theme.js';

const none: Seg = { text: '—', color: theme.muted };

function section(title: string, width: number, count?: number, right: Seg[] = []): Line[] {
  const head = ` ${title}${count !== undefined ? ` ${count}` : ''} `;
  const rw = right.reduce((n, x) => n + displayWidth(x.text), 0);
  return [[], [{ text: '──', color: theme.border }, { text: head, bold: true }, { text: '─'.repeat(Math.max(0, width - head.length - 2 - (rw ? rw + 2 : 0))), color: theme.border }, ...(rw ? [{ text: '  ' }, ...right] : [])]];
}

/** the fields this TUI can change, as undo and the ✓ saved marker name them */
export type FieldId = 'state' | 'assignee' | 'priority' | 'labels' | 'project' | 'title' | 'description';

export interface FieldRow { field: FieldId; key: string | null; label: string; value: Seg[] }

/** what is drawn over the plain issue: a picker open under a field, the ✓ saved marker, the title being edited */
export interface IssueUi { saved?: FieldId | null; picker?: { field: FieldId; lines: Line[] } | null; title?: Line[] | null }

const LABEL_W = 12;

export function fieldRows(issue: Issue, data: TuiData): FieldRow[] {
  const state = data.stateById.get(issue.stateId);
  const pm = priorityMark(issue.priority);
  const assignee = issue.assigneeId ? data.userById.get(issue.assigneeId) : undefined;
  const labels = issue.labelIds.map(id => data.labelById.get(id)).filter(l => !!l);
  return [
    { field: 'state', key: 's', label: 'Status', value: state ? [{ text: `${STATE_ICON[state.type]} `, color: state.color }, { text: state.name }] : [none] },
    { field: 'assignee', key: 'a', label: 'Assignee', value: assignee ? [{ text: assignee.name }] : [{ text: 'Unassigned', color: theme.muted }] },
    { field: 'priority', key: 'p', label: 'Priority', value: [{ text: `${pm.text} `, color: pm.color }, { text: PRIORITY_LABELS[issue.priority], ...(issue.priority === 0 ? { color: theme.muted } : {}) }] },
    { field: 'labels', key: 'l', label: 'Labels', value: labels.length ? labels.flatMap((l, i) => [{ text: `${i ? '  ' : ''}●`, color: l.color }, { text: ` ${l.name}` }]) : [{ text: 'none', color: theme.muted }] },
  ];
}

const saved: Seg = { text: '   ✓ saved', color: theme.ok, bold: true };

function fieldLine(r: FieldRow, ui: IssueUi): Line {
  const open = ui.picker?.field === r.field;
  return [...(r.key ? [keySeg(r.key), { text: ' ' }] : [{ text: '  ' }]), { text: padEnd(r.label, LABEL_W), bold: open },
    ...r.value, ...(open ? [{ text: '  ▾', color: theme.accent }] : []), ...(ui.saved === r.field ? [saved] : [])];
}

const greyed = (l: Line): Line => l.map(x => ({ ...x, color: theme.muted, bg: undefined, bold: false }));

/** the field rows, with an open picker drawn under its field and the rows below it greyed out */
function fieldBlock(issue: Issue, data: TuiData, ui: IssueUi, extra: Line[]): Line[] {
  const out: Line[] = [];
  let below = false;
  for (const r of fieldRows(issue, data)) {
    out.push(below ? greyed(fieldLine(r, ui)) : fieldLine(r, ui));
    if (ui.picker?.field === r.field) { out.push(...ui.picker.lines); below = true; }
  }
  return [...out, ...(below ? extra.map(greyed) : extra)];
}

function dimRow(label: string, value: Seg[], mark = false): Line {
  return [{ text: '  ' }, { text: padEnd(label, LABEL_W), color: theme.muted }, ...value.map(x => ({ ...x, color: x.color ?? theme.muted })), ...(mark ? [saved] : [])];
}

function projectRow(issue: Issue, data: TuiData, now: number, ui: IssueUi): Line {
  const project = issue.projectId ? data.projectById.get(issue.projectId) : undefined;
  const due = issue.dueDate ? dueLabel(issue.dueDate, now) : undefined;
  const dueSeg: Seg[] = due ? [{ text: `${project ? ' · ' : ''}due ${due.text}`, color: due.tone === 'overdue' ? theme.error : theme.muted }] : [];
  return dimRow('Project', [...(project ? [{ text: project.name }] : due ? [] : [{ text: 'none' }]), ...dueSeg], ui.saved === 'project');
}

/** the rarely-set fields, on the full page only, each only when it has a value */
function moreRows(issue: Issue, data: TuiData): Line[] {
  const cycle = issue.cycleId ? data.cycles.find(c => c.id === issue.cycleId) : undefined;
  const milestone = issue.milestoneId ? data.milestones.find(m => m.id === issue.milestoneId) : undefined;
  const location = issue.locationId ? data.locations.find(l => l.id === issue.locationId) : undefined;
  const rows: Line[] = [];
  if (cycle) rows.push(dimRow('Cycle', [{ text: cycle.name || `Cycle ${cycle.number}` }]));
  if (milestone) rows.push(dimRow('Milestone', [{ text: milestone.name }]));
  if (issue.estimate !== null) rows.push(dimRow('Estimate', [{ text: `${issue.estimate} pt${issue.estimate === 1 ? '' : 's'}` }]));
  if (location) rows.push(dimRow('Location', [{ text: location.name }, { text: ` ${tildePath(location.path)}` }]));
  return rows;
}

function headLines(issue: Issue, data: TuiData, width: number, ui: IssueUi, maxTitle: number): Line[] {
  const team = data.teamById.get(issue.teamId);
  const parent = issue.parentId ? data.issueById.get(issue.parentId) : undefined;
  return [
    [{ text: `${data.keyOf(issue)} · ${team?.name ?? ''}`, color: theme.muted }, ...(parent ? [{ text: `  ›  sub-issue of ${data.keyOf(parent)}`, color: theme.muted }] : []), ...(ui.saved === 'title' ? [saved] : [])],
    ...(ui.title ?? wrap(issue.title, width, { bold: true }).slice(0, maxTitle)),
  ];
}

function activityLine(a: ActivityItem, data: TuiData, now: number): Seg[] {
  const who = a.userId === data.currentUser.id ? 'You' : data.userById.get(a.userId)?.name ?? 'Someone';
  return [{ text: '· ', color: theme.muted }, { text: `${who} ${activityText(a, data)}` }, { text: `  ${relTime(a.createdAt, now)}`, color: theme.muted }];
}

const rightAlign = (left: Seg[], right: Seg[], width: number): Line => {
  const lw = left.reduce((n, x) => n + displayWidth(x.text), 0), rw = right.reduce((n, x) => n + displayWidth(x.text), 0);
  return [...left, { text: ' '.repeat(Math.max(2, width - lw - rw)) }, ...right];
};

export const AGENT_LINE: Line = [keySeg('w'), { text: ' Work on it with an agent   ' }, keySeg('c'), { text: ' copy' }];

/** the detail pane beside the list: the issue under the cursor cut to `height` rows. The fields and the agent line
 *  always show; the description, the latest comment and the last change share what is left */
export function paneLines(issue: Issue, data: TuiData, width: number, height: number, now: number, ui: IssueUi = {}): Line[] {
  const w = Math.max(12, width);
  const top: Line[] = [...headLines(issue, data, w, ui, 2), [], ...fieldBlock(issue, data, ui, [projectRow(issue, data, now, ui)])];
  const bottom: Line[] = [[], AGENT_LINE];
  let room = height - top.length - bottom.length;

  const comments = data.comments.filter(c => c.issueId === issue.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last = comments[comments.length - 1];
  const commentBlock: Line[] = [[], rightAlign([{ text: comments.length ? `Comments ${comments.length}` : 'No comments yet', color: theme.muted }], [keySeg('m'), { text: comments.length ? ' reply' : ' comment' }], w)];
  if (last) {
    const author = data.userById.get(last.userId);
    commentBlock.push([{ text: author?.name ?? 'Someone', bold: true }, { text: ` · ${relTime(last.createdAt, now)}`, color: theme.muted }]);
    commentBlock.push(...markdownLines(last.body, w - 2).slice(0, 2).map(l => [{ text: '  ' }, ...l]));
  }
  const lastChange = data.activity.find(a => a.issueId === issue.id && a.type !== 'commented');
  const activityBlock: Line[] = lastChange ? [[], [{ text: 'Activity', color: theme.muted }], ...wrapSegs(activityLine(lastChange, data, now), w, '  ').slice(0, 2)] : [];

  const desc = issue.description.trim() ? markdownLines(issue.description, w) : [[{ text: 'No description', color: theme.muted, italic: true }] as Line];
  const middle: Line[] = [];
  const descRoom = Math.min(6, room - commentBlock.length - activityBlock.length - 1);
  if (room >= 2) {
    const n = Math.max(1, descRoom);
    middle.push([], ...(desc.length > n ? [...desc.slice(0, Math.max(1, n - 1)), [{ text: '… enter for the whole issue', color: theme.muted }] as Line] : desc));
    room -= middle.length;
  }
  if (room >= commentBlock.length) { middle.push(...commentBlock); room -= commentBlock.length; }
  if (room >= activityBlock.length) middle.push(...activityBlock);
  return [...top, ...middle, ...bottom].slice(0, height);
}

function threadLines(t: WorkThread, data: TuiData, width: number, now: number): Line[] {
  const agent = data.userById.get(t.agentId)?.name ?? 'Agent';
  const person = t.personId !== t.agentId ? data.userById.get(t.personId)?.name : undefined;
  const who = person ? `${agent} via ${person}` : agent;
  const active = t.state.status === 'active';
  const status: Seg = active
    ? { text: '● working', color: theme.ok }
    : { text: `✓ ${t.state.status === 'finished' ? t.state.outcome : ''}`, color: theme.muted };
  const lines: Line[] = [[{ text: who, bold: true }, { text: '  ' }, status, { text: `  ·  ${relTime(t.updatedAt, now, { ago: true })}`, color: theme.muted }, ...(t.branch ? [{ text: `  ${t.branch}`, color: theme.accent }] : [])]];
  const field = (label: string, text: string | null, color?: string) => {
    if (!text) return;
    markdownLines(text, width - 11).forEach((l, i) => lines.push([{ text: i ? ' '.repeat(11) : `  ${padEnd(label, 9)}`, color: theme.muted }, ...(color ? l.map(x => ({ ...x, color })) : l)]));
  };
  if (t.state.status === 'finished') field('summary', t.state.summary);
  field('did', t.progress.did);
  field('left', t.progress.left);
  field('blocked', t.progress.blocked, theme.error);
  for (const l of t.links.slice(0, 3)) lines.push([{ text: `  ${padEnd('link', 9)}`, color: theme.muted }, { text: truncate(l, width - 11), underline: true }]);
  return lines;
}

export function detailLines(issue: Issue, data: TuiData, threads: readonly WorkThread[], width: number, now: number, ui: IssueUi = {}): Line[] {
  const w = Math.max(20, width);
  const lines: Line[] = [...headLines(issue, data, w, ui, 99), [], ...fieldBlock(issue, data, ui, [projectRow(issue, data, now, ui), ...moreRows(issue, data)])];
  lines.push([], [keySeg('m'), { text: ' comment   ' }, keySeg('e'), { text: ' edit   ' }, ...AGENT_LINE, { text: '   ' }, keySeg('o'), { text: ' browser' }]);

  lines.push(...section('Description', w));
  lines.push(...(issue.description.trim() ? markdownLines(issue.description, w) : [[{ text: 'No description. e then d writes one in your editor.', color: theme.muted, italic: true }]]));

  const children = data.issues.filter(i => i.parentId === issue.id);
  if (children.length) {
    const done = children.filter(c => ['completed', 'canceled'].includes(data.stateById.get(c.stateId)?.type ?? '')).length;
    lines.push(...section('Sub-issues', w, children.length));
    lines.push([{ text: `${done}/${children.length} done`, color: theme.muted }]);
    for (const c of children) {
      const st = data.stateById.get(c.stateId);
      const who = c.assigneeId ? data.userById.get(c.assigneeId) : undefined;
      const key = data.keyOf(c);
      lines.push([{ text: `${st ? STATE_ICON[st.type] : '○'} `, color: st?.color }, { text: padEnd(key, 9), color: theme.muted },
        { text: truncate(c.title, w - 16) }, ...(who ? [{ text: `  ${who.initials}`, color: who.color }] : [])]);
    }
  }

  if (threads.length) {
    lines.push(...section('Agent work', w, threads.length));
    threads.forEach((t, i) => { if (i) lines.push([]); lines.push(...threadLines(t, data, w, now)); });
  }

  const comments = data.comments.filter(c => c.issueId === issue.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  lines.push(...section('Comments', w, comments.length, [keySeg('m'), { text: comments.length ? ' reply' : ' comment' }]));
  if (!comments.length) lines.push([{ text: 'No comments yet. Press m to add one.', color: theme.muted, italic: true }]);
  const roots = comments.filter(c => !c.parentId || !comments.some(p => p.id === c.parentId));
  roots.forEach((root, i) => {
    for (const c of [root, ...comments.filter(r => r.parentId === root.id)]) {
      const indent = c === root ? '' : '    ';
      const author = data.userById.get(c.userId);
      const via = c.viaUserId ? data.userById.get(c.viaUserId)?.name : undefined;
      if (i || c !== root) lines.push([]);
      lines.push([{ text: `${indent}${c === root ? '' : '↳ '}` }, { text: author?.name ?? 'Someone', bold: true, color: author?.color },
        ...(via ? [{ text: ` via ${via}`, color: theme.muted }] : []),
        { text: `  ${relTime(c.createdAt, now, { ago: true })}${c.editedAt ? ' (edited)' : ''}${c.resolvedAt ? ' · resolved' : ''}`, color: theme.muted }]);
      lines.push(...markdownLines(c.body, w - indent.length - 2).map(l => [{ text: `${indent}  ` }, ...l]));
    }
  });

  const activity = data.activity.filter(a => a.issueId === issue.id && a.type !== 'commented').slice(0, 8).reverse();
  if (activity.length) {
    lines.push(...section('Activity', w));
    for (const a of activity) {
      lines.push(...wrapSegs(activityLine(a, data, now), w, '  '));
    }
  }
  lines.push([]);
  return lines;
}
