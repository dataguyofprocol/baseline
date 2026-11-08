// The core shape of the agent surface: one Operation = one MCP tool = one `baseline agent <verb>`
// command. OPERATIONS (./index.ts) is the only list; the CLI commands, the skill's "Agent loop"
// block and the parity check are generated from it, and the MCP server registers it as is.
//
// An op body sees only an OpContext: a `Baseline` client, who it acts as, and the session key.
// It never touches Store, SQLite, the environment, stdout or commander/MCP types.
import { z } from 'zod';
import { BaselineError, ResolveError, TargetError, type Baseline } from '../client/index.js';

/** A closed union, so a typo in the registry, a test or the skill generator fails the build. */
export type OpName =
  | 'get_issue' | 'list_issues'
  | 'start_issue' | 'post_progress' | 'file_followup' | 'finish_issue'
  | 'draft_project_update' | 'undo';

/**
 * What an op does to shared state. MCP annotations are derived from it, never written per tool:
 * read → readOnlyHint; write → idempotent, not destructive; revert → idempotent, destructive.
 * There is no non-idempotent write: every write says how a repeat converges.
 */
export type Effect =
  | { kind: 'read' }
  | { kind: 'write'; converges: string }
  | { kind: 'revert'; converges: string };

/** whom the writes are attributed to: an agent user (recorded "<agent> via <person>"), or the person */
export type Actor = { kind: 'agent'; userId: string; name: string } | { kind: 'person' };

/** BASELINE_SESSION, checked; it splits living comments between two sessions of one agent */
export type SessionKey = string & { readonly __brand: 'SessionKey' };

export interface OpContext {
  bl: Baseline;
  actor: Actor;
  /** null: the default lane, one living comment per (issue, agent, person) */
  session: SessionKey | null;
}

export interface Operation<I extends z.ZodObject, O extends z.ZodObject> {
  name: OpName;
  title: string;
  /** what the model reads, verbatim: MCP tools/list and `--help` both show this one string */
  description: string;
  input: I;
  output: O;
  effect: Effect;
  /** input fields the CLI takes as positional arguments, in order; every other field is a flag */
  positional?: ReadonlyArray<keyof z.infer<I> & string>;
  /** resolves names over the client, makes at most one write call, shapes the output */
  run(ctx: OpContext, input: z.infer<I>): Promise<z.infer<O>>;
  /** the human-readable result: the CLI's default output and MCP's text content */
  text(out: z.infer<O>): string;
}

export type AnyOperation = Operation<z.ZodObject, z.ZodObject>;

/** pins the input/output inference; every op is declared through it */
export function defineOp<I extends z.ZodObject, O extends z.ZodObject>(op: Operation<I, O>): Operation<I, O> { return op; }

/** `start_issue` → `start-issue`, under `baseline agent` */
export const cliVerb = (op: Pick<AnyOperation, 'name'>): string => op.name.replace(/_/g, '-');

export interface ToolAnnotations { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: true; openWorldHint: false }

export function annotationsOf(op: Pick<AnyOperation, 'title' | 'effect'>): ToolAnnotations {
  return { title: op.title, readOnlyHint: op.effect.kind === 'read', destructiveHint: op.effect.kind === 'revert', idempotentHint: true, openWorldHint: false };
}

/** The only error an op raises on purpose: one sentence the model can act on. MCP returns it as an
 *  isError tool result; the CLI prints `error: <message>` and exits 1. */
export class OpError extends Error {
  constructor(readonly code: 'not-found' | 'invalid' | 'conflict' | 'forbidden' | 'unreachable' | 'needs-human', message: string) { super(message); }
}

function toOpError(e: unknown): OpError | undefined {
  if (e instanceof OpError) return e;
  if (e instanceof ResolveError || e instanceof TargetError) return new OpError('invalid', e.message);
  if (e instanceof BaselineError) {
    const code = e.code === 'not-found' || e.code === 'conflict' || e.code === 'forbidden' || e.code === 'unreachable' || e.code === 'needs-human' ? e.code
      : e.code === 'unauthorized' || e.code === 'unauthenticated' ? 'forbidden' : 'invalid';
    return new OpError(code, e.message);
  }
  return undefined;
}

/** "issue: an issue key such as ENG-42; outcome: Invalid option…" */
const describeIssues = (err: z.ZodError) => err.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');

/** What both front doors call: validate the input at the boundary, run, and check the output
 *  against the schema the model was promised. Anything the model can fix comes back as OpError. */
export async function runOp<I extends z.ZodObject, O extends z.ZodObject>(op: Operation<I, O>, ctx: OpContext, raw: unknown): Promise<z.infer<O>> {
  const parsed = op.input.safeParse(raw);
  if (!parsed.success) throw new OpError('invalid', describeIssues(parsed.error));
  try {
    return op.output.parse(await op.run(ctx, parsed.data));
  } catch (e) {
    throw toOpError(e) ?? e;
  }
}

/** One input field as a flag can express it. Nested objects are not allowed in an op input:
 *  scripts/check-ops-parity.ts fails on one. */
export interface Field {
  name: string;
  /** --pr-url for pr_url */
  flag: string;
  kind: 'string' | 'url' | 'number' | 'boolean' | 'enum' | 'array';
  values?: readonly string[];
  required: boolean;
  description: string;
}

export function fieldsOf(op: AnyOperation): Field[] {
  return Object.entries(op.input.shape).map(([name, schema]) => {
    let t = schema as z.ZodType;
    let description = t.description;
    let required = true;
    while (t instanceof z.ZodOptional || t instanceof z.ZodDefault) {
      required = false;
      t = t.unwrap() as z.ZodType;
      description ??= t.description;
    }
    // z.url() and the other string formats are not ZodString subclasses in zod 4
    const isText = (s: unknown) => s instanceof z.ZodString || s instanceof z.ZodStringFormat;
    const kind = t instanceof z.ZodURL ? 'url' : isText(t) ? 'string' : t instanceof z.ZodNumber ? 'number' : t instanceof z.ZodBoolean ? 'boolean'
      : t instanceof z.ZodEnum ? 'enum' : t instanceof z.ZodArray && isText(t.element) ? 'array' : undefined;
    if (!kind) throw new Error(`${op.name}.${name}: a CLI flag can't express this field's type`);
    return {
      name, flag: `--${name.replace(/_/g, '-')}`, kind, required, description: description ?? '',
      ...(t instanceof z.ZodEnum ? { values: t.options as string[] } : {}),
    };
  });
}

/** the value a flag takes, as --help shows it */
export const placeholderOf = (f: Field): string =>
  f.kind === 'enum' ? `<${f.values!.join('|')}>` : f.kind === 'array' ? '<url...>' : f.kind === 'url' ? '<url>' : f.kind === 'number' ? '<n>' : '<text>';

/** `baseline agent post-progress <issue> [--did <text>] …`, for the skill */
export function usageOf(op: AnyOperation): string {
  const fields = fieldsOf(op);
  const pos = op.positional ?? [];
  const args = pos.map(p => `<${p}>`);
  const flags = fields.filter(f => !pos.includes(f.name)).map(f => {
    const s = f.kind === 'boolean' ? f.flag : `${f.flag} ${placeholderOf(f)}`;
    return f.required ? s : `[${s}]`;
  });
  return ['baseline agent', cliVerb(op), ...args, ...flags, '[--json]'].join(' ');
}
