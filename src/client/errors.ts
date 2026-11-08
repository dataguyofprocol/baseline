export type BaselineErrorCode =
  | 'not-found' | 'forbidden' | 'unauthorized' | 'unauthenticated' | 'invalid' | 'companion-required'
  | 'unreachable' | 'server' | 'not-yet-remote';

/** A failure the server (or the way to it) reported, parsed from its `{ error, code }` body.
 *  The CLI prints `error: <message>` and exits 1; an MCP tool returns it as a tool error. */
export class BaselineError extends Error {
  constructor(readonly status: number, readonly code: BaselineErrorCode, message: string) { super(message); }

  static fromResponse(status: number, body: unknown): BaselineError {
    const b = (body ?? {}) as { error?: unknown; code?: unknown };
    const message = typeof b.error === 'string' && b.error ? b.error : `HTTP ${status}`;
    const code = typeof b.code === 'string' ? b.code as BaselineErrorCode
      : status === 404 ? 'not-found' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status < 500 ? 'invalid' : 'server';
    return new BaselineError(status, code, message);
  }
}
