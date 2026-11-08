// The one list of agent operations. The `baseline agent` commands, the skill's "Agent loop"
// block and the parity check are generated from OPERATIONS; the MCP server registers it.
// Adding a tool means adding an entry here; there is no other place to add one.
import { z } from 'zod';
import { issueIndex, ResolveError, resolve, views, type Baseline } from '../client/index.js';
import { issueKey, PRIORITY_SHORT, type Snapshot } from '../core/types.js';
import type { WorkThread } from '../core/work-types.js';
import { actorIdOf } from './identity.js';
import { defineOp, OpError, type AnyOperation, type OpContext } from './operation.js';

const IssueKey = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/, 'expected an issue key such as ENG-42').describe('Issue key, for example ENG-42.');
const Links = z.array(z.url()).max(10).describe('PR, commit, preview or document URLs. Each is attached to the issue once.');
const Health = z.enum(['onTrack', 'atRisk', 'offTrack']);

/** every write's output starts with these two */
const Receipt = z.object({
  op_id: z.string().nullable().describe('Pass to undo to reverse this change. null when this call changed nothing.'),
  attributed_to: z.string().describe('How the change shows in Baseline, for example "Agent via Parth Batra".'),
});

async function issueByKey(bl: Baseline, key: string) {
  const i = await bl.getByKey(key);
  if (!i || i.deletedAt) throw new OpError('not-found', `No issue ${key.toUpperCase()}. Find keys with list_issues.`);
  return i;
}

const names = (snap: Pick<Snapshot, 'users'>) => (id: string | null) => views.nameOf(snap, id);
const stateName = (snap: Pick<Snapshot, 'states'>, stateId: string) => snap.states.find(s => s.id === stateId)?.name ?? '?';
const lines = (...xs: Array<string | false | null | undefined>) => xs.filter((x): x is string => !!x).join('\n');
const receiptLine = (o: { op_id: string | null; attributed_to: string }) => o.op_id ? `(${o.attributed_to}; undo with: baseline agent undo ${o.op_id})` : '(nothing changed)';

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

// ---------------------------------------------------------------- reads

const KEEP = 30;

export const getIssue = defineOp({
  name: 'get_issue',
  title: 'Get issue',
  description:
    'Get one Baseline issue by key: description, state, assignee, comments, sub-issues, blockers, links, and the progress that agents posted. ' +
    'Call this before you work on an issue that you did not start in this conversation.',
  input: z.object({ issue: IssueKey }),
  output: z.object({
    issue: z.looseObject({ key: z.string(), title: z.string(), state: z.string().nullable(), description: z.string() }).describe('The issue as `baseline issue show --json` prints it, with the newest 30 comments and activity rows.'),
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
      agent_work: threads.map(t => agentWork(snap, t)),
      truncated: { comments: Math.max(0, detail.comments.length - KEEP), activity: Math.max(0, detail.activity.length - KEEP) },
    };
  },
  text({ issue, agent_work }) {
    const i = issue as typeof issue & { assignee?: string | null; priority?: string; comments?: Array<{ author: string | null; via: string | null; body: string }> };
    return lines(
      `${i.key}  ${i.title}`,
      `state: ${i.state ?? '?'}  assignee: ${i.assignee ?? '—'}  priority: ${i.priority ?? '—'}`,
      i.description && `\n${i.description}`,
      agent_work.length > 0 && `\nagent work:\n${agent_work.map(w => `  ${w.agent}${w.via ? ` via ${w.via}` : ''} · ${w.status}${w.outcome ? ` (${w.outcome})` : ''} · branch ${w.branch}${w.did ? `\n    did: ${w.did}` : ''}${w.left ? `\n    left: ${w.left}` : ''}${w.blocked ? `\n    blocked: ${w.blocked}` : ''}`).join('\n')}`,
      (i.comments ?? []).length > 0 && `\ncomments:\n${(i.comments ?? []).map(c => `— ${c.author ?? '?'}${c.via ? ` via ${c.via}` : ''}: ${c.body}`).join('\n')}`,
    );
  },
});

