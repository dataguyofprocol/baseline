import { Box, Text } from 'ink';
import { findCtx, findSections, menuCtxFor } from './commands.js';
import { agentPreview, helpSections, introLines, MENUS, rowLabel, SUBMENU } from './menus.js';
import type { TuiData } from './data.js';
import { hintsFor, type Context } from './keys.js';
import { displayWidth, notificationRows, padEnd, padStart, progressBar, projectRows, relTime, truncate, wrap, type Line, type Seg } from './model.js';
import { floatingPickerRows, pickerLines } from './detail.js';
import { draftChoices, draftValue, PICKER_TITLE } from './overlays.js';
import { FIND_SUGGESTIONS, findItems } from './find.js';
import { DRAFT_FIELDS, type Overlay, type Sheet, type TuiState } from './state.js';
import { HEALTH, keySeg, STATE_ICON, theme } from './theme.js';
import { fieldBlock, fieldSegs, LineView, Modal } from './ui.js';

const BAR: Seg = { text: '▍', color: theme.accent };

function hintLine(contexts: Context[]): Line {
  return hintsFor(contexts).flatMap((h, i) => [{ text: `${i ? '   ' : ''}${h.key}`, bold: true }, { text: ` ${h.label}`, color: theme.muted }]);
}

function rightAlign(left: Seg[], right: Seg[], width: number): Line {
  const rw = right.reduce((n, s) => n + displayWidth(s.text), 0);
  const out: Seg[] = [];
  let used = 0;
  for (const s of left) {
    const t = truncate(s.text, width - rw - 1 - used);
    if (!t) break;
    out.push({ ...s, text: t });
    used += displayWidth(t);
  }
  return [...out, { text: ' '.repeat(Math.max(1, width - used - rw)) }, ...right];
}

export function helpLines(width: number): Line[] {
  const sections = helpSections().map(sec => {
    const keyW = Math.max(10, ...sec.rows.filter(r => !r.sub).map(r => displayWidth(r.key) + 2));
    return [
      [{ text: sec.group, bold: true, color: theme.accent }] as Line,
      ...sec.rows.map((r): Line => [{ text: r.sub ? '  ' : '' }, { text: padEnd(r.key, r.sub ? keyW - 2 : keyW), color: theme.key, bold: true }, { text: r.label, color: r.sub ? theme.muted : undefined }]),
      [] as Line,
    ];
  });
  if (width < 90) return sections.flat();
  const total = sections.reduce((n, s) => n + s.length, 0);
  const left: Line[] = [], right: Line[] = [];
  for (const sec of sections) (left.length < total / 2 ? left : right).push(...sec);
  const colW = Math.floor((width - 2) / 2);
  return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
    const l = left[i] ?? [];
    const lw = l.reduce((n, s) => n + displayWidth(s.text), 0);
    return [...truncLine(l, colW), { text: ' '.repeat(Math.max(2, colW - Math.min(lw, colW) + 2)) }, ...(right[i] ?? [])];
  });
}

function truncLine(l: Line, width: number): Line {
  const out: Line = [];
  let used = 0;
  for (const x of l) { if (!x.text) continue; const t = truncate(x.text, width - used); if (!t) break; out.push({ ...x, text: t }); used += displayWidth(t); }
  return out;
}

interface Props { s: TuiState; data: TuiData; contexts: Context[]; cols: number; rows: number; now: number; onHelpMax: (n: number) => void; onFindRows: (n: number) => void; tabs: number; target: string; tmux: boolean }

export function OverlayView(p: Props) {
  const o = p.s.overlay;
  switch (o.kind) {
    case 'none': return null;
    case 'picker': return <PickerView {...p} o={o} />;
    case 'find': return <FindView {...p} o={o} />;
    case 'compose': return <ComposeView {...p} o={o} />;
    case 'help': return <HelpView {...p} o={o} />;
    case 'menu': return <MenuView {...p} o={o} />;
    case 'sheet': return <SheetView {...p} sheet={o.sheet} />;
  }
}

function place(cols: number, rows: number, width: number, height: number) {
  const w = Math.min(width, cols - 2);
  return { width: w, left: Math.max(0, Math.floor((cols - w) / 2)), top: Math.max(0, Math.min(Math.floor((rows - height) / 3), rows - height - 1)) };
}

