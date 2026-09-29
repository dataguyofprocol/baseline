// Integrated agent: picks up issues assigned to the "Claude Code" user and runs them through Claude Code
// headlessly (`claude -p`), one at a time, in the issue's project directory (or the workspace default). The result lands on the issue as a comment by that
// agent — summary, branch, changed files — and the state moves.
// No tables of its own: the claim is the state flip to "started", config lives in meta.
// Permissions stay scoped: acceptEdits plus an explicit tool allowlist (file tools, git, the
// baseline CLI) — never bypassPermissions.

import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../core/store.js';
import type { Issue } from '../core/types.js';
import { issueKey } from '../core/types.js';

export const CLI_BIN = resolve(fileURLToPath(import.meta.url), '../../../bin/baseline.js');
const RUNS_DIR = process.env.BASELINE_RUNS_DIR ?? join(homedir(), '.baseline', 'runs');
const TIMEOUT_MS = Number(process.env.BASELINE_AGENT_TIMEOUT_MS ?? 45 * 60_000);
const POLL_MS = Number(process.env.BASELINE_AGENT_POLL_MS ?? 30_000);
const CLAUDE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', `Bash(node ${CLI_BIN}:*)`];

export interface RunResult { key: string; ok: boolean; exitCode: number | null; logPath: string }

let running: string | null = null;
/** issue id the integrated agent is working on, for the web's "Agent running…" hint */
export function agentRunningIssueId(): string | null { return running; }

export function isDirectory(p: string): boolean {
  try { return !!p && existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
}

/** Claim and run the next queued issue. Resolves undefined when there is nothing to do
 *  (runner off, empty queue, no queued issue with a working directory, or a run already in flight).
 *  An issue whose directory is missing is skipped rather than blocking the ones behind it. */
export async function runNextAgentIssue(store: Store, dbPath: string): Promise<RunResult | undefined> {
  if (running) return undefined;
  const { agentRunner } = store.getAgentConfig();
  const fake = process.env.BASELINE_AGENT_CMD; // test hook: a shell command standing in for claude
  if (agentRunner === 'none' && !fake) return undefined;
  let issue: Issue | undefined;
  let agentCwd = '';
  let started: string | undefined;
  for (const candidate of store.agentQueue()) {
    const dir = store.agentDirFor(candidate);
    // no directory, or no In Progress-type state to claim with: skip it, don't stall the queue
    const claim = store.stateOfType(candidate.teamId, 'started');
    if (isDirectory(dir) && claim) { issue = candidate; agentCwd = dir; started = claim; break; }
  }
  if (!issue || !started) return undefined;

  const agentId = issue.assigneeId!;
  const key = issueKey(issue, store.snapshot().teams);
  running = issue.id;
  try {
    store.updateIssue(issue.id, { stateId: started }, agentId);
    return await execute(store, dbPath, issue, key, agentId, agentCwd, fake);
  } finally {
    running = null;
  }
}

async function execute(store: Store, dbPath: string, issue: Issue, key: string, agentId: string, cwd: string, fake?: string): Promise<RunResult> {
  mkdirSync(RUNS_DIR, { recursive: true });
  const logPath = join(RUNS_DIR, `${key}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const prompt = buildPrompt(store, issue.id, key);

  const env = { ...process.env, BASELINE_DB: dbPath, BASELINE_AS: agentId, BASELINE_PROMPT: prompt, BASELINE_ISSUE: key };
  const [cmd, args]: [string, string[]] = fake ? ['sh', ['-c', fake]]
    : ['claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', ...CLAUDE_TOOLS]];

  const log = createWriteStream(logPath);
  log.write(`$ ${fake ?? 'claude -p <prompt> --permission-mode acceptEdits'}\n# cwd: ${cwd}\n\n`);
  let stdout = '';
  let timedOut = false;
  const { exitCode, signal } = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((done) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; log.write('\n# timed out — stopping\n'); child.kill('SIGTERM'); }, TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => { stdout += d; log.write(d); });
    child.stderr.on('data', (d: Buffer) => log.write(d));
    child.on('error', (err) => { log.write(`\n# spawn failed: ${err.message}\n`); clearTimeout(timer); done({ exitCode: 127, signal: null }); });
    child.on('close', (code, sig) => { clearTimeout(timer); done({ exitCode: code, signal: sig }); });
  });
  await new Promise<void>(r => log.end(r));

  const ok = exitCode === 0;
  // killed from outside (signal, or a shell reporting 128+signal) reads as "stopped", not a failure of the work
  const stopped = !ok && !timedOut && (signal !== null || exitCode === 143 || exitCode === 137);
  const headline = timedOut ? `**Run timed out** after ${Math.round(TIMEOUT_MS / 60_000)} min.`
    : stopped ? `**Run stopped** before it finished (${signal ?? `exit ${exitCode}`}).`
    : `**Run failed** (exit ${exitCode}).`;
  const body = [
    ok ? lastMessage(stdout) || '_Finished without a summary._' : `${headline}\n\n${tail(readSafe(logPath), 20)}`,
    '',
    ...gitSummary(cwd),
    `Log: \`${logPath}\``,
  ].join('\n');
  store.addComment(issue.id, agentId, body);

  const now = store.getIssue(issue.id);
  if (now && store.stateType(now.stateId) === 'started') {
    if (ok) {
      const done = store.stateOfType(issue.teamId, 'completed');
      if (done) store.updateIssue(issue.id, { stateId: done }, agentId);
    } else {
      // hand it back: reassigning to you raises the Inbox notification
      store.updateIssue(issue.id, { stateId: store.stateOfType(issue.teamId, 'unstarted') ?? now.stateId, assigneeId: store.workspaceMeta().currentUser || null }, agentId);
    }
  }
  return { key, ok, exitCode, logPath };
}

