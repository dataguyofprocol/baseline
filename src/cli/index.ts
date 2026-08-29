#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createApp, serve } from '../server/index.js';
import { resolveDbPath } from '../core/db.js';
import { seedWorkspace } from '../core/seed.js';
import { issueKey, PRIORITY_SHORT, PRIORITY_LABELS } from '../core/types.js';
import type { Priority, RelationType, Snapshot, Team, User, WorkflowState, Label, Project, Issue } from '../core/types.js';

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
  if (name.toLowerCase() === 'none' || name.toLowerCase() === 'me') return undefined;
  const u = snap.users.find(u => u.name.toLowerCase().includes(name.toLowerCase()));
  if (!u) fail(`Unknown assignee "${name}" — valid users: ${snap.users.map(u => u.name).join(', ')}`);
  return u;
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
  .option('-p, --port <port>', 'port', '7327')
  .option('-d, --db <path>', 'database path')
  .option('--open', 'open browser', false)
  .action((opts) => {
    void serve({ port: Number(opts.port), dbPath: opts.db, open: opts.open });
  });

program
  .command('mcp')
  .description('Run the MCP server on stdio')
  .option('--agent <name>', 'attribute MCP writes to this agent user (default: the first agent user)')
  .action((opts: { agent?: string }) => {
    void import('../mcp/index.js').then(m => m.startMcp(opts.agent));
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

const user = program.command('user').description('User operations');
withDb(user.command('list')).description('List workspace users').action((opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const snap = store.snapshot();
  for (const u of snap.users) console.log(`${u.name.padEnd(24)} ${u.email.padEnd(20)} ${u.admin ? 'admin ' : ''}${u.kind === 'agent' ? 'agent' : ''}`);
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

withDb(issue.command('create <title>')).description('Create an issue')
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
    });
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
    estimate: i.estimate, dueDate: i.dueDate,
    createdAt: i.createdAt, updatedAt: i.updatedAt,
    completedAt: i.completedAt, archivedAt: i.archivedAt,
  };
}

function issueDetail(i: Issue, snap: Snapshot, store: ReturnType<typeof storeFor>) {
  const comments = snap.comments.filter(c => c.issueId === i.id)
    .map(c => ({ id: c.id, author: snap.users.find(u => u.id === c.userId)?.name ?? null, body: c.body, createdAt: c.createdAt, editedAt: c.editedAt, reactions: c.reactions, resolvedAt: c.resolvedAt }));
  const activity = store.issueActivity(i.id).map(a => ({ type: a.type, data: a.data, user: snap.users.find(u => u.id === a.userId)?.name ?? null, createdAt: a.createdAt }));
  const children = snap.issues.filter(x => x.parentId === i.id).map(c => issueKey(c, snap.teams));
  const relations = relationRows(snap, i.id).map(r => ({
    type: r.issueId === i.id ? r.type : invertRelation(r.type),
    issue: (() => { const o = snap.issues.find(x => x.id === (r.issueId === i.id ? r.relatedIssueId : r.issueId)); return o ? issueKey(o, snap.teams) : null; })(),
  }));
  return { ...issueJson(i, snap, store), comments, activity, subIssues: children, relations };
}

withDb(issue.command('update <key>')).description('Update an issue')
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
    });
    console.log(`Updated ${key}`);
    process.exit(0);
  });

withDb(issue.command('archive <key>')).description('Archive an issue (hidden from lists)').action((key: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.updateIssue(i.id, { archivedAt: new Date().toISOString() });
  console.log(`Archived ${key}`);
  process.exit(0);
});

