import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';

const work = mkdtempSync(join(tmpdir(), 'baseline-summaries-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const dbPath = join(work, 'local.db');
const { store, db } = createApp(dbPath, { mode: 'local' }, { configured: false, send: async () => {} });

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};
const DAY = 86400000;
const summaries = (userId: string) => db.prepare("SELECT body, created_at FROM notifications WHERE type = 'updatesDigest' AND user_id = ? ORDER BY created_at").all(userId) as Array<{ body: string; created_at: string }>;
const postAt = (projectId: string, authorId: string, body: string, at: Date) => {
  const u = store.addProjectUpdate(projectId, authorId, body);
  db.prepare('UPDATE project_updates SET created_at = ? WHERE id = ?').run(at.toISOString(), u.id);
};

const t0 = new Date(Date.now() + 60 * DAY);
const person = store.createUser('Summary Person', 'summary@example.com');
const author = store.createUser('Update Author', 'author@example.com');
const mine = store.createProject({ name: 'Summary: on it', memberIds: [person.id] });
const notMine = store.createProject({ name: 'Summary: not on it' });

{
  store.tick(t0);
  check('no new updates on your projects: no summary', summaries(person.id).length === 0, JSON.stringify(summaries(person.id)));
}

{
  postAt(mine.id, author.id, 'Shipped the first slice.', new Date(t0.getTime() + 3600_000));
  postAt(notMine.id, author.id, 'Elsewhere entirely.', new Date(t0.getTime() + 7200_000));
  const t1 = new Date(t0.getTime() + DAY);
  store.tick(t1);
  const s = summaries(person.id);
  check('one summary for the person (weekly by default)', s.length === 1, JSON.stringify(s));
  check('it counts only the update on a project they are on', s[0]?.body === '1 project update since your last summary', s[0]?.body);
  store.tick(new Date(t1.getTime() + DAY));
  check('weekly: no second summary a day later', summaries(person.id).length === 1);
}

{
  const led = store.createProject({ name: 'Summary: leads it', leadId: person.id });
  const followed = store.createProject({ name: 'Summary: follows it' });
  const muted = store.createProject({ name: 'Summary: follows, updates off' });
  store.setProjectSubscription(followed.id, person.id, { updates: true });
  store.setProjectSubscription(muted.id, person.id, { comments: true, updates: false });
  const last = new Date(summaries(person.id)[0].created_at);
  for (const p of [led, followed, muted]) postAt(p.id, author.id, `News on ${p.name}`, new Date(last.getTime() + 2 * DAY));
  store.tick(new Date(last.getTime() + 8 * DAY));
  const s = summaries(person.id);
  check('the next summary comes a week after the last', s.length === 2, JSON.stringify(s));
  check('it counts the led and followed projects, not the muted one', s[1]?.body === '2 project updates since your last summary', s[1]?.body);
}

{
  const daily = store.createUser('Daily Reader', 'daily@example.com');
  const off = store.createUser('No Summaries', 'off@example.com');
  store.setPreferences({ updatesSummary: 'daily' }, daily.id);
  store.setPreferences({ updatesSummary: 'off' }, off.id);
  const p = store.createProject({ name: 'Summary: shared', memberIds: [daily.id, off.id] });
  const base = new Date(t0.getTime() + 30 * DAY);
  postAt(p.id, author.id, 'Day one.', new Date(base.getTime() + 3600_000));
  store.tick(new Date(base.getTime() + 2 * 3600_000));
  postAt(p.id, author.id, 'Day two.', new Date(base.getTime() + DAY + 3600_000));
  store.tick(new Date(base.getTime() + DAY + 3 * 3600_000));
  check('daily: a summary each day there is news', summaries(daily.id).length === 2, JSON.stringify(summaries(daily.id)));
  check('off: never a summary', summaries(off.id).length === 0);
}

{
  db.prepare("INSERT INTO notifications (id, user_id, type, actor_id, issue_id, project_id, body, created_at) VALUES ('n_old_pulse', ?, 'pulseDigest', NULL, NULL, NULL, '3 project updates since your last summary', ?)").run(person.id, new Date().toISOString());
  db.close();
  const reopened = createApp(dbPath, { mode: 'local' }, { configured: false, send: async () => {} });
  const row = reopened.db.prepare("SELECT type FROM notifications WHERE id = 'n_old_pulse'").get() as { type: string } | undefined;
  check('opening an older database renames Pulse summaries to updatesDigest', row?.type === 'updatesDigest', row?.type);
  reopened.db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
