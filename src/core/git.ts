import type { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Store } from './store.js';
import { getMeta, setMeta } from './db.js';
import { id } from './util.js';
import { agentUser } from './automation.js';
import type { Commit, IssueCommit, IssuePr, PrAutomation, PrEvent, PrState, PullRequest, WorkflowStateType } from './types.js';

/* Git / GitHub, following Linear's GitHub integration (and TEAM_PLAN.md Phase 4):
   - linking: an issue key in the branch name or PR title links it; magic words in the
     description decide closing / non-closing / relation-only links, and `ignore KEY` /
     `skip KEY` opt out;
   - `KEY-NEW` in a PR's title or description files a new issue in team KEY, started, assigned
     to the PR's author and linked to the PR;
   - people: a PR author whose GitHub login matches a user's GitHub username is that user —
     the PR's activity is theirs and an unassigned issue it closes is assigned to them;
   - status automation per team: draft / opened / review / ready / merged map to a state;
     status only moves forward, canceled issues are never touched, every move is logged;
   - data: `ingestPullRequest` / `ingestPush` take PRs and commits from any source. Locally
     the source is `gh pr list` and `git log` in your locations' repos; a hosted server can
     feed the same functions from GitHub webhooks. */

const CLOSING = ['close', 'closes', 'closed', 'closing', 'fix', 'fixes', 'fixed', 'fixing', 'resolve', 'resolves', 'resolved', 'resolving', 'complete', 'completes', 'completed', 'completing', 'implement', 'implements', 'implemented', 'implementing'];
const NON_CLOSING = ['ref', 'refs', 'references', 'part of', 'contributes to', 'toward', 'towards'];
const RELATION = ['relates to', 'related to'];
const SKIP = ['ignore', 'skip'];
const KEY = '[A-Za-z][A-Za-z0-9]{0,9}-\\d+';

export type LinkKind = IssuePr['kind'];

/** every issue key a PR links, with how — pure, so it can be tested and reused by webhooks */
export function parseLinks(pr: { branch: string; title: string; body: string }): Map<string, LinkKind> {
  const out = new Map<string, LinkKind>();
  const rank: Record<LinkKind, number> = { related: 0, ref: 1, closing: 2 };
  const put = (k: string, kind: LinkKind) => { const key = k.toUpperCase(); const cur = out.get(key); if (!cur || rank[kind] > rank[cur]) out.set(key, kind); };
  const text = `${pr.title}\n${pr.body}`;
  const skipped = new Set<string>();
  const list = `(${KEY}(?:\\s*(?:,|and|&)\\s*${KEY})*)`;
  const words = (ws: string[]) => ws.map(w => w.replace(/ /g, '\\s+')).join('|');
  for (const m of text.matchAll(new RegExp(`\\b(?:${words(SKIP)})\\s+${list}`, 'gi'))) for (const k of m[1].match(new RegExp(KEY, 'g')) ?? []) skipped.add(k.toUpperCase());
  for (const [ws, kind] of [[CLOSING, 'closing'], [NON_CLOSING, 'ref'], [RELATION, 'related']] as const) {
    for (const m of text.matchAll(new RegExp(`\\b(?:${words(ws)}):?\\s+${list}`, 'gi'))) for (const k of m[1].match(new RegExp(KEY, 'g')) ?? []) put(k, kind);
  }
  // a key in the branch name or the title links it as closing (unless a word above said otherwise)
  for (const k of pr.branch.match(new RegExp(`(?:^|[/_-])(${KEY})(?=$|[/_-])`, 'gi')) ?? []) { const key = k.replace(/^[/_-]/, ''); if (!out.has(key.toUpperCase())) put(key, 'closing'); }
  for (const k of pr.title.match(new RegExp(`\\b${KEY}\\b`, 'g')) ?? []) if (!out.has(k.toUpperCase())) put(k, 'closing');
  for (const k of skipped) out.delete(k);
  return out;
}

const NEW_KEY = /\[?\(?\b([A-Z][A-Z0-9]{0,9})-NEW\b\)?\]?:?/g;
/** team keys a PR asks a new issue for, with `KEY-NEW` in its title or description — pure.
 *  Upper case only, so prose like "brand-new" never files anything. */
export function parseNewIssueKeys(pr: { title: string; body: string }): string[] {
  return [...new Set([...`${pr.title}\n${pr.body}`.matchAll(NEW_KEY)].map(m => m[1]))];
}
/** the PR title without its `KEY-NEW` markers: "[ENG-NEW] Fix login" → "Fix login" */
export function titleFromPr(title: string): string {
  return title.replace(NEW_KEY, ' ').replace(/\s+/g, ' ').replace(/^[\s:|–—-]+|[\s:|–—-]+$/g, '').trim();
}

