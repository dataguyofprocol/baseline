import type { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Store } from './store.js';
import { getMeta, setMeta } from './db.js';
import { run, type GitSync } from './git.js';
import { agentUser } from './automation.js';
import type { PullRequest, WebhookConfig, WebhookDelivery } from './types.js';

/* GitHub webhooks, inbound only. GitHub signs each delivery with a shared secret
   (X-Hub-Signature-256); Baseline checks the signature, drops repeat deliveries
   (X-GitHub-Delivery) and feeds the event into the same ingest the gh poller uses.
   No GitHub token is involved: GitHub pushes to us, we never call it back.

   Events: pull_request, pull_request_review, check_suite, push, issues (one-way import), ping.
   Reviews and checks arrive one at a time, so a PR's review decision and check state are the
   latest event's; when the gh poller is also on it reconciles them to GitHub's rollup. */

export const WEBHOOK_PATH = '/api/github/webhook';
export const WEBHOOK_EVENTS = ['pull_request', 'pull_request_review', 'check_suite', 'push', 'issues'] as const;
/** GitHub caps payloads at 25 MB */
export const WEBHOOK_MAX_BYTES = 25 * 1024 * 1024;


type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function migrateWebhooks(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS github_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, delivery TEXT NOT NULL, event TEXT NOT NULL, action TEXT, repo TEXT,
      status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS github_deliveries_delivery ON github_deliveries (delivery);
    CREATE TABLE IF NOT EXISTS github_issue_imports (
      repo TEXT NOT NULL, number INTEGER NOT NULL, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      PRIMARY KEY (repo, number)
    );
  `);
}

/** `sha256=<hex>` over the raw body, compared in constant time */
export function signatureOk(secret: string, raw: string, header: string | undefined | null): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`);
  const got = Buffer.from(header.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}

export class GitHubWebhooks {
  /** hosted: BASELINE_PUBLIC_URL's origin, the only address GitHub can reach this server at */
  fixedUrl: string | null = null;
  constructor(private store: Store, private db: DatabaseSync, private git: GitSync) {}

  // ---------- configuration ----------
  private secret(): string | null { return getMeta(this.db, 'githubWebhookSecret') || null; }
  private imports(): Array<{ repo: string; teamId: string }> {
    try { return JSON.parse(getMeta(this.db, 'githubIssueImports') ?? '[]'); } catch { return []; }
  }
  config(): WebhookConfig {
    const s = this.secret();
    const n = (status: string) => (this.db.prepare('SELECT COUNT(*) n FROM github_deliveries WHERE status = ?').get(status) as { n: number }).n;
    return {
      enabled: !!s, secretHint: s ? `…${s.slice(-4)}` : null, publicUrl: this.fixedUrl ?? getMeta(this.db, 'githubWebhookUrl') ?? '', fixedUrl: !!this.fixedUrl,
      events: WEBHOOK_EVENTS, lastDelivery: this.deliveries(1)[0] ?? null, received: n('processed') + n('ignored'), rejected: n('rejected'), imports: this.imports(),
    };
  }
  /** a new secret, shown once (like an API key) — the old one stops working immediately */
  rotateSecret(): string {
    const s = randomBytes(32).toString('hex');
    setMeta(this.db, 'githubWebhookSecret', s);
    return s;
  }
  turnOff(): void { setMeta(this.db, 'githubWebhookSecret', ''); }
  setPublicUrl(url: string): void {
    if (this.fixedUrl) throw new Error(`The public address is ${this.fixedUrl}, set by BASELINE_PUBLIC_URL on the server`);
    const u = url.trim().replace(/\/+$/, '');
    if (u && !/^https:\/\/[^\s/]+/i.test(u)) throw new Error('Use the https:// address GitHub can reach (your tunnel or server)');
    setMeta(this.db, 'githubWebhookUrl', u);
  }
  deliveries(limit = 30): WebhookDelivery[] {
    return (this.db.prepare('SELECT * FROM github_deliveries ORDER BY id DESC LIMIT ?').all(limit) as Array<{ id: number; delivery: string; event: string; action: string | null; repo: string | null; status: WebhookDelivery['status']; detail: string; received_at: string }>)
      .map(d => ({ id: d.id, delivery: d.delivery, event: d.event, action: d.action, repo: d.repo, status: d.status, detail: d.detail, receivedAt: d.received_at }));
  }
  private record(d: Omit<WebhookDelivery, 'id' | 'receivedAt'>): void {
    this.db.prepare('INSERT INTO github_deliveries (delivery, event, action, repo, status, detail, received_at) VALUES (?,?,?,?,?,?,?)')
      .run(d.delivery, d.event, d.action, d.repo, d.status, d.detail.slice(0, 300), new Date().toISOString());
    this.db.prepare('DELETE FROM github_deliveries WHERE id <= (SELECT MAX(id) - 500 FROM github_deliveries)').run();
  }

