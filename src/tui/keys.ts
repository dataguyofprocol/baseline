import type { Key } from 'ink';
import { isListRoute } from './model.js';
import { agentAsk } from './today.js';
import type { TuiState } from './state.js';

export type Context =
  | 'global' | 'boot' | 'today' | 'list' | 'detail' | 'review' | 'blocked'
  | 'menu' | 'picker' | 'multipicker' | 'finder' | 'compose' | 'compose-issue' | 'compose-select' | 'help'
  | 'sheet' | 'sheet-list' | 'sheet-start' | 'sheet-check' | 'sheet-text' | 'sheet-answer' | 'sheet-standup';

export type CommandId =
  | 'quit' | 'backOrQuit' | 'back' | 'help' | 'search' | 'refresh' | 'retry' | 'tab'
  | 'down' | 'up' | 'pageDown' | 'pageUp' | 'halfDown' | 'halfUp' | 'top' | 'bottom' | 'open' | 'actions'
  | 'undo' | 'setState' | 'setPriority' | 'setAssignee' | 'setLabels' | 'setProject' | 'comment' | 'create'
  | 'editMenu' | 'editTitle' | 'editDescription'
  | 'done' | 'sendBack' | 'followups' | 'markRead'
  | 'agentMenu' | 'agentHere' | 'agentPane' | 'copyMenu' | 'copyKey' | 'copyUrl' | 'copyBranch' | 'copyPrompt' | 'openBrowser'
  | 'standup' | 'projects' | 'notifications'
  | 'overlayDown' | 'overlayUp' | 'overlayPageDown' | 'overlayPageUp' | 'overlayTop' | 'overlayBottom' | 'overlayAccept' | 'overlayCancel' | 'overlayBack' | 'menuKey' | 'pickerToggle' | 'pickerPick'
  | 'composeNext' | 'composePrev' | 'composeCycleNext' | 'composeCyclePrev'
  | 'sheetPick' | 'sheetToggle' | 'sheetRerun' | 'sheetEditor' | 'sheetCopy';

export type Task = 'Move around' | 'Decide' | 'Change an issue' | 'Agents and copying' | 'Find and views' | 'Overlay';

export interface Binding {
  keys: string[];
  display?: string;
  label: string;
  when: Context[];
  command: CommandId;
  group: Task;
  hint?: boolean;
  short?: string;
  partner?: boolean;
  hideIn?: Context[];
  hintOnly?: Context[];
}

