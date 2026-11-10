// What draws over the screen: the space menu, a picker with no field on screen, / find, compose forms and help.
import { Box, Text } from 'ink';
import { findCtx, findSections, menuCtxFor } from './commands.js';
import { agentPreview, MENUS, rowLabel, SUBMENU } from './menus.js';
import type { TuiData } from './data.js';
import { helpSections, hintsFor, type Context } from './keys.js';
import { displayWidth, padEnd, truncate, type Line, type Seg } from './model.js';
import { pickerLines } from './detail.js';
import { draftChoices, draftValue, PICKER_TITLE } from './overlays.js';
import { FIND_SUGGESTIONS, findItems } from './find.js';
import { DRAFT_FIELDS, type Overlay, type TuiState } from './state.js';
import { keySeg, STATE_ICON, theme } from './theme.js';
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

/** two columns of key help when there is room, else one */
export function helpLines(width: number): Line[] {
  const sections = helpSections().map(sec => [
    [{ text: sec.group, bold: true, color: theme.accent }] as Line,
    ...sec.rows.map((r): Line => [{ text: padEnd(r.key, 15), bold: true }, { text: r.label, color: theme.muted }]),
    [] as Line,
  ]);
  if (width < 76) return sections.flat();
  const total = sections.reduce((n, s) => n + s.length, 0);
  const left: Line[] = [], right: Line[] = [];
  for (const sec of sections) (left.length < total / 2 ? left : right).push(...sec);
  const colW = Math.floor((width - 2) / 2);
  return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
    const l = left[i] ?? [];
    const lw = l.reduce((n, s) => n + displayWidth(s.text), 0);
    return [...l, { text: ' '.repeat(Math.max(2, colW - lw + 2)) }, ...(right[i] ?? [])];
  });
}

interface Props { s: TuiState; data: TuiData; contexts: Context[]; cols: number; rows: number; now: number; onHelpMax: (n: number) => void }

export function OverlayView(p: Props) {
  const o = p.s.overlay;
  switch (o.kind) {
    case 'none': return null;
    case 'picker': return <PickerView {...p} o={o} />;
    case 'find': return <FindView {...p} o={o} />;
    case 'compose': return <ComposeView {...p} o={o} />;
    case 'help': return <HelpView {...p} o={o} />;
    case 'menu': return <MenuView {...p} o={o} />;
  }
}

function place(cols: number, rows: number, width: number, height: number) {
  const w = Math.min(width, cols - 2);
  return { width: w, left: Math.max(0, Math.floor((cols - w) / 2)), top: Math.max(0, Math.min(Math.floor((rows - height) / 3), rows - height - 1)) };
}

/** the picker floating over the list, when no detail pane or issue page shows the field it changes */
function PickerView({ data, cols, rows, o }: Props & { o: Extract<Overlay, { kind: 'picker' }> }) {
  const issue = data.issueById.get(o.issueId);
  const lines = pickerLines(o, data, Math.min(44, cols - 4), Math.max(3, Math.min(9, rows - 10)), `${PICKER_TITLE[o.field]} · ${issue ? data.keyOf(issue) : ''}`);
  const width = lines[0].reduce((n, x) => n + displayWidth(x.text), 0);
  const { left, top } = place(cols, rows, width, lines.length);
  return (
    <Box position="absolute" left={left} top={top} flexDirection="column" width={width}>
      {lines.map((l, i) => <LineView key={i} line={l} width={width} />)}
    </Box>
  );
}

/** `/`: a prompt at the bottom with the results panel above it, over the lower part of the screen */
function FindView({ s, data, cols, rows, now, o }: Props & { o: Extract<Overlay, { kind: 'find' }> }) {
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
    const { width, left, top } = place(cols, rows, 72, DRAFT_FIELDS.length + 5);
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
  const { width, left, top } = place(cols, rows, 80, 12);
  const inner = width - 4;
  const block = fieldBlock(o.input, inner, o.target === 'comment' ? 'Write a comment… (markdown works)' : 'Issue title', 6);
  const lines: Line[] = o.target === 'title'
    ? [[], ...block]
    : [[{ text: truncate(issue?.title ?? '', inner), color: theme.muted }], [], ...block];
  return <Modal title={o.target === 'comment' ? 'Comment' : 'Rename'} subtitle={key} rows={lines} width={width} left={left} top={top} footer={hintLine(contexts)} />;
}

function HelpView({ contexts, cols, rows, o, onHelpMax }: Props & { o: Extract<Overlay, { kind: 'help' }> }) {
  const { width, left, top } = place(cols, rows, 100, rows - 2);
  const inner = width - 4;
  const all = helpLines(inner);
  const room = Math.max(3, rows - 6);
  const max = Math.max(0, all.length - room);
  onHelpMax(max);
  const scroll = Math.min(o.scroll, max);
  const lines = all.slice(scroll, scroll + room);
  const more = max ? [{ text: `   ${scroll < max ? 'j/k for more' : 'end'}`, color: theme.muted }] : [];
  return <Modal title="Keyboard shortcuts" rows={lines} width={width} left={left} top={Math.min(top, 1)} footer={[...hintLine(contexts), ...more]} />;
}

/** the space menu over the list: the issue on top, a row per letter with the field's value beside it, sections ruled off */
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
