// Every key the TUI answers to, in one table. Input dispatch, the footer, the space menu and the ? card
// all read it, so a binding exists in exactly one place.
import type { Key } from 'ink';
import { isListRoute } from './model.js';
import type { TuiState } from './state.js';

export type Context =
  | 'global' | 'boot' | 'list' | 'detail' | 'inbox' | 'projects'
  | 'menu' | 'picker' | 'multipicker' | 'finder' | 'compose' | 'compose-issue' | 'compose-select' | 'help';

export type CommandId =
  | 'quit' | 'backOrQuit' | 'back' | 'help' | 'search' | 'refresh' | 'retry' | 'tab'
  | 'down' | 'up' | 'pageDown' | 'pageUp' | 'halfDown' | 'halfUp' | 'top' | 'bottom' | 'open' | 'actions'
  | 'undo' | 'setState' | 'setPriority' | 'setAssignee' | 'setLabels' | 'setProject' | 'comment' | 'create'
  | 'editMenu' | 'editTitle' | 'editDescription'
  | 'agentMenu' | 'agentHere' | 'agentPane' | 'copyMenu' | 'copyKey' | 'copyUrl' | 'copyBranch' | 'copyPrompt' | 'openBrowser'
  | 'overlayDown' | 'overlayUp' | 'overlayPageDown' | 'overlayPageUp' | 'overlayTop' | 'overlayBottom' | 'overlayAccept' | 'overlayCancel' | 'overlayBack' | 'menuKey' | 'pickerToggle' | 'pickerPick'
  | 'composeNext' | 'composePrev' | 'composeCycleNext' | 'composeCyclePrev';

/** the ? card's sections: keys by what you are trying to do, not by where you are */
export type Task = 'Move around' | 'Change an issue' | 'Agents and copying' | 'Find and views' | 'Overlay';

export interface Binding {
  /** key names as keyName() spells them */
  keys: string[];
  /** how the key reads in the footer and the help card (default: the keys joined) */
  display?: string;
  label: string;
  when: Context[];
  command: CommandId;
  group: Task;
  /** shown in the footer for its contexts */
  hint?: boolean;
  /** the footer's shorter label */
  short?: string;
  /** the help card shows it through the row above (k of j/k) */
  partner?: boolean;
  /** contexts whose footer leaves it out although it works there */
  hideIn?: Context[];
}