/** the furthest event a PR has reached; closed-unmerged PRs don't count */
export function prEvent(pr: Pick<PullRequest, 'state' | 'reviewDecision' | 'checks'>): PrEvent | null {
  if (pr.state === 'merged') return 'merged';
  if (pr.state === 'closed') return null;
  if (pr.state === 'draft') return 'draft';
  if (pr.reviewDecision === 'approved' && pr.checks !== 'failure' && pr.checks !== 'pending') return 'ready';
  if (pr.reviewDecision) return 'review';
  return 'opened';
}
const EVENT_RANK: Record<PrEvent, number> = { draft: 1, opened: 2, review: 3, ready: 4, merged: 5 };
const TYPE_RANK: Record<WorkflowStateType, number> = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4, canceled: 5 };

const run = (cmd: string, args: string[], cwd?: string) => new Promise<string>((resolve, reject) => {
  execFile(cmd, args, { cwd, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message).trim().split('\n')[0])) : resolve(stdout));
});

export interface GitStatus { ghInstalled: boolean; ghUser: string | null; repos: Array<{ location: string; path: string; repo: string | null }>; lastSyncAt: string | null; lastError: string | null }

export class GitSync {
  private syncing = false;
  constructor(private store: Store, private db: DatabaseSync) {}

  private rows<T>(sql: string, ...args: Array<string | number | null>): T[] { return this.db.prepare(sql).all(...args) as unknown as T[]; }

  snapshot() {
    const pullRequests: PullRequest[] = this.rows<{ id: string; repo: string; number: number; title: string; body: string; url: string; state: PrState; branch: string; base: string; author: string; review_decision: PullRequest['reviewDecision']; checks: PullRequest['checks']; updated_at: string; merged_at: string | null }>('SELECT * FROM pull_requests ORDER BY updated_at DESC LIMIT 1000')
      .map(p => ({ id: p.id, repo: p.repo, number: p.number, title: p.title, body: p.body, url: p.url, state: p.state, branch: p.branch, base: p.base, author: p.author, reviewDecision: p.review_decision, checks: p.checks, updatedAt: p.updated_at, mergedAt: p.merged_at }));
    const issuePrs: IssuePr[] = this.rows<{ issue_id: string; pr_id: string; kind: LinkKind; dismissed: number }>('SELECT * FROM issue_prs').map(l => ({ issueId: l.issue_id, prId: l.pr_id, kind: l.kind, dismissed: !!l.dismissed }));
    const commits: Commit[] = this.rows<{ sha: string; repo: string; message: string; author: string; branch: string; committed_at: string }>('SELECT * FROM commits ORDER BY committed_at DESC LIMIT 1000')
      .map(c => ({ sha: c.sha, repo: c.repo, message: c.message, author: c.author, branch: c.branch, committedAt: c.committed_at }));
    const issueCommits: IssueCommit[] = this.rows<{ issue_id: string; sha: string }>('SELECT * FROM issue_commits').map(x => ({ issueId: x.issue_id, sha: x.sha }));
    return { pullRequests, issuePrs, commits, issueCommits };
  }

  // ---------- team automation ----------
  automation(teamId: string): PrAutomation {
    const states = this.rows<{ id: string; name: string; type: WorkflowStateType }>('SELECT id, name, type FROM states WHERE team_id = ? ORDER BY position', teamId);
    const started = states.find(s => s.type === 'started' && !/review/i.test(s.name))?.id ?? null;
    const review = states.find(s => /review/i.test(s.name))?.id ?? null;
    const done = states.find(s => s.type === 'completed')?.id ?? null;
    const defaults: PrAutomation = { draft: started, opened: started, review, ready: null, merged: done, branchRules: [] };
    try { return { ...defaults, ...JSON.parse(getMeta(this.db, `prAutomation:${teamId}`) ?? '{}') }; } catch { return defaults; }
  }
  setAutomation(teamId: string, patch: Partial<PrAutomation>): void { setMeta(this.db, `prAutomation:${teamId}`, JSON.stringify({ ...this.automation(teamId), ...patch })); }
  /** Linear's "In Review" state, added once to each team (after its started states) */
  ensureInReview(): void {
    for (const t of this.rows<{ id: string }>('SELECT id FROM teams')) {
      if (this.db.prepare("SELECT 1 FROM states WHERE team_id = ? AND lower(name) = 'in review'").get(t.id)) continue;
      const last = this.db.prepare("SELECT MAX(position) p FROM states WHERE team_id = ? AND type = 'started'").get(t.id) as { p: number | null };
      this.store.createState(t.id, 'In Review', 'started', '#4cb782', (last.p ?? 2) + 0.5);
    }
  }

