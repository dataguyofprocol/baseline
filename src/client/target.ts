import { resolve } from 'node:path';

export type Target =
  | { kind: 'local'; dbPath: string; source: 'flag' | 'env' | 'default' }
  | { kind: 'remote'; url: URL; token: string; source: 'env' | 'config' };

export interface CliConfig {
  version: 1;
  server: string;
  token: string;
  keyId: string;
  user: { id: string; name: string; email: string };
}

export type ConfigRead = { kind: 'absent' } | { kind: 'ok'; config: CliConfig } | { kind: 'invalid'; reason: string };

export class TargetError extends Error {}

export interface TargetEnv { BASELINE_DB?: string; BASELINE_URL?: string; BASELINE_TOKEN?: string }

export function resolveTarget(flags: { db?: string }, env: TargetEnv, config: ConfigRead, defaultDbPath: string): Target {
  const set = (v: string | undefined) => v?.trim() || undefined;
  const db = set(env.BASELINE_DB), url = set(env.BASELINE_URL), token = set(env.BASELINE_TOKEN);
  if (set(flags.db)) return { kind: 'local', dbPath: resolve(flags.db!), source: 'flag' };
  if (db && url) throw new TargetError('Both BASELINE_DB and BASELINE_URL are set. Unset one, or pass --db <path> for a local database.');
  if (db) return { kind: 'local', dbPath: resolve(db), source: 'env' };
  if (url || token) {
    if (!url) throw new TargetError('BASELINE_TOKEN is set without BASELINE_URL. Set both to use a server, or neither.');
    if (!token) throw new TargetError(`BASELINE_URL is set (${url}) without BASELINE_TOKEN. Set both to use a server, or neither.`);
    return { kind: 'remote', url: serverUrl(url), token, source: 'env' };
  }
  if (config.kind === 'invalid') throw new TargetError(`~/.baseline/config.json can't be used: ${config.reason}. Run \`baseline login --server <url>\` again, or \`baseline logout\`.`);
  if (config.kind === 'ok') return { kind: 'remote', url: serverUrl(config.config.server), token: config.config.token, source: 'config' };
  return { kind: 'local', dbPath: resolve(defaultDbPath), source: 'default' };
}

export function serverUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new TargetError(`Not a server URL: ${raw}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new TargetError(`Not a server URL: ${raw}`);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'http:' && !loopback) throw new TargetError(`${raw} isn't https. A key sent over plain http can be read on the way.`);
  return new URL(u.origin);
}

const SOURCE: Record<Target['source'], string> = { flag: '--db', env: 'environment', config: '~/.baseline/config.json', default: 'default' };

export function describeTarget(t: Target): string {
  return t.kind === 'local' ? `local ${t.dbPath} (from ${SOURCE[t.source]})` : `remote ${t.url.origin} (from ${SOURCE[t.source]})`;
}
