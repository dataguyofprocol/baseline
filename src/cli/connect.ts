// `baseline connect claude|codex|pi [--dir <repo>] [--remote] [--dry-run]`: one command, after
// which the repo's coding agent keeps Baseline current. The plan is src/connect/plan.ts; this file
// reads, prints and writes it.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { describeTarget, targetFor, TargetError } from '../client/index.js';
import { ConnectError, HARNESS_NAME, HARNESSES, planConnect, SERVER_NAME, TOKEN_ENV, type FileEdit, type Harness, type McpServerEntry } from '../connect/plan.js';

interface ConnectFlags { dir?: string; db?: string; remote?: boolean; dryRun?: boolean }

const onPath = (name: string) => (process.env.PATH ?? '').split(delimiter).some(d => {
  try { accessSync(join(d, name), constants.X_OK); return true; } catch { return false; }
});

/** this very install, by absolute path: only ever printed, for a config that belongs to one person */
function selfCommand(): string[] {
  const entry = realpathSync(process.argv[1]!);
  if (entry.endsWith('.ts')) return [join(resolve(dirname(entry), '../..'), 'node_modules/.bin/tsx'), entry, 'mcp'];
  return [process.execPath, entry, 'mcp'];
}

/** the agent's own per-person way to add a server, outside the repo's shared files */
const PERSONAL_ADD: Record<Harness, (cmd: string) => string> = {
  claude: cmd => `claude mcp add --scope local ${SERVER_NAME} -- ${cmd}   (only you, only this repo; kept in ~/.claude.json)`,
  codex: cmd => `codex mcp add ${SERVER_NAME} -- ${cmd}   (only you, every repo; kept in ~/.codex/config.toml)`,
  pi: cmd => `pi mcp add ${SERVER_NAME} -- ${cmd}   (only you, every repo; kept in ~/.pi/agent/mcp.json)`,
};

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
    .description('Connect a repo\'s coding agent to Baseline in one step: its MCP config gets the baseline server, and AGENTS.md / CLAUDE.md a block telling it to keep its issues current. Writes nothing machine-specific or secret, so the files can be committed. Running it again changes nothing.')
    .option('--dir <repo>', 'the repo to connect (default: the git repo you are in)')
    .option('--remote', `use the Baseline server you are logged in to: the agent connects to its /mcp URL and reads the API key from $${TOKEN_ENV}`, false)
    .option('--db <path>', 'refused: set BASELINE_DB in the agent\'s environment instead, so no machine path lands in a shared file')
    .option('--dry-run', 'print what would change, and change nothing', false)
    .action((agent: string, flags: ConnectFlags) => {
      const harness = HARNESSES.find(h => h === agent.toLowerCase()) as Harness | undefined;
      if (!harness) return fail(`Unknown agent "${agent}". Valid agents: ${HARNESSES.join(', ')}`);
      const dir = repoDir(flags.dir);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return fail(`Directory not found: ${dir}`);

      const server = serverEntry(harness, flags);
      let edits: FileEdit[];
      try {
        edits = planConnect(harness, server, path => existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : null);
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
        console.log(`${name} reads the API key from $${TOKEN_ENV}; it is not in any file. Set it, with BASELINE_URL=${origin} so \`baseline agent\` commands reach the same server, in the shell that starts ${name}. A key made for agents in Settings › Security & access can be revoked on its own.`);
      }
      if (harness === 'claude') console.log(`Start Claude Code in ${dir} (or run /mcp in an open session) to load the baseline tools.`);
      if (harness === 'codex') console.log(`Codex reads .codex/config.toml in trusted projects; it asks to trust ${dir} the first time you open it.`);
      if (harness === 'pi') console.log(`pi reads .pi/mcp.json in trusted projects; it asks to trust ${dir} the first time you start it there (or start it with --approve).`);
      process.exit(0);
    });
}
