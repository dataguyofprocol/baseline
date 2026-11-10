import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export const setupTokenPath = (dbPath: string) => `${dbPath}.setup-token`;

// Crockford base32: no I, L, O or U, so a token read off a log can be typed back without guessing
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHAPE = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/;

function newToken(): string {
  const bytes = randomBytes(20);
  const chars = [...bytes].map(b => ALPHABET[b & 31]!).join('');
  return chars.match(/.{5}/g)!.join('-');
}

const canonical = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');
const digest = (s: string) => createHash('sha256').update(canonical(s)).digest();

export function readSetupToken(dbPath: string): string | null {
  try {
    const t = readFileSync(setupTokenPath(dbPath), 'utf8').trim();
    return SHAPE.test(t) ? t : null;
  } catch { return null; }
}

export interface SetupToken {
  ensure(): string;
  matches(given: unknown): boolean;
  clear(): void;
}

export function setupToken(dbPath: string): SetupToken {
  const path = setupTokenPath(dbPath);
  return {
    ensure() {
      const existing = readSetupToken(dbPath);
      if (existing) return existing;
      const token = newToken();
      writeFileSync(path, `${token}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
      return token;
    },
    matches(given) {
      const token = readSetupToken(dbPath);
      if (!token || typeof given !== 'string' || !given.trim()) return false;
      return timingSafeEqual(digest(given), digest(token));
    },
    clear() { if (existsSync(path)) rmSync(path, { force: true }); },
  };
}
