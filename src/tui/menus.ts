import type { Handoff, Issue } from '../core/types.js';
import type { TuiData } from './data.js';
import { fieldRows } from './detail.js';
import { BINDINGS, directBinding, keyLabel, type CommandId, type Task } from './keys.js';
import { agentCommand, shellPreview } from './launch.js';
import { tildePath, type Line, type Seg } from './model.js';
import { theme } from './theme.js';
import { agentAsk, followupsOf, issueNeeds } from './today.js';

export type MenuId = 'actions' | 'edit' | 'agent' | 'copy';

export interface MenuCtx {
  issue: Issue;
  data: TuiData;
  handoff: Handoff | undefined;
  env: NodeJS.ProcessEnv;
  where: { cwd: string; note: string | null };
  now: number;
}

export interface MenuRow {
  key: string;
  label: string | ((c: MenuCtx) => string);
  value?: (c: MenuCtx) => Seg[];
  command: CommandId;
  section: number;
  enabled?: (c: MenuCtx) => true | string;
}

export interface Menu { title: (c: MenuCtx) => string; rows: MenuRow[]; extra?: (c: MenuCtx, width: number) => Line[] }

export const SUBMENU: Partial<Record<CommandId, MenuId>> = { editMenu: 'edit', agentMenu: 'agent', copyMenu: 'copy' };

const dim = (text: string): Seg[] => [{ text, color: theme.muted }];
const field = (id: string) => (c: MenuCtx) => fieldRows(c.issue, c.data, c.now).find(r => r.field === id)?.value.map(x => ({ ...x, color: x.color ?? theme.muted })) ?? [];

function direct(command: CommandId, section: number, value?: MenuRow['value']): MenuRow {
  const b = directBinding(command);
  if (!b) throw new Error(`no direct key for ${command}`);
  return { key: b.keys[0], label: b.label, command, section, value };
}

const agentLabel = (env: NodeJS.ProcessEnv) => (env.BASELINE_AGENT?.trim() ? 'Start the agent here' : 'Start Claude Code here');
const branch = (c: MenuCtx) => dim(c.handoff?.branchName ?? '…');

export const MENUS: Record<MenuId, Menu> = {
  actions: {
    title: c => `${c.data.keyOf(c.issue)}  ${c.issue.title}`,
    rows: [
      direct('setState', 0, field('state')),
      direct('setAssignee', 0, field('assignee')),
      direct('setPriority', 0, field('priority')),
      direct('setLabels', 0, field('labels')),
      direct('comment', 0),
      direct('editMenu', 0),
      { ...direct('done', 1), value: c => dim(c.data.states.find(st => st.teamId === c.issue.teamId && st.type === 'completed')?.name ?? 'Done') },
      { ...direct('sendBack', 1), label: c => (agentAsk(c.data, c.issue)?.ask === 'blocked' ? 'Answer and rerun the agent' : 'Send back') },
      { ...direct('followups', 1), enabled: c => (followupsOf(c.data, c.issue.id).length ? true : `The agent noted no follow-ups on ${c.data.keyOf(c.issue)}`), value: c => dim(`${followupsOf(c.data, c.issue.id).length} drafts`) },
      { ...direct('markRead', 1), enabled: c => (issueNeeds(c.data, c.now).some(r => r.issue.id === c.issue.id) ? true : 'Nothing about it is waiting on you') },
      direct('agentMenu', 2),
      direct('copyMenu', 2),
      direct('openBrowser', 2),
      direct('create', 3),
    ],
  },
  edit: {
    title: c => `${c.data.keyOf(c.issue)}  ›  Edit`,
    rows: [
      { key: 't', label: 'Title', value: () => dim('edit it here, enter saves'), command: 'editTitle', section: 0 },
      { key: 'd', label: 'Description', value: c => dim(`opens ${(c.env.VISUAL || c.env.EDITOR || 'vi').split(/\s+/)[0]}`), command: 'editDescription', section: 0 },
    ],
  },
  agent: {
    title: c => `${c.data.keyOf(c.issue)}  ›  Work on it with an agent`,
    rows: [
      { key: 'h', label: c => agentLabel(c.env), value: () => dim('runs in this terminal, comes back when it exits'), command: 'agentHere', section: 0 },
      {
        key: 'n', label: 'Start in a new pane', command: 'agentPane', section: 0,
        value: c => dim(c.env.TMUX ? 'a tmux split beside this one' : 'needs tmux'),
        enabled: c => (c.env.TMUX ? true : 'A new pane needs tmux. Run baseline inside tmux, or press h to run the agent here.'),
      },
      { key: 'p', label: 'Copy the agent prompt', value: () => dim('paste it into any agent'), command: 'copyPrompt', section: 0 },
      { key: 'b', label: 'Copy the branch name', value: branch, command: 'copyBranch', section: 0 },
    ],
    extra: (c, width) => agentPreview(c, width),
  },
  copy: {
    title: c => `${c.data.keyOf(c.issue)}  ›  Copy`,
    rows: [
      { key: 'k', label: 'Copy the key', value: c => dim(c.data.keyOf(c.issue)), command: 'copyKey', section: 0 },
      { key: 'b', label: 'Copy the branch name', value: branch, command: 'copyBranch', section: 0 },
      { key: 'l', label: 'Copy the link', value: c => dim(c.handoff?.url ?? '…'), command: 'copyUrl', section: 0 },
    ],
  },
};

