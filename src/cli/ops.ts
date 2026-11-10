// `baseline agent <verb>`, generated from OPERATIONS: pi (no MCP) gets exactly the tools Claude Code
// and Codex get, with the same descriptions, validation, errors and JSON.
import { Command } from 'commander';
import { OPERATIONS } from '../ops/index.js';
import { cliVerb, fieldsOf, OP_ALIASES, OpError, placeholderOf, runOp, type AnyOperation, type Field, type OpContext } from '../ops/operation.js';

export interface OpFlags { db?: string; as?: string; json?: boolean }

let stdin: Promise<string> | undefined;
/** a text value of "-" is read from stdin (a long summary through Bash without quoting trouble) */
const readStdin = () => stdin ??= (async () => {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
})();

async function valueOf(f: Field, raw: unknown): Promise<unknown> {
  if (raw === undefined) return undefined;
  if (f.kind === 'number') return Number(raw);
  if (f.kind === 'string' && raw === '-') return readStdin();
  return raw;
}

function command(op: AnyOperation, context: (flags: OpFlags) => Promise<OpContext>, verb = cliVerb(op)): Command {
  const pos = op.positional ?? [];
  const fields = fieldsOf(op);
  const cmd = new Command(verb).description(op.description).summary(op.description.split('. ')[0]! + '.');
  for (const name of pos) {
    const f = fields.find(x => x.name === name)!;
    cmd.argument(f.required ? `<${name}>` : `[${name}]`, f.description);
  }
  for (const f of fields.filter(x => !pos.includes(x.name))) {
    const value = f.kind === 'boolean' ? '' : ` ${placeholderOf(f)}`;
    const text = f.kind === 'string' ? `${f.description} ("-" reads stdin)` : f.description;
    if (f.required) cmd.requiredOption(`${f.flag}${value}`, text); else cmd.option(`${f.flag}${value}`, text);
  }
  cmd.option('--json', 'print the result as JSON (the same object an MCP client receives)', false)
    .option('--as <agent>', 'the agent user to write as (default: BASELINE_AS, else Agent)')
    .option('--db <path>', 'database path');
  cmd.action(async (...args: unknown[]) => {
    const flags = args[pos.length] as Record<string, unknown> & OpFlags;
    const input: Record<string, unknown> = {};
    for (const f of fields) {
      const i = pos.indexOf(f.name);
      // commander camel-cases --pr-url into prUrl
      const v = await valueOf(f, i >= 0 ? args[i] : flags[f.name.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())]);
      if (v !== undefined) input[f.name] = v;
    }
    try {
      const out = await runOp(op, await context(flags), input);
      console.log(flags.json ? JSON.stringify(out, null, 2) : op.text(out, 'cli'));
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  });
  return cmd;
}

/** one command per operation under `parent` (the CLI's `agent` command) */
export function mountOperations(parent: Command, context: (flags: OpFlags) => Promise<OpContext>): void {
  for (const op of OPERATIONS) parent.addCommand(command(op, context));
  // retired verbs keep working for older CLAUDE.md / AGENTS.md blocks, unlisted
  for (const [old, now] of Object.entries(OP_ALIASES)) {
    parent.addCommand(command(OPERATIONS.find(o => o.name === now)!, context, old.replace(/_/g, '-')), { hidden: true });
  }
}
