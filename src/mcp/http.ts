// The hosted MCP endpoint: the same tools as `baseline mcp`, over Streamable HTTP at /mcp on the
// Baseline server. `authenticate` has already verified the bearer key (principal.ts refuses /mcp
// without one). Each tool call is then made as an /api request with that same key, through this
// app's own fetch, so the key's scopes, its teams and the publish refusal apply exactly as they do
// for the CLI: this file adds no authorization of its own beyond binding a session to its key.
import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { connectTo } from '../client/index.js';
import { principalOf } from '../server/principal.js';
import { createMcpServer } from './server.js';

export const MCP_PATH = '/mcp';
/** sent on initialize to write as a different agent user than the workspace's Agent, like BASELINE_AS for `baseline mcp` */
export const AS_HEADER = 'baseline-as';

interface Session { keyId: string; transport: WebStandardStreamableHTTPServerTransport; server: Server; seen: number }

const IDLE_MS = 6 * 3_600_000;
const rpcError = (c: Context, status: 400 | 404, code: number, message: string, id: unknown = null) =>
  c.json({ jsonrpc: '2.0', error: { code, message }, id }, status);
const requests = (body: unknown): Array<{ method?: string; id?: unknown }> =>
  (Array.isArray(body) ? body : [body]).filter((m): m is { method?: string; id?: unknown } => typeof m === 'object' && m !== null);

export function mountMcpHttp(app: Hono): void {
  const sessions = new Map<string, Session>();
  // a client that goes away without DELETE leaves its session behind; drop it after a quiet while
  setInterval(() => {
    const cutoff = Date.now() - IDLE_MS;
    for (const [id, s] of sessions) if (s.seen < cutoff) { sessions.delete(id); void s.transport.close(); }
  }, 600_000).unref();

  app.on(['POST', 'GET', 'DELETE'], MCP_PATH, async (c) => {
    const p = principalOf(c);
    if (p.via !== 'key') throw new Error('authenticate lets only a key through to /mcp');
    const body = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
    const sessionId = c.req.header('mcp-session-id');

    if (sessionId) {
      const s = sessions.get(sessionId);
      // another key's session is answered like an unknown one: a session id is not a credential
      if (!s || s.keyId !== p.key.id) return rpcError(c, 404, -32001, 'Session not found: initialize a new session');
      s.seen = Date.now();
      return s.transport.handleRequest(c.req.raw, { parsedBody: body });
    }

    const msgs = requests(body);
    // Clients on the 2026-07-28 protocol probe with server/discover before initialize; this SDK
    // answers only initialize, so say "method not found" and the client falls back to it.
    const discover = msgs.find(m => m.method === 'server/discover');
    if (discover) return rpcError(c, 404, -32601, 'Method not found: server/discover', discover.id ?? null);
    if (c.req.method !== 'POST' || !msgs.some(m => m.method === 'initialize')) {
      return rpcError(c, 400, -32000, 'Bad Request: send initialize first, without an Mcp-Session-Id header');
    }

    const origin = new URL(new URL(c.req.url).origin);
    const token = c.req.header('authorization')!.replace(/^Bearer\s+/i, '').trim();
    const server = createMcpServer({
      connect: async () => connectTo(origin, token, req => Promise.resolve(app.fetch(req))),
      as: c.req.header(AS_HEADER),
      session: undefined,
    });
    const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: id => { sessions.set(id, { keyId: p.key.id, transport, server, seen: Date.now() }); },
      onsessionclosed: id => { sessions.delete(id); },
    });
    await server.connect(transport);
    const res = await transport.handleRequest(c.req.raw, { parsedBody: body });
    const client = server.getClientVersion();
    if (transport.sessionId) console.error(`[baseline] MCP session for ${client?.name ?? '(unnamed client)'} ${client?.version ?? ''} with key "${p.key.name}"`);
    return res;
  });
}