export function agentPreview(c: MenuCtx, width: number): Line[] {
  const cmd = agentCommand(c.handoff?.prompt ?? '…', c.env);
  const loc = c.issue.locationId ? c.data.locations.find(l => l.id === c.issue.locationId) : undefined;
  return [
    [{ text: 'will run   ', color: theme.muted }, { text: '$ ', color: theme.accent }, { text: shellPreview(cmd, Math.max(10, width - 13)) }],
    [{ text: 'in         ', color: theme.muted }, { text: tildePath(c.where.cwd) },
      { text: c.where.note ? '   (its location isn\'t on this disk)' : loc ? `   (${c.data.keyOf(c.issue)}'s location)` : '', color: theme.muted }],
  ];
}

export const rowLabel = (r: MenuRow, c: MenuCtx) => (typeof r.label === 'string' ? r.label : r.label(c));

export function menuTrail(path: readonly MenuId[]): string[] {
  return path.map((id, i) => {
    if (i === 0) return id === 'actions' ? directBinding('actions')!.keys[0] : directBinding(Object.entries(SUBMENU).find(([, m]) => m === id)![0] as CommandId)!.keys[0];
    return MENUS[path[i - 1]].rows.find(r => SUBMENU[r.command] === id)?.key ?? '?';
  });
}

const HELP_ORDER: Task[] = ['Move around', 'Decide', 'Change an issue', 'Agents and copying', 'Find and views'];

export interface HelpRow { key: string; label: string; sub?: boolean }

export function helpSections(env: NodeJS.ProcessEnv = process.env): Array<{ group: Task; rows: HelpRow[] }> {
  const sections = new Map<Task, HelpRow[]>(HELP_ORDER.map(g => [g, []]));
  const seen = new Set<string>();
  for (const b of BINDINGS) {
    if (b.partner || b.group === 'Overlay' || b.when.every(c => c === 'boot')) continue;
    const key = keyLabel(b) === '↑↓' && b.keys.includes('j') ? '↑↓ j k' : keyLabel(b);
    if (seen.has(`${key}|${b.command}`) || (b.command === 'back' && seen.has('esc|back'))) continue;
    seen.add(`${key}|${b.command}`);
    const rows = sections.get(b.group)!;
    rows.push({ key, label: b.label });
    const sub = SUBMENU[b.command];
    if (sub) for (const r of MENUS[sub].rows) rows.push({ key: `${key} ${r.key}`, label: typeof r.label === 'string' ? r.label : r.label({ env } as MenuCtx), sub: true });
  }
  sections.get('Find and views')!.push(
    { key: '/ then', label: '"standup", "projects", "notifications", "assign ada", "new <title>"', sub: true },
  );
  return [...sections].map(([group, rows]) => ({ group, rows }));
}

export function introLines(data: TuiData, tabs: number, target: string, width: number): Line[] {
  const first = data.currentUser.name.split(/\s+/)[0];
  const row = (k: string, text: string): Line => [{ text: k, color: theme.key, bold: true }, { text: ' '.repeat(Math.max(2, 8 - k.length)) }, { text }];
  const end: Line = [{ text: 'enter', color: theme.key, bold: true }, { text: ' start' }];
  const endW = 11;
  return [
    [{ text: 'Baseline, in your terminal', bold: true }],
    [{ text: `${first}, Today is what needs you, what's in flight and what's next.`, color: theme.muted }],
    [],
    row(tabs > 1 ? `1-${Math.min(9, tabs)}` : '1', 'a place: 1 is Today, then your teams'),
    row('enter', 'go into the thing under the cursor, or take its next step'),
    row('esc', 'back one level; Today is never more than two presses away'),
    row('space', 'every action here, each with its letter'),
    row('/', 'everything without a tab: issues, projects, notifications, standup'),
    [],
    [{ text: 'After a decision you land on the next thing that needs you.' }],
    [{ text: 'Every change shows ' }, { text: 'u', color: theme.key, bold: true }, { text: ' undo, so trying things is safe. ' }, { text: '?', color: theme.key, bold: true }, { text: ' shows every key.' }],
    [],
    [...end, { text: ' '.repeat(Math.max(2, width - endW - target.length)) }, { text: target, color: theme.muted }],
  ];
}