const NAV: Context[] = ['list', 'inbox', 'projects'];
/** where page keys work: a list moves its cursor, the issue page scrolls its text */
const PAGED: Context[] = [...NAV, 'detail'];
/** where there is an issue to act on: the list row, the inbox item's issue, the open issue */
const ISSUE: Context[] = ['list', 'inbox', 'detail'];
const EVERYWHERE: Context[] = ['global', 'boot', 'menu', 'picker', 'multipicker', 'finder', 'compose', 'help'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const BINDINGS: Binding[] = [
  { keys: ['down', 'j'], display: '↑↓', label: 'move', when: NAV, command: 'down', group: 'Move around', hint: true },
  { keys: ['up', 'k'], label: 'up', when: NAV, command: 'up', group: 'Move around', partner: true },
  { keys: ['down', 'j'], display: '↑↓', label: 'scroll the issue page', short: 'scroll', when: ['detail'], command: 'down', group: 'Move around', hint: true },
  { keys: ['up', 'k'], label: 'scroll up', when: ['detail'], command: 'up', group: 'Move around', partner: true },
  { keys: ['pagedown'], display: 'PgDn PgUp', label: 'page', when: PAGED, command: 'pageDown', group: 'Move around' },
  { keys: ['pageup'], label: 'page up', when: PAGED, command: 'pageUp', group: 'Move around', partner: true },
  { keys: ['ctrl+d'], display: 'ctrl-d ctrl-u', label: 'half page', when: PAGED, command: 'halfDown', group: 'Move around' },
  { keys: ['ctrl+u'], label: 'half page up', when: PAGED, command: 'halfUp', group: 'Move around', partner: true },
  { keys: ['g', 'home'], display: 'g G', label: 'top, bottom (Home End too)', when: PAGED, command: 'top', group: 'Move around' },
  { keys: ['G', 'end'], label: 'bottom', when: PAGED, command: 'bottom', group: 'Move around', partner: true },
  { keys: ['enter'], label: 'open the issue, or fold a group', short: 'open', when: NAV, command: 'open', group: 'Move around', hint: true },
  { keys: ['esc'], label: 'back', when: ['detail'], command: 'back', group: 'Move around', hint: true },
  { keys: DIGITS, display: '1-9', label: 'switch tabs', short: 'tabs', when: ['global'], command: 'tab', group: 'Move around', hint: true },
  { keys: ['/'], label: 'find issues, and actions for this one', short: 'find', when: ['global'], command: 'search', group: 'Find and views', hint: true },
  { keys: ['space'], label: 'everything you can do with this issue', short: 'all actions', when: ISSUE, command: 'actions', group: 'Find and views', hint: true },
  { keys: ['?'], label: 'this help', short: 'help', when: ['global'], command: 'help', group: 'Find and views', hint: true },
  { keys: ['esc'], label: 'back', when: ['global'], command: 'back', group: 'Move around' },
  { keys: ['q'], label: 'back, or quit from a tab', when: ['global'], command: 'backOrQuit', group: 'Move around' },
  { keys: ['ctrl+r'], label: 'refresh now', when: ['global'], command: 'refresh', group: 'Move around' },
  { keys: ['ctrl+c'], label: 'quit', when: EVERYWHERE, command: 'quit', group: 'Move around' },

  { keys: ['s'], label: 'Status', when: ISSUE, command: 'setState', group: 'Change an issue' },
  { keys: ['a'], label: 'Assignee', when: ISSUE, command: 'setAssignee', group: 'Change an issue' },
  { keys: ['p'], label: 'Priority', when: ISSUE, command: 'setPriority', group: 'Change an issue' },
  { keys: ['l'], label: 'Labels', when: ISSUE, command: 'setLabels', group: 'Change an issue' },
  { keys: ['m'], label: 'Comment', when: ISSUE, command: 'comment', group: 'Change an issue' },
  { keys: ['e'], label: 'Edit title or description', when: ISSUE, command: 'editMenu', group: 'Change an issue' },
  { keys: ['n'], label: 'New issue', when: ['global'], command: 'create', group: 'Change an issue' },
  { keys: ['u'], label: 'Undo the last change', when: ['global'], command: 'undo', group: 'Change an issue' },

  { keys: ['w'], label: 'Work on it with an agent', when: ISSUE, command: 'agentMenu', group: 'Agents and copying' },
  { keys: ['c'], label: 'Copy key, branch or link', when: ISSUE, command: 'copyMenu', group: 'Agents and copying' },
  { keys: ['o'], label: 'Open in the browser', when: ISSUE, command: 'openBrowser', group: 'Agents and copying' },

  { keys: ['ctrl+r'], label: 'retry', when: ['boot'], command: 'retry', group: 'Move around', hint: true },
  { keys: ['q'], label: 'quit', when: ['boot'], command: 'quit', group: 'Move around', hint: true },

  { keys: ['down'], display: '↑↓', label: 'choose', when: ['menu'], command: 'overlayDown', group: 'Overlay', hint: true },
  { keys: ['up'], label: 'up', when: ['menu'], command: 'overlayUp', group: 'Overlay', partner: true },
  // / keeps Home/End (and ctrl-d/ctrl-u) for its caret; the picker never draws one, so its list takes them
  { keys: ['pagedown'], label: 'page', when: ['menu', 'picker', 'finder', 'help'], command: 'overlayPageDown', group: 'Overlay' },
  { keys: ['pageup'], label: 'page up', when: ['menu', 'picker', 'finder', 'help'], command: 'overlayPageUp', group: 'Overlay', partner: true },
  { keys: ['home'], label: 'first', when: ['menu', 'picker', 'help'], command: 'overlayTop', group: 'Overlay' },
  { keys: ['end'], label: 'last', when: ['menu', 'picker', 'help'], command: 'overlayBottom', group: 'Overlay', partner: true },
  { keys: ['enter'], label: 'do it', when: ['menu'], command: 'overlayAccept', group: 'Overlay', hint: true },
  { keys: ['backspace'], label: 'back', when: ['menu'], command: 'overlayBack', group: 'Overlay', hint: true },
  { keys: ['esc'], label: 'close', when: ['menu'], command: 'overlayCancel', group: 'Overlay', hint: true },

  { keys: ['down', 'ctrl+n'], display: '↑↓', label: 'choose', when: ['picker', 'finder'], command: 'overlayDown', group: 'Overlay', hint: true },
  { keys: ['up', 'ctrl+p'], label: 'up', when: ['picker', 'finder'], command: 'overlayUp', group: 'Overlay', partner: true },
  { keys: DIGITS, display: '1-9', label: 'pick', when: ['picker'], command: 'pickerPick', group: 'Overlay', hint: true, hideIn: ['multipicker'] },
  { keys: ['space'], label: 'toggle', when: ['multipicker'], command: 'pickerToggle', group: 'Overlay', hint: true },
  { keys: ['enter'], label: 'apply', when: ['picker'], command: 'overlayAccept', group: 'Overlay', hint: true },
  { keys: ['enter'], label: 'do it', when: ['finder'], command: 'overlayAccept', group: 'Overlay', hint: true },
  { keys: ['esc'], label: 'cancel', when: ['picker'], command: 'overlayCancel', group: 'Overlay', hint: true },
  { keys: ['esc'], label: 'close', when: ['finder'], command: 'overlayCancel', group: 'Overlay', hint: true },

  { keys: ['tab', 'down'], display: '↑↓', label: 'field', when: ['compose-issue'], command: 'composeNext', group: 'Overlay', hint: true },
  { keys: ['shift+tab', 'up'], label: 'previous field', when: ['compose-issue'], command: 'composePrev', group: 'Overlay', partner: true },
  { keys: ['right', 'space'], display: '←→', label: 'change', when: ['compose-select'], command: 'composeCycleNext', group: 'Overlay', hint: true },
  { keys: ['left'], label: 'change back', when: ['compose-select'], command: 'composeCyclePrev', group: 'Overlay', partner: true },
  { keys: ['enter'], label: 'save', when: ['compose'], command: 'overlayAccept', group: 'Overlay', hint: true },
  { keys: ['esc'], label: 'cancel', when: ['compose'], command: 'overlayCancel', group: 'Overlay', hint: true },

  { keys: ['down', 'j'], display: '↑↓', label: 'scroll', when: ['help'], command: 'overlayDown', group: 'Overlay', hint: true },
  { keys: ['up', 'k'], label: 'scroll up', when: ['help'], command: 'overlayUp', group: 'Overlay', partner: true },
  { keys: ['enter', 'esc', '?', 'q'], display: 'enter', label: 'close', when: ['help'], command: 'overlayCancel', group: 'Overlay', hint: true },
];

/** the binding that runs `command` from a list, whose key the space menu and the help card show */
export const directBinding = (command: CommandId): Binding | undefined => BINDINGS.find(b => b.command === command && (b.when.includes('list') || b.when.includes('global')));

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
    case 'menu': return ['menu'];
    case 'find': return ['finder'];
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
  s.overlay.kind === 'find' || s.overlay.kind === 'picker' ||
  (s.overlay.kind === 'compose' && (s.overlay.target !== 'issue' || s.overlay.field === 'title'));

export function lookup(contexts: readonly Context[], name: string): Binding | undefined {
  for (const ctx of contexts) {
    const b = BINDINGS.find(x => x.when.includes(ctx) && x.keys.includes(name));
    if (b) return b;
  }
  return undefined;
}

const pretty = (k: string) => k.replace(/^ctrl\+/, 'ctrl-').replace(/^shift\+/, 'shift-').replace(/^meta\+/, 'alt-');
export const keyLabel = (b: Binding) => b.display ?? b.keys.filter(k => !['down', 'up', 'ctrl+n', 'ctrl+p'].includes(k) || b.keys.length === 1).map(pretty).join('/');

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
