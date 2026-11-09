// Every key the TUI answers to, in one table. Input dispatch, the footer hints, the ? overlay and the
// command palette all read it, so a binding exists in exactly one place.
import type { Key } from 'ink';
import { isListRoute } from './model.js';
import type { TuiState } from './state.js';

export type Context =
  | 'global' | 'boot' | 'list' | 'detail' | 'inbox' | 'projects' | 'sidebar'
  | 'picker' | 'multipicker' | 'finder' | 'compose' | 'compose-issue' | 'compose-select' | 'help' | 'confirm';

export type CommandId =
  | 'quit' | 'backOrQuit' | 'back' | 'help' | 'palette' | 'search' | 'create' | 'refresh'
  | 'nextView' | 'prevView' | 'gotoView' | 'focusSidebar' | 'focusMain'
  | 'down' | 'up' | 'top' | 'bottom' | 'pageDown' | 'pageUp' | 'open'
  | 'setState' | 'setPriority' | 'setAssignee' | 'setLabels' | 'setProject' | 'assignMe'
  | 'comment' | 'editTitle' | 'editDescription'
  | 'copyKey' | 'copyBranch' | 'copyPrompt' | 'openBrowser' | 'startAgent'
  | 'markRead' | 'markAllRead' | 'retry'
  | 'overlayDown' | 'overlayUp' | 'overlayAccept' | 'overlayCancel' | 'pickerToggle'
  | 'composeNext' | 'composePrev' | 'composeCycleNext' | 'composeCyclePrev';

export interface Binding {
  keys: string[];
  /** how the key reads in the footer and the help overlay (default: the keys joined) */
  display?: string;
  label: string;
  when: Context[];
  command: CommandId;
  /** help overlay section */
  group: string;
  /** shown in the footer for its contexts, under this text if given */
  hint?: boolean;
  /** offered in the command palette (default: true for the main contexts) */
  palette?: boolean;
  /** the help overlay shows it through the row above (j/k, g/G, [ ]) */
  partner?: boolean;
}

const NAV: Context[] = ['list', 'inbox', 'projects', 'sidebar'];
const ISSUE: Context[] = ['list', 'detail'];
const EVERYWHERE: Context[] = ['global', 'boot', 'sidebar', 'picker', 'multipicker', 'finder', 'compose', 'help', 'confirm'];

