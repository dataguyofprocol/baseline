// `baseline connect claude|codex|pi [--dir <repo>] [--team <key>] [--remote] [--dry-run]`: one
// command, after which the repo's coding agent keeps Baseline current. The plan is src/connect/plan.ts; this file
// reads, prints and writes it.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { connectAgent, describeTarget, targetFor, TargetError } from '../client/index.js';
import { ConnectError, HARNESS_NAME, HARNESSES, planConnect, REPO_CONFIG_PATH, SERVER_NAME, TOKEN_ENV, type FileEdit, type Harness, type McpServerEntry } from '../connect/plan.js';
import { readRepoConfig } from './repo.js';

interface ConnectFlags { dir?: string; db?: string; team?: string; remote?: boolean; dryRun?: boolean }

const onPath = (name: string) => (process.env.PATH ?? '').split(delimiter).some(d => {
  try { accessSync(join(d, name), constants.X_OK); return true; } catch { return false; }
});

/** this very install, by absolute path: only ever printed, for a config that belongs to one person */
function selfCommand(): string[] {
  const entry = realpathSync(process.argv[1]!);
  if (entry.endsWith('.ts')) return [join(resolve(dirname(entry), '../..'), 'node_modules/.bin/tsx'), entry, 'mcp'];
  return [process.execPath, entry, 'mcp'];
}

/** the agent's own per-person way to add a server, outside the repo's shared files; it carries
 *  BASELINE_DB along, so a server added from a shell on a scratch database uses that database */
const dbEnv = (flag: string) => process.env.BASELINE_DB?.trim() ? ` ${flag} BASELINE_DB=${JSON.stringify(resolve(process.env.BASELINE_DB.trim()))}` : '';
const PERSONAL_ADD: Record<Harness, (cmd: string) => string> = {
  claude: cmd => `claude mcp add --scope local${dbEnv('-e')} ${SERVER_NAME} -- ${cmd}   (only you, only this repo; kept in ~/.claude.json)`,
  codex: cmd => `codex mcp add${dbEnv('--env')} ${SERVER_NAME} -- ${cmd}   (only you, every repo; kept in ~/.codex/config.toml)`,
  pi: cmd => `pi mcp add ${SERVER_NAME} -- ${cmd}   (only you, every repo; kept in ~/.pi/agent/mcp.json)`,
};

/** The team the repo maps to: --team; else the one already in .baseline.json; else, when this CLI is
 *  connected, the person's only team, or one they pick at a terminal. undefined: leave it unmapped. */
async function teamFor(flags: ConnectFlags, dir: string): Promise<{ team?: string; note?: string }> {
  let teams: Array<{ key: string; name: string; mine: boolean }> | undefined;
  try {
    const bl = await connectAgent({});
    const snap = await bl.snapshot(['teams', 'currentUser']);
    teams = snap.teams.map(t => ({ key: t.key, name: t.name, mine: t.memberIds.includes(snap.currentUser.id) }));
  } catch { /* not connected or unreachable: take --team as given */ }
  if (flags.team) {
    const t = teams?.find(x => x.key.toLowerCase() === flags.team!.toLowerCase());
    if (teams && !t) return fail(`Unknown team "${flags.team}". Valid keys: ${teams.map(x => x.key).join(', ')}`);
    return { team: t?.key ?? flags.team.toUpperCase() };
  }
  const already = readRepoConfig(dir).team;
  if (already) return { team: already };
  if (!teams?.length) return { note: `This repo isn't mapped to a team. Run connect again with --team <KEY> (it goes in ${REPO_CONFIG_PATH}).` };
  const mine = teams.filter(t => t.mine);
  const pool = mine.length ? mine : teams;
  if (pool.length === 1) return { team: pool[0]!.key };
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Which team's work is in this repo? ${pool.map(t => `${t.key} (${t.name})`).join(', ')}: `)).trim();
    rl.close();
    const t = pool.find(x => x.key.toLowerCase() === answer.toLowerCase());
    if (t) return { team: t.key };
  }
  return { note: `This repo isn't mapped to a team. Run connect again with --team <KEY>, one of ${pool.map(t => t.key).join(', ')} (it goes in ${REPO_CONFIG_PATH}).` };
}

const SHARED_FILE: Record<Harness, string> = { claude: '.mcp.json', codex: '.codex/config.toml', pi: '.pi/mcp.json' };

