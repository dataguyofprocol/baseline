// The boxes over the screen: the space menu, a picker with no field on screen, search, compose forms and help.
import { Box, Text } from 'ink';
import { menuCtxFor } from './commands.js';
import { MENUS, rowLabel, SUBMENU } from './menus.js';
import type { TuiData } from './data.js';
import { helpSections, hintsFor, type Context } from './keys.js';
import { displayWidth, highlight, padEnd, truncate, type Line, type Seg } from './model.js';
import { pickerLines } from './detail.js';
import { draftChoices, draftValue, PICKER_TITLE, searchResults } from './overlays.js';
import { useWindow } from './screens.js';
import { DRAFT_FIELDS, type Overlay, type TuiState } from './state.js';
import { keySeg, STATE_ICON, theme } from './theme.js';
import { fieldBlock, fieldSegs, LineView, Modal } from './ui.js';

const BAR: Seg = { text: '▍', color: theme.accent };

function hintLine(contexts: Context[]): Line {
  return hintsFor(contexts).flatMap((h, i) => [{ text: `${i ? '   ' : ''}${h.key}`, bold: true }, { text: ` ${h.label}`, color: theme.muted }]);
}

function withMatches(text: string, indices: readonly number[], offset: number, base: Omit<Seg, 'text'> = {}): Seg[] {
  return highlight(text, indices, offset).map(r => (r.hit ? { ...base, text: r.text, color: theme.accent, bold: true } : { ...base, text: r.text }));
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
    case 'search': return <SearchView {...p} o={o} />;
    case 'compose': return <ComposeView {...p} o={o} />;
    case 'help': return <HelpView {...p} o={o} />;
    case 'menu': return <MenuView {...p} o={o} />;
  }
}

function place(cols: number, rows: number, width: number, height: number) {
  const w = Math.min(width, cols - 2);
  return { width: w, left: Math.max(0, Math.floor((cols - w) / 2)), top: Math.max(0, Math.min(Math.floor((rows - height) / 3), rows - height - 1)) };
}

function useListWindow<T>(key: string, items: T[], cursor: number, room: number, render: (t: T, selected: boolean) => Line): Line[] {
  const start = useWindow(key, cursor, room, items.length);
  return items.slice(start, start + room).map((t, i) => render(t, start + i === cursor));
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

function SearchView({ data, contexts, cols, rows, o }: Props & { o: Extract<Overlay, { kind: 'search' }> }) {
  const results = searchResults(o.input.value, data);
  const room = Math.max(3, Math.min(14, rows - 10));
  const { width, left, top } = place(cols, rows, 96, Math.min(results.length || 1, room) + 6);
  const inner = width - 4;
  const cursor = Math.min(o.cursor, Math.max(0, results.length - 1));
  const keyW = Math.max(6, ...results.map(r => r.key.length));
  const body = useListWindow('search', results, cursor, room, (r, selected) => {
    const st = data.stateById.get(r.issue.stateId);
    const keyHits = r.match.indices.filter(i => i < r.key.length);
    return [selected ? BAR : { text: ' ' }, { text: ' ' }, ...withMatches(padEnd(r.key, keyW), keyHits, 0, { color: selected ? theme.accent : theme.muted }), { text: ' ' },
      { text: `${st ? STATE_ICON[st.type] : '○'} `, color: st?.color }, ...withMatches(r.issue.title, r.match.indices, r.key.length + 1, selected ? { bold: true } : {})];
  });
  const count = o.input.value.trim() ? `${results.length} match${results.length === 1 ? '' : 'es'}` : 'recently updated';
  const lines: Line[] = [rightAlign([{ text: '/ ', color: theme.accent }, ...fieldSegs(o.input, inner - 20, 'search issues by key or title…')], [{ text: count, color: theme.muted }], inner), [],
    ...(results.length ? body : [[{ text: '  No issues match', color: theme.muted }]])];
  return <Modal title="Search" rows={lines} width={width} left={left} top={top} footer={hintLine(contexts)} />;
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
