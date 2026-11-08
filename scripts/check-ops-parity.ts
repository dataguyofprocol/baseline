// The agent surface is one list, OPERATIONS (src/ops/index.ts). This fails when
//   - an op has no `baseline agent` command, or `baseline agent` has a command that is no op
//     (read from the real CLI's --help, so a wiring mistake shows);
//   - a generated command lacks an argument or flag for an input field, or a field can't be a flag;
//   - an op is not an MCP tool of `baseline mcp` with the same description, an input schema with
//     exactly its fields, an output schema, and annotations from its effect (asked over MCP);
//   - the block `baseline connect` writes misses an op, isn't idempotent, or leaves a stale block;
//   - an op module reaches past the Baseline client (store, database, server, process, console);
//   - the "Agent loop" block in skills/baseline/SKILL.md, or the hand-off brief's {{tracking}} text
//     (src/core/tracking.ts), differs from the one generated from OPERATIONS. `--write`
//     regenerates them instead (npm run gen:skill).
//
//   npx tsx scripts/check-ops-parity.ts [--write]
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { OPERATIONS } from '../src/ops/index.js';
import { cliVerb, fieldsOf, usageOf, type AnyOperation } from '../src/ops/operation.js';
import { mountOperations } from '../src/cli/ops.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { agentBlock, BLOCK_END, BLOCK_START, handoffTracking } from '../src/ops/guide.js';
import { createMcpServer } from '../src/mcp/server.js';
import { HARNESSES, planConnect, type FileEdit } from '../src/connect/plan.js';

const root = join(import.meta.dirname, '..');
/** `baseline agent` commands that are settings, not agent operations */
const NOT_OPS = ['config', 'help'];
const problems: string[] = [];

// 1. the real CLI's command list
const help = spawnSync('npx', ['tsx', 'src/cli/index.ts', 'agent', '--help'], { cwd: root, encoding: 'utf8', env: { ...process.env, BASELINE_DB: '/nonexistent/never-opened.db' } });
if (help.status !== 0) problems.push(`\`baseline agent --help\` failed: ${help.stderr.trim()}`);
const listed = (help.stdout.split('Commands:')[1] ?? '').split('\n').map(l => /^ {2}(\S+)/.exec(l)?.[1]).filter((x): x is string => !!x);
const verbs = OPERATIONS.map(cliVerb);
for (const v of verbs) if (!listed.includes(v)) problems.push(`op ${v.replace(/-/g, '_')} has no \`baseline agent ${v}\` command`);
for (const c of listed) if (!verbs.includes(c) && !NOT_OPS.includes(c)) problems.push(`\`baseline agent ${c}\` is not an operation: add it to OPERATIONS, or to NOT_OPS here if it is a setting`);
if (new Set(OPERATIONS.map(o => o.name)).size !== OPERATIONS.length) problems.push('two operations share a name');

// 2. every input field is an argument or a flag of its generated command
const agent = new Command('agent');
mountOperations(agent, async () => { throw new Error('not run'); });
for (const op of OPERATIONS as readonly AnyOperation[]) {
  let fields;
  try { fields = fieldsOf(op); } catch (e) { problems.push((e as Error).message); continue; }
  const cmd = agent.commands.find(c => c.name() === cliVerb(op));
  if (!cmd) continue;
  const args = cmd.registeredArguments.map(a => a.name());
  const flags = cmd.options.map(o => o.long);
  for (const p of op.positional ?? []) if (!fields.some(f => f.name === p)) problems.push(`${op.name}: positional "${p}" is not an input field`);
  for (const f of fields) {
    const isArg = (op.positional ?? []).includes(f.name);
    if (isArg ? !args.includes(f.name) : !flags.includes(f.flag)) problems.push(`${op.name}: \`baseline agent ${cliVerb(op)}\` has no ${isArg ? `<${f.name}> argument` : f.flag} for input field ${f.name}`);
  }
  if (cmd.description() !== op.description) problems.push(`${op.name}: the command's help differs from the op's description`);
  if (!flags.includes('--json')) problems.push(`${op.name}: no --json`);
}

