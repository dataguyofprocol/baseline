// Integrated agent: picks up issues assigned to the "Claude Code" user and runs them through Claude Code
// headlessly (`claude -p`), one at a time. Each run happens in its own git worktree of the issue's
// location (~/.baseline/agent-runs/<KEY>, on the brief's branch), so it never touches your checkout
// or another run's. No location, a missing path, or a non-git folder means no run: the issue stays
// queued and gets one comment saying what it needs. The result lands on the issue as a comment by
// that agent — summary, branch, worktree, changed files — and the state moves.
// Permissions stay scoped: acceptEdits plus an explicit tool allowlist (file tools, git, the
// baseline CLI) — never bypassPermissions.

import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../core/store.js';
import type { Issue, Location } from '../core/types.js';
import { issueKey } from '../core/types.js';

export const CLI_BIN = resolve(fileURLToPath(import.meta.url), '../../../bin/baseline.js');
const RUNS_DIR = process.env.BASELINE_RUNS_DIR ?? join(homedir(), '.baseline', 'runs');
/** where background runs get their worktrees — one folder per issue */
export const WORKTREES_DIR = process.env.BASELINE_WORKTREES_DIR ?? join(homedir(), '.baseline', 'agent-runs');
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

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOr = (cwd: string, ...args: string[]): string => { try { return git(cwd, ...args); } catch { return ''; } };
/** git reports resolved paths (/tmp → /private/tmp on macOS), so compare real paths only */
const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
const isOwnWorktree = (dir: string): boolean => isDirectory(dir) && real(gitOr(dir, 'rev-parse', '--show-toplevel')) === real(dir);

/** the repo root a location lives in ('' when it isn't inside a git repo) */
export function repoRootOf(path: string): string {
  return isDirectory(path) ? gitOr(path, 'rev-parse', '--show-toplevel') : '';
}

type Blocker = { reason: 'no-location' | 'missing' | 'not-git'; text: string };
/** why this issue can't run in the background, or null when it can */
export function runBlocker(store: Store, issue: Issue, key: string): Blocker | null {
  const loc = store.locationFor(issue);
  if (!loc) return { reason: 'no-location', text: `Claude Code needs a location for ${key} before it can start. Set one in the issue's **Location** property (or \`issue update ${key} --location <name>\`) and it will pick the issue up on its own.` };
  if (!isDirectory(loc.path)) return { reason: 'missing', text: `Claude Code can't start ${key}: the location **${loc.name}** points at \`${loc.path}\`, which doesn't exist on this machine. Fix the path in Settings ▸ Coding tools or pick another location.` };
  if (!repoRootOf(loc.path)) return { reason: 'not-git', text: `Claude Code can't run ${key} in the background: **${loc.name}** (\`${loc.path}\`) isn't a git repo, so the run can't get a worktree of its own. Pick a repo location, or use **Open in Claude Code** to work in it interactively.` };
  return null;
}

/** Claim and run the next queued issue. Resolves undefined when there is nothing to do
 *  (runner off, empty queue, nothing runnable, or a run already in flight). Issues that
 *  can't run are skipped — never blocking the ones behind them — and told why, once. */
export async function runNextAgentIssue(store: Store, dbPath: string): Promise<RunResult | undefined> {
  if (running) return undefined;
  const { agentRunner } = store.getAgentConfig();
  const fake = process.env.BASELINE_AGENT_CMD; // test hook: a shell command standing in for claude
  if (agentRunner === 'none' && !fake) return undefined;
  const teams = store.snapshot().teams;
  const nudges = store.agentNudges();
  let issue: Issue | undefined;
  let started: string | undefined;
  const queue = store.agentQueue();
  for (const id of Object.keys(nudges)) if (!queue.some(q => q.id === id)) store.setAgentNudge(id, null);
  for (const candidate of queue) {
    const key = issueKey(candidate, teams);
    const blocker = runBlocker(store, candidate, key);
    if (blocker) {
      if (nudges[candidate.id] !== blocker.reason) {
        store.addComment(candidate.id, candidate.assigneeId!, blocker.text);
        store.setAgentNudge(candidate.id, blocker.reason);
      }
      continue;
    }
    const claim = store.stateOfType(candidate.teamId, 'started');
    if (!claim) continue; // a team with no In Progress-type state has nowhere to claim it
    issue = candidate; started = claim; break;
  }
  if (!issue || !started) return undefined;

  const agentId = issue.assigneeId!;
  const key = issueKey(issue, teams);
  const loc = store.locationFor(issue)!;
  running = issue.id;
  try {
    store.setAgentNudge(issue.id, null);
    store.updateIssue(issue.id, { stateId: started }, agentId);
    return await execute(store, dbPath, issue, key, agentId, loc, fake);
  } finally {
    running = null;
  }
}

/** A worktree of the location's repo at ~/.baseline/agent-runs/<KEY>, on the brief's branch
 *  (created from the repo's default branch; reused as-is when the issue runs again). Returns the
 *  directory to run in — the same sub-folder of the worktree the location points at. */
