// Who an agent session writes as, and in which session. The front doors (the CLI and the MCP
// server) call these once per process with what they were given; op bodies only see the result.
import { resolve, ResolveError, type Baseline } from '../client/index.js';
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

const agentNames = (users: readonly User[]) => users.filter(x => x.kind === 'agent').map(x => x.name).join(', ') || 'none yet';

/** BASELINE_AS (name or user id) → the agent user the writes are attributed to. Unset, or naming
 *  the signed-in person, means the person writes as themself. Another person is refused here,
 *  before the server would refuse it. */
export async function actorFrom(bl: Baseline, name: string | undefined): Promise<Actor> {
  if (!name?.trim()) return { kind: 'person' };
  const snap = await bl.snapshot(['users', 'currentUser']);
  let userId: string | undefined;
  try { userId = resolve.actorId(snap, undefined, name); } catch (e) {
    if (!(e instanceof ResolveError)) throw e;
    throw new OpError('invalid', `BASELINE_AS: ${e.message}`);
  }
  const u = snap.users.find(x => x.id === userId)!;
  if (u.id === snap.currentUser.id) return { kind: 'person' };
  if (u.kind !== 'agent') {
    throw new OpError('invalid', `BASELINE_AS names ${u.name}, a person. Agent commands write as an agent user (${agentNames(snap.users)}) on your behalf, or as you when BASELINE_AS is unset`);
  }
  return { kind: 'agent', userId: u.id, name: u.name };
}

/** An agent operation's actor (an MCP tool or a `baseline agent` command): BASELINE_AS when it is
 *  set, else the workspace's agent user. Naming yourself in BASELINE_AS writes as you. */
export async function agentActor(bl: Baseline, as: string | undefined): Promise<Actor> {
  if (as?.trim()) return actorFrom(bl, as);
  const snap = await bl.snapshot(['workspace', 'users']);
  const u = snap.users.find(x => x.id === snap.workspace.agentUserId);
  if (!u) throw new OpError('needs-human', `This workspace has no agent user. Set BASELINE_AS to an agent user (${agentNames(snap.users)})`);
  return { kind: 'agent', userId: u.id, name: u.name };
}

export const actorIdOf = (a: Actor): string | undefined => a.kind === 'agent' ? a.userId : undefined;
