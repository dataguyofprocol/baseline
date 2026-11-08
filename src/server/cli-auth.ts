// `baseline login`: a signed-in person approves the CLI in their browser, and the CLI receives a
// personal API key. Loopback redirect with PKCE (RFC 8252); the key itself never travels in a URL.
//
//   CLI: listens on 127.0.0.1:<port>, opens /cli/authorize?port&state&challenge&device
//   browser (signed in): [Allow] → POST /api/cli-auth/approve → a one-use code, 2 minutes
//          → redirected to http://127.0.0.1:<port>/cb?code&state
//   CLI: POST /auth/cli/token { code, verifier } → { token, keyId, user, workspace }
import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Hono } from 'hono';
import type { ApiKeys } from '../core/apikeys.js';
import type { Accounts } from '../core/accounts.js';
import type { Store } from '../core/store.js';
import { principalUser } from './principal.js';
import { clientIp, limiter } from './ratelimit.js';

const GRANT_MS = 2 * 60_000;
const b64url = (buf: Buffer) => buf.toString('base64url');
const sha256 = (s: string) => b64url(createHash('sha256').update(s).digest());

/** what /cli/authorize and the approve call carry; checked before anything is stored */
export function parseCliRequest(q: Record<string, unknown>): { port: number; state: string; challenge: string; device: string } | null {
  const port = Number(q.port);
  const { state, challenge, device } = q;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  if (typeof state !== 'string' || !/^[\w-]{16,128}$/.test(state)) return null;
  if (typeof challenge !== 'string' || !/^[\w-]{43}$/.test(challenge)) return null;
  if (typeof device !== 'string' || !device.trim() || device.length > 100) return null;
  return { port, state, challenge, device: device.trim() };
}

export function mountCliAuth(app: Hono, d: { db: DatabaseSync; store: Store; accounts: Accounts; apiKeys: ApiKeys }): void {
  const tokenLimit = limiter(30, 10 * 60_000);

  // the page the CLI opens; it asks /api/me who is signed in, so it needs no server-side session code
  app.get('/cli/authorize', (c) => {
    if (!parseCliRequest(c.req.query())) return c.text('This sign-in link is incomplete — run `baseline login` again.', 400);
    return c.html(AUTHORIZE_PAGE, 200, { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'" });
  });

  // behind authenticate like every /api route: a signed-in person (or this machine), never a key
  app.post('/api/cli-auth/approve', async (c) => {
    const r = parseCliRequest(await c.req.json().catch(() => ({})));
    if (!r) return c.json({ error: 'This sign-in link is incomplete — run `baseline login` again', code: 'invalid' }, 400);
    const userId = principalUser(c, d.store);
    if (d.store.getFeatures().apiKeyCreation === 'admins' && !d.accounts.isAdmin(userId)) {
      return c.json({ error: 'Only admins can create API keys in this workspace, and the CLI signs in with one', code: 'forbidden' }, 403);
    }
    const code = b64url(randomBytes(32));
    d.db.prepare('INSERT INTO cli_grants (code_hash, user_id, challenge, device, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(code), userId, r.challenge, r.device, new Date(Date.now() + GRANT_MS).toISOString());
    d.db.prepare('DELETE FROM cli_grants WHERE expires_at < ?').run(new Date(Date.now() - GRANT_MS).toISOString());
    const redirect = new URL(`http://127.0.0.1:${r.port}/cb`);
    redirect.search = new URLSearchParams({ code, state: r.state }).toString();
    return c.json({ redirect: redirect.toString() });
  });

  // outside /api: the code and the PKCE verifier are the credential
  app.post('/auth/cli/token', async (c) => {
    if (!tokenLimit.take(clientIp(c))) return c.json({ error: 'Too many sign-in attempts — try again in a few minutes', code: 'rate-limited' }, 429);
    const b = await c.req.json().catch(() => ({})) as { code?: unknown; verifier?: unknown };
    const refused = () => c.json({ error: 'This sign-in expired or was already used — run `baseline login` again', code: 'invalid' }, 400);
    if (typeof b.code !== 'string' || typeof b.verifier !== 'string') return refused();
    const grant = d.db.prepare('SELECT * FROM cli_grants WHERE code_hash = ?').get(sha256(b.code)) as
      { code_hash: string; user_id: string; challenge: string; device: string; expires_at: string; used_at: string | null } | undefined;
    if (!grant || grant.used_at || Date.parse(grant.expires_at) <= Date.now() || sha256(b.verifier) !== grant.challenge) return refused();
    // one use, even when two requests race for it
    if (Number(d.db.prepare('UPDATE cli_grants SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').run(new Date().toISOString(), grant.code_hash).changes) !== 1) return refused();
    const user = d.store.snapshot().users.find(u => u.id === grant.user_id && u.status !== 'suspended');
    if (!user) return refused();
    // read and write, never admin: an agent driving the CLI can't change how the workspace is set up
    const { key, token } = d.apiKeys.create({ name: `CLI on ${grant.device}`, userId: user.id, scopes: ['read', 'write'] });
    const ws = d.store.workspaceMeta();
    return c.json({ token, keyId: key.id, user: { id: user.id, name: user.name, email: user.email }, workspace: { id: ws.id, name: ws.name } });
  });
}

const AUTHORIZE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Baseline CLI sign-in</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; background: #0f1011; color: #e6e6e6; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { max-width: 420px; padding: 32px; border: 1px solid #2a2b2e; border-radius: 12px; background: #16171a; }
  h1 { font-size: 18px; margin: 0 0 12px; } p { color: #a0a0a8; margin: 0 0 20px; } b { color: #e6e6e6; }
  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #2a2b2e; background: #1f2023; color: #e6e6e6; cursor: pointer; margin-right: 8px; }
  button.primary { background: #5e6ad2; border-color: #5e6ad2; color: #fff; }
</style></head>
<body><main>
  <h1>Sign in the Baseline CLI</h1>
  <p id="msg">Checking who you are…</p>
  <div id="actions" hidden><button class="primary" id="allow">Allow</button><button id="deny">Cancel</button></div>
</main>
<script>
  const q = Object.fromEntries(new URLSearchParams(location.search));
  const msg = document.getElementById('msg'), actions = document.getElementById('actions');
  const say = (parts) => { msg.textContent = ''; for (const [text, bold] of parts) { const el = bold ? document.createElement('b') : document.createTextNode(text); if (bold) el.textContent = text; msg.append(el); } };
  fetch('/api/me', { credentials: 'same-origin' }).then(async (r) => {
    // signed out: the app's sign-in screen (password or Google) brings the browser back here
    if (r.status === 401) { location.href = '/?next=' + encodeURIComponent(location.pathname + location.search); return; }
    if (!r.ok) { say([['Couldn\\'t check who you are — reload to try again.']]); return; }
    const me = await r.json();
    say([['Allow the Baseline CLI on '], [q.device, true], [' to read and change issues in '], [me.workspace.name, true], [' as '], [me.user.name, true], [' (' + me.user.email + ')? It gets a personal API key, which you can revoke in Settings › Security & access.']]);
    actions.hidden = false;
  });
  document.getElementById('allow').onclick = async () => {
    actions.hidden = true; say([['Approving…']]);
    const r = await fetch('/api/cli-auth/approve', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { say([[body.error || 'Approval failed.']]); return; }
    location.href = body.redirect;
  };
  document.getElementById('deny').onclick = () => {
    location.href = 'http://127.0.0.1:' + Number(q.port) + '/cb?error=denied&state=' + encodeURIComponent(q.state);
  };
</script></body></html>`;
