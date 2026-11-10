
import { issueKey, PRIORITY_SHORT } from './types.js';
import type { Handoff, Issue, Label, Priority, Project, Team, WorkflowState } from './types.js';
import { plainMentions } from './mentions.js';
import { HANDOFF_TRACKING } from './tracking.js';

export const DEFAULT_PROMPT_TEMPLATE = `Work on Baseline issue {{key}}: {{title}}

{{description}}

Issue: {{url}}
Branch: {{branch}} (if this changes code, create it from the repo's default branch).

{{tracking}}
If you only partly finish, finish with outcome stopped and say what remains in left.

What the summary should contain depends on the kind of work:
- Code: the branch, the commit or PR link, the files you changed, and how you verified the change (tests or commands you ran).
- Docs or write-ups: the absolute path of each file you created (or the artifact link), plus a 2–3 line summary.
- Bug or investigation: the root cause, the evidence (file:line, log lines), and the fix or the next step.
- Research or a decision: the recommendation, the options you weighed, and links to sources.
Refer to local files by absolute path, put paths, branch names and commands in backticks, and keep it short. The summary is what the person reads.`;

export const PROMPT_TEMPLATE_VARS = [
  ['{{key}}', 'issue key, e.g. CORE-14'],
  ['{{title}}', 'issue title'],
  ['{{description}}', 'issue description (markdown)'],
  ['{{branch}}', 'suggested git branch name'],
  ['{{url}}', 'deep link to the issue in the web app'],
  ['{{team}}', 'team name'],
  ['{{teamKey}}', 'team key, e.g. CORE'],
  ['{{project}}', 'project name (empty if none)'],
  ['{{state}}', 'current workflow state name'],
  ['{{priority}}', 'priority label'],
  ['{{estimate}}', 'estimate points (empty if unset)'],
  ['{{dueDate}}', 'due date YYYY-MM-DD (empty if unset)'],
  ['{{labels}}', 'comma-separated label names'],
  ['{{tracking}}', 'how the agent keeps the issue current: its MCP tools and `baseline agent` commands'],
] as const;

const BRANCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'into', 'on', 'onto', 'at',
  'by', 'from', 'with', 'without', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our', 'you', 'your', 'they', 'their',
  'so', 'than', 'then', 'when', 'while', 'not', 'no', 'all', 'any', 'via',
]);

const BRANCH_MAX_WORDS = 4;
const BRANCH_MAX_CHARS = 28;

export function slugify(text: string, maxChars = BRANCH_MAX_CHARS, maxWords = BRANCH_MAX_WORDS): string {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return '';
  const meaningful = words.filter(w => !BRANCH_STOPWORDS.has(w));
  const candidates = meaningful.length > 0 ? meaningful : words;

  const kept: string[] = [];
  let len = 0;
  for (const w of candidates) {
    if (kept.length >= maxWords) break;
    const cost = kept.length === 0 ? w.length : w.length + 1;
    if (kept.length > 0 && len + cost > maxChars) break;
    kept.push(w);
    len += cost;
  }
  if (kept.length === 1 && kept[0]!.length > maxChars) return kept[0]!.slice(0, maxChars).replace(/-+$/g, '');
  return kept.join('-');
}

export function branchName(key: string, title: string, format?: string, username?: string): string {
  const slug = slugify(title);
  const plain = slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
  if (!format) return plain;
  const user = (username ?? '').toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9-]/g, '') ?? '';
  const out = format.replace(/\{issueIdentifier\}/g, key.toLowerCase()).replace(/\{issueTitle\}/g, slug).replace(/\{username\}/g, user)
    .replace(/\/+/g, '/').replace(/-+/g, '-').replace(/^[/-]+|[/-]+$/g, '').replace(/\/-|-\//g, '/');
  return out || plain;
}

export function renderHandoff(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export interface HandoffContext {
  teams: Team[];
  states: WorkflowState[];
  projects: Project[];
  labels: Label[];
  baseUrl?: string;
  branchFormat?: string;
  username?: string;
}

export function buildHandoff(
  issue: Issue,
  ctx: HandoffContext,
  template: string = DEFAULT_PROMPT_TEMPLATE,
): Handoff {
  const key = issueKey(issue, ctx.teams);
  const team = ctx.teams.find(t => t.id === issue.teamId);
  const state = ctx.states.find(s => s.id === issue.stateId);
  const project = ctx.projects.find(p => p.id === issue.projectId);
  const labelNames = issue.labelIds
    .map(lid => ctx.labels.find(l => l.id === lid)?.name)
    .filter((n): n is string => !!n);
  const branch = branchName(key, issue.title, ctx.branchFormat, ctx.username);
  const base = appBaseUrl(ctx.baseUrl);
  const vars: Record<string, string> = {
    key,
    title: issue.title,
    description: plainMentions(issue.description),
    branch,
    url: `${base}/#/issue/${key}`,
    team: team?.name ?? '',
    teamKey: team?.key ?? '',
    project: project?.name ?? '',
    state: state?.name ?? '',
    priority: PRIORITY_SHORT[issue.priority as Priority] ?? '',
    estimate: issue.estimate != null ? String(issue.estimate) : '',
    dueDate: issue.dueDate ? issue.dueDate.slice(0, 10) : '',
    labels: labelNames.join(', '),
    tracking: HANDOFF_TRACKING.split('{{key}}').join(key),
  };
  return { key, title: issue.title, branchName: branch, url: vars.url, prompt: renderHandoff(template, vars) };
}

export function appBaseUrl(baseUrl?: string): string {
  const env = typeof process !== 'undefined' ? process.env : {};
  const envUrl = env.BASELINE_URL ?? (env.BASELINE_PORT ? `http://localhost:${env.BASELINE_PORT}` : undefined);
  return (baseUrl ?? envUrl ?? windowOrigin() ?? 'http://localhost:7770').replace(/\/+$/, '');
}

function windowOrigin(): string | undefined {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin?.startsWith('http') ? origin : undefined;
}
