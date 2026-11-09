// `baseline tui`: the workspace in the terminal, over the same client every other command uses.
import { render } from 'ink';
import { format } from 'node:util';
import { connect, resolve } from '../client/index.js';
import { App } from './App.js';
import type { Route } from './state.js';

export interface TuiOptions { db?: string; as?: string; issue?: string }

export async function runTui(opts: TuiOptions): Promise<void> {
  const bl = await connect({ db: opts.db });
  const { users } = await bl.snapshot(['users']);
  const actorId = resolve.actorId({ users }, opts.as, process.env.BASELINE_AS);
  let route: Route | undefined;
  let stack: Route[] = [];
  if (opts.issue) {
    const issue = await bl.getByKey(opts.issue);
    if (!issue) throw new resolve.ResolveError(`Unknown issue ${opts.issue}`);
    route = { kind: 'issue', issueId: issue.id };
    stack = [{ kind: 'my' }];
  }

  // anything the in-process server logs would scribble over the frame; hold it until the screen is back
  const held: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved) as Array<keyof typeof saved>) console[k] = (...args: unknown[]) => { held.push(format(...args)); };

  const app = render(<App bl={bl} actorId={actorId} route={route} stack={stack} />, {
    alternateScreen: true,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
    maxFps: 60,
  });
  try {
    await app.waitUntilExit();
  } finally {
    Object.assign(console, saved);
    if (held.length) process.stderr.write(`${held.join('\n')}\n`);
  }
}
