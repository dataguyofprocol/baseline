import { z } from 'zod';
import { BaselineError, ResolveError, TargetError, type Baseline } from '../client/index.js';

export type OpName =
  | 'next_issue' | 'find_issues' | 'get_issue' | 'list_issues' | 'my_activity'
  | 'propose_issue' | 'create_issue'
  | 'start_issue' | 'create_sub_issues' | 'post_progress' | 'propose_followup' | 'finish_issue'
  | 'draft_project_update' | 'undo';

export const OP_ALIASES: Readonly<Record<string, OpName>> = { file_followup: 'propose_followup' };

/**
 * What an op does to shared state. MCP annotations are derived from it, never written per tool:
 * read → readOnlyHint; write → idempotent, not destructive; revert → idempotent, destructive.
 * There is no non-idempotent write: every write says how a repeat converges.
 */
export type Effect =
  | { kind: 'read' }
  | { kind: 'write'; converges: string }
  | { kind: 'revert'; converges: string };

export type Actor = { kind: 'agent'; userId: string; name: string } | { kind: 'person' };

export type SessionKey = string & { readonly __brand: 'SessionKey' };

export type Surface = 'cli' | 'mcp';

export interface Checkout {
  status: 'checked_out' | 'created' | 'already_on' | 'manual';
  branch: string;
  command: string;
  note?: string;
}

export interface LocalRepo {
  checkout(branch: string): Promise<Checkout>;
  team: string | null;
}

export interface OpContext {
  bl: Baseline;
  actor: Actor;
  session: SessionKey | null;
  local?: LocalRepo;
}

export interface Operation<I extends z.ZodObject, O extends z.ZodObject> {
  name: OpName;
  title: string;
  /** what the model reads, verbatim: MCP tools/list and `--help` both show this one string */
  description: string;
  input: I;
  output: O;
  effect: Effect;
  positional?: ReadonlyArray<keyof z.infer<I> & string>;
  run(ctx: OpContext, input: z.infer<I>): Promise<z.infer<O>>;
  text(out: z.infer<O>, surface: Surface): string;
}

export type AnyOperation = Operation<z.ZodObject, z.ZodObject>;

export function defineOp<I extends z.ZodObject, O extends z.ZodObject>(op: Operation<I, O>): Operation<I, O> { return op; }

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

export function toOpError(e: unknown): OpError | undefined {
  if (e instanceof OpError) return e;
  if (e instanceof ResolveError || e instanceof TargetError) return new OpError('invalid', e.message);
  if (e instanceof BaselineError) {
    const code = e.code === 'not-found' || e.code === 'conflict' || e.code === 'forbidden' || e.code === 'unreachable' || e.code === 'needs-human' ? e.code
      : e.code === 'unauthorized' || e.code === 'unauthenticated' ? 'forbidden' : 'invalid';
    return new OpError(code, e.message);
  }
  return undefined;
}

const describeIssues = (err: z.ZodError) => err.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');

export async function runOp<I extends z.ZodObject, O extends z.ZodObject>(op: Operation<I, O>, ctx: OpContext, raw: unknown): Promise<z.infer<O>> {
  const parsed = op.input.safeParse(raw);
  if (!parsed.success) throw new OpError('invalid', describeIssues(parsed.error));
  try {
    return op.output.parse(await op.run(ctx, parsed.data));
  } catch (e) {
    throw toOpError(e) ?? e;
  }
}

export interface Field {
  name: string;
  flag: string;
  kind: 'string' | 'url' | 'number' | 'boolean' | 'enum' | 'array';
  values?: readonly string[];
  of?: 'url' | 'string';
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
      ...(t instanceof z.ZodArray ? { of: t.element instanceof z.ZodURL ? 'url' as const : 'string' as const } : {}),
    };
  });
}

export const placeholderOf = (f: Field): string =>
  f.kind === 'enum' ? `<${f.values!.join('|')}>` : f.kind === 'array' ? (f.of === 'url' ? '<url...>' : '<text...>') : f.kind === 'url' ? '<url>' : f.kind === 'number' ? '<n>' : '<text>';

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
