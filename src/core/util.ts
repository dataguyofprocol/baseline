import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function id(prefix = ''): string {
  const bytes = randomBytes(12);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 62];
  return prefix ? `${prefix}_${out}` : out;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Midpoint between two floats with a fallback spread for unbounded ends. */
export function midSort(prev: number | null, next: number | null): number {
  const a = prev ?? (next !== null ? next - 2048 : 0);
  const b = next ?? a + 2048;
  return (a + b) / 2;
}

/** '' stays '' (unset); `~/x` expands; anything else resolves to an absolute path, so the
 *  existence checks and the launcher's `cd` see the same directory */
export function normalizeDir(dir: string | null | undefined): string {
  const d = String(dir ?? '').trim();
  if (!d) return '';
  const expanded = d === '~' ? homedir() : d.startsWith('~/') ? homedir() + d.slice(1) : d;
  return resolvePath(expanded).replace(/(.)\/+$/, '$1');
}
