// Every key the TUI answers to, in one table. Input dispatch, the footer hints and the ? overlay
// all read it, so a binding exists in exactly one place.
import type { Key } from 'ink';
import { isListRoute } from './model.js';
import type { TuiState } from './state.js';

export type Context =
  | 'global' | 'boot' | 'list' | 'detail' | 'inbox' | 'projects'
  | 'picker' | 'multipicker' | 'finder' | 'compose' | 'compose-issue' | 'compose-select' | 'help' | 'confirm';

export type CommandId =
  | 'quit' | 'backOrQuit' | 'back' | 'help' | 'search' | 'create' | 'refresh'
  | 'tab'
  | 'down' | 'up' | 'open'
  | 'setState' | 'setPriority' | 'setAssignee' | 'setLabels' | 'setProject' | 'assignMe'
  | 'comment' | 'editTitle' | 'editDescription'
  | 'copyKey' | 'copyUrl' | 'copyBranch' | 'copyPrompt' | 'openBrowser' | 'startAgent'
  | 'markRead' | 'markAllRead' | 'retry'
  | 'overlayDown' | 'overlayUp' | 'overlayAccept' | 'overlayCancel' | 'pickerToggle' | 'pickerPick'
  | 'composeNext' | 'composePrev' | 'composeCycleNext' | 'composeCyclePrev';

export interface Binding {
  /** key names as keyName() spells them */
  keys: string[];
  /** how the key reads in the footer and the help overlay (default: the keys joined) */
  display?: string;
  label: string;
  when: Context[];
  command: CommandId;
  /** help overlay section */
  group: string;
  /** shown in the footer for its contexts */
  hint?: boolean;
  /** the footer's shorter label */
  short?: string;
  /** the help overlay shows it through the row above (j/k) */
  partner?: boolean;
  /** contexts whose footer leaves it out although it works there */
  hideIn?: Context[];
}

