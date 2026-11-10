import { connect } from '../src/client/index.js';
import { openDb } from '../src/core/db.js';
import { mentionToken } from '../src/core/mentions.js';
import { Store } from '../src/core/store.js';

export interface Morning { review: string; blocked: string; mention: string; working: string; agentId: string; mentionCommentId: string }

export async function seedMorning(dbPath: string): Promise<Morning> {
  const bl = await connect({ db: dbPath });
  const snap = await bl.snapshot(['users', 'currentUser', 'teams', 'issues']);
  const me = snap.currentUser;
  const ada = snap.users.find(u => u.name.startsWith('Ada'))!;
  const byTitle = (t: string) => snap.issues.find(i => i.title.startsWith(t))!;
  const review = byTitle('Cmd+K fuzzy search scoring');
  const blocked = byTitle('Concurrent writer safety');
  const mention = byTitle('Theme switching without reload');
  const working = byTitle('CLI surface');
  const agent = await bl.ensureAgentUser('Claude Code');
  const session = null;
  const key = (i: { teamId: string; number: number }) => `${snap.teams.find(t => t.id === i.teamId)!.key}-${i.number}`;

  const started = await bl.startWork(review.id, { session }, agent.id);
  await bl.postProgress(review.id, { session, did: 'Scorer in search.ts and 14 new tests; the palette uses it for issues and actions', links: [] }, agent.id);
  for (const title of ['Search skips archived issues; offer them last instead', 'The palette flickers when the result count changes']) {
    await bl.propose({ session, kind: 'followup', teamId: review.teamId, title, fromIssueId: review.id }, agent.id);
  }
  await bl.finishWork(review.id, { session, outcome: 'in_review', summary: 'Weighted prefix, word and fuzzy matches; ties broken by recency.', left: 'Tune the typo threshold on real data.', links: [] }, agent.id);

  await bl.updateIssue(blocked.id, { assigneeId: me.id }, me.id);
  await bl.startWork(blocked.id, { session }, agent.id);
  await bl.postProgress(blocked.id, { session, did: 'WAL mode on; a repro test that fails 3 runs in 10.', blocked: 'Two writers hit SQLITE_BUSY under load. Should I add a retry, or route every write through a single writer queue?', links: [] }, agent.id);

  await bl.startWork(working.id, { session }, agent.id);
  await bl.postProgress(working.id, { session, did: 'list --json', left: 'search flags', links: [] }, agent.id);

  const comment = await bl.addComment(mention.id, ada.id, `${mentionToken(me.name, me.id)} should the theme persist per device or per account?`, null);

  const db = openDb(dbPath);
  const store = new Store(db);
  const k = key(review);
  store.ext.git.ingestPullRequest({ repo: 'example/baseline', number: 41, title: `${k} Cmd+K scoring`, body: `Closes ${k}`, url: 'https://github.com/example/baseline/pull/41', state: 'open', branch: started.branch, base: 'main', author: 'parth', reviewDecision: 'review_required', checks: 'success', updatedAt: new Date().toISOString(), mergedAt: null });
  store.ext.git.ingestPush([1, 2, 3].map(n => ({ sha: `c0ffee${n}`.padEnd(40, '0'), repo: 'example/baseline', message: `${k}: scoring step ${n}`, author: 'parth', branch: started.branch, committedAt: new Date().toISOString() })));
  db.close();

  return { review: review.id, blocked: blocked.id, mention: mention.id, working: working.id, agentId: agent.id, mentionCommentId: comment.id };
}

if (process.argv[1]?.endsWith('tui-fixture.ts')) {
  const path = process.argv[2] ?? process.env.BASELINE_DB;
  if (!path) { console.error('usage: tsx scripts/tui-fixture.ts <db path>'); process.exit(1); }
  const m = await seedMorning(path);
  console.log(`morning seeded: ${JSON.stringify(m)}`);
}
