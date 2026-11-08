import { AsyncLocalStorage } from 'node:async_hooks';

/** The user a server request acts as. The session middleware runs each request inside it, so
 *  the store attributes writes to the signed-in person without every call passing an id.
 *  Outside a request (the CLI, local single-user mode) it is empty and the store falls back
 *  to the workspace's own `currentUser`. */
export const actingUser = new AsyncLocalStorage<string>();

/**
 * Who a write is by. An agent user writes on a person's behalf (`viaUserId`, shown as
 * "Claude Code via Parth"); a person writes as themselves and has no via.
 * Build one with attributionOf, which looks at the actor's kind.
 */
export type Attribution =
  | { actor: 'person'; actorId: string; viaUserId: null }
  | { actor: 'agent'; actorId: string; viaUserId: string };

/** The attribution a write runs under. The store records its via on every row by that actor
 *  (activity, the comment, the project update) and on none by anyone else, so an automation
 *  that fires during an agent's write stays its own. */
export const attributing = new AsyncLocalStorage<Attribution>();

/** the person to record beside a row by `actorId`, from the write's attribution */
export function viaFor(actorId: string): string | null {
  const a = attributing.getStore();
  return a && a.actorId === actorId ? a.viaUserId : null;
}

/** `actor` writing for `person`: an agent gets `person` as its via, anyone else writes as themselves.
 *  An agent acting for itself (no person to name) has no via. */
export function attributionOf(actor: { id: string; kind: 'human' | 'agent' }, person: string): Attribution {
  return actor.kind === 'agent' && person && person !== actor.id
    ? { actor: 'agent', actorId: actor.id, viaUserId: person }
    : { actor: 'person', actorId: actor.id, viaUserId: null };
}
