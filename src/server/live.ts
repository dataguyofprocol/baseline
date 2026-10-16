// Live updates: a version number that moves whenever the database changes, for open tabs to follow.
//
// Writes come from two places: this server's own requests and timer, and other processes on the
// same file (agents and people using the CLI write to SQLite directly). SQLite reports both
// cheaply — total_changes() counts rows this connection changed, PRAGMA data_version moves when
// another connection commits — so a twice-a-second look at the pair catches everything.
import type { DatabaseSync } from 'node:sqlite';
import type { Store } from '../core/store.js';

export class ChangeFeed {
  // starts at the clock, so a restarted server never repeats a version a tab already saw
  private version = Date.now();
  private last: string;
  private listeners = new Set<(v: number) => void>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private db: DatabaseSync) { this.last = this.fingerprint(); }

  private fingerprint(): string {
    const dv = (this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    const tc = (this.db.prepare('SELECT total_changes() n').get() as { n: number }).n;
    return `${dv}:${tc}`;
  }
  get current(): number { return this.version; }
  /** announce a new version if anything changed since the last look */
  check(): boolean {
    const f = this.fingerprint();
    if (f === this.last) return false;
    this.last = f;
    this.bump();
    return true;
  }
  /** announce a new version regardless (something time-based changed what people see) */
  bump(): void {
    this.version++;
    for (const fn of this.listeners) fn(this.version);
  }
  subscribe(fn: (v: number) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  get subscribers(): number { return this.listeners.size; }
  start(everyMs = 500): void {
    this.timer ??= setInterval(() => this.check(), everyMs);
  }
  stop(): void { clearInterval(this.timer); this.timer = undefined; }
}

/** The workspace's clock: cycles, recurring issues and update reminders, once a minute and at start.
 *  It runs outside any request, so what it writes is the workspace's own (not whoever was looking). */
export function startScheduler(store: Store, feed: ChangeFeed, everyMs = 60_000): () => void {
  let lastRun = new Date();
  const run = () => {
    const now = new Date();
    try {
      store.tick(now);
      // a snoozed notification or issue coming due changes what people see without changing a row
      if (store.wokeBetween(lastRun, now)) feed.bump();
    } catch (err) {
      console.error('[baseline] scheduled work failed:', (err as Error).message);
    }
    lastRun = now;
    feed.check();
  };
  run();
  const timer = setInterval(run, everyMs);
  return () => clearInterval(timer);
}
