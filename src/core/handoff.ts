// Hand-off prompt rendering: turns an issue into a ready-to-paste prompt + branch name.
// Pure functions with no db access; Store.handoffFor assembles the inputs.

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

/** Filler words that carry no meaning in a branch name, dropped before the length cap
 *  so the words that identify the work survive ("fix", "add", nouns) rather than "the-issue-with". */
const BRANCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'into', 'on', 'onto', 'at',
  'by', 'from', 'with', 'without', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our', 'you', 'your', 'they', 'their',
  'so', 'than', 'then', 'when', 'while', 'not', 'no', 'all', 'any', 'via',
]);

/** Words kept in a branch slug, and the slug's hard character cap. */
const BRANCH_MAX_WORDS = 4;
const BRANCH_MAX_CHARS = 28;

/** Lowercase, hyphenated slug that stops on a word boundary, never mid-word.
 *  Titles are often a whole sentence, so this keeps the first few meaningful words
 *  instead of truncating the sentence into an unreadable stub. */
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
  // a single word longer than the cap is the only case we cut mid-word
  if (kept.length === 1 && kept[0]!.length > maxChars) return kept[0]!.slice(0, maxChars).replace(/-+$/g, '');
  return kept.join('-');
}

/** e.g. ENG-42 "Fix the flaky login redirect on Safari" → `eng-42-fix-flaky-login-redirect` */
export function branchName(key: string, title: string, format?: string, username?: string): string {
  const slug = slugify(title);
  const plain = slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
  if (!format) return plain;
  // the workspace format (Settings › Integrations › GitHub), Linear's variables
  const user = (username ?? '').toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9-]/g, '') ?? '';
  const out = format.replace(/\{issueIdentifier\}/g, key.toLowerCase()).replace(/\{issueTitle\}/g, slug).replace(/\{username\}/g, user)
    .replace(/\/+/g, '/').replace(/-+/g, '-').replace(/^[/-]+|[/-]+$/g, '').replace(/\/-|-\//g, '/');
  return out || plain;
}

export function renderHandoff(template: string, vars: Record<string, string>): string {
  // an empty variable (often the description) shouldn't leave a hole in the prompt
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export interface HandoffContext {
  teams: Team[];
  states: WorkflowState[];
  projects: Project[];
  labels: Label[];
  baseUrl?: string;
  /** workspace branch format and the person it's for */
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
    // mention tokens read back as "@Name" because the agent needs the person, not their id
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

/** where the web app is, for links: the server's public URL when it has one, else this machine's */
export function appBaseUrl(baseUrl?: string): string {
  // core also runs in the browser (Settings ▸ Handoff preview), where `process` doesn't exist
  const env = typeof process !== 'undefined' ? process.env : {};
  // a local CLI can't also name BASELINE_URL (that would mean a server), so its port says where the app is
  const envUrl = env.BASELINE_URL ?? (env.BASELINE_PORT ? `http://localhost:${env.BASELINE_PORT}` : undefined);
  return (baseUrl ?? envUrl ?? windowOrigin() ?? 'http://localhost:7770').replace(/\/+$/, '');
}

/** in the browser, prompt links point at the instance actually being used */
function windowOrigin(): string | undefined {
  // core is compiled without DOM types, so reach `location` through globalThis
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin?.startsWith('http') ? origin : undefined;
}
