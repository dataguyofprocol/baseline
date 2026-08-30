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
  if (!columns('users').includes('kind')) db.exec("ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'");

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
