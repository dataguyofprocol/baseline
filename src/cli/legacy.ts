import { createApp } from '../server/index.js';
import { attributing, attributionOf } from '../core/actor.js';
import { BaselineError, describeTarget, resolve, ResolveError, targetFor } from '../client/index.js';

let command = '';
let asFlag: string | undefined;
export function setLegacyCommand(name: string, as?: string): void { command = name; asFlag = as; }

export function legacyApp(db: string | undefined) {
  const target = targetFor({ db });
  if (target.kind === 'remote') {
    throw new BaselineError(0, 'not-yet-remote', `\`${command}\` isn't available against a Baseline server yet (${describeTarget(target)}); it works on a local database only. Use the web app for it meanwhile.`);
  }
  const app = createApp(target.dbPath, { mode: 'local' }, { configured: false, send: async () => {} });
  actAsAgent(app.store);
  return { ...app, dbPath: target.dbPath };
}

export function legacyStore(db: string | undefined) {
  return legacyApp(db).store;
}

function actAsAgent(store: ReturnType<typeof createApp>['store']): void {
  if (!asFlag && !process.env.BASELINE_AS) return;
  let agentId: string | undefined;
  try { agentId = resolve.actorId(store.snapshot(), asFlag, process.env.BASELINE_AS); } catch (e) { if (!(e instanceof ResolveError)) throw e; }
  if (agentId && store.userKind(agentId) === 'agent') attributing.enterWith(attributionOf({ id: agentId, kind: 'agent' }, store.actor()));
}
