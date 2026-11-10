import { agentBlock, BLOCK_END, BLOCK_START, claudeBlock } from '../ops/guide.js';
import { OPERATIONS } from '../ops/index.js';

export const HARNESSES = ['claude', 'codex', 'pi'] as const;
export type Harness = (typeof HARNESSES)[number];

export const HARNESS_NAME: Record<Harness, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'pi' };

export type McpServerEntry = { transport: 'stdio' } | { transport: 'http'; url: string };

export const STDIO_COMMAND = { command: 'baseline', args: ['mcp'] } as const;
export const TOKEN_ENV = 'BASELINE_TOKEN';
const FORWARDED_ENV = ['BASELINE_DB', 'BASELINE_URL', 'BASELINE_TOKEN', 'BASELINE_AS', 'BASELINE_SESSION'] as const;

export interface FileEdit {
  path: string;
  before: string | null;
  after: string;
  what: string;
}

export class ConnectError extends Error {}

export const SERVER_NAME = 'baseline';

const tool = (name: string) => `mcp__${SERVER_NAME}__${name}`;
const REVERSIBLE = ['start_issue', 'post_progress', 'create_sub_issues', 'propose_issue', 'propose_followup'];
export const ALLOWED_TOOLS = OPERATIONS.filter(o => o.effect.kind === 'read' || REVERSIBLE.includes(o.name)).map(o => tool(o.name));

export const CLAUDE_HOOKS = [
  ['SessionStart', 'baseline hook session-start'],
  ['UserPromptSubmit', 'baseline hook prompt'],
  ['Stop', 'baseline hook stop'],
] as const;
export const REPO_CONFIG_PATH = '.baseline.json';

export interface ConnectOptions {
  team?: string;
}

export function planConnect(harness: Harness, server: McpServerEntry, read: (path: string) => string | null, opts: ConnectOptions = {}): FileEdit[] {
  const edit = (path: string, what: string, change: (before: string | null) => string): FileEdit => {
    const before = read(path);
    return { path, before, after: change(before), what };
  };
  const block = (path: string) => edit(path, 'the Baseline tracking block, generated from the agent operations', b => upsertBlock(b, path));
  const team = opts.team?.trim().toUpperCase();
  const repoConfig = team ? [edit(REPO_CONFIG_PATH, `maps this repo to the ${team} team, for the hooks and find_issues`, b => mergeJson(b, REPO_CONFIG_PATH, o => setKey(o, ['team'], team)))] : [];
  const stdio = { command: STDIO_COMMAND.command, args: [...STDIO_COMMAND.args] };
  const bearer = { Authorization: `Bearer \${${TOKEN_ENV}}` };
  const about = server.transport === 'stdio' ? `\`${[stdio.command, ...stdio.args].join(' ')}\`` : `${server.url}, with the API key from $${TOKEN_ENV}`;
  switch (harness) {
    case 'claude': return [
      edit('.mcp.json', `the ${SERVER_NAME} MCP server (${about})`, b => mergeJson(b, '.mcp.json', o => setKey(o, ['mcpServers', SERVER_NAME],
        server.transport === 'stdio' ? { type: 'stdio', ...stdio } : { type: 'http', url: server.url, headers: bearer }))),
      edit('.claude/settings.json', `enables the ${SERVER_NAME} server; runs the Baseline hooks; ${ALLOWED_TOOLS.map(t => t.split('__')[2]).join(', ')} run without asking (the rest ask)`,
        b => mergeJson(b, '.claude/settings.json', o => addHooks(addToList(addToList(o, ['enabledMcpjsonServers'], [SERVER_NAME]), ['permissions', 'allow'], ALLOWED_TOOLS)))),
      ...repoConfig,
      edit('CLAUDE.md', 'a short Baseline block (the MCP instructions and hooks carry the rest)', b => upsertBlock(b, 'CLAUDE.md', claudeBlock())),
    ];
    case 'codex': return [
      edit('.codex/config.toml', `the ${SERVER_NAME} MCP server (${about}); Codex asks before writes, not reads`, b => upsertTomlTable(b, `mcp_servers.${SERVER_NAME}`, [
        ...(server.transport === 'stdio'
          // Codex starts stdio servers with a minimal environment: forward (by name only) what picks Baseline's target and identity
          ? [`command = ${tomlString(stdio.command)}`, `args = [${stdio.args.map(tomlString).join(', ')}]`, `env_vars = [${FORWARDED_ENV.map(tomlString).join(', ')}]`]
          : [`url = ${tomlString(server.url)}`, `bearer_token_env_var = ${tomlString(TOKEN_ENV)}`]),
        'default_tools_approval_mode = "writes"',
      ])),
      ...repoConfig,
      block('AGENTS.md'),
    ];
    case 'pi': return [
      edit('.pi/mcp.json', `the ${SERVER_NAME} MCP server (${about}), its tools shown to the model directly`, b => mergeJson(b, '.pi/mcp.json', o => setKey(o, ['mcpServers', SERVER_NAME], {
        ...(server.transport === 'stdio' ? stdio : { url: server.url, headers: bearer }),
        exposure: 'direct',
        description: 'Baseline issue tracker: start, update and finish the issues you work on',
      }))),
      ...repoConfig,
      block('AGENTS.md'),
    ];
  }
}


