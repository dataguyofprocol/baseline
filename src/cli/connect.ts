// `baseline connect claude|codex|pi [--dir <repo>] [--db <path>] [--dry-run]`: one command, after
// which the repo's coding agent keeps Baseline current. The plan is src/connect/plan.ts; this file
// reads, prints and writes it.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { ConnectError, HARNESS_NAME, HARNESSES, planConnect, type FileEdit, type Harness, type ServerCommand } from '../connect/plan.js';

interface ConnectFlags { dir?: string; db?: string; dryRun?: boolean }

const onPath = (name: string) => (process.env.PATH ?? '').split(delimiter).some(d => {
  try { accessSync(join(d, name), constants.X_OK); return true; } catch { return false; }
});

/** How the harness starts this Baseline: `baseline` when it is on PATH, else this very install by absolute path. */
function selfCommand(): { command: string; args: string[] } {
  if (onPath('baseline')) return { command: 'baseline', args: [] };
  const entry = realpathSync(process.argv[1]!);
  if (entry.endsWith('.ts')) {
    // running from source (npm run cli): the harness starts it the same way
    const root = resolve(dirname(entry), '../..');
    return { command: join(root, 'node_modules/.bin/tsx'), args: [entry] };
  }
  return { command: process.execPath, args: [entry] };
}

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

export function mountConnectCommand(program: Command): void {
  program.command('connect')
    .argument('<agent>', HARNESSES.join('|'))
    .description('Connect a repo\'s coding agent to Baseline in one step: Claude Code and Codex get the baseline MCP server; every agent gets an AGENTS.md / CLAUDE.md block telling it to keep its issues current. Running it again changes nothing.')
    .option('--dir <repo>', 'the repo to connect (default: the git repo you are in)')
    .option('--db <path>', 'a database for the MCP server to use instead of the default target (BASELINE_DB, `baseline login`, or ~/.baseline)')
    .option('--dry-run', 'print what would change, and change nothing', false)
    .action((agent: string, flags: ConnectFlags) => {
      const harness = HARNESSES.find(h => h === agent.toLowerCase()) as Harness | undefined;
      if (!harness) { console.error(`error: Unknown agent "${agent}" — valid agents: ${HARNESSES.join(', ')}`); process.exit(1); }
      const dir = repoDir(flags.dir);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.error(`error: Directory not found: ${dir}`); process.exit(1); }

      const self = selfCommand();
      const server: ServerCommand = { command: self.command, args: [...self.args, 'mcp', ...(flags.db ? ['--db', resolve(flags.db)] : [])] };
      let edits: FileEdit[];
      try {
        edits = planConnect(harness, server, path => existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : null);
      } catch (e) {
        if (e instanceof ConnectError) { console.error(`error: ${e.message}`); process.exit(1); }
        throw e;
      }
      const changes = edits.filter(e => e.after !== e.before);
      const name = HARNESS_NAME[harness];
      if (!changes.length) {
        console.log(`${name} is already connected to Baseline in ${dir}; nothing changed.`);
        process.exit(0);
      }

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
      if (harness === 'claude') console.log(`Start Claude Code in ${dir} (or run /mcp in an open session) to load the baseline tools.`);
      if (harness === 'codex') console.log(`Codex reads .codex/config.toml in trusted projects; it asks to trust ${dir} the first time you open it.`);
      if (harness === 'pi' && flags.db) console.log('pi has no MCP server to pass --db to: its `baseline agent` commands use BASELINE_DB or `baseline login`.');
      if (harness === 'pi' && self.command !== 'baseline') console.log(`pi runs \`baseline agent …\` commands, and \`baseline\` is not on your PATH: run \`npm link\` in the Baseline checkout.`);
      process.exit(0);
    });
}