function PickerView({ data, cols, rows, o }: Props & { o: Extract<Overlay, { kind: 'picker' }> }) {
  const issue = data.issueById.get(o.issueId);
  const lines = pickerLines(o, data, Math.min(44, cols - 4), floatingPickerRows(rows), `${PICKER_TITLE[o.field]} · ${issue ? data.keyOf(issue) : ''}`);
  const width = lines[0].reduce((n, x) => n + displayWidth(x.text), 0);
  const { left, top } = place(cols, rows, width, lines.length);
  return (
    <Box position="absolute" left={left} top={top} flexDirection="column" width={width}>
      {lines.map((l, i) => <LineView key={i} line={l} width={width} />)}
    </Box>
  );
}

function FindView({ s, data, cols, rows, now, o, onFindRows }: Props & { o: Extract<Overlay, { kind: 'find' }> }) {
  const sections = findSections(s, o.query.value, now);
  const items = findItems(sections);
  const cursor = Math.min(o.cursor, Math.max(0, items.length - 1));
  const inner = cols - 2;
  const lines: Array<{ line: Line; sel?: boolean; at?: number }> = [];
  if (!o.query.value.trim()) {
    lines.push({ line: [{ text: 'try typing   ', color: theme.muted }, ...FIND_SUGGESTIONS.flatMap(t => [keySeg(` ${t} `), { text: '  ' }])] }, { line: [] });
  }
  let n = 0;
  for (const sec of sections) {
    lines.push({ line: [{ text: sec.title, color: theme.muted, bold: true }] });
    if (!sec.items.length) lines.push({ line: [{ text: `  no issue titles match “${o.query.value.trim()}”`, color: theme.muted }] });
    for (const it of sec.items) {
      const sel = n === cursor;
      const bar: Seg = sel ? { text: '▌ ', color: theme.accent } : { text: '  ' };
      if (it.issue) {
        const st = data.stateById.get(it.issue.stateId);
        lines.push({ line: [bar, { text: padEnd(data.keyOf(it.issue), 9), color: sel ? undefined : theme.muted, bold: sel }, { text: `${st ? STATE_ICON[st.type] : '○'} `, color: st?.color }, { text: it.label, bold: sel }], sel, at: n });
      } else {
        const left: Line = [bar, { text: it.label, bold: sel }, ...(it.detail ? [{ text: `   ${it.detail}`, color: theme.muted }] : [])];
        lines.push({ line: rightAlign(left, it.key ? it.key.split(' ').flatMap((k, i) => [...(i ? [{ text: ' ' }] : []), keySeg(k)]) : [], inner), sel, at: n });
      }
      if (sel && it.agent) {
        const mc = findCtx(s, now).mc;
        if (mc) lines.push(...agentPreview(mc, inner - 4).map(l => ({ line: [{ text: '    ' }, ...l] })));
      }
      n++;
    }
    lines.push({ line: [] });
  }
  const room = Math.max(4, rows - 6);
  const selLine = Math.max(0, lines.findIndex(l => l.sel));
  const start = Math.max(0, Math.min(selLine - room + 3, lines.length - room));
  const shown = lines.slice(start, start + room);
  onFindRows(shown.filter(l => l.at !== undefined).length);
  const top = rows - 2 - shown.length - 1;
  return (
    <Box position="absolute" left={0} top={top} flexDirection="column" width={cols}>
      <LineView line={[{ text: '─'.repeat(cols), color: theme.border }]} width={cols} />
      {shown.map((l, i) => <Box key={i} paddingX={1}><LineView line={l.line} width={inner} bg={l.sel ? theme.selBg : undefined} /></Box>)}
      <Box paddingX={1}><LineView line={[{ text: '› ', color: theme.accent, bold: true }, ...fieldSegs(o.query, inner - 2, 'an issue key or title, or what to do: done, assign ada, agent, new <title>, group by priority…')]} width={inner} /></Box>
    </Box>
  );
}

const FIELD_LABEL: Record<typeof DRAFT_FIELDS[number], string> = { title: 'Title', team: 'Team', state: 'Status', priority: 'Priority', assignee: 'Assignee', project: 'Project' };