  // ---------- receiving ----------
  /** verify, dedupe and apply one delivery; returns the HTTP status and body to answer with */
  receive(h: { event?: string | null; delivery?: string | null; signature?: string | null }, raw: string): { status: number; body: Json } {
    const secret = this.secret();
    if (!secret || !this.store.getFeatures().githubEnabled) return { status: 404, body: { error: 'GitHub webhooks are off in this workspace' } };
    const event = h.event ?? 'unknown'; const delivery = h.delivery ?? '';
    if (!signatureOk(secret, raw, h.signature)) {
      this.record({ delivery, event, action: null, repo: null, status: 'rejected', detail: h.signature ? 'signature does not match the secret' : 'unsigned request' });
      return { status: 401, body: { error: 'Invalid signature' } };
    }
    if (!delivery) return { status: 400, body: { error: 'Missing X-GitHub-Delivery' } };
    if (this.db.prepare("SELECT 1 FROM github_deliveries WHERE delivery = ? AND status IN ('processed', 'ignored')").get(delivery)) {
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    let p: Json;
    try { p = JSON.parse(raw); } catch { return { status: 400, body: { error: 'Body is not JSON — set the webhook content type to application/json' } }; }
    const repo: string | null = p.repository?.full_name ?? null;
    const action: string | null = typeof p.action === 'string' ? p.action : null;
    try {
      const detail = this.apply(event, p);
      this.record({ delivery, event, action, repo, status: detail === null ? 'ignored' : 'processed', detail: detail ?? '' });
      return { status: detail === null ? 202 : 200, body: { ok: true, ...(detail === null ? { ignored: true } : { detail }) } };
    } catch (e) {
      // not recorded as processed, so GitHub's redelivery can try again
      return { status: 500, body: { error: (e as Error).message } };
    }
  }

  /** what the event did (for the deliveries log), or null when it's not one we use */
  private apply(event: string, p: Json): string | null {
    const repo: string = p.repository?.full_name ?? '';
    switch (event) {
      case 'ping': return `ping — ${p.zen ?? 'hello'}`;
      case 'pull_request': {
        const pr = p.pull_request; if (!pr) return null;
        const prev = this.stored(repo, pr.number);
        const review = prev?.reviewDecision ?? (p.action === 'review_requested' ? 'review_required' : null);
        const checks = p.action === 'synchronize' ? 'pending' : prev?.checks ?? null; // new commits re-run checks
        const saved = this.git.ingestPullRequest(this.fromPayload(repo, pr, review, checks));
        return `PR #${saved.number} ${p.action}`;
      }
      case 'pull_request_review': {
        const pr = p.pull_request; if (!pr) return null;
        const prev = this.stored(repo, pr.number);
        const state = String(p.review?.state ?? '').toLowerCase();
        const review: PullRequest['reviewDecision'] = p.action === 'dismissed' ? 'review_required'
          : state === 'approved' ? 'approved' : state === 'changes_requested' ? 'changes_requested' : prev?.reviewDecision ?? 'review_required';
        this.git.ingestPullRequest(this.fromPayload(repo, pr, review, prev?.checks ?? null));
        return `PR #${pr.number} review ${state || p.action}`;
      }
      case 'check_suite': {
        const suite = p.check_suite; if (!suite) return null;
        const c = String(suite.conclusion ?? '');
        const checks: PullRequest['checks'] = suite.status !== 'completed' ? 'pending'
          : ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(c) ? 'failure' : 'success';
        const touched: number[] = [];
        for (const ref of (suite.pull_requests ?? []) as Json[]) {
          const prev = this.stored(repo, ref.number);
          if (!prev) continue; // a PR we haven't seen: its own pull_request event brings it in
          this.git.ingestPullRequest({ ...prev, checks, updatedAt: suite.updated_at ?? new Date().toISOString() });
          touched.push(ref.number);
        }
        return touched.length ? `checks ${checks} on PR #${touched.join(', #')}` : null;
      }
      case 'push': {
        if (p.deleted || !Array.isArray(p.commits)) return null;
        const branch = String(p.ref ?? '').replace(/^refs\/heads\//, '');
        if (!branch || String(p.ref).startsWith('refs/tags/')) return null;
        const onDefault = branch === p.repository?.default_branch;
        const linked = this.git.ingestPush((p.commits as Json[]).map(c => ({
          sha: c.id, repo, message: c.message ?? '', author: c.author?.username || c.author?.name || '', branch, committedAt: c.timestamp ?? new Date().toISOString(), onDefaultBranch: onDefault,
        })));
        return `${p.commits.length} commit${p.commits.length === 1 ? '' : 's'} on ${branch}, ${linked} linked`;
      }
      case 'issues': {
        const target = this.imports().find(x => x.repo.toLowerCase() === repo.toLowerCase());
        if (!target || !p.issue || p.issue.pull_request) return null;
        if (p.action === 'opened' || p.action === 'reopened') { const made = this.importOne(repo, target.teamId, p.issue); return made ? `imported #${p.issue.number}` : null; }
        if (p.action === 'closed') return this.closeImported(repo, p.issue.number);
        return null;
      }
      default: return null;
    }
  }
  private stored(repo: string, number: number): Omit<PullRequest, 'id'> | null {
    const r = this.db.prepare('SELECT * FROM pull_requests WHERE repo = ? AND number = ?').get(repo, number) as Json | undefined;
    return r ? { repo: r.repo, number: r.number, title: r.title, body: r.body, url: r.url, state: r.state, branch: r.branch, base: r.base, author: r.author, reviewDecision: r.review_decision, checks: r.checks, updatedAt: r.updated_at, mergedAt: r.merged_at } : null;
  }
  private fromPayload(repo: string, pr: Json, reviewDecision: PullRequest['reviewDecision'], checks: PullRequest['checks']): Omit<PullRequest, 'id'> {
    return {
      repo, number: pr.number, title: pr.title ?? '', body: pr.body ?? '', url: pr.html_url ?? '',
      state: pr.merged || pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open',
      branch: pr.head?.ref ?? '', base: pr.base?.ref ?? '', author: pr.user?.login ?? '',
      reviewDecision, checks, updatedAt: pr.updated_at ?? new Date().toISOString(), mergedAt: pr.merged_at ?? null,
    };
  }

  // ---------- GitHub Issues → Baseline (one way) ----------
  /** import a GitHub issue into a team once; labels match the team's labels by name */
  private importOne(repo: string, teamId: string, gi: Json): string | null {
    if (this.db.prepare('SELECT 1 FROM github_issue_imports WHERE repo = ? AND number = ?').get(repo, gi.number)) return null;
    const names = new Set(((gi.labels ?? []) as Json[]).map(l => String(typeof l === 'string' ? l : l.name ?? '').toLowerCase()).filter(Boolean));
    const labelIds = names.size ? (this.db.prepare('SELECT id, name FROM labels WHERE team_id = ?').all(teamId) as Array<{ id: string; name: string }>).filter(l => names.has(l.name.toLowerCase())).map(l => l.id) : [];
    const author = this.git.userByGithub(gi.user?.login ?? gi.author?.login);
    const url = gi.html_url ?? gi.url ?? '';
    const issue = this.store.createIssue({
      teamId, title: String(gi.title ?? `GitHub issue #${gi.number}`).slice(0, 500),
      description: `${String(gi.body ?? '').trim()}\n\n---\nImported from [${repo}#${gi.number}](${url}).`.trim(),
      stateId: this.store.stateOfType(teamId, 'triage') ?? this.store.stateOfType(teamId, 'backlog'), labelIds,
    }, author ?? agentUser(this.store, this.db, 'GitHub'));
    this.db.prepare('INSERT INTO github_issue_imports (repo, number, issue_id) VALUES (?, ?, ?)').run(repo, gi.number, issue.id);
    return issue.id;
  }
  private closeImported(repo: string, number: number): string | null {
    const row = this.db.prepare('SELECT issue_id FROM github_issue_imports WHERE repo = ? AND number = ?').get(repo, number) as { issue_id: string } | undefined;
    const issue = row && this.store.getIssue(row.issue_id);
    if (!issue || issue.deletedAt) return null;
    const type = (this.db.prepare('SELECT type FROM states WHERE id = ?').get(issue.stateId) as { type: string } | undefined)?.type;
    if (type === 'completed' || type === 'canceled') return null;
    const done = this.store.stateOfType(issue.teamId, 'completed');
    if (!done) return null;
    this.store.updateIssue(issue.id, { stateId: done }, agentUser(this.store, this.db, 'GitHub'));
    return `closed #${number}`;
  }
  /** pull a repo's open issues into a team now (gh, read-only); `follow` keeps importing new ones from webhooks */
  async importIssues(repo: string, teamId: string, follow: boolean): Promise<{ imported: number; skipped: number }> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository must look like owner/name');
    if (!this.db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) throw new Error('Unknown team');
    const json = await run('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,title,body,url,labels,author']);
    let imported = 0; let skipped = 0;
    for (const gi of JSON.parse(json) as Json[]) { if (this.importOne(repo, teamId, gi)) imported++; else skipped++; }
    this.setFollow(repo, follow ? teamId : null);
    return { imported, skipped };
  }
  setFollow(repo: string, teamId: string | null): void {
    const rest = this.imports().filter(x => x.repo.toLowerCase() !== repo.toLowerCase());
    setMeta(this.db, 'githubIssueImports', JSON.stringify(teamId ? [...rest, { repo, teamId }] : rest));
  }
}
