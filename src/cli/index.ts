#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp, serve } from '../server/index.js';
import { isDirectory, LaunchError, openInClaudeCode } from '../server/launch.js';
import { resolveDbPath } from '../core/db.js';
import { seedWorkspace } from '../core/seed.js';
import { issueKey, PRIORITY_SHORT, PRIORITY_LABELS, TERMINAL_APPS, API_KEY_SCOPES } from '../core/types.js';
import type { Priority, RelationType, Snapshot, Team, User, WorkflowState, Label, Project, Issue, Location, ApiKeyScope } from '../core/types.js';

const program = new Command();
program.name('baseline').description('Local issue & project tracker with a Linear-quality UI').version('0.1.0');

// ---------- helpers ----------
function storeFor(dbPath?: string) {
  const { store } = createApp(resolveDbPath(dbPath));
  return store;
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function priorityNum(v?: string): Priority | undefined {
  if (v === undefined) return undefined;
  const named: Record<string, Priority> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };
  const p = named[v.toLowerCase()] ?? (/^[0-4]$/.test(v) ? (Number(v) as Priority) : undefined);
  if (p === undefined) fail(`Invalid priority "${v}" — use none|urgent|high|medium|low (or 0-4)`);
  return p;
}

function resolveTeam(snap: Snapshot, key: string | undefined, { required = false } = {}): Team | undefined {
  if (!key) return undefined;
  const t = snap.teams.find(t => t.key.toLowerCase() === key.toLowerCase())
    ?? snap.teams.find(t => t.name.toLowerCase().includes(key.toLowerCase()));
  if (!t && required) fail(`Unknown team "${key}" — valid keys: ${snap.teams.map(t => t.key).join(', ')}`);
  return t;
}

function resolveState(snap: Snapshot, teamId: string, name: string): WorkflowState {
  const st = snap.states.find(s => s.teamId === teamId && s.name.toLowerCase() === name.toLowerCase());
  if (!st) {
    const valid = snap.states.filter(s => s.teamId === teamId).map(s => s.name);
    fail(`Unknown state "${name}" — valid states: ${valid.join(', ')}`);
  }
  return st;
}

function resolveUser(snap: Snapshot, name: string): User | undefined {
  if (name.toLowerCase() === 'none') return undefined;
  if (name.toLowerCase() === 'me') return snap.currentUser;
  const u = snap.users.find(u => u.name.toLowerCase().includes(name.toLowerCase()));
  if (!u) fail(`Unknown assignee "${name}" — valid users: ${snap.users.map(u => u.name).join(', ')}`);
  return u;
}

/** a location by name or id — or a path, which is registered on the fly (it must exist) */
function resolveLocationRef(store: ReturnType<typeof storeFor>, ref: string): Location {
  if (/^[~/.]/.test(ref)) {
    const path = resolvePath(ref.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
    if (!isDirectory(path)) fail(`Directory not found: ${path}`);
    return store.createLocation(path);
  }
  const loc = store.resolveLocation(ref);
  if (!loc) fail(`Unknown location "${ref}" — known: ${store.listLocations().map(l => l.name).join(', ') || '(none; add one with `location add <path>`)'}`);
  return loc;
}

function resolveProject(snap: Snapshot, name: string, { required = true } = {}): Project | undefined {
  if (name.toLowerCase() === 'none') return undefined;
  const p = snap.projects.find(p => p.name.toLowerCase() === name.toLowerCase())
    ?? snap.projects.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!p && required) fail(`Unknown project "${name}" — valid projects: ${snap.projects.map(p => p.name).join(', ')}`);
  return p;
}

function resolveLabel(snap: Snapshot, teamId: string, name: string): Label {
  const l = snap.labels.find(l => l.teamId === teamId && l.name.toLowerCase() === name.toLowerCase());
  if (!l) {
    const valid = snap.labels.filter(l => l.teamId === teamId).map(l => l.name);
    fail(`Unknown label "${name}" — valid labels: ${valid.length ? valid.join(', ') : '(none for this team)'}`);
  }
  return l;
}

