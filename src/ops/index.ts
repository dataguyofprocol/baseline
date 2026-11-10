// The one list of agent operations. The `baseline agent` commands, the skill's "Agent loop"
// block and the parity check are generated from OPERATIONS; the MCP server registers it.
// Adding a tool means adding an entry here; there is no other place to add one.
import { z } from 'zod';
import { issueIndex, ResolveError, resolve, views, type Baseline } from '../client/index.js';
import { issueKey, PRIORITY_SHORT, type Issue, type Priority, type Snapshot, type Team, type WorkflowStateType } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import { plainMentions } from '../core/mentions.js';
import { actorIdOf } from './identity.js';
import { defineOp, OpError, type AnyOperation, type Checkout, type OpContext, type Surface } from './operation.js';

const IssueKey = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/, 'expected an issue key such as ENG-42').describe('Issue key, for example ENG-42.');
const Links = z.array(z.url()).max(10).describe('PR, commit, preview or document URLs. Each is attached to the issue once.');
const Health = z.enum(['onTrack', 'atRisk', 'offTrack']);
const PriorityName = z.enum(['none', 'urgent', 'high', 'medium', 'low']);
const PRIORITY_OF: Record<z.infer<typeof PriorityName>, Priority> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };

/** every write's output starts with these two */
const Receipt = z.object({
  op_id: z.string().nullable().describe('Pass to undo to reverse this change. null when this call changed nothing.'),
  attributed_to: z.string().describe('How the change shows in Baseline, for example "Claude Code via Parth Batra".'),
});

async function issueByKey(bl: Baseline, key: string) {
  const i = await bl.getByKey(key);
  if (!i || i.deletedAt) throw new OpError('not-found', `No issue ${key.toUpperCase()}. Find keys with find_issues.`);
  return i;
}

const names = (snap: Pick<Snapshot, 'users'>) => (id: string | null) => views.nameOf(snap, id);
const stateName = (snap: Pick<Snapshot, 'states'>, stateId: string) => snap.states.find(s => s.id === stateId)?.name ?? '?';
const stateType = (snap: Pick<Snapshot, 'states'>, stateId: string): WorkflowStateType | undefined => snap.states.find(s => s.id === stateId)?.type;
const isOpen = (snap: Pick<Snapshot, 'states'>, i: Issue) => !i.deletedAt && !i.archivedAt && !['completed', 'canceled'].includes(stateType(snap, i.stateId) ?? '');
const lines = (...xs: Array<string | false | null | undefined>) => xs.filter((x): x is string => !!x).join('\n');
/** how to undo, in the words of the front door that ran the op: the MCP tool, or the CLI command */
const receiptLine = (o: { op_id: string | null; attributed_to: string }, surface: Surface) => !o.op_id ? '(nothing changed)'
  : surface === 'mcp' ? `(${o.attributed_to}; to undo, call the undo tool with op_id ${o.op_id})` : `(${o.attributed_to}; undo with: baseline agent undo ${o.op_id})`;
/** urgent first, no priority last */
const rank = (p: Priority) => p === 0 ? 5 : p;
const shortTitle = (t: string) => t.length > 70 ? `${t.slice(0, 67)}…` : t;

/** the team a new issue or a search is about: the one named, else the repo's (from `baseline connect`),
 *  else the person's only team, else the workspace's only team */
function teamFor(snap: Pick<Snapshot, 'teams' | 'currentUser'>, named: string | undefined, ctx: OpContext): Team {
  if (named) return resolve.resolveTeam(snap, named, { required: true })!;
  const repo = ctx.local?.team ? resolve.resolveTeam(snap, ctx.local.team) : undefined;
  if (repo) return repo;
  const mine = snap.teams.filter(t => t.memberIds.includes(snap.currentUser.id));
  if (mine.length === 1) return mine[0]!;
  if (snap.teams.length === 1) return snap.teams[0]!;
  throw new OpError('invalid', `Which team? Pass team, one of: ${(mine.length ? mine : snap.teams).map(t => t.key).join(', ')}. (\`baseline connect claude --team KEY\` maps this repo to one.)`);
}

/** issues that wait on an open issue */
function blockedIds(snap: Pick<Snapshot, 'relations' | 'issues' | 'states'>): Set<string> {
  const open = new Set(snap.issues.filter(i => isOpen(snap, i)).map(i => i.id));
  const out = new Set<string>();
  for (const r of snap.relations) {
    if (r.type === 'blocked_by' && open.has(r.relatedIssueId)) out.add(r.issueId);
    if (r.type === 'blocks' && open.has(r.issueId)) out.add(r.relatedIssueId);
  }
  return out;
}

/** git, for the branch start_issue returns: done on this machine when the front door can, else the command */
async function checkoutFor(ctx: OpContext, branch: string): Promise<Checkout> {
  if (ctx.local) return ctx.local.checkout(branch);
  return { status: 'manual', branch, command: `git checkout -b ${branch}`, note: 'Baseline runs on a server here, so run it in the repo yourself' };
}
const GitResult = z.object({
  status: z.enum(['checked_out', 'created', 'already_on', 'manual']).describe('manual: run command yourself.'),
  branch: z.string(), command: z.string(), note: z.string().optional(),
}).describe('What happened to the branch in the repo you run in.');
const gitLine = (g: z.infer<typeof GitResult>) => g.status === 'manual' ? `Branch: ${g.branch}. Run: ${g.command}${g.note ? ` (${g.note})` : ''}`
  : `Branch: ${g.branch} (${g.status === 'created' ? 'created and checked out' : g.status === 'checked_out' ? 'checked out' : 'already checked out'}).`;

const AgentWork = z.object({
  agent: z.string(), via: z.string().nullable(), session: z.string().nullable(),
  status: z.enum(['active', 'finished']), outcome: z.enum(['in_review', 'done', 'stopped']).nullable(), branch: z.string(),
  did: z.string().nullable(), left: z.string().nullable(), blocked: z.string().nullable(), links: z.array(z.string()), updated_at: z.string(),
});
function agentWork(snap: Pick<Snapshot, 'users'>, t: WorkThread): z.infer<typeof AgentWork> {
  const name = names(snap);
  return {
    agent: name(t.agentId) ?? '?', via: t.agentId === t.personId ? null : name(t.personId), session: t.sessionKey,
    status: t.state.status, outcome: t.state.status === 'finished' ? t.state.outcome : null, branch: t.branch,
    ...t.progress, links: t.links, updated_at: t.updatedAt,
  };
}

