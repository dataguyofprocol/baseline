// Journey: create an issue from the browser with C → type title → ⌘↵, then prove it landed.
// Run: node scripts/drive.mjs <run> eval /team/CORE/all journeys/create-issue.js --name create-issue
// `t` is the journey harness (scripts/journey-harness.js). Returns what it saw; throws on failure.
const title = 'Verify: created from C ' + Date.now();
await t.nav('/team/CORE/all', 800);
const rowsBefore = t.rows();
await t.press('c', {}, 700);
const modal = t.q('.cm-root');
if (!modal) t.fail('C did not open the create modal (.cm-root)');
const chips = modal.innerText;
for (const want of ['CORE', 'Create issue']) if (!chips.includes(want)) t.fail(`modal missing "${want}"`);
await t.type(modal.querySelector('input, textarea'), title, 300);
t.key('Enter', { meta: true });
await t.sleep(1400);
if (t.q('.cm-root')) t.fail('modal still open after ⌘↵ (create-more should be off)');
// second view 1: the server snapshot
const snap = await t.snap();
const issue = snap.issues.find(i => i.title === title);
if (!issue) t.fail('issue not in /api/bootstrap after ⌘↵');
const team = snap.teams.find(x => x.id === issue.teamId);
const key = `${team.key}-${issue.number}`;
// second view 2: the list the user is looking at
await t.sync();
const listed = t.text().includes(title);
if (!listed) t.fail('new issue not shown in the CORE issue list');
// third view: open it the way a user would
await t.nav('/issue/' + key, 900);
const heading = (t.q('.issue-title, h1, [contenteditable] h1, textarea')?.value ?? t.text());
if (!String(heading).includes(title) && !t.text().includes(title)) t.fail('issue page does not show the title');
return { title, key, rowsBefore, listedInTeamList: listed, issuePage: location.hash };