withDb(issue.command('unarchive <key>')).description('Unarchive an issue').action((key: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.updateIssue(i.id, { archivedAt: null });
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

withDb(issue.command('bulk <keys...>')).description('Apply changes to many issues at once')
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
    for (const i of resolved) {
      const stateId = opts.state ? resolveState(snap, i.teamId, opts.state as string).id : undefined;
      let labelIds: string[] | undefined;
      if (opts.addLabels || opts.removeLabels) {
        const add = (opts.addLabels as string ?? '').split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
        const rem = (opts.removeLabels as string ?? '').split(',').map(s => s.trim()).filter(Boolean).map(n => resolveLabel(snap, i.teamId, n).id);
        labelIds = Array.from(new Set([...i.labelIds.filter(id => !rem.includes(id)), ...add]));
      }
      store.updateIssue(i.id, { stateId, priority: priorityNum(opts.priority as string | undefined), assigneeId, projectId, labelIds });
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

withDb(issue.command('relate <key> <relatedKey>')).description('Relate two issues')
  .option('--type <type>', 'blocks|blocked_by|related|duplicate', 'related')
  .action((key: string, relatedKey: string, opts: { db?: string; type?: string }) => {
    const store = storeFor(opts.db);
    const i = store.getByKey(key);
    if (!i) fail(`Unknown issue ${key}`);
    const r = store.getByKey(relatedKey);
    if (!r) fail(`Unknown issue ${relatedKey}`);
    if (i.id === r.id) fail('An issue cannot relate to itself');
    const type = opts.type as RelationType;
    if (!['blocks', 'blocked_by', 'related', 'duplicate'].includes(type)) fail(`Invalid relation type "${type}" — use blocks|blocked_by|related|duplicate`);
    store.setRelation(i.id, r.id, type);
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

withDb(issue.command('comment <key> <body>')).description('Comment on an issue').action((key: string, body: string, opts: { db?: string }) => {
  const store = storeFor(opts.db);
  const i = store.getByKey(key);
  if (!i) fail(`Unknown issue ${key}`);
  store.addComment(i.id, store.workspaceMeta().currentUser, body);
  console.log(`Commented on ${key}`);
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
      name, description: opts.description, leadId: lead?.id ?? null, teamId: t?.id ?? null,
      startDate: opts.start ?? null, targetDate: opts.target ?? null,
      priority: priorityNum(opts.priority), icon: opts.icon, color: opts.color,
    });
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
  .option('-d, --description <text>', 'description')
  .option('-l, --lead <name>', 'lead user ("none" to clear)')
  .option('--status <status>', 'planned|started|completed|paused')
  .option('--health <health>', 'onTrack|atRisk|offTrack')
  .option('-p, --priority <level>', 'none|urgent|high|medium|low')
  .option('--start <date>', 'start date YYYY-MM-DD ("none" to clear)')
  .option('--target <date>', 'target date YYYY-MM-DD ("none" to clear)')
  .action((name: string, opts: Record<string, string | undefined>) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, name);
    if (!p) fail(`Unknown project "${name}"`);
    let leadId: string | null | undefined;
    if (opts.lead !== undefined) leadId = opts.lead.toLowerCase() === 'none' ? null : resolveUser(snap, opts.lead)!.id;
    if (opts.status && !['planned', 'started', 'completed', 'paused'].includes(opts.status)) fail(`Invalid status "${opts.status}" — use planned|started|completed|paused`);
    if (opts.health && !['onTrack', 'atRisk', 'offTrack'].includes(opts.health)) fail(`Invalid health "${opts.health}" — use onTrack|atRisk|offTrack`);
    store.updateProject(p.id, {
      ...(opts.newName ? { name: opts.newName } : {}),
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      ...(leadId !== undefined ? { leadId } : {}),
      ...(opts.status ? { status: opts.status as Project['status'] } : {}),
      ...(opts.health ? { health: opts.health as Project['health'] } : {}),
      ...(opts.priority ? { priority: priorityNum(opts.priority)! } : {}),
      ...(opts.start !== undefined ? { startDate: opts.start.toLowerCase() === 'none' ? null : opts.start } : {}),
      ...(opts.target !== undefined ? { targetDate: opts.target.toLowerCase() === 'none' ? null : opts.target } : {}),
    });
    console.log(`Updated project ${opts.newName ?? p.name}`);
    process.exit(0);
  });

withDb(project.command('note <name> <body>')).description('Post a project update')
  .option('--health <health>', 'onTrack|atRisk|offTrack — also sets project health')
  .action((name: string, body: string, opts: { db?: string; health?: string }) => {
    const store = storeFor(opts.db);
    const snap = store.snapshot();
    const p = resolveProject(snap, name);
    if (!p) fail(`Unknown project "${name}"`);
    if (opts.health && !['onTrack', 'atRisk', 'offTrack'].includes(opts.health)) fail(`Invalid health "${opts.health}" — use onTrack|atRisk|offTrack`);
    store.addProjectUpdate(p.id, store.workspaceMeta().currentUser, body, opts.health as Project['health'] | undefined);
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
    id: p.id, name: p.name, description: p.description, icon: p.icon, color: p.color,
    status: p.status, health: p.health, priority: PRIORITY_SHORT[p.priority],
    lead: snap.users.find(u => u.id === p.leadId)?.name ?? null,
    team: snap.teams.find(t => t.id === p.teamId)?.key ?? null,
    startDate: p.startDate, targetDate: p.targetDate,
    progress: prog, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function projectDetail(p: Project, snap: Snapshot, store: ReturnType<typeof storeFor>) {
  const issues = snap.issues.filter(i => i.projectId === p.id).map(i => issueKey(i, snap.teams));
  const updates = snap.projectUpdates.filter(u => u.projectId === p.id)
    .map(u => ({ body: u.body, health: u.health, author: snap.users.find(x => x.id === u.userId)?.name ?? null, createdAt: u.createdAt }));
  const milestones = snap.milestones.filter(m => m.projectId === p.id)
    .map(m => ({ name: m.name, targetDate: m.targetDate, status: m.status }));
  return { ...projectJson(p, snap, store), issues, updates, milestones };
}

program.parseAsync(process.argv);