function ComposeView({ data, contexts, cols, rows, o }: Props & { o: Extract<Overlay, { kind: 'compose' }> }) {
  if (o.target === 'issue') {
    const width = cols - 2, left = 1, top = sheetTop(rows, DRAFT_FIELDS.length + 5);
    const inner = width - 4;
    const lines: Line[] = DRAFT_FIELDS.map((f): Line => {
      const focused = o.field === f;
      const label: Seg[] = [focused ? BAR : { text: ' ' }, { text: ' ' }, { text: padEnd(FIELD_LABEL[f], 10), color: focused ? theme.accent : theme.muted, bold: focused }];
      if (f === 'title') return [...label, ...(focused ? fieldSegs(o.input, inner - 13, 'What needs doing?') : [{ text: truncate(o.input.value || 'What needs doing?', inner - 13), color: o.input.value ? undefined : theme.muted }])];
      const choice = draftChoices(f, o.draft, data).find(c => c.id === draftValue(f, o.draft));
      return [...label, ...(focused ? [{ text: '‹ ', color: theme.accent }] : [{ text: '  ' }]), ...(choice?.icon ? [choice.icon, { text: ' ' }] : []), { text: choice?.label ?? '—', bold: focused }, ...(focused ? [{ text: ' ›', color: theme.accent }] : [])];
    });
    return <Modal title="New issue" rows={[[], ...lines]} width={width} left={left} top={top} footer={hintLine(contexts)} />;
  }
  const issue = data.issueById.get(o.issueId);
  const key = issue ? data.keyOf(issue) : '';
  const width = cols - 2;
  const lines: Line[] = [[], ...fieldBlock(o.input, width - 4, 'Issue title', 6)];
  return <Modal title="Rename" subtitle={key} rows={lines} width={width} left={1} top={sheetTop(rows, lines.length + 4)} footer={hintLine(contexts)} />;
}

const sheetTop = (rows: number, height: number) => Math.max(0, rows - 2 - height);
const sheetRoom = (rows: number) => Math.max(4, Math.floor((rows - 2) * 0.6) - 4);

const chip = (k: string): Seg => keySeg(k);

