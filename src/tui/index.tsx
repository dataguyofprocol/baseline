// `baseline tui`: the workspace in the terminal, over the same client every other command uses.
import { render } from 'ink';
import { format } from 'node:util';
import { connect, resolve, type Baseline } from '../client/index.js';
import { App, type AppProps } from './App.js';
import { readPanes, readSession, rememberPane, restoreFrom, sessionPath, sessionWriter, takeFirstLaunch, targetId, workspaceDir } from './session.js';

export interface TuiOptions { db?: string; as?: string; issue?: string; fresh?: boolean }

/** where the TUI opens: the issue asked for, else where the last session in this directory left off, else Today */
export async function prepareStart(bl: Baseline, opts: Pick<TuiOptions, 'issue' | 'fresh'>, workspace = workspaceDir()): Promise<Pick<AppProps, 'route' | 'stack' | 'start'>> {
  const intro = takeFirstLaunch();
  if (opts.issue) {
    const issue = await bl.getByKey(opts.issue);
    if (!issue) throw new resolve.ResolveError(`Unknown issue ${opts.issue}`);
    return { route: { kind: 'issue', issueId: issue.id }, stack: [{ kind: 'today' }], ...(intro ? { start: { intro } } : {}) };
  }
  const saved = opts.fresh ? null : readSession(workspace, targetId(bl.target));
  if (!saved) return intro ? { start: { intro } } : {};
  const snap = await bl.snapshot(['teams', 'projects', 'issues']);
  const live = new Set(snap.issues.filter(i => !i.archivedAt && !i.deletedAt).map(i => i.id));
  const r = restoreFrom(saved, { issue: id => live.has(id), team: id => snap.teams.some(t => t.id === id), project: id => snap.projects.some(p => p.id === id) });
  return { route: r.route, stack: r.stack, start: { groupBy: r.groupBy, preset: r.preset, cursorKey: r.cursorKey, intro } };
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const bl = await connect({ db: opts.db });
  const { users } = await bl.snapshot(['users']);
  const actorId = resolve.actorId({ users }, opts.as, process.env.BASELINE_AS);
  const workspace = workspaceDir();
  const target = targetId(bl.target);
  const start = await prepareStart(bl, opts, workspace);
  const writer = sessionWriter(sessionPath(workspace, target), { cwd: process.cwd(), workspace, target });

  // anything the in-process server logs would scribble over the frame; hold it until the screen is back
  const held: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved) as Array<keyof typeof saved>) console[k] = (...args: unknown[]) => { held.push(format(...args)); };

  const panes = readPanes(target);
  const app = render(<App bl={bl} actorId={actorId} {...start} panes={panes} onPane={(issueId, paneId) => rememberPane(target, issueId, paneId)} onContext={writer.update} />, {
    alternateScreen: true,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
    maxFps: 60,
  });
  try {
    await app.waitUntilExit();
  } finally {
    writer.flush();
    Object.assign(console, saved);
    if (held.length) process.stderr.write(`${held.join('\n')}\n`);
  }
}