/** a cycle by number ("22"), name, "current", "next" or "none" */
function resolveCycle(snap: Snapshot, teamId: string, ref: string): string | null {
  if (ref.toLowerCase() === 'none') return null;
  const now = new Date().toISOString();
  const cycles = snap.cycles.filter(c => c.teamId === teamId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const c = ref.toLowerCase() === 'current' ? cycles.find(x => x.startsAt <= now && x.endsAt >= now)
    : ref.toLowerCase() === 'next' ? cycles.find(x => x.startsAt > now)
    : cycles.find(x => String(x.number) === ref.replace(/^#/, '') || x.name.toLowerCase() === ref.toLowerCase());
  if (!c) fail(`Unknown cycle "${ref}" — cycles: ${cycles.map(x => x.number).join(', ') || '(none)'}; or current|next|none`);
  return c.id;
}

function milestoneIdFor(snap: Snapshot, projectId: string | null, ref: string): string | null {
  if (ref.toLowerCase() === 'none') return null;
  if (!projectId) fail('A milestone needs the issue to be in a project (--project)');
  const ms = snap.milestones.filter(m => m.projectId === projectId);
  const m = ms.find(x => x.name.toLowerCase() === ref.toLowerCase()) ?? ms.find(x => x.name.toLowerCase().includes(ref.toLowerCase()));
  if (!m) fail(`Unknown milestone "${ref}" — milestones: ${ms.map(x => x.name).join(', ') || '(none)'}`);
  return m.id;
}

const onOff = (v: string | undefined): boolean | undefined => v === undefined ? undefined : ['on', 'true', 'yes', '1'].includes(v.toLowerCase());

function labelNames(snap: Snapshot, labelIds: string[]): string {
  return labelIds.map(id => snap.labels.find(l => l.id === id)?.name ?? id).join(', ');
}

function fmtDate(s: string | null): string {
  return s ? s.slice(0, 10) : '—';
}

function relationRows(snap: Snapshot, issueId: string) {
  return snap.relations.filter(r => r.issueId === issueId || r.relatedIssueId === issueId);
}

const withDb = (cmd: Command) => cmd.option('--db <path>', 'database path');

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** --as <user>: attribute the write to a named user (typically an agent identity like "Codex").
 *  Falls back to BASELINE_AS (name or user id) so an agent session can set its identity once. */
function actorId(snap: Snapshot, flag?: string): string | undefined {
  const name = flag ?? process.env.BASELINE_AS;
  if (!name) return undefined;
  const u = snap.users.find(u => u.id === name)
    ?? snap.users.find(u => u.name.toLowerCase() === name.toLowerCase())
    ?? snap.users.find(u => u.name.toLowerCase().includes(name.toLowerCase()));
  if (!u) fail(`Unknown user "${name}" — valid users: ${snap.users.map(u => u.name).join(', ')}`);
  return u.id;
}

const withAs = (cmd: Command) => cmd.option('--as <user>', 'attribute this write to a named user (e.g. an agent identity)');

/** copy text to the system clipboard via whatever helper exists; false if none worked */
function copyToClipboard(text: string): boolean {
  for (const [cmd, args] of [['pbcopy', [] as string[]], ['wl-copy', []], ['xclip', ['-selection', 'clipboard']]] as const) {
    const r = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    if (!r.error && r.status === 0) return true;
  }
  return false;
}

// ---------- service commands ----------
program
  .command('serve')
  .description('Run the web app + REST API')
  .option('-p, --port <port>', 'port (default: $BASELINE_PORT or 7770)')
  .option('-d, --db <path>', 'database path')
  .option('--open', 'open browser', false)
  .action((opts) => {
    void serve({ port: opts.port ? Number(opts.port) : undefined, dbPath: opts.db, open: opts.open });
  });

program
  .command('seed')
  .description('Seed a sample workspace (add --reset to wipe first)')
  .option('-d, --db <path>', 'database path')
  .option('--reset', 'wipe existing data first', false)
  .action(async (opts) => {
    const path = resolveDbPath(opts.db);
    const { db, store } = createApp(path);
    if (opts.reset) seedWorkspace(db);
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
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
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
  .action((query, opts) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const { issues, projects } = store.search(query);
    for (const i of issues) {
      const state = snap.states.find(s => s.id === i.stateId)?.name ?? '?';
      console.log(`${issueKey(i, snap.teams).padEnd(9)} [${state}] ${i.title}`);
    }
    for (const p of projects) console.log(`project: ${p.name} (${p.status})`);
    console.error(`\n${issues.length} issue(s), ${projects.length} project(s)`);
    process.exit(0);
  });

// ---------- team / user / label discovery ----------
const team = program.command('team').description('Team operations');
withDb(team.command('list')).description('List teams with their workflow states').action((opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const snap = store.snapshot();
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
    const store = storeFor(opts.db);
    const t = resolveTeam(store.snapshot(), key, { required: true })!;
    if (opts.estimates && !['none', 'linear', 'exponential', 'fibonacci', 'tshirt'].includes(opts.estimates)) fail('Invalid --estimates — use none|linear|exponential|fibonacci|tshirt');
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
withDb(user.command('list')).description('List workspace users').action((opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const snap = store.snapshot();
  for (const u of snap.users) console.log(`${u.name.padEnd(24)} ${u.email.padEnd(20)} ${u.admin ? 'admin ' : ''}${u.kind === 'agent' ? 'agent' : ''}${u.githubUsername ? `github:${u.githubUsername}` : ''}`.trimEnd());
  process.exit(0);
});
withDb(user.command('add <name>')).description('Add a workspace user')
  .option('--agent', 'create as an agent identity (e.g. Claude, Codex)', false)
  .option('--email <email>', 'email address')
  .action((name: string, opts: { db?: string; agent?: boolean; email?: string }) => {
    const store = storeFor(opts.db);
    const u = store.createUser(name, opts.email ?? '', false, opts.agent ? 'agent' : 'human');
    console.log(`Created ${opts.agent ? 'agent' : 'user'} ${u.name}`);
    process.exit(0);
  });

withDb(user.command('update <name>')).description('Change a user (me = you)')
  .option('--email <email>', 'email address')
  .option('--github <login>', 'GitHub username: their pull requests are attributed to them ("" clears it)')
  .action((name: string, opts: { db?: string; email?: string; github?: string }) => {
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team, { required: true })!;
    const l = resolveLabel(snap, t.id, name);
    store.deleteLabel(l.id);
    console.log(`Deleted label ${l.name}`);
    process.exit(0);
  });

// ---------- issue (task) commands ----------
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
    const store = storeFor(opts.db as string | undefined);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team as string, { required: true })!;
    const st = opts.state ? resolveState(snap, t.id, opts.state as string) : undefined;
    const assignee = opts.assignee ? resolveUser(snap, opts.assignee as string) : undefined;
    const proj = opts.project ? resolveProject(snap, opts.project as string) : undefined;
    let parent: Issue | undefined;
    if (opts.parent) { parent = store.getByKey(opts.parent as string); if (!parent) fail(`Unknown parent issue ${opts.parent}`); }
    const labelIds = (opts.labels as string ?? '').split(',').map(s => s.trim()).filter(Boolean)
      .map(n => resolveLabel(snap, t.id, n).id);
    const created = store.createIssue({
      teamId: t.id, title, description: opts.description as string | undefined, stateId: st?.id,
      priority: priorityNum(opts.priority as string | undefined), assigneeId: assignee?.id ?? null,
      projectId: proj?.id ?? null, parentId: parent?.id ?? null, labelIds,
      estimate: opts.estimate ? Number(opts.estimate) : null,
      dueDate: (opts.due as string | undefined) ?? null,
      cycleId: opts.cycle ? resolveCycle(snap, t.id, String(opts.cycle)) : null,
      milestoneId: opts.milestone ? milestoneIdFor(snap, proj?.id ?? null, String(opts.milestone)) : null,
      ...(opts.location !== undefined ? { locationId: String(opts.location).toLowerCase() === 'none' ? null : resolveLocationRef(store, String(opts.location)).id } : {}),
    }, actorId(snap, opts.as as string | undefined));
    if (opts.json) {
      console.log(JSON.stringify(issueJson(created, snap, store), null, 2));
    } else {
      console.log(issueKey(created, snap.teams));
    }
    process.exit(0);
  });

withDb(issue.command('handoff <key>')).description('Print a ready-to-paste agent prompt + branch name for an issue')
  .option('--copy', 'copy the prompt to the clipboard instead of stdout', false)
  .option('--json', 'print {key, title, branchName, url, prompt} as JSON', false)
  .action((key: string, opts: { db?: string; copy?: boolean; json?: boolean }) => {
    const store = storeFor(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const h = store.handoffFor(i.id)!;
    if (opts.copy) {
      if (!copyToClipboard(h.prompt)) fail('Could not copy — install pbcopy (macOS), wl-copy or xclip, or drop --copy and pipe stdout');
      console.error(`Copied prompt for ${h.key} → branch ${h.branchName}`);
    } else if (!opts.json) {
      console.log(h.prompt);
      console.error(`\n— branch: ${h.branchName}\n— url: ${h.url}`);
    }
    if (opts.json) console.log(JSON.stringify(h, null, 2));
    process.exit(0);
  });

withDb(issue.command('open <key>')).description("Open an interactive Claude Code session for an issue in a new terminal window (macOS), in the issue's location")
  .option('--location <name|path>', 'open (and pin the issue to) this location instead')
  .action((key: string, opts: { db?: string; location?: string }) => {
    const path = resolveDbPath(opts.db);
    const store = storeFor(path);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    try {
      const loc = opts.location ? resolveLocationRef(store, opts.location) : undefined;
      const r = openInClaudeCode(store, path, i.id, { locationId: loc?.id });
      console.log(`Opened Claude Code for ${r.key} in ${r.directory}${r.pinned ? ` (pinned to ${r.location.name})` : ''}`);
    } catch (err) {
      if (err instanceof LaunchError) fail(err.code === 'no-location' ? `${key.toUpperCase()} has no location — pass --location <name|path>, or set one with \`issue update ${key.toUpperCase()} --location <name>\`` : err.message);
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
  .action((opts: Record<string, string | boolean | undefined>) => {
    const store = storeFor(opts.db as string | undefined);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team as string | undefined);
    const st = opts.state && t ? resolveState(snap, t.id, opts.state as string) : (opts.state ? snap.states.find(s => s.name.toLowerCase() === (opts.state as string).toLowerCase()) : undefined);
    const u = opts.assignee ? (opts.assignee === 'me' ? snap.currentUser.id : resolveUser(snap, opts.assignee as string)?.id) : undefined;
    const p = opts.project ? resolveProject(snap, opts.project as string) : undefined;
    const priority = priorityNum(opts.priority as string | undefined);
    let issues = store.listIssues({
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
      console.log(JSON.stringify(issues.map(i => issueJson(i, snap, store)), null, 2));
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
  .action((key: string, opts: { db?: string; json?: boolean }) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    if (opts.json) {
      console.log(JSON.stringify(issueDetail(i, snap, store), null, 2));
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
      if (i.description) console.log(`\n${i.description}`);
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
      for (const c of comments) console.log(`\n— ${snap.users.find(u => u.id === c.userId)?.name ?? '?'} (${c.id}): ${c.body}`);
    }
    process.exit(0);
  });

function invertRelation(t: RelationType): RelationType {
  return t === 'blocks' ? 'blocked_by' : t === 'blocked_by' ? 'blocks' : t;
}

function issueJson(i: Issue, snap: Snapshot, store: ReturnType<typeof storeFor>) {
  return {
    key: issueKey(i, snap.teams), id: i.id, title: i.title, description: i.description,
    state: snap.states.find(s => s.id === i.stateId)?.name ?? null,
    priority: PRIORITY_SHORT[i.priority], assignee: snap.users.find(u => u.id === i.assigneeId)?.name ?? null,
    project: snap.projects.find(p => p.id === i.projectId)?.name ?? null,
    labels: i.labelIds.map(id => snap.labels.find(l => l.id === id)?.name ?? id),
    parentId: i.parentId ? issueKey(store.getIssue(i.parentId)!, snap.teams) : null,
    location: (() => { const l = snap.locations.find(x => x.id === i.locationId); return l ? { name: l.name, path: l.path } : null; })(),
    estimate: i.estimate, dueDate: i.dueDate,
    cycle: (() => { const c = snap.cycles.find(x => x.id === i.cycleId); return c ? c.number : null; })(),
    milestone: snap.milestones.find(m => m.id === i.milestoneId)?.name ?? null,
    creator: snap.users.find(u => u.id === i.creatorId)?.name ?? null,
    createdAt: i.createdAt, updatedAt: i.updatedAt,
    completedAt: i.completedAt, archivedAt: i.archivedAt,
  };
}

function issueDetail(i: Issue, snap: Snapshot, store: ReturnType<typeof storeFor>) {
  const comments = snap.comments.filter(c => c.issueId === i.id)
    .map(c => ({ id: c.id, replyTo: c.parentId, author: snap.users.find(u => u.id === c.userId)?.name ?? null, body: c.body, createdAt: c.createdAt, editedAt: c.editedAt, reactions: c.reactions, resolvedAt: c.resolvedAt }));
  const subscribers = snap.subscriptions.filter(x => x.issueId === i.id).map(x => snap.users.find(u => u.id === x.userId)?.name ?? x.userId);
  const links = snap.attachments.filter(a => a.issueId === i.id).map(a => ({ kind: a.kind, title: a.title, url: a.url }));
  const activity = store.issueActivity(i.id).map(a => ({ type: a.type, data: a.data, user: snap.users.find(u => u.id === a.userId)?.name ?? null, createdAt: a.createdAt }));
  const children = snap.issues.filter(x => x.parentId === i.id).map(c => issueKey(c, snap.teams));
  const relations = relationRows(snap, i.id).map(r => ({
    type: r.issueId === i.id ? r.type : invertRelation(r.type),
    issue: (() => { const o = snap.issues.find(x => x.id === (r.issueId === i.id ? r.relatedIssueId : r.issueId)); return o ? issueKey(o, snap.teams) : null; })(),
  }));
  const customerRequests = snap.customerRequests.filter(r => r.issueId === i.id).map(r => ({ customer: snap.customers.find(c => c.id === r.customerId)?.name ?? null, body: r.body, important: r.important, createdAt: r.createdAt }));
  return { ...issueJson(i, snap, store), comments, activity, subIssues: children, relations, subscribers, links, customerRequests };
}

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
  .action((key: string, opts: Record<string, string | undefined>) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const st = opts.state ? resolveState(snap, i.teamId, opts.state) : undefined;
    let assigneeId: string | null | undefined;
    if (opts.assignee !== undefined) assigneeId = opts.assignee.toLowerCase() === 'none' ? null : resolveUser(snap, opts.assignee)!.id;
    let projectId: string | null | undefined;
    if (opts.project !== undefined) projectId = opts.project.toLowerCase() === 'none' ? null : (resolveProject(snap, opts.project)?.id ?? null);
    let parentId: string | null | undefined;
    if (opts.parent !== undefined) {
      if (opts.parent.toLowerCase() === 'none') parentId = null;
      else { const p = store.getByKey(opts.parent); if (!p) fail(`Unknown parent issue ${opts.parent}`); parentId = p.id; }
    }
    let labelIds: string[] | undefined;
    const cur = i.labelIds;
    if (opts.labels !== undefined) labelIds = opts.labels.split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
    if (opts.addLabels !== undefined || opts.removeLabels !== undefined) {
      const add = (opts.addLabels ?? '').split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
      const rem = (opts.removeLabels ?? '').split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
      labelIds = Array.from(new Set([...cur.filter(id => !rem.includes(id)), ...add]));
    }
    store.updateIssue(i.id, {
      title: opts.title, description: opts.description, stateId: st?.id,
      priority: priorityNum(opts.priority), assigneeId, projectId, parentId, labelIds,
      estimate: opts.estimate === undefined ? undefined : (opts.estimate.toLowerCase() === 'none' ? null : Number(opts.estimate)),
      dueDate: opts.due === undefined ? undefined : (opts.due.toLowerCase() === 'none' ? null : opts.due),
      locationId: opts.location === undefined ? undefined : (opts.location.toLowerCase() === 'none' ? null : resolveLocationRef(store, opts.location).id),
      cycleId: opts.cycle === undefined ? undefined : resolveCycle(snap, i.teamId, opts.cycle),
      milestoneId: opts.milestone === undefined ? undefined : milestoneIdFor(snap, projectId !== undefined ? projectId : i.projectId, opts.milestone),
    }, actorId(snap, opts.as));
    console.log(`Updated ${key}`);
    process.exit(0);
  });

withAs(withDb(issue.command('archive <key>'))).description('Archive an issue (hidden from lists)').action((key: string, opts: { db?: string; as?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.updateIssue(i.id, { archivedAt: new Date().toISOString() }, actorId(store.snapshot(), opts.as));
  console.log(`Archived ${key}`);
  process.exit(0);
});

withAs(withDb(issue.command('unarchive <key>'))).description('Unarchive an issue').action((key: string, opts: { db?: string; as?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.updateIssue(i.id, { archivedAt: null }, actorId(store.snapshot(), opts.as));
  console.log(`Unarchived ${key}`);
  process.exit(0);
});

withDb(issue.command('restore <key>')).description('Restore a deleted issue from trash').action((key: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.restoreIssue(i.id);
  console.log(`Restored ${key}`);
  process.exit(0);
});

withDb(issue.command('delete <key>')).description('Delete an issue (soft, undoable; --purge removes permanently)')
  .option('--purge', 'hard-delete: remove comments, relations and activity too', false)
  .action((key: string, opts: { db?: string; purge?: boolean }) => {
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db as string | undefined);
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
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const r = store.getByKey(relatedKey);
    if (!r) fail(`Unknown issue ${relatedKey}`);
    if (i.id === r.id) fail('An issue cannot relate to itself');
    const type = opts.type as RelationType;
    if (!['blocks', 'blocked_by', 'related', 'duplicate'].includes(type)) fail(`Invalid relation type "${type}" — use blocks|blocked_by|related|duplicate`);
    store.setRelation(i.id, r.id, type, actorId(store.snapshot(), opts.as));
    console.log(`Related ${key} ${type} ${relatedKey}`);
    process.exit(0);
  });

withDb(issue.command('unrelate <key> <relatedKey>')).description('Remove relations between two issues')
  .option('--type <type>', 'restrict to blocks|blocked_by|related|duplicate')
  .action((key: string, relatedKey: string, opts: { db?: string; type?: string }) => {
    const store = storeFor(opts.db);
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
  const store = storeFor(opts.db);
  const snap = store.snapshot();
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  const comments = snap.comments.filter(c => c.issueId === i.id);
  for (const c of comments) {
    const author = snap.users.find(u => u.id === c.userId)?.name ?? '?';
    console.log(`${c.id}  ${author}  ${c.createdAt.slice(0, 16).replace('T', ' ')}  ${c.body}`);
  }
  console.error(`\n${comments.length} comment(s)`);
  process.exit(0);
});

withAs(withDb(issue.command('comment <key> <body>'))).description('Comment on an issue (--reply <commentId> answers in that thread)')
  .option('--reply <commentId>', 'reply in the thread of this comment')
  .action((key: string, body: string, opts: { db?: string; as?: string; reply?: string }) => {
    const store = storeFor(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    if (opts.reply && !store.snapshot().comments.some(c => c.id === opts.reply && c.issueId === i.id)) fail(`Unknown comment ${opts.reply} on ${key}`);
    const c = store.addComment(i.id, actorId(store.snapshot(), opts.as) ?? store.workspaceMeta().currentUser, body, opts.reply ?? null);
    console.log(`${opts.reply ? 'Replied' : 'Commented'} on ${key} (${c.id})`);
    process.exit(0);
  });

withAs(withDb(issue.command('subscribe <key>'))).description('Get notified about an issue (as yourself, or --as a user)').action((key: string, opts: { db?: string; as?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.subscribe(i.id, actorId(store.snapshot(), opts.as) ?? store.workspaceMeta().currentUser);
  console.log(`Subscribed to ${key}`);
  process.exit(0);
});
withAs(withDb(issue.command('unsubscribe <key>'))).description('Stop notifications for an issue').action((key: string, opts: { db?: string; as?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.unsubscribe(i.id, actorId(store.snapshot(), opts.as) ?? store.workspaceMeta().currentUser);
  console.log(`Unsubscribed from ${key}`);
  process.exit(0);
});
withAs(withDb(issue.command('link <key> <url>'))).description('Attach a link (PR, doc, design) to an issue')
  .option('--title <text>', 'link title')
  .action((key: string, url: string, opts: { db?: string; as?: string; title?: string }) => {
    const store = storeFor(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    store.addAttachment({ issueId: i.id, kind: 'link', url, title: opts.title }, actorId(store.snapshot(), opts.as));
    console.log(`Linked ${url} to ${key}`);
    process.exit(0);
  });
withAs(withDb(issue.command('transfer <key> <team>'))).description('Move an issue to another team (it gets a new key)').action((key: string, teamKey: string, opts: { db?: string; as?: string }) => {
  const store = storeFor(opts.db);
  const snap = store.snapshot();
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  const t = resolveTeam(snap, teamKey, { required: true })!;
  const moved = store.moveIssueToTeam(i.id, t.id, actorId(snap, opts.as));
  console.log(`${key} → ${moved ? store.keyOf(moved) : key}`);
  process.exit(0);
});
withDb(issue.command('remind <key> <when>')).description('Get an inbox reminder about an issue at a time (YYYY-MM-DD, YYYY-MM-DDTHH:MM, or e.g. 2d / 3h)').action((key: string, when: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  const rel = /^(\d+)\s*([mhdw])$/.exec(when.trim());
  const at = rel ? new Date(Date.now() + Number(rel[1]) * ({ m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 } as Record<string, number>)[rel[2]]) : new Date(when.length === 10 ? `${when}T09:00` : when);
  if (Number.isNaN(at.getTime())) fail(`Can't read "${when}" as a time`);
  store.remindIssue(i.id, at.toISOString());
  console.log(`Reminder set for ${key} at ${at.toLocaleString()}`);
  process.exit(0);
});

// ---------- recurring issues ----------
const recurring = program.command('recurring').description('Issues that file themselves on a cadence');
withDb(recurring.command('list')).description('List recurring issues').option('-t, --team <key>', 'team key').action((opts: { db?: string; team?: string }) => {
  const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    if (!['daily', 'weekly', 'biweekly', 'monthly'].includes(opts.cadence)) fail('Invalid --cadence — use daily|weekly|biweekly|monthly');
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
  const store = storeFor(opts.db);
  if (!store.snapshot().recurring.some(r => r.id === recId)) fail(`Unknown recurring issue ${recId}`);
  store.deleteRecurring(recId);
  console.log(`Removed ${recId}`);
  process.exit(0);
});

// ---------- triage ----------
const triage = program.command('triage').description('Review issues waiting in a team\'s triage queue');
withDb(triage.command('list')).description('List issues waiting in triage')
  .option('-t, --team <key>', 'team key')
  .action((opts: { db?: string; team?: string }) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const t = resolveTeam(snap, opts.team);
    const triageStates = new Set(snap.states.filter(s => s.type === 'triage' && (!t || s.teamId === t.id)).map(s => s.id));
    const now = new Date().toISOString();
    const all = snap.issues.filter(i => triageStates.has(i.stateId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const queue = all.filter(i => !i.snoozedUntil || i.snoozedUntil <= now);
    if (all.length > queue.length) console.error(`(${all.length - queue.length} snoozed — hidden)`);
    for (const i of queue) console.log(`${issueKey(i, snap.teams).padEnd(9)} ${(snap.users.find(u => u.id === i.creatorId)?.name ?? '?').padEnd(14)} ${i.title}`);
    console.error(`\n${queue.length} issue(s) in triage`);
    process.exit(0);
  });
withAs(withDb(triage.command('accept <key>'))).description('Accept a triage issue into the team (default: its first Todo state)')
  .option('-s, --state <name>', 'state to accept into')
  .action((key: string, opts: { db?: string; as?: string; state?: string }) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const st = opts.state ? resolveState(snap, i.teamId, opts.state).id : store.stateOfType(i.teamId, 'unstarted') ?? store.stateOfType(i.teamId, 'backlog');
    store.updateIssue(i.id, { stateId: st }, actorId(snap, opts.as));
    console.log(`Accepted ${key}`);
    process.exit(0);
  });
withDb(triage.command('snooze <key> <when>')).description('Hide a triage issue until a time (2d, 1w, YYYY-MM-DD; "none" brings it back)').action((key: string, when: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
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
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.updateIssue(i.id, { stateId: store.stateOfType(i.teamId, 'canceled') }, actorId(store.snapshot(), opts.as));
  console.log(`Declined ${key}`);
  process.exit(0);
});

const comment = program.command('comment').description('Comment operations');
withDb(comment.command('edit <commentId> <body>')).description('Edit a comment').action((commentId: string, body: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const snap = store.snapshot();
  if (!snap.comments.some(c => c.id === commentId)) fail(`Unknown comment ${commentId}`);
  store.updateComment(commentId, body);
  console.log(`Updated comment ${commentId}`);
  process.exit(0);
});
withDb(comment.command('resolve <commentId>')).description('Resolve a comment thread (--undo reopens it)')
  .option('--undo', 'reopen the thread', false)
  .action((commentId: string, opts: { db?: string; undo?: boolean }) => {
    const store = storeFor(opts.db);
    if (!store.snapshot().comments.some(c => c.id === commentId)) fail(`Unknown comment ${commentId}`);
    store.resolveComment(commentId, !opts.undo);
    console.log(`${opts.undo ? 'Reopened' : 'Resolved'} thread ${commentId}`);
    process.exit(0);
  });
withDb(comment.command('delete <commentId>')).description('Delete a comment').action((commentId: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const snap = store.snapshot();
  if (!snap.comments.some(c => c.id === commentId)) fail(`Unknown comment ${commentId}`);
  store.deleteComment(commentId);
  console.log(`Deleted comment ${commentId}`);
  process.exit(0);
});

// ---------- project commands ----------
const project = program.command('project').description('Project operations');

withDb(project.command('create <name>')).description('Create a project')
  .option('--template <name>', 'start from a project template (fields, milestones, starter issues)')
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
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const lead = opts.lead ? resolveUser(snap, opts.lead) : undefined;
    const t = resolveTeam(snap, opts.team);
    const p = store.createProject({
      name, summary: opts.summary, description: opts.description, leadId: lead?.id ?? null, teamId: t?.id ?? null,
      startDate: opts.start ?? null, targetDate: opts.target ?? null,
      priority: priorityNum(opts.priority), icon: opts.icon, color: opts.color,
    });
    if (opts.template) {
      const tpl = snap.projectTemplates.find(x => x.name.toLowerCase() === opts.template!.toLowerCase());
      if (!tpl) fail(`Unknown template "${opts.template}" — templates: ${snap.projectTemplates.map(x => x.name).join(', ') || '(none)'}`);
      store.updateProject(p.id, { ...(opts.summary ? {} : { summary: tpl.summary }), ...(opts.description ? {} : { description: tpl.description }), icon: opts.icon ?? tpl.icon });
      store.applyProjectTemplate(p.id, tpl.id);
    }
    console.log(`Created project ${p.name}`);
    process.exit(0);
  });

withDb(project.command('list')).description('List projects with progress')
  .option('--json', 'output as JSON', false)
  .action((opts: { db?: string; json?: boolean }) => {
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, name);
    if (!p) fail(`Unknown project "${name}"`);
    let leadId: string | null | undefined;
    if (opts.lead !== undefined) leadId = opts.lead.toLowerCase() === 'none' ? null : resolveUser(snap, opts.lead)!.id;
    const named = opts.status ? snap.projectStatuses.find(st => st.name.toLowerCase() === opts.status!.toLowerCase()) : undefined;
    if (opts.status && !named && !['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'].includes(opts.status)) fail(`Invalid status "${opts.status}" — use one of: ${snap.projectStatuses.map(st => st.name).join(', ')} (or a category)`);
    if (opts.updates && !['none', 'weekly', 'biweekly', 'monthly', 'default'].includes(opts.updates)) fail('Invalid --updates — use none|weekly|biweekly|monthly|default');
    let labelIds: string[] | undefined;
    if (opts.label || opts.removeLabel) {
      labelIds = [...p.labelIds];
      if (opts.label) {
        const l = snap.projectLabels.find(x => !x.isGroup && x.name.toLowerCase() === opts.label!.toLowerCase()) ?? store.createProjectLabel({ name: opts.label });
        if (!labelIds.includes(l.id)) labelIds.push(l.id);
      }
      if (opts.removeLabel) { const l = snap.projectLabels.find(x => x.name.toLowerCase() === opts.removeLabel!.toLowerCase()); labelIds = labelIds.filter(x => x !== l?.id); }
    }
    if (opts.health && !['onTrack', 'atRisk', 'offTrack'].includes(opts.health)) fail(`Invalid health "${opts.health}" — use onTrack|atRisk|offTrack`);
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
    const store = storeFor(opts.db);
    const p = resolveProject(store.snapshot(), name)!;
    store.addProjectLink(p.id, url, opts.title);
    console.log(`Linked ${url} to ${p.name}`);
    process.exit(0);
  });

withDb(project.command('depend <name> <blockedBy>')).description('Mark a project as blocked by another (--remove to drop it)')
  .option('--remove', 'remove the dependency', false)
  .action((name: string, blocker: string, opts: { db?: string; remove?: boolean }) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, name)!;
    const b = resolveProject(snap, blocker)!;
    if (opts.remove) {
      const r = snap.projectRelations.find(x => x.projectId === b.id && x.relatedProjectId === p.id);
      if (r) store.removeProjectDependency(r.id);
      console.log(`${p.name} no longer waits on ${b.name}`);
    } else {
      store.addProjectDependency(b.id, p.id);
      console.log(`${p.name} is blocked by ${b.name}`);
    }
    process.exit(0);
  });
withDb(project.command('templates')).description('List project templates').action((opts: { db?: string }) => {
  const store = storeFor(opts.db);
  for (const t of store.snapshot().projectTemplates) console.log(`${t.icon} ${t.name} — ${t.milestones.length} milestones, ${t.issues.length} issues`);
  process.exit(0);
});

withDb(project.command('labels')).description('List project labels (groups show their labels)').action((opts: { db?: string }) => {
  const snap = storeFor(opts.db).snapshot();
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
    const store = storeFor(opts.db);
    const g = opts.in ? store.snapshot().projectLabels.find(x => x.isGroup && x.name.toLowerCase() === opts.in!.toLowerCase()) : undefined;
    if (opts.in && !g) fail(`Unknown label group "${opts.in}"`);
    store.createProjectLabel({ name, color: opts.color, isGroup: opts.group, parentId: g?.id ?? null });
    console.log(`Created ${opts.group ? 'label group' : 'project label'} "${name}"`);
    process.exit(0);
  });
withDb(project.command('statuses')).description('List project statuses by category').action((opts: { db?: string }) => {
  const snap = storeFor(opts.db).snapshot();
  const order = ['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'];
  for (const st of [...snap.projectStatuses].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.position - b.position)) console.log(`${st.type.padEnd(10)} ${st.name}  (${snap.projects.filter(p => p.statusId === st.id).length} projects)`);
  process.exit(0);
});
withDb(project.command('status-create <category> <name>')).description('Add a named project status inside a category')
  .action((category: string, name: string, opts: { db?: string }) => {
    if (!['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'].includes(category)) fail('Category must be backlog|planned|started|paused|completed|canceled');
    storeFor(opts.db).createProjectStatus({ type: category as Project['status'], name });
    console.log(`Created status "${name}" in ${category}`);
    process.exit(0);
  });

withAs(withDb(project.command('note <name> <body>'))).description('Post a project update')
  .option('--health <health>', 'onTrack|atRisk|offTrack — also sets project health')
  .action((name: string, body: string, opts: { db?: string; health?: string; as?: string }) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, name);
    if (!p) fail(`Unknown project "${name}"`);
    if (opts.health && !['onTrack', 'atRisk', 'offTrack'].includes(opts.health)) fail(`Invalid health "${opts.health}" — use onTrack|atRisk|offTrack`);
    store.addProjectUpdate(p.id, actorId(snap, opts.as) ?? store.workspaceMeta().currentUser, body, opts.health as Project['health'] | undefined);
    console.log(`Posted update on ${p.name}`);
    process.exit(0);
  });

withDb(project.command('delete <name>')).description('Delete a project (its issues are kept, detached)').action((name: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, proj);
    if (!p) fail(`Unknown project "${proj}"`);
    const m = resolveMilestone(snap, p.id, name);
    if (opts.status && !['planned', 'inProgress', 'done'].includes(opts.status)) fail(`Invalid status "${opts.status}" — use planned|inProgress|done`);
    store.updateMilestone(m.id, {
      ...(opts.rename ? { name: opts.rename } : {}),
      ...(opts.status ? { status: opts.status as 'planned' | 'inProgress' | 'done' } : {}),
      ...(opts.target !== undefined ? { targetDate: opts.target.toLowerCase() === 'none' ? null : opts.target } : {}),
    });
    console.log(`Updated milestone ${opts.rename ?? m.name}`);
    process.exit(0);
  });

withDb(project.command('milestone-delete <project> <name>')).description('Delete a project milestone').action((proj: string, name: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const snap = store.snapshot();
  const p = resolveProject(snap, proj);
  if (!p) fail(`Unknown project "${proj}"`);
  const m = resolveMilestone(snap, p.id, name);
  store.deleteMilestone(m.id);
  console.log(`Deleted milestone ${m.name}`);
  process.exit(0);
});

function projectJson(p: Project, snap: Snapshot, store: ReturnType<typeof storeFor>) {
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

function projectDetail(p: Project, snap: Snapshot, store: ReturnType<typeof storeFor>) {
  const issues = snap.issues.filter(i => i.projectId === p.id).map(i => issueKey(i, snap.teams));
  const updates = snap.projectUpdates.filter(u => u.projectId === p.id)
    .map(u => ({ body: u.body, health: u.health, author: snap.users.find(x => x.id === u.userId)?.name ?? null, createdAt: u.createdAt }));
  const milestones = snap.milestones.filter(m => m.projectId === p.id)
    .map(m => ({ name: m.name, targetDate: m.targetDate, status: m.status }));
  const name = (id: string) => snap.projects.find(x => x.id === id)?.name ?? id;
  const blockedBy = snap.projectRelations.filter(r => r.relatedProjectId === p.id).map(r => name(r.projectId));
  const blocking = snap.projectRelations.filter(r => r.projectId === p.id).map(r => name(r.relatedProjectId));
  const links = snap.projectLinks.filter(l => l.projectId === p.id).map(l => ({ title: l.title, url: l.url }));
  return { ...projectJson(p, snap, store), issues, updates, milestones, blockedBy, blocking, links };
}

// ---------- initiatives & releases ----------
const initiative = program.command('initiative').description('Initiatives: strategic efforts made of projects');
const findInitiative = (snap: Snapshot, ref: string) => snap.initiatives.find(i => i.id === ref) ?? snap.initiatives.find(i => i.name.toLowerCase() === ref.toLowerCase()) ?? fail(`Unknown initiative "${ref}"`);
withDb(initiative.command('list')).description('List initiatives with progress').option('--json', 'output as JSON', false).action((opts: { db?: string; json?: boolean }) => {
  const store = storeFor(opts.db); const snap = store.snapshot();
  const rows = snap.initiatives.map(i => ({ name: i.name, status: i.status, health: i.health, owner: snap.users.find(u => u.id === i.ownerId)?.name ?? null, targetDate: i.targetDate, parent: snap.initiatives.find(x => x.id === i.parentId)?.name ?? null, projects: i.projectIds.map(pid => snap.projects.find(p => p.id === pid)?.name) }));
  if (opts.json) console.log(JSON.stringify(rows, null, 2)); else for (const r of rows) console.log(`${r.name.padEnd(30)} ${r.status.padEnd(10)} ${(r.health ?? '-').padEnd(9)} ${r.projects.join(', ')}`);
  process.exit(0);
});
withDb(initiative.command('create <name>')).description('Create an initiative').option('-d, --description <text>').option('--status <status>', 'proposed|planned|active|completed|canceled').option('--target <date>').option('--parent <initiative>').option('--project <name...>', 'projects to include')
  .action((name: string, opts: { db?: string; description?: string; status?: string; target?: string; parent?: string; project?: string[] }) => {
    const store = storeFor(opts.db); const snap = store.snapshot();
    const ini = store.ext.planning.createInitiative({ name, description: opts.description, status: opts.status as 'planned' | undefined, targetDate: opts.target ?? null, parentId: opts.parent ? findInitiative(snap, opts.parent).id : null, projectIds: (opts.project ?? []).map(n => resolveProject(snap, n)!.id) });
    console.log(`Created initiative "${ini.name}"`); process.exit(0);
  });
withDb(initiative.command('update <initiative>')).description('Update an initiative').option('--status <status>').option('--target <date>').option('--add-project <name>').option('--remove-project <name>')
  .action((ref: string, opts: { db?: string; status?: string; target?: string; addProject?: string; removeProject?: string }) => {
    const store = storeFor(opts.db); const snap = store.snapshot(); const ini = findInitiative(snap, ref);
    store.ext.planning.updateInitiative(ini.id, { ...(opts.status ? { status: opts.status as 'active' } : {}), ...(opts.target ? { targetDate: opts.target === 'none' ? null : opts.target } : {}) });
    if (opts.addProject) store.ext.planning.addProject(ini.id, resolveProject(snap, opts.addProject)!.id);
    if (opts.removeProject) store.ext.planning.removeProject(ini.id, resolveProject(snap, opts.removeProject)!.id);
    console.log(`Updated initiative "${ini.name}"`); process.exit(0);
  });
withAs(withDb(initiative.command('note <initiative> <body>'))).description('Post an initiative update').option('--health <health>', 'onTrack|atRisk|offTrack')
  .action((ref: string, body: string, opts: { db?: string; health?: string; as?: string }) => {
    const store = storeFor(opts.db); const snap = store.snapshot();
    store.ext.planning.addInitiativeUpdate(findInitiative(snap, ref).id, actorId(snap, opts.as) ?? store.workspaceMeta().currentUser, body, opts.health as 'onTrack' | undefined);
    console.log('Posted update'); process.exit(0);
  });
const release = program.command('release').description('Releases: which issues ship in a version');
const findRelease = (snap: Snapshot, ref: string) => snap.releases.find(r => r.id === ref || r.name === ref) ?? fail(`Unknown release "${ref}"`);
withDb(release.command('list')).description('List releases').option('--json', 'output as JSON', false).action((opts: { db?: string; json?: boolean }) => {
  const snap = storeFor(opts.db).snapshot();
  const rows = snap.releases.map(r => ({ name: r.name, stage: r.stage, targetDate: r.targetDate, releasedAt: r.releasedAt, issues: snap.issues.filter(i => i.releaseId === r.id).map(i => issueKey(i, snap.teams)) }));
  if (opts.json) console.log(JSON.stringify(rows, null, 2)); else for (const r of rows) console.log(`${r.name.padEnd(12)} ${r.stage.padEnd(9)} ${r.issues.join(' ')}`);
  process.exit(0);
});
withDb(release.command('create <name>')).description('Create a release').option('-d, --description <text>').option('--target <date>').action((name: string, opts: { db?: string; description?: string; target?: string }) => {
  storeFor(opts.db).ext.planning.createRelease({ name, description: opts.description, targetDate: opts.target ?? null }); console.log(`Created release ${name}`); process.exit(0);
});
withDb(release.command('update <release>')).description('Change a release (stage: planned|started|released|canceled)').option('--stage <stage>').option('--add <keys...>', 'issue keys to add').option('--remove <keys...>', 'issue keys to remove')
  .action((ref: string, opts: { db?: string; stage?: string; add?: string[]; remove?: string[] }) => {
    const store = storeFor(opts.db); const r = findRelease(store.snapshot(), ref);
    if (opts.stage) store.ext.planning.updateRelease(r.id, { stage: opts.stage as 'released' });
    for (const k of opts.add ?? []) store.updateIssue(store.getByKey(k)?.id ?? fail(`Unknown issue ${k}`), { releaseId: r.id });
    for (const k of opts.remove ?? []) store.updateIssue(store.getByKey(k)?.id ?? fail(`Unknown issue ${k}`), { releaseId: null });
    console.log(`Updated release ${r.name}`); process.exit(0);
  });

// ---------- personal API keys ----------
const apiKey = program.command('api-key').description('Personal API keys for the REST API (Authorization: Bearer <key>)');
withDb(apiKey.command('list')).description('List your API keys').option('--all', 'every member\'s keys', false).option('--json', 'output as JSON', false).action((opts: { db?: string; all?: boolean; json?: boolean }) => {
  const store = storeFor(opts.db); const snap = store.snapshot();
  const keys = store.ext.apiKeys.list(opts.all ? undefined : snap.currentUser.id);
  if (opts.json) console.log(JSON.stringify(keys, null, 2));
  else if (!keys.length) console.log('No API keys');
  else for (const k of keys) console.log(`${k.id}  ${k.name.padEnd(20)} …${k.hint}  ${k.scopes ? k.scopes.join(',') : 'full access'}${k.teamIds ? ` · teams ${k.teamIds.map(t => snap.teams.find(x => x.id === t)?.key ?? t).join(',')}` : ''}  ${k.lastUsedAt ? `used ${k.lastUsedAt.slice(0, 10)}` : 'never used'}`);
  process.exit(0);
});
withDb(apiKey.command('create <name>')).description('Create a key; prints the token once')
  .option('-s, --scope <scopes...>', `limit permissions: ${API_KEY_SCOPES.map(([k]) => k).join('|')}`).option('-t, --team <keys...>', 'limit to these teams')
  .action((name: string, opts: { db?: string; scope?: string[]; team?: string[] }) => {
    const store = storeFor(opts.db); const snap = store.snapshot();
    for (const sc of opts.scope ?? []) if (!API_KEY_SCOPES.some(([k]) => k === sc)) fail(`Unknown permission "${sc}"`);
    const teamIds = opts.team?.map(k => snap.teams.find(t => t.key.toLowerCase() === k.toLowerCase())?.id ?? fail(`Unknown team "${k}"`));
    const { token } = store.ext.apiKeys.create({ name, userId: snap.currentUser.id, scopes: (opts.scope as ApiKeyScope[] | undefined) ?? null, teamIds: teamIds ?? null });
    console.log(token); process.exit(0);
  });
withDb(apiKey.command('revoke <id>')).description('Revoke a key by id or name').action((ref: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const k = store.ext.apiKeys.list().find(x => x.id === ref || x.name === ref) ?? fail(`Unknown API key "${ref}"`);
  store.ext.apiKeys.revoke(k.id); console.log(`Revoked ${k.name}`); process.exit(0);
});

// ---------- SLAs, asks, loops, git ----------
const sla = program.command('sla').description('SLA rules: deadlines for matching issues');
withDb(sla.command('list')).description('List SLA rules and breached issues').action((opts: { db?: string }) => {
  const snap = storeFor(opts.db).snapshot();
  for (const r of snap.slaRules) console.log(`${r.enabled ? '●' : '○'} ${r.name.padEnd(24)} priorities ${r.priorities.join(',') || 'any'} · within ${r.hours}h`);
  const now = new Date().toISOString();
  const breached = snap.issues.filter(i => i.slaBreachesAt && i.slaBreachesAt <= now).map(i => issueKey(i, snap.teams));
  if (breached.length) console.log(`breached: ${breached.join(' ')}`);
  process.exit(0);
});
withDb(sla.command('create <name>')).description('Add an SLA rule').requiredOption('--hours <n>', 'deadline in hours').option('-p, --priority <levels...>', 'urgent|high|medium|low|none').option('-t, --team <key>')
  .action((name: string, opts: { db?: string; hours: string; priority?: string[]; team?: string }) => {
    const store = storeFor(opts.db);
    store.ext.automation.createSlaRule({ name, hours: Number(opts.hours), priorities: (opts.priority ?? []).map(p => priorityNum(p)!), teamId: opts.team ? resolveTeam(store.snapshot(), opts.team, { required: true })!.id : null });
    console.log(`Created SLA rule "${name}"`); process.exit(0);
  });
const ask = program.command('ask').description('Asks: intake forms that file into triage');
withDb(ask.command('list')).description('List Ask forms and their fields').action((opts: { db?: string }) => {
  for (const f of storeFor(opts.db).snapshot().askForms) console.log(`${f.id}  ${f.name} — ${f.fields.map(x => `${x.id}:${x.label}${x.required ? '*' : ''}`).join(', ')}`);
  process.exit(0);
});
withAs(withDb(ask.command('submit <form>'))).description('Submit an Ask (field values as id=value)').argument('<values...>')
  .action((ref: string, values: string[], opts: { db?: string; as?: string }) => {
    const store = storeFor(opts.db); const snap = store.snapshot();
    const f = snap.askForms.find(x => x.id === ref || x.name.toLowerCase() === ref.toLowerCase()) ?? fail(`Unknown form "${ref}"`);
    try { const issue = store.ext.automation.submitAsk(f.id, Object.fromEntries(values.map(v => [v.split('=')[0], v.split('=').slice(1).join('=')])), actorId(snap, opts.as)); console.log(`Filed ${store.keyOf(issue)}`); }
    catch (e) { fail((e as Error).message); }
    process.exit(0);
  });
const loop = program.command('loop').description('Loops: workflows that run on a schedule or when issues change');
withDb(loop.command('list')).description('List loops and recent runs').action((opts: { db?: string }) => {
  const snap = storeFor(opts.db).snapshot();
  for (const l of snap.loops) { console.log(`${l.enabled ? '●' : '○'} ${l.name} (${l.trigger.kind}) → ${l.actions.map(a => a.kind).join(', ')}`); for (const r of snap.loopRuns.filter(x => x.loopId === l.id).slice(0, 2)) console.log(`    ${r.ok ? '✓' : '✗'} ${r.detail}`); }
  process.exit(0);
});
withDb(loop.command('run <loop> [issue]')).description('Run a loop now (optionally on an issue)').action((ref: string, key: string | undefined, opts: { db?: string }) => {
  const store = storeFor(opts.db); const l = store.snapshot().loops.find(x => x.id === ref || x.name.toLowerCase() === ref.toLowerCase()) ?? fail(`Unknown loop "${ref}"`);
  const run = store.ext.automation.runLoop(l.id, key ? store.getByKey(key)?.id ?? fail(`Unknown issue ${key}`) : null);
  console.log(`${run.ok ? 'ran' : 'failed'}: ${run.detail}`); process.exit(run.ok ? 0 : 1);
});
const gitCmd = program.command('git').description('Git / GitHub: link PRs and commits to issues');
withDb(gitCmd.command('sync')).description('Pull recent PRs (gh) and commits (git log) from your locations').action(async (opts: { db?: string }) => {
  const store = storeFor(opts.db); const r = await store.ext.git.sync();
  console.log(`${r.prs} pull requests, ${r.commits} commit links${r.error ? ` — ${r.error}` : ''}`); process.exit(0);
});
withDb(gitCmd.command('prs <key>')).description('Pull requests and commits linked to an issue').option('--json', 'output as JSON', false).action((key: string, opts: { db?: string; json?: boolean }) => {
  const store = storeFor(opts.db); const snap = store.snapshot(); const i = store.getByKey(key) ?? fail(`Unknown issue ${key}`);
  const prs = snap.issuePrs.filter(l => l.issueId === i.id && !l.dismissed).map(l => ({ ...snap.pullRequests.find(p => p.id === l.prId)!, link: l.kind }));
  const commits = snap.issueCommits.filter(c => c.issueId === i.id).map(c => snap.commits.find(x => x.sha === c.sha)!);
  if (opts.json) console.log(JSON.stringify({ prs, commits }, null, 2)); else { for (const p of prs) console.log(`#${p.number} ${p.state.padEnd(7)} ${p.title} (${p.link}) ${p.url}`); for (const c of commits) console.log(`${c.sha.slice(0, 7)} ${c.message.split('\n')[0]}`); }
  process.exit(0);
});
withDb(gitCmd.command('webhook')).description('GitHub webhooks (read-only, signed): show setup, or rotate / turn off the secret')
  .option('--rotate', 'make a new secret (printed once; the old one stops working)', false).option('--off', 'turn webhooks off', false)
  .option('--url <https-url>', 'the public https address GitHub reaches this server at (a tunnel)').option('--json', 'output as JSON', false)
  .action((opts: { db?: string; rotate?: boolean; off?: boolean; url?: string; json?: boolean }) => {
    const store = storeFor(opts.db); const w = store.ext.webhooks;
    if (opts.url !== undefined) { try { w.setPublicUrl(opts.url); } catch (e) { fail((e as Error).message); } }
    if (opts.off) w.turnOff();
    const secret = opts.rotate ? w.rotateSecret() : null;
    const cfg = w.config();
    if (opts.json) { console.log(JSON.stringify({ ...cfg, ...(secret ? { secret } : {}) }, null, 2)); process.exit(0); }
    console.log(`Webhooks: ${cfg.enabled ? `on (secret ${cfg.secretHint})` : 'off'}${store.getFeatures().githubEnabled ? '' : ' — GitHub is disabled in this workspace'}`);
    console.log(`Payload URL: ${cfg.publicUrl ? `${cfg.publicUrl}/api/github/webhook` : '(set --url to your tunnel address)'}  ·  content type application/json`);
    console.log(`Events: ${cfg.events.join(', ')}`);
    if (secret) console.log(`Secret (shown once): ${secret}`);
    if (cfg.lastDelivery) console.log(`Last delivery: ${cfg.lastDelivery.event} ${cfg.lastDelivery.status} at ${cfg.lastDelivery.receivedAt}`);
    process.exit(0);
  });
withDb(gitCmd.command('import-issues <repo>')).description('Import a repo\'s open GitHub issues into a team (one way, read-only via gh)')
  .requiredOption('-t, --team <key>', 'team to import into').option('--follow', 'keep importing new issues as webhooks report them', false)
  .action(async (repo: string, opts: { db?: string; team: string; follow?: boolean }) => {
    const store = storeFor(opts.db); const team = resolveTeam(store.snapshot(), opts.team, { required: true })!;
    try { const r = await store.ext.webhooks.importIssues(repo, team.id, !!opts.follow); console.log(`Imported ${r.imported} issue${r.imported === 1 ? '' : 's'} into ${team.key}${r.skipped ? ` (${r.skipped} already imported)` : ''}${opts.follow ? ' — following new issues' : ''}`); }
    catch (e) { fail((e as Error).message); }
    process.exit(0);
  });

// ---------- customers ----------
const customer = program.command('customer').description('Customers and the issues / projects they asked for');
function resolveCustomer(snap: Snapshot, ref: string) {
  const q = ref.toLowerCase();
  const c = snap.customers.find(x => x.id === ref) ?? snap.customers.find(x => x.name.toLowerCase() === q) ?? snap.customers.find(x => x.domains.includes(q));
  if (!c) fail(`Unknown customer "${ref}" — see \`baseline customer list\``);
  return c;
}
withDb(customer.command('list')).description('List customers with their request counts')
  .option('--json', 'output as JSON', false)
  .action((opts: { db?: string; json?: boolean }) => {
    const snap = storeFor(opts.db).snapshot();
    const rows = snap.customers.map(c => ({ name: c.name, domains: c.domains, status: snap.customerStatuses.find(s => s.id === c.statusId)?.name ?? null, tier: snap.customerTiers.find(t => t.id === c.tierId)?.name ?? null, revenue: c.revenue, size: c.size, requests: snap.customerRequests.filter(r => r.customerId === c.id).length }));
    if (opts.json) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(`${r.name.padEnd(28)} ${(r.status ?? '').padEnd(10)} ${String(r.requests).padStart(3)} requests`);
    process.exit(0);
  });
withDb(customer.command('create <name>')).description('Add a customer')
  .option('--domain <domain>', 'their email domain')
  .option('--revenue <n>', 'annual revenue')
  .option('--size <n>', 'company size')
  .action((name: string, opts: { db?: string; domain?: string; revenue?: string; size?: string }) => {
    const store = storeFor(opts.db);
    if (!store.snapshot().workspace.features.customerRequestsEnabled) store.setFeatures({ customerRequestsEnabled: true });
    store.createCustomer({ name, domains: opts.domain ? [opts.domain] : [], revenue: opts.revenue ? Number(opts.revenue) : null, size: opts.size ? Number(opts.size) : null });
    console.log(`Created customer "${name}"`);
    process.exit(0);
  });
withAs(withDb(customer.command('request <customer> <target>'))).description('Record that a customer asked for an issue (KEY-12) or a project (name)')
  .option('-b, --body <text>', 'what they said')
  .option('--important', 'mark the request important', false)
  .action((ref: string, target: string, opts: { db?: string; body?: string; important?: boolean; as?: string }) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const c = resolveCustomer(snap, ref);
    const issue = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(target) ? store.getByKey(target) : undefined;
    const proj = issue ? undefined : resolveProject(snap, target, { required: false });
    if (!issue && !proj) fail(`"${target}" is neither an issue key nor a project`);
    store.addCustomerRequest({ customerId: c.id, issueId: issue?.id ?? null, projectId: proj?.id ?? null, body: opts.body ?? '', important: opts.important }, actorId(snap, opts.as));
    console.log(`${c.name} asked for ${issue ? store.keyOf(issue) : proj!.name}`);
    process.exit(0);
  });

// ---------- documents ----------
const doc = program.command('doc').description('Documents on projects and teams (specs, briefs, runbooks), stored as Markdown');
function resolveDoc(snap: Snapshot, ref: string): Snapshot['docs'][number] {
  const q = ref.toLowerCase();
  const hit = snap.docs.find(d => d.id === ref) ?? snap.docs.find(d => d.title.toLowerCase() === q) ?? snap.docs.filter(d => d.title.toLowerCase().includes(q))[0];
  if (!hit) fail(`Unknown document "${ref}" — see \`baseline doc list\``);
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
    const snap = storeFor(opts.db).snapshot();
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
    const snap = storeFor(opts.db).snapshot();
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
    const store = storeFor(opts.db);
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
    const store = storeFor(opts.db);
    const d = resolveDoc(store.snapshot(), ref);
    const patch: { title?: string; content?: string } = {};
    if (opts.title !== undefined) patch.title = opts.title;
    if (opts.content !== undefined) patch.content = opts.content === '-' ? await readStdin() : opts.content;
    if (opts.append !== undefined) patch.content = `${(patch.content ?? d.content).replace(/\s+$/, '')}\n\n${opts.append}`;
    if (!Object.keys(patch).length) fail('Nothing to change — pass --title, --content or --append');
    store.updateDoc(d.id, patch, actorId(store.snapshot(), opts.as));
    console.log(`Updated document "${patch.title ?? d.title}"`);
    process.exit(0);
  });
withDb(doc.command('delete <doc>')).description('Delete a document').action((ref: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const d = resolveDoc(store.snapshot(), ref);
  store.deleteDoc(d.id);
  console.log(`Deleted document "${d.title}"`);
  process.exit(0);
});

// ---------- coding tools ----------
const agent = program.command('agent').description('Coding-tool settings for handing issues to Claude Code (`issue open`, `issue handoff`)');
withDb(agent.command('config')).description('Show or change where `issue open` sessions launch')
  .option('--terminal <app>', TERMINAL_APPS.join('|'))
  .action((opts: { db?: string; terminal?: string }) => {
    const store = storeFor(opts.db);
    const terminalApp = opts.terminal ? TERMINAL_APPS.find(t => t.toLowerCase() === opts.terminal!.toLowerCase()) : undefined;
    if (opts.terminal && !terminalApp) fail(`Invalid terminal "${opts.terminal}" — use ${TERMINAL_APPS.join('|')}`);
    store.setAgentConfig({ terminalApp });
    const c = store.getAgentConfig();
    console.log(`terminal: ${c.terminalApp}\nlocations: ${store.listLocations().length}`);
    process.exit(0);
  });

// ---------- locations ----------
const location = program.command('location').description('Directories agents work in (usually git repos); a location can serve several projects');
withDb(location.command('list')).description('List locations with the projects that use them').action((opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const snap = store.snapshot();
  for (const l of snap.locations) {
    const projects = snap.projects.filter(p => p.locationIds.includes(l.id)).map(p => p.name);
    const issues = snap.issues.filter(i => i.locationId === l.id && !i.deletedAt).length;
    console.log(`${l.name.padEnd(20)} ${l.path}${isDirectory(l.path) ? '' : '  (missing)'}${projects.length ? `  · ${projects.join(', ')}` : ''}${issues ? `  · ${issues} issue${issues === 1 ? '' : 's'}` : ''}`);
  }
  if (!snap.locations.length) console.log('no locations — add one with `location add <path>`');
  process.exit(0);
});
withDb(location.command('add <path>')).description('Register a directory as a location')
  .option('-n, --name <name>', 'display name (default: the folder name)')
  .option('-j, --project <name>', 'also link it to this project')
  .action((path: string, opts: { db?: string; name?: string; project?: string }) => {
    const store = storeFor(opts.db);
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
  const store = storeFor(opts.db);
  const loc = resolveLocationRef(store, name);
  try { store.renameLocation(loc.id, newName); } catch (err) { fail((err as Error).message); }
  console.log(`Renamed ${loc.name} → ${newName}`);
  process.exit(0);
});
withDb(location.command('remove <name>')).description('Unregister a location (projects drop it; issues on it go back to no location)').action((name: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const loc = resolveLocationRef(store, name);
  store.deleteLocation(loc.id);
  console.log(`Removed location ${loc.name}`);
  process.exit(0);
});

program.parseAsync(process.argv);
