import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Target } from '../client/index.js';
import { tildePath } from './model.js';

export function agentCommand(prompt: string, env = process.env): string[] {
  const words = (env.BASELINE_AGENT?.trim() || 'claude').split(/\s+/);
  return [...words, prompt];
}

export function agentCwd(locationPath: string | undefined, cwd = process.cwd()): { cwd: string; note: string | null } {
  if (!locationPath) return { cwd, note: null };
  try {
    if (statSync(locationPath).isDirectory()) return { cwd: locationPath, note: null };
  } catch {}
  return { cwd, note: `Location ${tildePath(locationPath)} isn't on this disk; running in the current directory.` };
}

export function shellPreview(cmd: readonly string[], width: number): string {
  const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const shown = cmd.map((a, i) => (i === cmd.length - 1 && a.includes('\n') ? `${a.split('\n')[0]}…` : a));
  const line = shown.map(quote).join(' ');
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
}

/** Every key is set (an empty value reads as unset) because a tmux split starts from the tmux
 *  server's environment, not this process's, so nothing can be left to inheritance. */
export function targetEnv(target: Target): Record<'BASELINE_DB' | 'BASELINE_URL' | 'BASELINE_TOKEN', string> {
  if (target.kind === 'local') return { BASELINE_DB: target.dbPath, BASELINE_URL: '', BASELINE_TOKEN: '' };
  if (target.source === 'env') return { BASELINE_DB: '', BASELINE_URL: target.url.origin, BASELINE_TOKEN: target.token };
  return { BASELINE_DB: '', BASELINE_URL: '', BASELINE_TOKEN: '' };
}

export function agentEnv(target: Target, issueKey: string, env = process.env): NodeJS.ProcessEnv {
  return { ...env, BASELINE_ISSUE: issueKey, ...targetEnv(target) };
}

export interface RunResult { ok: boolean; message: string }

export function runInTerminal(cmd: readonly string[], opts: { cwd: string; env: NodeJS.ProcessEnv; banner: string }): RunResult {
  process.stdout.write(`\x1b[2J\x1b[H\x1b[2m${opts.banner}\x1b[0m\n\n`);
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: opts.cwd, env: opts.env, stdio: 'inherit' });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    return { ok: false, message: code === 'ENOENT' ? `${cmd[0]} isn't installed or isn't on PATH. Set BASELINE_AGENT to your agent command.` : `Couldn't run ${cmd[0]}: ${r.error.message}` };
  }
  return { ok: r.status === 0, message: r.signal ? `${cmd[0]} stopped (${r.signal})` : `${cmd[0]} exited${r.status ? ` with code ${r.status}` : ''}` };
}

export function paneCommand(cmd: readonly string[], opts: { cwd: string; target: Target; issueKey: string }): string[] {
  const vars = { BASELINE_ISSUE: opts.issueKey, ...targetEnv(opts.target) };
  const env = Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return ['tmux', 'split-window', '-h', '-P', '-F', '#{pane_id}', '-c', opts.cwd, ...env, ...cmd];
}

export function runInPane(cmd: readonly string[], opts: { cwd: string; target: Target; issueKey: string }): RunResult & { paneId?: string } {
  const argv = paneCommand(cmd, opts);
  const r = spawnSync(argv[0]!, argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.error) return { ok: false, message: `Couldn't run tmux: ${r.error.message}` };
  const paneId = (r.stdout || '').trim();
  return r.status === 0 ? { ok: true, message: 'started', ...(/^%\d+$/.test(paneId) ? { paneId } : {}) } : { ok: false, message: `tmux split-window failed: ${(r.stderr || '').trim() || `exit ${r.status}`}` };
}

export function paneAlive(paneId: string): boolean {
  const r = spawnSync('tmux', ['display-message', '-p', '-t', paneId, '#{pane_id}'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === paneId;
}

export function focusPane(paneId: string): boolean {
  if (!paneAlive(paneId)) return false;
  spawnSync('tmux', ['select-window', '-t', paneId], { stdio: 'ignore' });
  return spawnSync('tmux', ['select-pane', '-t', paneId], { stdio: 'ignore' }).status === 0;
}

export function branchExists(cwd: string, branch: string): boolean | null {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  if (top.status !== 0) return null;
  const has = (ref: string) => spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd, stdio: 'ignore' }).status === 0;
  return has(`refs/heads/${branch}`) || has(`refs/remotes/origin/${branch}`);
}

export function editInEditor(text: string, name: string): { text: string | null; error: string | null } {
  const editor = (process.env.VISUAL || process.env.EDITOR || 'vi').trim().split(/\s+/);
  const dir = mkdtempSync(join(tmpdir(), 'baseline-'));
  const file = join(dir, `${name}.md`);
  try {
    writeFileSync(file, text);
    const r = spawnSync(editor[0], [...editor.slice(1), file], { stdio: 'inherit' });
    if (r.error || r.status !== 0) return { text: null, error: r.error ? `Couldn't run ${editor[0]}: ${r.error.message}` : `${editor[0]} exited with code ${r.status}; nothing saved` };
    return { text: existsSync(file) ? readFileSync(file, 'utf8') : null, error: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