const IssueRow = z.object({ key: z.string(), title: z.string(), state: z.string(), assignee: z.string().nullable(), priority: z.string() });
const closedType = (t: string | undefined) => t === 'completed' || t === 'canceled';
const rowOf = (snap: Pick<Snapshot, 'teams' | 'states' | 'users'>, i: Issue): z.infer<typeof IssueRow> => ({
  key: issueKey(i, snap.teams), title: i.title, state: stateName(snap, i.stateId), assignee: names(snap)(i.assigneeId), priority: PRIORITY_SHORT[i.priority],
});

// ---------------------------------------------------------------- reads

export type NextWhy = 'in progress, yours' | 'Todo, yours' | 'current cycle, unassigned';

/** next_issue's ranking, pure, so the terminal UI's Up next shows the same order: the person's issues in
 *  progress, then their Todo by priority, then unassigned issues in their teams' current cycle; issues an
 *  open issue blocks are left out. `teamIds` default: the person's teams (all teams when they're on none). */
export function rankNextIssues(snap: Pick<Snapshot, 'issues' | 'states' | 'teams' | 'cycles' | 'relations' | 'currentUser'>, opts: { teamIds?: string[]; limit: number; now?: string }): { issues: Array<{ issue: Issue; why: NextWhy }>; blockedSkipped: number } {
  const me = snap.currentUser.id;
  const myTeams = opts.teamIds ?? (() => { const t = snap.teams.filter(x => x.memberIds.includes(me)).map(x => x.id); return t.length ? t : snap.teams.map(x => x.id); })();
  const now = opts.now ?? new Date().toISOString();
  const current = new Set(snap.cycles.filter(c => myTeams.includes(c.teamId) && !c.completedAt && c.startsAt <= now && now < c.endsAt).map(c => c.id));
  const blocked = blockedIds(snap);
  const open = snap.issues.filter(i => isOpen(snap, i) && myTeams.includes(i.teamId));
  const byPriority = (a: Issue, b: Issue) => rank(a.priority) - rank(b.priority) || b.updatedAt.localeCompare(a.updatedAt);
  const tiers: Array<[NextWhy, Issue[]]> = [
    ['in progress, yours', open.filter(i => i.assigneeId === me && stateType(snap, i.stateId) === 'started').sort(byPriority)],
    ['Todo, yours', open.filter(i => i.assigneeId === me && stateType(snap, i.stateId) === 'unstarted').sort(byPriority)],
    ['current cycle, unassigned', open.filter(i => !i.assigneeId && !!i.cycleId && current.has(i.cycleId) && ['unstarted', 'backlog'].includes(stateType(snap, i.stateId) ?? '')).sort(byPriority)],
  ];
  const picked: Array<{ issue: Issue; why: NextWhy }> = [];
  let blockedSkipped = 0;
  for (const [why, list] of tiers) for (const i of list) {
    if (blocked.has(i.id)) { blockedSkipped++; continue; }
    if (picked.length < opts.limit) picked.push({ issue: i, why });
  }
  return { issues: picked, blockedSkipped };
}

export const nextIssue = defineOp({
  name: 'next_issue',
  title: 'What to work on next',
  description:
    'Answer "what should I work on?": up to 3 unblocked issues for the person you work for. First their issues in progress, then their Todo issues by priority, ' +
    'then unassigned issues in the current cycle of their teams. Suggest the first one and ask; call start_issue when they pick.',
  input: z.object({
    team: z.string().optional().describe('Team key, for example ENG. Default: all of the person\'s teams.'),
    limit: z.number().int().min(1).max(10).optional().describe('At most this many. Default 3.'),
  }),
  output: z.object({
    issues: z.array(IssueRow.extend({ why: z.string().describe('in progress / Todo / current cycle, unassigned') })),
    blocked_skipped: z.number().describe('Issues left out because an open issue blocks them.'),
  }),
  effect: { kind: 'read' },
  async run({ bl }, input) {
    const snap = await bl.snapshot(['issues', 'states', 'teams', 'cycles', 'relations', 'users', 'currentUser']);
    const team = resolve.resolveTeam(snap, input.team, { required: true });
    const r = rankNextIssues(snap, { teamIds: team ? [team.id] : undefined, limit: input.limit ?? 3 });
    return { issues: r.issues.map(x => ({ ...rowOf(snap, x.issue), why: x.why })), blocked_skipped: r.blockedSkipped };
  },
  text: ({ issues, blocked_skipped }) => issues.length
    ? lines(...issues.map((i, n) => `${n + 1}. ${i.key} ${i.title} (${i.state}${i.priority === 'None' ? '' : `, ${i.priority} priority`}${i.why.includes('unassigned') ? ', unassigned in the current cycle' : ''})`), blocked_skipped ? `(${blocked_skipped} blocked issue(s) left out)` : null)
    : `Nothing assigned to you or open in your teams' current cycle${blocked_skipped ? ` (${blocked_skipped} blocked issue(s) left out)` : ''}. Ask the person what to work on; find_issues searches the team.`,
});

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'it', 'this', 'that', 'bug', 'issue', 'fix', 'please', 'when', 'from', 'by', 'at', 'be', 'we', 'i', 'my']);
/** "Fix the login-redirect bug" → ["login", "redirect"] */
export const wordsOf = (q: string) => [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !STOP_WORDS.has(w)))];

