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
export interface DraftFacts {
  since: string | null; completed: string[]; inProgress: string[]; inReview: string[]; blocked: string[]; filed: string[];
  /** key → title, so the draft names the work, not just its keys */
  titles?: Record<string, string>;
}
export interface DraftResult extends WorkReceipt { project: Project; url: string; draft: ProjectUpdateDraft; facts: DraftFacts }

// ---------- drafts, new issues, sub-issues (the agent asks before it creates) ----------

/** 'issue': new work the agent proposes to the person; 'followup': work found along the way, asked about at finish */
export type AgentDraftKind = 'issue' | 'followup';
/** An issue an agent proposed and nobody has created yet. Only the person it was proposed to sees it;
 *  create_issue with its id creates exactly this text, which is what the person said yes to. */
export interface AgentDraft {
  id: string;
  kind: AgentDraftKind;
  personId: string;
  agentId: string;
  teamId: string;
  /** the issue the agent was working on when it noted a follow-up */
  fromIssueId: string | null;
  title: string;
  description: string;
  priority: number;
  status: 'pending' | 'filed';
  /** the issue created from it, once filed */
  issueId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ProposeResult extends WorkReceipt { draft: AgentDraft; deduplicated: boolean }
export interface CreateIssueResult extends WorkReceipt {
  issue: Issue; url: string; draft: AgentDraft | null;
  /** the issue's branch; a work thread is open on it when the issue was started */
  branch: string; started: boolean; deduplicated: boolean;
}
export interface SubIssuesResult extends WorkReceipt { parent: Issue; created: Issue[]; existing: Issue[] }

/** The coding tools that get their own agent user ("Claude Code via Parth"), made on first use.
 *  `clients` are MCP clientInfo.name prefixes. Only these names are made on the fly, so a typo in
 *  --as doesn't leave a stray user behind. */
export const AGENT_HARNESSES = [
  { name: 'Claude Code', slug: 'claude-code', initials: 'CC', color: '#d97757', clients: ['claude-code', 'claude'] },
  { name: 'Codex', slug: 'codex', initials: 'CX', color: '#10a37f', clients: ['codex'] },
  { name: 'Cursor', slug: 'cursor', initials: 'CU', color: '#307ec6', clients: ['cursor'] },
  { name: 'pi', slug: 'pi', initials: 'PI', color: '#c770f4', clients: ['pi'] },
  { name: 'Gemini CLI', slug: 'gemini-cli', initials: 'GE', color: '#4285f4', clients: ['gemini'] },
] as const;
export type AgentHarness = (typeof AGENT_HARNESSES)[number];

/** a harness by its name or slug ("Claude Code", "claude-code"), any case */
export const harnessNamed = (name: string | undefined): AgentHarness | undefined => {
  const n = name?.trim().toLowerCase();
  return n ? AGENT_HARNESSES.find(h => h.name.toLowerCase() === n || h.slug === n) : undefined;
};
/** a harness by the MCP client's clientInfo.name ("claude-code", "codex-mcp-client") */
export const harnessOfClient = (client: string | undefined): AgentHarness | undefined => {
  const n = client?.trim().toLowerCase();
  return n ? AGENT_HARNESSES.find(h => h.clients.some(c => n === c || n.startsWith(`${c}-`) || n.startsWith(`${c}_`))) : undefined;
};

export interface UndoResult {
  /** the undo's own op id; null when the op was already undone */
  opId: string | null;
  undid: { opId: string; name: string };
  reverted: string[];
  /** what the undo left as it is, and why (e.g. "the progress note: edited since") */
  leftAsIs: string[];
  alreadyUndone: boolean;
}
