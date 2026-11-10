// The issue page as pre-wrapped lines, so scrolling is exact at any width. Pure.
import { PRIORITY_LABELS, type Issue } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import type { TuiData } from './data.js';
import { activityText, displayWidth, dueLabel, markdownLines, padEnd, relTime, tildePath, truncate, wrap, wrapSegs, type Line, type Seg } from './model.js';
import { priorityGlyph, STATE_ICON, theme } from './theme.js';

const none: Seg = { text: '—', color: theme.muted };

function section(title: string, width: number, count?: number): Line[] {
  const head = ` ${title}${count !== undefined ? ` ${count}` : ''} `;
  return [[], [{ text: '──', color: theme.border }, { text: head, bold: true }, { text: '─'.repeat(Math.max(0, width - head.length - 2)), color: theme.border }]];
}

function meta(issue: Issue, data: TuiData, now: number): Array<[string, Seg[]]> {
  const state = data.stateById.get(issue.stateId);
  const pg = priorityGlyph(issue.priority);
  const assignee = issue.assigneeId ? data.userById.get(issue.assigneeId) : undefined;
  const project = issue.projectId ? data.projectById.get(issue.projectId) : undefined;
  const cycle = issue.cycleId ? data.cycles.find(c => c.id === issue.cycleId) : undefined;
  const milestone = issue.milestoneId ? data.milestones.find(m => m.id === issue.milestoneId) : undefined;
  const location = issue.locationId ? data.locations.find(l => l.id === issue.locationId) : undefined;
  const labels = issue.labelIds.map(id => data.labelById.get(id)).filter(l => !!l);
  const due = issue.dueDate ? dueLabel(issue.dueDate, now) : undefined;
  const rows: Array<[string, Seg[]]> = [
    ['Status', state ? [{ text: `${STATE_ICON[state.type]} `, color: state.color }, { text: state.name }] : [none]],
    ['Priority', [{ text: `${pg.text.trim() || '·'} `, color: pg.color }, { text: PRIORITY_LABELS[issue.priority], ...(issue.priority === 0 ? { color: theme.muted } : {}) }]],
    ['Assignee', assignee ? [{ text: '● ', color: assignee.color }, { text: assignee.name }] : [{ text: 'Unassigned', color: theme.muted }]],
    ['Project', project ? [{ text: '◆ ', color: project.color }, { text: project.name }] : [none]],
    ['Labels', labels.length ? labels.flatMap((l, i) => [{ text: `${i ? '  ' : ''}● `, color: l.color }, { text: l.name }]) : [none]],
    ['Cycle', cycle ? [{ text: cycle.name || `Cycle ${cycle.number}` }] : [none]],
    ['Estimate', issue.estimate !== null ? [{ text: `${issue.estimate} pt${issue.estimate === 1 ? '' : 's'}` }] : [none]],
    ['Due', due ? [{ text: due.text, color: due.tone === 'overdue' ? theme.error : due.tone === 'soon' ? theme.warn : undefined }] : [none]],
    ['Location', location ? [{ text: location.name }, { text: ` ${tildePath(location.path)}`, color: theme.muted }] : [none]],
  ];
  if (milestone) rows.push(['Milestone', [{ text: milestone.name }]]);
  return rows;
}

const LABEL_W = 10;