// 3. op bodies reach Baseline only: no store, database or server, and no process state (stdout is MCP's protocol)
for (const f of readdirSync(join(root, 'src/ops')).filter(f => f.endsWith('.ts'))) {
  const text = readFileSync(join(root, 'src/ops', f), 'utf8');
  if (/from '\.\.\/(server\/[^']+|core\/(store|db|work))\.js'/.test(text)) problems.push(`src/ops/${f} imports the server, the store or the database; operations go through the Baseline client`);
  if (/\bprocess\.|console\./.test(text)) problems.push(`src/ops/${f} touches process or console; the front door (CLI or MCP) passes what an op needs in its context`);
}

// 4. the skill's agent loop, generated
const START = '<!-- agent-loop:start — generated from src/ops/index.ts by `npm run gen:skill`; edit the operations, not this block -->';
const END = '<!-- agent-loop:end -->';
const block = [
  START,
  '## Agent loop (your work on an issue, as your agent identity)',
  '',
  'Each command is one agent operation; an MCP client gets the same operations as tools, with the same descriptions, input and `--json` output. Set `BASELINE_AS` to your agent user (e.g. `"Claude Code"`) so every write shows as "Claude Code via <person>"; set `BASELINE_SESSION` only to keep two parallel sessions on one issue apart. Every write prints an `op_id` (or null when nothing changed); repeating a call is safe.',
  '',
  ...OPERATIONS.flatMap(op => [`### \`${op.name}\` (${op.effect.kind})`, '', '```bash', usageOf(op as AnyOperation), '```', '', op.description, '']),
  END,
].join('\n');
const skillPath = join(root, 'skills/baseline/SKILL.md');
const skill = readFileSync(skillPath, 'utf8');
const at = skill.indexOf(START.slice(0, 26)), end = skill.indexOf(END);
if (at < 0 || end < at) problems.push('skills/baseline/SKILL.md has no agent-loop block: add the start and end markers where it belongs, then run `npm run gen:skill`');
else {
  const current = skill.slice(at, end + END.length);
  if (current !== block) {
    if (process.argv.includes('--write')) { writeFileSync(skillPath, skill.slice(0, at) + block + skill.slice(end + END.length)); console.log('✓ regenerated the agent-loop block in skills/baseline/SKILL.md'); }
    else problems.push('the agent-loop block in skills/baseline/SKILL.md is stale: run `npm run gen:skill`');
  }
}

// 5. the hand-off brief's {{tracking}} text, generated (core runs in the browser too, so it can't import the registry)
const trackingPath = join(root, 'src/core/tracking.ts');
const tracking = [
  '// Generated from src/ops/index.ts by `npm run gen:skill`; edit the operations (or src/ops/guide.ts), not this file.',
  '/** the hand-off brief\'s {{tracking}}: how the agent keeps the issue current; {{key}} is the issue key */',
  `export const HANDOFF_TRACKING = ${JSON.stringify(handoffTracking())};`,
  '',
].join('\n');
let trackingNow = '';
try { trackingNow = readFileSync(trackingPath, 'utf8'); } catch { /* absent: written below, or reported */ }
if (trackingNow !== tracking) {
  if (process.argv.includes('--write')) { writeFileSync(trackingPath, tracking); console.log('✓ regenerated src/core/tracking.ts'); }
  else problems.push('src/core/tracking.ts (the hand-off {{tracking}} text) is stale: run `npm run gen:skill`');
}

