#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { serve } from '../server/index.js';
import { isDirectory, LaunchError, openInClaudeCode } from '../server/launch.js';
import { seedWorkspace } from '../core/seed.js';
import { plainMentions } from '../core/mentions.js';
import { hashPassword, passwordProblem } from '../core/passwords.js';
import { issueKey, initiativeKey, PRIORITY_SHORT, PRIORITY_LABELS, TERMINAL_APPS, API_KEY_SCOPES } from '../core/types.js';
import type { RelationType, Snapshot, Team, Project, Issue, Location, ApiKeyScope } from '../core/types.js';
import { BaselineError, connect, issueIndex, resolve, ResolveError, TargetError, targetFor, views, type Baseline } from '../client/index.js';
import { readSetupToken } from '../server/setup.js';
import { legacyApp, legacyStore, setLegacyCommand } from './legacy.js';
import { mountAccountCommands } from './login.js';
import { mountOperations } from './ops.js';
import { serveStdio } from '../mcp/server.js';
import { mountConnectCommand } from './connect.js';
import { agentContext, mountWorkflowCommands } from './workflow.js';
import { copyToClipboard } from './system.js';

const { priorityNum, resolveTeam, resolveState, resolveUser, resolveProject, resolveLabel, resolveCycle, milestoneIdFor } = resolve;
const { relationRows, invertRelation } = views;

const program = new Command();
program.name('baseline').description('Local issue & project tracker with a Linear-quality UI. Run `baseline` alone in a terminal to open the terminal UI.').version('0.1.0');

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function resolveLocationRef(store: ReturnType<typeof legacyStore>, ref: string): Location {
  if (resolve.isPathRef(ref)) {
    const path = localPath(ref);
    if (!isDirectory(path)) fail(`Directory not found: ${path}`);
    return store.createLocation(path);
  }
  return resolve.resolveLocation(store.snapshot(), ref);
}

async function locationIdFor(bl: Baseline, snap: Pick<Snapshot, 'locations'>, ref: string): Promise<string> {
  return resolve.isPathRef(ref) ? (await bl.createLocation(localPath(ref))).id : resolve.resolveLocation(snap, ref).id;
}

const localPath = (ref: string) => resolvePath(ref.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));

const onOff = (v: string | undefined): boolean | undefined => v === undefined ? undefined : ['on', 'true', 'yes', '1'].includes(v.toLowerCase());

function labelNames(snap: Pick<Snapshot, 'labels'>, labelIds: string[]): string {
  return labelIds.map(id => snap.labels.find(l => l.id === id)?.name ?? id).join(', ');
}

function fmtDate(s: string | null): string {
  return s ? s.slice(0, 10) : '—';
}

const withDb = (cmd: Command) => cmd.option('--db <path>', 'database path');

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const actorId = (snap: Pick<Snapshot, 'users'>, flag?: string) => resolve.actorId(snap, flag, process.env.BASELINE_AS);

const withAs = (cmd: Command) => cmd.option('--as <user>', 'attribute this write to a named user (e.g. an agent identity)');

program
  .command('serve')
  .description('Run the web app + REST API')
  .option('-p, --port <port>', 'port (default: $BASELINE_PORT or 7770)')
  .option('-d, --db <path>', 'database path')
  .option('--open', 'open browser', false)
  .option('--seed', 'a new database starts with the sample workspace instead of the first-run flow', false)
  .action((opts) => {
    void serve({ port: opts.port ? Number(opts.port) : undefined, dbPath: opts.db, open: opts.open, seedIfEmpty: opts.seed });
  });

program
  .command('setup-token')
  .description('Print a new hosted server\'s setup token, for creating the owner account (run it where the database is)')
  .option('-d, --db <path>', 'database path')
  .action((opts: { db?: string }) => {
    const target = targetFor({ db: opts.db });
    if (target.kind !== 'local') fail('Run this on the server, beside its database (--db <path> or BASELINE_DB)');
    const token = readSetupToken(target.dbPath);
    if (!token) fail(`No setup token for ${target.dbPath}: the workspace is already set up, or the server hasn't started in hosted mode (BASELINE_PUBLIC_URL) yet`);
    console.log(token);
  });

program
  .command('seed')
  .description('Seed a sample workspace (add --reset to wipe first)')
  .option('-d, --db <path>', 'database path')
  .option('--reset', 'wipe existing data first', false)
  .option('--email <address>', 'the sample owner\'s email address (default parth@local)')
  .option('--password <password>', 'a password for the sample owner, so they can sign in to a hosted server')
  .action(async (opts) => {
    if (opts.password !== undefined && !opts.reset) fail('--password needs --reset: it belongs to the owner the sample workspace creates');
    const problem = opts.password !== undefined ? passwordProblem(opts.password) : null;
    if (problem) fail(`--password: ${problem}`);
    const { db, store, accounts, dbPath: path } = legacyApp(opts.db);
    if (opts.reset) seedWorkspace(db, { email: opts.email });
    if (opts.password !== undefined) accounts.setPassword(accounts.passwordFor(opts.email ?? 'parth@local')!.id, await hashPassword(opts.password));
    const snap = store.snapshot();
    console.log(`Seeded: ${snap.teams.length} teams, ${snap.issues.length} issues, ${snap.projects.length} projects → ${path}`);
    process.exit(0);
  });

program
  .command('export')
  .description('Print the whole workspace as JSON')
  .option('--out <file>', 'write to a file instead of stdout')
  .option('--db <path>', 'database path')
  .action((opts) => {
    const store = legacyStore(opts.db);
    const json = store.exportJson();
    if (opts.out) { writeFileSync(opts.out, json); console.log(`Exported → ${opts.out}`); }
    else process.stdout.write(json);
    process.exit(0);
  });

program
  .command('import <file>')
  .description('Restore a workspace from an exported JSON file (wipes current data)')
  .option('--db <path>', 'database path')
  .action((file, opts) => {
    let json: string;
    try { json = readFileSync(file, 'utf8'); }
    catch { fail(`Cannot read ${file}`); }
    const store = legacyStore(opts.db);
    try { store.importJson(json); }
    catch (e) { fail(`Import failed: ${e instanceof Error ? e.message : String(e)}`); }
    const snap = store.snapshot();
    console.log(`Imported: ${snap.teams.length} teams, ${snap.issues.length} issues, ${snap.projects.length} projects`);
    process.exit(0);
  });

program
  .command('search <query>')
  .description('Search issues and projects by substring')
  .option('--db <path>', 'database path')
  .action(async (query: string, opts: { db?: string }) => {
    const bl = await connect(opts);
    const [snap, { issues, projects }] = await Promise.all([bl.snapshot(['states', 'teams']), bl.search(query)]);
    for (const i of issues) {
      const state = snap.states.find(s => s.id === i.stateId)?.name ?? '?';
      console.log(`${issueKey(i, snap.teams).padEnd(9)} [${state}] ${i.title}`);
    }
    for (const p of projects) console.log(`project: ${p.name} (${p.status})`);
    console.error(`\n${issues.length} issue(s), ${projects.length} project(s)`);
    process.exit(0);
  });

const team = program.command('team').description('Team operations');
withDb(team.command('list')).description('List teams with their workflow states').option('--json', 'output as JSON', false).action(async (opts: { db?: string; json?: boolean }) => {
  const snap = await (await connect(opts)).snapshot(['teams', 'states', 'issues', 'currentUser']);
  if (opts.json) {
    console.log(JSON.stringify(snap.teams.map(t => ({
      key: t.key, name: t.name, member: t.memberIds.includes(snap.currentUser.id), triage: t.triageEnabled,
      issues: snap.issues.filter(i => i.teamId === t.id).length,
      states: snap.states.filter(s => s.teamId === t.id).map(s => ({ name: s.name, type: s.type })),
    })), null, 2));
    process.exit(0);
  }
  for (const t of snap.teams) {
    const states = snap.states.filter(s => s.teamId === t.id).map(s => `${s.name}(${s.type})`).join(', ');
    const count = snap.issues.filter(i => i.teamId === t.id).length;
    console.log(`${t.key.padEnd(6)} ${t.name.padEnd(20)} ${count} issue(s)  states: ${states}`);
  }
  process.exit(0);
});

withDb(team.command('update <key>')).description('Change a team: name, triage, estimates, cycle automation')
  .option('-n, --name <name>', 'team name')
  .option('--triage <on|off>', 'triage queue for issues filed by agents and teammates')
  .option('--estimates <scale>', 'none|linear|exponential|fibonacci|tshirt')
  .option('--auto-cycles <on|off>', 'keep cycles scheduled automatically')
  .option('--cycle-weeks <n>', 'weeks per cycle')
  .option('--cooldown <n>', 'weeks between cycles')
  .option('--upcoming <n>', 'future cycles to keep scheduled')
  .option('--rollover <on|off>', 'move unfinished issues into the next cycle')
  .action((key: string, opts: Record<string, string | undefined>) => {
    const store = legacyStore(opts.db);
    const t = resolveTeam(store.snapshot(), key, { required: true })!;
    if (opts.estimates && !['none', 'linear', 'exponential', 'fibonacci', 'tshirt'].includes(opts.estimates)) fail('Invalid --estimates. Use none|linear|exponential|fibonacci|tshirt.');
    store.updateTeam(t.id, {
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.triage !== undefined ? { triageEnabled: onOff(opts.triage) } : {}),
      ...(opts.estimates ? { estimateScale: opts.estimates as Team['estimateScale'] } : {}),
      ...(opts.autoCycles !== undefined ? { autoCycles: onOff(opts.autoCycles) } : {}),
      ...(opts.cycleWeeks ? { cycleDuration: Number(opts.cycleWeeks) } : {}),
      ...(opts.cooldown ? { cycleCooldown: Number(opts.cooldown) } : {}),
      ...(opts.upcoming ? { cycleUpcoming: Number(opts.upcoming) } : {}),
      ...(opts.rollover !== undefined ? { cycleRollover: onOff(opts.rollover) } : {}),
    });
    store.tick();
    const u = store.getTeam(t.id)!;
    console.log(`${u.key}: triage ${u.triageEnabled ? 'on' : 'off'} · estimates ${u.estimateScale} · cycles ${u.autoCycles ? `auto, ${u.cycleDuration}w` : 'manual'} · rollover ${u.cycleRollover ? 'on' : 'off'}`);
    process.exit(0);
  });

const user = program.command('user').description('User operations');
withDb(user.command('list')).description('List workspace users').action(async (opts: { db?: string }) => {
  const snap = await (await connect(opts)).snapshot(['users']);
  for (const u of snap.users) console.log(`${u.name.padEnd(24)} ${u.email.padEnd(20)} ${u.admin ? 'admin ' : ''}${u.kind === 'agent' ? 'agent' : ''}${u.githubUsername ? `github:${u.githubUsername}` : ''}`.trimEnd());
  process.exit(0);
});
withDb(user.command('add <name>')).description('Add a workspace user')
  .option('--agent', 'create as an agent identity (e.g. Claude, Codex)', false)
  .option('--email <email>', 'email address')
  .action((name: string, opts: { db?: string; agent?: boolean; email?: string }) => {
    const store = legacyStore(opts.db);
    const u = store.createUser(name, opts.email ?? '', false, opts.agent ? 'agent' : 'human');
    console.log(`Created ${opts.agent ? 'agent' : 'user'} ${u.name}`);
    process.exit(0);
  });