/** --dir, else the git repo the shell is in, else the shell's directory */
function repoDir(flag: string | undefined): string {
  if (flag) return resolve(flag.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return git.status === 0 ? git.stdout.trim() : process.cwd();
}

/** removed and added lines, enough to see what a dry run would change */
function diff(before: string, after: string): string {
  const a = before.split('\n'), b = after.split('\n');
  const inA = new Set(a), inB = new Set(b);
  return [...a.filter(l => !inB.has(l)).map(l => `    - ${l}`), ...b.filter(l => !inA.has(l)).map(l => `    + ${l}`)].join('\n');
}

const fail = (message: string): never => { console.error(`error: ${message}`); process.exit(1); };

/** the server entry to write, or a refusal that says what to do instead */
function serverEntry(harness: Harness, flags: ConnectFlags): McpServerEntry {
  const shared = SHARED_FILE[harness];
  if (flags.db) {
    fail(`connect doesn't put a database path in ${shared}: that file is usually committed, and the path is only true on this machine. ` +
      '`baseline mcp` uses the same database or server as the rest of the CLI: set BASELINE_DB in the environment that starts the agent, or run `baseline login`.');
  }
  if (flags.remote) {
    let target;
    try { target = targetFor({}); } catch (e) { return fail(e instanceof TargetError ? e.message : String(e)); }
    if (target.kind !== 'remote') {
      return fail(`--remote connects the agent to a Baseline server, and this CLI uses a local database (${describeTarget(target)}). Run \`baseline login --server <url>\` first, or set BASELINE_URL and BASELINE_TOKEN.`);
    }
    return { transport: 'http', url: new URL('/mcp', target.url).toString() };
  }
  if (!onPath('baseline')) {
    // already logged in to a server: that's the one-line fix, so say only that
    let loggedIn: string | null = null;
    try { const t = targetFor({}); if (t.kind === 'remote') loggedIn = t.url.origin; } catch { /* not logged in */ }
    if (loggedIn) fail(`\`baseline\` is not on your PATH, so the agent couldn't start \`baseline mcp\`. You're logged in to ${loggedIn}: run \`baseline connect ${harness} --remote\` to connect over its /mcp URL instead, or install the CLI globally and run connect again.`);
    fail(`\`baseline\` is not on your PATH. connect writes \`baseline mcp\` to ${shared}, which is usually committed, so it never writes a path from this machine there.\n` +
      'Install the CLI, then run connect again: in the Baseline checkout, `npm run build && npm install -g .`\n' +
      `Or add the server for yourself only, outside the repo:\n  ${PERSONAL_ADD[harness](selfCommand().join(' '))}\n` +
      `Or connect to a Baseline server instead: \`baseline login --server <url>\`, then \`baseline connect ${harness} --remote\`.`);
  }
  return { transport: 'stdio' };
}

export function mountConnectCommand(program: Command): void {
  program.command('connect')
    .argument('<agent>', HARNESSES.join('|'))
    .description('Connect a repo\'s coding agent to Baseline in one step: its MCP config gets the baseline server, AGENTS.md / CLAUDE.md a block telling it to keep its issues current, and for Claude Code the hooks and an allow-list in .claude/settings.json. Writes nothing machine-specific or secret, so commit the files and every teammate is connected. Running it again changes nothing.')
    .option('--dir <repo>', 'the repo to connect (default: the git repo you are in)')
    .option('--team <key>', `the team whose work is in this repo, written to ${REPO_CONFIG_PATH} (default: your only team, or ask)`)
    .option('--remote', `use the Baseline server you are logged in to: the agent connects to its /mcp URL and reads the API key from $${TOKEN_ENV}`, false)
    .option('--db <path>', 'refused: set BASELINE_DB in the agent\'s environment instead, so no machine path lands in a shared file')
    .option('--dry-run', 'print what would change, and change nothing', false)
    .action(async (agent: string, flags: ConnectFlags) => {
      const harness = HARNESSES.find(h => h === agent.toLowerCase()) as Harness | undefined;
      if (!harness) return fail(`Unknown agent "${agent}". Valid agents: ${HARNESSES.join(', ')}`);
      const dir = repoDir(flags.dir);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return fail(`Directory not found: ${dir}`);

      const server = serverEntry(harness, flags);
      const { team, note } = await teamFor(flags, dir);
      let edits: FileEdit[];
      try {
        edits = planConnect(harness, server, path => existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : null, { team });
      } catch (e) {
        if (e instanceof ConnectError) return fail(e.message);
        throw e;
      }
      const changes = edits.filter(e => e.after !== e.before);
      const name = HARNESS_NAME[harness];
      if (!changes.length) console.log(`${name} is already connected to Baseline in ${dir}; nothing changed.`);
      else {
        console.log(`${flags.dryRun ? 'Would connect' : 'Connected'} ${name} to Baseline in ${dir}:`);
        for (const e of changes) {
          const verb = e.before === null ? (flags.dryRun ? 'would create' : 'created') : (flags.dryRun ? 'would update' : 'updated');
          console.log(`  ${verb} ${e.path}: ${e.what}`);
          if (flags.dryRun) console.log(e.before === null ? e.after.trimEnd().split('\n').map(l => `    + ${l}`).join('\n') : diff(e.before, e.after));
          else {
            mkdirSync(dirname(join(dir, e.path)), { recursive: true });
            writeFileSync(join(dir, e.path), e.after);
          }
        }
        for (const e of edits.filter(x => x.after === x.before)) console.log(`  unchanged ${e.path}`);
      }
      if (server.transport === 'http') {
        const origin = new URL(server.url).origin;
        console.log(`${name} reads the API key from $${TOKEN_ENV}; it is not in any file. Set it, with BASELINE_URL=${origin} so \`baseline agent\` commands reach the same server, in the shell that starts ${name}. A key made for agents in Settings › Account & API keys can be revoked on its own.`);
      }
      if (note) console.log(note);
      if (harness === 'claude') console.log(`Commit .mcp.json, .claude/settings.json, ${REPO_CONFIG_PATH} and CLAUDE.md so teammates get the same setup. Start Claude Code in ${dir} (or run /mcp in an open session) to load the baseline tools; \`baseline doctor\` checks it all.`);
      if (harness === 'codex') console.log(`Codex reads .codex/config.toml in trusted projects; it asks to trust ${dir} the first time you open it.`);
      if (harness === 'pi') console.log(`pi reads .pi/mcp.json in trusted projects; it asks to trust ${dir} the first time you start it there (or start it with --approve).`);
      process.exit(0);
    });
}
