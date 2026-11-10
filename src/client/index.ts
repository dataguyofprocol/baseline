import { existsSync } from 'node:fs';
import { DEFAULT_DB_PATH } from '../core/db.js';
import type { Issue } from '../core/types.js';
import { HttpBaseline, type Baseline } from './baseline.js';
import { readConfig } from './config.js';
import { resolveTarget, TargetError, type Target } from './target.js';
import { httpTransport, transportFor } from './transport.js';
import type { IssueIndex } from './views.js';

export type { Baseline, IssueFilter, IssuePatch, Me, NewIssue } from './baseline.js';
export { BaselineError } from './errors.js';
export { describeTarget, serverUrl, TargetError, type CliConfig, type Target } from './target.js';
export { CONFIG_PATH, readConfig, removeConfig, writeConfig } from './config.js';
export * as resolve from './resolve.js';
export { ResolveError } from './resolve.js';
export * as views from './views.js';

export function targetFor(flags: { db?: string }): Target {
  return resolveTarget(flags, process.env, readConfig(), DEFAULT_DB_PATH);
}

export async function connect(flags: { db?: string }): Promise<Baseline> {
  const target = targetFor(flags);
  return new HttpBaseline(target, await transportFor(target));
}

export const NOT_CONNECTED = 'Not connected to Baseline. Run `baseline login --server <url>`';

export function agentTarget(flags: { db?: string }): Target {
  const t = targetFor(flags);
  if (t.kind === 'remote') return t;
  if (t.source === 'default') throw new TargetError(`${NOT_CONNECTED} (or set BASELINE_DB to a local Baseline database).`);
  if (!existsSync(t.dbPath)) throw new TargetError(`${NOT_CONNECTED}. ${t.source === 'flag' ? '--db' : 'BASELINE_DB'} names ${t.dbPath}, which doesn't exist; the agent commands never create a database.`);
  return t;
}

export async function connectAgent(flags: { db?: string }): Promise<Baseline> {
  const target = agentTarget(flags);
  return new HttpBaseline(target, await transportFor(target));
}

export function connectTo(url: URL, token: string, send?: (req: Request) => Promise<Response>): Baseline {
  return new HttpBaseline({ kind: 'remote', url, token, source: 'config' }, httpTransport(url, token, send));
}

export async function issueIndex(bl: Baseline, issues: readonly Issue[], of: readonly Issue[]): Promise<IssueIndex> {
  const index = new Map(issues.map(i => [i.id, i]));
  for (const i of of) index.set(i.id, i);
  const missing = [...new Set(of.map(i => i.parentId).filter((p): p is string => !!p && !index.has(p)))];
  for (const p of await Promise.all(missing.map(id => bl.getIssue(id)))) if (p) index.set(p.id, p);
  return index;
}
