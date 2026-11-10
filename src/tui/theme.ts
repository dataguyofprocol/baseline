// Colors and glyphs. Hex colors render as truecolor where the terminal supports it and degrade otherwise.
import type { Priority, ProjectHealth, WorkflowStateType } from '../core/types.js';

export const theme = {
  accent: '#7c8cff',
  text: undefined as string | undefined,
  muted: 'gray',
  ok: '#4cb782',
  warn: '#f2c94c',
  error: '#eb5757',
  urgent: '#f2994a',
  border: 'gray',
  /** a key letter: amber on a dark chip, wherever a key is shown */
  key: '#f5b26b',
  keyBg: '#2b313b',
  /** the row under the cursor and the active tab */
  selBg: '#1d2a3e',
  tabBg: '#2a3240',
};

export const STATE_ICON: Record<WorkflowStateType, string> = {
  triage: '◇',
  backlog: '◌',
  unstarted: '○',
  started: '◐',
  completed: '●',
  canceled: '⊘',
};

/** a three-cell glyph so priority columns line up; `lit` of the three bars are bright */
export function priorityGlyph(p: Priority): { text: string; color?: string; lit: number } {
  switch (p) {
    case 1: return { text: ' ! ', color: theme.urgent, lit: 3 };
    case 2: return { text: '▂▄▆', lit: 3 };
    case 3: return { text: '▂▄▆', lit: 2 };
    case 4: return { text: '▂▄▆', lit: 1 };
    default: return { text: ' · ', color: theme.muted, lit: 3 };
  }
}

/** a key as a chip, the way every screen shows the key that does something */
export const keySeg = (k: string) => ({ text: k, color: theme.key, bg: theme.keyBg, bold: true });

/** one cell, for the narrow list rows and the detail pane */
export function priorityMark(p: Priority): { text: string; color?: string } {
  switch (p) {
    case 1: return { text: '!', color: theme.urgent };
    case 2: return { text: '↑' };
    case 3: return { text: '-' };
    case 4: return { text: '↓', color: theme.muted };
    default: return { text: '·', color: theme.muted };
  }
}

export const HEALTH: Record<ProjectHealth, { label: string; color: string }> = {
  onTrack: { label: 'On track', color: theme.ok },
  atRisk: { label: 'At risk', color: theme.warn },
  offTrack: { label: 'Off track', color: theme.error },
};

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
