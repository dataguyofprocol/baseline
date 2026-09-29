// "Open in Claude Code": starts an interactive Claude Code session for an issue in a macOS terminal window.
// The server runs on the user's own machine, so it writes a small .command launcher (prompt in a
// sibling file, so nothing has to survive shell quoting) and hands it to Terminal/iTerm via `open -a`.
// No AppleScript automation permission is needed for that; the folder picker uses `choose folder`.

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeDir, type Store } from '../core/store.js';
import { issueKey } from '../core/types.js';
import { CLI_BIN, isDirectory } from './agentRunner.js';

const SESSIONS_DIR = process.env.BASELINE_SESSIONS_DIR ?? join(homedir(), '.baseline', 'sessions');

export class LaunchError extends Error {
  constructor(public code: 'not-found' | 'no-directory' | 'bad-directory' | 'unsupported' | 'launch-failed', message: string) { super(message); }
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

export interface LaunchResult { key: string; directory: string; savedToProject: boolean; scriptPath: string }

export function openInClaudeCode(store: Store, dbPath: string, issueId: string, opts: { directory?: string; saveToProject?: boolean } = {}): LaunchResult {
  if (process.platform !== 'darwin' && !process.env.BASELINE_OPEN_CMD) throw new LaunchError('unsupported', 'Opening a terminal session is only supported on macOS — use `baseline issue handoff` instead');
  const issue = store.getIssue(issueId);
  if (!issue) throw new LaunchError('not-found', 'Issue not found');
  const key = issueKey(issue, store.snapshot().teams);
  const directory = normalizeDir(opts.directory) || store.agentDirFor(issue);
  if (!directory) throw new LaunchError('no-directory', 'No directory set for this issue — choose one');
  if (!isDirectory(directory)) throw new LaunchError('bad-directory', `Directory not found: ${directory}`);

  // only a directory the user explicitly picked becomes the project's — never the fallback default
  let savedToProject = false;
  if (opts.saveToProject && opts.directory && issue.projectId) {
    const project = store.snapshot().projects.find(p => p.id === issue.projectId);
    if (project && !project.directory) { store.updateProject(project.id, { directory }); savedToProject = true; }
  }
  store.rememberDirectory(directory);

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
  const [cmd, args] = process.env.BASELINE_OPEN_CMD
    ? ['sh', ['-c', `${process.env.BASELINE_OPEN_CMD} "$1"`, 'sh', scriptPath]]
    : ['open', ['-a', store.getAgentConfig().terminalApp, scriptPath]];
  try { execFileSync(cmd, args, { stdio: 'ignore' }); } catch (err) {
    throw new LaunchError('launch-failed', `Could not open ${store.getAgentConfig().terminalApp}: ${(err as Error).message}`);
  }
  return { key, directory, savedToProject, scriptPath };
}

/** native folder picker; resolves null when the user cancels */
export function pickDirectory(prompt = 'Choose a directory for Claude Code'): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.reject(new LaunchError('unsupported', 'The folder picker is only available on macOS — type the path instead'));
  return new Promise((done, fail) => {
    execFile('osascript', ['-e', 'activate', '-e', `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`], { timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      if (err) return /-128|User canceled/i.test(stderr) ? done(null) : fail(new LaunchError('launch-failed', stderr.trim() || err.message));
      done(stdout.trim().replace(/(.)\/+$/, '$1'));
    });
  });
}
