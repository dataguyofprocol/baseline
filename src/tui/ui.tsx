import { Box, Text } from 'ink';
import { displayWidth, truncate, type Line, type Seg } from './model.js';
import type { TextField } from './textfield.js';
import { theme } from './theme.js';

function SegText({ seg }: { seg: Seg }) {
  return (
    <Text color={seg.color} backgroundColor={seg.bg} bold={seg.bold} dimColor={seg.dim} italic={seg.italic} underline={seg.underline} strikethrough={seg.strike} inverse={seg.inverse}>
      {seg.text}
    </Text>
  );
}

export function fitLine(line: Line, width: number): Line {
  const out: Line = [];
  let used = 0;
  for (const seg of line) {
    if (used >= width) break;
    const text = truncate(seg.text, width - used);
    if (text) out.push({ ...seg, text });
    used += displayWidth(text);
  }
  if (used < width) out.push({ text: ' '.repeat(width - used) });
  return out;
}

export function LineView({ line, width, bg, dim }: { line: Line; width?: number; bg?: string; dim?: boolean }) {
  let segs = width === undefined ? line : fitLine(line, width);
  if (bg) segs = segs.map(s => (s.bg ? s : { ...s, bg }));
  if (dim) segs = segs.map(s => ({ ...s, color: s.color === theme.key ? theme.muted : s.color, dim: true, bg: s.bg === theme.keyBg ? undefined : s.bg }));
  return <Text wrap="truncate-end">{segs.length ? segs.map((s, i) => <SegText key={i} seg={s} />) : ' '}</Text>;
}

export function fieldSegs(f: TextField, width: number, placeholder = ''): Line {
  const chars = [...f.value];
  if (!chars.length) return [{ text: ' ', inverse: true }, { text: truncate(placeholder, width - 1), color: theme.muted }];
  const room = Math.max(1, width - 1);
  const start = Math.max(0, f.cursor - room + 1);
  const visible = chars.slice(start, start + room);
  const at = f.cursor - start;
  return [{ text: visible.slice(0, at).join('') }, { text: visible[at] ?? ' ', inverse: true }, { text: visible.slice(at + 1).join('') }];
}

export function fieldBlock(f: TextField, width: number, placeholder: string, maxRows: number): Line[] {
  const chars = [...f.value];
  if (!chars.length) return [[{ text: ' ', inverse: true }, { text: truncate(placeholder, width - 1), color: theme.muted }]];
  const rows: Line[] = [];
  for (let i = 0; i <= chars.length; i += width) {
    const row = chars.slice(i, i + width);
    const at = f.cursor - i;
    if (at >= 0 && at < width) rows.push([{ text: row.slice(0, at).join('') }, { text: row[at] ?? ' ', inverse: true }, { text: row.slice(at + 1).join('') }]);
    else rows.push([{ text: row.join('') }]);
    if (i + width > chars.length) break;
  }
  const cursorRow = Math.floor(f.cursor / width);
  const first = Math.max(0, Math.min(cursorRow - maxRows + 1, rows.length - maxRows));
  return rows.slice(first, first + maxRows);
}

export function Modal({ title, subtitle, rows, width, left, top, footer }: {
  title: string; subtitle?: string; rows: Line[]; width: number; left: number; top: number; footer?: Line;
}) {
  const inner = width - 4;
  const head = truncate(` ${title} `, width - 4);
  const sub = subtitle ? truncate(`· ${subtitle} `, Math.max(0, width - 5 - displayWidth(head))) : '';
  const fill = Math.max(0, width - 3 - displayWidth(head) - displayWidth(sub));
  const edge = (line: Line, i: number) => (
    <Text key={i}>
      <Text color={theme.accent}>│ </Text>
      <LineView line={line} width={inner} />
      <Text color={theme.accent}> │</Text>
    </Text>
  );
  return (
    <Box position="absolute" left={left} top={top} flexDirection="column" width={width}>
      <Text>
        <Text color={theme.accent}>╭─</Text>
        <Text bold>{head}</Text>
        <Text color={theme.muted}>{sub}</Text>
        <Text color={theme.accent}>{'─'.repeat(fill)}╮</Text>
      </Text>
      {rows.map(edge)}
      {footer ? edge([], -1) : null}
      {footer ? edge(footer, -2) : null}
      <Text color={theme.accent}>╰{'─'.repeat(width - 2)}╯</Text>
    </Box>
  );
}
