import { resolve, ResolveError, type Baseline } from '../client/index.js';
import type { User } from '../core/types.js';
import { AGENT_HARNESSES, harnessNamed, harnessOfClient, SESSION_KEY, type AgentHarness } from '../core/work-types.js';
import { OpError, type Actor, type SessionKey } from './operation.js';

export function sessionFrom(raw: string | undefined): SessionKey | null {
  const v = raw?.trim();
  if (!v) return null;
  if (!SESSION_KEY.test(v)) throw new OpError('invalid', `BASELINE_SESSION "${v}" must be 1-64 characters of A-Z, a-z, 0-9 and . _ : -`);
  return v as SessionKey;
}

const agentNames = (users: readonly User[]) => users.filter(x => x.kind === 'agent').map(x => x.name).join(', ') || 'none yet';
const TOOLS = AGENT_HARNESSES.map(h => h.name).join(', ');

async function harnessActor(bl: Baseline, h: AgentHarness, users?: readonly User[]): Promise<Actor> {
  const have = users?.find(u => u.kind === 'agent' && u.name.toLowerCase() === h.name.toLowerCase());
  const u = have ?? await bl.ensureAgentUser(h.name);
  return { kind: 'agent', userId: u.id, name: u.name };
}

export async function actorFrom(bl: Baseline, name: string | undefined): Promise<Actor> {
  if (!name?.trim()) return { kind: 'person' };
  const snap = await bl.snapshot(['users', 'currentUser']);
  const h = harnessNamed(name);
  if (h) return harnessActor(bl, h, snap.users);
  let userId: string | undefined;
  try { userId = resolve.actorId(snap, undefined, name); } catch (e) {
    if (!(e instanceof ResolveError)) throw e;
    throw new OpError('invalid', `BASELINE_AS: ${e.message}. A coding tool (${TOOLS}) gets its own agent user on first use.`);
  }
  const u = snap.users.find(x => x.id === userId)!;
  if (u.id === snap.currentUser.id) return { kind: 'person' };
  if (u.kind !== 'agent') {
    throw new OpError('invalid', `BASELINE_AS names ${u.name}, a person. Agent commands write as an agent user (${agentNames(snap.users)}, or a coding tool: ${TOOLS}) on your behalf, or as you when BASELINE_AS is unset`);
  }
  return { kind: 'agent', userId: u.id, name: u.name };
}

export async function agentActor(bl: Baseline, as: string | undefined, client?: string): Promise<Actor> {
  if (as?.trim()) return actorFrom(bl, as);
  const h = harnessOfClient(client);
  if (h) return harnessActor(bl, h, (await bl.snapshot(['users'])).users);
  const snap = await bl.snapshot(['workspace', 'users']);
  const u = snap.users.find(x => x.id === snap.workspace.agentUserId);
  if (!u) throw new OpError('needs-human', `This workspace has no agent user. Set BASELINE_AS to an agent user (${agentNames(snap.users)})`);
  return { kind: 'agent', userId: u.id, name: u.name };
}

export const actorIdOf = (a: Actor): string | undefined => a.kind === 'agent' ? a.userId : undefined;
