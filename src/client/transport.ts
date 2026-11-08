// The only thing that differs between a local database and a server. Everything above it is one code path.
import { BaselineError } from './errors.js';
import type { Target } from './target.js';

export interface WireRequest { json?: unknown; query?: Record<string, string | undefined> }
export interface WireResponse { status: number; body: unknown }

/** one request to the Baseline REST API; paths are absolute API paths ("/api/issues/x") */
export interface Transport { request(method: string, path: string, opts?: WireRequest): Promise<WireResponse> }

const withQuery = (path: string, query?: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(query ?? {}).filter((e): e is [string, string] => e[1] !== undefined));
  return q.size ? `${path}?${q}` : path;
};

const init = (method: string, opts?: WireRequest, headers: Record<string, string> = {}): RequestInit => opts?.json === undefined
  ? { method, headers }
  : { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(opts.json) };

async function parse(res: Response, where: string): Promise<WireResponse> {
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new BaselineError(res.status, 'server', `${where} answered with something other than Baseline's API (HTTP ${res.status}) — check the server address, and that it runs a Baseline as new as this CLI`);
  }
  return { status: res.status, body: await res.json() };
}

/**
 * The same app `baseline serve` runs, built in this process and called with app.request(): every
 * request passes the same /api middleware a server request does (authenticate, adminOnly, localOnly).
 * Local mode always (a shell with GOOGLE_CLIENT_ID set must not turn the CLI into a hosted app), and
 * no mail (a CLI write must not send email from the laptop). The server module is imported here,
 * lazily, so a remote invocation never opens SQLite.
 */
export async function localTransport(dbPath: string): Promise<Transport> {
  const { createApp } = await import('../server/index.js');
  const { app } = createApp(dbPath, { mode: 'local' }, { configured: false, send: async () => {} });
  return {
    async request(method, path, opts) {
      return parse(await app.request(`http://localhost${withQuery(path, opts?.query)}`, init(method, opts)), dbPath);
    },
  };
}

/** fetch with the key as a bearer token. Never retries: a retried write could create an issue twice. */
export function httpTransport(url: URL, token: string): Transport {
  return {
    async request(method, path, opts) {
      let res: Response;
      try {
        res = await fetch(new URL(withQuery(path, opts?.query), url), init(method, opts, { authorization: `Bearer ${token}` }));
      } catch (e) {
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        throw new BaselineError(0, 'unreachable', `Can't reach ${url.origin} (${cause?.code ?? cause?.message ?? (e as Error).message})`);
      }
      return parse(res, url.origin);
    },
  };
}

export function transportFor(t: Target): Promise<Transport> {
  return t.kind === 'local' ? localTransport(t.dbPath) : Promise.resolve(httpTransport(t.url, t.token));
}
