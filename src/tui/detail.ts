// The issue page and the detail pane as pre-wrapped lines, so scrolling is exact at any width. Pure.
import { PRIORITY_LABELS, type ActivityItem, type Issue } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import type { TuiData } from './data.js';
import { activityText, displayWidth, dueLabel, highlight, markdownLines, padEnd, relTime, tildePath, truncate, wrap, wrapSegs, type Line, type Seg } from './model.js';
import { filteredOptions } from './overlays.js';
import type { Overlay } from './state.js';
import { keySeg, priorityMark, STATE_ICON, theme } from './theme.js';
import { commitCount, followupsOf, myThread, prOf, threadAsk, type FlightRow, type NeedRow, type NextRow } from './today.js';

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

export function fieldRows(issue: Issue, data: TuiData, now: number): FieldRow[] {
  const state = data.stateById.get(issue.stateId);
  const pm = priorityMark(issue.priority);
  const assignee = issue.assigneeId ? data.userById.get(issue.assigneeId) : undefined;
  const labels = issue.labelIds.map(id => data.labelById.get(id)).filter(l => !!l);
  return [
    { field: 'state', key: 's', label: 'Status', value: state ? [{ text: `${STATE_ICON[state.type]} `, color: state.color }, { text: state.name }] : [none] },
    { field: 'assignee', key: 'a', label: 'Assignee', value: assignee ? [{ text: assignee.name }] : [{ text: 'Unassigned', color: theme.muted }] },
    { field: 'priority', key: 'p', label: 'Priority', value: [{ text: `${pm.text} `, color: pm.color }, { text: PRIORITY_LABELS[issue.priority], ...(issue.priority === 0 ? { color: theme.muted } : {}) }] },
    { field: 'labels', key: 'l', label: 'Labels', value: labels.length ? labels.flatMap((l, i) => [{ text: `${i ? '  ' : ''}●`, color: l.color }, { text: ` ${l.name}` }]) : [{ text: 'none', color: theme.muted }] },
    { field: 'project', key: null, label: 'Project', value: projectValue(issue, data, now) },
  ];
}

function projectValue(issue: Issue, data: TuiData, now: number): Seg[] {
  const project = issue.projectId ? data.projectById.get(issue.projectId) : undefined;
  const due = issue.dueDate ? dueLabel(issue.dueDate, now) : undefined;
  const dueSeg: Seg[] = due ? [{ text: `${project ? ' · ' : ''}due ${due.text}`, color: due.tone === 'overdue' ? theme.error : theme.muted }] : [];
  return [...(project ? [{ text: project.name, color: theme.muted }] : due ? [] : [{ text: 'none', color: theme.muted }]), ...dueSeg];
}

const saved: Seg = { text: '   ✓ saved', color: theme.ok, bold: true };

function fieldLine(r: FieldRow, ui: IssueUi): Line {
  const open = ui.picker?.field === r.field;
  return [...(r.key ? [keySeg(r.key), { text: ' ' }] : [{ text: '  ' }]), { text: padEnd(r.label, LABEL_W), bold: open, ...(r.key || open ? {} : { color: theme.muted }) },
    ...r.value, ...(open ? [{ text: '  ▾', color: theme.accent }] : []), ...(ui.saved === r.field ? [saved] : [])];
}

const greyed = (l: Line): Line => l.map(x => ({ ...x, color: theme.muted, bg: undefined, bold: false }));


/** the field rows, with an open picker drawn under its field and the rows below it greyed out */
function fieldBlock(issue: Issue, data: TuiData, now: number, ui: IssueUi, extra: Line[]): Line[] {
  const out: Line[] = [];
  let below = false;
  for (const r of fieldRows(issue, data, now)) {
    out.push(below ? greyed(fieldLine(r, ui)) : fieldLine(r, ui));
    if (ui.picker?.field === r.field) { out.push(...ui.picker.lines); below = true; }
  }
  return [...out, ...(below ? extra.map(greyed) : extra)];
}