  // ---------- ingest ----------
  private issueByKey(key: string): { id: string; teamId: string; assigneeId: string | null } | undefined {
    const i = this.store.getByKey(key);
    return i && !i.deletedAt ? { id: i.id, teamId: i.teamId, assigneeId: i.assigneeId } : undefined;
  }
  /** the user whose GitHub username is this login (case-insensitive) */
  userByGithub(login: string | null | undefined): string | undefined {
    if (!login?.trim()) return undefined;
    return (this.db.prepare("SELECT id FROM users WHERE github_username != '' AND lower(github_username) = lower(?) ORDER BY rowid LIMIT 1").get(login.trim().replace(/^@/, '')) as { id: string } | undefined)?.id;
  }
  /** `KEY-NEW`: one issue per PR and team, started and assigned to the author; later syncs
   *  return the same issue (or nothing once it's deleted) so it's never filed twice */
  private issueFromPr(pr: PullRequest, teamKey: string, author: string | undefined, actor: string): string | null {
    const team = this.db.prepare('SELECT id, key FROM teams WHERE upper(key) = ?').get(teamKey) as { id: string; key: string } | undefined;
    if (!team) return null;
    const memo = `prNewIssue:${pr.repo}#${pr.number}:${team.key}`;
    const made = getMeta(this.db, memo);
    if (made) { const i = this.store.getIssue(made); return i && !i.deletedAt ? `${team.key}-${i.number}` : null; }
    if (pr.state === 'closed') return null; // a PR closed unmerged asks for nothing
    const issue = this.store.createIssue({
      teamId: team.id, title: titleFromPr(pr.title) || `PR #${pr.number}`,
      description: `Created from [${pr.repo}#${pr.number}](${pr.url}).`,
      stateId: this.store.stateOfType(team.id, 'started'), assigneeId: author ?? null,
    }, actor);
    setMeta(this.db, memo, issue.id);
    return `${team.key}-${issue.number}`;
  }
  /** upsert a PR, (re)link it to the issues it names, and apply status automation */
  ingestPullRequest(input: Omit<PullRequest, 'id'>): PullRequest {
    const prev = this.db.prepare('SELECT * FROM pull_requests WHERE repo = ? AND number = ?').get(input.repo, input.number) as { id: string; state: PrState; review_decision: string | null } | undefined;
    const pr: PullRequest = { ...input, id: prev?.id ?? id('pr') };
    this.db.prepare(`INSERT INTO pull_requests (id, repo, number, title, body, url, state, branch, base, author, review_decision, checks, updated_at, merged_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(repo, number) DO UPDATE SET title = excluded.title, body = excluded.body, url = excluded.url, state = excluded.state, branch = excluded.branch, base = excluded.base, author = excluded.author, review_decision = excluded.review_decision, checks = excluded.checks, updated_at = excluded.updated_at, merged_at = excluded.merged_at`)
      .run(pr.id, pr.repo, pr.number, pr.title, pr.body, pr.url, pr.state, pr.branch, pr.base, pr.author, pr.reviewDecision, pr.checks, pr.updatedAt, pr.mergedAt);
    const author = this.userByGithub(pr.author);
    const actor = author ?? agentUser(this.store, this.db, 'GitHub');
    const me = getMeta(this.db, 'currentUser');
    const links = parseLinks(pr);
    for (const teamKey of parseNewIssueKeys(pr)) { const key = this.issueFromPr(pr, teamKey, author, actor); if (key) links.set(key, 'closing'); }
    for (const [key, kind] of links) {
      const issue = this.issueByKey(key);
      if (!issue) continue;
      const link = this.db.prepare('SELECT kind, dismissed FROM issue_prs WHERE issue_id = ? AND pr_id = ?').get(issue.id, pr.id) as { kind: LinkKind; dismissed: number } | undefined;
      if (link?.dismissed) continue; // an unlinked PR is never re-linked
      if (!link) {
        this.db.prepare('INSERT INTO issue_prs (issue_id, pr_id, kind, dismissed) VALUES (?, ?, ?, 0)').run(issue.id, pr.id, kind);
        this.store.logActivity({ issueId: issue.id, type: 'prLinked', data: { pr: `${pr.repo}#${pr.number}`, title: pr.title, kind, url: pr.url } }, actor);
        // the PR's author is working on what it closes: an unassigned issue becomes theirs (once,
        // at link time, so a later hand-unassign sticks)
        if (kind === 'closing' && author && !issue.assigneeId && pr.state !== 'closed') this.store.updateIssue(issue.id, { assigneeId: author }, actor);
      } else if (link.kind !== kind) this.db.prepare('UPDATE issue_prs SET kind = ? WHERE issue_id = ? AND pr_id = ?').run(kind, issue.id, pr.id);
      const changed = !prev || prev.state !== pr.state || (prev.review_decision ?? null) !== pr.reviewDecision;
      if (changed && me && (this.store.isSubscribed(issue.id, me))) {
        const what = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : pr.reviewDecision === 'approved' ? 'approved' : pr.reviewDecision === 'changes_requested' ? 'changes requested' : prev ? 'updated' : 'opened';
        this.store.notify('prActivity', { actorId: actor, issueId: issue.id, body: `PR #${pr.number} ${what}: ${pr.title}` });
      }
      this.applyAutomation(issue.id);
    }
    return pr;
  }
  /** commits that name issues link to them; closing words on the default branch count as merged */
  ingestPush(commits: Array<Commit & { onDefaultBranch?: boolean }>): number {
    const bot = agentUser(this.store, this.db, 'GitHub');
    let linked = 0;
    for (const c of commits) {
      this.db.prepare('INSERT OR IGNORE INTO commits (sha, repo, message, author, branch, committed_at) VALUES (?,?,?,?,?,?)').run(c.sha, c.repo, c.message, c.author, c.branch, c.committedAt);
      for (const [key, kind] of parseLinks({ branch: c.branch, title: c.message.split('\n')[0], body: c.message })) {
        const issue = this.issueByKey(key);
        if (!issue || this.db.prepare('SELECT 1 FROM issue_commits WHERE issue_id = ? AND sha = ?').get(issue.id, c.sha)) continue;
        this.db.prepare('INSERT INTO issue_commits (issue_id, sha) VALUES (?, ?)').run(issue.id, c.sha);
        this.store.logActivity({ issueId: issue.id, type: 'commitLinked', data: { sha: c.sha.slice(0, 7), message: c.message.split('\n')[0], repo: c.repo } }, bot);
        linked++;
        const auto = this.automation(issue.teamId);
        const target = kind === 'closing' && c.onDefaultBranch ? auto.merged : auto.opened;
        if (target) this.moveForward(issue.id, target, `commit ${c.sha.slice(0, 7)}`);
      }
    }
    return linked;
  }
  unlink(issueId: string, prId: string): void { this.db.prepare('UPDATE issue_prs SET dismissed = 1 WHERE issue_id = ? AND pr_id = ?').run(issueId, prId); }

