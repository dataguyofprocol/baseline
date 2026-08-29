import { randomBytes } from 'node:crypto';

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