export const findIssues = defineOp({
  name: 'find_issues',
  title: 'Find issues',
  description:
    'Search the team\'s issues for work the person asks about, before you create anything. Searches everyone\'s issues (not only the person\'s), ' +
    'ranks them by how many of the query\'s words are in the title or description, and says what it searched. ' +
    'On a match, ask once whether to track the work on it; with no match, use propose_issue.',
  input: z.object({
    query: z.string().trim().min(1).describe('The work in a few words, for example "login redirect".'),
    team: z.string().optional().describe('Team key. Default: this repo\'s team, else all of the person\'s teams.'),
    state: z.enum(['open', 'all']).optional().describe('"open" (default: not done or canceled) or "all".'),
    limit: z.number().int().min(1).max(25).optional().describe('At most this many. Default 5.'),
  }),
  output: z.object({
    issues: z.array(IssueRow.extend({ matched: z.array(z.string()).describe('The query words found in it.') })),
    searched: z.object({ teams: z.array(z.string()), words: z.array(z.string()), state: z.string(), issues: z.number() }).describe('What was searched.'),
  }),
  effect: { kind: 'read' },
  positional: ['query'],
  async run(ctx, input) {
    const snap = await ctx.bl.snapshot(['issues', 'states', 'teams', 'users', 'currentUser']);
    const me = snap.currentUser.id;
    const named = input.team ? resolve.resolveTeam(snap, input.team, { required: true }) : ctx.local?.team ? resolve.resolveTeam(snap, ctx.local.team) : undefined;
    const teams = named ? [named] : (() => { const t = snap.teams.filter(x => x.memberIds.includes(me)); return t.length ? t : snap.teams; })();
    const words = wordsOf(input.query);
    if (!words.length) throw new OpError('invalid', `"${input.query}" has no words to search for. Use the words of the work, for example "login redirect".`);
    const pool = snap.issues.filter(i => teams.some(t => t.id === i.teamId) && !i.deletedAt && !i.archivedAt && ((input.state ?? 'open') === 'all' || isOpen(snap, i)));
    const scored = pool.map(i => {
      const title = i.title.toLowerCase(), body = i.description.toLowerCase();
      const inTitle = words.filter(w => title.includes(w)), inBody = words.filter(w => !title.includes(w) && body.includes(w));
      return { i, matched: [...inTitle, ...inBody], score: inTitle.length * 2 + inBody.length };
    })
      // half the words at least (all of a one- or two-word query in the title or body)
      .filter(x => x.matched.length >= Math.ceil(words.length / 2))
      .sort((a, b) => b.score - a.score || (isOpen(snap, b.i) ? 1 : 0) - (isOpen(snap, a.i) ? 1 : 0) || b.i.updatedAt.localeCompare(a.i.updatedAt));
    return {
      issues: scored.slice(0, input.limit ?? 5).map(x => ({ ...rowOf(snap, x.i), matched: x.matched })),
      searched: { teams: teams.map(t => t.key), words, state: input.state ?? 'open', issues: pool.length },
    };
  },
  text: ({ issues, searched }) => lines(
    `Searched ${searched.issues} ${searched.state === 'open' ? 'open ' : ''}issue(s) in ${searched.teams.join(', ')} for: ${searched.words.join(', ')}.`,
    ...issues.map(i => `${i.key.padEnd(9)} [${i.state}] ${i.title}  (${i.assignee ?? 'unassigned'}; matched ${i.matched.join(', ')})`),
    !issues.length && 'No match. If this is new work, propose it with propose_issue and ask the person.',
  ),
});

export const getIssue = defineOp({
  name: 'get_issue',
  title: 'Get issue',
  description:
    'Get one Baseline issue by key: description, state, assignee, comments, sub-issues, blockers, links, and the progress that agents posted. ' +
    'Call this before you work on an issue that you did not start in this conversation.',
  input: z.object({ issue: IssueKey }),
  output: z.object({
    issue: z.looseObject({ key: z.string(), title: z.string(), state: z.string().nullable(), description: z.string() }).describe('The issue as `baseline issue show --json` prints it, with the newest 30 comments and activity rows.'),
    sub_issues: z.array(IssueRow),
    agent_work: z.array(AgentWork),
    truncated: z.object({ comments: z.number(), activity: z.number() }).describe('Rows left out (older ones).'),
  }),
  effect: { kind: 'read' },
  positional: ['issue'],
  async run({ bl }, input) {
    const [snap, i] = await Promise.all([bl.snapshot(views.ISSUE_DETAIL_SECTIONS), issueByKey(bl, input.issue)]);
    const detail = views.issueDetail(i, snap, await issueIndex(bl, snap.issues, [i]));
    const threads = await bl.workThreads(i.id);
    return {
      issue: { ...detail, comments: detail.comments.slice(-KEEP), activity: detail.activity.slice(-KEEP) },
      sub_issues: snap.issues.filter(x => x.parentId === i.id && !x.deletedAt).map(x => rowOf(snap, x)),
      agent_work: threads.map(t => agentWork(snap, t)),
      truncated: { comments: Math.max(0, detail.comments.length - KEEP), activity: Math.max(0, detail.activity.length - KEEP) },
    };
  },
  text({ issue, sub_issues, agent_work }) {
    const i = issue as typeof issue & {
      assignee?: string | null; priority?: string; parentId?: string | null;
      comments?: Array<{ author: string | null; via: string | null; body: string }>;
      relations?: Array<{ type: string; issue: string | null }>; links?: Array<{ title: string; url: string }>;
    };
    const rel = (type: string, label: string) => {
      const keys = (i.relations ?? []).filter(r => r.type === type && r.issue).map(r => r.issue);
      return keys.length ? `${label}: ${keys.join(', ')}` : null;
    };
    return lines(
      `${i.key}  ${i.title}`,
      `state: ${i.state ?? '?'}  assignee: ${i.assignee ?? '—'}  priority: ${i.priority ?? '—'}${i.parentId ? `  parent: ${i.parentId}` : ''}`,
      rel('blocked_by', 'blocked by'), rel('blocks', 'blocks'), rel('related', 'related'), rel('duplicate', 'duplicate of'),
      i.description && `\n${plainMentions(i.description)}`,
      sub_issues.length > 0 && `\nsub-issues:\n${sub_issues.map(s => `  ${s.key} [${s.state}] ${s.title}${s.assignee ? ` (${s.assignee})` : ''}`).join('\n')}`,
      (i.links ?? []).length > 0 && `\nlinks:\n${(i.links ?? []).map(l => `  ${l.title && l.title !== l.url ? `${l.title}: ` : ''}${l.url}`).join('\n')}`,
      agent_work.length > 0 && `\nagent work:\n${agent_work.map(w => `  ${w.agent}${w.via ? ` via ${w.via}` : ''} · ${w.status}${w.outcome ? ` (${w.outcome})` : ''} · branch ${w.branch}${w.did ? `\n    did: ${w.did}` : ''}${w.left ? `\n    left: ${w.left}` : ''}${w.blocked ? `\n    blocked: ${w.blocked}` : ''}`).join('\n')}`,
      (i.comments ?? []).length > 0 && `\ncomments:\n${(i.comments ?? []).map(c => `— ${c.author ?? '?'}${c.via ? ` via ${c.via}` : ''}: ${plainMentions(c.body)}`).join('\n')}`,
    );
  },
});

const KEEP = 30;

