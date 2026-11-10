import type { Context } from 'hono';
import type { IncomingMessage } from 'node:http';

export interface Limiter {
  take(key: string, cost?: number): boolean;
}

export function limiter(limit: number, windowMs: number): Limiter {
  const windows = new Map<string, { used: number; resetAt: number }>();
  return {
    take(key, cost = 1) {
      const now = Date.now();
      if (windows.size > 10_000) for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      let w = windows.get(key);
      if (!w || w.resetAt <= now) { w = { used: 0, resetAt: now + windowMs }; windows.set(key, w); }
      if (w.used + cost > limit) return false;
      w.used += cost;
      return true;
    },
  };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The client's address. Behind the reverse proxy on the same machine (Caddy), the connection comes
 *  from loopback and the proxy's X-Forwarded-For names the client; a direct connection's own
 *  address is used as is, so a client can't pick its own rate-limit bucket. */
export function clientIp(c: Context): string {
  const remote = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket?.remoteAddress;
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (!remote || LOOPBACK.has(remote)) return forwarded || remote || 'unknown';
  return remote;
}
