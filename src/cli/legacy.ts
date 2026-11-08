// Commands not yet moved onto the client open the database directly, through here only. This is
// not a fallback: against a server they refuse. scripts/check-cli-legacy.ts counts the call sites
// and fails if the count rises; each migration lowers it, and the last one deletes this file.
import { createApp } from '../server/index.js';
import { BaselineError, describeTarget, targetFor } from '../client/index.js';

let command = '';
/** the running command's name ("label delete"), for the refusal message */
export function setLegacyCommand(name: string): void { command = name; }

/** the app over a local database, or a refusal when this invocation targets a server */
export function legacyApp(db: string | undefined) {
  const target = targetFor({ db });
  if (target.kind === 'remote') {
    throw new BaselineError(0, 'not-yet-remote', `\`${command}\` doesn't work against a hosted server yet (${describeTarget(target)}) — pass --db <path> to use a local database`);
  }
  return { ...createApp(target.dbPath), dbPath: target.dbPath };
}

export function legacyStore(db: string | undefined) {
  return legacyApp(db).store;
}
