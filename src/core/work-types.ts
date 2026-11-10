import type { Issue, Project, ProjectHealth } from './types.js';

export type WorkOutcome = 'in_review' | 'done' | 'stopped';
export const WORK_OUTCOMES = ['in_review', 'done', 'stopped'] as const satisfies readonly WorkOutcome[];

export const SESSION_KEY = /^[A-Za-z0-9._:-]{1,64}$/;

export interface WorkThread {
  id: string;
  issueId: string;
  agentId: string;
  personId: string;
  sessionKey: string | null;
  /** the living comment; null until the first progress or finish (or after a person deleted it) */
  commentId: string | null;
  branch: string;
  progress: ProgressFields;
  links: string[];
  state: { status: 'active' } | { status: 'finished'; outcome: WorkOutcome; summary: string; finishedAt: string };
  startedAt: string;
  updatedAt: string;
}

/** the progress note's fields; null = not said */
export interface ProgressFields { did: string | null; left: string | null; blocked: string | null }

/** what a post_progress call says: an omitted field keeps its last value, "" clears it */
export type ProgressPatch = Partial<Record<keyof ProgressFields, string>>;

/** every write answers with this. opId is null when the call changed nothing (a repeat converged). */
export interface WorkReceipt { opId: string | null; attributedTo: string }

export interface StartWorkResult extends WorkReceipt {
  issue: Issue; url: string; thread: WorkThread; branch: string; brief: string;
  changed: { moved: boolean; assigned: boolean };
  warnings: string[];
}
export interface ProgressResult extends WorkReceipt { issue: Issue; url: string; thread: WorkThread; created: boolean; linksAdded: number }
export interface FinishWorkResult extends WorkReceipt { issue: Issue; url: string; thread: WorkThread; warnings: string[] }
export interface FollowupResult extends WorkReceipt { issue: Issue; url: string; source: Issue; deduplicated: boolean }

export type Health = ProjectHealth;
export interface ProjectUpdateDraft {
  projectId: string;
  personId: string;
  authorId: string;
  body: string;
  health: Health | null;
  updatedAt: string;
}
export interface DraftFacts {
  since: string | null; completed: string[]; inProgress: string[]; inReview: string[]; blocked: string[]; filed: string[];
  titles?: Record<string, string>;
}
export interface DraftResult extends WorkReceipt { project: Project; url: string; draft: ProjectUpdateDraft; facts: DraftFacts }


export type AgentDraftKind = 'issue' | 'followup';
export interface AgentDraft {
  id: string;
  kind: AgentDraftKind;
  personId: string;
  agentId: string;
  teamId: string;
  fromIssueId: string | null;
  title: string;
  description: string;
  priority: number;
  status: 'pending' | 'filed';
  issueId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ProposeResult extends WorkReceipt { draft: AgentDraft; deduplicated: boolean }
export interface CreateIssueResult extends WorkReceipt {
  issue: Issue; url: string; draft: AgentDraft | null;
  branch: string; started: boolean; deduplicated: boolean;
}
export interface SubIssuesResult extends WorkReceipt { parent: Issue; created: Issue[]; existing: Issue[] }

export const AGENT_HARNESSES = [
  { name: 'Claude Code', slug: 'claude-code', initials: 'CC', color: '#d97757', clients: ['claude-code', 'claude'] },
  { name: 'Codex', slug: 'codex', initials: 'CX', color: '#10a37f', clients: ['codex'] },
  { name: 'Cursor', slug: 'cursor', initials: 'CU', color: '#307ec6', clients: ['cursor'] },
  { name: 'pi', slug: 'pi', initials: 'PI', color: '#c770f4', clients: ['pi'] },
  { name: 'Gemini CLI', slug: 'gemini-cli', initials: 'GE', color: '#4285f4', clients: ['gemini'] },
] as const;
export type AgentHarness = (typeof AGENT_HARNESSES)[number];

export const harnessNamed = (name: string | undefined): AgentHarness | undefined => {
  const n = name?.trim().toLowerCase();
  return n ? AGENT_HARNESSES.find(h => h.name.toLowerCase() === n || h.slug === n) : undefined;
};
export const harnessOfClient = (client: string | undefined): AgentHarness | undefined => {
  const n = client?.trim().toLowerCase();
  return n ? AGENT_HARNESSES.find(h => h.clients.some(c => n === c || n.startsWith(`${c}-`) || n.startsWith(`${c}_`))) : undefined;
};

export interface UndoResult {
  /** the undo's own op id; null when the op was already undone */
  opId: string | null;
  undid: { opId: string; name: string };
  reverted: string[];
  leftAsIs: string[];
  alreadyUndone: boolean;
}
