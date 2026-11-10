// The space menu and its submenus, as data. The space menu's rows are the list's own letters, read from
// the keymap, so the menu teaches exactly the keys that work without it. Pure.
import type { Handoff, Issue } from '../core/types.js';
import type { TuiData } from './data.js';
import { fieldRows } from './detail.js';
import { directBinding, type CommandId } from './keys.js';
import { agentCommand, shellPreview } from './launch.js';
import { tildePath, type Line, type Seg } from './model.js';
import { theme } from './theme.js';

export type MenuId = 'actions' | 'edit' | 'agent' | 'copy';

export interface MenuCtx {
  issue: Issue;
  data: TuiData;
  /** the issue's handoff (prompt, branch, link), once fetched */
  handoff: Handoff | undefined;
  env: NodeJS.ProcessEnv;
  /** where an agent would run, and a note when the issue's location isn't on this disk */
  where: { cwd: string; note: string | null };
  now: number;
}

export interface MenuRow {
  key: string;
  label: string | ((c: MenuCtx) => string);
  /** the dim column: the field's current value, or what the row does */
  value?: (c: MenuCtx) => Seg[];
  command: CommandId;
  /** rows with the same section sit together; a rule separates sections */
  section: number;
  /** true, or why the row can't run here */
  enabled?: (c: MenuCtx) => true | string;
}

export interface Menu { title: (c: MenuCtx) => string; rows: MenuRow[]; extra?: (c: MenuCtx, width: number) => Line[] }

/** commands that open a submenu: from a list they open it, inside a menu they step into it */
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
      direct('agentMenu', 1),
      direct('copyMenu', 1),
      direct('openBrowser', 1),
      direct('create', 2),
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

/** "will run $ claude '…'" and where: the agent menu and / show it before anything starts */
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

/** the key that opened each step of the menu path: "space › w" */
export function menuTrail(path: readonly MenuId[]): string[] {
  return path.map((id, i) => {
    if (i === 0) return id === 'actions' ? directBinding('actions')!.keys[0] : directBinding(Object.entries(SUBMENU).find(([, m]) => m === id)![0] as CommandId)!.keys[0];
    return MENUS[path[i - 1]].rows.find(r => SUBMENU[r.command] === id)?.key ?? '?';
  });
}