const NAV: Context[] = ['list', 'inbox', 'projects'];
const ISSUE: Context[] = ['list', 'detail'];
const EVERYWHERE: Context[] = ['global', 'boot', 'picker', 'multipicker', 'finder', 'compose', 'help', 'confirm'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const BINDINGS: Binding[] = [
  { keys: ['j', 'down', 'ctrl+n'], display: '↑↓', label: 'move', when: NAV, command: 'down', group: 'Move', hint: true },
  { keys: ['k', 'up', 'ctrl+p'], label: 'up', when: NAV, command: 'up', group: 'Move', partner: true },
  { keys: ['j', 'down', 'ctrl+n'], display: '↑↓', label: 'scroll', when: ['detail'], command: 'down', group: 'Move', hint: true },
  { keys: ['k', 'up', 'ctrl+p'], label: 'scroll up', when: ['detail'], command: 'up', group: 'Move', partner: true },
  { keys: ['esc'], label: 'back', when: ['detail'], command: 'back', group: 'Move', hint: true },
  { keys: ['enter'], label: 'open', when: ['list', 'projects'], command: 'open', group: 'Move', hint: true },
  { keys: ['enter'], label: 'open + mark read', short: 'open', when: ['inbox'], command: 'open', group: 'Inbox', hint: true },


  { keys: ['s'], label: 'status', when: ISSUE, command: 'setState', group: 'Issue' },
  { keys: ['p'], label: 'priority', when: ISSUE, command: 'setPriority', group: 'Issue' },
  { keys: ['a'], label: 'assignee', when: ISSUE, command: 'setAssignee', group: 'Issue' },
  { keys: ['i'], label: 'assign to me', when: ISSUE, command: 'assignMe', group: 'Issue' },
  { keys: ['l'], label: 'labels', when: ISSUE, command: 'setLabels', group: 'Issue' },
  { keys: ['P'], label: 'project', when: ISSUE, command: 'setProject', group: 'Issue' },
  { keys: ['m'], label: 'comment', when: ISSUE, command: 'comment', group: 'Issue' },
  { keys: ['r'], label: 'rename', when: ISSUE, command: 'editTitle', group: 'Issue' },
  { keys: ['e'], label: 'edit description in $EDITOR', when: ISSUE, command: 'editDescription', group: 'Issue' },

  { keys: ['A'], label: 'start agent here', short: 'agent', when: ISSUE, command: 'startAgent', group: 'Copy and agents' },
  { keys: ['H'], label: 'copy agent prompt', when: ISSUE, command: 'copyPrompt', group: 'Copy and agents' },
  { keys: ['y'], label: 'copy issue ID', when: ISSUE, command: 'copyKey', group: 'Copy and agents' },
  { keys: ['Y'], label: 'copy issue URL', when: ISSUE, command: 'copyUrl', group: 'Copy and agents' },
  { keys: ['b'], label: 'copy git branch name', when: ISSUE, command: 'copyBranch', group: 'Copy and agents' },
  { keys: ['o'], label: 'open in browser', when: ISSUE, command: 'openBrowser', group: 'Copy and agents' },


  { keys: ['r'], label: 'read/unread', when: ['inbox'], command: 'markRead', group: 'Inbox' },
  { keys: ['R'], label: 'mark all read', when: ['inbox'], command: 'markAllRead', group: 'Inbox' },

  { keys: DIGITS, display: '1-9', label: 'switch tabs', short: 'tabs', when: ['global'], command: 'tab', group: 'Go to', hint: true },

  { keys: ['c'], label: 'new issue', when: ['global'], command: 'create', group: 'Workspace' },
  { keys: ['/'], label: 'find', when: ['global'], command: 'search', group: 'Workspace', hint: true },
  { keys: ['ctrl+r'], label: 'refresh now', when: ['global'], command: 'refresh', group: 'Workspace' },
  { keys: ['esc'], display: 'esc', label: 'back', when: ['global'], command: 'back', group: 'Workspace' },
  { keys: ['?'], label: 'help', when: ['global'], command: 'help', group: 'Workspace', hint: true },
  { keys: ['q'], label: 'back / quit', when: ['global'], command: 'backOrQuit', group: 'Workspace' },
  { keys: ['ctrl+c'], label: 'quit', when: EVERYWHERE, command: 'quit', group: 'Workspace' },

  { keys: ['r', 'ctrl+r'], label: 'retry', when: ['boot'], command: 'retry', group: 'Workspace', hint: true },
  { keys: ['q'], label: 'quit', when: ['boot'], command: 'quit', group: 'Workspace', hint: true },

  { keys: ['down', 'ctrl+n', 'ctrl+j'], display: '↑↓', label: 'choose', when: ['picker', 'finder'], command: 'overlayDown', group: 'Pickers', hint: true },
  { keys: ['up', 'ctrl+p'], label: 'up', when: ['picker', 'finder'], command: 'overlayUp', group: 'Pickers', partner: true },
  { keys: DIGITS, display: '1-9', label: 'pick the nth', short: 'pick', when: ['picker'], command: 'pickerPick', group: 'Pickers', hint: true, hideIn: ['multipicker'] },
  { keys: ['space'], label: 'toggle', when: ['multipicker'], command: 'pickerToggle', group: 'Pickers', hint: true },
  { keys: ['enter'], label: 'apply', when: ['picker'], command: 'overlayAccept', group: 'Pickers', hint: true },
  { keys: ['enter'], label: 'open', when: ['finder'], command: 'overlayAccept', group: 'Pickers', hint: true },
  { keys: ['esc'], label: 'cancel', when: ['picker', 'finder'], command: 'overlayCancel', group: 'Pickers', hint: true },

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
export function contextsFor(s: Pick<TuiState, 'status' | 'data' | 'overlay' | 'route'>): Context[] {
  if (!s.data) return ['boot'];
  const o = s.overlay;
  switch (o.kind) {
    case 'help': return ['help'];
    case 'confirm': return ['confirm'];
    case 'search': return ['finder'];
    case 'picker': return o.field === 'labels' ? ['multipicker', 'picker'] : ['picker'];
    case 'compose':
      if (o.target !== 'issue') return ['compose'];
      return o.field === 'title' ? ['compose-issue', 'compose'] : ['compose-select', 'compose-issue', 'compose'];
    case 'none': break;
  }
  return [baseContext(s.route), 'global'];
}

export const baseContext = (r: TuiState['route']): Context =>
  isListRoute(r) ? 'list' : r.kind === 'issue' ? 'detail' : r.kind === 'inbox' ? 'inbox' : 'projects';

/** whether the active overlay has a text field that takes keys no binding claimed */
export const takesText = (s: Pick<TuiState, 'overlay'>) =>
  s.overlay.kind === 'search' || s.overlay.kind === 'picker' ||
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
  for (const b of BINDINGS) {
    if (!b.hint || !b.when.some(c => contexts.includes(c)) || seen.has(b.command)) continue;
    if (b.when.every(c => !contexts.includes(c) || b.hideIn?.some(h => contexts.includes(h)))) continue;
    seen.add(b.command);
    out.push({ key: keyLabel(b), label: b.short ?? b.label });
  }
  return out;
}

const HELP_ORDER = ['Move', 'Go to', 'Issue', 'Issue page', 'Copy and agents', 'List display', 'Inbox', 'Workspace', 'Pickers', 'Compose'];

/** the ? overlay: every binding once, by section in table order; a key with one meaning in a section is one row */
export function helpSections(): Array<{ group: string; rows: Array<{ key: string; label: string }> }> {
  const sections = new Map<string, Array<{ key: string; label: string }>>();
  const seen = new Set<string>();
  for (const b of BINDINGS) {
    if (b.partner || b.group === 'Help' || b.group === 'Confirm' || b.when.every(c => c === 'boot')) continue;
    const key = keyLabel(b);
    const id = `${b.group}|${key}|${b.command}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const rows = sections.get(b.group) ?? [];
    rows.push({ key, label: b.label });
    sections.set(b.group, rows);
  }
  const rank = (g: string) => (HELP_ORDER.indexOf(g) + 1 || HELP_ORDER.length + 1);
  return [...sections].sort((a, b) => rank(a[0]) - rank(b[0])).map(([group, rows]) => ({ group, rows }));
}
