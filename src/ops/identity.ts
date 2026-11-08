// Who an agent session writes as, and in which session. The front doors (the CLI and the MCP
// server) call these once per process with what they were given; op bodies only see the result.
import { BaselineError, resolve, ResolveError, type Baseline } from '../client/index.js';
import type { User } from '../core/types.js';
import { SESSION_KEY } from '../core/work-types.js';
import { OpError, type Actor, type SessionKey } from './operation.js';

/** BASELINE_SESSION, or null. Deliberately never minted per process: an MCP server and the CLI run
 *  in one conversation must land on the same living comment. */
export function sessionFrom(raw: string | undefined): SessionKey | null {
  const v = raw?.trim();
  if (!v) return null;
  if (!SESSION_KEY.test(v)) throw new OpError('invalid', `BASELINE_SESSION "${v}" must be 1-64 characters of A-Z, a-z, 0-9 and . _ : -`);
  return v as SessionKey;
}

/** The coding agents Baseline knows by name. `clientNames` are the MCP `initialize` clientInfo.name
 *  values each one sends, as observed from the real client (`verified` says which version). */
export const KNOWN_AGENTS = [
  { agent: 'Claude Code', clientNames: ['claude-code'], verified: 'claude-code 2.1.319' },
  { agent: 'Codex', clientNames: ['codex-mcp-client'], verified: 'codex-cli 0.166.0' },
  { agent: 'pi', clientNames: ['pi'], verified: 'pi 1.5.0' },
] as const satisfies ReadonlyArray<{ agent: string; clientNames: readonly string[]; verified: string | null }>;

export type KnownAgent = (typeof KNOWN_AGENTS)[number]['agent'];

/** the agent user an MCP client writes as, from its clientInfo.name; undefined for a client Baseline doesn't know */
export function agentForClient(clientName: string | undefined): KnownAgent | undefined {
  const n = clientName?.trim().toLowerCase();
  return n ? KNOWN_AGENTS.find(a => (a.clientNames as readonly string[]).includes(n))?.agent : undefined;
}

const knownAgent = (name: string): KnownAgent | undefined => KNOWN_AGENTS.find(a => a.agent.toLowerCase() === name.trim().toLowerCase())?.agent;
const agentNames = (users: readonly User[]) => users.filter(x => x.kind === 'agent').map(x => x.name).join(', ') || 'none yet';

/** BASELINE_AS (name or user id) → the agent user the writes are attributed to. Unset, or naming
 *  the signed-in person, means the person writes as themself. Another person is refused here,
 *  before the server would refuse it. A known agent (Claude Code, Codex, pi) that has no user yet
 *  is added, where the workspace lets this person add users. */
export async function actorFrom(bl: Baseline, name: string | undefined): Promise<Actor> {
  if (!name?.trim()) return { kind: 'person' };
  const snap = await bl.snapshot(['users', 'currentUser']);
  let userId: string | undefined;
  try { userId = resolve.actorId(snap, undefined, name); } catch (e) {
    if (!(e instanceof ResolveError)) throw e;
    const known = knownAgent(name);
    if (known) return ensureAgent(bl, known, 'BASELINE_AS');
    throw new OpError('invalid', `BASELINE_AS: ${e.message}`);
  }
  const u = snap.users.find(x => x.id === userId)!;
  if (u.id === snap.currentUser.id) return { kind: 'person' };
  if (u.kind !== 'agent') {
    throw new OpError('invalid', `BASELINE_AS names ${u.name}, a person. Agent commands write as an agent user (${agentNames(snap.users)}) on your behalf, or as you when BASELINE_AS is unset`);
  }
  return { kind: 'agent', userId: u.id, name: u.name };
}

/**
 * An MCP session's actor: BASELINE_AS when it is set, else the agent its clientInfo names. MCP
 * calls always come from an agent, so an unknown client is an error, never "the person".
 */
export async function actorForClient(bl: Baseline, as: string | undefined, clientName: string | undefined): Promise<Actor> {
  if (as?.trim()) return actorFrom(bl, as);
  const agent = agentForClient(clientName);
  if (agent) return ensureAgent(bl, agent, 'clientInfo');
  const snap = await bl.snapshot(['users']);
  throw new OpError('needs-human',
    `Baseline doesn't know which agent the MCP client "${clientName ?? '(unnamed)'}" is, so it can't say who made a change. ` +
    `Set BASELINE_AS to an agent user (${agentNames(snap.users)}) in this MCP server's environment (for Baseline's /mcp URL, send a Baseline-As header), or add one with \`baseline user add "<name>" --agent\``);
}

/** the agent user named `name`, added when missing and the workspace allows this person to add users */
async function ensureAgent(bl: Baseline, name: KnownAgent, from: 'BASELINE_AS' | 'clientInfo'): Promise<Actor> {
  const snap = await bl.snapshot(['users']);
  const same = snap.users.filter(u => u.name.toLowerCase() === name.toLowerCase());
  const existing = same.find(u => u.kind === 'agent');
  if (existing) return { kind: 'agent', userId: existing.id, name: existing.name };
  if (same.length) throw new OpError('invalid', `"${name}" is a person in this workspace, not an agent user. Set BASELINE_AS to an agent user (${agentNames(snap.users)})`);
  try {
    const u = await bl.createAgentUser(name);
    return { kind: 'agent', userId: u.id, name: u.name };
  } catch (e) {
    if (!(e instanceof BaselineError) || (e.code !== 'forbidden' && e.code !== 'unauthorized')) throw e;
    throw new OpError('needs-human',
      `This workspace has no agent user "${name}"${from === 'clientInfo' ? ' for this MCP client' : ''}, and only an admin can add one. ` +
      `Ask an admin to run \`baseline user add "${name}" --agent\`, or set BASELINE_AS to an existing agent user (${agentNames(snap.users)})`);
  }
}

export const actorIdOf = (a: Actor): string | undefined => a.kind === 'agent' ? a.userId : undefined;
