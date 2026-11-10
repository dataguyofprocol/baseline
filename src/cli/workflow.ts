// The engineer's side of the agent loop, on the command line: `baseline work KEY`, `next`,
// `standup`, `doctor`, and the Claude Code hooks (`baseline hook session-start|prompt|stop`) that
// `baseline connect claude` installs. Every command here runs the same ops the MCP tools do.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Command } from 'commander';
import { agentTarget, BaselineError, connectAgent, describeTarget, ResolveError, TargetError, type Baseline } from '../client/index.js';
import { issueKey, type Issue, type Snapshot } from '../core/types.js';
import { myActivity, nextIssue, startIssue } from '../ops/index.js';
import { agentActor, sessionFrom } from '../ops/identity.js';
import { OpError, runOp, type AnyOperation, type OpContext } from '../ops/operation.js';
import { currentBranch, git, keysInBranch, localRepo, readRepoConfig, REPO_CONFIG, repoRoot } from './repo.js';

const fail = (message: string): never => { console.error(`error: ${message}`); process.exit(1); };

/** the coding tool running this command, when it says so: Claude Code sets CLAUDECODE=1 in the shells it starts */
const harnessFromEnv = () => process.env.CLAUDECODE === '1' ? 'Claude Code' : undefined;

/** an op context for a command: the agent surface's target (never a new database), this repo, and
 *  `agent` (a coding tool's agent user) or `person` (the engineer at the terminal) */
export async function agentContext(flags: { db?: string; as?: string }, who: 'agent' | 'person' = 'agent'): Promise<OpContext> {
  const bl = await connectAgent(flags);
  const actor = who === 'person' ? { kind: 'person' as const } : await agentActor(bl, flags.as ?? process.env.BASELINE_AS ?? harnessFromEnv());
  return { bl, actor, session: sessionFrom(process.env.BASELINE_SESSION), surface: 'cli', local: localRepo() };
}

async function runFor(op: AnyOperation, ctx: OpContext, input: Record<string, unknown>) {
  try { return await runOp(op, ctx, input); } catch (e) {
    if (e instanceof OpError) return fail(e.message);
    throw e;
  }
}

const onPath = (name: string) => (process.env.PATH ?? '').split(delimiter).some(d => {
  try { accessSync(join(d, name), constants.X_OK); return true; } catch { return false; }
});
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------- hooks

interface HookInput { session_id?: string; cwd?: string; prompt?: string; source?: string; stop_hook_active?: boolean }

/** the hook's JSON on stdin; {} when there is none */
async function hookInput(): Promise<HookInput> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as HookInput; } catch { return {}; }
}

/** what a hook adds to Claude's context (SessionStart, UserPromptSubmit), per Claude Code's hook JSON */
const addContext = (event: 'SessionStart' | 'UserPromptSubmit', text: string) =>
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));

/** one marker per (session, what), so a hook says a thing once per session */
function once(session: string | undefined, what: string): boolean {
  if (!session) return true;
  const dir = join(tmpdir(), 'baseline-hooks');
  const file = join(dir, `${session.replace(/[^\w.-]/g, '_')}-${what.replace(/[^\w.-]/g, '_')}`);
  if (existsSync(file)) return false;
  try { mkdirSync(dir, { recursive: true }); writeFileSync(file, ''); } catch { /* best effort: say it again next time */ }
  return true;
}

const OPEN = (snap: Pick<Snapshot, 'states'>, i: Issue) => !i.deletedAt && !i.archivedAt && !['completed', 'canceled'].includes(snap.states.find(s => s.id === i.stateId)?.type ?? '');
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** the issue the checked-out branch names, with what the hooks need about it */
async function branchIssue(bl: Baseline, root: string) {
  const snap = await bl.snapshot(['issues', 'states', 'teams', 'users', 'currentUser']);
  const branch = currentBranch(root);
  const keys = branch ? keysInBranch(branch, snap.teams.map(t => t.key)) : [];
  const issue = keys.map(k => snap.issues.find(i => issueKey(i, snap.teams) === k)).find((i): i is Issue => !!i && !i.deletedAt);
  return { snap, branch, issue };
}

