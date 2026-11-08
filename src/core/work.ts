// Agent work: the server side of the agent operations (src/ops). An extension module like
// planning or git (extensions.ts): its own tables, plugged into the store, no UI of its own.
//
// - work_threads: one row per (issue, agent, person, session). It holds the living progress
//   comment, the branch, the last progress fields and the links already attached. Repeated calls
//   converge on it, and two agents (or two sessions) never share a row or a comment.
// - agent_ops: one row per agent write that changed something. Its activity rows carry its id
//   (activity.op_id), which is what undo replays; before/after hold what activity doesn't
//   (the thread, the comment text, the draft).
// - project_update_drafts: a status update an agent drafted. A separate table, so nothing that
//   reads project_updates can show a draft. Only a person publishes one, from the web app.
import type { DatabaseSync } from 'node:sqlite';

export const WORK_TABLES = ['agent_ops', 'project_update_drafts', 'work_threads'];

export function migrateWork(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_threads (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      session_key TEXT NOT NULL DEFAULT '',
      comment_id TEXT,
      branch TEXT NOT NULL,
      did TEXT,
      left_text TEXT,
      blocked TEXT,
      links TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      outcome TEXT,
      summary TEXT,
      finished_at TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (issue_id, agent_id, person_id, session_key),
      CHECK ((status = 'active' AND outcome IS NULL AND summary IS NULL AND finished_at IS NULL)
          OR (status = 'finished' AND outcome IN ('in_review', 'done', 'stopped') AND summary IS NOT NULL AND finished_at IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS agent_ops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      issue_id TEXT,
      project_id TEXT,
      thread_id TEXT,
      actor_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      session_key TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT,
      result_id TEXT,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      undoes TEXT,
      created_at TEXT NOT NULL,
      undone_at TEXT,
      undone_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_ops_dedupe ON agent_ops(name, issue_id, dedupe_key);
    CREATE TABLE IF NOT EXISTS project_update_drafts (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      via_user_id TEXT,
      body TEXT NOT NULL,
      health TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, person_id)
    );
  `);
}
