// login, logout, whoami: the CLI's side of the flow in src/server/cli-auth.ts.
import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import {
  BaselineError, CONFIG_PATH, connect, connectTo, describeTarget, readConfig, removeConfig, serverUrl, TargetError, writeConfig,
  type CliConfig,
} from '../client/index.js';

const b64url = (buf: Buffer) => buf.toString('base64url');
const LOGIN_TIMEOUT_MS = 5 * 60_000;

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

/** waits on 127.0.0.1 for the browser to come back with ?code&state */
async function browserCode(server: URL, device: string, opts: { browser: boolean }): Promise<{ code: string; verifier: string }> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(24));
  const http = createServer();
  await new Promise<void>((ok, bad) => http.once('error', bad).listen(0, '127.0.0.1', ok));
  const port = (http.address() as { port: number }).port;
  const authorize = new URL('/cli/authorize', server);
  authorize.search = new URLSearchParams({ port: String(port), state, challenge, device }).toString();
  console.error(`To sign in, open this page and choose Allow:\n\n  ${authorize}\n`);
  if (opts.browser) openBrowser(authorize.toString());
  try {
    return await new Promise((ok, bad) => {
      const timer = setTimeout(() => bad(new TargetError('Timed out waiting for the browser. Run `baseline login` again.')), LOGIN_TIMEOUT_MS);
      http.on('request', (req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (u.pathname !== '/cb' || u.searchParams.get('state') !== state) { res.writeHead(404).end(); return; }
        const code = u.searchParams.get('code');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(`<!doctype html><meta charset="utf-8"><title>Baseline CLI</title><body style="font:15px system-ui;padding:40px">${code ? 'The Baseline CLI is signed in. You can close this tab.' : 'Sign-in cancelled. You can close this tab.'}</body>`);
        clearTimeout(timer);
        if (code) ok({ code, verifier }); else bad(new TargetError('Sign-in was cancelled in the browser'));
      });
    });
  } finally {
    http.close();
  }
}

async function exchange(server: URL, code: string, verifier: string): Promise<CliConfig & { workspace: { name: string } }> {
  let res: Response;
  try {
    res = await fetch(new URL('/auth/cli/token', server), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, verifier }) });
  } catch (e) {
    throw new BaselineError(0, 'unreachable', `Can't reach ${server.origin} (${(e as Error).message})`);
  }
  const body = await res.json().catch(() => ({})) as { token?: string; keyId?: string; user?: CliConfig['user']; workspace?: { name: string }; error?: string; code?: string };
  if (!res.ok || !body.token || !body.keyId || !body.user) throw BaselineError.fromResponse(res.status, body);
  return { version: 1, server: server.origin, token: body.token, keyId: body.keyId, user: body.user, workspace: body.workspace ?? { name: '' } };
}

/** after a new login: the previous key for the same server is revoked, so logging in twice leaves one key */
async function retire(previous: CliConfig, now: CliConfig): Promise<void> {
  if (previous.server !== now.server || previous.keyId === now.keyId) return;
  await connectTo(new URL(previous.server), previous.token).revokeOwnKey()
    .catch((e: Error) => console.error(`note: couldn't revoke the previous CLI key (${e.message}). Revoke it in Settings › Security & access.`));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}


export function mountAccountCommands(program: Command): void {
  program.command('login').description('Sign in to a Baseline server: approve in the browser, the key is kept in ~/.baseline/config.json')
    .requiredOption('--server <url>', 'the server, e.g. https://baseline.example.com')
    .option('--no-browser', 'print the sign-in link instead of opening a browser')
    .option('--token-stdin', 'read an API key from stdin instead (SSH sessions, CI)')
    .action(async (opts: { server: string; browser: boolean; tokenStdin?: boolean }) => {
      const server = serverUrl(opts.server);
      const before = readConfig();
      let config: CliConfig, workspace: string;
      if (opts.tokenStdin) {
        const token = await readStdin();
        const me = await connectTo(server, token).me();
        if (!me.keyId) throw new TargetError('That isn\'t an API key');
        config = { version: 1, server: server.origin, token, keyId: me.keyId, user: { id: me.user.id, name: me.user.name, email: me.user.email } };
        workspace = me.workspace.name;
      } else {
        const { code, verifier } = await browserCode(server, hostname(), opts);
        const got = await exchange(server, code, verifier);
        workspace = got.workspace.name;
        config = { version: 1, server: got.server, token: got.token, keyId: got.keyId, user: got.user };
      }
      writeConfig(config);
      if (before.kind === 'ok') await retire(before.config, config);
      console.log(`Logged in as ${config.user.name} <${config.user.email}> on ${workspace} → ${CONFIG_PATH}`);
      process.exit(0);
    });

  program.command('logout').description('Revoke this CLI\'s key on the server and forget it')
    .action(async () => {
      const c = readConfig();
      if (c.kind === 'absent') { console.log('Not logged in'); process.exit(0); }
      if (c.kind === 'ok') {
        await connectTo(new URL(c.config.server), c.config.token).revokeOwnKey()
          .catch((e: Error) => console.error(`note: couldn't revoke the key on ${c.config.server} (${e.message}). It stays valid until revoked in Settings › Security & access.`));
      }
      removeConfig();
      console.log(c.kind === 'ok' ? `Logged out of ${c.config.server}` : `Removed ${CONFIG_PATH}`);
      process.exit(0);
    });

  program.command('whoami').description('Who this CLI acts as, and where its commands go')
    .option('--db <path>', 'database path')
    .action(async (opts: { db?: string }) => {
      const bl = await connect(opts);
      const me = await bl.me();
      console.log(`${me.user.name} <${me.user.email}> on ${me.workspace.name}`);
      console.log(describeTarget(bl.target));
      if (me.scopes || me.teamIds) console.log(`key limits: ${me.scopes?.join(', ') ?? 'all permissions'}${me.teamIds ? ` · teams ${me.teamIds.length}` : ''}`);
      process.exit(0);
    });
}
