import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { PASSWORD_MIN } from './types.js';

export const PASSWORD_MAX = 200;

const LOG_N = 15, R = 8, P = 1, KEY_LEN = 64;

const scrypt = (password: string, salt: Buffer, opts: ScryptOptions) => new Promise<Buffer>((ok, bad) =>
  // maxmem: scrypt needs 128·N·r bytes; Node's 32 MiB default is exactly too small for N=2^15, r=8
  scryptCb(password.normalize('NFC'), salt, KEY_LEN, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) => err ? bad(err) : ok(key)));

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N: 2 ** LOG_N, r: R, p: P });
  return ['scrypt', LOG_N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

let decoy: Promise<string> | null = null;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (typeof password !== 'string' || password.length > PASSWORD_MAX) return false;
  const target = stored ?? await (decoy ??= hashPassword(randomBytes(16).toString('hex')));
  const [scheme, logN, r, p, salt, hash] = target.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), { N: 2 ** Number(logN), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected) && stored !== null;
}
