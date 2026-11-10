import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CliConfig, ConfigRead } from './target.js';

export const CONFIG_PATH = join(homedir(), '.baseline', 'config.json');

export function readConfig(path = CONFIG_PATH): ConfigRead {
  let text: string;
  try {
    if (statSync(path).mode & 0o077) return { kind: 'invalid', reason: `other users can read it (chmod 600 ${path})` };
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'invalid', reason: (e as Error).message };
  }
  let c: Partial<CliConfig>;
  try { c = JSON.parse(text); } catch { return { kind: 'invalid', reason: 'it isn\'t valid JSON' }; }
  const ok = c && c.version === 1 && typeof c.server === 'string' && typeof c.token === 'string' && typeof c.keyId === 'string'
    && !!c.user && typeof c.user.id === 'string' && typeof c.user.name === 'string';
  return ok ? { kind: 'ok', config: c as CliConfig } : { kind: 'invalid', reason: 'it is missing fields' };
}

export function writeConfig(config: CliConfig, path = CONFIG_PATH): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function removeConfig(path = CONFIG_PATH): void {
  rmSync(path, { force: true });
}