function dimRow(label: string, value: Seg[]): Line {
  return [{ text: '  ' }, { text: padEnd(label, LABEL_W), color: theme.muted }, ...value.map(x => ({ ...x, color: x.color ?? theme.muted }))];
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

const MORE_LINE: Line = [{ text: 'more ↓ enter for the whole issue', color: theme.muted }];
export const AGENT_LINE: Line = [keySeg('w'), { text: ' Work on it with an agent   ' }, keySeg('c'), { text: ' copy' }];

/** the detail pane beside the list: the issue under the cursor cut to `height` rows. The fields and the agent line
 *  always show; the description, the latest comment and the last change share what is left */
export function paneLines(issue: Issue, data: TuiData, width: number, height: number, now: number, ui: IssueUi = {}): Line[] {
  const w = Math.max(12, width);
  const top: Line[] = [...headLines(issue, data, w, ui, 2), [], ...fieldBlock(issue, data, now, ui, [])];
  let room = height - top.length - 2;
  let cut = false;

  const comments = data.comments.filter(c => c.issueId === issue.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last = comments[comments.length - 1];
  const commentBlock: Line[] = [[], rightAlign([{ text: comments.length ? `Comments ${comments.length}` : 'No comments yet', color: theme.muted }], [keySeg('m'), { text: comments.length ? ' reply' : ' comment' }], w)];
  if (last) {
    const author = data.userById.get(last.userId);
    commentBlock.push([{ text: author?.name ?? 'Someone', bold: true }, { text: ` · ${relTime(last.createdAt, now)}`, color: theme.muted }]);
    const body = markdownLines(last.body, w - 2);
    if (body.length > 2) cut = true;
    commentBlock.push(...body.slice(0, 2).map(l => [{ text: '  ' }, ...l]));
  }
  const lastChange = data.activity.find(a => a.issueId === issue.id && a.type !== 'commented');
  const changeLines = lastChange ? wrapSegs(activityLine(lastChange, data, now), w, '  ') : [];
  if (changeLines.length > 2) cut = true;
  const activityBlock: Line[] = lastChange ? [[], [{ text: 'Activity', color: theme.muted }], ...changeLines.slice(0, 2)] : [];

  const desc = issue.description.trim() ? markdownLines(issue.description, w) : [[{ text: 'No description', color: theme.muted, italic: true }] as Line];
  const middle: Line[] = [];
  const descRoom = Math.min(6, room - commentBlock.length - activityBlock.length - 1);
  if (room >= 2) {
    const n = Math.max(1, descRoom);
    if (desc.length > n) cut = true;
    middle.push([], ...desc.slice(0, n));
    room -= middle.length;
  } else if (issue.description.trim()) cut = true;
  if (room >= commentBlock.length) { middle.push(...commentBlock); room -= commentBlock.length; } else if (last) cut = true;
  if (room >= activityBlock.length) middle.push(...activityBlock); else cut = true;
  // the page keys stay with the list, so a cut pane says where the rest is
  const bottom: Line[] = [cut ? MORE_LINE : [], AGENT_LINE];
  return [...top, ...middle, ...bottom].slice(0, height);
}

function threadLines(t: WorkThread, data: TuiData, width: number, now: number): Line[] {
  const who = threadWho(t, data);
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

/** who did the agent's work: "Claude Code via Parth" */
export function threadWho(t: WorkThread, data: TuiData): string {
  const agent = data.userById.get(t.agentId)?.name ?? 'Agent';
  const person = t.personId !== t.agentId ? data.userById.get(t.personId)?.name.split(/\s+/)[0] : undefined;
  return person ? `${agent} via ${person}` : agent;
}

const CHECKS: Record<string, Seg> = { success: { text: '✓', color: theme.ok }, failure: { text: '✕', color: theme.error }, pending: { text: '…', color: theme.warn } };

/** the PR as one line: "#41 Cmd+K scoring · open · checks ✓ · 3 commits" */
export function prSegs(issueId: string, data: TuiData, withTitle = true): Seg[] {
  const pr = prOf(data, issueId);
  if (!pr) return [];
  const commits = commitCount(data, issueId);
  const title = pr.title.replace(/^[A-Za-z][A-Za-z0-9]*-\d+\s+/, '');
  return [{ text: `#${pr.number}${withTitle ? ` ${title}` : ''}`, color: theme.accent }, { text: ` · ${pr.state}` },
    ...(pr.checks ? [{ text: ' · checks ' }, CHECKS[pr.checks]!] : []), ...(commits ? [{ text: ` · ${commits} commit${commits === 1 ? '' : 's'}` }] : [])];
}

const fieldRow = (label: string, width: number, color?: string) => (text: string | null): Line[] =>
  text ? markdownLines(text, width - 12).map((l, i) => [{ text: i ? ' '.repeat(12) : `  ${padEnd(label, 10)}`, color: theme.muted }, ...(color ? l.map(x => ({ ...x, color })) : l)]) : [];

/** the top of the issue page when an agent finished it for you or got stuck: what it did, its PR and what it noticed */
function agentSection(issue: Issue, data: TuiData, t: WorkThread, ask: 'review' | 'blocked', width: number, now: number): Line[] {
  const meta = `${threadWho(t, data)} · ${ask === 'blocked' ? 'asked' : 'finished'} ${relTime(t.state.status === 'finished' ? t.state.finishedAt : t.updatedAt, now, { ago: true })} · ${t.branch}`;
  const out: Line[] = [...section(ask === 'blocked' ? 'The agent is blocked' : 'What the agent did', width), [{ text: truncate(meta, width), color: theme.muted }]];
  if (ask === 'blocked') out.push(...fieldRow('blocked', width, theme.error)(t.progress.blocked ?? (t.state.status === 'finished' ? t.state.summary : null)));
  else if (t.state.status === 'finished') out.push(...fieldRow('summary', width)(t.state.summary));
  out.push(...fieldRow('did', width)(t.progress.did), ...fieldRow('left', width)(t.progress.left));
  const pr = prSegs(issue.id, data);
  if (pr.length) out.push([{ text: `  ${padEnd('pr', 10)}`, color: theme.muted }, ...pr]);
  const drafts = followupsOf(data, issue.id);
  if (drafts.length) {
    out.push(...section('It also noticed', width, undefined, [{ text: `${drafts.length} follow-up draft${drafts.length === 1 ? '' : 's'}, not filed yet`, color: theme.muted }]));
    drafts.forEach((d, i) => out.push([{ text: `  ${i + 1}  `, color: theme.muted }, { text: truncate(d.title, width - 5) }]));
  }
  return out;
}

/** the decision keys under an agent's work */
export function reviewKeys(ask: 'review' | 'blocked', drafts: number): Line {
  const k = (key: string, label: string): Seg[] => [keySeg(key), { text: ` ${label}   ` }];
  return ask === 'blocked'
    ? [...k('b', 'Answer and rerun'), ...k('d', 'Done'), ...k('w', 'Agent again'), ...k('m', 'Comment')]
    : [...k('d', 'Done'), ...k('b', 'Send back'), ...(drafts ? k('f', 'File follow-ups') : []), ...k('w', 'Agent again'), ...k('o', 'PR'), ...k('m', 'Comment')];
}

/** the issue page as lines, and where each comment starts (so a mention opens scrolled to it) */
export interface DetailLayout { lines: Line[]; anchors: Record<string, number> }

export function detailLines(issue: Issue, data: TuiData, threads: readonly WorkThread[], width: number, now: number, ui: IssueUi = {}): Line[] {
  return detailLayout(issue, data, threads, width, now, ui).lines;
}

export function detailLayout(issue: Issue, data: TuiData, threads: readonly WorkThread[], width: number, now: number, ui: IssueUi & { focusComment?: string } = {}): DetailLayout {
  const w = Math.max(20, width);
  const anchors: Record<string, number> = {};
  const lines: Line[] = [...headLines(issue, data, w, ui, 99)];
  const state = data.stateById.get(issue.stateId)?.type;
  const closed = state === 'completed' || state === 'canceled';
  const mine = myThread({ ...data, threads: new Map([[issue.id, [...threads]]]) }, issue.id);
  const ask = closed ? null : threadAsk(mine);
  if (mine && ask) lines.push(...agentSection(issue, data, mine, ask, w, now));
  lines.push([], ...fieldBlock(issue, data, now, ui, moreRows(issue, data)));
  lines.push([], ask ? reviewKeys(ask, followupsOf(data, issue.id).length) : [keySeg('m'), { text: ' comment   ' }, keySeg('e'), { text: ' edit   ' }, ...AGENT_LINE, { text: '   ' }, keySeg('o'), { text: ' browser' }]);

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

  // the agent's work shown at the top isn't repeated here
  const others = threads.filter(t => !(ask && t.id === mine?.id));
  if (others.length) {
    lines.push(...section('Agent work', w, others.length));
    others.forEach((t, i) => { if (i) lines.push([]); lines.push(...threadLines(t, data, w, now)); });
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
      anchors[c.id] = lines.length;
      const focus = ui.focusComment === c.id;
      const head: Line = [{ text: `${indent}${c === root ? '' : '↳ '}` }, { text: author?.name ?? 'Someone', bold: true, color: author?.color },
        ...(via ? [{ text: ` via ${via}`, color: theme.muted }] : []),
        { text: `  ${relTime(c.createdAt, now, { ago: true })}${c.editedAt ? ' (edited)' : ''}${c.resolvedAt ? ' · resolved' : ''}`, color: theme.muted },
        ...(focus ? [{ text: '   mentions you', color: theme.accent }] : [])];
      const body = markdownLines(c.body, w - indent.length - 2).map((l): Line => [{ text: `${indent}  ` }, ...l]);
      // the comment a mention opened at is lit, like a row under the cursor
      const lit = (l: Line): Line => (focus ? l.map(x => ({ ...x, bg: x.bg ?? theme.selBg })) : l);
      lines.push(lit(head), ...body.map(lit));
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
  return { lines, anchors };
}

// ---------- Today's detail pane ----------

const paneHead = (issue: Issue, data: TuiData, w: number): Line[] => {
  const st = data.stateById.get(issue.stateId);
  const team = data.teamById.get(issue.teamId);
  return [
    rightAlign([{ text: `${data.keyOf(issue)} · ${team?.name ?? ''}`, color: theme.muted }], st ? [{ text: `${STATE_ICON[st.type]} `, color: st.color }, { text: st.name, color: theme.muted }] : [], w),
    ...wrap(issue.title, w, { bold: true }).slice(0, 2),
    [],
  ];
};

const keysLine = (...pairs: Array<[string, string]>): Line => pairs.flatMap(([k, l], i) => [...(i ? [{ text: '   ' }] : []), keySeg(k), { text: ` ${l}` }]);

/** the agent's work in a few rows: who and how it stands, then summary, did, left, PR and what it noticed */
function agentPaneRows(issue: Issue, data: TuiData, t: WorkThread, w: number, now: number): Line[] {
  const ask = threadAsk(t);
  const status: Seg = ask === 'blocked' ? { text: 'blocked', color: theme.error } : ask === 'review' ? { text: t.state.status === 'finished' && t.state.outcome === 'done' ? 'done' : 'ready for review', color: theme.ok }
    : { text: '● working', color: theme.ok };
  const out: Line[] = [[{ text: threadWho(t, data), color: theme.muted }, { text: ' · ' }, status, ...(ask ? [] : [{ text: ` · ${relTime(t.updatedAt, now)}`, color: theme.muted }])]];
  const field = (label: string, text: string | null, color?: string) => {
    if (!text) return;
    wrap(text, w - 9).slice(0, 2).forEach((l, i) => out.push([{ text: i ? ' '.repeat(9) : padEnd(label, 9), color: theme.muted }, ...(color ? l.map(x => ({ ...x, color })) : l)]));
  };
  if (ask === 'blocked') field('blocked', t.progress.blocked ?? (t.state.status === 'finished' ? t.state.summary : null), theme.error);
  else if (t.state.status === 'finished') field('summary', t.state.summary);
  field('did', t.progress.did);
  field('left', t.progress.left);
  const pr = prSegs(issue.id, data, false);
  if (pr.length) out.push([{ text: padEnd('pr', 9), color: theme.muted }, ...pr]);
  const drafts = followupsOf(data, issue.id).length;
  if (drafts) out.push([{ text: padEnd('noticed', 9), color: theme.muted }, { text: `${drafts} follow-up draft${drafts === 1 ? '' : 's'}` }]);
  return out;
}

/** what the pane beside Today shows for the row under the cursor: the agent's work and the keys that decide it for
 *  a review or a blocked agent, the comment for a mention, an agent at work for In flight; else the issue as on a list */
export function todayPaneLines(row: { kind: 'need'; row: NeedRow } | { kind: 'flight'; row: FlightRow; pane: boolean } | { kind: 'next'; row: NextRow }, data: TuiData, width: number, height: number, now: number, ui: IssueUi = {}): Line[] {
  const w = Math.max(12, width);
  const issue = row.row.issue;
  if (!issue) {
    const r = row.row as NeedRow;
    return [[{ text: r.text, bold: true }], [], [{ text: r.kind === 'triage' ? 'enter opens the team, In Review and Triage first' : 'enter for more', color: theme.muted }]];
  }
  if (row.kind === 'need' && row.row.thread && (row.row.kind === 'review' || row.row.kind === 'blocked')) {
    const keys = row.row.kind === 'blocked' ? keysLine(['enter', 'open'], ['b', 'Answer and rerun']) : keysLine(['enter', 'review'], ['d', 'Done'], ['b', 'Send back']);
    return [...paneHead(issue, data, w), ...agentPaneRows(issue, data, row.row.thread, w, now), [], keys].slice(0, height);
  }
  if (row.kind === 'need' && row.row.kind === 'mention') {
    const c = row.row.commentId ? data.comments.find(x => x.id === row.row.commentId) : undefined;
    const who = data.userById.get(c?.userId ?? row.row.actorId ?? '')?.name ?? 'Someone';
    const body = c ? markdownLines(c.body, w - 2).slice(0, 4).map((l): Line => [{ text: '  ' }, ...l]) : [];
    return [...paneHead(issue, data, w), [{ text: who, bold: true }, { text: ` mentioned you · ${relTime(c?.createdAt ?? row.row.at, now)}`, color: theme.muted }], ...body, [], keysLine(['enter', 'reply'], ['r', 'Done: mark read'])].slice(0, height);
  }
  if (row.kind === 'flight' && row.row.thread) {
    return [...paneHead(issue, data, w), ...agentPaneRows(issue, data, row.row.thread, w, now), [], row.pane ? keysLine(['enter', 'go to its tmux pane'], ['m', 'comment']) : keysLine(['enter', 'open'], ['m', 'comment'])].slice(0, height);
  }
  const note: Line[] = row.kind === 'next' ? [[{ text: 'Up next', color: theme.muted }, { text: ` · ${row.row.reason}` }, { text: '   enter starts it', color: theme.muted }], []]
    : row.kind === 'flight' && row.pane ? [[{ text: 'Agent starting in a tmux pane', color: theme.ok }, { text: '  enter goes to it', color: theme.muted }], []]
    : row.kind === 'need' ? [[{ text: row.row.reason, color: theme.accent }, { text: ` · ${relTime(row.row.at, now)}`, color: theme.muted }], []] : [];
  return [...note, ...paneLines(issue, data, w, height - note.length, now, ui)];
}

// ---------- the picker, drawn under its field ----------

/** a bordered dropdown: the filter, then numbered options (1-9 pick, the cursor row lit). `title` heads the border
 *  when it floats over the list instead of opening under a field */
/** the options a dropdown shows at once; floating over a short terminal it shows fewer */
export const PICKER_ROWS = 9;
export const floatingPickerRows = (rows: number) => Math.max(3, Math.min(PICKER_ROWS, rows - 10));

export function pickerLines(o: Extract<Overlay, { kind: 'picker' }>, data: TuiData, width: number, maxRows: number, title?: string): Line[] {
  const w = Math.max(16, Math.min(width, 40));
  const inner = w - 4;
  const options = filteredOptions(o, data);
  const multi = o.field === 'labels';
  const cursor = Math.min(o.cursor, Math.max(0, options.length - 1));
  const room = Math.max(1, maxRows);
  const start = Math.max(0, Math.min(cursor - room + 1, options.length - room));
  const edge = (l: Line, bg?: string): Line => {
    const fitted = fitTo(l, inner);
    return [{ text: '│ ', color: theme.border }, ...(bg ? fitted.map(x => ({ ...x, bg })) : fitted), { text: ' │', color: theme.border }];
  };
  const head = title ? truncate(` ${title} `, w - 4) : '';
  const rows: Line[] = options.slice(start, start + room).map(({ option, match }, n) => {
    const at = start + n;
    const on = o.selected.includes(option.id);
    const left: Seg[] = [{ text: at < 9 ? `${at + 1}  ` : '   ', color: theme.key, bold: true },
      ...(multi ? [{ text: on ? '◉ ' : '○ ', color: on ? theme.accent : theme.muted }] : []),
      ...(option.icon ? [{ ...option.icon, text: `${option.icon.text.trim() || '·'} ` }] : []),
      ...highlight(option.label, match.indices).map(r => ({ text: r.text, bold: at === cursor || r.hit, ...(r.hit ? { color: theme.accent } : {}) }))];
    const right: Seg[] = !multi && option.current ? [{ text: 'current', color: theme.muted }] : option.hint ? [{ text: option.hint, color: theme.muted }] : [];
    return edge(spread(left, right, inner), at === cursor ? theme.selBg : undefined);
  });
  return [
    [{ text: `╭─${head}${'─'.repeat(Math.max(0, w - 3 - displayWidth(head)))}╮`, color: theme.border }],
    edge([{ text: '› ', color: theme.accent }, ...(o.query.value ? [{ text: o.query.value }, { text: ' ', inverse: true }] : [{ text: 'type to filter', color: theme.muted }])]),
    edge([]),
    ...(rows.length ? rows : [edge([{ text: 'No matches', color: theme.muted }])]),
    [{ text: `╰${'─'.repeat(w - 2)}╯`, color: theme.border }],
  ];
}

function fitTo(l: Line, width: number): Line {
  const out: Line = [];
  let used = 0;
  for (const x of l) {
    const t = truncate(x.text, width - used);
    if (!t) break;
    out.push({ ...x, text: t });
    used += displayWidth(t);
  }
  return used < width ? [...out, { text: ' '.repeat(width - used) }] : out;
}

function spread(left: Seg[], right: Seg[], width: number): Line {
  const rw = right.reduce((n, x) => n + displayWidth(x.text), 0);
  const l = fitTo(left, Math.max(1, width - rw - (rw ? 1 : 0))).filter((x, i, all) => i < all.length - 1 || x.text.trim() || !rw);
  const lw = l.reduce((n, x) => n + displayWidth(x.text), 0);
  return [...l, { text: ' '.repeat(Math.max(0, width - lw - rw)) }, ...right];
}