export const listIssues = defineOp({
  name: 'list_issues',
  title: 'List issues',
  description:
    'List Baseline issues, most recently updated first. With no filters it lists the open issues assigned to you (the person the agent works for). ' +
    'With query, it searches everyone\'s issues unless you pass assignee; to find work by its words, find_issues ranks the matches. Use assignee "any" to list everyone\'s issues. ' +
    'Names match without case; an unknown name returns the valid names.',
  input: z.object({
    query: z.string().optional().describe('Text to find in the title or description.'),
    assignee: z.string().optional().describe('"me" (default without query), "any" (default with query), "none", or a person\'s name.'),
    state: z.string().optional().describe('A state name such as "In Progress", "open" (default: not done or canceled), or "all".'),
    team: z.string().optional().describe('Team key, for example ENG.'),
    project: z.string().optional().describe('Project name.'),
    limit: z.number().int().min(1).max(100).optional().describe('At most this many issues. Default 25.'),
  }),
  output: z.object({
    issues: z.array(z.object({ key: z.string(), title: z.string(), state: z.string(), assignee: z.string().nullable(), priority: z.string(), project: z.string().nullable(), updated_at: z.string() })),
    total: z.number(), shown: z.number(),
    filter: z.string().describe('The filter applied, in words.'),
  }),
  effect: { kind: 'read' },
  async run({ bl }, input) {
    const snap = await bl.snapshot(['teams', 'states', 'users', 'currentUser', 'projects']);
    const team = resolve.resolveTeam(snap, input.team, { required: true });
    const project = input.project ? resolve.resolveProject(snap, input.project) : undefined;
    const query = input.query?.trim() || undefined;
    // a search is about the work, not whose it is: it never quietly narrows to "me"
    const who = (input.assignee ?? (query ? 'any' : 'me')).trim().toLowerCase();
    const assignee = who === 'any' || who === 'none' ? undefined : resolve.resolveUser(snap, who);
    const want = (input.state ?? 'open').trim().toLowerCase();
    const states = snap.states.filter(s => !team || s.teamId === team.id);
    const stateIds = want === 'all' ? null
      : want === 'open' ? new Set(states.filter(s => s.type !== 'completed' && s.type !== 'canceled').map(s => s.id))
      : new Set(states.filter(s => s.name.toLowerCase() === want).map(s => s.id));
    if (stateIds && !stateIds.size) throw new ResolveError(`Unknown state "${input.state}". Use one of the valid states: open, all, ${[...new Set(states.map(s => s.name))].join(', ')}`);
    const found = (await bl.listIssues({ teamId: team?.id, projectId: project?.id, assigneeId: assignee?.id, query }))
      .filter(i => (!stateIds || stateIds.has(i.stateId)) && (who !== 'none' || !i.assigneeId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const shown = found.slice(0, input.limit ?? 25);
    const name = names(snap);
    const filter = [`${want} issues`, who === 'any' ? 'anyone\'s' : who === 'none' ? 'unassigned' : `assigned to ${assignee?.id === snap.currentUser.id ? 'you' : assignee?.name}`,
      team && `in ${team.key}`, project && `in project ${project.name}`, query && `matching "${query}"`].filter(Boolean).join(', ');
    return {
      issues: shown.map(i => ({
        key: issueKey(i, snap.teams), title: i.title, state: stateName(snap, i.stateId), assignee: name(i.assigneeId), priority: PRIORITY_SHORT[i.priority],
        project: snap.projects.find(p => p.id === i.projectId)?.name ?? null, updated_at: i.updatedAt,
      })),
      total: found.length, shown: shown.length, filter,
    };
  },
  text: ({ issues, total, shown, filter }) => lines(
    ...issues.map(i => `${i.key.padEnd(9)} [${i.state}] ${i.priority.padEnd(7)} ${i.title}  (${i.assignee ?? '—'})`),
    `${shown} of ${total} issue(s): ${filter}`,
  ),
});

/** "yesterday" (from its start), "today", "3d", "12h", "1w", or a date */
export function sinceDate(raw: string | undefined, now = new Date()): Date {
  const v = (raw ?? 'yesterday').trim().toLowerCase();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (v === 'today') return day;
  if (v === 'yesterday') return new Date(day.getTime() - 86_400_000);
  const m = /^(\d+)\s*([hdw])$/.exec(v);
  if (m) return new Date(now.getTime() - Number(m[1]) * { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2] as 'h' | 'd' | 'w']);
  const t = Date.parse(raw!);
  if (Number.isNaN(t)) throw new OpError('invalid', `since "${raw}": use yesterday, today, 12h, 3d, 1w or a date such as 2026-11-09`);
  return new Date(t);
}

export const myActivity = defineOp({
  name: 'my_activity',
  title: 'My activity (standup)',
  description:
    'What the person (and agents working for them) did since a time: issues started, progressed, finished and filed, and their pull requests, ' +
    'as a few lines ready to paste into a standup. Use it for "what did I do since yesterday?".',
  input: z.object({ since: z.string().optional().describe('yesterday (default), today, 12h, 3d, 1w, or a date such as 2026-11-09.') }),
  output: z.object({
    since: z.string(),
    issues: z.array(z.object({ key: z.string(), title: z.string(), state: z.string(), did: z.array(z.string()), progress: z.string().nullable() })),
    pull_requests: z.array(z.object({ title: z.string(), url: z.string(), state: z.string() })),
  }),
  effect: { kind: 'read' },
  async run({ bl }, input) {
    const since = sinceDate(input.since).toISOString();
    const snap = await bl.snapshot(['activity', 'issues', 'teams', 'states', 'users', 'currentUser', 'pullRequests']);
    const me = snap.currentUser;
    const mine = snap.activity.filter(a => (a.userId === me.id || a.viaUserId === me.id) && a.createdAt >= since && a.issueId).reverse();
    const byIssue = new Map<string, { did: string[]; last: string }>();
    for (const a of mine) {
      const e = byIssue.get(a.issueId!) ?? { did: [], last: a.createdAt };
      e.last = a.createdAt;
      const to = typeof a.data.to === 'string' ? snap.states.find(s => s.id === a.data.to) : undefined;
      const word = a.type === 'created' ? 'filed'
        : (a.type === 'stateChanged' || a.type === 'triageAccepted') && to ? (to.type === 'started' && to.name.toLowerCase() !== 'in review' ? 'started' : `→ ${to.name}`)
        : a.type === 'commented' ? 'progress' : a.type === 'attached' ? 'linked' : undefined;
      if (word && !e.did.includes(word)) e.did.push(word);
      byIssue.set(a.issueId!, e);
    }
    const touched = [...byIssue.entries()].filter(([, e]) => e.did.length).sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(0, 8);
    const issues = await Promise.all(touched.map(async ([issueId, e]) => {
      const i = snap.issues.find(x => x.id === issueId) ?? await bl.getIssue(issueId);
      // an issue in Trash (an undone create_issue, say) isn't work you did
      if (!i || i.deletedAt) return undefined;
      const t = (await bl.workThreads(i.id)).filter(x => x.personId === me.id && x.updatedAt >= since && x.progress.did).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      return { key: issueKey(i, snap.teams), title: i.title, state: stateName(snap, i.stateId), did: e.did, progress: t?.progress.did ?? (t?.state.status === 'finished' ? t.state.summary : null) };
    }));
    const gh = me.githubUsername?.toLowerCase();
    const prs = gh ? snap.pullRequests.filter(p => p.author.toLowerCase() === gh && (p.updatedAt >= since || (p.mergedAt ?? '') >= since)) : [];
    return {
      since,
      issues: issues.filter((x): x is NonNullable<typeof x> => !!x),
      pull_requests: prs.slice(0, 5).map(p => ({ title: `${p.repo}#${p.number} ${p.title}`, url: p.url, state: p.mergedAt && p.mergedAt >= since ? 'merged' : p.state })),
    };
  },
  text: ({ since, issues, pull_requests }) => issues.length || pull_requests.length ? lines(
    `Since ${since.slice(0, 16).replace('T', ' ')} UTC:`,
    ...issues.map(i => `- ${i.key} ${shortTitle(i.title)}: ${i.did.join(', ')} (now ${i.state})${i.progress ? `. ${shortTitle(i.progress.replace(/\s+/g, ' '))}` : ''}`),
    ...pull_requests.map(p => `- PR ${p.title} (${p.state})`),
  ) : `Nothing recorded for you since ${since.slice(0, 16).replace('T', ' ')} UTC.`,
});

// ---------------------------------------------------------------- new work: propose, then create on a yes

export const proposeIssue = defineOp({
  name: 'propose_issue',
  title: 'Propose an issue',
  description:
    'Draft a new issue for work the person asked for that matches no open issue (check with find_issues first). Nothing is created and the team sees nothing: ' +
    'it returns the draft for you to show the person. Ask once, for example: Create WEB issue "Fix login redirect after SSO", assigned to you? (yes / edit / don\'t track). ' +
    'Call create_issue with the draft_id only after they say yes. The same title again returns the same draft.',
  input: z.object({
    title: z.string().trim().min(3).max(200).describe('The issue title, as you will show it to the person.'),
    description: z.string().optional().describe('What and why, short markdown.'),
    team: z.string().optional().describe('Team key. Default: this repo\'s team, else the person\'s only team.'),
    priority: PriorityName.optional().describe('none (default), urgent, high, medium or low.'),
  }),
  output: Receipt.extend({
    draft_id: z.string(), team: z.string(), title: z.string(), description: z.string(), priority: z.string(),
    deduplicated: z.boolean(), created: z.literal(false),
  }),
  effect: { kind: 'write', converges: 'One pending draft per (person, team, normalized title); it is visible to nobody else.' },
  positional: ['title'],
  async run(ctx, input) {
    const snap = await ctx.bl.snapshot(['teams', 'currentUser']);
    const team = teamFor(snap, input.team, ctx);
    const r = await ctx.bl.propose({ session: ctx.session, kind: 'issue', teamId: team.id, title: input.title, description: input.description, priority: PRIORITY_OF[input.priority ?? 'none'] }, actorIdOf(ctx.actor));
    return {
      op_id: r.opId, attributed_to: r.attributedTo, draft_id: r.draft.id, team: team.key, title: r.draft.title, description: r.draft.description,
      priority: PRIORITY_SHORT[r.draft.priority as Priority], deduplicated: r.deduplicated, created: false as const,
    };
  },
  text: (o, s) => lines(
    `Draft ${o.draft_id} (not created; only you see it): ${o.team} "${o.title}", priority ${o.priority.toLowerCase()}, assigned to the person when created.`,
    `Ask the person: Create ${o.team} issue "${o.title}", assigned to you? (yes / edit / don't track). On yes, call create_issue with draft_id ${o.draft_id} (start: true to start it now).`,
    receiptLine(o, s),
  ),
});

export const createIssue = defineOp({
  name: 'create_issue',
  title: 'Create issue',
  description:
    'Create an issue the person said yes to in this conversation. Never call it without that yes. Pass the draft_id from propose_issue (or a follow-up from finish_issue) ' +
    'to create exactly what they approved, or title and team for an issue they dictated. A new issue is assigned to them; start: true also starts it and checks out its branch, like start_issue. ' +
    'An approved follow-up goes to the team\'s Triage (Backlog when triage is off). The same draft again returns the same issue.',
  input: z.object({
    draft_id: z.string().optional().describe('The draft the person approved.'),
    title: z.string().trim().min(3).max(200).optional().describe('Without draft_id: the title the person approved.'),
    description: z.string().optional().describe('Without draft_id: what and why.'),
    team: z.string().optional().describe('Team key. Default: the draft\'s team, else this repo\'s team.'),
    priority: PriorityName.optional().describe('Without draft_id: none (default), urgent, high, medium or low.'),
    project: z.string().optional().describe('Project name.'),
    start: z.boolean().optional().describe('Start it now (In Progress, branch checked out). Default false.'),
  }).refine(i => !!i.draft_id || !!i.title, { message: 'pass draft_id (from propose_issue) or title', path: ['draft_id'] }),
  output: Receipt.extend({
    key: z.string(), title: z.string(), state: z.string(), assignee: z.string().nullable(), url: z.string(), from_draft: z.string().nullable(),
    started: z.boolean(), deduplicated: z.boolean(), git: GitResult.nullable(),
  }),
  effect: { kind: 'write', converges: 'A filed draft, or the same title from the same agent and person, returns the issue made the first time.' },
  async run(ctx, input) {
    const { bl } = ctx;
    const snap = await bl.snapshot(['teams', 'states', 'users', 'currentUser', 'projects']);
    let teamId: string;
    if (input.draft_id) {
      const d = (await bl.drafts({})).find(x => x.id === input.draft_id);
      if (!d) throw new OpError('not-found', `No draft ${input.draft_id} for you. Drafts come from propose_issue and propose_followup.`);
      teamId = d.teamId;
    } else teamId = teamFor(snap, input.team, ctx).id;
    const project = input.project ? resolve.resolveProject(snap, input.project) : undefined;
    const r = await bl.createAgentIssue({
      session: ctx.session, teamId, draftId: input.draft_id, title: input.title, description: input.description,
      priority: input.priority ? PRIORITY_OF[input.priority] : undefined, projectId: project?.id, start: input.start,
    }, actorIdOf(ctx.actor));
    const git = r.started || (input.start && r.deduplicated) ? await checkoutFor(ctx, r.branch) : null;
    return {
      op_id: r.opId, attributed_to: r.attributedTo, key: issueKey(r.issue, snap.teams), title: r.issue.title, state: stateName(snap, r.issue.stateId),
      assignee: names(snap)(r.issue.assigneeId), url: r.url, from_draft: r.draft?.id ?? null, started: r.started, deduplicated: r.deduplicated, git,
    };
  },
  text: (o, s) => lines(
    `${o.deduplicated ? 'Already created' : 'Created'} ${o.key} "${o.title}": ${o.state}, assignee ${o.assignee ?? 'nobody'}. ${o.url}`,
    o.git && gitLine(o.git),
    o.started && 'It is started: post_progress as you go, finish_issue when done.',
    receiptLine(o, s),
  ),
});

// ---------------------------------------------------------------- the work loop

export const startIssue = defineOp({
  name: 'start_issue',
  title: 'Start issue',
  description:
    'Tell Baseline that you start work on an issue now, and get on its git branch. If the issue is not started (Triage, Backlog or Todo), it moves to the team\'s first started state, usually In Progress. ' +
    'If nobody is assigned, it is assigned to the person you work for. If it is another person\'s, nothing changes and you are told whose it is: ask the person whether to take it over, then call again with take_over. ' +
    'The branch is checked out (or created from the default branch) in the repo you run in when that is safe; otherwise you get the exact git command. ' +
    'The first call returns the work brief; a repeat returns a short status and your last progress. Call this once, before you change code for the issue.',
  input: z.object({
    issue: IssueKey,
    take_over: z.boolean().optional().describe('The person said to take the issue over from its assignee: reassign it to them and start it.'),
  }),
  output: Receipt.extend({
    key: z.string(), title: z.string(), state: z.string(), assignee: z.string().nullable(), url: z.string(),
    branch: z.string().describe('The issue\'s branch. A pull request from it links to the issue.'),
    git: GitResult,
    brief: z.string().nullable().describe('The issue as a work prompt: description, context and the team\'s guidance. null on a repeat call (get_issue has it).'),
    already_started: z.boolean().describe('true when this call changed nothing because you had started already.'),
    last_progress: z.object({ did: z.string().nullable(), left: z.string().nullable(), blocked: z.string().nullable(), updated_at: z.string() }).nullable(),
    warnings: z.array(z.string()).describe('For example: the issue is done.'),
  }),
  effect: { kind: 'write', converges: 'Moves only a not-started issue and assigns only an unassigned one, so a repeat finds nothing to do and writes nothing.' },
  positional: ['issue'],
  async run(ctx, input) {
    const { bl, actor, session } = ctx;
    const i = await issueByKey(bl, input.issue);
    const r = await bl.startWork(i.id, { session, takeOver: input.take_over }, actorIdOf(actor));
    const snap = await bl.snapshot(['teams', 'states', 'users']);
    const p = r.thread.progress;
    const again = r.opId === null;
    return {
      op_id: r.opId, attributed_to: r.attributedTo, key: issueKey(r.issue, snap.teams), title: r.issue.title, state: stateName(snap, r.issue.stateId),
      assignee: names(snap)(r.issue.assigneeId), url: r.url, branch: r.branch, git: await checkoutFor(ctx, r.branch),
      // the git line above says what happened to the branch, so the brief's generic branch advice goes
      brief: again ? null : r.brief.replace(/^Branch: .*\n?/m, ''), already_started: again,
      last_progress: p.did || p.left || p.blocked ? { ...p, updated_at: r.thread.updatedAt } : null,
      warnings: [...r.warnings, ...(closedType(stateType(snap, r.issue.stateId)) ? [`${issueKey(r.issue, snap.teams)} is ${stateName(snap, r.issue.stateId)}, so its status didn't change. If this is new work, ask whether to reopen it or file a new issue.`] : [])],
    };
  },
  text: (o, s) => lines(
    `${o.already_started ? `${o.key} was already started` : `Started ${o.key}`}: ${o.state}, assignee ${o.assignee ?? 'nobody'}.`,
    gitLine(o.git),
    ...o.warnings.map(w => `warning: ${w}`),
    o.last_progress && `Last progress: ${o.last_progress.did ?? '—'}${o.last_progress.left ? ` | left: ${o.last_progress.left}` : ''}`,
    o.already_started ? `(nothing changed; get_issue ${o.key} has the full brief)` : receiptLine(o, s),
    o.brief && `\n${o.brief}`,
  ),
});

export const createSubIssues = defineOp({
  name: 'create_sub_issues',
  title: 'Create sub-issues',
  description:
    'Split the issue you are working on into sub-issues, one per title, without asking the person first. The issue must be started (start_issue). ' +
    'Each sub-issue gets the issue\'s assignee and project and starts in Todo. A title the issue already has as a sub-issue is skipped. ' +
    'Use it when the plan has separable parts; keep steps of one change in post_progress instead.',
  input: z.object({
    issue: IssueKey.describe('The started issue to split.'),
    titles: z.array(z.string().trim().min(3).max(200)).min(1).max(20).describe('One title per sub-issue.'),
  }),
  output: Receipt.extend({ parent: z.string(), created: z.array(z.object({ key: z.string(), title: z.string() })), existing: z.array(z.object({ key: z.string(), title: z.string() })) }),
  effect: { kind: 'write', converges: 'A title the parent already has as a sub-issue (case and punctuation aside) is not created again.' },
  positional: ['issue'],
  async run({ bl, actor, session }, input) {
    const i = await issueByKey(bl, input.issue);
    const r = await bl.createSubIssues(i.id, { session, titles: input.titles }, actorIdOf(actor));
    const snap = await bl.snapshot(['teams']);
    const row = (x: Issue) => ({ key: issueKey(x, snap.teams), title: x.title });
    return { op_id: r.opId, attributed_to: r.attributedTo, parent: issueKey(r.parent, snap.teams), created: r.created.map(row), existing: r.existing.map(row) };
  },
  text: (o, s) => lines(
    o.created.length ? `Created under ${o.parent}: ${o.created.map(c => `${c.key} ${c.title}`).join('; ')}.` : `No new sub-issues under ${o.parent}.`,
    o.existing.length > 0 && `Already there: ${o.existing.map(c => `${c.key} ${c.title}`).join('; ')}.`,
    receiptLine(o, s),
  ),
});

export const postProgress = defineOp({
  name: 'post_progress',
  title: 'Post progress',
  description:
    'Update your progress note on an issue. You have one progress note per issue: the first call creates it as a comment, and later calls rewrite it in place, ' +
    'so post after each meaningful step without making noise. A field you leave out keeps its last value; an empty string clears it. ' +
    'Put PR, commit or doc URLs in links or pr_url; each URL is attached to the issue once. Calling again with the same text changes nothing.',
  input: z.object({
    issue: IssueKey,
    did: z.string().optional().describe('What is done so far. Short markdown. Name files by absolute path and put commands in backticks.'),
    left: z.string().optional().describe('What remains.'),
    blocked: z.string().optional().describe('What stops you, and what you need from a person. "" when nothing blocks you any more.'),
    links: Links.optional(),
    pr_url: z.url().optional().describe('The pull request for this work, when you open one.'),
  }),
  output: Receipt.extend({
    key: z.string(), comment_url: z.string(), created: z.boolean().describe('true when this call created the note; false when it rewrote it.'),
    links_added: z.number(), progress: z.object({ did: z.string().nullable(), left: z.string().nullable(), blocked: z.string().nullable() }),
  }),
  effect: { kind: 'write', converges: 'One living comment per (issue, agent, person, session), rewritten in place; links are attached once by URL.' },
  positional: ['issue'],
  async run({ bl, actor, session }, input) {
    const i = await issueByKey(bl, input.issue);
    const links = [...(input.links ?? []), ...(input.pr_url ? [input.pr_url] : [])];
    const r = await bl.postProgress(i.id, { session, did: input.did, left: input.left, blocked: input.blocked, links }, actorIdOf(actor));
    return {
      op_id: r.opId, attributed_to: r.attributedTo, key: input.issue.toUpperCase(), comment_url: r.url, created: r.created,
      links_added: r.linksAdded, progress: r.thread.progress,
    };
  },
  text: (o, s) => lines(`${o.op_id ? (o.created ? 'Posted' : 'Updated') : 'Unchanged:'} the progress note on ${o.key}${o.links_added ? `, ${o.links_added} link(s) attached` : ''}.`, receiptLine(o, s)),
});

export const proposeFollowup = defineOp({
  name: 'propose_followup',
  title: 'Note a follow-up',
  description:
    'Note new work that you found while you work on an issue, but that is not part of it. Nothing is filed and nobody is interrupted: the note waits, ' +
    'and finish_issue lists your notes so you ask the person once whether to file them. Do not use this for steps of your current task; put those in post_progress. ' +
    'Noting the same title from the same issue again returns the first note.',
  input: z.object({
    from_issue: IssueKey.describe('The issue you were working on when you found this.'),
    title: z.string().trim().min(3).max(200).describe('What the new work is, as an issue title.'),
    description: z.string().optional().describe('Why it matters and the evidence: file paths with line numbers, log lines, links.'),
    team: z.string().optional().describe('Team key. Default: the team of from_issue.'),
  }),
  output: Receipt.extend({ draft_id: z.string(), from_issue: z.string(), team: z.string(), title: z.string(), deduplicated: z.boolean(), filed: z.literal(false) }),
  effect: { kind: 'write', converges: 'One pending note per (source issue, person, normalized title).' },
  positional: ['from_issue', 'title'],
  async run({ bl, actor, session }, input) {
    const source = await issueByKey(bl, input.from_issue);
    const snap = await bl.snapshot(['teams']);
    const team = input.team ? resolve.resolveTeam(snap, input.team, { required: true })! : snap.teams.find(t => t.id === source.teamId)!;
    const r = await bl.propose({ session, kind: 'followup', teamId: team.id, title: input.title, description: input.description, fromIssueId: source.id }, actorIdOf(actor));
    return {
      op_id: r.opId, attributed_to: r.attributedTo, draft_id: r.draft.id, from_issue: issueKey(source, snap.teams), team: team.key, title: r.draft.title,
      deduplicated: r.deduplicated, filed: false as const,
    };
  },
  text: (o, s) => lines(
    `${o.deduplicated ? 'Already noted' : 'Noted'} follow-up ${o.draft_id} from ${o.from_issue}: "${o.title}" (not filed). finish_issue lists it so you can ask the person once.`,
    receiptLine(o, s),
  ),
});

export const finishIssue = defineOp({
  name: 'finish_issue',
  title: 'Finish issue',
  description:
    'Close out your work on an issue. Your progress note becomes the final summary. ' +
    'outcome "in_review": a pull request or another review waits for a person; the issue moves to In Review when the team has that state. ' +
    'outcome "done": the work is complete and needs no review; the issue moves to Done. ' +
    'outcome "stopped": you stop before the work is complete; the state does not change, and left must say what remains. ' +
    'It returns the follow-ups you noted on the issue: ask the person once whether to file them, and call create_issue with the draft_id of each one they approve. ' +
    'Calling again with the same outcome and summary changes nothing.',
  input: z.object({
    issue: IssueKey,
    outcome: z.enum(['in_review', 'done', 'stopped']).describe('in_review, done or stopped.'),
    summary: z.string().trim().min(1).describe('What changed and how you verified it. For code: branch, PR link, files changed, tests run.'),
    left: z.string().optional().describe('What remains. Required when outcome is "stopped".'),
    links: Links.optional(),
    pr_url: z.url().optional().describe('The pull request for this work.'),
  }).refine(i => i.outcome !== 'stopped' || !!i.left?.trim(), { message: 'outcome "stopped" needs left: what remains to be done', path: ['left'] }),
  output: Receipt.extend({
    key: z.string(), state: z.string(), url: z.string(), warnings: z.array(z.string()),
    pending_followups: z.array(z.object({ draft_id: z.string(), title: z.string() })).describe('Follow-ups you noted on this issue that nobody filed yet.'),
  }),
  effect: { kind: 'write', converges: 'A finished thread with the same outcome and summary writes nothing; the state never moves back out of Done or Canceled.' },
  positional: ['issue'],
  async run({ bl, actor, session }, input) {
    const i = await issueByKey(bl, input.issue);
    const links = [...(input.links ?? []), ...(input.pr_url ? [input.pr_url] : [])];
    const r = await bl.finishWork(i.id, { session, outcome: input.outcome, summary: input.summary, left: input.left, links }, actorIdOf(actor));
    const [snap, notes] = await Promise.all([bl.snapshot(['teams', 'states']), bl.drafts({ status: 'pending', kind: 'followup', fromIssueId: i.id })]);
    return {
      op_id: r.opId, attributed_to: r.attributedTo, key: issueKey(r.issue, snap.teams), state: stateName(snap, r.issue.stateId), url: r.url, warnings: r.warnings,
      pending_followups: notes.reverse().map(d => ({ draft_id: d.id, title: d.title })),
    };
  },
  text: (o, s) => lines(
    `${o.op_id ? 'Finished' : 'Already finished:'} ${o.key} (${o.state}).`, ...o.warnings.map(w => `warning: ${w}`), receiptLine(o, s),
    o.pending_followups.length > 0 && `\nYou noted ${o.pending_followups.length} follow-up(s). Ask the person once: "I also noticed: ${o.pending_followups.map((f, n) => `${n + 1}. ${f.title}`).join('; ')}. File them?" ` +
      `For each one they approve, call create_issue with its draft_id (${o.pending_followups.map(f => f.draft_id).join(', ')}).`,
  ),
});

// ---------------------------------------------------------------- project status

export const draftProjectUpdate = defineOp({
  name: 'draft_project_update',
  title: 'Draft project update',
  description:
    'Draft a status update for a project. Baseline collects what changed since the last published update (issues completed, in review, in progress, blocked, new) ' +
    'and returns those facts with the draft. Pass body to use your own words, and health if you can judge it. ' +
    'The draft is not published: only the person you work for sees it, and they publish, edit or discard it in Baseline. ' +
    'Tell them it is ready. Calling again replaces the draft.',
  input: z.object({
    project: z.string().trim().min(1).describe('Project name.'),
    body: z.string().optional().describe('The update in markdown. Omit it to get a draft written from the facts.'),
    health: Health.optional().describe('onTrack, atRisk or offTrack.'),
  }),
  output: Receipt.extend({
    project: z.string(), draft_url: z.string(), body: z.string(), health: Health.nullable(),
    facts: z.object({
      since: z.string().nullable(), completed: z.array(z.string()), in_review: z.array(z.string()), in_progress: z.array(z.string()),
      blocked: z.array(z.string()), filed: z.array(z.string()), titles: z.record(z.string(), z.string()).describe('Issue key → title.'),
    }).describe('Issue keys by what happened since the last published update.'),
    published: z.literal(false),
  }),
  effect: { kind: 'write', converges: 'One draft per (project, person); a repeat with the same text writes nothing.' },
  positional: ['project'],
  async run({ bl, actor }, input) {
    const snap = await bl.snapshot(['projects']);
    const p = resolve.resolveProject(snap, input.project)!;
    const r = await bl.draftProjectUpdate(p.id, { body: input.body, health: input.health }, actorIdOf(actor));
    const f = r.facts;
    const named = new Set([...f.completed, ...f.inReview, ...f.inProgress, ...f.blocked, ...f.filed]);
    return {
      op_id: r.opId, attributed_to: r.attributedTo, project: r.project.name, draft_url: r.url, body: r.draft.body, health: r.draft.health,
      facts: {
        since: f.since, completed: f.completed, in_review: f.inReview, in_progress: f.inProgress, blocked: f.blocked, filed: f.filed,
        titles: Object.fromEntries(Object.entries(f.titles ?? {}).filter(([k]) => named.has(k))),
      },
      published: false as const,
    };
  },
  text: (o, s) => lines(`Draft update for ${o.project} (not published; the person publishes it in Baseline):`, '', o.body, '', o.health ? `health: ${o.health}` : null, receiptLine(o, s)),
});

// ---------------------------------------------------------------- correction

export const undo = defineOp({
  name: 'undo',
  title: 'Undo a change',
  description:
    'Reverse one change that you made in Baseline, by the op_id that the change returned. It reverts the state, the assignee, a created issue or sub-issues, a draft, attached links and the progress note of that change. ' +
    'If a person changed the same issue field since, nothing is undone and the error says what changed. ' +
    'Use this only when the person asks you to undo, or when you made a change in error. Calling again changes nothing.',
  input: z.object({ op_id: z.string().trim().regex(/^op_/, 'expected an op_id from a write, such as op_7fK2…').describe('The op_id that a write returned.') }),
  output: z.object({
    op_id: z.string().nullable().describe('This undo\'s own id; null when the change was already undone.'),
    undid: z.object({ op_id: z.string(), name: z.string() }),
    reverted: z.array(z.string()), left_as_is: z.array(z.string()), already_undone: z.boolean(),
  }),
  effect: { kind: 'revert', converges: 'An undone op is marked; a second call finds the mark and writes nothing.' },
  positional: ['op_id'],
  async run({ bl, actor }, input) {
    const r = await bl.undoOp(input.op_id, actorIdOf(actor));
    return { op_id: r.opId, undid: { op_id: r.undid.opId, name: r.undid.name }, reverted: r.reverted, left_as_is: r.leftAsIs, already_undone: r.alreadyUndone };
  },
  text: (o) => o.already_undone ? `${o.undid.name} ${o.undid.op_id} was already undone.`
    : lines(`Undid ${o.undid.name} ${o.undid.op_id}:`, ...o.reverted.map(x => `  reverted: ${x}`), ...o.left_as_is.map(x => `  left as is: ${x}`)),
});

/** Order = order in tools/list, in `baseline agent --help` and in the skill: picking work, reads, creating, the loop in call order, project, undo. */
export const OPERATIONS = [
  nextIssue, findIssues, getIssue, listIssues, myActivity,
  proposeIssue, createIssue,
  startIssue, createSubIssues, postProgress, proposeFollowup, finishIssue,
  draftProjectUpdate, undo,
] as const satisfies readonly AnyOperation[];

export type { OpContext };