function buildPrompt(store: Store, issueId: string, key: string): string {
  return `${store.handoffFor(issueId)!.prompt}

---
Baseline CLI: \`node ${CLI_BIN}\` (BASELINE_DB and BASELINE_AS are set, so writes go to this workspace and are attributed to you).
This is a background run: skip the final comment and the Done state change above. End with that comment as your final message instead; Baseline posts it on ${key} and moves the state for you.`;
}

/** stream-json ends with a `{"type":"result","result":…}` line; anything else is taken as plain text */
function lastMessage(stdout: string): string {
  const text = stdout.trim();
  if (!text) return '';
  const lines = text.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i]!) as { type?: string; result?: unknown };
      if (j.type === 'result' && typeof j.result === 'string') return j.result.trim();
    } catch { /* not json */ }
  }
  if (lines.every(l => l.startsWith('{'))) return '';
  return text.length > 4000 ? text.slice(-4000) : text;
}

function gitSummary(cwd: string): string[] {
  const git = (...a: string[]) => { try { return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (!branch) return [];
  const base = ['main', 'master'].find(b => b !== branch && git('rev-parse', '--verify', '--quiet', b));
  const committed = base ? git('diff', '--name-only', `${base}...HEAD`).split('\n') : [];
  const dirty = git('status', '--porcelain').split('\n').map(l => l.slice(3));
  const files = [...new Set([...committed, ...dirty].filter(Boolean))];
  return [
    `Branch: \`${branch}\``,
    ...(files.length ? [`Files: ${files.slice(0, 25).map(f => `\`${f}\``).join(', ')}${files.length > 25 ? ` (+${files.length - 25} more)` : ''}`] : []),
  ];
}

function readSafe(p: string): string { try { return readFileSync(p, 'utf8').trim(); } catch { return ''; } }
function tail(s: string, n: number): string { return '```\n' + s.split('\n').slice(-n).map(l => l.length > 300 ? l.slice(0, 300) + '…' : l).join('\n') + '\n```'; }

/** background loop for `baseline serve`: one pickup attempt per tick, never overlapping */
export function startAgentRunner(store: Store, dbPath: string): () => void {
  const tick = () => {
    runNextAgentIssue(store, dbPath)
      .then(r => { if (r) console.log(`[baseline] agent ${r.ok ? 'finished' : 'failed'} ${r.key} — ${r.logPath}`); })
      .catch(err => console.error('[baseline] agent runner error:', err));
  };
  const timer = setInterval(tick, POLL_MS);
  tick();
  return () => clearInterval(timer);
}