const NAV: Context[] = ['today', 'list'];
const PAGED: Context[] = [...NAV, 'detail'];
const ISSUE: Context[] = ['today', 'list', 'detail'];
const EVERYWHERE: Context[] = ['global', 'boot', 'menu', 'picker', 'multipicker', 'finder', 'compose', 'help', 'sheet'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const BINDINGS: Binding[] = [
  { keys: ['down', 'j'], display: '↑↓', label: 'move', when: NAV, command: 'down', group: 'Move around', hint: true },
  { keys: ['up', 'k'], label: 'up', when: NAV, command: 'up', group: 'Move around', partner: true },
  { keys: ['down', 'j'], display: '↑↓', label: 'scroll the issue page', short: 'scroll', when: ['detail'], command: 'down', group: 'Move around', hint: true, hideIn: ['review', 'blocked'] },
  { keys: ['up', 'k'], label: 'scroll up', when: ['detail'], command: 'up', group: 'Move around', partner: true },
  { keys: ['pagedown'], display: 'PgDn PgUp', label: 'page', when: PAGED, command: 'pageDown', group: 'Move around' },
  { keys: ['pageup'], label: 'page up', when: PAGED, command: 'pageUp', group: 'Move around', partner: true },
  { keys: ['ctrl+d'], display: 'ctrl-d ctrl-u', label: 'half page', when: PAGED, command: 'halfDown', group: 'Move around' },
  { keys: ['ctrl+u'], label: 'half page up', when: PAGED, command: 'halfUp', group: 'Move around', partner: true },
  { keys: ['g', 'home'], display: 'g G', label: 'top, bottom (Home End too)', when: PAGED, command: 'top', group: 'Move around' },
  { keys: ['G', 'end'], label: 'bottom', when: PAGED, command: 'bottom', group: 'Move around', partner: true },
  { keys: ['enter'], label: 'go into the thing under the cursor, or take its next step', short: 'open', when: NAV, command: 'open', group: 'Move around', hint: true },
  { keys: ['esc'], label: 'back one level; Today is never more than two presses away', short: 'back', when: ['detail', 'list'], command: 'back', group: 'Move around', hint: true, hideIn: ['review', 'blocked'] },
  { keys: DIGITS, display: '1-9', label: 'a place: 1 is Today, then your teams', short: 'places', when: ['global'], command: 'tab', group: 'Move around', hint: true, hideIn: ['review', 'blocked'] },
  { keys: ['/'], label: 'everything without a tab: any issue, projects, notifications, standup', short: 'find', when: ['global'], command: 'search', group: 'Find and views', hint: true, hideIn: ['review', 'blocked'] },
  { keys: ['space'], label: 'every action here, each with its letter', short: 'actions', when: ISSUE, command: 'actions', group: 'Find and views', hint: true, hideIn: ['review', 'blocked'] },
  { keys: ['?'], label: 'this help', short: 'help', when: ['global'], command: 'help', group: 'Find and views', hint: true, hideIn: ['review', 'blocked'] },
  { keys: ['esc'], label: 'back', when: ['global'], command: 'back', group: 'Move around' },
  { keys: ['q'], label: 'back, or quit from a tab', when: ['global'], command: 'backOrQuit', group: 'Move around' },
  { keys: ['ctrl+r'], label: 'refresh now', when: ['global'], command: 'refresh', group: 'Move around' },
  { keys: ['ctrl+c'], label: 'quit', when: EVERYWHERE, command: 'quit', group: 'Move around' },

  { keys: ['b'], label: 'Answer and rerun', when: ['blocked'], command: 'sendBack', group: 'Decide', hint: true, partner: true },
  { keys: ['d'], label: 'Done', when: ISSUE, command: 'done', group: 'Decide', hint: true, hintOnly: ['review', 'blocked'] },
  { keys: ['b'], label: 'Send back, or answer a blocked agent', short: 'Send back', when: ISSUE, command: 'sendBack', group: 'Decide', hint: true, hintOnly: ['review', 'blocked'] },
  { keys: ['f'], label: 'File the agent\'s follow-ups', short: 'File follow-ups', when: ISSUE, command: 'followups', group: 'Decide', hint: true, hintOnly: ['review'] },
  { keys: ['r'], label: 'Done: mark read', when: ISSUE, command: 'markRead', group: 'Decide' },

  { keys: ['s'], label: 'Status', when: ISSUE, command: 'setState', group: 'Change an issue' },
  { keys: ['a'], label: 'Assignee', when: ISSUE, command: 'setAssignee', group: 'Change an issue' },
  { keys: ['p'], label: 'Priority', when: ISSUE, command: 'setPriority', group: 'Change an issue' },
  { keys: ['l'], label: 'Labels', when: ISSUE, command: 'setLabels', group: 'Change an issue' },
  { keys: ['m'], label: 'Comment', when: ISSUE, command: 'comment', group: 'Change an issue', hint: true, hintOnly: ['review', 'blocked'] },
  { keys: ['e'], label: 'Edit title or description', when: ISSUE, command: 'editMenu', group: 'Change an issue' },
  { keys: ['n'], label: 'New issue', when: ['global'], command: 'create', group: 'Change an issue' },
  { keys: ['u'], label: 'Undo the last change', when: ['global'], command: 'undo', group: 'Change an issue' },

  { keys: ['w'], label: 'Work on it with an agent', short: 'Agent again', when: ISSUE, command: 'agentMenu', group: 'Agents and copying', hint: true, hintOnly: ['review', 'blocked'] },
  { keys: ['c'], label: 'Copy key, branch or link', when: ISSUE, command: 'copyMenu', group: 'Agents and copying' },
  { keys: ['o'], label: 'Open the PR, or the issue, in the browser', short: 'PR', when: ISSUE, command: 'openBrowser', group: 'Agents and copying', hint: true, hintOnly: ['review'] },

  { keys: ['esc'], label: 'back', short: 'Today', when: ['review', 'blocked'], command: 'back', group: 'Move around', hint: true },
  { keys: ['ctrl+r'], label: 'retry', when: ['boot'], command: 'retry', group: 'Move around', hint: true },
  { keys: ['q'], label: 'quit', when: ['boot'], command: 'quit', group: 'Move around', hint: true },

  { keys: ['down'], display: '↑↓', label: 'choose', when: ['menu'], command: 'overlayDown', group: 'Overlay', hint: true },
  { keys: ['up'], label: 'up', when: ['menu'], command: 'overlayUp', group: 'Overlay', partner: true },
  { keys: ['pagedown'], label: 'page', when: ['menu', 'picker', 'finder', 'help', 'sheet-list'], command: 'overlayPageDown', group: 'Overlay' },
  { keys: ['pageup'], label: 'page up', when: ['menu', 'picker', 'finder', 'help', 'sheet-list'], command: 'overlayPageUp', group: 'Overlay', partner: true },
  { keys: ['home'], label: 'first', when: ['menu', 'picker', 'help', 'sheet-list'], command: 'overlayTop', group: 'Overlay' },
  { keys: ['end'], label: 'last', when: ['menu', 'picker', 'help', 'sheet-list'], command: 'overlayBottom', group: 'Overlay', partner: true },
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

  { keys: ['down', 'j', 'ctrl+n'], display: '↑↓', label: 'choose', when: ['sheet-list', 'sheet-start'], command: 'overlayDown', group: 'Overlay', hint: true },
  { keys: ['up', 'k', 'ctrl+p'], label: 'up', when: ['sheet-list', 'sheet-start'], command: 'overlayUp', group: 'Overlay', partner: true },
  { keys: ['1', '2', '3', '4'], display: '1-4', label: 'start that way', when: ['sheet-start'], command: 'sheetPick', group: 'Overlay' },
  { keys: ['space'], label: 'tick', when: ['sheet-check'], command: 'sheetToggle', group: 'Overlay', hint: true },
  { keys: ['tab'], label: 'how to run it', when: ['sheet-answer'], command: 'sheetRerun', group: 'Overlay', hint: true },
  { keys: ['ctrl+e'], display: 'ctrl-e', label: '$EDITOR', when: ['sheet-text'], command: 'sheetEditor', group: 'Overlay', hint: true },
  { keys: ['c'], label: 'copy', when: ['sheet-standup'], command: 'sheetCopy', group: 'Overlay', hint: true },
  { keys: ['enter'], label: 'do it', when: ['sheet'], command: 'overlayAccept', group: 'Overlay', hint: true },
  { keys: ['esc'], label: 'close', when: ['sheet'], command: 'overlayCancel', group: 'Overlay', hint: true },

  { keys: ['down', 'j'], display: '↑↓', label: 'scroll', when: ['help'], command: 'overlayDown', group: 'Overlay', hint: true },
  { keys: ['up', 'k'], label: 'scroll up', when: ['help'], command: 'overlayUp', group: 'Overlay', partner: true },
  { keys: ['enter', 'esc', '?', 'q'], display: 'enter', label: 'close', when: ['help'], command: 'overlayCancel', group: 'Overlay', hint: true },
];

export const directBinding = (command: CommandId): Binding | undefined => BINDINGS.find(b => b.command === command && (b.when.includes('today') || b.when.includes('list') || b.when.includes('global')));

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

export function contextsFor(s: Pick<TuiState, 'status' | 'data' | 'overlay' | 'route'> & Partial<Pick<TuiState, 'threads'>>): Context[] {
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
    case 'sheet': {
      const t = o.sheet.type;
      if (t === 'note') return o.sheet.purpose === 'answer' ? ['sheet-answer', 'sheet-text', 'sheet'] : ['sheet-text', 'sheet'];
      if (t === 'start') return ['sheet-start', 'sheet'];
      if (t === 'followups') return ['sheet-check', 'sheet-list', 'sheet'];
      if (t === 'standup') return ['sheet-standup', 'sheet'];
      return ['sheet-list', 'sheet'];
    }
    case 'none': break;
  }
  const r = s.route;
  const issue = r.kind === 'issue' ? s.data.issueById.get(r.issueId) : undefined;
  const agent = issue ? agentAsk(s.data, issue, s.threads?.[issue.id]) : null;
  if (agent) return [agent.ask, 'detail', 'global'];
  return [baseContext(r), 'global'];
}

