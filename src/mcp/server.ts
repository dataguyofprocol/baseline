// `baseline mcp`: the agent operations as MCP tools over stdio. A thin adapter: every tool is one
// entry of OPERATIONS, with its description, schemas and annotations, run through runOp like the
// `baseline agent` commands. There is no tool here that is not an op.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { connect, describeTarget, type Baseline } from '../client/index.js';
import { OPERATIONS } from '../ops/index.js';
import { agentGuide } from '../ops/guide.js';
import { actorForClient, sessionFrom } from '../ops/identity.js';
import { annotationsOf, OpError, runOp, toOpError, type Actor, type AnyOperation, type OpContext } from '../ops/operation.js';

/** JSON Schema for a tool: the shape the model fills in (input) or receives (output) */
function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Tool['inputSchema'] {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { io }) as Record<string, unknown>;
  return rest as Tool['inputSchema'];
}

/** the tools/list entry of one op; scripts/check-ops-parity.ts compares the live server against this */
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

/** What a session needs from its process: who the client said it is, and the environment's choices. */
export interface McpSessionInput {
  connect: () => Promise<Baseline>;
  /** BASELINE_AS */
  as: string | undefined;
  /** BASELINE_SESSION */
  session: string | undefined;
}

const errorResult = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

/**
 * One MCP server. The Baseline connection and the agent identity are made on the first tool call,
 * not at spawn: a target that can't be reached, or an agent user that can't be added, shows up as
 * a tool error the model can relay ("run `baseline login`"), not as a server that never started.
 */
export function createMcpServer(input: McpSessionInput): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: agentGuide() });
  const tools = OPERATIONS.map(op => toolOf(op as AnyOperation));

  let bl: Promise<Baseline> | undefined;
  let actor: Promise<Actor> | undefined;
  const baseline = () => bl ??= input.connect().catch(e => { bl = undefined; throw e; });
  // retried after a failure: an admin may add the agent user, or the person set BASELINE_AS, mid-session
  const agent = () => actor ??= baseline().then(b => actorForClient(b, input.as, server.getClientVersion()?.name)).catch(e => { actor = undefined; throw e; });

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const op = OPERATIONS.find(o => o.name === req.params.name) as AnyOperation | undefined;
    if (!op) return errorResult(`Unknown tool "${req.params.name}". Valid tools: ${OPERATIONS.map(o => o.name).join(', ')}.`);
    try {
      const ctx: OpContext = {
        bl: await baseline(),
        // a read is the same whoever asks; it must work before the agent's identity is settled
        actor: op.effect.kind === 'read' ? { kind: 'person' } : await agent(),
        session: sessionFrom(input.session),
      };
      const out = await runOp(op, ctx, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: op.text(out) }], structuredContent: out };
    } catch (e) {
      const known = toOpError(e);
      if (known) return errorResult(known.message);
      // not something the model can fix; the stack goes to stderr, which the harness logs
      console.error(e);
      return errorResult(`Baseline failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return server;
}

/** `baseline mcp`: serve on stdin/stdout until the client closes them. stdout carries only the protocol. */
export async function serveStdio(flags: { db?: string }): Promise<void> {
  // anything that would print to stdout (a library's log line) would corrupt the protocol stream
  console.log = console.info = console.debug = console.warn = (...args: unknown[]) => console.error(...args);
  const server = createMcpServer({
    connect: async () => {
      const b = await connect(flags);
      console.error(`[baseline mcp] ${describeTarget(b.target)}`);
      return b;
    },
    as: process.env.BASELINE_AS,
    session: process.env.BASELINE_SESSION,
  });
  // checked at spawn too, so a bad value shows in the harness's MCP log right away
  try { sessionFrom(process.env.BASELINE_SESSION); } catch (e) { if (e instanceof OpError) console.error(`[baseline mcp] ${e.message}`); }
  await server.connect(new StdioServerTransport());
}
