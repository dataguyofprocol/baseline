// What the TUI is showing, kept in a small file per workspace directory and target, so an agent in the
// next pane can read it (`baseline context`) and the next `baseline` reopens where you left off.
// No Ink or React here: the CLI imports it.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Target } from '../client/index.js';
import { GROUP_BYS, PRESETS, type GroupBy, type Preset } from './model.js';
import type { Route } from './state.js';

export interface ContextRow { key: string; title: string; state: string; assignee: string | null; priority: string }

/** the part of the file the App knows: what is on screen */
export interface SessionContext {
  route: Route;
  /** the routes `esc` walks back through */
  stack: Route[];
  /** "My Issues › CORE-4" */
  showing: string;
  openIssue: { key: string; title: string } | null;
  /** the list display options, restored on the next start */
  display: { groupBy: GroupBy; preset: Preset };
  list: { title: string; groupBy: GroupBy; preset: Preset; rows: ContextRow[]; cursorKey: string | null } | null;
}

export interface SessionFile extends SessionContext {
  version: 1;
  updatedAt: string;
  pid: number;
  cwd: string;
  /** the git toplevel of cwd, or cwd: what "this directory" means */
  workspace: string;
  /** "db:<path>" or "url:<origin>" */
  target: string;
}

export const stateDir = (env: NodeJS.ProcessEnv = process.env) => env.BASELINE_TUI_STATE_DIR || join(homedir(), '.baseline', 'tui');

const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };

export function workspaceDir(cwd = process.cwd()): string {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return real(r.status === 0 && r.stdout.trim() ? r.stdout.trim() : cwd);
}

export const targetId = (t: Target) => (t.kind === 'local' ? `db:${real(t.dbPath)}` : `url:${t.url.origin}`);

export function sessionPath(workspace: string, target: string, dir = stateDir()): string {
  const name = basename(workspace).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'root';
  return join(dir, `${name}-${createHash('sha1').update(`${workspace}\0${target}`).digest('hex').slice(0, 10)}.json`);
}

function parse(path: string): SessionFile | null {
  try {
    const f = JSON.parse(readFileSync(path, 'utf8')) as SessionFile;
    return f && f.version === 1 && typeof f.updatedAt === 'string' && f.route ? f : null;
  } catch {
    return null;
  }
}

export const readSession = (workspace: string, target: string, dir = stateDir()) => parse(sessionPath(workspace, target, dir));

/** this directory's file (the given target's first), else the most recently updated one anywhere */
export function findSession(workspace: string, target: string | null, dir = stateDir()): { file: SessionFile; path: string; here: boolean } | null {
  let names: string[];
  try { names = readdirSync(dir).filter(n => n.endsWith('.json')); } catch { return null; }
  const all = names.map(n => ({ path: join(dir, n), file: parse(join(dir, n)) }))
    .filter((x): x is { path: string; file: SessionFile } => !!x.file)
    .sort((a, b) => b.file.updatedAt.localeCompare(a.file.updatedAt));
  const exact = all.find(x => x.file.workspace === workspace && x.file.target === target);
  const here = exact ?? all.find(x => x.file.workspace === workspace);
  if (here) return { ...here, here: true };
  return all[0] ? { ...all[0], here: false } : null;
}

/** debounced, atomic (temp file + rename) writes of the latest context; flush() on exit */
export function sessionWriter(path: string, meta: Pick<SessionFile, 'cwd' | 'workspace' | 'target'>, delayMs = 300) {
  let latest: SessionContext | null = null;
  let timer: NodeJS.Timeout | null = null;
  const write = () => {
    timer = null;
    if (!latest) return;
    const file: SessionFile = { version: 1, updatedAt: new Date().toISOString(), pid: process.pid, ...meta, ...latest };
    latest = null;
    try {
      mkdirSync(join(path, '..'), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
      renameSync(tmp, path);
    } catch {
      // a read-only home must not take the TUI down; the context is a convenience
    }
  };
  return {
    update(ctx: SessionContext) {
      latest = ctx;
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, delayMs);
    },
    flush() {
      if (timer) clearTimeout(timer);
      write();
    },
  };
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}

const GROUP_LABEL: Record<GroupBy, string> = { status: 'by status', assignee: 'by assignee', priority: 'by priority', project: 'by project', none: 'no grouping' };
const PRESET_NAME: Record<Preset, string> = { active: 'Active', backlog: 'Backlog', all: 'All' };

/** the file as Markdown for an agent: what is open, and the list with the cursor row marked */
export function contextMarkdown(f: SessionFile, opts: { now: number; alive: boolean; here: boolean }): string {
  const out = [`- Showing: ${f.showing} (baseline tui, pid ${f.pid}, ${opts.alive ? 'open' : 'closed'}, updated ${ago(f.updatedAt, opts.now)})`];
  out.push(`- Open issue: ${f.openIssue ? `${f.openIssue.key} ${f.openIssue.title}` : 'none (a list has focus)'}`);
  if (!opts.here) out.push(`- Note: no TUI has run in this directory; this is the most recent one, in ${f.cwd}`);
  if (f.list) {
    out.push('', `## The list: ${f.list.title} (${GROUP_LABEL[f.list.groupBy] ?? f.list.groupBy}, ${PRESET_NAME[f.list.preset] ?? f.list.preset})`);
    if (!f.list.rows.length) out.push('(empty)');
    f.list.rows.forEach((r, i) => out.push(`${i + 1}. ${r.key} ${r.title} — ${r.state} · ${r.assignee ?? 'Unassigned'} · ${r.priority}${r.key === f.list!.cursorKey ? '  ← cursor' : ''}`));
  }
  out.push('', '`baseline issue show <KEY>` prints an issue in full.');
  return out.join('\n');
}

export interface Restored { route: Route; stack: Route[]; groupBy: GroupBy; preset: Preset; cursorKey: string | null }

/** where to reopen, from a file whose ids are checked against what still exists; routes that vanished fall back to My Issues */
export function restoreFrom(f: SessionFile, exists: { issue: (id: string) => boolean; team: (id: string) => boolean; project: (id: string) => boolean }): Restored {
  const ok = (r: Route | undefined): r is Route => !!r && (
    r.kind === 'my' || r.kind === 'inbox' || r.kind === 'projects' ||
    (r.kind === 'team' && exists.team(r.teamId)) || (r.kind === 'project' && exists.project(r.projectId)) || (r.kind === 'issue' && exists.issue(r.issueId)));
  const route = ok(f.route) ? f.route : { kind: 'my' as const };
  const stack = route.kind === 'issue' ? (f.stack ?? []).filter(ok) : [];
  return {
    route,
    stack: route.kind === 'issue' && !stack.length ? [{ kind: 'my' }] : stack,
    groupBy: GROUP_BYS.includes(f.display?.groupBy) ? f.display.groupBy : 'status',
    preset: PRESETS.includes(f.display?.preset) ? f.display.preset : 'all',
    cursorKey: f.list?.cursorKey ?? null,
  };
}
