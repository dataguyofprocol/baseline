import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/index.js';
import { actingUser, attributionOf } from '../src/core/actor.js';
import { laneOf } from '../src/core/work.js';
import { inboxRows } from '../src/core/inbox.js';
import { mentionToken } from '../src/core/mentions.js';
import type { Notification } from '../src/core/types.js';

const work = mkdtempSync(join(tmpdir(), 'baseline-notify-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const { store, db, app } = createApp(join(work, 'local.db'), { mode: 'local' }, { configured: false, send: async () => {} });

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};
type Row = { type: string; actor_id: string | null; issue_id: string | null; body: string };
const inbox = (userId: string, issueId?: string) => (db.prepare(`SELECT type, actor_id, issue_id, body FROM notifications WHERE user_id = ?${issueId ? ' AND issue_id = ?' : ''} ORDER BY created_at, rowid`)
  .all(...(issueId ? [userId, issueId] : [userId])) as Row[]);
const types = (rows: Row[]) => rows.map(r => r.type).join(',');
const as = <T>(userId: string, fn: () => T): T => actingUser.run(userId, fn);

const parth = store.createUser('Parth Notify', 'parth-n@example.com');
const ada = store.createUser('Ada Notify', 'ada-n@example.com');
const jun = store.createUser('Jun Notify', 'jun-n@example.com');
const agent = store.createUser('Claude Code via Parth Notify', '', false, 'agent');
const team = store.createTeam('NTF', 'Notify');
const w = store.ext.work;
const who = attributionOf({ id: agent.id, kind: 'agent' }, parth.id);
const lane = laneOf(who, null);

{
  const issue = as(ada.id, () => store.createIssue({ teamId: team.id, title: 'Agent run' }, ada.id));
  store.subscribe(issue.id, parth.id);
  w.start(issue.id, lane, who);
  w.progress(issue.id, lane, { did: 'wired **the** thing', left: 'tests' }, [], who);
  w.progress(issue.id, lane, { did: 'wired the thing', left: 'docs' }, [], who);
  check('start/progress by Parth\'s own agent: nothing in Parth\'s inbox', inbox(parth.id, issue.id).length === 0, types(inbox(parth.id, issue.id)));
  check('Ada (another follower) hears about the agent\'s moves', inbox(ada.id, issue.id).some(r => r.type === 'issueStatusChanged'), types(inbox(ada.id, issue.id)));
  w.finish(issue.id, lane, { outcome: 'in_review', summary: 'Added the **retry** loop', links: [] }, who);
  const fin = inbox(parth.id, issue.id);
  check('finish in_review: Parth gets one "Ready for your review" (the exception)', fin.length === 1 && fin[0].type === 'agentFinished' && fin[0].body === 'Ready for your review: Added the retry loop', JSON.stringify(fin));
  check('it is from the agent', fin[0]?.actor_id === agent.id);
}
{
  const issue = as(ada.id, () => store.createIssue({ teamId: team.id, title: 'Owned by Jun' }, ada.id));
  w.start(issue.id, lane, who);
  as(ada.id, () => store.updateIssue(issue.id, { assigneeId: jun.id }));
  w.finish(issue.id, lane, { outcome: 'done', summary: 'Shipped', links: [] }, who);
  check('finish done: the assignee gets "Done: …"', inbox(jun.id, issue.id).some(r => r.type === 'agentFinished' && r.body === 'Done: Shipped'), types(inbox(jun.id, issue.id)));
  check('… and the person the agent works for doesn\'t (not the owner)', !inbox(parth.id, issue.id).some(r => r.type === 'agentFinished'));
}
{
  const issue = as(parth.id, () => store.createIssue({ teamId: team.id, title: 'Gets stuck' }, parth.id));
  w.start(issue.id, lane, who);
  w.progress(issue.id, lane, { blocked: 'needs the staging key' }, [], who);
  w.progress(issue.id, lane, { did: 'more', blocked: 'needs the staging key' }, [], who);
  const blocked = inbox(parth.id, issue.id).filter(r => r.type === 'agentBlocked');
  check('a new blocker reaches Parth once', blocked.length === 1 && blocked[0].body === 'Blocked: needs the staging key', JSON.stringify(blocked));
  w.finish(issue.id, lane, { outcome: 'stopped', summary: 'Gave up', left: 'the migration', links: [] }, who);
  check('stopped reaches Parth', inbox(parth.id, issue.id).some(r => r.type === 'agentBlocked' && r.body === 'Stopped: the migration'));
  check('nothing else from his own agent', inbox(parth.id, issue.id).every(r => r.type === 'agentBlocked'), types(inbox(parth.id, issue.id)));
}
{
  const issue = as(parth.id, () => store.createIssue({ teamId: team.id, title: 'By hand', assigneeId: parth.id }, parth.id));
  const me = attributionOf({ id: parth.id, kind: 'human' }, parth.id);
  w.start(issue.id, laneOf(me, null), me);
  w.finish(issue.id, laneOf(me, null), { outcome: 'done', summary: 'Did it myself', links: [] }, me);
  check('finishing your own work: no notification to yourself', inbox(parth.id, issue.id).length === 0, types(inbox(parth.id, issue.id)));
}

{
  const issue = as(ada.id, () => store.createIssue({ teamId: team.id, title: 'Mention me' }, ada.id));
  as(ada.id, () => store.addComment(issue.id, ada.id, `Thoughts, ${mentionToken(jun.name, jun.id)}?`));
  check('a mention notifies once', types(inbox(jun.id, issue.id)) === 'issueMentioned', types(inbox(jun.id, issue.id)));
  check('the mention body is plain text (no token)', inbox(jun.id, issue.id)[0]?.body === `Thoughts, @${jun.name}?`, inbox(jun.id, issue.id)[0]?.body);
  check('a mention does not subscribe', !store.isSubscribed(issue.id, jun.id));
  const todo = store.stateOfType(team.id, 'started')!;
  as(ada.id, () => store.updateIssue(issue.id, { stateId: todo }, ada.id));
  check('… so later status changes don\'t reach them', inbox(jun.id, issue.id).length === 1, types(inbox(jun.id, issue.id)));
  as(jun.id, () => store.addComment(issue.id, jun.id, 'On it'));
  check('replying subscribes', store.isSubscribed(issue.id, jun.id));
  as(ada.id, () => store.updateIssue(issue.id, { stateId: store.stateOfType(team.id, 'completed')! }, ada.id));
  check('… and then status changes do reach them', inbox(jun.id, issue.id).some(r => r.type === 'issueStatusChanged'), types(inbox(jun.id, issue.id)));

  const c = as(ada.id, () => store.addComment(issue.id, ada.id, 'No mention yet'));
  const before = inbox(parth.id, issue.id).length;
  as(ada.id, () => store.updateComment(c.id, `No mention yet, ${mentionToken(parth.name, parth.id)}`));
  check('editing a comment to add a mention notifies the new person', inbox(parth.id, issue.id).length === before + 1 && inbox(parth.id, issue.id).at(-1)?.type === 'issueMentioned', types(inbox(parth.id, issue.id)));
  as(ada.id, () => store.updateComment(c.id, `No mention yet, ${mentionToken(parth.name, parth.id)}!`));
  check('… once: editing again doesn\'t re-notify', inbox(parth.id, issue.id).length === before + 1);

  const described = as(ada.id, () => store.createIssue({ teamId: team.id, title: 'Described', description: `cc ${mentionToken(parth.name, parth.id)}` }, ada.id));
  check('a mention in a new issue\'s description notifies, without subscribing', types(inbox(parth.id, described.id)) === 'issueMentioned' && !store.isSubscribed(described.id, parth.id), types(inbox(parth.id, described.id)));
}

{
  const issue = as(parth.id, () => store.createIssue({ teamId: team.id, title: 'Mine', assigneeId: parth.id }, parth.id));
  as(parth.id, () => store.updateIssue(issue.id, { stateId: store.stateOfType(team.id, 'started')! }, parth.id));
  as(parth.id, () => store.addComment(issue.id, parth.id, `note to ${mentionToken(parth.name, parth.id)}`));
  check('your own assign, status change, comment and self-mention: nothing', inbox(parth.id, issue.id).length === 0, types(inbox(parth.id, issue.id)));
}

{
  const issue = as(ada.id, () => store.createIssue({ teamId: team.id, title: 'Churn' }, ada.id));
  store.subscribe(issue.id, jun.id);
  store.setPreferences({ notify: { ...store.getPreferences(jun.id).notify, statusChanged: false } }, jun.id);
  as(ada.id, () => store.updateIssue(issue.id, { stateId: store.stateOfType(team.id, 'started')! }, ada.id));
  check('status changes muted: none in the inbox', inbox(jun.id, issue.id).length === 0, types(inbox(jun.id, issue.id)));
  as(ada.id, () => store.addComment(issue.id, ada.id, 'still hear comments'));
  check('… comments still arrive', types(inbox(jun.id, issue.id)) === 'issueCommented');
  store.setPreferences({ notify: { ...store.getPreferences(jun.id).notify, statusChanged: true } }, jun.id);
}

{
  const p = store.createProject({ name: 'Notify project' });
  store.setProjectSubscription(p.id, jun.id, { updates: true });
  store.setProjectSubscription(p.id, parth.id, { updates: true });
  store.setPreferences({ updatesSummary: 'off' }, parth.id);
  store.addProjectUpdate(p.id, ada.id, '**Shipped** the thing');
  check('summaries on (default): no single update row', !inbox(jun.id).some(r => r.type === 'projectUpdate'));
  const single = inbox(parth.id).filter(r => r.type === 'projectUpdate');
  check('summaries off: one single row, as plain text', single.length === 1 && single[0].body === 'New update on Notify project: Shipped the thing', JSON.stringify(single));
  const ini = store.ext.planning.createInitiative({ name: 'Notify initiative', ownerId: ada.id });
  store.ext.planning.addInitiativeUpdate(ini.id, parth.id, 'Initiative going fine');
  check('initiative updates reach its owner, not an IC who posted or isn\'t on it', inbox(ada.id).some(r => r.body.startsWith('New update on Notify initiative')) && !inbox(jun.id).some(r => r.body.startsWith('New update on Notify initiative')));
}

{
  const issue = as(ada.id, () => store.createIssue({ teamId: team.id, title: 'Markdown' }, ada.id));
  store.subscribe(issue.id, jun.id);
  as(ada.id, () => store.addComment(issue.id, ada.id, '**Progress**\n\n**Did:**\n- `npm test` passes\n- see [PR](https://x.test/1)'));
  const b = inbox(jun.id, issue.id)[0]?.body;
  check('comment previews are plain text', b === 'Progress Did: npm test passes see PR', b);
}

{
  const issue = as(ada.id, () => store.createIssue({ teamId: team.id, title: 'Busy issue', assigneeId: jun.id }, ada.id));
  as(ada.id, () => store.updateIssue(issue.id, { stateId: store.stateOfType(team.id, 'started')! }, ada.id));
  as(ada.id, () => store.addComment(issue.id, ada.id, 'first'));
  as(parth.id, () => store.addComment(issue.id, parth.id, 'second'));
  const mine = as(jun.id, () => store.listNotifications()).filter(n => n.issueId === issue.id);
  const rows = inboxRows(mine);
  check('three kinds of event on one issue: one row', mine.length === 4 && rows.length === 1, `${mine.length} notifications, ${rows.length} rows`);
  check('the row leads with the latest headline', rows[0]?.lead.body === 'second' && rows[0].count === 4, JSON.stringify(rows[0]?.lead));
  check('it stacks both actors', rows[0]?.actorIds.length === 2);
  as(jun.id, () => { for (const id of rows[0].ids.slice(1)) store.markNotificationRead(id); });
  check('unread while any merged event is unread', inboxRows(as(jun.id, () => store.listNotifications()).filter(n => n.issueId === issue.id))[0].unread);
  const res = await actingUser.run(jun.id, () => app.request('/api/notifications'));
  const body = await res.json() as { notifications: Notification[]; rows: Array<{ key: string; ids: string[] }> };
  check('GET /api/notifications keeps `notifications` and adds one row per issue', Array.isArray(body.notifications) && body.rows.filter(r => r.key === `issue:${issue.id}`).length === 1
    && body.rows.find(r => r.key === `issue:${issue.id}`)!.ids.length === 4, JSON.stringify(body.rows.slice(0, 2)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
