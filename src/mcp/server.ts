import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { agentTarget, connectAgent, describeTarget, TargetError, type Baseline } from '../client/index.js';
import { OPERATIONS } from '../ops/index.js';
import { agentGuide } from '../ops/guide.js';
import { agentActor, sessionFrom } from '../ops/identity.js';
import { annotationsOf, OP_ALIASES, OpError, runOp, toOpError, type Actor, type AnyOperation, type LocalRepo, type OpContext } from '../ops/operation.js';
import { localRepo } from '../cli/repo.js';

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Tool['inputSchema'] {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { io }) as Record<string, unknown>;
  return rest as Tool['inputSchema'];
}

export function toolOf(op: AnyOperation): Tool {
  return {
    name: op.name,
    title: op.title,
    description: op.description,
    inputSchema: jsonSchema(op.input, 'input'),
    outputSchema: jsonSchema(op.output, 'output'),
    annotations: annotationsOf(op),
  };
}

export const SERVER_INFO = { name: 'baseline', version: '0.1.0' } as const;

export interface McpSessionInput {
  connect: () => Promise<Baseline>;
  as: string | undefined;
  session: string | undefined;
  local?: LocalRepo;
}

const errorResult = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

export function createMcpServer(input: McpSessionInput): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: agentGuide() });
  const tools = OPERATIONS.map(op => toolOf(op as AnyOperation));

  let bl: Promise<Baseline> | undefined;
  let actor: Promise<Actor> | undefined;
  const baseline = () => bl ??= input.connect().catch(e => { bl = undefined; throw e; });
  const agent = () => actor ??= baseline().then(b => agentActor(b, input.as, server.getClientVersion()?.name)).catch(e => { actor = undefined; throw e; });

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const name = OP_ALIASES[req.params.name] ?? req.params.name;
    const op = OPERATIONS.find(o => o.name === name) as AnyOperation | undefined;
    if (!op) return errorResult(`Unknown tool "${req.params.name}". Valid tools: ${OPERATIONS.map(o => o.name).join(', ')}.`);
    try {
      const ctx: OpContext = {
        bl: await baseline(),
        actor: op.effect.kind === 'read' ? { kind: 'person' } : await agent(),
        session: sessionFrom(input.session),
        local: input.local,
      };
      const out = await runOp(op, ctx, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: op.text(out, 'mcp') }], structuredContent: out };
    } catch (e) {
      const known = toOpError(e);
      if (known) return errorResult(known.message);
      console.error(e);
      return errorResult(`Baseline failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return server;
}

export async function serveStdio(flags: { db?: string }): Promise<void> {
  // anything that would print to stdout (a library's log line) would corrupt the protocol stream
  console.log = console.info = console.debug = console.warn = (...args: unknown[]) => console.error(...args);
  const server = createMcpServer({
    connect: async () => {
      const b = await connectAgent(flags);
      console.error(`[baseline mcp] ${describeTarget(b.target)}`);
      return b;
    },
    as: process.env.BASELINE_AS,
    session: process.env.BASELINE_SESSION,
    local: localRepo(),
  });
  try { sessionFrom(process.env.BASELINE_SESSION); } catch (e) { if (e instanceof OpError) console.error(`[baseline mcp] ${e.message}`); }
  try { agentTarget(flags); } catch (e) { if (e instanceof TargetError) console.error(`[baseline mcp] ${e.message}`); }
  await server.connect(new StdioServerTransport());
}
