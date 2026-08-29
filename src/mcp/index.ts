#!/usr/bin/env node
/**
 * Baseline MCP server (stdio).
 * Register in an MCP client:
 *   { "command": "node", "args": ["<repo>/dist/mcp/index.js"], "env": { "BASELINE_DB": "..." } }
 * Writes are attributed to an agent identity: --agent <name> / BASELINE_AGENT env,
 * falling back to the workspace's default agent user.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, resolveDbPath } from '../core/db.js';
import { Store } from '../core/store.js';
import { seedWorkspace } from '../core/seed.js';
import { issueKey } from '../core/types.js';
import type { Priority, User, WorkflowStateType, RelationType } from '../core/types.js';

export async function startMcp(agentFlag?: string): Promise<void> {
const db = openDb(resolveDbPath());
const store = new Store(db);
const hasWorkspace = db.prepare('SELECT COUNT(*) AS n FROM meta').get() as { n: number };
if (Number(hasWorkspace.n) === 0) seedWorkspace(db);

const snap = () => store.snapshot();

// write attribution: named agent (--agent / BASELINE_AGENT) > first agent user > current user
const agentName = agentFlag ?? process.env.BASELINE_AGENT;
const actor: User = (() => {
  const s = snap();
  const named = agentName
    ? (s.users.find(u => u.kind === 'agent' && u.name.toLowerCase() === agentName.toLowerCase())
      ?? s.users.find(u => u.name.toLowerCase() === agentName.toLowerCase()))
    : undefined;
  if (agentName && !named) console.error(`[baseline] no user named "${agentName}" — using default agent identity`);
  return named ?? s.users.find(u => u.kind === 'agent') ?? s.currentUser;
})();
const keyOf = (issueId: string) => {
  const s = snap();
  const i = s.issues.find(x => x.id === issueId);
  return i ? issueKey(i, s.teams) : issueId;
};

function brief(issueList: ReturnType<Store['listIssues']>) {
  const s = snap();
  return issueList.map(i => ({
    key: issueKey(i, s.teams),
    title: i.title,
    state: s.states.find(st => st.id === i.stateId)?.name,
    priority: i.priority === 0 ? 'none' : ['urgent', 'urgent', 'high', 'medium', 'low'][i.priority],
    assignee: s.users.find(u => u.id === i.assigneeId)?.name ?? null,
    project: s.projects.find(p => p.id === i.projectId)?.name ?? null,
    labels: i.labelIds.map(l => s.labels.find(x => x.id === l)?.name).filter(Boolean),
    updatedAt: i.updatedAt,
  }));
}

const server = new McpServer({ name: 'baseline', version: '0.1.0' });

server.tool(
  'bootstrap',
  'Get workspace overview: teams, states, projects, users and issue counts',
  {},
  async () => {
    const s = snap();
    const summary = {
      workspace: s.workspace.name,
      currentUser: s.currentUser.name,
      writingAs: actor.name,
      users: s.users.map(u => ({ name: u.name, kind: u.kind })),
      teams: s.teams.map(t => ({
        key: t.key, name: t.name,
        states: s.states.filter(st => st.teamId === t.id).map(st => `${st.name} (${st.type})`),
        issueCount: s.issues.filter(i => i.teamId === t.id).length,
      })),
      projects: s.projects.map(p => ({ name: p.name, status: p.status, progress: store.projectProgress(p.id).percent + '%' })),
      openIssueCount: s.issues.length,
    };
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  },
);

server.tool(
  'create_issue',
  'Create an issue. Returns the new issue with its human key (e.g. CORE-14).',
  {
    title: z.string().describe('Issue title'),
    team: z.string().describe('Team key (e.g. CORE). See bootstrap.'),
    description: z.string().optional().describe('Markdown description'),
    state: z.string().optional().describe('State name (e.g. "Todo", "In Progress"). Defaults to Todo.'),
    priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']).optional(),
    assignee: z.string().optional().describe('Assignee name, as listed in bootstrap'),
    project: z.string().optional().describe('Project name to attach the issue to'),
    labels: z.array(z.string()).optional().describe('Label names'),
  },
  async ({ title, team, description, state, priority, assignee, project, labels }) => {
    const s = snap();
    const t = s.teams.find(x => x.key.toLowerCase() === team.toLowerCase() || x.name.toLowerCase() === team.toLowerCase());
    if (!t) return { content: [{ type: 'text', text: `Unknown team "${team}". Teams: ${s.teams.map(x => x.key).join(', ')}` }] };
    const st = state ? s.states.find(x => x.teamId === t.id && x.name.toLowerCase() === state.toLowerCase()) : undefined;
    const assigneeUser = assignee ? s.users.find(u => u.name.toLowerCase().includes(assignee.toLowerCase())) : undefined;
    const proj = project ? s.projects.find(p => p.name.toLowerCase().includes(project.toLowerCase())) : undefined;
    const labelIds = (labels ?? []).map(n => s.labels.find(l => l.teamId === t.id && l.name.toLowerCase() === n.toLowerCase())?.id).filter(Boolean) as string[];
    const priorityNum: Priority = priority === 'urgent' ? 1 : priority === 'high' ? 2 : priority === 'medium' ? 3 : priority === 'low' ? 4 : 0;
    const issue = store.createIssue({
      teamId: t.id, title, description, stateId: st?.id, priority: priorityNum,
      assigneeId: assignee === null ? null : assigneeUser?.id, projectId: proj?.id ?? null, labelIds,
    }, actor.id);
    return { content: [{ type: 'text', text: `Created ${issueKey(issue, snap().teams)} — ${issue.title}` }] };
  },
);

server.tool(
  'update_issue',
  'Update an issue by key (e.g. CORE-3) or id',
  {
    issue: z.string().describe('Issue key like CORE-3'),
    title: z.string().optional(),
    description: z.string().optional(),
    state: z.string().optional(),
    priority: z.enum(['none', 'urgent', 'high', 'medium', 'low']).optional(),
    assignee: z.string().nullable().optional().describe('Name to assign, or null to unassign'),
    project: z.string().nullable().optional(),
    comment: z.string().optional().describe('If set, also posts this comment'),
  },
  async ({ issue, title, description, state, priority, assignee, project, comment }) => {
    const s = snap();
    const i = store.getByKey(issue) ?? s.issues.find(x => x.id === issue);
    if (!i) return { content: [{ type: 'text', text: `Unknown issue "${issue}"` }] };
    const st = state ? s.states.find(x => x.teamId === i.teamId && x.name.toLowerCase() === state.toLowerCase()) : undefined;
    if (state && !st) return { content: [{ type: 'text', text: `Unknown state "${state}"` }] };
    const assigneeUser = assignee ? s.users.find(u => u.name.toLowerCase().includes(assignee.toLowerCase())) : undefined;
    const proj = project ? s.projects.find(p => p.name.toLowerCase().includes(project.toLowerCase())) : undefined;
    const priorityNum: Priority | undefined = priority === undefined ? undefined : priority === 'urgent' ? 1 : priority === 'high' ? 2 : priority === 'medium' ? 3 : priority === 'low' ? 4 : 0;
    store.updateIssue(i.id, {
      title, description, stateId: st?.id, priority: priorityNum,
      assigneeId: assignee === null ? null : (assigneeUser?.id ?? undefined),
      projectId: proj === null ? null : (proj?.id ?? undefined),
    }, actor.id);
    if (comment) store.addComment(i.id, actor.id, comment);
    return { content: [{ type: 'text', text: `Updated ${issue}` }] };
  },
);

server.tool(
  'get_issue',
  'Get full issue detail: description, comments, activity, properties',
  { issue: z.string().describe('Issue key like CORE-3') },
  async ({ issue }) => {
    const i = store.getByKey(issue);
    if (!i) return { content: [{ type: 'text', text: `Unknown issue "${issue}"` }] };
    const s = snap();
    const out = {
      key: issueKey(i, s.teams), title: i.title, description: i.description,
      state: s.states.find(st => st.id === i.stateId)?.name,
      priority: ['none', 'urgent', 'high', 'medium', 'low'][i.priority],
      assignee: s.users.find(u => u.id === i.assigneeId)?.name ?? null,
      project: s.projects.find(p => p.id === i.projectId)?.name ?? null,
      labels: i.labelIds.map(l => s.labels.find(x => x.id === l)?.name),
      createdAt: i.createdAt, updatedAt: i.updatedAt,
      comments: s.comments.filter(c => c.issueId === i.id).map(c => ({ author: s.users.find(u => u.id === c.userId)?.name, body: c.body, at: c.createdAt })),
      activity: s.activity.filter(a => a.issueId === i.id).slice(0, 20).map(a => ({ type: a.type, at: a.createdAt })),
    };
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  },
);

server.tool(
  'list_issues',
  'List issues with optional filters',
  {
    team: z.string().optional(),
    state: z.string().optional(),
    stateType: z.enum(['backlog', 'unstarted', 'started', 'completed', 'canceled']).optional(),
    assignee: z.string().optional().describe('"me" works'),
    project: z.string().optional(),
    query: z.string().optional().describe('Substring match on title/description'),
    limit: z.number().optional(),
  },
  async ({ team, state, stateType, assignee, project, query, limit }) => {
    const s = snap();
    const t = team ? s.teams.find(x => x.key.toLowerCase() === team.toLowerCase() || x.name.toLowerCase() === team.toLowerCase()) : undefined;
    const st = state ? s.states.find(x => x.name.toLowerCase() === state.toLowerCase()) : undefined;
    const me = s.currentUser.id;
    const user = assignee ? (assignee === 'me' ? me : s.users.find(u => u.name.toLowerCase().includes(assignee.toLowerCase()))?.id) : undefined;
    const proj = project ? s.projects.find(p => p.name.toLowerCase().includes(project.toLowerCase())) : undefined;
    let issues = store.listIssues({ teamId: t?.id, stateId: st?.id, assigneeId: user, projectId: proj?.id, query, limit });
    if (stateType) {
      const typeStateIds = s.states.filter(x => x.type === (stateType as WorkflowStateType)).map(x => x.id);
      issues = issues.filter(i => typeStateIds.includes(i.stateId));
    }
    return { content: [{ type: 'text', text: JSON.stringify(brief(issues), null, 2) }] };
  },
);

server.tool(
  'search',
  'Search issues and projects by substring',
  { query: z.string() },
  async ({ query }) => {
    const r = store.search(query);
    return { content: [{ type: 'text', text: JSON.stringify({ issues: brief(r.issues), projects: r.projects.map(p => p.name) }, null, 2) }] };
  },
);

server.tool('list_projects', 'List projects with progress', {}, async () => {
  const s = snap();
  return { content: [{ type: 'text', text: JSON.stringify(s.projects.map(p => ({ name: p.name, status: p.status, health: p.health, targetDate: p.targetDate, lead: s.users.find(u => u.id === p.leadId)?.name ?? null, progress: store.projectProgress(p.id).percent + '%', openIssues: s.issues.filter(i => i.projectId === p.id && !i.completedAt && !i.canceledAt).length })), null, 2) }] };
});

server.tool(
  'create_project',
  'Create a project',
  { name: z.string(), description: z.string().optional(), lead: z.string().optional(), targetDate: z.string().optional().describe('ISO date') },
  async ({ name, description, lead, targetDate }) => {
    const s = snap();
    const leadUser = lead ? s.users.find(u => u.name.toLowerCase().includes(lead.toLowerCase())) : undefined;
    const p = store.createProject({ name, description, leadId: leadUser?.id ?? null, targetDate: targetDate ?? null });
    return { content: [{ type: 'text', text: `Created project "${p.name}"` }] };
  },
);

server.tool('list_teams', 'List teams and their workflow states', {}, async () => {
  const s = snap();
  return { content: [{ type: 'text', text: JSON.stringify(s.teams.map(t => ({ key: t.key, name: t.name, states: s.states.filter(x => x.teamId === t.id).map(x => ({ name: x.name, type: x.type })) })), null, 2) }] };
});

server.tool(
  'add_comment',
  'Comment on an issue',
  { issue: z.string().describe('Issue key like CORE-3'), body: z.string() },
  async ({ issue, body }) => {
    const i = store.getByKey(issue);
    if (!i) return { content: [{ type: 'text', text: `Unknown issue "${issue}"` }] };
    store.addComment(i.id, actor.id, body);
    return { content: [{ type: 'text', text: `Commented on ${issue}` }] };
  },
);

server.tool(
  'create_label',
  'Create a label in a team',
  { team: z.string(), name: z.string(), color: z.string().optional().describe('Hex like #eb5757') },
  async ({ team, name, color }) => {
    const s = snap();
    const t = s.teams.find(x => x.key.toLowerCase() === team.toLowerCase());
    if (!t) return { content: [{ type: 'text', text: `Unknown team "${team}"` }] };
    const l = store.createLabel(t.id, name, color ?? '#8a8f98');
    return { content: [{ type: 'text', text: `Created label ${l.name}` }] };
  },
);

server.tool('my_issues', 'Issues assigned to the current user, grouped by state', {}, async () => {
  const s = snap();
  const mine = store.listIssues({ assigneeId: s.currentUser.id });
  const groups: Record<string, unknown[]> = {};
  for (const i of mine) {
    const name = s.states.find(st => st.id === i.stateId)?.name ?? '?';
    (groups[name] ??= []).push(...brief([i]));
  }
  return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
});

server.tool(
  'relate_issues',
  'Relate two issues (blocks / blocked_by / related / duplicate)',
  { issue: z.string(), related: z.string(), type: z.enum(['blocks', 'blocked_by', 'related', 'duplicate']) },
  async ({ issue, related, type }) => {
    const a = store.getByKey(issue); const b = store.getByKey(related);
    if (!a || !b) return { content: [{ type: 'text', text: 'Unknown issue key(s)' }] };
    store.setRelation(a.id, b.id, type as RelationType, actor.id);
    return { content: [{ type: 'text', text: `${issue} ${type} ${related}` }] };
  },
);

server.tool(
  'delete_issue',
  'Permanently delete an issue by key',
  { issue: z.string() },
  async ({ issue }) => {
    const i = store.getByKey(issue);
    if (!i) return { content: [{ type: 'text', text: `Unknown issue "${issue}"` }] };
    store.deleteIssue(i.id);
    return { content: [{ type: 'text', text: `Deleted ${issue}` }] };
  },
);

await server.connect(new StdioServerTransport());
console.error(`[baseline] MCP server running on stdio (writing as ${actor.name})`);
} // startMcp

// runnable directly: node dist/mcp/index.js [--agent Name]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flagIdx = process.argv.indexOf('--agent');
  await startMcp(flagIdx !== -1 ? process.argv[flagIdx + 1] : undefined);
}
