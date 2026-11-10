// Child processes that take over the terminal while Ink is suspended: a coding agent, or $EDITOR.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Target } from '../client/index.js';
import { tildePath } from './model.js';

/** $BASELINE_AGENT split on whitespace (so "claude --model opus" works), with the prompt as the last argument */
export function agentCommand(prompt: string, env = process.env): string[] {
  const words = (env.BASELINE_AGENT?.trim() || 'claude').split(/\s+/);
  return [...words, prompt];
}

/** where the agent runs: the issue's location when it exists on this disk, else here */
export function agentCwd(locationPath: string | undefined, cwd = process.cwd()): { cwd: string; note: string | null } {
  if (!locationPath) return { cwd, note: null };
  try {
    if (statSync(locationPath).isDirectory()) return { cwd: locationPath, note: null };
  } catch { /* missing: fall through */ }
  return { cwd, note: `Location ${tildePath(locationPath)} isn't on this disk; running in the current directory.` };
}

/** the command as a person would type it, with the prompt cut to its first line */
export function shellPreview(cmd: readonly string[], width: number): string {
  const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const shown = cmd.map((a, i) => (i === cmd.length - 1 && a.includes('\n') ? `${a.split('\n')[0]}…` : a));
  const line = shown.map(quote).join(' ');
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
}

/** the agent's environment: a TUI opened on --db points the agent's `baseline` calls at that same file */
export function agentEnv(target: Target, issueKey: string, env = process.env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, BASELINE_ISSUE: issueKey };
  if (target.kind === 'local' && target.source === 'flag') {
    next.BASELINE_DB = target.dbPath;
    delete next.BASELINE_URL;
    delete next.BASELINE_TOKEN;
  }
  return next;
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

/** the tmux command that runs `cmd` in a split beside this pane, with the same environment changes agentEnv makes */
export function paneCommand(cmd: readonly string[], opts: { cwd: string; target: Target; issueKey: string }): string[] {
  const env = ['-e', `BASELINE_ISSUE=${opts.issueKey}`];
  // an empty value reads as unset, so the split can't inherit a URL that would point the agent elsewhere
  if (opts.target.kind === 'local' && opts.target.source === 'flag') env.push('-e', `BASELINE_DB=${opts.target.dbPath}`, '-e', 'BASELINE_URL=', '-e', 'BASELINE_TOKEN=');
  return ['tmux', 'split-window', '-h', '-c', opts.cwd, ...env, ...cmd];
}

export function runInPane(cmd: readonly string[], opts: { cwd: string; target: Target; issueKey: string }): RunResult {
  const argv = paneCommand(cmd, opts);
  const r = spawnSync(argv[0], argv.slice(1), { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (r.error) return { ok: false, message: `Couldn't run tmux: ${r.error.message}` };
  return r.status === 0 ? { ok: true, message: 'started' } : { ok: false, message: `tmux split-window failed: ${(r.stderr || '').trim() || `exit ${r.status}`}` };
}

/** opens `text` in $VISUAL / $EDITOR and returns what was saved, or null when the editor failed */
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