export const BINDINGS: Binding[] = [
  { keys: ['j', 'down', 'ctrl+n'], display: 'j/k', label: 'move', when: NAV, command: 'down', group: 'Navigate', hint: true, palette: false },
  { keys: ['k', 'up', 'ctrl+p'], label: 'up', when: NAV, command: 'up', group: 'Navigate', palette: false, partner: true },
  { keys: ['j', 'down', 'ctrl+n'], display: 'j/k', label: 'scroll', when: ['detail'], command: 'down', group: 'Navigate', hint: true, palette: false },
  { keys: ['k', 'up', 'ctrl+p'], label: 'scroll up', when: ['detail'], command: 'up', group: 'Navigate', palette: false, partner: true },
  { keys: ['g', 'home'], display: 'g/G', label: 'top/bottom', when: [...NAV, 'detail'], command: 'top', group: 'Navigate', palette: false },
  { keys: ['G', 'end'], label: 'bottom', when: [...NAV, 'detail'], command: 'bottom', group: 'Navigate', palette: false, partner: true },
  { keys: ['ctrl+d', 'pagedown'], display: 'ctrl-d/u', label: 'half page', when: [...NAV, 'detail'], command: 'pageDown', group: 'Navigate', palette: false },
  { keys: ['space'], label: 'page down', when: ['detail'], command: 'pageDown', group: 'Navigate', palette: false },
  { keys: ['ctrl+u', 'ctrl+b', 'pageup'], label: 'half page up', when: [...NAV, 'detail'], command: 'pageUp', group: 'Navigate', palette: false, partner: true },
  { keys: ['enter'], label: 'open', when: ['list', 'projects', 'sidebar'], command: 'open', group: 'Navigate', hint: true, palette: false },
  { keys: ['enter'], label: 'open + mark read', when: ['inbox'], command: 'open', group: 'Inbox', hint: true, palette: false },

  { keys: ['s'], label: 'status', when: ISSUE, command: 'setState', group: 'Issue', hint: true },
  { keys: ['p'], label: 'priority', when: ISSUE, command: 'setPriority', group: 'Issue', hint: true },
  { keys: ['a'], label: 'assignee', when: ISSUE, command: 'setAssignee', group: 'Issue', hint: true },
  { keys: ['l'], label: 'labels', when: ISSUE, command: 'setLabels', group: 'Issue' },
  { keys: ['P'], label: 'project', when: ISSUE, command: 'setProject', group: 'Issue' },
  { keys: ['I'], label: 'assign to me', when: ISSUE, command: 'assignMe', group: 'Issue' },
  { keys: ['m'], label: 'comment', when: ['detail'], command: 'comment', group: 'Issue', hint: true },
  { keys: ['e'], label: 'edit title', when: ['detail'], command: 'editTitle', group: 'Issue' },
  { keys: ['E'], label: 'edit description in $EDITOR', when: ['detail'], command: 'editDescription', group: 'Issue' },

  { keys: ['A'], label: 'start agent here', when: ISSUE, command: 'startAgent', group: 'Agent', hint: true },
  { keys: ['H'], label: 'copy agent prompt', when: ISSUE, command: 'copyPrompt', group: 'Agent' },
  { keys: ['Y'], label: 'copy branch name', when: ISSUE, command: 'copyBranch', group: 'Agent' },
  { keys: ['y'], label: 'copy issue key', when: ISSUE, command: 'copyKey', group: 'Agent' },
  { keys: ['o'], label: 'open in browser', when: ISSUE, command: 'openBrowser', group: 'Agent' },

  { keys: ['r'], label: 'read/unread', when: ['inbox'], command: 'markRead', group: 'Inbox', hint: true },
  { keys: ['R'], label: 'mark all read', when: ['inbox'], command: 'markAllRead', group: 'Inbox', hint: true },

  { keys: ['c'], label: 'new issue', when: ['global'], command: 'create', group: 'Workspace', hint: true },
  { keys: ['/'], label: 'search', when: ['global'], command: 'search', group: 'Workspace', hint: true },
  { keys: ['ctrl+k', ':'], display: 'ctrl-k', label: 'commands', when: ['global'], command: 'palette', group: 'Workspace', hint: true },
  { keys: ['tab'], label: 'sidebar', when: ['global'], command: 'focusSidebar', group: 'Workspace' },
  { keys: ['tab', 'esc', 'l', 'right'], display: 'tab/esc', label: 'back to list', when: ['sidebar'], command: 'focusMain', group: 'Workspace', palette: false },
  { keys: [']'], display: '[ ]', label: 'next/prev view', when: ['global'], command: 'nextView', group: 'Workspace' },
  { keys: ['['], label: 'previous view', when: ['global'], command: 'prevView', group: 'Workspace', partner: true },
  { keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], display: '1-9', label: 'go to view', when: ['global'], command: 'gotoView', group: 'Workspace', palette: false },
  { keys: ['ctrl+r'], label: 'refresh now', when: ['global'], command: 'refresh', group: 'Workspace' },
  { keys: ['esc', 'backspace'], display: 'esc', label: 'back', when: ['global'], command: 'back', group: 'Workspace', palette: false },
  { keys: ['?'], label: 'help', when: ['global'], command: 'help', group: 'Workspace', hint: true },
  { keys: ['q'], label: 'back / quit', when: ['global'], command: 'backOrQuit', group: 'Workspace', palette: false },
  { keys: ['ctrl+c'], label: 'quit', when: EVERYWHERE, command: 'quit', group: 'Workspace' },

  { keys: ['r', 'ctrl+r'], label: 'retry', when: ['boot'], command: 'retry', group: 'Workspace', hint: true, palette: false },
  { keys: ['q'], label: 'quit', when: ['boot'], command: 'quit', group: 'Workspace', hint: true, palette: false },

  { keys: ['down', 'ctrl+n', 'ctrl+j'], display: '↑↓', label: 'move', when: ['picker', 'finder'], command: 'overlayDown', group: 'Lists and pickers', hint: true },
  { keys: ['up', 'ctrl+p'], label: 'up', when: ['picker', 'finder'], command: 'overlayUp', group: 'Lists and pickers', partner: true },
  { keys: ['space'], label: 'toggle', when: ['multipicker'], command: 'pickerToggle', group: 'Lists and pickers', hint: true },
  { keys: ['enter'], label: 'apply', when: ['picker'], command: 'overlayAccept', group: 'Lists and pickers', hint: true },
  { keys: ['enter'], label: 'open', when: ['finder'], command: 'overlayAccept', group: 'Lists and pickers', hint: true },
  { keys: ['esc'], label: 'cancel', when: ['picker', 'finder'], command: 'overlayCancel', group: 'Lists and pickers', hint: true },

  { keys: ['tab'], display: 'tab/shift-tab', label: 'field', when: ['compose-issue'], command: 'composeNext', group: 'Compose', hint: true },
  { keys: ['shift+tab'], label: 'previous field', when: ['compose-issue'], command: 'composePrev', group: 'Compose', partner: true },
  { keys: ['right', 'l', 'space', 'j', 'down'], display: '←→', label: 'change', when: ['compose-select'], command: 'composeCycleNext', group: 'Compose', hint: true },
  { keys: ['left', 'h', 'k', 'up'], label: 'change back', when: ['compose-select'], command: 'composeCyclePrev', group: 'Compose', partner: true },
  { keys: ['enter'], label: 'save', when: ['compose'], command: 'overlayAccept', group: 'Compose', hint: true },
  { keys: ['esc'], label: 'cancel', when: ['compose'], command: 'overlayCancel', group: 'Compose', hint: true },

  { keys: ['j', 'down'], display: 'j/k', label: 'scroll', when: ['help'], command: 'overlayDown', group: 'Help', hint: true },
  { keys: ['k', 'up'], label: 'scroll up', when: ['help'], command: 'overlayUp', group: 'Help', partner: true },
  { keys: ['esc', '?', 'q'], display: 'esc', label: 'close', when: ['help'], command: 'overlayCancel', group: 'Help', hint: true },

  { keys: ['enter', 'y'], display: 'enter', label: 'run', when: ['confirm'], command: 'overlayAccept', group: 'Confirm', hint: true },
  { keys: ['esc', 'n', 'q'], display: 'esc', label: 'cancel', when: ['confirm'], command: 'overlayCancel', group: 'Confirm', hint: true },
];

