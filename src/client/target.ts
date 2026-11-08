// Where one CLI (or MCP) invocation sends its requests. Pure: it reads only what it is given.
import { resolve } from 'node:path';

/** Exactly one per invocation. There is no "remote, else local": a target that can't be built is an error. */
export type Target =
  | { kind: 'local'; dbPath: string; source: 'flag' | 'env' | 'default' }
  | { kind: 'remote'; url: URL; token: string; source: 'env' | 'config' };

/** ~/.baseline/config.json, mode 0600, written by `baseline login` */
export interface CliConfig {
  version: 1;
  /** origin only, e.g. https://baseline.example.com */
  server: string;
  token: string;
  /** so `logout` revokes exactly this key */
  keyId: string;
  user: { id: string; name: string; email: string };
}

/** absent is normal; unreadable or malformed is an error, never "not logged in" */
export type ConfigRead = { kind: 'absent' } | { kind: 'ok'; config: CliConfig } | { kind: 'invalid'; reason: string };

export class TargetError extends Error {}

export interface TargetEnv { BASELINE_DB?: string; BASELINE_URL?: string; BASELINE_TOKEN?: string }

/**
 * First match wins; each branch returns a Target or throws:
 * 1. --db                              local (flag)
 * 2. BASELINE_DB and BASELINE_URL      error: two targets named
 * 3. BASELINE_DB                       local (env)
 * 4. BASELINE_URL + BASELINE_TOKEN     remote (env); either one alone is an error
 * 5. config.json                       remote (config); an invalid file is an error
 * 6. nothing                           local (default)
 */
export function resolveTarget(flags: { db?: string }, env: TargetEnv, config: ConfigRead, defaultDbPath: string): Target {
  const set = (v: string | undefined) => v?.trim() || undefined;
  const db = set(env.BASELINE_DB), url = set(env.BASELINE_URL), token = set(env.BASELINE_TOKEN);
  if (set(flags.db)) return { kind: 'local', dbPath: resolve(flags.db!), source: 'flag' };
  if (db && url) throw new TargetError('Both BASELINE_DB and BASELINE_URL are set — unset one, or pass --db <path> for a local database');
  if (db) return { kind: 'local', dbPath: resolve(db), source: 'env' };
  if (url || token) {
    if (!url) throw new TargetError('BASELINE_TOKEN is set without BASELINE_URL — set both to use a server, or neither');
    if (!token) throw new TargetError(`BASELINE_URL is set (${url}) without BASELINE_TOKEN — set both to use a server, or neither`);
    return { kind: 'remote', url: serverUrl(url), token, source: 'env' };
  }
  if (config.kind === 'invalid') throw new TargetError(`~/.baseline/config.json can't be used: ${config.reason} — run \`baseline login --server <url>\` again, or \`baseline logout\``);
  if (config.kind === 'ok') return { kind: 'remote', url: serverUrl(config.config.server), token: config.config.token, source: 'config' };
  return { kind: 'local', dbPath: resolve(defaultDbPath), source: 'default' };
}

/** a server address as an origin; https unless the host is this machine */
export function serverUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new TargetError(`Not a server URL: ${raw}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new TargetError(`Not a server URL: ${raw}`);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'http:' && !loopback) throw new TargetError(`${raw} isn't https — a key sent over plain http can be read on the way`);
  return new URL(u.origin);
}

const SOURCE: Record<Target['source'], string> = { flag: '--db', env: 'environment', config: '~/.baseline/config.json', default: 'default' };

/** "remote https://baseline.example.com (from ~/.baseline/config.json)" */
export function describeTarget(t: Target): string {
  return t.kind === 'local' ? `local ${t.dbPath} (from ${SOURCE[t.source]})` : `remote ${t.url.origin} (from ${SOURCE[t.source]})`;
}