export function upsertBlock(before: string | null, path: string, block = agentBlock()): string {
  if (before === null || !before.trim()) return `${block}\n`;
  const marker = BLOCK_START.slice(0, BLOCK_START.indexOf(' ('));
  const at = before.indexOf(marker), end = before.indexOf(BLOCK_END);
  if (at < 0 && end < 0) return `${before.replace(/\s*$/, '')}\n\n${block}\n`;
  if (at < 0 || end < at) throw new ConnectError(`${path} has a broken Baseline block (one of its markers is missing): fix or remove it, then run connect again`);
  return before.slice(0, at) + block + before.slice(end + BLOCK_END.length);
}


type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function mergeJson(before: string | null, path: string, change: (o: JsonObject) => JsonObject): string {
  let o: unknown = {};
  if (before !== null && before.trim()) {
    try { o = JSON.parse(before); } catch (e) { throw new ConnectError(`${path} isn't valid JSON (${(e as Error).message}): fix it, then run connect again`); }
    if (!isObject(o)) throw new ConnectError(`${path} isn't a JSON object: fix it, then run connect again`);
  }
  const after = change(structuredClone(o as JsonObject));
  if (before !== null && JSON.stringify(after) === JSON.stringify(o)) return before;
  return `${JSON.stringify(after, null, 2)}\n`;
}

function at(o: JsonObject, path: readonly string[], fileKey: string): JsonObject {
  let cur = o;
  for (const k of path) {
    if (cur[k] === undefined) cur[k] = {};
    const next = cur[k];
    if (!isObject(next)) throw new ConnectError(`"${path.join('.')}" in ${fileKey} isn't an object: fix it, then run connect again`);
    cur = next;
  }
  return cur;
}

function setKey(o: JsonObject, path: readonly string[], value: Json): JsonObject {
  const parent = at(o, path.slice(0, -1), path.join('.'));
  const key = path[path.length - 1]!;
  if (JSON.stringify(parent[key]) !== JSON.stringify(value)) parent[key] = value;
  return o;
}

function addHooks(o: JsonObject): JsonObject {
  const hooks = at(o, ['hooks'], 'hooks');
  for (const [event, command] of CLAUDE_HOOKS) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new ConnectError(`"hooks.${event}" in .claude/settings.json isn't a list: fix it, then run connect again`);
    if (JSON.stringify(groups).includes(JSON.stringify(command))) continue;
    hooks[event] = [...groups, { hooks: [{ type: 'command', command, timeout: 10 }] }];
  }
  return o;
}

function addToList(o: JsonObject, path: readonly string[], values: readonly string[]): JsonObject {
  const parent = at(o, path.slice(0, -1), path.join('.'));
  const key = path[path.length - 1]!;
  const list = parent[key] ?? [];
  if (!Array.isArray(list)) throw new ConnectError(`"${path.join('.')}" isn't a list: fix it, then run connect again`);
  parent[key] = [...list, ...values.filter(v => !list.includes(v))];
  return o;
}


const tomlString = (s: string) => JSON.stringify(s);

const tableHeader = (line: string): string | undefined => /^\s*\[\s*([^\][]+?)\s*\]\s*(#.*)?$/.exec(line)?.[1]?.replace(/"([^"]*)"/g, '$1');

export function upsertTomlTable(before: string | null, table: string, body: readonly string[]): string {
  const section = [`[${table}]`, ...body];
  const lines = before === null ? [] : before.replace(/\n$/, '').split('\n');
  const out: string[] = [];
  let inOurs = false, placed = false;
  for (const line of lines) {
    const header = tableHeader(line);
    if (header !== undefined) inOurs = header === table || header.startsWith(`${table}.`);
    if (!inOurs) { out.push(line); continue; }
    if (!placed) { out.push(...section, ''); placed = true; }
  }
  if (!placed) {
    while (out.length && !out[out.length - 1]!.trim()) out.pop();
    if (out.length) out.push('');
    out.push(...section);
  }
  while (out.length && !out[out.length - 1]!.trim()) out.pop();
  const after = `${out.join('\n')}\n`;
  return before !== null && after.trimEnd() === before.trimEnd() ? before : after;
}
