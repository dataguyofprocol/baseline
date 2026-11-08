import type { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.js';
import { Planning } from './planning.js';
import { Automation } from './automation.js';
import { GitSync } from './git.js';
import { ApiKeys } from './apikeys.js';
import { GitHubWebhooks, migrateWebhooks } from './webhooks.js';
import { migrateWork, Work, WORK_TABLES } from './work.js';

/* Areas added after the core tracker — initiatives, releases, SLAs, asks, loops and the git
   integration. Each lives in its own module with its own tables, and plugs into the store
   through issueHooks / tickHooks, so the core store stays small and merges stay mechanical. */

export interface Extensions {
  planning: Planning;
  automation: Automation;
  git: GitSync;
  apiKeys: ApiKeys;
  webhooks: GitHubWebhooks;
  /** agent work: threads, ops and drafts (work.ts) */
  work: Work;
  /** extra snapshot fields */
  snapshot(): ReturnType<Planning['snapshot']> & ReturnType<Automation['snapshot']> & ReturnType<GitSync['snapshot']>;
  /** tables wipe() clears (children first) */
  tables: string[];
  importData(data: Record<string, unknown>, insert: (table: string, cols: string[], row: Record<string, unknown>) => void): void;
}

/** initiatives made before sequential ids (or imported from an older backup) get theirs in creation order */
function numberInitiatives(db: DatabaseSync): void {
  const unnumbered = db.prepare('SELECT id FROM initiatives WHERE number IS NULL ORDER BY created_at, position').all() as Array<{ id: string }>;
  if (!unnumbered.length) return;
  let n = (db.prepare('SELECT COALESCE(MAX(number), 0) n FROM initiatives').get() as { n: number }).n;
  for (const r of unnumbered) db.prepare('UPDATE initiatives SET number = ? WHERE id = ?').run(++n, r.id);
}

function migrateExtensions(db: DatabaseSync): void {
  const columns = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map(c => c.name);
  const issueCols = columns('issues');
  for (const [col, def] of [['release_id', 'TEXT'], ['ask_form_id', 'TEXT'], ['sla_rule_id', 'TEXT'], ['sla_breaches_at', 'TEXT']] as const) {
    if (!issueCols.includes(col)) db.exec(`ALTER TABLE issues ADD COLUMN ${col} ${def}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS initiatives (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '🎯',
      color TEXT NOT NULL DEFAULT '#5e6ad2', status TEXT NOT NULL DEFAULT 'planned', health TEXT, owner_id TEXT,
      target_date TEXT, parent_id TEXT, position REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS initiative_projects (
      initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (initiative_id, project_id)
    );
    CREATE TABLE IF NOT EXISTS initiative_updates (
      id TEXT PRIMARY KEY, initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, body TEXT NOT NULL, health TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS initiative_labels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#5e6ad2', description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS initiative_links (
      id TEXT PRIMARY KEY, initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
      url TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'planned',
      team_id TEXT, target_date TEXT, released_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sla_rules (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, team_id TEXT, priorities TEXT NOT NULL DEFAULT '[]', labels TEXT NOT NULL DEFAULT '[]',
      hours REAL NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ask_forms (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', team_id TEXT NOT NULL,
      fields TEXT NOT NULL DEFAULT '[]', labels TEXT NOT NULL DEFAULT '[]', priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loops (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, team_id TEXT, trigger TEXT NOT NULL, actions TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loop_runs (
      id TEXT PRIMARY KEY, loop_id TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE, issue_id TEXT,
      ok INTEGER NOT NULL DEFAULT 1, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pull_requests (
      id TEXT PRIMARY KEY, repo TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL, state TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
      review_decision TEXT, checks TEXT, updated_at TEXT NOT NULL, merged_at TEXT,
      UNIQUE (repo, number)
    );
    CREATE TABLE IF NOT EXISTS issue_prs (
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      pr_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'closing', dismissed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (issue_id, pr_id)
    );
    CREATE TABLE IF NOT EXISTS commits (
      sha TEXT PRIMARY KEY, repo TEXT NOT NULL, message TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', committed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS issue_commits (
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      sha TEXT NOT NULL REFERENCES commits(sha) ON DELETE CASCADE,
      PRIMARY KEY (issue_id, sha)
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL,
      scopes TEXT, team_ids TEXT, created_at TEXT NOT NULL, last_used_at TEXT
    );
  `);
  const iniCols = columns('initiatives');
  for (const [col, def] of [['summary', "TEXT NOT NULL DEFAULT ''"], ['target_resolution', 'TEXT'], ['number', 'INTEGER'], ['priority', 'INTEGER NOT NULL DEFAULT 0'],
    ['labels', "TEXT NOT NULL DEFAULT '[]'"], ['team_id', 'TEXT'], ['update_cadence', 'TEXT']] as const) {
    if (!iniCols.includes(col)) db.exec(`ALTER TABLE initiatives ADD COLUMN ${col} ${def}`);
  }
  numberInitiatives(db);
  if (!columns('initiative_updates').includes('reactions')) db.exec("ALTER TABLE initiative_updates ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}'");
  // documents can live on an initiative too (its Resources)
  if (!columns('documents').includes('initiative_id')) db.exec('ALTER TABLE documents ADD COLUMN initiative_id TEXT');
}

export function createExtensions(store: Store, db: DatabaseSync): Extensions {
  migrateExtensions(db);
  migrateWebhooks(db);
  migrateWork(db);
  const planning = new Planning(store, db);
  const automation = new Automation(store, db);
  const git = new GitSync(store, db);
  const apiKeys = new ApiKeys(store, db);
  const webhooks = new GitHubWebhooks(store, db, git);
  const work = new Work(store, db);
  return {
    planning, automation, git, apiKeys, webhooks, work,
    snapshot: () => ({ ...planning.snapshot(), ...automation.snapshot(), ...git.snapshot() }),
    // api_keys are not exported or imported (only their hashes exist), nor is agent work
    tables: [...WORK_TABLES, 'github_issue_imports', 'github_deliveries', 'api_keys', 'issue_commits', 'commits', 'issue_prs', 'pull_requests', 'loop_runs', 'loops', 'ask_forms', 'sla_rules', 'releases', 'initiative_links', 'initiative_updates', 'initiative_projects', 'initiatives', 'initiative_labels'],
    importData(data, insert) {
      const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
      for (const x of arr<Record<string, unknown>>(data.initiatives)) {
        insert('initiatives', ['id', 'name', 'description', 'summary', 'icon', 'color', 'status', 'health', 'owner_id', 'target_date', 'target_resolution', 'parent_id', 'position', 'created_at', 'updated_at', 'number', 'priority', 'labels', 'team_id', 'update_cadence'],
          { ...x, description: x.description ?? '', summary: x.summary ?? '', icon: x.icon ?? '🎯', color: x.color ?? '#5e6ad2', status: x.status ?? 'planned', health: x.health ?? null, owner_id: x.ownerId ?? null, target_date: x.targetDate ?? null, target_resolution: x.targetResolution ?? null, parent_id: x.parentId ?? null, position: x.position ?? 0, created_at: x.createdAt, updated_at: x.updatedAt ?? x.createdAt,
            number: x.number ?? null, priority: x.priority ?? 0, labels: JSON.stringify(x.labelIds ?? []), team_id: x.teamId ?? null, update_cadence: x.updateCadence ?? null });
        for (const pid of arr<string>(x.projectIds)) insert('initiative_projects', ['initiative_id', 'project_id'], { initiative_id: x.id, project_id: pid });
      }
      numberInitiatives(db);
      for (const x of arr<Record<string, unknown>>(data.initiativeLabels)) insert('initiative_labels', ['id', 'name', 'color', 'description', 'created_at'], { ...x, description: x.description ?? '', created_at: x.createdAt });
      for (const x of arr<Record<string, unknown>>(data.initiativeUpdates)) insert('initiative_updates', ['id', 'initiative_id', 'user_id', 'body', 'health', 'created_at', 'reactions'], { ...x, initiative_id: x.initiativeId, user_id: x.userId, health: x.health ?? null, created_at: x.createdAt, reactions: JSON.stringify(x.reactions ?? {}) });
      for (const x of arr<Record<string, unknown>>(data.initiativeLinks)) insert('initiative_links', ['id', 'initiative_id', 'url', 'title', 'created_at'], { ...x, initiative_id: x.initiativeId, created_at: x.createdAt });
      for (const x of arr<Record<string, unknown>>(data.releases)) insert('releases', ['id', 'name', 'description', 'stage', 'team_id', 'target_date', 'released_at', 'created_at'], { ...x, description: x.description ?? '', team_id: x.teamId ?? null, target_date: x.targetDate ?? null, released_at: x.releasedAt ?? null, created_at: x.createdAt });
      for (const x of arr<Record<string, unknown>>(data.slaRules)) insert('sla_rules', ['id', 'name', 'team_id', 'priorities', 'labels', 'hours', 'enabled', 'created_at'], { ...x, team_id: x.teamId ?? null, priorities: JSON.stringify(x.priorities ?? []), labels: JSON.stringify(x.labelIds ?? []), enabled: x.enabled === false ? 0 : 1, created_at: x.createdAt });
      for (const x of arr<Record<string, unknown>>(data.askForms)) insert('ask_forms', ['id', 'name', 'description', 'team_id', 'fields', 'labels', 'priority', 'enabled', 'created_at'], { ...x, description: x.description ?? '', team_id: x.teamId, fields: JSON.stringify(x.fields ?? []), labels: JSON.stringify(x.labelIds ?? []), priority: x.priority ?? 0, enabled: x.enabled === false ? 0 : 1, created_at: x.createdAt });
      for (const x of arr<Record<string, unknown>>(data.loops)) insert('loops', ['id', 'name', 'team_id', 'trigger', 'actions', 'enabled', 'last_run_at', 'created_at'], { ...x, team_id: x.teamId ?? null, trigger: JSON.stringify(x.trigger), actions: JSON.stringify(x.actions ?? []), enabled: x.enabled === false ? 0 : 1, last_run_at: x.lastRunAt ?? null, created_at: x.createdAt });
      for (const x of arr<Record<string, unknown>>(data.pullRequests)) insert('pull_requests', ['id', 'repo', 'number', 'title', 'body', 'url', 'state', 'branch', 'base', 'author', 'review_decision', 'checks', 'updated_at', 'merged_at'], { ...x, body: x.body ?? '', review_decision: x.reviewDecision ?? null, checks: x.checks ?? null, updated_at: x.updatedAt, merged_at: x.mergedAt ?? null });
      for (const x of arr<Record<string, unknown>>(data.issuePrs)) insert('issue_prs', ['issue_id', 'pr_id', 'kind', 'dismissed'], { issue_id: x.issueId, pr_id: x.prId, kind: x.kind ?? 'closing', dismissed: x.dismissed ? 1 : 0 });
      for (const x of arr<Record<string, unknown>>(data.commits)) insert('commits', ['sha', 'repo', 'message', 'author', 'branch', 'committed_at'], { ...x, author: x.author ?? '', branch: x.branch ?? '', committed_at: x.committedAt });
      for (const x of arr<Record<string, unknown>>(data.issueCommits)) insert('issue_commits', ['issue_id', 'sha'], { issue_id: x.issueId, sha: x.sha });
    },
  };
}
