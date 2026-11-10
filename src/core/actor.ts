import { AsyncLocalStorage } from 'node:async_hooks';

export const actingUser = new AsyncLocalStorage<string>();

export const currentOp = new AsyncLocalStorage<string>();

export type Attribution =
  | { actor: 'person'; actorId: string; viaUserId: null }
  | { actor: 'agent'; actorId: string; viaUserId: string };

export const attributing = new AsyncLocalStorage<Attribution>();

export function viaFor(actorId: string): string | null {
  const a = attributing.getStore();
  return a && a.actorId === actorId ? a.viaUserId : null;
}

export function attributionOf(actor: { id: string; kind: 'human' | 'agent' }, person: string): Attribution {
  return actor.kind === 'agent' && person && person !== actor.id
    ? { actor: 'agent', actorId: actor.id, viaUserId: person }
    : { actor: 'person', actorId: actor.id, viaUserId: null };
}
