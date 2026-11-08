#!/usr/bin/env node
// drive.mjs — drive a vb-started Baseline instance in headless Chrome over CDP (no npm deps).
//
//   drive.mjs <run> harness <section>[,<section>…] [--name <label>]
//       load scripts/journey-harness.js into the page and run the named sections
//       (shell, create, triage, issue, lists, projects, cycles, inbox, settings, more, parity, bell, routes)
//   drive.mjs <run> eval <hash-route> <js-file|-> [--name <label>]
//       open #<hash-route>, load the harness (window.__t helpers), run the JS (async body; `return` a value)
//   drive.mjs <run> shot <hash-route> [--name <label>]
//       open #<hash-route> and screenshot it
//
// Every mode writes to the run's evidence dir: <label>.png (final screen), <label>.json
// (results / return value, console errors, page errors, final URL). Exit 0 only if every
// harness row passed (harness), the script did not throw (eval), or the page loaded (shot).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const [run, mode, a1, a2] = process.argv.slice(2);
const flag = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
if (!run || !mode) { console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n')); process.exit(2); }

const home = process.env.VB_HOME ?? join(homedir(), '.cache/baseline-verify');
const envFile = join(home, run, 'instance/env');
if (!existsSync(envFile)) { console.error(`drive: run ${run} has no live instance (vb start / vb list)`); process.exit(1); }
const env = Object.fromEntries(readFileSync(envFile, 'utf8').trim().split('\n').map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^'|'$/g, '')]; }));
const evid = join(home, run, 'evidence');
const label = flag('--name') ?? `${mode}-${(a1 ?? 'page').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'root'}-${Date.now()}`;

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'vb-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chromeExited = new Promise(r => chrome.once('exit', r));
// kill our Chrome, wait for it to exit (it holds the profile), then delete the profile
const shutdown = async () => {
  try { chrome.kill('SIGTERM'); } catch {}
  if (!(await Promise.race([chromeExited.then(() => true), sleep(3000).then(() => false)]))) { try { chrome.kill('SIGKILL'); } catch {} await Promise.race([chromeExited, sleep(2000)]); }
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} });

const wsUrl = await new Promise((res, rej) => {
  let buf = ''; const to = setTimeout(() => rej(new Error('chrome did not start')), 15000);
  chrome.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(to); res(m[1]); } });
  chrome.on('exit', c => rej(new Error('chrome exited ' + c)));
});
const port = new URL(wsUrl).port;
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const consoleErrors = []; const pageErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  else if (m.method === 'Runtime.exceptionThrown') pageErrors.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, timeout = 600000) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const open = async (route = '/') => {
  await send('Page.navigate', { url: `${env.URL}/#${route.startsWith('/') ? route : '/' + route}` });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('.sidebar')`).catch(() => false)) return; }
  throw new Error('app shell (.sidebar) never rendered');
};
const loadHarness = () => evaluate(`new Promise((ok, no) => { if (window.__t) return ok(true); const s = document.createElement('script'); s.src = ${JSON.stringify(env.HURL)} + '?' + Date.now(); s.onload = () => ok(true); s.onerror = () => no(new Error('harness script failed to load')); document.head.appendChild(s); })`);
const shot = async () => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(evid, `${label}.png`), Buffer.from(data, 'base64')); };

let out = { run, mode, label, url: env.URL }; let ok = false;
try {
  if (mode === 'harness') {
    const sections = (a1 ?? '').split(',').filter(Boolean); if (!sections.length) throw new Error('name at least one harness section');
    await open('/inbox'); await loadHarness();
    const lines = await evaluate(`__runAll(${JSON.stringify(sections)})`);
    out.sections = sections; out.results = lines; ok = lines.length > 0 && lines.every(l => l.startsWith('PASS'));
    lines.forEach(l => console.log(l));
  } else if (mode === 'eval') {
    const src = a2 === '-' || !a2 ? readFileSync(0, 'utf8') : readFileSync(a2, 'utf8');
    await open(a1 ?? '/'); await loadHarness();
    out.value = await evaluate(`(async () => { const t = window.__t; ${src}\n})()`); ok = true;
    console.log(JSON.stringify(out.value, null, 2));
  } else if (mode === 'shot') {
    await open(a1 ?? '/'); ok = true;
  } else throw new Error('unknown mode ' + mode);
} catch (e) { out.error = e.message; console.error('drive: ' + e.message); }
try { await sleep(300); await shot(); out.screenshot = join(evid, `${label}.png`); } catch (e) { out.screenshotError = e.message; }
out.finalUrl = await evaluate('location.href').catch(() => null);
out.consoleErrors = consoleErrors; out.pageErrors = pageErrors; out.ok = ok;
writeFileSync(join(evid, `${label}.json`), JSON.stringify(out, null, 2));
console.log(`evidence: ${join(evid, label)}.{png,json}  ok=${ok}`);
ws.close(); await shutdown(); process.exit(ok ? 0 : 1);