  /** move the issue to the state its least-advanced closing PR has earned */
  applyAutomation(issueId: string): void {
    const issue = this.store.getIssue(issueId);
    if (!issue) return;
    const prs = this.rows<{ state: PrState; review_decision: PullRequest['reviewDecision']; checks: PullRequest['checks']; base: string; number: number; author: string }>(
      "SELECT p.state, p.review_decision, p.checks, p.base, p.number, p.author FROM issue_prs l JOIN pull_requests p ON p.id = l.pr_id WHERE l.issue_id = ? AND l.kind = 'closing' AND l.dismissed = 0", issueId);
    const events = prs.map(p => ({ ev: prEvent({ state: p.state, reviewDecision: p.review_decision, checks: p.checks }), base: p.base, number: p.number, author: p.author })).filter(x => x.ev) as Array<{ ev: PrEvent; base: string; number: number; author: string }>;
    if (!events.length) return;
    const least = events.reduce((a, b) => (EVENT_RANK[b.ev] < EVENT_RANK[a.ev] ? b : a));
    const auto = this.automation(issue.teamId);
    const rule = auto.branchRules.find(r => r.event === least.ev && (() => { try { return new RegExp(r.pattern).test(least.base); } catch { return false; } })());
    const target = rule ? rule.stateId : auto[least.ev];
    if (target) this.moveForward(issueId, target, `PR #${least.number} ${least.ev}`, this.userByGithub(least.author));
  }
  private moveForward(issueId: string, stateId: string, why: string, actorId?: string): void {
    const issue = this.store.getIssue(issueId);
    if (!issue || issue.stateId === stateId) return;
    const st = (sid: string) => this.db.prepare('SELECT type, position FROM states WHERE id = ?').get(sid) as { type: WorkflowStateType; position: number } | undefined;
    const cur = st(issue.stateId); const next = st(stateId);
    if (!cur || !next || cur.type === 'canceled' || cur.type === 'completed') return;
    const ahead = TYPE_RANK[next.type] > TYPE_RANK[cur.type] || (next.type === cur.type && next.position > cur.position);
    if (!ahead) return;
    const actor = actorId ?? agentUser(this.store, this.db, 'GitHub');
    this.store.updateIssue(issueId, { stateId }, actor);
    this.store.logActivity({ issueId, type: 'prStateMoved', data: { why } }, actor);
  }

