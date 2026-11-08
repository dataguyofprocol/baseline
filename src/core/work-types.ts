// What the work routes (server/index.ts › agent work) send and the client (client/baseline.ts)
// receives. Pure types, shared by both sides; the agent operations (src/ops) shape them for the model.
import type { Issue, Project, ProjectHealth } from './types.js';

export type WorkOutcome = 'in_review' | 'done' | 'stopped';
export const WORK_OUTCOMES = ['in_review', 'done', 'stopped'] as const satisfies readonly WorkOutcome[];

/** BASELINE_SESSION: splits living comments when one person runs two sessions of one agent on an issue */
export const SESSION_KEY = /^[A-Za-z0-9._:-]{1,64}$/;

/** One agent's work on one issue for one person (and session): the living comment and what it said.
 *  A finished thread always has its outcome and time; an active one never does. */
export interface WorkThread {
  id: string;
  issueId: string;
  /** the agent user, or the person themself when no agent was named */
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
  /** the person it is for: only they see it, and only they publish it */
  personId: string;
  /** who wrote the current text (an agent, or the person) */
  authorId: string;
  body: string;
  health: Health | null;
  updatedAt: string;
}
/** issue keys, grouped by what happened since the project's last published update */
export interface DraftFacts { since: string | null; completed: string[]; inProgress: string[]; inReview: string[]; blocked: string[]; filed: string[] }
export interface DraftResult extends WorkReceipt { project: Project; url: string; draft: ProjectUpdateDraft; facts: DraftFacts }

export interface UndoResult {
  /** the undo's own op id; null when the op was already undone */
  opId: string | null;
  undid: { opId: string; name: string };
  reverted: string[];
  /** what the undo left as it is, and why (e.g. "the progress note: edited since") */
  leftAsIs: string[];
  alreadyUndone: boolean;
}