export const listIssues = defineOp({
  name: 'list_issues',
  title: 'List issues',
  description:
    'List Baseline issues, most recently updated first. With no filters it lists the open issues assigned to you (the person the agent works for). ' +
    'Use query to search titles and descriptions. Use assignee "any" to list everyone\'s issues. ' +
    'Names match without case; an unknown name returns the valid names.',
  input: z.object({
    query: z.string().optional().describe('Text to find in the title or description.'),
    assignee: z.string().optional().describe('"me" (default), "any", "none", or a person\'s name.'),
    state: z.string().optional().describe('A state name such as "In Progress", "open" (default: not done or canceled), or "all".'),
    team: z.string().optional().describe('Team key, for example ENG.'),
    project: z.string().optional().describe('Project name.'),
    limit: z.number().int().min(1).max(100).optional().describe('At most this many issues. Default 25.'),
  }),
  output: z.object({
    issues: z.array(z.object({ key: z.string(), title: z.string(), state: z.string(), assignee: z.string().nullable(), priority: z.string(), project: z.string().nullable(), updated_at: z.string() })),
    total: z.number(), shown: z.number(),
  }),
  effect: { kind: 'read' },
  async run({ bl }, input) {
    const snap = await bl.snapshot(['teams', 'states', 'users', 'currentUser', 'projects']);
    const team = resolve.resolveTeam(snap, input.team, { required: true });
    const project = input.project ? resolve.resolveProject(snap, input.project) : undefined;
    const who = (input.assignee ?? 'me').trim().toLowerCase();
    const assigneeId = who === 'any' || who === 'none' ? undefined : resolve.resolveUser(snap, input.assignee ?? 'me')?.id;
    const want = (input.state ?? 'open').trim().toLowerCase();
    const states = snap.states.filter(s => !team || s.teamId === team.id);
    const stateIds = want === 'all' ? null
      : want === 'open' ? new Set(states.filter(s => s.type !== 'completed' && s.type !== 'canceled').map(s => s.id))
      : new Set(states.filter(s => s.name.toLowerCase() === want).map(s => s.id));
    if (stateIds && !stateIds.size) throw new ResolveError(`Unknown state "${input.state}" — valid states: open, all, ${[...new Set(states.map(s => s.name))].join(', ')}`);
    const found = (await bl.listIssues({ teamId: team?.id, projectId: project?.id, assigneeId, query: input.query?.trim() || undefined }))
      .filter(i => (!stateIds || stateIds.has(i.stateId)) && (who !== 'none' || !i.assigneeId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const shown = found.slice(0, input.limit ?? 25);
    const name = names(snap);
    return {
      issues: shown.map(i => ({
        key: issueKey(i, snap.teams), title: i.title, state: stateName(snap, i.stateId), assignee: name(i.assigneeId), priority: PRIORITY_SHORT[i.priority],
        project: snap.projects.find(p => p.id === i.projectId)?.name ?? null, updated_at: i.updatedAt,
      })),
      total: found.length, shown: shown.length,
    };
  },
  text: ({ issues, total, shown }) => lines(
    ...issues.map(i => `${i.key.padEnd(9)} [${i.state}] ${i.priority.padEnd(7)} ${i.title}  (${i.assignee ?? '—'})`),
    `${shown} of ${total} issue(s)`,
  ),
});

// ---------------------------------------------------------------- the work loop

export const startIssue = defineOp({
  name: 'start_issue',
  title: 'Start issue',
  description:
    'Tell Baseline that you start work on an issue now. If the issue is not started (Triage, Backlog or Todo), it moves to the team\'s first started state, usually In Progress. ' +
    'If nobody is assigned, it is assigned to the person you work for. Returns the work brief and the git branch name to use. ' +
    'If you already started this issue, nothing changes: you get the same brief and your last progress, so you can continue. ' +
    'Call this once, before you change code for the issue.',
  input: z.object({ issue: IssueKey }),
  output: Receipt.extend({
    key: z.string(), title: z.string(), state: z.string(), assignee: z.string().nullable(), url: z.string(),
    branch: z.string().describe('Create or check out this branch. A pull request from it links to the issue.'),
    brief: z.string().describe('The issue as a work prompt: description, context and the team\'s guidance.'),
    already_started: z.boolean().describe('true when this call changed nothing because you had started already.'),
    last_progress: z.object({ did: z.string().nullable(), left: z.string().nullable(), blocked: z.string().nullable(), updated_at: z.string() }).nullable(),
    warnings: z.array(z.string()).describe('For example: assigned to another person; the issue is done.'),
  }),
  effect: { kind: 'write', converges: 'Moves only a not-started issue and assigns only an unassigned one, so a repeat finds nothing to do and writes nothing.' },
  positional: ['issue'],
  async run({ bl, actor, session }, input) {
    const i = await issueByKey(bl, input.issue);
    const r = await bl.startWork(i.id, { session }, actorIdOf(actor));
    const snap = await bl.snapshot(['teams', 'states', 'users']);
    const p = r.thread.progress;
    return {
      op_id: r.opId, attributed_to: r.attributedTo, key: issueKey(r.issue, snap.teams), title: r.issue.title, state: stateName(snap, r.issue.stateId),
      assignee: names(snap)(r.issue.assigneeId), url: r.url, branch: r.branch, brief: r.brief, already_started: r.opId === null,
      last_progress: p.did || p.left || p.blocked ? { ...p, updated_at: r.thread.updatedAt } : null, warnings: r.warnings,
    };
  },
  text: (o) => lines(
    `${o.already_started ? `${o.key} was already started` : `Started ${o.key}`}: ${o.state}, assignee ${o.assignee ?? 'nobody'}.`,
    `Branch: ${o.branch}`,
    ...o.warnings.map(w => `warning: ${w}`),
    o.last_progress && `Last progress: ${o.last_progress.did ?? '—'}${o.last_progress.left ? ` | left: ${o.last_progress.left}` : ''}`,
    receiptLine(o), '', o.brief,
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
  text: (o) => lines(`${o.op_id ? (o.created ? 'Posted' : 'Updated') : 'Unchanged:'} the progress note on ${o.key}${o.links_added ? `, ${o.links_added} link(s) attached` : ''}.`, receiptLine(o)),
});

export const fileFollowup = defineOp({
  name: 'file_followup',
  title: 'File follow-up',
  description:
    'File new work that you found while you work on an issue, but that is not part of it. The new issue goes to the team\'s Triage queue, ' +
    'where a person accepts or declines it, and it is linked to the issue you came from. Do not use this for steps of your current task; ' +
    'put those in post_progress. Filing the same title from the same issue again returns the first follow-up.',
  input: z.object({
    from_issue: IssueKey.describe('The issue you were working on when you found this.'),
    title: z.string().trim().min(3).max(200).describe('What the new work is, as an issue title.'),
    description: z.string().optional().describe('Why it matters and the evidence: file paths with line numbers, log lines, links.'),
    team: z.string().optional().describe('Team key. Default: the team of from_issue.'),
  }),
  output: Receipt.extend({ key: z.string(), url: z.string(), state: z.string(), from_issue: z.string(), deduplicated: z.boolean() }),
  effect: { kind: 'write', converges: 'Deduplicated on (source issue, agent, person, session, normalized title) while the follow-up exists.' },
  positional: ['from_issue', 'title'],
  async run({ bl, actor, session }, input) {
    const source = await issueByKey(bl, input.from_issue);
    const snap = await bl.snapshot(['teams', 'states']);
    const team = resolve.resolveTeam(snap, input.team, { required: true });
    const r = await bl.fileFollowup(source.id, { session, title: input.title, description: input.description, teamId: team?.id }, actorIdOf(actor));
    return {
      op_id: r.opId, attributed_to: r.attributedTo, key: issueKey(r.issue, snap.teams), url: r.url, state: stateName(snap, r.issue.stateId),
      from_issue: issueKey(r.source, snap.teams), deduplicated: r.deduplicated,
    };
  },
  text: (o) => lines(`${o.deduplicated ? 'Already filed' : 'Filed'} ${o.key} (${o.state}), related to ${o.from_issue}. A person accepts or declines it.`, receiptLine(o)),
});

export const finishIssue = defineOp({
  name: 'finish_issue',
  title: 'Finish issue',
  description:
    'Close out your work on an issue. Your progress note becomes the final summary. ' +
    'outcome "in_review": a pull request or another review waits for a person; the issue moves to In Review when the team has that state. ' +
    'outcome "done": the work is complete and needs no review; the issue moves to Done. ' +
    'outcome "stopped": you stop before the work is complete; the state does not change, and left must say what remains. ' +
    'Calling again with the same outcome and summary changes nothing.',
  input: z.object({
    issue: IssueKey,
    outcome: z.enum(['in_review', 'done', 'stopped']).describe('in_review, done or stopped.'),
    summary: z.string().trim().min(1).describe('What changed and how you verified it. For code: branch, PR link, files changed, tests run.'),
    left: z.string().optional().describe('What remains. Required when outcome is "stopped".'),
    links: Links.optional(),
    pr_url: z.url().optional().describe('The pull request for this work.'),
  }).refine(i => i.outcome !== 'stopped' || !!i.left?.trim(), { message: 'outcome "stopped" needs left: what remains to be done', path: ['left'] }),
  output: Receipt.extend({ key: z.string(), state: z.string(), url: z.string(), warnings: z.array(z.string()) }),
  effect: { kind: 'write', converges: 'A finished thread with the same outcome and summary writes nothing; the state never moves back out of Done or Canceled.' },
  positional: ['issue'],
  async run({ bl, actor, session }, input) {
    const i = await issueByKey(bl, input.issue);
    const links = [...(input.links ?? []), ...(input.pr_url ? [input.pr_url] : [])];
    const r = await bl.finishWork(i.id, { session, outcome: input.outcome, summary: input.summary, left: input.left, links }, actorIdOf(actor));
    const snap = await bl.snapshot(['teams', 'states']);
    return { op_id: r.opId, attributed_to: r.attributedTo, key: issueKey(r.issue, snap.teams), state: stateName(snap, r.issue.stateId), url: r.url, warnings: r.warnings };
  },
  text: (o) => lines(`${o.op_id ? 'Finished' : 'Already finished:'} ${o.key} (${o.state}).`, ...o.warnings.map(w => `warning: ${w}`), receiptLine(o)),
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
      blocked: z.array(z.string()), filed: z.array(z.string()),
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
    return {
      op_id: r.opId, attributed_to: r.attributedTo, project: r.project.name, draft_url: r.url, body: r.draft.body, health: r.draft.health,
      facts: { since: f.since, completed: f.completed, in_review: f.inReview, in_progress: f.inProgress, blocked: f.blocked, filed: f.filed },
      published: false as const,
    };
  },
  text: (o) => lines(`Draft update for ${o.project} (not published; the person publishes it in Baseline):`, '', o.body, '', o.health ? `health: ${o.health}` : null, receiptLine(o)),
});

// ---------------------------------------------------------------- correction

export const undo = defineOp({
  name: 'undo',
  title: 'Undo a change',
  description:
    'Reverse one change that you made in Baseline, by the op_id that the change returned. It reverts the state, the assignee, a filed follow-up, attached links and the progress note of that change. ' +
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

/** Order = order in tools/list, in `baseline agent --help` and in the skill: reads, the loop in call order, project, undo. */
export const OPERATIONS = [
  getIssue, listIssues, startIssue, postProgress, fileFollowup, finishIssue, draftProjectUpdate, undo,
] as const satisfies readonly AnyOperation[];

export type { OpContext };
