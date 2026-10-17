import type { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { getMeta, setMeta } from './db.js';
import { id, nowIso } from './util.js';
import { Store } from './store.js';
import type { Priority } from './types.js';

/** who you are on a fresh machine: git's user.name, else the login name */
function localUserName(): string {
  try { const n = execFileSync('git', ['config', '--global', 'user.name'], { encoding: 'utf8', timeout: 2000 }).trim(); if (n) return n; } catch { /* no git or no name */ }
  try { const n = userInfo().username; return n.charAt(0).toUpperCase() + n.slice(1); } catch { return 'You'; }
}

/** A workspace with nothing in it but you and Claude Code — the web app's first run, where
 *  onboarding names the first team and offers the sample data. */
export function blankWorkspace(db: DatabaseSync, opts: { workspaceName?: string; userName?: string } = {}): void {
  const store = new Store(db);
  store.wipe();
  setMeta(db, 'workspaceId', id('w'));
  setMeta(db, 'workspaceName', opts.workspaceName ?? 'Baseline');
  setMeta(db, 'workspaceCreatedAt', nowIso());
  const me = store.createUser(opts.userName ?? localUserName(), '', true);
  setMeta(db, 'currentUser', me.id);
  store.claudeCodeUserId();
  store.setPreferences({ gettingStarted: { onboarding: 'pending', step: 0, since: null, usedPalette: false } });
}

/** The sample workspace. `into` adds it to the workspace as it stands — your teams, locations
 *  and settings stay, and you are the sample's "me" — instead of wiping first. */
export function seedWorkspace(db: DatabaseSync, opts: { workspaceName?: string; userName?: string; into?: boolean } = {}): void {
  const store = new Store(db);
  if (!opts.into) store.wipe();

  const now = Date.now();
  const iso = (offsetDays: number) => new Date(now + offsetDays * 86400_000).toISOString();

  if (!opts.into) {
    const workspaceName = opts.workspaceName ?? 'Baseline';
    setMeta(db, 'workspaceId', id('w'));
    setMeta(db, 'workspaceName', workspaceName);
    setMeta(db, 'workspaceCreatedAt', iso(-30));
  }
  setMeta(db, 'seededAt', iso(0));

  // members
  const current = opts.into ? store.snapshot().users.find(u => u.id === getMeta(db, 'currentUser')) : undefined;
  const me = current ?? store.createUser(opts.userName ?? 'Parth Batra', 'parth@local', true);
  const ada = store.createUser('Ada Osei', 'ada@local');
  const jun = store.createUser('Jun Watanabe', 'jun@local');
  const agent = store.createUser('Agent', 'agent@local', false, 'agent');
  store.updateUser(agent.id, { color: '#4cb782' });
  setMeta(db, 'currentUser', me.id);

  // teams with default workflow states (a key you already use gets a number)
  const taken = new Set(store.snapshot().teams.map(t => t.key));
  const freeKey = (k: string) => { let n = 2, key = k; while (taken.has(key)) key = `${k}${n++}`; taken.add(key); return key; };
  const core = store.createTeam(freeKey('CORE'), 'Core', '◆', '#5e6ad2');
  const agents = store.createTeam(freeKey('AGO'), 'Agent Surface', '🤖', '#c770f4');

  // labels (Linear default trio per team + extras)
  const coreBug = store.createLabel(core.id, 'Bug', '#eb5757');
  const coreFeature = store.createLabel(core.id, 'Feature', '#a78bfa');
  const coreImprovement = store.createLabel(core.id, 'Improvement', '#3b82f6');
  const agentsBug = store.createLabel(agents.id, 'Bug', '#eb5757');
  const agentsFeature = store.createLabel(agents.id, 'Feature', '#a78bfa');
  store.createLabel(core.id, 'Performance', '#f2994a');

  const states = (teamId: string) => {
    const snap = store.snapshot();
    return snap.states.filter(s => s.teamId === teamId);
  };
  const st = (teamId: string, type: string) => states(teamId).find(s => s.type === type)!.id;

  // projects
  const project = store.createProject({
    name: 'Agent Handoff', teamId: core.id, summary: 'Coding agents pick up, work and close issues without the UI.',
    description: 'Make the workspace fully drivable by coding agents: a first-class CLI, handoff briefs and machine-friendly issue keys.',
    icon: '🤖', leadId: me.id, startDate: iso(-7), targetDate: iso(23), priority: 2,
  });
  const mobile = store.createProject({
    name: 'Mobile Companion', teamId: core.id, summary: 'Triage on the go: inbox, my issues and search on a phone.',
    description: 'Read-only mobile web app for triaging issues on the go — inbox, my issues and search.',
    icon: '📱', leadId: ada.id, startDate: iso(3), targetDate: iso(45), priority: 3,
  });
  const design = store.createProject({
    name: 'Design System 2.0', teamId: null, summary: 'One set of tokens, motion and icons for every surface.',
    description: 'Consolidate tokens, motion and iconography across web and mobile surfaces.',
    icon: '🎨', leadId: jun.id, targetDate: iso(60), priority: 4,
  });

  // cycles for core: previous (done), current, upcoming
  const prevCycle = store.createCycle(core.id, 21, iso(-17), iso(-10), 'Cycle 21');
  db.prepare('UPDATE cycles SET completed_at = ? WHERE id = ?').run(iso(-10), prevCycle.id);
  const currentCycle = store.createCycle(core.id, 22, iso(-3), iso(4), 'Cycle 22');
  const upcomingCycle = store.createCycle(core.id, 23, iso(4), iso(11), 'Cycle 23');

  const issue = (teamId: string, title: string, o: Partial<{ state: string; priority: Priority; assignee: string | null; labels: string[]; project: string | null; cycle: string | null; parent: string | null; estimate: number | null; due: number | null; description: string; createdDaysAgo: number }> = {}) => {
    const created = store.createIssue({
      teamId, title, description: o.description ?? '',
      stateId: o.state ? st(teamId, o.state) : undefined,
      priority: o.priority ?? 0,
      assigneeId: o.assignee === undefined ? me.id : o.assignee,
      projectId: o.project ?? null,
      cycleId: o.cycle ?? null,
      parentId: o.parent ?? null,
      estimate: o.estimate ?? null,
      dueDate: o.due != null ? iso(o.due) : null,
      labelIds: o.labels ?? [],
    });
    if (o.createdDaysAgo) {
      db.prepare('UPDATE issues SET created_at = ?, updated_at = ? WHERE id = ?').run(iso(-o.createdDaysAgo), iso(-o.createdDaysAgo), created.id);
      db.prepare("UPDATE activity SET created_at = ? WHERE issue_id = ? AND type = 'created'").run(iso(-o.createdDaysAgo), created.id);
    }
    return created;
  };

  // core issues
  const theme = issue(core.id, 'Theme switching without reload', { state: 'started', priority: 2, labels: [coreImprovement.id], project: project.id, cycle: currentCycle.id, estimate: 5, due: 3, createdDaysAgo: 6, description: 'CSS custom properties on `:root[data-theme]` so toggling swaps instantly.\n\n- [x] token audit\n- [ ] swap handler\n- [ ] persistence' });
  issue(core.id, 'Keyboard-first issue triage', { state: 'started', priority: 3, labels: [coreFeature.id], assignee: ada.id, cycle: currentCycle.id, estimate: 3, createdDaysAgo: 5 });
  issue(core.id, 'Grouped list virtualization', { state: 'unstarted', priority: 3, labels: [coreImprovement.id], assignee: jun.id, project: project.id, cycle: upcomingCycle.id, createdDaysAgo: 4 });
  issue(core.id, 'Cmd+K fuzzy search scoring', { state: 'unstarted', priority: 1, labels: [coreFeature.id], project: project.id, cycle: currentCycle.id, estimate: 2, due: 2, createdDaysAgo: 3 });
  issue(core.id, 'Undo toasts for destructive actions', { state: 'unstarted', priority: 4, labels: [coreImprovement.id], cycle: upcomingCycle.id, createdDaysAgo: 2 });
  issue(core.id, 'Issue row hover toolbar', { state: 'backlog', priority: 4, labels: [coreImprovement.id], createdDaysAgo: 9 });
  issue(core.id, 'Saved views in sidebar', { state: 'backlog', priority: 3, labels: [coreFeature.id], assignee: jun.id, createdDaysAgo: 8 });
  issue(core.id, 'Drag to reorder in manual ordering', { state: 'backlog', priority: 4, createdDaysAgo: 10 });
  issue(core.id, 'Duplicate issue action', { state: 'canceled', priority: 4, createdDaysAgo: 12 });
  issue(core.id, 'Milestone display on board cards', { state: 'completed', priority: 3, labels: [coreFeature.id], createdDaysAgo: 14 });
  issue(core.id, 'Sub-issue progress ring on parent rows', { state: 'completed', priority: 2, labels: [coreImprovement.id], createdDaysAgo: 13 });
  issue(core.id, 'Relative timestamps everywhere', { state: 'completed', priority: 4, assignee: ada.id, createdDaysAgo: 15 });

  // sub-issues under the theme work
  issue(core.id, 'Audit color tokens for both themes', { state: 'completed', priority: 2, parent: theme.id, assignee: me.id, estimate: 2, createdDaysAgo: 6 });
  issue(core.id, 'Swap handler without remount', { state: 'started', priority: 2, parent: theme.id, assignee: me.id, estimate: 3, due: 1, createdDaysAgo: 5 });
  issue(core.id, 'Persist theme choice per device', { state: 'unstarted', priority: 3, parent: theme.id, estimate: 1, createdDaysAgo: 4 });

  // agent surface issues
  const cli = issue(agents.id, 'CLI surface: create/update/list/search issues', { state: 'started', priority: 1, labels: [agentsFeature.id], project: project.id, estimate: 5, createdDaysAgo: 4, description: 'One CLI covering the whole store so coding agents never need the UI.\n\n| command group | notes |\n| --- | --- |\n| issue create/update/list | key printed on create |\n| issue show --json | full detail, parseable |\n| search | title match |' });
  issue(agents.id, 'CLI parity with REST surface', { state: 'unstarted', priority: 2, labels: [agentsFeature.id], assignee: ada.id, project: project.id, createdDaysAgo: 3 });
  issue(agents.id, 'JSON export/import round-trip', { state: 'unstarted', priority: 3, labels: [agentsFeature.id], createdDaysAgo: 2 });
  issue(agents.id, 'Concurrent writer safety (WAL)', { state: 'unstarted', priority: 1, labels: [agentsBug.id], assignee: jun.id, due: 1, createdDaysAgo: 1 });
  issue(agents.id, 'Notifications generated from agent actions', { state: 'backlog', priority: 4, labels: [agentsFeature.id], createdDaysAgo: 7 });

  // mobile companion issues
  issue(core.id, 'Mobile inbox layout', { state: 'unstarted', priority: 3, labels: [coreFeature.id], project: mobile.id, assignee: ada.id, createdDaysAgo: 2 });
  issue(core.id, 'Touch-friendly issue peek', { state: 'backlog', priority: 4, labels: [coreFeature.id], project: mobile.id, createdDaysAgo: 1 });

  // relations: the CLI surface blocks CLI parity with the REST API
  const cliIssue = store.listIssues({ teamId: agents.id }).find(i => i.title.startsWith('CLI parity'));
  if (cliIssue) store.setRelation(cli.id, cliIssue.id, 'blocks');

  // milestones on the flagship project, with its issues spread across them
  const alpha = store.createMilestone(project.id, 'Alpha: agent-driven triage', iso(7));
  const beta = store.createMilestone(project.id, 'Beta: hand-off loop', iso(20));
  for (const i of store.listIssues({}).filter(x => x.projectId === project.id)) {
    store.updateIssue(i.id, { milestoneId: /CLI|Cmd\+K/.test(i.title) ? alpha.id : beta.id });
  }
  db.prepare("DELETE FROM activity WHERE type = 'milestoneChanged'").run();
  store.addProjectLink(project.id, 'https://github.com/anthropics/claude-code', 'Claude Code');
  // documents: a spec on the flagship project, a runbook and a link on the Core team's home
  store.createDoc({ projectId: project.id, title: 'Hand-off spec', content: '## Problem\n\nAgents need to pick up an issue, work it and close it without opening the app.\n\n## Approach\n\n- `baseline issue start` claims the issue and moves it to In Progress\n- the hand-off prompt carries the description, comments and location\n- `baseline issue done` closes it with a summary comment\n\n## Open questions\n\n- [ ] Should agents be able to decline work?\n' }, ada.id);
  store.createDoc({ teamId: core.id, title: 'Release runbook', content: '1. Cut the release branch\n2. Run `npm run build` and the CLI test suite\n3. Tag and publish\n' }, me.id);
  store.addTeamLink(core.id, 'https://github.com/anthropics/claude-code', 'Repository');
  // the mobile app waits on the design system's tokens
  store.addProjectDependency(design.id, mobile.id);
  // project labels (one group, whose labels are exclusive), a custom status, an update schedule
  const area = store.createProjectLabel({ name: 'Area', isGroup: true, color: '#8a8f98' });
  const lAgents = store.createProjectLabel({ name: 'Agents', parentId: area.id, color: '#c770f4' });
  const lApps = store.createProjectLabel({ name: 'Apps', parentId: area.id, color: '#3b82f6' });
  const lQ4 = store.createProjectLabel({ name: 'Q4 bet', color: '#f2994a' });
  store.updateProject(project.id, { labelIds: [lAgents.id, lQ4.id], updateCadence: 'weekly' });
  store.updateProject(mobile.id, { labelIds: [lApps.id] });
  store.createProjectStatus({ type: 'started', name: 'In Review', color: '#4cb782' });
  store.setFeatures({ customerRequestsEnabled: true });
  const acme = store.createCustomer({ name: 'Acme Robotics', domains: ['acme.dev'], revenue: 240000, size: 120, ownerId: ada.id });
  const north = store.createCustomer({ name: 'Northwind', domains: ['northwind.io'], revenue: 60000, size: 30 });
  store.addCustomerRequest({ customerId: acme.id, projectId: mobile.id, body: 'Our on-call team triages from phones — need the inbox on mobile.', important: true }, ada.id);
  const reqIssue = store.listIssues({ teamId: core.id }).find(i => /search/i.test(i.title));
  if (reqIssue) store.addCustomerRequest({ customerId: north.id, issueId: reqIssue.id, body: 'Search should match comment text too.' }, jun.id);
  // initiatives, releases, SLAs, asks, loops and a few pull requests
  const { planning, automation, git } = store.ext;
  // finished work gets completion times spread over past weeks (initiative graphs and activity read them)
  const finished = store.listIssues({ teamId: core.id, stateType: 'completed' });
  finished.forEach((i, n) => {
    db.prepare('UPDATE issues SET completed_at = ?, project_id = COALESCE(project_id, ?) WHERE id = ?').run(iso(-(1.5 + n * 9)), n % 2 ? design.id : project.id, i.id);
  });
  store.updateProject(project.id, { status: 'started' });
  store.updateProject(design.id, { status: 'started' });
  store.addProjectUpdate(design.id, jun.id, 'Tokens are in; icon redraw slipped a week.', 'atRisk');
  // targets use Linear's resolutions: the end of a quarter / half / year
  const today = new Date(); const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const quarterEnd = ymd(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 0));
  const halfEnd = ymd(new Date(today.getFullYear(), today.getMonth() < 6 ? 6 : 12, 0));
  const yearEnd = ymd(new Date(today.getFullYear() + 1, 12, 0));
  const agentFirst = planning.createInitiative({ name: 'Agent-first tracker', icon: 'glyph:sparkles', color: '#5e6ad2', status: 'active', summary: 'The place coding agents and people share work.', description: 'Make Baseline the place coding agents and people share work: hand-offs, PR status and review in one loop.', targetDate: quarterEnd, targetResolution: 'quarter', projectIds: [project.id, design.id] });
  const lStrategy = planning.createLabel({ name: 'Company bet', color: '#9b6ef3' });
  const lGrowth = planning.createLabel({ name: 'Growth', color: '#4cb782' });
  planning.updateInitiative(agentFirst.id, { priority: 1, labelIds: [lStrategy.id], teamId: core.id, updateCadence: 'weekly' });
  planning.addLink(agentFirst.id, 'https://linear.app/docs/initiatives', 'Linear: initiatives');
  const firstUpdate = planning.addInitiativeUpdate(agentFirst.id, ada.id, 'Hand-off loop is in beta; design tokens land next week.', 'onTrack');
  planning.toggleUpdateReaction(firstUpdate.id, '🚀', jun.id);
  const onTheGo = planning.createInitiative({ name: 'Triage on the go', icon: 'glyph:phone', color: '#26b5ce', status: 'planned', summary: 'Inbox and triage from a phone, for on-call.', parentId: agentFirst.id, targetDate: halfEnd, targetResolution: 'half', projectIds: [mobile.id] });
  planning.updateInitiative(onTheGo.id, { priority: 2, labelIds: [lGrowth.id], teamId: agents.id });
  planning.addInitiativeUpdate(onTheGo.id, jun.id, 'Waiting on the inbox API; design is ready.', 'atRisk');
  planning.createInitiative({ priority: 3, labelIds: [lGrowth.id], name: 'Developer love', icon: 'glyph:heart', color: '#e255a1', status: 'planned', summary: 'Docs, a CLI people brag about, and one-command self-hosting.', targetDate: yearEnd, targetResolution: 'year' });
  const coreIssues = store.listIssues({ teamId: core.id });
  const done = coreIssues.filter(i => st(core.id, 'completed') === i.stateId).slice(0, 2);
  const open = coreIssues.filter(i => [st(core.id, 'unstarted'), st(core.id, 'started')].includes(i.stateId)).slice(0, 3);
  const v09 = planning.createRelease({ name: 'v0.9.0', description: 'Rich editor and triage', stage: 'released' });
  const v10 = planning.createRelease({ name: 'v1.0.0', description: 'Projects and cycles parity', stage: 'started', targetDate: iso(10).slice(0, 10) });
  for (const i of done) store.updateIssue(i.id, { releaseId: v09.id });
  for (const i of open) store.updateIssue(i.id, { releaseId: v10.id });
  automation.createSlaRule({ name: 'Urgent issues', priorities: [1], hours: 24 });
  automation.createSlaRule({ name: 'High-priority bugs', priorities: [2], labelIds: [coreBug.id], hours: 7 * 24 });
  automation.createAskForm({ name: 'Bug report', teamId: agents.id, description: 'Something broken? Tell us what you saw.', priority: 2,
    fields: [{ id: 'f_title', label: 'What went wrong?', type: 'text', options: [], required: true }, { id: 'f_steps', label: 'Steps to reproduce', type: 'textarea', options: [], required: false }, { id: 'f_sev', label: 'How bad is it?', type: 'select', options: ['Blocking', 'Annoying', 'Cosmetic'], required: true }] });
  automation.createLoop({ name: 'Bug acknowledgement', teamId: core.id, trigger: { kind: 'labelAdded', labelId: coreBug.id }, actions: [{ kind: 'comment', body: 'Thanks — {issue.key} is queued for the bug rotation.' }] });
  if (open[0]) git.ingestPullRequest({ repo: 'example/baseline', number: 41, title: `${store.keyOf(open[0])} ${open[0].title}`, body: '', url: 'https://github.com/example/baseline/pull/41', state: 'open', branch: `parth/${store.keyOf(open[0]).toLowerCase()}`, base: 'main', author: 'parth', reviewDecision: 'review_required', checks: 'success', updatedAt: iso(-0.1), mergedAt: null });
  store.createDocTemplate({ name: 'Spec', title: 'Spec: ', content: '## Problem\n\n## Proposal\n\n## Open questions\n' });
  store.createProjectTemplate({
    name: 'Feature launch', icon: '🚀', summary: 'Ship a feature from spec to rollout.', priority: 2,
    description: '## Goal\n\n## Scope\n\n## Rollout\n',
    milestones: ['Spec signed off', 'Beta', 'General availability'],
    issues: ['Write the spec', 'Build behind a flag', 'Beta feedback round', 'Docs and changelog'],
  });

  // triage on the agent team: two issues an agent filed through the CLI wait for review
  store.updateTeam(agents.id, { triageEnabled: true });
  const claude = store.claudeCodeUserId();
  store.createIssue({ teamId: agents.id, title: 'Flaky: `issue list --json` drops archived children', description: 'Seen twice while closing out CORE-24 — the JSON output omits sub-issues whose parent was archived.' }, claude);
  store.createIssue({ teamId: agents.id, title: 'Expose cycle automation in the CLI', description: '`baseline team update --auto-cycles` would let agents set up a team end to end.' }, agent.id);

  // comments
  const first = store.listIssues({ teamId: core.id })[0];
  if (first) {
    store.addComment(first.id, ada.id, 'Token sheet is drafted — light theme needs a second pass before we ship the toggle.');
    store.addComment(first.id, me.id, 'Agreed. Menu surfaces sample `#212122`, modals `#1a1a1b`.');
  }

  // inbox: every notification shape the design calls for — a mention, an assignment
  // with its actor, two actors on one issue (the punched-gap stack), a plain comment,
  // and a system row with no human actor (that one signs with the app's tile).
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
  const themeKey = theme.id;
  const cmdk = store.listIssues({ teamId: core.id }).find(i => i.title.startsWith('Cmd+K'));
  const wal = store.listIssues({ teamId: agents.id }).find(i => i.title.startsWith('Concurrent writer'));
  store.notify('issueMentioned', { actorId: ada.id, issueId: cmdk?.id ?? themeKey, body: `@${me.name} scroll jumps a row when the list re-scores — can you take it?`, createdAt: hoursAgo(2) });
  store.notify('issueCommented', { actorId: jun.id, issueId: cmdk?.id ?? themeKey, body: 'Repro is the fuzzy re-rank, not the scroll container.', createdAt: hoursAgo(2.4) });
  store.notify('issueAssignedToYou', { actorId: jun.id, issueId: wal?.id ?? themeKey, body: 'You were assigned this issue', createdAt: hoursAgo(5) });
  store.notify('systemUpdate', { issueId: null, body: `Cycle ${prevCycle.number} closed — 3 issues rolled over into Cycle ${currentCycle.number}`, createdAt: hoursAgo(9) });
  store.notify('issueCommented', { actorId: ada.id, issueId: themeKey, body: 'Light theme needs a second pass before the toggle ships.', createdAt: hoursAgo(27) });
  store.notify('issueAssignedToYou', { actorId: ada.id, issueId: themeKey, body: 'You were assigned this issue', createdAt: hoursAgo(74) });

  // project update
  store.addProjectUpdate(project.id, me.id, 'Scope locked: CLI-first agent story, UI polish tracked in Core.', 'onTrack');

  // saved views
  store.createView('Urgent issues', { priority: [1] }, { icon: '🔴', groupBy: 'status', orderBy: 'priority' });
  store.createView('Recently updated', {}, { icon: '🕐', groupBy: 'none', orderBy: 'updated' });
  store.createView('My issues', { assigneeIds: [me.id] }, { teamId: null, icon: '🙋', groupBy: 'status', orderBy: 'priority' });

  // favorites
  store.toggleFavorite('project', project.id);
  store.toggleFavorite('view', store.snapshot().views[0].id);

  setMeta(db, 'seedVersion', '7');
  void nowIso;
}