withDb(user.command('update <name>')).description('Change a user (me = you)')
  .option('--email <email>', 'email address')
  .option('--github <login>', 'GitHub username: their pull requests are attributed to them ("" clears it)')
  .action((name: string, opts: { db?: string; email?: string; github?: string }) => {
    const store = legacyStore(opts.db);
    const u = resolveUser(store.snapshot(), name);
    if (!u) fail(`Unknown user "${name}"`);
    store.updateUser(u.id, { ...(opts.email !== undefined ? { email: opts.email } : {}), ...(opts.github !== undefined ? { githubUsername: opts.github } : {}) });
    const after = store.snapshot().users.find(x => x.id === u.id)!;
    console.log(`Updated ${after.name}${after.githubUsername ? ` · github:${after.githubUsername}` : ''}`);
    process.exit(0);
  });

const label = program.command('label').description('Label operations');
withDb(label.command('list')).description('List labels (optionally per team)')
  .option('-t, --team <key>', 'team key')
  .action((opts: { db?: string; team?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team);
    const labels = snap.labels.filter(l => !t || l.teamId === t.id);
    for (const l of labels) {
      const teamKey = snap.teams.find(x => x.id === l.teamId)?.key ?? '?';
      const usage = snap.issues.filter(i => i.labelIds.includes(l.id)).length;
      console.log(`${teamKey.padEnd(6)} ${l.name.padEnd(16)} ${l.color.padEnd(9)} used by ${usage} issue(s)${l.description ? `  — ${l.description}` : ''}`);
    }
    process.exit(0);
  });
withDb(label.command('create <name>')).description('Create a label')
  .requiredOption('-t, --team <key>', 'team key')
  .option('-c, --color <hex>', 'hex color', '#5e6ad2')
  .option('-d, --description <text>', 'description')
  .action((name, opts: { db?: string; team: string; color: string; description?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team, { required: true })!;
    const l = store.createLabel(t.id, name, opts.color, opts.description ?? '');
    console.log(`Created label ${l.name} on team ${t.key}`);
    process.exit(0);
  });
withDb(label.command('update <name>')).description('Update a label')
  .requiredOption('-t, --team <key>', 'team key the label belongs to')
  .option('-n, --new-name <text>', 'new name')
  .option('-c, --color <hex>', 'hex color')
  .option('-d, --description <text>', 'description')
  .action((name, opts: { db?: string; team: string; newName?: string; color?: string; description?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team, { required: true })!;
    const l = resolveLabel(snap, t.id, name);
    store.updateLabel(l.id, {
      ...(opts.newName ? { name: opts.newName } : {}),
      ...(opts.color ? { color: opts.color } : {}),
      ...(opts.description !== undefined ? { description: opts.description } : {}),
    });
    console.log(`Updated label ${opts.newName ?? l.name}`);
    process.exit(0);
  });
withDb(label.command('delete <name>')).description('Delete a label and detach it from issues')
  .requiredOption('-t, --team <key>', 'team key the label belongs to')
  .action((name, opts: { db?: string; team: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team, { required: true })!;
    const l = resolveLabel(snap, t.id, name);
    store.deleteLabel(l.id);
    console.log(`Deleted label ${l.name}`);
    process.exit(0);
  });

const issue = program.command('issue').description('Issue (task) operations');

withAs(withDb(issue.command('create <title>'))).description('Create an issue')
  .option('-t, --team <key>', 'team key', 'CORE')
  .option('-s, --state <name>', 'state name')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low')
  .option('-a, --assignee <name>', 'assignee name')
  .option('-l, --labels <names>', 'comma-separated labels')
  .option('-j, --project <name>', 'project name')
  .option('-d, --description <text>', 'markdown description')
  .option('--parent <key>', 'parent issue key (sub-issue)')
  .option('--estimate <n>', 'estimate (points)')
  .option('--due <date>', 'due date (YYYY-MM-DD)')
  .option('--location <name|path>', `where agents work on it ("none" for no location; a sub-issue defaults to its parent's, nothing else is defaulted)`)
  .option('--cycle <ref>', 'cycle number, name, current or next')
  .option('--milestone <name>', 'project milestone (needs --project)')
  .option('--json', 'print the created issue as JSON', false)
  .action(async (title: string, opts: Record<string, string | boolean | undefined>) => {
    const bl = await connect({ db: opts.db as string | undefined });
    const snap = await bl.snapshot([...views.ISSUE_JSON_SECTIONS, 'currentUser']);
    const t = resolveTeam(snap, opts.team as string, { required: true })!;
    const st = opts.state ? resolveState(snap, t.id, opts.state as string) : undefined;
    const assignee = opts.assignee ? resolveUser(snap, opts.assignee as string) : undefined;
    const proj = opts.project ? resolveProject(snap, opts.project as string) : undefined;
    let parent: Issue | undefined;
    if (opts.parent) { parent = await bl.getByKey(opts.parent as string); if (!parent) fail(`Unknown parent issue ${opts.parent}`); }
    const labelIds = (opts.labels as string ?? '').split(',').map(s => s.trim()).filter(Boolean)
      .map(n => resolveLabel(snap, t.id, n).id);
    const created = await bl.createIssue({
      teamId: t.id, title, description: opts.description as string | undefined, stateId: st?.id,
      priority: priorityNum(opts.priority as string | undefined), assigneeId: assignee?.id ?? null,
      projectId: proj?.id ?? null, parentId: parent?.id ?? null, labelIds,
      estimate: opts.estimate ? Number(opts.estimate) : null,
      dueDate: (opts.due as string | undefined) ?? null,
      cycleId: opts.cycle ? resolveCycle(snap, t.id, String(opts.cycle)) : null,
      milestoneId: opts.milestone ? milestoneIdFor(snap, proj?.id ?? null, String(opts.milestone)) : null,
      ...(opts.location !== undefined ? { locationId: String(opts.location).toLowerCase() === 'none' ? null : await locationIdFor(bl, snap, String(opts.location)) } : {}),
    }, actorId(snap, opts.as as string | undefined));
    if (opts.json) {
      console.log(JSON.stringify(views.issueJson(created, snap, await issueIndex(bl, parent ? [parent] : [], [created])), null, 2));
    } else {
      console.log(issueKey(created, snap.teams));
    }
    process.exit(0);
  });

withDb(issue.command('handoff <key>')).description('Print a ready-to-paste agent prompt + branch name for an issue')
  .option('--copy', 'copy the prompt to the clipboard instead of stdout', false)
  .option('--json', 'print {key, title, branchName, url, prompt} as JSON', false)
  .action(async (key: string, opts: { db?: string; copy?: boolean; json?: boolean }) => {
    const bl = await connect(opts);
    const i = await bl.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const h = (await bl.handoffFor(i.id))!;
    if (opts.copy) {
      if (!copyToClipboard(h.prompt)) fail('Could not copy. Install pbcopy (macOS), wl-copy or xclip, or drop --copy and pipe stdout.');
      console.error(`Copied prompt for ${h.key} → branch ${h.branchName}`);
    } else if (!opts.json) {
      console.log(h.prompt);
      console.error(`\nbranch: ${h.branchName}\nurl: ${h.url}`);
    }
    if (opts.json) console.log(JSON.stringify(h, null, 2));
    process.exit(0);
  });

