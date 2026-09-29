// "Open in Claude Code": starts an interactive Claude Code session for an issue in a macOS terminal window.
// The server runs on the user's own machine, so it writes a small .command launcher (prompt in a
// sibling file, so nothing has to survive shell quoting) and hands it to the chosen terminal via `open -a`.
// No AppleScript automation permission is needed for that; the folder picker uses `choose folder`.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDir, type Store } from '../core/store.js';
import { issueKey, TERMINAL_APPS, type TerminalApp } from '../core/types.js';

export const CLI_BIN = resolve(fileURLToPath(import.meta.url), '../../../bin/baseline.js');

export function isDirectory(p: string): boolean {
  try { return !!p && existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
}

const SESSIONS_DIR = process.env.BASELINE_SESSIONS_DIR ?? join(homedir(), '.baseline', 'sessions');

export class LaunchError extends Error {
  constructor(public code: 'not-found' | 'no-location' | 'bad-directory' | 'unsupported' | 'launch-failed', message: string) { super(message); }
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const SESSION_TTL_MS = 7 * 86_400_000;

/** launchers and briefs are only needed until the terminal has read them — keep a week, then drop */
function pruneSessions(): void {
  try {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const f of readdirSync(SESSIONS_DIR)) {
      if (!/\.(md|command)$/.test(f)) continue;
      const p = join(SESSIONS_DIR, f);
      if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
    }
  } catch { /* best effort */ }
}

/** absolute path of `claude` as the server sees it — Terminal's non-login sh may not have the same PATH */
function claudeBin(): string {
  try { return execFileSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).trim() || 'claude'; } catch { return 'claude'; }
}

export function interactivePrompt(store: Store, issueId: string, key: string): string {
  return `${store.handoffFor(issueId)!.prompt}

---
Baseline CLI: \`node ${CLI_BIN}\` (BASELINE_DB and BASELINE_AS are set, so writes go to this workspace and are attributed to you). Use it — or the /baseline skill if you have it — to read the issue (\`issue show ${key} --json\`) and to post your progress on ${key} yourself.`;
}

/** Terminal, iTerm, Ghostty and Warp open a .command like a document; these take it as the program to run */
const RUNS_AS_PROGRAM: Partial<Record<TerminalApp, string[]>> = { kitty: [], Alacritty: ['-e'], WezTerm: ['start', '--'] };

function openArgs(app: TerminalApp, script: string): string[] {
  const pre = RUNS_AS_PROGRAM[app];
  return pre ? ['-na', app, '--args', ...pre, script] : ['-a', app, script];
}

const APP_DIRS = ['/Applications', '/Applications/Utilities', '/System/Applications/Utilities', join(homedir(), 'Applications')];

/** the supported terminals present on this Mac — none off macOS */
export function installedTerminals(): TerminalApp[] {
  if (process.platform !== 'darwin') return [];
  return TERMINAL_APPS.filter(app => APP_DIRS.some(dir => existsSync(join(dir, `${app}.app`))));
}

export interface LaunchResult { key: string; directory: string; location: { id: string; name: string }; pinned: boolean; scriptPath: string }

/** Opens the issue's location — or pins the one given (an existing location, or a new folder,
 *  which is registered as a location) and opens that. Nothing is guessed: no location, no launch. */
export function openInClaudeCode(store: Store, dbPath: string, issueId: string, opts: { locationId?: string; directory?: string } = {}): LaunchResult {
  if (process.platform !== 'darwin' && !process.env.BASELINE_OPEN_CMD) throw new LaunchError('unsupported', 'Opening a terminal session is only supported on macOS — use `baseline issue handoff` instead');
  const issue = store.getIssue(issueId);
  if (!issue) throw new LaunchError('not-found', 'Issue not found');
  const key = issueKey(issue, store.snapshot().teams);
  const picked = opts.directory && normalizeDir(opts.directory);
  if (picked && !isDirectory(picked)) throw new LaunchError('bad-directory', `Directory not found: ${picked}`);
  const location = picked ? store.createLocation(picked)
    : opts.locationId ? store.getLocation(opts.locationId)
    : store.locationFor(issue);
  if (!location) throw new LaunchError('no-location', `${key} has no location — pick one`);
  const directory = location.path;
  if (!isDirectory(directory)) throw new LaunchError('bad-directory', `The location ${location.name} points at ${directory}, which doesn't exist`);
  // choosing where to open it is choosing where the task lives
  const pinned = issue.locationId !== location.id;
  if (pinned) store.updateIssue(issue.id, { locationId: location.id });

  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  pruneSessions();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // team keys are free text — never let one steer the file outside the sessions folder
  const base = `${key.replace(/[^A-Za-z0-9_-]/g, '_')}-${stamp}`;
  const promptPath = join(SESSIONS_DIR, `${base}.md`);
  const scriptPath = join(SESSIONS_DIR, `${base}.command`);
  // the brief can hold private issue text: owner-only, like the launcher
  writeFileSync(promptPath, interactivePrompt(store, issue.id, key), { mode: 0o600 });
  writeFileSync(scriptPath, [
    '#!/bin/sh',
    `cd ${sq(directory)} || exit 1`,
    `export PATH=${sq(process.env.PATH ?? '/usr/bin:/bin')}`,
    `export BASELINE_DB=${sq(dbPath)} BASELINE_AS=${sq(store.claudeCodeUserId())} BASELINE_ISSUE=${sq(key)}`,
    `printf '\\033]0;%s\\007' ${sq(`${key} · Claude Code`)}`,
    `exec ${sq(claudeBin())} -- "$(cat ${sq(promptPath)})"`,
    '',
  ].join('\n'), { mode: 0o700 });

  // test hook: a command that receives the launcher path instead of a terminal opening it
  const { terminalApp } = store.getAgentConfig();
  const [cmd, args] = process.env.BASELINE_OPEN_CMD
    ? ['sh', ['-c', `${process.env.BASELINE_OPEN_CMD} "$1"`, 'sh', scriptPath]]
    : ['open', openArgs(terminalApp, scriptPath)];
  try { execFileSync(cmd, args, { stdio: 'ignore' }); } catch (err) {
    throw new LaunchError('launch-failed', `Could not open ${terminalApp}: ${(err as Error).message}`);
  }
  return { key, directory, location: { id: location.id, name: location.name }, pinned, scriptPath };
}

/** native folder picker (⌘-click picks several when `multiple`); resolves [] when the user cancels */
export function pickDirectories(prompt = 'Choose a folder', multiple = false): Promise<string[]> {
  if (process.platform !== 'darwin') return Promise.reject(new LaunchError('unsupported', 'The folder picker is only available on macOS — type the path instead'));
  const script = [
    'activate',
    `set picked to (choose folder with prompt ${JSON.stringify(prompt)}${multiple ? ' with multiple selections allowed' : ''})`,
    'if class of picked is not list then set picked to {picked}',
    'set out to ""',
    'repeat with f in picked',
    'set out to out & POSIX path of f & linefeed',
    'end repeat',
    'return out',
  ];
  return new Promise((done, fail) => {
    execFile('osascript', script.flatMap(line => ['-e', line]), { timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      if (err) return /-128|User canceled/i.test(stderr) ? done([]) : fail(new LaunchError('launch-failed', stderr.trim() || err.message));
      done(stdout.split('\n').map(p => p.trim().replace(/(.)\/+$/, '$1')).filter(Boolean));
    });
  });
}
