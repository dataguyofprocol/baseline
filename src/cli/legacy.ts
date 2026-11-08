// Commands not yet moved onto the client open the database directly, through here only. This is
// not a fallback: against a server they refuse. scripts/check-cli-legacy.ts counts the call sites
// and fails if the count rises; each migration lowers it, and the last one deletes this file.
import { createApp } from '../server/index.js';
import { attributing, attributionOf } from '../core/actor.js';
import { BaselineError, describeTarget, resolve, ResolveError, targetFor } from '../client/index.js';

let command = '';
let asFlag: string | undefined;
/** the running command's name ("label delete") for the refusal message, and its --as */
export function setLegacyCommand(name: string, as?: string): void { command = name; asFlag = as; }

/** the app over a local database, or a refusal when this invocation targets a server */
export function legacyApp(db: string | undefined) {
  const target = targetFor({ db });
  if (target.kind === 'remote') {
    throw new BaselineError(0, 'not-yet-remote', `\`${command}\` doesn't work against a hosted server yet (${describeTarget(target)}) — pass --db <path> to use a local database`);
  }
  const app = createApp(target.dbPath);
  actAsAgent(app.store);
  return { ...app, dbPath: target.dbPath };
}

export function legacyStore(db: string | undefined) {
  return legacyApp(db).store;
}

/** These commands skip the server, so they skip attributedActor too: when --as / BASELINE_AS names
 *  an agent, the rest of this one-shot process writes as that agent via this machine's user. */
function actAsAgent(store: ReturnType<typeof createApp>['store']): void {
  if (!asFlag && !process.env.BASELINE_AS) return;
  let agentId: string | undefined;
  try { agentId = resolve.actorId(store.snapshot(), asFlag, process.env.BASELINE_AS); } catch (e) { if (!(e instanceof ResolveError)) throw e; }
  if (agentId && store.userKind(agentId) === 'agent') attributing.enterWith(attributionOf({ id: agentId, kind: 'agent' }, store.actor()));
}