/** Ink's key event as one name: "j", "G", "enter", "ctrl+d", "shift+tab", "space" */
export function keyName(input: string, key: Key): string {
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.pageUp) return 'pageup';
  if (key.pageDown) return 'pagedown';
  if (key.home) return 'home';
  if (key.end) return 'end';
  if (key.return) return 'enter';
  if (key.escape) return 'esc';
  if (key.tab) return key.shift ? 'shift+tab' : 'tab';
  if (key.backspace) return key.meta ? 'meta+backspace' : 'backspace';
  if (key.delete) return 'delete';
  if (input === ' ') return 'space';
  if (key.ctrl && input) return `ctrl+${input.toLowerCase()}`;
  if (key.meta && input) return `meta+${input}`;
  return input;
}

/** the contexts active right now, most specific first; the first binding found in that order wins */
export function contextsFor(s: Pick<TuiState, 'status' | 'data' | 'overlay' | 'focus' | 'route'>, sidebarVisible: boolean): Context[] {
  if (!s.data) return ['boot'];
  const o = s.overlay;
  switch (o.kind) {
    case 'help': return ['help'];
    case 'confirm': return ['confirm'];
    case 'palette': case 'search': return ['finder'];
    case 'picker': return o.field === 'labels' ? ['multipicker', 'picker'] : ['picker'];
    case 'compose':
      if (o.target !== 'issue') return ['compose'];
      return o.field === 'title' ? ['compose-issue', 'compose'] : ['compose-select', 'compose-issue', 'compose'];
    case 'none': break;
  }
  if (s.focus === 'sidebar' && sidebarVisible) return ['sidebar', 'global'];
  return [baseContext(s.route), 'global'];
}

export const baseContext = (r: TuiState['route']): Context =>
  isListRoute(r) ? 'list' : r.kind === 'issue' ? 'detail' : r.kind === 'inbox' ? 'inbox' : 'projects';

/** whether the active overlay has a text field that takes keys no binding claimed */
export const takesText = (s: Pick<TuiState, 'overlay'>) =>
  s.overlay.kind === 'palette' || s.overlay.kind === 'search' || s.overlay.kind === 'picker' ||
  (s.overlay.kind === 'compose' && (s.overlay.target !== 'issue' || s.overlay.field === 'title'));

export function lookup(contexts: readonly Context[], name: string): Binding | undefined {
  for (const ctx of contexts) {
    const b = BINDINGS.find(x => x.when.includes(ctx) && x.keys.includes(name));
    if (b) return b;
  }
  return undefined;
}

const pretty = (k: string) => k.replace(/^ctrl\+/, 'ctrl-').replace(/^shift\+/, 'shift-').replace(/^meta\+/, 'alt-');
export const keyLabel = (b: Binding) => b.display ?? b.keys.filter(k => !['down', 'up', 'ctrl+n', 'ctrl+p', 'home', 'end', 'pagedown', 'pageup'].includes(k) || b.keys.length === 1).map(pretty).join('/');

/** footer hints for the active contexts, in table order, one per command */
export function hintsFor(contexts: readonly Context[]): Array<{ key: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string }> = [];
  for (const ctx of contexts) {
    for (const b of BINDINGS) {
      if (!b.hint || !b.when.includes(ctx) || seen.has(b.command)) continue;
      seen.add(b.command);
      out.push({ key: keyLabel(b), label: b.label });
    }
  }
  return out;
}

/** the ? overlay: every binding, grouped by section, in table order */
export function helpSections(): Array<{ group: string; rows: Array<{ key: string; label: string }> }> {
  const sections = new Map<string, Array<{ key: string; label: string }>>();
  const seen = new Set<string>();
  for (const b of BINDINGS) {
    const id = `${b.group}|${b.command}|${b.when.join()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (b.partner || (b.when.length === 1 && b.when[0] === 'boot')) continue;
    const rows = sections.get(b.group) ?? [];
    rows.push({ key: keyLabel(b), label: b.label });
    sections.set(b.group, rows);
  }
  return [...sections].map(([group, rows]) => ({ group, rows }));
}

/** palette entries: bindings usable from `context`, each once */
export function paletteBindings(context: Context): Binding[] {
  const seen = new Set<CommandId>();
  return BINDINGS.filter(b => {
    if (b.palette === false || seen.has(b.command)) return false;
    if (!b.when.includes(context) && !b.when.includes('global')) return false;
    seen.add(b.command);
    return true;
  });
}