export function prepareWorktree(loc: Location, key: string, branch: string): { cwd: string; worktree: string; branch: string; base: string } {
  const root = repoRootOf(loc.path);
  if (!root) throw new Error(`${loc.path} is not inside a git repo`);
  const sub = relative(real(root), real(loc.path));
  if (sub.startsWith('..')) throw new Error(`${loc.path} resolved outside its repo (${root})`);
  mkdirSync(WORKTREES_DIR, { recursive: true });
  const worktree = join(WORKTREES_DIR, key.replace(/[^A-Za-z0-9_-]/g, '_'));
  const reuse = isOwnWorktree(worktree);
  const commonDir = (dir: string) => real(gitOr(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  if (reuse && commonDir(worktree) !== commonDir(root)) throw new Error(`${worktree} is a worktree of another repo (the issue's location changed) — remove it with \`baseline agent clean --all\` and run again`);
  if (!reuse && existsSync(worktree)) throw new Error(`${worktree} exists but isn't a worktree — move it aside and run again`);
  let base = '';
  let useBranch = branch;
  if (!reuse) {
    // a run folder deleted by hand is still registered — forget it so the path and branch are free
    gitOr(root, 'worktree', 'prune');
    base = gitOr(root, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')
      || ['main', 'master'].find(b => gitOr(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`))
      || 'HEAD';
    const exists = !!gitOr(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
    const checkedOut = exists && gitOr(root, 'worktree', 'list', '--porcelain').split('\n').includes(`branch refs/heads/${branch}`);
    // the branch is already checked out somewhere (your own checkout, say) — never steal it
    // (…and start from it, so commits you already made on it come along)
    if (checkedOut) useBranch = `${branch}-agent`;
    const useExists = !!gitOr(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${useBranch}`);
    // --no-track: a pushed agent branch must never default to pushing onto main
    if (useExists) git(root, 'worktree', 'add', worktree, useBranch);
    else git(root, 'worktree', 'add', '--no-track', '-b', useBranch, worktree, checkedOut ? branch : base);
  } else {
    useBranch = gitOr(worktree, 'rev-parse', '--abbrev-ref', 'HEAD') || branch;
  }
  const cwd = sub ? join(worktree, sub) : worktree;
  if (!isDirectory(cwd)) throw new Error(`\`${sub}\` doesn't exist on \`${useBranch}\` (it's only in your checkout, or untracked) — commit it, or point the location at the repo root`);
  return { cwd, worktree, branch: useBranch, base };
}

/** removes run worktrees whose issue is closed (or every one with `all`) — never a dirty one */
export function cleanWorktrees(store: Store, opts: { all?: boolean } = {}): { removed: string[]; kept: Array<{ path: string; reason: string }> } {
  const removed: string[] = [];
  const kept: Array<{ path: string; reason: string }> = [];
  if (!isDirectory(WORKTREES_DIR)) return { removed, kept };
  for (const name of readdirSync(WORKTREES_DIR)) {
    const wt = join(WORKTREES_DIR, name);
    if (!isOwnWorktree(wt)) continue;
    const issue = store.getByKey(name);
    const type = issue ? store.stateType(issue.stateId) : undefined;
    const closed = !issue || type === 'completed' || type === 'canceled';
    if (issue && (type === 'started' || running === issue.id)) { kept.push({ path: wt, reason: 'issue in progress' }); continue; }
    if (!opts.all && !closed) { kept.push({ path: wt, reason: 'issue still open' }); continue; }
    if (gitOr(wt, 'status', '--porcelain')) { kept.push({ path: wt, reason: 'uncommitted changes' }); continue; }
    try { git(wt, 'worktree', 'remove', wt); removed.push(wt); } catch (err) { kept.push({ path: wt, reason: (err as Error).message.split('\n')[0] ?? 'git refused' }); }
  }
  return { removed, kept };
}

async function execute(store: Store, dbPath: string, issue: Issue, key: string, agentId: string, loc: Location, fake?: string): Promise<RunResult> {
  mkdirSync(RUNS_DIR, { recursive: true });
  const logPath = join(RUNS_DIR, `${key}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  let wt: ReturnType<typeof prepareWorktree>;
  try {
    wt = prepareWorktree(loc, key, store.handoffFor(issue.id)!.branchName);
  } catch (err) {
    const msg = (err as Error & { stderr?: string }).stderr?.toString().trim() || (err as Error).message;
    store.addComment(issue.id, agentId, `**Run failed** before it started: couldn't create a worktree of **${loc.name}** (\`${loc.path}\`).\n\n\`\`\`\n${msg}\n\`\`\``);
    store.updateIssue(issue.id, { stateId: store.stateOfType(issue.teamId, 'unstarted') ?? issue.stateId, assigneeId: store.workspaceMeta().currentUser || null }, agentId);
    return { key, ok: false, exitCode: null, logPath };
  }
  const cwd = wt.cwd;
  const prompt = buildPrompt(store, issue.id, key, wt);

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
    `Worktree: \`${wt.worktree}\``,
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

function buildPrompt(store: Store, issueId: string, key: string, wt: { worktree: string; branch: string; base: string }): string {
  return `${store.handoffFor(issueId)!.prompt}

---
You are working in a dedicated git worktree (\`${wt.worktree}\`) with branch \`${wt.branch}\` already checked out${wt.base ? ` from \`${wt.base}\`` : ''} — commit there and don't switch branches.
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