/** SessionStart: 3–6 lines about this repo and branch, or nothing */
async function sessionStart(input: HookInput): Promise<void> {
  const root = repoRoot(input.cwd ?? process.cwd());
  if (!root) return;
  const bl = await connectAgent({});
  const { snap, branch, issue } = await branchIssue(bl, root);
  const me = snap.currentUser.id;
  const key = (i: Issue) => issueKey(i, snap.teams);
  const state = (i: Issue) => snap.states.find(s => s.id === i.stateId);
  const team = readRepoConfig(root).team?.toUpperCase();
  const teamId = team ? snap.teams.find(t => t.key === team)?.id : undefined;
  const mine = snap.issues.filter(i => i.assigneeId === me && OPEN(snap, i) && i.id !== issue?.id && (!teamId || i.teamId === teamId)
    && ['started', 'unstarted'].includes(state(i)?.type ?? ''))
    .sort((a, b) => (state(a)?.type === 'started' ? 0 : 1) - (state(b)?.type === 'started' ? 0 : 1) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const out: string[] = [];
  if (issue) {
    const whose = issue.assigneeId === me ? 'yours' : issue.assigneeId ? `${snap.users.find(u => u.id === issue.assigneeId)?.name ?? '?'}'s` : 'unassigned';
    out.push(`Baseline: on branch \`${branch}\` → ${key(issue)} ${issue.title} (${state(issue)?.name ?? '?'}, ${whose}).`);
    const t = (await bl.workThreads(issue.id)).filter(x => x.personId === me && (x.progress.did || x.progress.left)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (t) out.push(`Last progress (${ago(t.updatedAt)}): ${(t.progress.did ?? '—').replace(/\s+/g, ' ').slice(0, 200)}${t.progress.left ? ` | left: ${t.progress.left.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`);
    if (!OPEN(snap, issue)) out.push(`${key(issue)} is closed; start another issue before new work on this branch.`);
    else if (state(issue)?.type !== 'started') out.push(`It isn't started: call start_issue ${key(issue)} before you change code.`);
    else out.push(`Keep it current: post_progress after meaningful steps, finish_issue when you stop.`);
  }
  if (mine.length) out.push(`${issue ? 'Also yours' : 'Your open issues'}${team ? ` in ${team}` : ''}: ${mine.map(i => `${key(i)} ${i.title.slice(0, 50)} (${state(i)?.name})`).join('; ')}.`);
  if (!issue && mine.length) out.push('No issue on this branch: start_issue one of these before you change code, or find_issues / propose_issue for other work.');
  if (out.length) addContext('SessionStart', out.join('\n'));
}

/** "fix the login redirect", "can you add retries to the importer": work, not a question */
const WORK = /^(?:(?:please|ok|okay|so|now|then|hey)[\s,]+)*(?:(?:can|could|would) you\s+|let'?s\s+|go ahead and\s+|i (?:need|want) (?:you )?to\s+|we (?:need|should|have) to\s+)?(?:fix|add|implement|build|create|make|write|refactor|update|change|remove|delete|drop|rename|move|migrate|support|handle|debug|investigate|improve|optimi[sz]e|upgrade|bump|port|rewrite|replace|wire|hook up|set up|introduce|extract|split|clean up|ship|convert|allow|prevent|stop)\b/i;
export function looksLikeWork(prompt: string): boolean {
  const p = prompt.trim();
  if (!p || /^[/!#]/.test(p) || p.split(/\s+/).length < 3) return false;
  return WORK.test(p);
}

/** UserPromptSubmit: a one-line nudge when no issue is active and the prompt asks for work. Never blocks. */
async function promptHook(input: HookInput): Promise<void> {
  const cwd = input.cwd ?? process.cwd();
  const root = repoRoot(cwd);
  if (!root || readRepoConfig(root).promptHook === false || /^(0|off|false|no)$/i.test(process.env.BASELINE_PROMPT_HOOK ?? '')) return;
  agentTarget({});
  // fast and offline: a branch or a prompt that names an issue key means the work is tracked
  const branch = currentBranch(root) ?? '';
  const KEY = /(?:^|[^a-z0-9])[a-z][a-z0-9]{0,9}-\d+(?=$|[^0-9])/i;
  if (KEY.test(branch) || KEY.test(input.prompt ?? '') || !looksLikeWork(input.prompt ?? '')) return;
  if (!once(input.session_id, 'prompt-nudge')) return;
  addContext('UserPromptSubmit', 'No Baseline issue is active on this branch. If this is work to track, call find_issues first, then start_issue on the match (or propose_issue for new work).');
}

/** Stop: when the branch's issue is active and HEAD is newer than the last progress note, ask once
 *  for post_progress. stop_hook_active (Claude is already continuing for a stop hook) is never asked again. */
async function stopHook(input: HookInput): Promise<void> {
  if (input.stop_hook_active) return;
  const root = repoRoot(input.cwd ?? process.cwd());
  if (!root) return;
  const bl = await connectAgent({});
  const { snap, branch, issue } = await branchIssue(bl, root);
  if (!issue || !OPEN(snap, issue)) return;
  const me = snap.currentUser.id;
  const threads = (await bl.workThreads(issue.id)).filter(t => t.personId === me && t.state.status === 'active');
  if (!threads.length) return;
  const last = threads.map(t => t.updatedAt).sort().pop()!;
  const head = git(root, ['log', '-1', '--format=%H %cI']);
  const [sha, at] = head.out.split(' ');
  if (!head.ok || !sha || !at || Date.parse(at) <= Date.parse(last)) return;
  if (!once(input.session_id, `stop-${sha}`)) return;
  const key = issueKey(issue, snap.teams);
  console.log(JSON.stringify({
    decision: 'block',
    reason: `There are commits on ${branch} newer than your last Baseline progress note on ${key}. Call post_progress on ${key} once (did, left), or finish_issue if the work is complete; then stop.`,
  }));
}

// ---------------------------------------------------------------- doctor

function readJson(path: string): Record<string, any> | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>; } catch { return null; }
}

async function doctor(flags: { db?: string; dir?: string }): Promise<number> {
  const ok = (label: string, text: string) => console.log(`✓ ${label.padEnd(10)} ${text}`);
  const bad = (label: string, text: string) => console.log(`✗ ${label.padEnd(10)} ${text}`);
  let healthy = true;
  let snap: Pick<Snapshot, 'teams'> | undefined;
  try {
    const target = agentTarget(flags);
    const bl = await connectAgent(flags);
    const me = await bl.me();
    ok('server', describeTarget(target));
    ok('you', `${me.user.name}${me.user.email ? ` <${me.user.email}>` : ''} in ${me.workspace.name}${me.via === 'key' ? ' (API key)' : ''}`);
    snap = await bl.snapshot(['teams']);
  } catch (e) {
    healthy = false;
    if (e instanceof TargetError || e instanceof BaselineError) bad('server', e.message);
    else throw e;
  }
  const root = repoRoot(flags.dir ?? process.cwd());
  if (!root) { bad('repo', `${flags.dir ?? process.cwd()} is not a git repository`); return healthy ? 0 : 1; }
  ok('repo', `${root} (branch ${currentBranch(root) ?? 'detached'})`);
  const team = readRepoConfig(root).team;
  if (!team) bad('team', `no team mapped: run \`baseline connect claude --team KEY\` (writes ${REPO_CONFIG})`);
  else if (snap && !snap.teams.some(t => t.key.toLowerCase() === team.toLowerCase())) bad('team', `${REPO_CONFIG} names ${team}, which isn't a team here (${snap.teams.map(t => t.key).join(', ')})`);
  else ok('team', `${team.toUpperCase()} (from ${REPO_CONFIG})`);
  const mcp = readJson(join(root, '.mcp.json'))?.mcpServers?.baseline;
  if (mcp) ok('mcp', `.mcp.json runs ${mcp.type === 'http' ? mcp.url : [mcp.command, ...(mcp.args ?? [])].join(' ')}`);
  else bad('mcp', 'no baseline server in .mcp.json: run `baseline connect claude`');
  const settings = readJson(join(root, '.claude', 'settings.json'));
  const hookCmds = JSON.stringify(settings?.hooks ?? {});
  const hooks = ['session-start', 'prompt', 'stop'].filter(h => hookCmds.includes(`baseline hook ${h}`));
  if (hooks.length === 3) ok('hooks', 'SessionStart, UserPromptSubmit and Stop in .claude/settings.json');
  else bad('hooks', `${hooks.length ? `only ${hooks.join(', ')}` : 'none'} in .claude/settings.json: run \`baseline connect claude\``);
  const allowed = ((settings?.permissions?.allow ?? []) as string[]).filter(a => a.startsWith('mcp__baseline__'));
  if (allowed.length) ok('allow', `${allowed.length} baseline tools run without asking`);
  else bad('allow', 'no baseline tools allow-listed: every write asks first');
  const claudeMd = existsSync(join(root, 'CLAUDE.md')) ? readFileSync(join(root, 'CLAUDE.md'), 'utf8') : '';
  if (claudeMd.includes('baseline:agent-tracking:start')) ok('CLAUDE.md', 'has the Baseline block'); else bad('CLAUDE.md', 'no Baseline block: run `baseline connect claude`');
  if (!onPath('baseline')) bad('PATH', '`baseline` is not on your PATH, so the MCP server and hooks can\'t start');
  return healthy ? 0 : 1;
}

// ---------------------------------------------------------------- commands

export function mountWorkflowCommands(program: Command): void {
  program.command('work <key>')
    .description('Start an issue (In Progress, assigned to you), check out its branch, and open Claude Code on it (or print the command)')
    .option('--take-over', 'start it even though another person has it (reassigns it to you)', false)
    .option('--no-launch', 'print the claude command instead of running it')
    .option('--db <path>', 'database path')
    .option('--json', 'print the start result as JSON', false)
    .action(async (key: string, flags: { db?: string; takeOver?: boolean; launch?: boolean; json?: boolean }) => {
      const ctx = await agentContext(flags, 'person');
      const out = await runFor(startIssue as AnyOperation, ctx, { issue: key, ...(flags.takeOver ? { take_over: true } : {}) }) as Awaited<ReturnType<typeof startIssue.run>>;
      if (flags.json) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
      console.log(startIssue.text({ ...out, brief: null }, 'cli'));
      const prompt = `Work on ${out.key}: ${out.title}. It is started in Baseline on branch ${out.branch}; call get_issue ${out.key} for the brief, post_progress as you go, and finish_issue when you stop.`;
      const root = repoRoot(process.cwd()) ?? process.cwd();
      const command = `claude ${shellQuote(prompt)}`;
      // never from inside a coding tool, a script or a test: only a person at a terminal gets a session opened
      const launch = flags.launch !== false && process.stdout.isTTY && process.stdin.isTTY && !process.env.CLAUDECODE && !process.env.BASELINE_NO_LAUNCH && onPath('claude');
      if (!launch) { console.log(`\nNext: ${root === process.cwd() ? '' : `cd ${shellQuote(root)} && `}${command}`); process.exit(0); }
      const r = spawnSync('claude', [prompt], { cwd: root, stdio: 'inherit' });
      process.exit(r.status ?? 0);
    });

  program.command('next')
    .description('What to work on next: your issues in progress, your Todo by priority, then unassigned ones in your teams\' current cycle (unblocked only)')
    .option('-t, --team <key>', 'only this team')
    .option('-n, --limit <n>', 'at most this many (default 3)')
    .option('--db <path>', 'database path')
    .option('--json', 'output as JSON', false)
    .action(async (flags: { db?: string; team?: string; limit?: string; json?: boolean }) => {
      const out = await runFor(nextIssue as AnyOperation, await agentContext(flags, 'person'), { team: flags.team, ...(flags.limit ? { limit: Number(flags.limit) } : {}) });
      console.log(flags.json ? JSON.stringify(out, null, 2) : nextIssue.text(out as never, 'cli'));
      process.exit(0);
    });

  program.command('standup')
    .description('What you (and agents working for you) did since yesterday: issues started, progressed, finished, filed, and your PRs, ready to paste')
    .option('-s, --since <when>', 'yesterday (default), today, 12h, 3d, 1w, or a date')
    .option('--db <path>', 'database path')
    .option('--json', 'output as JSON', false)
    .action(async (flags: { db?: string; since?: string; json?: boolean }) => {
      const out = await runFor(myActivity as AnyOperation, await agentContext(flags, 'person'), { since: flags.since });
      console.log(flags.json ? JSON.stringify(out, null, 2) : myActivity.text(out as never, 'cli'));
      process.exit(0);
    });

  program.command('doctor')
    .description('Check the setup: the server and who you are, this repo\'s team, and whether Claude Code\'s MCP server, hooks and allow-list are in place')
    .option('--dir <repo>', 'the repo to check (default: the one you are in)')
    .option('--db <path>', 'database path')
    .action(async (flags: { db?: string; dir?: string }) => { process.exit(await doctor(flags)); });

  program.command('hook <event>')
    .description('Claude Code hooks, installed by `baseline connect claude`: session-start (context for this branch), prompt (a nudge to track work), stop (a reminder to post progress). Silent on any error.')
    .action(async (event: string) => {
      // a hook must never hold up or break the session: a hard deadline, and silence on any failure
      setTimeout(() => process.exit(0), 4000);
      try {
        const input = await hookInput();
        if (event === 'session-start') await sessionStart(input);
        else if (event === 'prompt') await promptHook(input);
        else if (event === 'stop') await stopHook(input);
      } catch (e) {
        if (process.env.BASELINE_HOOK_DEBUG) console.error(e instanceof TargetError || e instanceof BaselineError || e instanceof ResolveError ? e.message : e);
      }
      process.exit(0);
    });
}