withDb(issue.command('open <key>')).description("Open an interactive Claude Code session for an issue in a new terminal window (macOS), in the issue's location")
  .option('--location <name|path>', 'open (and pin the issue to) this location instead')
  .action((key: string, opts: { db?: string; location?: string }) => {
    const { store, dbPath: path } = legacyApp(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    try {
      const loc = opts.location ? resolveLocationRef(store, opts.location) : undefined;
      const r = openInClaudeCode(store, path, i.id, { locationId: loc?.id });
      console.log(`Opened Claude Code for ${r.key} in ${r.directory}${r.pinned ? ` (pinned to ${r.location.name})` : ''}`);
    } catch (err) {
      if (err instanceof LaunchError) fail(err.code === 'no-location' ? `${key.toUpperCase()} has no location. Pass --location <name|path>, or set one with \`issue update ${key.toUpperCase()} --location <name>\`.` : err.message);
      throw err;
    }
    process.exit(0);
  });

withDb(issue.command('list')).description('List issues with filters')
  .option('-t, --team <key>', 'team key')
  .option('-s, --state <name>', 'state name')
  .option('-a, --assignee <name>', 'assignee name or "me"')
  .option('-q, --query <text>', 'substring search')
  .option('-j, --project <name>', 'project name')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low')
  .option('-L, --label <name>', 'label name')
  .option('--archived', 'list archived issues instead of active ones', false)
  .option('--limit <n>', 'max results')
  .option('--json', 'output as JSON', false)
  .action(async (opts: Record<string, string | boolean | undefined>) => {
    const bl = await connect({ db: opts.db as string | undefined });
    const snap = await bl.snapshot(['teams', 'states', 'users', 'currentUser', 'projects', 'labels']);
    const t = resolveTeam(snap, opts.team as string | undefined);
    const st = opts.state && t ? resolveState(snap, t.id, opts.state as string) : (opts.state ? snap.states.find(s => s.name.toLowerCase() === (opts.state as string).toLowerCase()) : undefined);
    const u = opts.assignee ? (opts.assignee === 'me' ? snap.currentUser.id : resolveUser(snap, opts.assignee as string)?.id) : undefined;
    const p = opts.project ? resolveProject(snap, opts.project as string) : undefined;
    const priority = priorityNum(opts.priority as string | undefined);
    let issues = await bl.listIssues({
      teamId: t?.id, stateId: st?.id, assigneeId: u, projectId: p?.id,
      priority, query: opts.query as string | undefined,
      includeArchived: !!opts.archived, limit: opts.limit ? Number(opts.limit) : undefined,
    });
    if (opts.archived) issues = issues.filter(i => i.archivedAt);
    if (opts.label) {
      const labelName = (opts.label as string).toLowerCase();
      const labelIds = snap.labels.filter(l => l.name.toLowerCase() === labelName && (!t || l.teamId === t.id)).map(l => l.id);
      if (!labelIds.length) fail(`Unknown label "${opts.label}"`);
      issues = issues.filter(i => i.labelIds.some(id => labelIds.includes(id)));
    }
    if (opts.json) {
      const more = await bl.snapshot(['locations', 'cycles', 'milestones', 'issues']);
      const index = await issueIndex(bl, more.issues, issues);
      console.log(JSON.stringify(issues.map(i => views.issueJson(i, { ...snap, ...more }, index)), null, 2));
    } else {
      for (const i of issues) {
        const state = snap.states.find(s => s.id === i.stateId)?.name ?? '?';
        const assignee = snap.users.find(u2 => u2.id === i.assigneeId)?.name ?? '—';
        console.log(`${issueKey(i, snap.teams).padEnd(9)} [${state}] ${PRIORITY_SHORT[i.priority].padEnd(11)} ${i.title}  (${assignee})`);
      }
      console.error(`\n${issues.length} issue(s)`);
    }
    process.exit(0);
  });

withDb(issue.command('show <key>')).description('Show full issue detail')
  .option('--json', 'output as JSON', false)
  .action(async (key: string, opts: { db?: string; json?: boolean }) => {
    const bl = await connect(opts);
    const [snap, i] = await Promise.all([bl.snapshot(views.ISSUE_DETAIL_SECTIONS), bl.getByKey(key)]);
    if (!i) fail(`Unknown issue ${key}`);
    if (opts.json) {
      console.log(JSON.stringify(views.issueDetail(i, snap, await issueIndex(bl, snap.issues, [i])), null, 2));
    } else {
      const state = snap.states.find(s => s.id === i.stateId)?.name ?? '?';
      const assignee = snap.users.find(u => u.id === i.assigneeId)?.name ?? '—';
      const proj = snap.projects.find(p => p.id === i.projectId)?.name;
      const parent = i.parentId ? snap.issues.find(x => x.id === i.parentId) : undefined;
      const children = snap.issues.filter(x => x.parentId === i.id);
      const rels = relationRows(snap, i.id);
      console.log(`${issueKey(i, snap.teams)}  ${i.title}`);
      console.log(`state: ${state}  priority: ${PRIORITY_LABELS[i.priority]}  assignee: ${assignee}`);
      const bits: string[] = [];
      if (proj) bits.push(`project: ${proj}`);
      if (i.labelIds.length) bits.push(`labels: ${labelNames(snap, i.labelIds)}`);
      if (parent) bits.push(`parent: ${issueKey(parent, snap.teams)}`);
      if (i.estimate !== null) bits.push(`estimate: ${i.estimate}`);
      if (i.dueDate) bits.push(`due: ${fmtDate(i.dueDate)}`);
      if (i.archivedAt) bits.push('ARCHIVED');
      if (i.deletedAt) bits.push('DELETED');
      if (bits.length) console.log(bits.join('  '));
      if (i.description) console.log(`\n${plainMentions(i.description)}`);
      if (children.length) {
        console.log('\nsub-issues:');
        for (const c of children) {
          const cst = snap.states.find(s => s.id === c.stateId)?.name ?? '?';
          console.log(`  ${issueKey(c, snap.teams)} [${cst}] ${c.title}`);
        }
      }
      if (rels.length) {
        console.log('\nrelations:');
        for (const r of rels) {
          const otherId = r.issueId === i.id ? r.relatedIssueId : r.issueId;
          const other = snap.issues.find(x => x.id === otherId);
          const label = r.issueId === i.id ? r.type : invertRelation(r.type);
          console.log(`  ${label} ${other ? issueKey(other, snap.teams) : '?'}${other ? ` (${other.title})` : ''}`);
        }
      }
      const comments = snap.comments.filter(c => c.issueId === i.id);
      for (const c of comments) console.log(`\n— ${views.byline(snap, c)} (${c.id}): ${plainMentions(c.body)}`);
    }
    process.exit(0);
  });

withAs(withDb(issue.command('update <key>'))).description('Update an issue')
  .option('-s, --state <name>', 'state name')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low')
  .option('-a, --assignee <name>', 'assignee ("none" to unassign)')
  .option('-j, --project <name>', 'project ("none" to remove)')
  .option('--title <text>', 'new title')
  .option('-d, --description <text>', 'markdown description')
  .option('--labels <names>', 'replace the label set (comma-separated)')
  .option('--add-labels <names>', 'add labels (comma-separated)')
  .option('--remove-labels <names>', 'remove labels (comma-separated)')
  .option('--parent <key>', 'parent issue key ("none" to detach)')
  .option('--estimate <n>', 'estimate (points, "none" to clear)')
  .option('--due <date>', 'due date YYYY-MM-DD ("none" to clear)')
  .option('--location <name|path>', 'where agents work on it (a location name, or a path to register; "none" to clear)')
  .option('--cycle <ref>', 'cycle number, name, current, next ("none" to clear)')
  .option('--milestone <name>', 'project milestone ("none" to clear)')
  .action(async (key: string, opts: Record<string, string | undefined>) => {
    const bl = await connect(opts);
    const [snap, i] = await Promise.all([
      bl.snapshot(['states', 'users', 'currentUser', 'projects', 'labels', 'cycles', 'milestones', 'locations']),
      bl.getByKey(key),
    ]);
    if (!i) fail(`Unknown issue ${key}`);
    const st = opts.state ? resolveState(snap, i.teamId, opts.state) : undefined;
    let assigneeId: string | null | undefined;
    if (opts.assignee !== undefined) assigneeId = opts.assignee.toLowerCase() === 'none' ? null : resolveUser(snap, opts.assignee)!.id;
    let projectId: string | null | undefined;
    if (opts.project !== undefined) projectId = opts.project.toLowerCase() === 'none' ? null : (resolveProject(snap, opts.project)?.id ?? null);
    let parentId: string | null | undefined;
    if (opts.parent !== undefined) {
      if (opts.parent.toLowerCase() === 'none') parentId = null;
      else { const p = await bl.getByKey(opts.parent); if (!p) fail(`Unknown parent issue ${opts.parent}`); parentId = p.id; }
    }
    let labelIds: string[] | undefined;
    const cur = i.labelIds;
    if (opts.labels !== undefined) labelIds = opts.labels.split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
    if (opts.addLabels !== undefined || opts.removeLabels !== undefined) {
      const add = (opts.addLabels ?? '').split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
      const rem = (opts.removeLabels ?? '').split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
      labelIds = Array.from(new Set([...cur.filter(id => !rem.includes(id)), ...add]));
    }
    await bl.updateIssue(i.id, {
      title: opts.title, description: opts.description, stateId: st?.id,
      priority: priorityNum(opts.priority), assigneeId, projectId, parentId, labelIds,
      estimate: opts.estimate === undefined ? undefined : (opts.estimate.toLowerCase() === 'none' ? null : Number(opts.estimate)),
      dueDate: opts.due === undefined ? undefined : (opts.due.toLowerCase() === 'none' ? null : opts.due),
      locationId: opts.location === undefined ? undefined : (opts.location.toLowerCase() === 'none' ? null : await locationIdFor(bl, snap, opts.location)),
      cycleId: opts.cycle === undefined ? undefined : resolveCycle(snap, i.teamId, opts.cycle),
      milestoneId: opts.milestone === undefined ? undefined : milestoneIdFor(snap, projectId !== undefined ? projectId : i.projectId, opts.milestone),
    }, actorId(snap, opts.as));
    console.log(`Updated ${key}`);
    process.exit(0);
  });

withAs(withDb(issue.command('archive <key>'))).description('Archive an issue (hidden from lists)').action((key: string, opts: { db?: string; as?: string }) => {
  const store = legacyStore(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.updateIssue(i.id, { archivedAt: new Date().toISOString() }, actorId(store.snapshot(), opts.as));
  console.log(`Archived ${key}`);
  process.exit(0);
});

withAs(withDb(issue.command('unarchive <key>'))).description('Unarchive an issue').action((key: string, opts: { db?: string; as?: string }) => {
  const store = legacyStore(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.updateIssue(i.id, { archivedAt: null }, actorId(store.snapshot(), opts.as));
  console.log(`Unarchived ${key}`);
  process.exit(0);
});

withDb(issue.command('restore <key>')).description('Restore a deleted issue from trash').action((key: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.restoreIssue(i.id);
  console.log(`Restored ${key}`);
  process.exit(0);
});

withDb(issue.command('delete <key>')).description('Delete an issue (soft, undoable; --purge removes permanently)')
  .option('--purge', 'hard-delete: remove comments, relations and activity too', false)
  .action((key: string, opts: { db?: string; purge?: boolean }) => {
    const store = legacyStore(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    if (opts.purge) store.purgeIssue(i.id); else store.deleteIssue(i.id);
    console.log(`Deleted ${key}${opts.purge ? ' (purged)' : ''}`);
    process.exit(0);
  });

withAs(withDb(issue.command('bulk <keys...>'))).description('Apply changes to many issues at once')
  .option('-s, --state <name>', 'state name')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low')
  .option('-a, --assignee <name>', 'assignee ("none" to unassign)')
  .option('-j, --project <name>', 'project ("none" to remove)')
  .option('--add-labels <names>', 'add labels (comma-separated)')
  .option('--remove-labels <names>', 'remove labels (comma-separated)')
  .option('--archive', 'archive the issues', false)
  .option('--delete', 'soft-delete the issues', false)
  .action((keys: string[], opts: Record<string, string | boolean | undefined>) => {
    const store = legacyStore(opts.db as string | undefined);
    const snap = store.snapshot();
    const resolved = keys.map(k => {
      const i = store.getByKey(k);
      if (!i) fail(`Unknown issue ${k}`);
      return i;
    });
    let assigneeId: string | null | undefined;
    if (opts.assignee !== undefined) assigneeId = (opts.assignee as string).toLowerCase() === 'none' ? null : resolveUser(snap, opts.assignee as string)!.id;
    let projectId: string | null | undefined;
    if (opts.project !== undefined) projectId = (opts.project as string).toLowerCase() === 'none' ? null : (resolveProject(snap, opts.project as string)?.id ?? null);
    const actor = actorId(snap, opts.as as string | undefined);
    for (const i of resolved) {
      const stateId = opts.state ? resolveState(snap, i.teamId, opts.state as string).id : undefined;
      let labelIds: string[] | undefined;
      if (opts.addLabels || opts.removeLabels) {
        const add = (opts.addLabels as string ?? '').split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
        const rem = (opts.removeLabels as string ?? '').split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
        labelIds = Array.from(new Set([...i.labelIds.filter(id => !rem.includes(id)), ...add]));
      }
      store.updateIssue(i.id, { stateId, priority: priorityNum(opts.priority as string | undefined), assigneeId, projectId, labelIds }, actor);
      if (opts.archive) store.updateIssue(i.id, { archivedAt: new Date().toISOString() });
      if (opts.delete) store.deleteIssue(i.id);
    }
    console.log(`Updated ${resolved.length} issue(s)`);
    process.exit(0);
  });

withDb(issue.command('move <key>')).description('Reorder an issue relative to a neighbor')
  .option('--before <key>', 'place before this issue')
  .option('--after <key>', 'place after this issue')
  .action((key: string, opts: { db?: string; before?: string; after?: string }) => {
    if (!opts.before === !opts.after) fail('Provide exactly one of --before <key> or --after <key>');
    const store = legacyStore(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const neighbor = store.getByKey(opts.before ?? opts.after!);
    if (!neighbor) fail(`Unknown neighbor issue ${opts.before ?? opts.after}`);
    if (neighbor.id === i.id) fail('Cannot move an issue relative to itself');
    store.moveIssue(i.id, opts.before ? neighbor.id : null, opts.after ? neighbor.id : null);
    console.log(`Moved ${key}`);
    process.exit(0);
  });

withAs(withDb(issue.command('relate <key> <relatedKey>'))).description('Relate two issues')
  .option('--type <type>', 'blocks|blocked_by|related|duplicate', 'related')
  .action((key: string, relatedKey: string, opts: { db?: string; type?: string; as?: string }) => {
    const store = legacyStore(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const r = store.getByKey(relatedKey);
    if (!r) fail(`Unknown issue ${relatedKey}`);
    if (i.id === r.id) fail('An issue cannot relate to itself');
    const type = opts.type as RelationType;
    if (!['blocks', 'blocked_by', 'related', 'duplicate'].includes(type)) fail(`Invalid relation type "${type}". Use blocks|blocked_by|related|duplicate.`);
    store.setRelation(i.id, r.id, type, actorId(store.snapshot(), opts.as));
    console.log(`Related ${key} ${type} ${relatedKey}`);
    process.exit(0);
  });

withDb(issue.command('unrelate <key> <relatedKey>')).description('Remove relations between two issues')
  .option('--type <type>', 'restrict to blocks|blocked_by|related|duplicate')
  .action((key: string, relatedKey: string, opts: { db?: string; type?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const r = store.getByKey(relatedKey);
    if (!r) fail(`Unknown issue ${relatedKey}`);
    const rows = snap.relations.filter(x =>
      ((x.issueId === i.id && x.relatedIssueId === r.id) || (x.issueId === r.id && x.relatedIssueId === i.id))
      && (!opts.type || x.type === opts.type));
    if (!rows.length) fail(`No relations found between ${key} and ${relatedKey}`);
    for (const row of rows) store.removeRelation(row.id);
    console.log(`Removed ${rows.length} relation(s) between ${key} and ${relatedKey}`);
    process.exit(0);
  });

withDb(issue.command('comments <key>')).description('List comments on an issue').action((key: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const snap = store.snapshot();
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  const comments = snap.comments.filter(c => c.issueId === i.id);
  for (const c of comments) {
    const author = snap.users.find(u => u.id === c.userId)?.name ?? '?';
    console.log(`${c.id}  ${author}  ${c.createdAt.slice(0, 16).replace('T', ' ')}  ${plainMentions(c.body)}`);
  }
  console.error(`\n${comments.length} comment(s)`);
  process.exit(0);
});

withAs(withDb(issue.command('comment <key> <body>'))).description('Comment on an issue (--reply <commentId> answers in that thread)')
  .option('--reply <commentId>', 'reply in the thread of this comment')
  .action(async (key: string, body: string, opts: { db?: string; as?: string; reply?: string }) => {
    const bl = await connect(opts);
    const [snap, i] = await Promise.all([bl.snapshot(['comments', 'users']), bl.getByKey(key)]);
    if (!i) fail(`Unknown issue ${key}`);
    if (opts.reply && !snap.comments.some(c => c.id === opts.reply && c.issueId === i.id)) fail(`Unknown comment ${opts.reply} on ${key}`);
    const c = await bl.addComment(i.id, actorId(snap, opts.as), body, opts.reply ?? null);
    console.log(`${opts.reply ? 'Replied' : 'Commented'} on ${key} (${c.id})`);
    process.exit(0);
  });

withAs(withDb(issue.command('subscribe <key>'))).description('Get notified about an issue (as yourself, or --as a user)').action((key: string, opts: { db?: string; as?: string }) => {
  const store = legacyStore(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.subscribe(i.id, actorId(store.snapshot(), opts.as) ?? store.workspaceMeta().currentUser);
  console.log(`Subscribed to ${key}`);
  process.exit(0);
});
withAs(withDb(issue.command('unsubscribe <key>'))).description('Stop notifications for an issue').action((key: string, opts: { db?: string; as?: string }) => {
  const store = legacyStore(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.unsubscribe(i.id, actorId(store.snapshot(), opts.as) ?? store.workspaceMeta().currentUser);
  console.log(`Unsubscribed from ${key}`);
  process.exit(0);
});
withAs(withDb(issue.command('link <key> <url>'))).description('Attach a link (PR, doc, design) to an issue')
  .option('--title <text>', 'link title')
  .action((key: string, url: string, opts: { db?: string; as?: string; title?: string }) => {
    const store = legacyStore(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    store.addAttachment({ issueId: i.id, kind: 'link', url, title: opts.title }, actorId(store.snapshot(), opts.as));
    console.log(`Linked ${url} to ${key}`);
    process.exit(0);
  });
withAs(withDb(issue.command('transfer <key> <team>'))).description('Move an issue to another team (it gets a new key)').action((key: string, teamKey: string, opts: { db?: string; as?: string }) => {
  const store = legacyStore(opts.db);
  const snap = store.snapshot();
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  const t = resolveTeam(snap, teamKey, { required: true })!;
  const moved = store.moveIssueToTeam(i.id, t.id, actorId(snap, opts.as));
  console.log(`${key} → ${moved ? store.keyOf(moved) : key}`);
  process.exit(0);
});
withDb(issue.command('remind <key> <when>')).description('Get an inbox reminder about an issue at a time (YYYY-MM-DD, YYYY-MM-DDTHH:MM, or e.g. 2d / 3h)').action((key: string, when: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  const rel = /^(\d+)\s*([mhdw])$/.exec(when.trim());
  const at = rel ? new Date(Date.now() + Number(rel[1]) * ({ m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 } as Record<string, number>)[rel[2]]) : new Date(when.length === 10 ? `${when}T09:00` : when);
  if (Number.isNaN(at.getTime())) fail(`Can't read "${when}" as a time`);
  store.remindIssue(i.id, at.toISOString());
  console.log(`Reminder set for ${key} at ${at.toLocaleString()}`);
  process.exit(0);
});

const recurring = program.command('recurring').description('Issues that file themselves on a cadence');
withDb(recurring.command('list')).description('List recurring issues').option('-t, --team <key>', 'team key').action((opts: { db?: string; team?: string }) => {
  const store = legacyStore(opts.db);
  const snap = store.snapshot();
  const t = resolveTeam(snap, opts.team);
  for (const r of snap.recurring.filter(x => !t || x.teamId === t.id)) {
    console.log(`${r.id}  ${(snap.teams.find(x => x.id === r.teamId)?.key ?? '?').padEnd(5)} ${r.cadence.padEnd(9)} next ${r.nextAt.slice(0, 10)}  ${r.title}`);
  }
  process.exit(0);
});
withDb(recurring.command('add <title>')).description('Create a recurring issue (or --from KEY to repeat an existing issue)')
  .option('-t, --team <key>', 'team key', 'CORE')
  .option('-c, --cadence <cadence>', 'daily|weekly|biweekly|monthly', 'weekly')
  .option('--from <key>', 'copy title, description, priority, assignee, labels and project from this issue')
  .option('--start <date>', 'first time to file it (default: one cadence from now)')
  .action((title: string, opts: { db?: string; team: string; cadence: string; from?: string; start?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    if (!['daily', 'weekly', 'biweekly', 'monthly'].includes(opts.cadence)) fail('Invalid --cadence. Use daily|weekly|biweekly|monthly.');
    const src = opts.from ? store.getByKey(opts.from) : undefined;
    if (opts.from && !src) fail(`Unknown issue ${opts.from}`);
    const t = src ? snap.teams.find(x => x.id === src.teamId)! : resolveTeam(snap, opts.team, { required: true })!;
    const r = store.createRecurring({
      teamId: t.id, title: src?.title ?? title, description: src?.description, priority: src?.priority, assigneeId: src?.assigneeId,
      labelIds: src?.labelIds, projectId: src?.projectId, cadence: opts.cadence as 'weekly',
      ...(opts.start ? { startAt: new Date(opts.start.length === 10 ? `${opts.start}T09:00` : opts.start).toISOString() } : {}),
    });
    console.log(`${r.id}  ${r.cadence}, next ${r.nextAt.slice(0, 10)}`);
    process.exit(0);
  });
withDb(recurring.command('remove <id>')).description('Stop a recurring issue').action((recId: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  if (!store.snapshot().recurring.some(r => r.id === recId)) fail(`Unknown recurring issue ${recId}`);
  store.deleteRecurring(recId);
  console.log(`Removed ${recId}`);
  process.exit(0);
});

const triage = program.command('triage').description('Review issues waiting in a team\'s triage queue');
withDb(triage.command('list')).description('List issues waiting in triage')
  .option('-t, --team <key>', 'team key')
  .action((opts: { db?: string; team?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team);
    const triageStates = new Set(snap.states.filter(s => s.type === 'triage' && (!t || s.teamId === t.id)).map(s => s.id));
    const now = new Date().toISOString();
    const all = snap.issues.filter(i => triageStates.has(i.stateId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const queue = all.filter(i => !i.snoozedUntil || i.snoozedUntil <= now);
    if (all.length > queue.length) console.error(`(hidden: ${all.length - queue.length} snoozed)`);
    for (const i of queue) console.log(`${issueKey(i, snap.teams).padEnd(9)} ${(snap.users.find(u => u.id === i.creatorId)?.name ?? '?').padEnd(14)} ${i.title}`);
    console.error(`\n${queue.length} issue(s) in triage`);
    process.exit(0);
  });
withAs(withDb(triage.command('accept <key>'))).description('Accept a triage issue into the team (default: its first Todo state)')
  .option('-s, --state <name>', 'state to accept into')
  .action((key: string, opts: { db?: string; as?: string; state?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const st = opts.state ? resolveState(snap, i.teamId, opts.state).id : store.stateOfType(i.teamId, 'unstarted') ?? store.stateOfType(i.teamId, 'backlog');
    store.updateIssue(i.id, { stateId: st }, actorId(snap, opts.as));
    console.log(`Accepted ${key}`);
    process.exit(0);
  });
withDb(triage.command('snooze <key> <when>')).description('Hide a triage issue until a time (2d, 1w, YYYY-MM-DD; "none" brings it back)').action((key: string, when: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  if (when.toLowerCase() === 'none') { store.snoozeIssue(i.id, null); console.log(`${key} is back in triage`); process.exit(0); }
  const rel = /^(\d+)\s*([hdw])$/.exec(when.trim());
  const at = rel ? new Date(Date.now() + Number(rel[1]) * ({ h: 3600e3, d: 86400e3, w: 604800e3 } as Record<string, number>)[rel[2]]) : new Date(when.length === 10 ? `${when}T09:00` : when);
  if (Number.isNaN(at.getTime())) fail(`Can't read "${when}" as a time`);
  store.snoozeIssue(i.id, at.toISOString());
  console.log(`${key} snoozed until ${at.toLocaleString()}`);
  process.exit(0);
});
withAs(withDb(triage.command('decline <key>'))).description('Decline a triage issue (moves it to Canceled)').action((key: string, opts: { db?: string; as?: string }) => {
  const store = legacyStore(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.updateIssue(i.id, { stateId: store.stateOfType(i.teamId, 'canceled') }, actorId(store.snapshot(), opts.as));
  console.log(`Declined ${key}`);
  process.exit(0);
});

const comment = program.command('comment').description('Comment operations');
withDb(comment.command('edit <commentId> <body>')).description('Edit a comment').action((commentId: string, body: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const snap = store.snapshot();
  if (!snap.comments.some(c => c.id === commentId)) fail(`Unknown comment ${commentId}`);
  store.updateComment(commentId, body);
  console.log(`Updated comment ${commentId}`);
  process.exit(0);
});
withDb(comment.command('resolve <commentId>')).description('Resolve a comment thread (--undo reopens it)')
  .option('--undo', 'reopen the thread', false)
  .action((commentId: string, opts: { db?: string; undo?: boolean }) => {
    const store = legacyStore(opts.db);
    if (!store.snapshot().comments.some(c => c.id === commentId)) fail(`Unknown comment ${commentId}`);
    store.resolveComment(commentId, !opts.undo);
    console.log(`${opts.undo ? 'Reopened' : 'Resolved'} thread ${commentId}`);
    process.exit(0);
  });
withDb(comment.command('delete <commentId>')).description('Delete a comment').action((commentId: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const snap = store.snapshot();
  if (!snap.comments.some(c => c.id === commentId)) fail(`Unknown comment ${commentId}`);
  store.deleteComment(commentId);
  console.log(`Deleted comment ${commentId}`);
  process.exit(0);
});

const project = program.command('project').description('Project operations');

withDb(project.command('create <name>')).description('Create a project')
  .option('--summary <text>', 'one-line summary')
  .option('-d, --description <text>', 'description')
  .option('-l, --lead <name>', 'lead user name')
  .option('-t, --team <key>', 'team key')
  .option('--start <date>', 'start date YYYY-MM-DD')
  .option('--target <date>', 'target date YYYY-MM-DD')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low')
  .option('--icon <emoji>', 'project icon')
  .option('--color <hex>', 'project color')
  .action((name: string, opts: Record<string, string | undefined>) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const lead = opts.lead ? resolveUser(snap, opts.lead) : undefined;
    const t = resolveTeam(snap, opts.team);
    const p = store.createProject({
      name, summary: opts.summary, description: opts.description, leadId: lead?.id ?? null, teamId: t?.id ?? null,
      startDate: opts.start ?? null, targetDate: opts.target ?? null,
      priority: priorityNum(opts.priority), icon: opts.icon, color: opts.color,
    });
    console.log(`Created project ${p.name}`);
    process.exit(0);
  });

withDb(project.command('list')).description('List projects with progress')
  .option('--json', 'output as JSON', false)
  .action((opts: { db?: string; json?: boolean }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    if (opts.json) {
      console.log(JSON.stringify(snap.projects.map(p => projectJson(p, snap, store)), null, 2));
    } else {
      for (const p of snap.projects) {
        const prog = store.projectProgress(p.id);
        console.log(`${p.name.padEnd(28)} ${p.status.padEnd(10)} ${p.health.padEnd(9)} ${String(prog.percent).padStart(3)}%  ${prog.done}/${prog.total} issues`);
      }
    }
    process.exit(0);
  });

withDb(project.command('show <name>')).description('Show project detail with progress, issues and updates')
  .option('--json', 'output as JSON', false)
  .action((name: string, opts: { db?: string; json?: boolean }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, name);
    if (!p) fail(`Unknown project "${name}"`);
    if (opts.json) {
      console.log(JSON.stringify(projectDetail(p, snap, store), null, 2));
    } else {
      const lead = snap.users.find(u => u.id === p.leadId)?.name ?? '—';
      const t = snap.teams.find(t => t.id === p.teamId)?.name;
      const prog = store.projectProgress(p.id);
      console.log(`${p.icon} ${p.name}`);
      console.log(`status: ${p.status}  health: ${p.health}  priority: ${PRIORITY_LABELS[p.priority]}  lead: ${lead}${t ? `  team: ${t}` : ''}`);
      console.log(`start: ${fmtDate(p.startDate)}  target: ${fmtDate(p.targetDate)}`);
      const locs = p.locationIds.map(id => snap.locations.find(l => l.id === id)).filter((l): l is Location => !!l);
      if (locs.length) console.log(`locations: ${locs.map(l => `${l.name} (${l.path})`).join(', ')}`);
      if (p.description) console.log(`\n${p.description}`);
      console.log(`\nprogress: ${prog.percent}% (${prog.done}/${prog.total} issues done)`);
      const issues = snap.issues.filter(i => i.projectId === p.id);
      if (issues.length) {
        console.log('\nissues:');
        for (const i of issues) {
          const state = snap.states.find(s => s.id === i.stateId)?.name ?? '?';
          const assignee = snap.users.find(u => u.id === i.assigneeId)?.name ?? '—';
          console.log(`  ${issueKey(i, snap.teams).padEnd(9)} [${state}] ${PRIORITY_SHORT[i.priority].padEnd(11)} ${i.title}  (${assignee})`);
        }
      }
      const updates = snap.projectUpdates.filter(u => u.projectId === p.id);
      if (updates.length) {
        console.log('\nupdates:');
        for (const u of updates) {
          const author = snap.users.find(x => x.id === u.userId)?.name ?? '?';
          console.log(`  ${u.createdAt.slice(0, 10)}  ${author}${u.health ? ` (${u.health})` : ''}: ${u.body}`);
        }
      }
      const milestones = snap.milestones.filter(m => m.projectId === p.id);
      if (milestones.length) {
        console.log('\nmilestones:');
        for (const m of milestones) console.log(`  ${m.name.padEnd(30)} ${m.status.padEnd(10)} target: ${fmtDate(m.targetDate)}`);
      }
    }
    process.exit(0);
  });

withDb(project.command('update <name>')).description('Update a project')
  .option('-n, --new-name <text>', 'new name')
  .option('--summary <text>', 'one-line summary')
  .option('-d, --description <text>', 'description')
  .option('-l, --lead <name>', 'lead user ("none" to clear)')
  .option('--status <status>', 'a status name (Settings › Projects › Statuses) or category: backlog|planned|started|paused|completed|canceled')
  .option('--health <health>', 'onTrack|atRisk|offTrack')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low')
  .option('--start <date>', 'start date YYYY-MM-DD ("none" to clear)')
  .option('--target <date>', 'target date YYYY-MM-DD ("none" to clear)')
  .option('--label <name>', 'add a project label (created if new)')
  .option('--remove-label <name>', 'remove a project label')
  .option('--updates <cadence>', 'update schedule: none|weekly|biweekly|monthly|default')
  .option('--add-location <name|path>', 'link a location (a path is registered on the fly)')
  .option('--remove-location <name>', 'unlink a location')
  .action((name: string, opts: Record<string, string | undefined>) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, name);
    if (!p) fail(`Unknown project "${name}"`);
    let leadId: string | null | undefined;
    if (opts.lead !== undefined) leadId = opts.lead.toLowerCase() === 'none' ? null : resolveUser(snap, opts.lead)!.id;
    const named = opts.status ? snap.projectStatuses.find(st => st.name.toLowerCase() === opts.status!.toLowerCase()) : undefined;
    if (opts.status && !named && !['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'].includes(opts.status)) fail(`Invalid status "${opts.status}". Use one of: ${snap.projectStatuses.map(st => st.name).join(', ')} (or a category).`);
    if (opts.updates && !['none', 'weekly', 'biweekly', 'monthly', 'default'].includes(opts.updates)) fail('Invalid --updates. Use none|weekly|biweekly|monthly|default.');
    let labelIds: string[] | undefined;
    if (opts.label || opts.removeLabel) {
      labelIds = [...p.labelIds];
      if (opts.label) {
        const l = snap.projectLabels.find(x => !x.isGroup && x.name.toLowerCase() === opts.label!.toLowerCase()) ?? store.createProjectLabel({ name: opts.label });
        if (!labelIds.includes(l.id)) labelIds.push(l.id);
      }
      if (opts.removeLabel) { const l = snap.projectLabels.find(x => x.name.toLowerCase() === opts.removeLabel!.toLowerCase()); labelIds = labelIds.filter(x => x !== l?.id); }
    }
    if (opts.health && !['onTrack', 'atRisk', 'offTrack'].includes(opts.health)) fail(`Invalid health "${opts.health}". Use onTrack|atRisk|offTrack.`);
    store.updateProject(p.id, {
      ...(opts.newName ? { name: opts.newName } : {}),
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      ...(opts.summary !== undefined ? { summary: opts.summary } : {}),
      ...(leadId !== undefined ? { leadId } : {}),
      ...(named ? { statusId: named.id } : opts.status ? { status: opts.status as Project['status'] } : {}),
      ...(labelIds ? { labelIds } : {}),
      ...(opts.updates ? { updateCadence: opts.updates === 'default' ? null : opts.updates as Project['updateCadence'] } : {}),
      ...(opts.health ? { health: opts.health as Project['health'] } : {}),
      ...(opts.priority ? { priority: priorityNum(opts.priority)! } : {}),
      ...(opts.start !== undefined ? { startDate: opts.start.toLowerCase() === 'none' ? null : opts.start } : {}),
      ...(opts.target !== undefined ? { targetDate: opts.target.toLowerCase() === 'none' ? null : opts.target } : {}),
    });
    if (opts.addLocation || opts.removeLocation) {
      const add = opts.addLocation ? resolveLocationRef(store, opts.addLocation).id : undefined;
      const rem = opts.removeLocation ? resolveLocationRef(store, opts.removeLocation).id : undefined;
      store.setProjectLocations(p.id, [...p.locationIds.filter(l => l !== rem), ...(add ? [add] : [])]);
    }
    console.log(`Updated project ${opts.newName ?? p.name}`);
    process.exit(0);
  });

withDb(project.command('link <name> <url>')).description('Add a resource link to a project')
  .option('--title <text>', 'link title')
  .action((name: string, url: string, opts: { db?: string; title?: string }) => {
    const store = legacyStore(opts.db);
    const p = resolveProject(store.snapshot(), name)!;
    store.addProjectLink(p.id, url, opts.title);
    console.log(`Linked ${url} to ${p.name}`);
    process.exit(0);
  });

withDb(project.command('labels')).description('List project labels (groups show their labels)').action((opts: { db?: string }) => {
  const snap = legacyStore(opts.db).snapshot();
  for (const l of snap.projectLabels.filter(x => !x.parentId)) {
    console.log(l.isGroup ? `${l.name}/` : l.name);
    for (const k of snap.projectLabels.filter(x => x.parentId === l.id)) console.log(`  ${k.name}`);
  }
  process.exit(0);
});
withDb(project.command('label-create <name>')).description('Create a project label (--group makes a group; --in puts it in one)')
  .option('-c, --color <hex>', 'colour')
  .option('--group', 'create a label group', false)
  .option('--in <group>', 'the group it belongs to')
  .action((name: string, opts: { db?: string; color?: string; group?: boolean; in?: string }) => {
    const store = legacyStore(opts.db);
    const g = opts.in ? store.snapshot().projectLabels.find(x => x.isGroup && x.name.toLowerCase() === opts.in!.toLowerCase()) : undefined;
    if (opts.in && !g) fail(`Unknown label group "${opts.in}"`);
    store.createProjectLabel({ name, color: opts.color, isGroup: opts.group, parentId: g?.id ?? null });
    console.log(`Created ${opts.group ? 'label group' : 'project label'} "${name}"`);
    process.exit(0);
  });
withDb(project.command('statuses')).description('List project statuses by category').action((opts: { db?: string }) => {
  const snap = legacyStore(opts.db).snapshot();
  const order = ['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'];
  for (const st of [...snap.projectStatuses].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.position - b.position)) console.log(`${st.type.padEnd(10)} ${st.name}  (${snap.projects.filter(p => p.statusId === st.id).length} projects)`);
  process.exit(0);
});
withDb(project.command('status-create <category> <name>')).description('Add a named project status inside a category')
  .action((category: string, name: string, opts: { db?: string }) => {
    if (!['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'].includes(category)) fail('Category must be backlog|planned|started|paused|completed|canceled');
    legacyStore(opts.db).createProjectStatus({ type: category as Project['status'], name });
    console.log(`Created status "${name}" in ${category}`);
    process.exit(0);
  });

withAs(withDb(project.command('note <name> <body>'))).description('Post a project update')
  .option('--health <health>', 'onTrack|atRisk|offTrack, and sets the project health to match')
  .action(async (name: string, body: string, opts: { db?: string; health?: string; as?: string }) => {
    const bl = await connect(opts);
    const snap = await bl.snapshot(['projects', 'users']);
    const p = resolveProject(snap, name);
    if (!p) fail(`Unknown project "${name}"`);
    if (opts.health && !['onTrack', 'atRisk', 'offTrack'].includes(opts.health)) fail(`Invalid health "${opts.health}". Use onTrack|atRisk|offTrack.`);
    await bl.addProjectUpdate(p.id, actorId(snap, opts.as), body, opts.health as Project['health'] | undefined);
    console.log(`Posted update on ${p.name}`);
    process.exit(0);
  });

withDb(project.command('delete <name>')).description('Delete a project (its issues are kept, detached)').action((name: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const snap = store.snapshot();
  const p = resolveProject(snap, name);
  if (!p) fail(`Unknown project "${name}"`);
  store.deleteProject(p.id);
  console.log(`Deleted project ${p.name}`);
  process.exit(0);
});

function resolveMilestone(snap: Snapshot, projectId: string, name: string) {
  const m = snap.milestones.find(m => m.projectId === projectId && m.name.toLowerCase() === name.toLowerCase());
  if (!m) fail(`Unknown milestone "${name}" on this project`);
  return m;
}

withDb(project.command('milestone-add <project> <name>')).description('Add a milestone to a project')
  .option('--target <date>', 'target date YYYY-MM-DD')
  .action((proj: string, name: string, opts: { db?: string; target?: string }) => {
    const store = legacyStore(opts.db);
    const p = resolveProject(store.snapshot(), proj);
    if (!p) fail(`Unknown project "${proj}"`);
    store.createMilestone(p.id, name, opts.target ?? null);
    console.log(`Created milestone ${name} on ${p.name}`);
    process.exit(0);
  });

withDb(project.command('milestone-update <project> <name>')).description('Update a project milestone')
  .option('--rename <text>', 'new name')
  .option('--status <status>', 'planned|inProgress|done')
  .option('--target <date>', 'target date YYYY-MM-DD ("none" to clear)')
  .action((proj: string, name: string, opts: { db?: string; rename?: string; status?: string; target?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, proj);
    if (!p) fail(`Unknown project "${proj}"`);
    const m = resolveMilestone(snap, p.id, name);
    if (opts.status && !['planned', 'inProgress', 'done'].includes(opts.status)) fail(`Invalid status "${opts.status}". Use planned|inProgress|done.`);
    store.updateMilestone(m.id, {
      ...(opts.rename ? { name: opts.rename } : {}),
      ...(opts.status ? { status: opts.status as 'planned' | 'inProgress' | 'done' } : {}),
      ...(opts.target !== undefined ? { targetDate: opts.target.toLowerCase() === 'none' ? null : opts.target } : {}),
    });
    console.log(`Updated milestone ${opts.rename ?? m.name}`);
    process.exit(0);
  });

withDb(project.command('milestone-delete <project> <name>')).description('Delete a project milestone').action((proj: string, name: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const snap = store.snapshot();
  const p = resolveProject(snap, proj);
  if (!p) fail(`Unknown project "${proj}"`);
  const m = resolveMilestone(snap, p.id, name);
  store.deleteMilestone(m.id);
  console.log(`Deleted milestone ${m.name}`);
  process.exit(0);
});

function projectJson(p: Project, snap: Snapshot, store: ReturnType<typeof legacyStore>) {
  const prog = store.projectProgress(p.id);
  return {
    id: p.id, name: p.name, summary: p.summary, description: p.description, icon: p.icon, color: p.color,
    status: p.status, statusName: snap.projectStatuses.find(st => st.id === p.statusId)?.name ?? p.status, health: p.health, priority: PRIORITY_SHORT[p.priority],
    labels: snap.projectLabels.filter(l => p.labelIds.includes(l.id)).map(l => l.name),
    updateSchedule: p.updateCadence ?? snap.workspace.features.updateCadence,
    lead: snap.users.find(u => u.id === p.leadId)?.name ?? null,
    team: snap.teams.find(t => t.id === p.teamId)?.key ?? null,
    startDate: p.startDate, targetDate: p.targetDate,
    locations: p.locationIds.map(id => snap.locations.find(l => l.id === id)).filter(Boolean).map(l => ({ name: l!.name, path: l!.path })),
    progress: prog, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function projectDetail(p: Project, snap: Snapshot, store: ReturnType<typeof legacyStore>) {
  const issues = snap.issues.filter(i => i.projectId === p.id).map(i => issueKey(i, snap.teams));
  const updates = snap.projectUpdates.filter(u => u.projectId === p.id)
    .map(u => ({ body: u.body, health: u.health, author: snap.users.find(x => x.id === u.userId)?.name ?? null, createdAt: u.createdAt }));
  const milestones = snap.milestones.filter(m => m.projectId === p.id)
    .map(m => ({ name: m.name, targetDate: m.targetDate, status: m.status }));
  const links = snap.projectLinks.filter(l => l.projectId === p.id).map(l => ({ title: l.title, url: l.url }));
  return { ...projectJson(p, snap, store), issues, updates, milestones, links };
}

const initiative = program.command('initiative').description('Initiatives: strategic efforts made of projects');
const findInitiative = (snap: Snapshot, ref: string) => snap.initiatives.find(i => i.id === ref) ?? snap.initiatives.find(i => /^i-\d+$/i.test(ref) && i.number === Number(ref.slice(2)))
  ?? snap.initiatives.find(i => i.name.toLowerCase() === ref.toLowerCase()) ?? fail(`Unknown initiative "${ref}"`);
const initiativeLabelIds = (store: ReturnType<typeof legacyStore>, snap: Snapshot, names: string[]) => names.flatMap(n => n.split(',')).map(n => n.trim()).filter(Boolean)
  .map(n => (snap.initiativeLabels.find(l => l.name.toLowerCase() === n.toLowerCase()) ?? store.ext.planning.createLabel({ name: n })).id);
const UPDATE_SCHEDULES = ['none', 'weekly', 'biweekly', 'monthly', 'default'];
withDb(initiative.command('list')).description('List initiatives with progress').option('--json', 'output as JSON', false).action((opts: { db?: string; json?: boolean }) => {
  const store = legacyStore(opts.db); const snap = store.snapshot();
  const rows = snap.initiatives.map(i => ({
    key: initiativeKey(i), name: i.name, status: i.status, health: i.health, priority: PRIORITY_LABELS[i.priority], labels: i.labelIds.map(l => snap.initiativeLabels.find(x => x.id === l)?.name).filter(Boolean) as string[],
    owner: snap.users.find(u => u.id === i.ownerId)?.name ?? null, team: snap.teams.find(t => t.id === i.teamId)?.key ?? null, targetDate: i.targetDate, parent: snap.initiatives.find(x => x.id === i.parentId)?.name ?? null,
    updateSchedule: i.updateCadence ?? snap.workspace.features.initiativeUpdateCadence, updateDueAt: store.ext.planning.updateDueAt(i),
    projects: i.projectIds.map(pid => snap.projects.find(p => p.id === pid)?.name),
  }));
  if (opts.json) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`${r.key.padEnd(6)} ${r.name.padEnd(30)} ${r.status.padEnd(10)} ${(r.health ?? '-').padEnd(9)} ${r.priority.padEnd(11)} ${r.labels.length ? `[${r.labels.join(', ')}] ` : ''}${r.projects.join(', ')}`);
  process.exit(0);
});
withDb(initiative.command('create <name>')).description('Create an initiative').option('-d, --description <text>').option('--status <status>', 'proposed|planned|active|completed|canceled').option('--target <date>').option('--parent <initiative>').option('--project <name...>', 'projects to include')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low').option('--label <name...>', 'initiative labels (created if new)').option('-t, --team <key>', 'lead team')
  .action((name: string, opts: { db?: string; description?: string; status?: string; target?: string; parent?: string; project?: string[]; priority?: string; label?: string[]; team?: string }) => {
    const store = legacyStore(opts.db); const snap = store.snapshot();
    const ini = store.ext.planning.createInitiative({ name, description: opts.description, status: opts.status as 'planned' | undefined, targetDate: opts.target ?? null, parentId: opts.parent ? findInitiative(snap, opts.parent).id : null, projectIds: (opts.project ?? []).map(n => resolveProject(snap, n)!.id),
      priority: priorityNum(opts.priority), labelIds: initiativeLabelIds(store, snap, opts.label ?? []), teamId: resolveTeam(snap, opts.team, { required: true })?.id ?? null });
    console.log(`Created initiative ${initiativeKey(ini)} "${ini.name}"`); process.exit(0);
  });
withDb(initiative.command('update <initiative>')).description('Update an initiative (by name or I-12)').option('--status <status>').option('--target <date>').option('--add-project <name>').option('--remove-project <name>')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low').option('--label <name...>', 'add initiative labels (created if new)').option('--remove-label <name...>', 'remove initiative labels')
  .option('-t, --team <key>', 'lead team ("none" to clear)').option('--updates <cadence>', 'update reminders: none|weekly|biweekly|monthly|default')
  .action((ref: string, opts: { db?: string; status?: string; target?: string; addProject?: string; removeProject?: string; priority?: string; label?: string[]; removeLabel?: string[]; team?: string; updates?: string }) => {
    const store = legacyStore(opts.db); const snap = store.snapshot(); const ini = findInitiative(snap, ref);
    if (opts.updates && !UPDATE_SCHEDULES.includes(opts.updates)) fail(`Invalid --updates. Use ${UPDATE_SCHEDULES.join('|')}.`);
    let labelIds: string[] | undefined;
    if (opts.label || opts.removeLabel) {
      const drop = new Set((opts.removeLabel ?? []).flatMap(n => n.split(',')).map(n => snap.initiativeLabels.find(l => l.name.toLowerCase() === n.trim().toLowerCase())?.id));
      labelIds = [...new Set([...ini.labelIds, ...initiativeLabelIds(store, snap, opts.label ?? [])])].filter(l => !drop.has(l));
    }
    store.ext.planning.updateInitiative(ini.id, {
      ...(opts.status ? { status: opts.status as 'active' } : {}), ...(opts.target ? { targetDate: opts.target === 'none' ? null : opts.target } : {}),
      ...(opts.priority ? { priority: priorityNum(opts.priority)! } : {}), ...(labelIds ? { labelIds } : {}),
      ...(opts.team ? { teamId: opts.team.toLowerCase() === 'none' ? null : resolveTeam(snap, opts.team, { required: true })!.id } : {}),
      ...(opts.updates ? { updateCadence: opts.updates === 'default' ? null : opts.updates as 'weekly' } : {}),
    });
    if (opts.addProject) store.ext.planning.addProject(ini.id, resolveProject(snap, opts.addProject)!.id);
    if (opts.removeProject) store.ext.planning.removeProject(ini.id, resolveProject(snap, opts.removeProject)!.id);
    console.log(`Updated initiative ${initiativeKey(ini)} "${ini.name}"`); process.exit(0);
  });
const initiativeLabel = initiative.command('label').description('Initiative labels (Settings › Initiatives)');
withDb(initiativeLabel.command('list')).description('List initiative labels').option('--json', 'output as JSON', false).action((opts: { db?: string; json?: boolean }) => {
  const snap = legacyStore(opts.db).snapshot();
  const rows = snap.initiativeLabels.map(l => ({ name: l.name, color: l.color, initiatives: snap.initiatives.filter(i => i.labelIds.includes(l.id)).length }));
  if (opts.json) console.log(JSON.stringify(rows, null, 2)); else for (const r of rows) console.log(`${r.name.padEnd(24)} ${r.color}  ${r.initiatives} initiative${r.initiatives === 1 ? '' : 's'}`);
  process.exit(0);
});
withDb(initiativeLabel.command('create <name>')).description('Create an initiative label').option('--color <hex>').action((name: string, opts: { db?: string; color?: string }) => {
  const l = legacyStore(opts.db).ext.planning.createLabel({ name, color: opts.color });
  console.log(`Created initiative label "${l.name}"`); process.exit(0);
});
withDb(initiativeLabel.command('delete <name>')).description('Delete an initiative label').action((name: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db); const l = store.snapshot().initiativeLabels.find(x => x.name.toLowerCase() === name.toLowerCase()) ?? fail(`Unknown initiative label "${name}"`);
  store.ext.planning.deleteLabel(l.id); console.log(`Deleted initiative label "${l.name}"`); process.exit(0);
});
withAs(withDb(initiative.command('note <initiative> <body>'))).description('Post an initiative update').option('--health <health>', 'onTrack|atRisk|offTrack')
  .action((ref: string, body: string, opts: { db?: string; health?: string; as?: string }) => {
    const store = legacyStore(opts.db); const snap = store.snapshot();
    store.ext.planning.addInitiativeUpdate(findInitiative(snap, ref).id, actorId(snap, opts.as) ?? store.workspaceMeta().currentUser, body, opts.health as 'onTrack' | undefined);
    console.log('Posted update'); process.exit(0);
  });
const apiKey = program.command('api-key').description('Personal API keys for the REST API (Authorization: Bearer <key>)');
withDb(apiKey.command('list')).description('List your API keys').option('--all', 'every member\'s keys', false).option('--json', 'output as JSON', false).action((opts: { db?: string; all?: boolean; json?: boolean }) => {
  const store = legacyStore(opts.db); const snap = store.snapshot();
  const keys = store.ext.apiKeys.list(opts.all ? undefined : snap.currentUser.id);
  if (opts.json) console.log(JSON.stringify(keys, null, 2));
  else if (!keys.length) console.log('No API keys');
  else for (const k of keys) console.log(`${k.id}  ${k.name.padEnd(20)} …${k.hint}  ${k.scopes ? k.scopes.join(',') : 'full access'}${k.teamIds ? ` · teams ${k.teamIds.map(t => snap.teams.find(x => x.id === t)?.key ?? t).join(',')}` : ''}  ${k.lastUsedAt ? `used ${k.lastUsedAt.slice(0, 10)}` : 'never used'}`);
  process.exit(0);
});
withDb(apiKey.command('create <name>')).description('Create a key; prints the token once')
  .option('-s, --scope <scopes...>', `limit permissions: ${API_KEY_SCOPES.map(([k]) => k).join('|')}`).option('-t, --team <keys...>', 'limit to these teams')
  .action((name: string, opts: { db?: string; scope?: string[]; team?: string[] }) => {
    const store = legacyStore(opts.db); const snap = store.snapshot();
    for (const sc of opts.scope ?? []) if (!API_KEY_SCOPES.some(([k]) => k === sc)) fail(`Unknown permission "${sc}"`);
    const teamIds = opts.team?.map(k => snap.teams.find(t => t.key.toLowerCase() === k.toLowerCase())?.id ?? fail(`Unknown team "${k}"`));
    const { token } = store.ext.apiKeys.create({ name, userId: snap.currentUser.id, scopes: (opts.scope as ApiKeyScope[] | undefined) ?? null, teamIds: teamIds ?? null });
    console.log(token); process.exit(0);
  });
withDb(apiKey.command('revoke <id>')).description('Revoke a key by id or name').action((ref: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const k = store.ext.apiKeys.list().find(x => x.id === ref || x.name === ref) ?? fail(`Unknown API key "${ref}"`);
  store.ext.apiKeys.revoke(k.id); console.log(`Revoked ${k.name}`); process.exit(0);
});

const sla = program.command('sla').description('SLA rules: deadlines for matching issues');
withDb(sla.command('list')).description('List SLA rules and breached issues').action((opts: { db?: string }) => {
  const snap = legacyStore(opts.db).snapshot();
  for (const r of snap.slaRules) console.log(`${r.enabled ? '●' : '○'} ${r.name.padEnd(24)} priorities ${r.priorities.join(',') || 'any'} · within ${r.hours}h`);
  const now = new Date().toISOString();
  const breached = snap.issues.filter(i => i.slaBreachesAt && i.slaBreachesAt <= now).map(i => issueKey(i, snap.teams));
  if (breached.length) console.log(`breached: ${breached.join(' ')}`);
  process.exit(0);
});
withDb(sla.command('create <name>')).description('Add an SLA rule').requiredOption('--hours <n>', 'deadline in hours').option('-p, --priority <levels...>', 'urgent|high|medium|low|none').option('-t, --team <key>')
  .action((name: string, opts: { db?: string; hours: string; priority?: string[]; team?: string }) => {
    const store = legacyStore(opts.db);
    store.ext.automation.createSlaRule({ name, hours: Number(opts.hours), priorities: (opts.priority ?? []).map(p => priorityNum(p)!), teamId: opts.team ? resolveTeam(store.snapshot(), opts.team, { required: true })!.id : null });
    console.log(`Created SLA rule "${name}"`); process.exit(0);
  });
const loop = program.command('loop').description('Loops: workflows that run on a schedule or when issues change');
withDb(loop.command('list')).description('List loops and recent runs').action((opts: { db?: string }) => {
  const snap = legacyStore(opts.db).snapshot();
  for (const l of snap.loops) { console.log(`${l.enabled ? '●' : '○'} ${l.name} (${l.trigger.kind}) → ${l.actions.map(a => a.kind).join(', ')}`); for (const r of snap.loopRuns.filter(x => x.loopId === l.id).slice(0, 2)) console.log(`    ${r.ok ? '✓' : '✗'} ${r.detail}`); }
  process.exit(0);
});
withDb(loop.command('run <loop> [issue]')).description('Run a loop now (optionally on an issue)').action((ref: string, key: string | undefined, opts: { db?: string }) => {
  const store = legacyStore(opts.db); const l = store.snapshot().loops.find(x => x.id === ref || x.name.toLowerCase() === ref.toLowerCase()) ?? fail(`Unknown loop "${ref}"`);
  const run = store.ext.automation.runLoop(l.id, key ? store.getByKey(key)?.id ?? fail(`Unknown issue ${key}`) : null);
  console.log(`${run.ok ? 'ran' : 'failed'}: ${run.detail}`); process.exit(run.ok ? 0 : 1);
});
const gitCmd = program.command('git').description('Git / GitHub: link PRs and commits to issues');
withDb(gitCmd.command('sync')).description('Pull recent PRs (gh) and commits (git log) from your locations').action(async (opts: { db?: string }) => {
  const store = legacyStore(opts.db); const r = await store.ext.git.sync();
  console.log(`${r.prs} pull requests, ${r.commits} commit links${r.error ? ` — ${r.error}` : ''}`); process.exit(0);
});
withDb(gitCmd.command('prs <key>')).description('Pull requests and commits linked to an issue').option('--json', 'output as JSON', false).action((key: string, opts: { db?: string; json?: boolean }) => {
  const store = legacyStore(opts.db); const snap = store.snapshot(); const i = store.getByKey(key) ?? fail(`Unknown issue ${key}`);
  const prs = snap.issuePrs.filter(l => l.issueId === i.id && !l.dismissed).map(l => ({ ...snap.pullRequests.find(p => p.id === l.prId)!, link: l.kind }));
  const commits = snap.issueCommits.filter(c => c.issueId === i.id).map(c => snap.commits.find(x => x.sha === c.sha)!);
  if (opts.json) console.log(JSON.stringify({ prs, commits }, null, 2)); else { for (const p of prs) console.log(`#${p.number} ${p.state.padEnd(7)} ${p.title} (${p.link}) ${p.url}`); for (const c of commits) console.log(`${c.sha.slice(0, 7)} ${c.message.split('\n')[0]}`); }
  process.exit(0);
});
withDb(gitCmd.command('webhook')).description('GitHub webhooks (read-only, signed): show setup, or rotate / turn off the secret')
  .option('--rotate', 'make a new secret (printed once; the old one stops working)', false).option('--off', 'turn webhooks off', false)
  .option('--url <https-url>', 'the public https address GitHub reaches this server at (a tunnel)').option('--json', 'output as JSON', false)
  .action((opts: { db?: string; rotate?: boolean; off?: boolean; url?: string; json?: boolean }) => {
    const store = legacyStore(opts.db); const w = store.ext.webhooks;
    if (opts.url !== undefined) { try { w.setPublicUrl(opts.url); } catch (e) { fail((e as Error).message); } }
    if (opts.off) w.turnOff();
    const secret = opts.rotate ? w.rotateSecret() : null;
    const cfg = w.config();
    if (opts.json) { console.log(JSON.stringify({ ...cfg, ...(secret ? { secret } : {}) }, null, 2)); process.exit(0); }
    console.log(`Webhooks: ${cfg.enabled ? `on (secret ${cfg.secretHint})` : 'off'}${store.getFeatures().githubEnabled ? '' : '. GitHub is disabled in this workspace'}`);
    console.log(`Payload URL: ${cfg.publicUrl ? `${cfg.publicUrl}/api/github/webhook` : '(set --url to your tunnel address)'}  ·  content type application/json`);
    console.log(`Events: ${cfg.events.join(', ')}`);
    if (secret) console.log(`Secret (shown once): ${secret}`);
    if (cfg.lastDelivery) console.log(`Last delivery: ${cfg.lastDelivery.event} ${cfg.lastDelivery.status} at ${cfg.lastDelivery.receivedAt}`);
    process.exit(0);
  });
withDb(gitCmd.command('import-issues <repo>')).description('Import a repo\'s open GitHub issues into a team (one way, read-only via gh)')
  .requiredOption('-t, --team <key>', 'team to import into').option('--follow', 'keep importing new issues as webhooks report them', false)
  .action(async (repo: string, opts: { db?: string; team: string; follow?: boolean }) => {
    const store = legacyStore(opts.db); const team = resolveTeam(store.snapshot(), opts.team, { required: true })!;
    try { const r = await store.ext.webhooks.importIssues(repo, team.id, !!opts.follow); console.log(`Imported ${r.imported} issue${r.imported === 1 ? '' : 's'} into ${team.key}${r.skipped ? ` (${r.skipped} already imported)` : ''}${opts.follow ? ' and now following new issues' : ''}`); }
    catch (e) { fail((e as Error).message); }
    process.exit(0);
  });

const doc = program.command('doc').description('Documents on projects and teams (specs, briefs, runbooks), stored as Markdown');
function resolveDoc(snap: Snapshot, ref: string): Snapshot['docs'][number] {
  const q = ref.toLowerCase();
  const hit = snap.docs.find(d => d.id === ref) ?? snap.docs.find(d => d.title.toLowerCase() === q) ?? snap.docs.filter(d => d.title.toLowerCase().includes(q))[0];
  if (!hit) fail(`Unknown document "${ref}". See \`baseline doc list\`.`);
  return hit;
}
function docJson(d: Snapshot['docs'][number], snap: Snapshot) {
  return {
    id: d.id, title: d.title, project: snap.projects.find(p => p.id === d.projectId)?.name ?? null,
    team: snap.teams.find(t => t.id === d.teamId)?.key ?? null, creator: snap.users.find(u => u.id === d.creatorId)?.name ?? null,
    updatedAt: d.updatedAt, content: d.content,
  };
}
withDb(doc.command('list')).description('List documents')
  .option('--project <name>', 'only this project\'s documents')
  .option('--team <key>', 'only this team\'s documents')
  .option('--json', 'output as JSON', false)
  .action((opts: { db?: string; project?: string; team?: string; json?: boolean }) => {
    const snap = legacyStore(opts.db).snapshot();
    const p = opts.project ? resolveProject(snap, opts.project) : undefined;
    const t = opts.team ? resolveTeam(snap, opts.team, { required: true }) : undefined;
    const list = snap.docs.filter(d => (!p || d.projectId === p.id) && (!t || d.teamId === t.id));
    if (opts.json) console.log(JSON.stringify(list.map(d => docJson(d, snap)), null, 2));
    else for (const d of list) console.log(`${d.id}  ${(d.title || 'Untitled').padEnd(36)} ${snap.projects.find(x => x.id === d.projectId)?.name ?? snap.teams.find(x => x.id === d.teamId)?.key ?? ''}`);
    process.exit(0);
  });
withDb(doc.command('show <doc>')).description('Print a document (by id or title)')
  .option('--json', 'output as JSON', false)
  .action((ref: string, opts: { db?: string; json?: boolean }) => {
    const snap = legacyStore(opts.db).snapshot();
    const d = resolveDoc(snap, ref);
    if (opts.json) console.log(JSON.stringify(docJson(d, snap), null, 2));
    else console.log(`# ${d.title || 'Untitled'}\n\n${d.content}`);
    process.exit(0);
  });
withAs(withDb(doc.command('create <title>'))).description('Create a document on a project or team')
  .option('--project <name>', 'the project it belongs to')
  .option('--team <key>', 'the team it belongs to')
  .option('--content <markdown>', 'body (Markdown); use - to read stdin')
  .action(async (title: string, opts: { db?: string; project?: string; team?: string; content?: string; as?: string }) => {
    const store = legacyStore(opts.db);
    const snap = store.snapshot();
    if (!opts.project && !opts.team) fail('Pass --project <name> or --team <key>');
    const p = opts.project ? resolveProject(snap, opts.project) : undefined;
    const t = !p && opts.team ? resolveTeam(snap, opts.team, { required: true }) : undefined;
    const content = opts.content === '-' ? await readStdin() : opts.content ?? '';
    const d = store.createDoc({ title, content, projectId: p?.id ?? null, teamId: t?.id ?? null }, actorId(snap, opts.as));
    console.log(`Created document ${d.id} "${d.title}"`);
    process.exit(0);
  });
withAs(withDb(doc.command('update <doc>'))).description('Change a document\'s title or content')
  .option('--title <text>', 'new title')
  .option('--content <markdown>', 'replace the body (Markdown); use - to read stdin')
  .option('--append <markdown>', 'add to the end of the body')
  .action(async (ref: string, opts: { db?: string; title?: string; content?: string; append?: string; as?: string }) => {
    const store = legacyStore(opts.db);
    const d = resolveDoc(store.snapshot(), ref);
    const patch: { title?: string; content?: string } = {};
    if (opts.title !== undefined) patch.title = opts.title;
    if (opts.content !== undefined) patch.content = opts.content === '-' ? await readStdin() : opts.content;
    if (opts.append !== undefined) patch.content = `${(patch.content ?? d.content).replace(/\s+$/, '')}\n\n${opts.append}`;
    if (!Object.keys(patch).length) fail('Nothing to change. Pass --title, --content or --append.');
    store.updateDoc(d.id, patch, actorId(store.snapshot(), opts.as));
    console.log(`Updated document "${patch.title ?? d.title}"`);
    process.exit(0);
  });
withDb(doc.command('delete <doc>')).description('Delete a document').action((ref: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const d = resolveDoc(store.snapshot(), ref);
  store.deleteDoc(d.id);
  console.log(`Deleted document "${d.title}"`);
  process.exit(0);
});

const agent = program.command('agent').description('Your coding agent\'s side of an issue: pick (next-issue, find-issues), propose and create, start, progress, sub-issues, follow-ups, finish, project drafts, undo. Writes as the coding tool\'s agent user (--as or BASELINE_AS; Claude Code is detected), else Agent; BASELINE_SESSION. Plus coding-tool settings');
mountOperations(agent, (flags) => agentContext(flags));
withDb(program.command('mcp')).description('Serve the agent operations as MCP tools on stdin/stdout, for Claude Code, Codex and other MCP clients (set up with `baseline connect`)')
  .action(async (opts: { db?: string }) => { await serveStdio(opts); });

withDb(agent.command('config')).description('Show or change where `issue open` sessions launch')
  .option('--terminal <app>', TERMINAL_APPS.join('|'))
  .action((opts: { db?: string; terminal?: string }) => {
    const store = legacyStore(opts.db);
    const terminalApp = opts.terminal ? TERMINAL_APPS.find(t => t.toLowerCase() === opts.terminal!.toLowerCase()) : undefined;
    if (opts.terminal && !terminalApp) fail(`Invalid terminal "${opts.terminal}". Use ${TERMINAL_APPS.join('|')}.`);
    store.setAgentConfig({ terminalApp });
    const c = store.getAgentConfig();
    console.log(`terminal: ${c.terminalApp}\nlocations: ${store.listLocations().length}`);
    process.exit(0);
  });

const location = program.command('location').description('Directories agents work in (usually git repos); a location can serve several projects');
withDb(location.command('list')).description('List locations with the projects that use them').action((opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const snap = store.snapshot();
  for (const l of snap.locations) {
    const projects = snap.projects.filter(p => p.locationIds.includes(l.id)).map(p => p.name);
    const issues = snap.issues.filter(i => i.locationId === l.id && !i.deletedAt).length;
    console.log(`${l.name.padEnd(20)} ${l.path}${isDirectory(l.path) ? '' : '  (missing)'}${projects.length ? `  · ${projects.join(', ')}` : ''}${issues ? `  · ${issues} issue${issues === 1 ? '' : 's'}` : ''}`);
  }
  if (!snap.locations.length) console.log('No locations yet. Add one with `location add <path>`.');
  process.exit(0);
});
withDb(location.command('add <path>')).description('Register a directory as a location')
  .option('-n, --name <name>', 'display name (default: the folder name)')
  .option('-j, --project <name>', 'also link it to this project')
  .action((path: string, opts: { db?: string; name?: string; project?: string }) => {
    const store = legacyStore(opts.db);
    const abs = resolvePath(path.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
    if (!isDirectory(abs)) fail(`Directory not found: ${abs}`);
    const loc = store.createLocation(abs, opts.name);
    if (opts.project) {
      const p = resolveProject(store.snapshot(), opts.project)!;
      store.setProjectLocations(p.id, [...p.locationIds, loc.id]);
    }
    console.log(`${loc.name} → ${loc.path}`);
    process.exit(0);
  });
withDb(location.command('rename <name> <newName>')).description('Rename a location').action((name: string, newName: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const loc = resolveLocationRef(store, name);
  try { store.renameLocation(loc.id, newName); } catch (err) { fail((err as Error).message); }
  console.log(`Renamed ${loc.name} → ${newName}`);
  process.exit(0);
});
withDb(location.command('remove <name>')).description('Unregister a location (projects drop it; issues on it go back to no location)').action((name: string, opts: { db?: string }) => {
  const store = legacyStore(opts.db);
  const loc = resolveLocationRef(store, name);
  store.deleteLocation(loc.id);
  console.log(`Removed location ${loc.name}`);
  process.exit(0);
});

withAs(withDb(program.command('tui [issue]'))).description('Open the workspace in a full-screen terminal UI, optionally straight to an issue key (bare `baseline` in a terminal does the same); it reopens where you left off in this directory')
  .option('--fresh', 'start on Today instead of where the last session in this directory left off')
  .action(async (issueKey: string | undefined, opts: { db?: string; as?: string; fresh?: boolean }) => {
    if (!process.stdout.isTTY || !process.stdin.isTTY) fail('`baseline tui` needs an interactive terminal, and stdout or stdin isn\'t one. In scripts, use `baseline issue list` and the other commands.');
    const { runTui } = await import('../tui/index.js');
    await runTui({ db: opts.db, as: opts.as, issue: issueKey, fresh: opts.fresh });
    process.exit(0);
  });

withDb(program.command('context')).description('What the terminal UI in this directory shows: the open issue and the list, with the cursor row marked (for an agent in a neighbouring pane resolving "this issue" or "the top three")')
  .option('--json', 'print the state file as JSON, plus whether that TUI is still open')
  .action(async (opts: { db?: string; json?: boolean }) => {
    const { contextMarkdown, findSession, pidAlive, targetId, workspaceDir } = await import('../tui/session.js');
    let target: string | null = null;
    try { target = targetId(targetFor({ db: opts.db })); } catch { }
    const found = findSession(workspaceDir(), target);
    if (!found) {
      console.error('No terminal UI state yet. Run `baseline` in this directory to open the TUI; `baseline context` then shows what it is showing.');
      process.exit(1);
    }
    const alive = pidAlive(found.file.pid);
    if (opts.json) console.log(JSON.stringify({ ...found.file, open: alive, thisDirectory: found.here, path: found.path }, null, 2));
    else console.log(contextMarkdown(found.file, { now: Date.now(), alive, here: found.here }));
    process.exit(0);
  });

mountAccountCommands(program);
mountConnectCommand(program);
mountWorkflowCommands(program);

const commandPath = (c: Command): string => c.parent?.parent ? `${commandPath(c.parent)} ${c.name()}` : c.name();
program.hook('preAction', (_root, action) => setLegacyCommand(commandPath(action), action.opts().as as string | undefined));

function tuiFlagsOnly(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--fresh' || /^--(db|as)=./.test(a)) continue;
    if ((a === '--db' || a === '--as') && args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) { i++; continue; }
    return false;
  }
  return args.length > 0;
}
const rest = process.argv.slice(2);
const bare = rest.length === 0 && !!process.stdin.isTTY && !!process.stdout.isTTY;
program.parseAsync(bare || tuiFlagsOnly(rest) ? [...process.argv.slice(0, 2), 'tui', ...rest] : process.argv).catch((e: unknown) => {
  if (e instanceof BaselineError || e instanceof TargetError || e instanceof ResolveError) fail(e.message);
  throw e;
});
