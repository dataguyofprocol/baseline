import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { id } from './util.js';

export const DEFAULT_DB_PATH = resolve(homedir(), '.baseline', 'baseline.db');

export function resolveDbPath(flag?: string): string {
  return resolve(flag || process.env.BASELINE_DB || DEFAULT_DB_PATH);
}

export function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      initials TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#5e6ad2',
      admin INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'human'
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#5e6ad2',
      description TEXT NOT NULL DEFAULT '',
      position REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS states (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS issue_templates (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_issue_templates_team ON issue_templates(team_id);
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      state_id TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      assignee_id TEXT,
      project_id TEXT,
      cycle_id TEXT,
      parent_id TEXT,
      estimate INTEGER,
      due_date TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      completed_at TEXT,
      canceled_at TEXT,
      deleted_at TEXT,
      UNIQUE(team_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_issues_team ON issues(team_id);
    CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
    CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id);
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      edited_at TEXT,
      reactions TEXT NOT NULL DEFAULT '{}',
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_id);
    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      related_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#5e6ad2',
      status TEXT NOT NULL DEFAULT 'planned',
      health TEXT NOT NULL DEFAULT 'onTrack',
      priority INTEGER NOT NULL DEFAULT 0,
      directory TEXT NOT NULL DEFAULT '',
      start_date TEXT,
      target_date TEXT,
      lead_id TEXT,
      members TEXT NOT NULL DEFAULT '[]',
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_updates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      health TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cycles (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_locations (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      position REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, location_id)
    );
    CREATE TABLE IF NOT EXISTS views (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      filters TEXT NOT NULL DEFAULT '{}',
      group_by TEXT NOT NULL DEFAULT 'status',
      order_by TEXT NOT NULL DEFAULT 'priority',
      layout TEXT NOT NULL DEFAULT 'list',
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      actor_id TEXT,
      issue_id TEXT,
      project_id TEXT,
      body TEXT NOT NULL DEFAULT '',
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      issue_id TEXT,
      project_id TEXT,
      user_id TEXT,
      type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_issue ON activity(issue_id);
    CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id);
  `);

  // migrations for pre-existing databases
  const columns = (t: string): string[] => (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map(c => c.name);
  if (!columns('issues').includes('deleted_at')) db.exec('ALTER TABLE issues ADD COLUMN deleted_at TEXT');
  if (!columns('projects').includes('priority')) db.exec("ALTER TABLE projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 0");
  if (!columns('projects').includes('directory')) db.exec("ALTER TABLE projects ADD COLUMN directory TEXT NOT NULL DEFAULT ''");
  if (!columns('issues').includes('location_id')) db.exec('ALTER TABLE issues ADD COLUMN location_id TEXT');
  migrateDirectoriesToLocations(db);
  // the background runner was removed — its switch and bookkeeping go with it
  db.prepare("DELETE FROM meta WHERE key IN ('agentRunner', 'agentNudges')").run();
  if (!columns('users').includes('kind')) db.exec("ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'");

  // accounts: Google identity, suspension, and server-side sessions (one row per signed-in browser;
  // the cookie holds a random token, the row only its SHA-256)
  for (const [col, def] of [
    ['google_sub', 'TEXT'], ['avatar_url', "TEXT NOT NULL DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['created_at', 'TEXT'], ['last_seen_at', 'TEXT'],
  ] as const) if (!columns('users').includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      admin INTEGER NOT NULL DEFAULT 0,
      team_ids TEXT NOT NULL DEFAULT '[]',
      invited_by TEXT,
      code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      accepted_user_id TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
  `);
  // team membership: who belongs to which team (drives "Your teams"; everyone can still open any team).
  // Created once; existing people join every team so nothing changes for a workspace that predates it.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'team_members'").get()) {
    db.exec(`
      CREATE TABLE team_members (
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (team_id, user_id)
      );
      CREATE INDEX idx_team_members_user ON team_members(user_id);
      INSERT INTO team_members (team_id, user_id, created_at)
        SELECT t.id, u.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM teams t, users u WHERE u.kind = 'human';
    `);
  }

  // threads, milestones on issues, creators, snoozed notifications, team automation
  if (!columns('comments').includes('parent_id')) db.exec('ALTER TABLE comments ADD COLUMN parent_id TEXT');
  if (!columns('issues').includes('snoozed_until')) db.exec('ALTER TABLE issues ADD COLUMN snoozed_until TEXT');
  if (!columns('issues').includes('milestone_id')) db.exec('ALTER TABLE issues ADD COLUMN milestone_id TEXT');
  if (!columns('issues').includes('creator_id')) {
    db.exec('ALTER TABLE issues ADD COLUMN creator_id TEXT');
    // issues made before creators were tracked: the "created" activity names who made them
    db.exec("UPDATE issues SET creator_id = (SELECT user_id FROM activity a WHERE a.issue_id = issues.id AND a.type = 'created' ORDER BY created_at LIMIT 1)");
  }
  if (!columns('views').includes('kind')) db.exec("ALTER TABLE views ADD COLUMN kind TEXT NOT NULL DEFAULT 'issues'");
  if (!columns('views').includes('project_options')) db.exec('ALTER TABLE views ADD COLUMN project_options TEXT');
  if (!columns('projects').includes('summary')) db.exec("ALTER TABLE projects ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      creator_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_links (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🧊',
      summary TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned',
      priority INTEGER NOT NULL DEFAULT 0,
      milestones TEXT NOT NULL DEFAULT '[]',
      issues TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      related_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'blocks'
    );
    CREATE TABLE IF NOT EXISTS recurring_issues (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      assignee_id TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      project_id TEXT,
      cadence TEXT NOT NULL DEFAULT 'weekly',
      next_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  if (!columns('notifications').includes('snoozed_until')) db.exec('ALTER TABLE notifications ADD COLUMN snoozed_until TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_labels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8a8f98',
      description TEXT NOT NULL DEFAULT '',
      parent_id TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_statuses (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8a8f98',
      description TEXT NOT NULL DEFAULT '',
      position REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS project_subscriptions (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      issue_added INTEGER NOT NULL DEFAULT 0,
      issue_closed INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 1,
      updates INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS doc_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS emojis (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domains TEXT NOT NULL DEFAULT '[]',
      status_id TEXT,
      tier_id TEXT,
      revenue REAL,
      size INTEGER,
      owner_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_statuses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#8a8f98', position REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS customer_tiers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#8a8f98', position REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS customer_requests (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      issue_id TEXT,
      project_id TEXT,
      body TEXT NOT NULL DEFAULT '',
      important INTEGER NOT NULL DEFAULT 0,
      creator_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const projCols = columns('projects');
  if (!projCols.includes('labels')) db.exec("ALTER TABLE projects ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'");
  if (!projCols.includes('status_id')) db.exec('ALTER TABLE projects ADD COLUMN status_id TEXT');
  if (!projCols.includes('update_cadence')) db.exec('ALTER TABLE projects ADD COLUMN update_cadence TEXT');
  ensureDefaults(db);
  const teamCols = columns('teams');
  for (const [col, def] of [
    ['triage_enabled', 'INTEGER NOT NULL DEFAULT 0'], ['auto_cycles', 'INTEGER NOT NULL DEFAULT 0'],
    ['cycle_duration', 'INTEGER NOT NULL DEFAULT 2'], ['cycle_cooldown', 'INTEGER NOT NULL DEFAULT 0'],
    ['cycle_upcoming', 'INTEGER NOT NULL DEFAULT 2'], ['cycle_rollover', 'INTEGER NOT NULL DEFAULT 1'],
    ['estimate_scale', "TEXT NOT NULL DEFAULT 'fibonacci'"],
  ] as const) if (!teamCols.includes(col)) db.exec(`ALTER TABLE teams ADD COLUMN ${col} ${def}`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'link',
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_issue ON attachments(issue_id);
  `);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'").get()) {
    db.exec(`
      CREATE TABLE subscriptions (
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        PRIMARY KEY (issue_id, user_id)
      );
    `);
    // everyone who already had a hand in an issue follows it: creator, assignee, commenters
    db.exec(`
      INSERT OR IGNORE INTO subscriptions (issue_id, user_id) SELECT id, creator_id FROM issues WHERE creator_id IS NOT NULL;
      INSERT OR IGNORE INTO subscriptions (issue_id, user_id) SELECT id, assignee_id FROM issues WHERE assignee_id IS NOT NULL;
      INSERT OR IGNORE INTO subscriptions (issue_id, user_id) SELECT DISTINCT issue_id, user_id FROM comments;
    `);
  }

  // initiatives were removed from the model — drop leftover tables from pre-existing databases
  db.exec('DROP TABLE IF EXISTS initiative_updates');
  db.exec('DROP TABLE IF EXISTS initiatives');

  // every workspace gets at least one agent identity for hand-offs
  const hasAgent = db.prepare("SELECT 1 FROM users WHERE kind = 'agent' LIMIT 1").get();
  if (!hasAgent) {
    db.prepare("INSERT INTO users (id, name, email, initials, color, admin, kind) VALUES (?, 'Agent', 'agent@local', 'AG', '#4cb782', 0, 'agent')")
      .run(id('u'));
  }
}

/* One-time move from "a directory per project + a workspace default" to a list of locations:
   each project directory becomes a location linked to its project, and that project's issues
   are pinned to it (they already ran there). The workspace default and recent picks become
   plain locations — registered, but pinned to nothing, so nothing runs in them by accident. */
export function migrateDirectoriesToLocations(db: DatabaseSync): void {
  if (getMeta(db, 'locationsMigrated')) return;
  const ensure = (path: string): string => {
    const row = db.prepare('SELECT id FROM locations WHERE path = ?').get(path) as { id: string } | undefined;
    if (row) return row.id;
    const lid = id('loc');
    const base = path.replace(/\/+$/, '').split('/').pop() || path;
    let name = base;
    for (let n = 2; db.prepare('SELECT 1 FROM locations WHERE name = ?').get(name); n++) name = `${base}-${n}`;
    db.prepare('INSERT INTO locations (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(lid, name, path, new Date().toISOString());
    return lid;
  };
  const projects = db.prepare("SELECT id, directory FROM projects WHERE directory IS NOT NULL AND directory != ''").all() as Array<{ id: string; directory: string }>;
  for (const p of projects) {
    const lid = ensure(p.directory);
    db.prepare('INSERT OR IGNORE INTO project_locations (project_id, location_id, position) VALUES (?, ?, 0)').run(p.id, lid);
    db.prepare('UPDATE issues SET location_id = ? WHERE project_id = ? AND location_id IS NULL').run(lid, p.id);
    db.prepare("UPDATE projects SET directory = '' WHERE id = ?").run(p.id);
  }
  const cwd = getMeta(db, 'agentCwd');
  if (cwd) ensure(cwd);
  try { for (const d of JSON.parse(getMeta(db, 'recentDirectories') ?? '[]') as string[]) if (d) ensure(d); } catch { /* ignore */ }
  db.prepare("DELETE FROM meta WHERE key IN ('agentCwd', 'recentDirectories')").run();
  // only mark workspaces that exist — a brand-new database is seeded after this runs
  if (getMeta(db, 'workspaceId')) setMeta(db, 'locationsMigrated', '1');
}

/** rows every workspace starts with: one project status per category (Linear's defaults) and customer statuses */
export function ensureDefaults(db: DatabaseSync): void {
  // one named status per category to start with — Linear's defaults
  if (!(db.prepare('SELECT COUNT(*) n FROM project_statuses').get() as { n: number }).n) {
    const defs: Array<[string, string, string]> = [['backlog', 'Backlog', '#bec2c8'], ['planned', 'Planned', '#8a8f98'], ['started', 'In Progress', '#f2c94c'], ['paused', 'Paused', '#f2994a'], ['completed', 'Completed', '#5e6ad2'], ['canceled', 'Canceled', '#95a2b3']];
    defs.forEach(([type, name, color], i) => db.prepare('INSERT INTO project_statuses (id, type, name, color, description, position) VALUES (?, ?, ?, ?, ?, ?)').run(id('ps'), type, name, color, '', i));
  }
  if (!(db.prepare('SELECT COUNT(*) n FROM customer_statuses').get() as { n: number }).n) {
    ([['Active', '#4cb782'], ['Prospect', '#5e6ad2'], ['Churned', '#eb5757'], ['Lost', '#8a8f98']] as const).forEach(([name, color], i) => db.prepare('INSERT INTO customer_statuses (id, name, color, position) VALUES (?, ?, ?, ?)').run(id('cs'), name, color, i));
  }
  // projects from before named statuses sit on their category's first status
  db.exec('UPDATE projects SET status_id = (SELECT id FROM project_statuses ps WHERE ps.type = projects.status ORDER BY position LIMIT 1) WHERE status_id IS NULL');
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
