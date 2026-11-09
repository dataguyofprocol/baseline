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

export const HEALTH: Record<ProjectHealth, { label: string; color: string }> = {
  onTrack: { label: 'On track', color: theme.ok },
  atRisk: { label: 'At risk', color: theme.warn },
  offTrack: { label: 'Off track', color: theme.error },
};

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