  // ---------- local source: gh + git in your locations ----------
  async status(): Promise<GitStatus> {
    let ghInstalled = false; let ghUser: string | null = null;
    try { await run('gh', ['--version']); ghInstalled = true; ghUser = (await run('gh', ['api', 'user', '--jq', '.login'])).trim() || null; } catch { /* not installed or not signed in */ }
    const repos = await Promise.all(this.store.listLocations().map(async l => ({ location: l.name, path: l.path, repo: await this.remoteOf(l.path) })));
    return { ghInstalled, ghUser, repos, lastSyncAt: getMeta(this.db, 'gitLastSync'), lastError: getMeta(this.db, 'gitLastError') };
  }
  private async remoteOf(path: string): Promise<string | null> {
    if (!existsSync(path)) return null;
    try { const url = (await run('git', ['remote', 'get-url', 'origin'], path)).trim(); return /github\.com[:/](.+?)(?:\.git)?$/.exec(url)?.[1] ?? null; } catch { return null; }
  }
  /** pull recent PRs (gh) and commits (git log) from every location that's a GitHub repo */
  async sync(): Promise<{ prs: number; commits: number; error?: string }> {
    if (this.syncing) return { prs: 0, commits: 0, error: 'already syncing' };
    this.syncing = true;
    let prs = 0; let commits = 0; const errors: string[] = [];
    try {
      for (const loc of this.store.listLocations()) {
        const repo = await this.remoteOf(loc.path);
        if (!repo) continue;
        try {
          const json = await run('gh', ['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '50', '--json', 'number,title,body,url,state,isDraft,headRefName,baseRefName,author,reviewDecision,statusCheckRollup,updatedAt,mergedAt']);
          for (const p of JSON.parse(json) as Array<{ number: number; title: string; body: string; url: string; state: string; isDraft: boolean; headRefName: string; baseRefName: string; author?: { login: string }; reviewDecision?: string; statusCheckRollup?: Array<{ conclusion?: string; state?: string; status?: string }>; updatedAt: string; mergedAt?: string | null }>) {
            const rollup = p.statusCheckRollup ?? [];
            const checks = !rollup.length ? null : rollup.some(c => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'].includes(c.conclusion ?? c.state ?? '')) ? 'failure' : rollup.some(c => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING') ? 'pending' : 'success';
            const review = p.reviewDecision === 'APPROVED' ? 'approved' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'changes_requested' : p.reviewDecision === 'REVIEW_REQUIRED' ? 'review_required' : null;
            this.ingestPullRequest({ repo, number: p.number, title: p.title, body: p.body ?? '', url: p.url, state: p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : p.isDraft ? 'draft' : 'open', branch: p.headRefName, base: p.baseRefName, author: p.author?.login ?? '', reviewDecision: review, checks, updatedAt: p.updatedAt, mergedAt: p.mergedAt ?? null });
            prs++;
          }
        } catch (e) { errors.push(`${repo}: ${(e as Error).message}`); }
        try {
          const def = (await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], loc.path).catch(() => 'origin/main')).trim();
          const parse = (out: string, onDefault: boolean) => out.split('\x1e').map(r => r.trim()).filter(Boolean).map(r => { const [sha, author, at, ...msg] = r.split('\x1f'); return { sha, repo, author, committedAt: at, message: msg.join('\x1f'), branch: onDefault ? def.replace(/^origin\//, '') : '', onDefaultBranch: onDefault }; });
          const fmt = '--pretty=format:%H%x1f%an%x1f%cI%x1f%B%x1e';
          const onDefault = parse(await run('git', ['log', def, '--since=30.days', '-n', '300', fmt], loc.path).catch(() => ''), true);
          const seen = new Set(onDefault.map(c => c.sha));
          const others = parse(await run('git', ['log', '--all', '--since=30.days', '-n', '300', fmt], loc.path).catch(() => ''), false).filter(c => !seen.has(c.sha));
          commits += this.ingestPush([...onDefault, ...others]);
        } catch (e) { errors.push(`${loc.name}: ${(e as Error).message}`); }
      }
      setMeta(this.db, 'gitLastSync', new Date().toISOString());
      setMeta(this.db, 'gitLastError', errors.join(' · '));
      return { prs, commits, ...(errors.length ? { error: errors.join(' · ') } : {}) };
    } finally { this.syncing = false; }
  }
}
