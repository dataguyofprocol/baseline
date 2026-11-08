// What the CLI and the MCP server import from src/client. Transports and HttpBaseline stay internal.
import { DEFAULT_DB_PATH } from '../core/db.js';
import type { Issue } from '../core/types.js';
import { HttpBaseline, type Baseline } from './baseline.js';
import { readConfig } from './config.js';
import { resolveTarget, type Target } from './target.js';
import { transportFor } from './transport.js';
import type { IssueIndex } from './views.js';

export type { Baseline, IssueFilter, IssuePatch, Me, NewIssue } from './baseline.js';
export { BaselineError } from './errors.js';
export { describeTarget, serverUrl, TargetError, type CliConfig, type Target } from './target.js';
export { CONFIG_PATH, readConfig, removeConfig, writeConfig } from './config.js';
export * as resolve from './resolve.js';
export { ResolveError } from './resolve.js';
export * as views from './views.js';

/** this invocation's target: --db, then the environment, then `baseline login`'s config, then the default database */
export function targetFor(flags: { db?: string }): Target {
  return resolveTarget(flags, process.env, readConfig(), DEFAULT_DB_PATH);
}

export async function connect(flags: { db?: string }): Promise<Baseline> {
  const target = targetFor(flags);
  return new HttpBaseline(target, await transportFor(target));
}

/** `issues` by id, plus any parent of `of` that isn't among them (archived or deleted), fetched by id */
export async function issueIndex(bl: Baseline, issues: readonly Issue[], of: readonly Issue[]): Promise<IssueIndex> {
  const index = new Map(issues.map(i => [i.id, i]));
  for (const i of of) index.set(i.id, i);
  const missing = [...new Set(of.map(i => i.parentId).filter((p): p is string => !!p && !index.has(p)))];
  for (const p of await Promise.all(missing.map(id => bl.getIssue(id)))) if (p) index.set(p.id, p);
  return index;
}
