// First run of a hosted server: the owner account is created in the browser by whoever holds the
// setup token. The token is printed to the server log at startup and kept in a file beside the
// database (`<db>.setup-token`, mode 0600) so `baseline setup-token` can show it again. A fresh
// public server can't be claimed by the first stranger who finds it. The token is removed once setup is done.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export const setupTokenPath = (dbPath: string) => `${dbPath}.setup-token`;

// Crockford base32: no I, L, O or U, so a token read off a log can be typed back without guessing
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHAPE = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/;

/** "K7Q2M-…", 20 characters, 100 bits */
function newToken(): string {
  const bytes = randomBytes(20);
  const chars = [...bytes].map(b => ALPHABET[b & 31]!).join('');
  return chars.match(/.{5}/g)!.join('-');
}

/** what someone typed: case, spaces and dashes don't matter */
const canonical = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');
const digest = (s: string) => createHash('sha256').update(canonical(s)).digest();

/** the token on disk, if there is one (the CLI reads it this way) */
export function readSetupToken(dbPath: string): string | null {
  try {
    const t = readFileSync(setupTokenPath(dbPath), 'utf8').trim();
    return SHAPE.test(t) ? t : null;
  } catch { return null; }
}

export interface SetupToken {
  /** the token to print, creating it if needed (the same one across restarts until setup is done) */
  ensure(): string;
  matches(given: unknown): boolean;
  /** setup is done: the token stops working */
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