function metaLines(rows: Array<[string, Seg[]]>, width: number, oneColumn = false): Line[] {
  const cell = (r: [string, Seg[]], w: number): Line => {
    const out: Line = [{ text: padEnd(r[0], LABEL_W), color: theme.muted }];
    let room = w - LABEL_W;
    for (const s of r[1]) {
      if (room <= 0) break;
      const t = truncate(s.text, room);
      out.push({ ...s, text: t });
      room -= displayWidth(t);
    }
    return out;
  };
  if (width < 64 || oneColumn) return rows.map(r => cell(r, width));
  const colW = Math.floor((width - 2) / 2);
  const lines: Line[] = [];
  for (let i = 0; i < rows.length; i += 2) {
    const left = cell(rows[i], colW);
    const leftW = left.reduce((n, s) => n + displayWidth(s.text), 0);
    lines.push(rows[i + 1] ? [...left, { text: ' '.repeat(colW - leftW + 2) }, ...cell(rows[i + 1], colW)] : left);
  }
  return lines;
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

export function detailLines(issue: Issue, data: TuiData, threads: readonly WorkThread[], width: number, now: number): Line[] {
  const w = Math.max(20, width);
  const team = data.teamById.get(issue.teamId);
  const parent = issue.parentId ? data.issueById.get(issue.parentId) : undefined;
  const lines: Line[] = [];
  lines.push([{ text: data.keyOf(issue), color: theme.accent, bold: true }, { text: `  ${team?.name ?? ''}`, color: theme.muted },
    ...(parent ? [{ text: `  ›  sub-issue of ${data.keyOf(parent)} `, color: theme.muted }, { text: truncate(parent.title, Math.max(0, w - 40)), color: theme.muted }] : [])]);
  lines.push(...wrap(issue.title, w, { bold: true }));
  lines.push([]);
  lines.push(...metaLines(meta(issue, data, now), w));

  lines.push(...section('Description', w));
  lines.push(...(issue.description.trim() ? markdownLines(issue.description, w) : [[{ text: 'No description. Press e to write one in your editor.', color: theme.muted, italic: true }]]));

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
  lines.push(...section('Comments', w, comments.length));
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
      const who = data.userById.get(a.userId)?.name ?? 'Someone';
      lines.push(...wrapSegs([{ text: '· ', color: theme.muted }, { text: who, color: theme.muted, bold: true }, { text: ` ${activityText(a, data)}`, color: theme.muted }, { text: `  ${relTime(a.createdAt, now)}`, color: theme.muted }], w, '  '));
    }
  }
  lines.push([]);
  return lines;
}

const PEEK_META = ['Status', 'Priority', 'Assignee', 'Project', 'Labels', 'Due'];

/** the peek pane: the issue under the list cursor, cut to `height` rows; the description gets what the rest leaves */
export function peekLines(issue: Issue, data: TuiData, width: number, height: number, now: number): Line[] {
  const w = Math.max(12, width);
  const team = data.teamById.get(issue.teamId);
  const head: Line[] = [
    [{ text: data.keyOf(issue), color: theme.accent, bold: true }, { text: `  ${team?.name ?? ''}`, color: theme.muted }],
    ...wrap(issue.title, w, { bold: true }).slice(0, 3),
    [],
    ...metaLines(meta(issue, data, now).filter(([label]) => PEEK_META.includes(label)), w, true),
  ];
  const comments = data.comments.filter(c => c.issueId === issue.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last = comments[comments.length - 1];
  const tail: Line[] = [...section('Comments', w, comments.length)];
  if (last) {
    const author = data.userById.get(last.userId);
    tail.push([{ text: author?.name ?? 'Someone', bold: true, color: author?.color }, { text: `  ${relTime(last.createdAt, now, { ago: true })}`, color: theme.muted }]);
    tail.push(...markdownLines(last.body, w - 2).slice(0, 3).map(l => [{ text: '  ' }, ...l]));
  } else tail.push([{ text: 'No comments yet', color: theme.muted, italic: true }]);

  const room = height - head.length - tail.length - 2;
  const desc = issue.description.trim() ? markdownLines(issue.description, w) : [[{ text: 'No description', color: theme.muted, italic: true }] as Line];
  const body: Line[] = room < 2 ? [] : [...section('Description', w).slice(1),
    ...(desc.length > room - 1 ? [...desc.slice(0, Math.max(1, room - 2)), [{ text: '… enter for the whole issue', color: theme.muted }] as Line] : desc)];
  return [...head, ...(body.length ? [[] as Line, ...body] : []), ...tail].slice(0, height);
}