export const baseContext = (r: TuiState['route']): Context =>
  r.kind === 'today' ? 'today' : isListRoute(r) ? 'list' : 'detail';

export const takesText = (s: Pick<TuiState, 'overlay'>) =>
  s.overlay.kind === 'find' || s.overlay.kind === 'picker' ||
  (s.overlay.kind === 'compose' && (s.overlay.target !== 'issue' || s.overlay.field === 'title')) ||
  (s.overlay.kind === 'sheet' && s.overlay.sheet.type === 'note');

export function lookup(contexts: readonly Context[], name: string): Binding | undefined {
  for (const ctx of contexts) {
    const b = BINDINGS.find(x => x.when.includes(ctx) && x.keys.includes(name));
    if (b) return b;
  }
  return undefined;
}

const pretty = (k: string) => k.replace(/^ctrl\+/, 'ctrl-').replace(/^shift\+/, 'shift-').replace(/^meta\+/, 'alt-');
export const keyLabel = (b: Binding) => b.display ?? b.keys.filter(k => !['down', 'up', 'ctrl+n', 'ctrl+p'].includes(k) || b.keys.length === 1).map(pretty).join('/');

export function hintsFor(contexts: readonly Context[]): Array<{ key: string; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string }> = [];
  for (const b of BINDINGS) {
    if (!b.hint || !b.when.some(c => contexts.includes(c)) || seen.has(b.command)) continue;
    if (b.hintOnly && !b.hintOnly.some(c => contexts.includes(c))) continue;
    if (b.when.every(c => !contexts.includes(c) || b.hideIn?.some(h => contexts.includes(h)))) continue;
    seen.add(b.command);
    out.push({ key: keyLabel(b), label: b.short ?? b.label });
  }
  return out;
}