// 6. every op is a tool of the real MCP server, asked over the protocol
{
  const server = createMcpServer({ connect: async () => { throw new Error('not run'); }, as: undefined, session: undefined });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'parity-check', version: '0' });
  await client.connect(b);
  const { tools } = await client.listTools();
  if (tools.map(t => t.name).join() !== OPERATIONS.map(o => o.name).join()) problems.push(`MCP tools/list is ${tools.map(t => t.name).join(', ')}; the operations are ${OPERATIONS.map(o => o.name).join(', ')}`);
  for (const op of OPERATIONS as readonly AnyOperation[]) {
    const t = tools.find(x => x.name === op.name);
    if (!t) continue;
    if (t.description !== op.description) problems.push(`${op.name}: the MCP tool's description differs from the op's`);
    const props = Object.keys(t.inputSchema.properties ?? {}).sort().join();
    let fields: ReturnType<typeof fieldsOf> = [];
    try { fields = fieldsOf(op); } catch { /* reported in 2 */ }
    if (props !== fields.map(f => f.name).sort().join()) problems.push(`${op.name}: the MCP input schema has ${props}; the op's fields are ${fields.map(f => f.name).sort().join()}`);
    const required = [...(t.inputSchema.required ?? [])].sort().join();
    if (required !== fields.filter(f => f.required).map(f => f.name).sort().join()) problems.push(`${op.name}: the MCP input schema requires ${required || 'nothing'}, the op ${fields.filter(f => f.required).map(f => f.name).join(',') || 'nothing'}`);
    const outProps = Object.keys(t.outputSchema?.properties ?? {}).sort().join();
    if (outProps !== Object.keys(op.output.shape).sort().join()) problems.push(`${op.name}: the MCP output schema has ${outProps || 'no fields'}; the op's output has ${Object.keys(op.output.shape).sort().join()}`);
    const an = t.annotations ?? {};
    if (an.readOnlyHint !== (op.effect.kind === 'read') || an.destructiveHint !== (op.effect.kind === 'revert') || an.idempotentHint !== true || an.title !== op.title) problems.push(`${op.name}: MCP annotations ${JSON.stringify(an)} don't follow from effect ${op.effect.kind}`);
  }
  if (!client.getInstructions()?.includes(agentBlock().slice(BLOCK_START.length + 1, -BLOCK_END.length - 1))) problems.push('the MCP server\'s instructions are not the generated agent guide');
  await client.close();
}

// 7. the block `baseline connect` writes: every op, idempotent, and a stale block is replaced
for (const harness of HARNESSES) {
  const files = new Map<string, string>();
  const server = { command: 'baseline', args: ['mcp'] };
  const apply = (edits: FileEdit[]) => { for (const e of edits) files.set(e.path, e.after); return edits.filter(e => e.after !== e.before); };
  apply(planConnect(harness, server, p => files.get(p) ?? null));
  const again = apply(planConnect(harness, server, p => files.get(p) ?? null));
  if (again.length) problems.push(`baseline connect ${harness} run twice changes ${again.map(e => e.path).join(', ')}`);
  const doc = harness === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
  const text = files.get(doc) ?? '';
  for (const op of OPERATIONS) if (!text.includes(`\`${op.name}\``) || !text.includes(`baseline agent ${cliVerb(op)}`)) problems.push(`the connect block in ${doc} doesn't name ${op.name} and \`baseline agent ${cliVerb(op)}\``);
  files.set(doc, `# notes\n\n${BLOCK_START}\nan older block\n${BLOCK_END}\n\nmore notes\n`);
  apply(planConnect(harness, server, p => files.get(p) ?? null));
  if (files.get(doc) !== `# notes\n\n${agentBlock()}\n\nmore notes\n`) problems.push(`baseline connect ${harness} doesn't replace a stale block in ${doc} in place`);
}

if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
console.log(`✓ ${OPERATIONS.length} operations, each a \`baseline agent\` command with every input field (${listed.filter(c => NOT_OPS.includes(c)).join(', ')} are settings); an MCP tool with the same schema and annotations; the skill's agent loop, the hand-off {{tracking}} and the connect block are current`);