function SheetView({ s, data, contexts, cols, rows, now, sheet, tmux }: Props & { sheet: Sheet }) {
  const width = cols - 2;
  const inner = width - 4;
  const room = sheetRoom(rows);
  const issue = 'issueId' in sheet ? data.issueById.get(sheet.issueId) : undefined;
  const key = issue ? data.keyOf(issue) : '';
  let title = '';
  let body: Line[] = [];
  const list = (items: Line[], cursor: number, max: number): Line[] => {
    const start = Math.max(0, Math.min(cursor - max + 1, items.length - max));
    return items.slice(start, start + max).map((l, i) => (start + i === cursor ? l.map(x => ({ ...x, bg: x.bg ?? theme.selBg })) : l));
  };
  switch (sheet.type) {
    case 'start': {
      title = `Start ${key}`;
      const st = issue ? data.stateById.get(issue.stateId) : undefined;
      const target = issue ? data.states.filter(x => x.teamId === issue.teamId && x.type === 'started').sort((a, b) => a.position - b.position)[0] : undefined;
      const agent = (process.env.BASELINE_AGENT?.trim() || 'claude').split(/\s+/)[0] === 'claude' ? 'Claude Code' : 'The agent';
      const options: Array<[string, string]> = [
        [`${agent} in a new tmux pane beside this one`, tmux ? '' : 'needs tmux'],
        [`${agent} here; back to Baseline when it exits`, ''],
        ['Copy the prompt; I\'ll run it in my own tool', ''],
        ['Just start it, no agent', ''],
      ];
      const rowsOut = options.map(([label, note], i): Line => {
        const off = i === 0 && !tmux;
        const right = i === (tmux ? 0 : 1) ? 'default' : note;
        const left: Seg[] = [off ? { text: String(i + 1), color: theme.muted } : chip(String(i + 1)), { text: ' ' }, { text: label, ...(off ? { color: theme.muted } : { bold: i === sheet.cursor }) }];
        return rightAlign(left, right ? [{ text: right, color: theme.muted }] : [], inner);
      });
      body = [
        [{ text: 'branch  ', color: theme.muted }, ...(sheet.branch ? [{ text: sheet.branch.name, color: theme.accent }, { text: sheet.branch.exists ? '  exists; checked out' : '  new, from the default branch', color: theme.muted }] : [{ text: '…', color: theme.muted }])],
        [{ text: 'status  ', color: theme.muted }, { text: `${st?.name ?? '?'} → ${st?.type === 'started' ? st.name : target?.name ?? 'In Progress'}, yours` }],
        [],
        ...list(rowsOut, sheet.cursor, 4),
      ];
      break;
    }
    case 'note': {
      const what = { comment: `Comment on ${key}`, reply: `Reply${sheet.to ? ` to ${sheet.to}` : ''} on ${key}`, sendBack: `Send back ${key}`, answer: `Answer and rerun ${key}` }[sheet.purpose];
      title = what;
      const work = issue ? data.states.filter(x => x.teamId === issue.teamId && x.type === 'started' && x.name.trim().toLowerCase() !== 'in review').sort((a, b) => a.position - b.position)[0] : undefined;
      const lead = sheet.purpose === 'sendBack' ? `Your note is posted as a comment, and ${key} moves to ${work?.name ?? 'In Progress'}.`
        : sheet.purpose === 'answer' ? 'Your answer is posted as a comment, then the agent runs again with it in its prompt.'
        : truncate(issue?.title ?? '', inner);
      body = [[{ text: truncate(lead, inner), color: theme.muted }], [], ...fieldBlock(sheet.input, inner - 2, sheet.purpose === 'answer' ? 'Your answer…' : 'Write a note… (markdown works)', 4).map((l, i): Line => [{ text: i ? '  ' : '› ', color: theme.accent }, ...l])];
      if (sheet.purpose === 'answer') {
        const labels = ['in a new tmux pane', 'here', 'only post the comment'];
        body.push([], [{ text: 'Run it   ', color: theme.muted }, ...labels.flatMap((l, i): Seg[] => {
          const off = i === 0 && !tmux;
          return [...(i ? [{ text: '   ' }] : []), i === sheet.rerun ? { text: ` ${l} `, bg: theme.selBg, bold: true } : { text: l, color: off ? '#4a4a4a' : theme.muted }];
        })]);
      }
      break;
    }
    case 'followups': {
      title = `File follow-ups from ${key}`;
      const drafts = sheet.ids.map(id => data.drafts.find(d => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
      const lines = drafts.map((d): Line => {
        const on = sheet.ticked.includes(d.id);
        const team = data.teamById.get(d.teamId);
        const triage = data.states.find(x => x.teamId === d.teamId && x.type === 'triage') && team?.triageEnabled ? 'Triage' : 'Backlog';
        return rightAlign([{ text: on ? '[x] ' : '[ ] ', color: on ? theme.ok : theme.muted }, { text: d.title, ...(on ? {} : { color: theme.muted }) }], on ? [{ text: `→ ${team?.name ?? ''} · ${triage}`, color: theme.muted }] : [], inner);
      });
      const n = sheet.ticked.length;
      body = [...list(lines, sheet.cursor, room - 2), [], [{ text: `enter files ${n ? `${n} follow-up${n === 1 ? '' : 's'}` : 'none'}, then ${key} is Done`, color: theme.muted }]];
      break;
    }
    case 'standup': {
      title = 'Standup';
      body = sheet.error ? [[{ text: sheet.error, color: theme.error }]]
        : sheet.text === null ? [[{ text: 'Asking for what you did since yesterday…', color: theme.muted }]]
        : sheet.text.split('\n').flatMap(l => wrap(l, inner)).slice(0, room);
      break;
    }
    case 'projects': {
      title = 'Projects';
      const items = projectRows(data).map((r): Line => {
        const p = r.project;
        const bar = progressBar(r.done, r.total, 10);
        const health = HEALTH[p.health];
        const closed = p.status === 'completed' || p.status === 'canceled';
        return rightAlign([{ text: '◆ ', color: p.color }, { text: p.name, ...(closed ? { color: theme.muted } : {}) }],
          [{ text: bar.filled, color: p.color }, { text: bar.empty, color: '#3a3a3a' }, { text: ` ${padStart(`${r.done}/${r.total}`, 5)}  `, color: theme.muted },
            closed ? { text: padEnd(p.status === 'completed' ? 'Completed' : 'Canceled', 9), color: theme.muted } : { text: padEnd(health.label, 9), color: health.color }], inner);
      });
      body = items.length ? list(items, sheet.cursor, room) : [[{ text: 'No projects yet', color: theme.muted }]];
      break;
    }
    case 'notifications': {
      title = 'All notifications';
      const items = notificationRows(data, now).map((it): Line => rightAlign(
        [{ text: it.unread ? '● ' : '  ', color: theme.accent }, { text: padEnd(it.key ?? '', 9), color: theme.muted }, { text: it.subject, bold: it.unread, ...(it.unread ? {} : { color: theme.muted }) }],
        [{ text: `${it.who} ${it.verb}${it.count > 1 ? ` +${it.count - 1}` : ''}  ${relTime(it.notification.createdAt, now).replace('just now', 'now')}`, color: theme.muted }], inner));
      body = items.length ? list(items, sheet.cursor, room) : [[{ text: 'No notifications', color: theme.muted }]];
      break;
    }
  }
  void s;
  return <Modal title={title} rows={[...body]} width={width} left={1} top={sheetTop(rows, body.length + 4)} footer={hintLine(contexts)} />;
}

export const helpRows = (rows: number) => Math.max(3, rows - 6);

function HelpView({ data, cols, rows, o, onHelpMax, tabs, target }: Props & { o: Extract<Overlay, { kind: 'help' }> }) {
  const width = Math.min(cols - 2, o.intro ? 84 : 104);
  const inner = width - 4;
  const card = introLines(data, tabs, target, inner);
  const all = o.intro ? card : [...card.slice(0, -1), [{ text: '─'.repeat(inner), color: theme.border }], [], ...helpLines(inner)];
  const room = helpRows(rows);
  const max = Math.max(0, all.length - room);
  onHelpMax(max);
  const scroll = Math.min(o.scroll, max);
  const lines = all.slice(scroll, scroll + room);
  const { left, top } = place(cols, rows, width, lines.length + 2);
  return <Modal title={o.intro ? 'Welcome' : 'Keys'} subtitle={max ? (scroll < max ? '↑↓ for more' : 'end') : undefined} rows={lines} width={width} left={left} top={o.intro ? top : Math.min(top, 1)} />;
}

function MenuView({ s, cols, rows, now, o }: Props & { o: Extract<Overlay, { kind: 'menu' }> }) {
  const mc = menuCtxFor(s, o.issueId, now);
  if (!mc) return null;
  const menu = MENUS[o.path[o.path.length - 1]];
  const width = Math.min(cols - 2, menu.extra ? 84 : 64);
  const inner = width - 4;
  const labelW = Math.max(...menu.rows.map(r => displayWidth(rowLabel(r, mc)))) + 4;
  const rule: Line = [{ text: '─'.repeat(inner), color: theme.border }];
  const body: Array<{ line: Line; sel?: boolean }> = [{ line: [{ text: truncate(menu.title(mc), inner), bold: true }] }, { line: rule }];
  menu.rows.forEach((r, i) => {
    if (i && r.section !== menu.rows[i - 1].section) body.push({ line: rule });
    const ok = r.enabled?.(mc) ?? true;
    const sub = !!SUBMENU[r.command];
    const label = rowLabel(r, mc);
    const left: Line = [ok === true ? keySeg(r.key) : { text: r.key, color: theme.muted }, { text: '  ' },
      { text: padEnd(label, labelW), ...(ok === true ? (sub ? { bold: true } : {}) : { color: theme.muted }) }, ...(r.value?.(mc) ?? [])];
    body.push({ line: sub ? rightAlign(left, [{ text: '›', color: theme.muted }], inner) : left, sel: i === o.cursor });
  });
  if (menu.extra) body.push({ line: rule }, ...menu.extra(mc, inner).map(line => ({ line })));
  body.push({ line: rule }, { line: [{ text: `press a letter  ·  ↑↓ and enter  ·  ${o.path.length > 1 ? 'backspace goes back  ·  ' : ''}esc closes`, color: theme.muted }] });
  const left = Math.max(0, Math.floor((cols - width) / 2));
  const top = Math.max(0, Math.min(3, rows - body.length - 4));
  return (
    <Box position="absolute" left={left} top={top} flexDirection="column" width={width}>
      <Text color={theme.border}>╭{'─'.repeat(width - 2)}╮</Text>
      {body.map((b, i) => (
        <Text key={i}>
          <Text color={theme.border}>│ </Text>
          <LineView line={b.line} width={inner} bg={b.sel ? theme.selBg : undefined} />
          <Text color={theme.border}> │</Text>
        </Text>
      ))}
      <Text color={theme.border}>╰{'─'.repeat(width - 2)}╯</Text>
    </Box>
  );
}
