// Hand-off prompt rendering: turns an issue into a ready-to-paste prompt + branch name.
// Pure functions — no db access; Store.handoffFor assembles the inputs.

import { issueKey, PRIORITY_SHORT } from './types.js';
import type { Handoff, Issue, Label, Priority, Project, Team, WorkflowState } from './types.js';
import { plainMentions } from './mentions.js';

export const DEFAULT_PROMPT_TEMPLATE = `Work on Baseline issue {{key}}: {{title}}

{{description}}

Issue: {{url}}
Branch: {{branch}} (if this changes code, create it from the repo's default branch).

Track the work on {{key}} with the baseline CLI (or the /baseline skill, if you have it):
- Start: set the state to In Progress (\`issue update {{key}} -s "In Progress"\`) and read the full context with \`issue show {{key}} --json\` (comments, sub-issues, blockers).
- Finish: post one comment on {{key}} (\`issue comment {{key}} "…"\`), then set the state to Done. If you only partly finish, say what remains and leave the state as it is.
- If the work splits into separate pieces, create sub-issues (\`issue create "…" -t {{teamKey}} --parent {{key}}\`) rather than writing one long comment.

What the comment should contain depends on the kind of work:
- Code: the branch, the commit or PR link, the files you changed, and how you verified the change (tests or commands you ran).
- Docs or write-ups: the absolute path of each file you created (or the artifact link), plus a 2–3 line summary.
- Bug or investigation: the root cause, the evidence (file:line, log lines), and the fix or the next step.
- Research or a decision: the recommendation, the options you weighed, and links to sources.
Refer to local files by absolute path, put paths, branch names and commands in backticks, and keep it short. The comment is what the human reads.`;

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
] as const;

/** Filler words that carry no meaning in a branch name — dropped before the length cap
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

/** Lowercase, hyphenated slug that stops on a word boundary — never mid-word.
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
export function branchName(key: string, title: string): string {
  const slug = slugify(title);
  return slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
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
  const branch = branchName(key, issue.title);
  // core also runs in the browser (Settings ▸ Handoff preview), where `process` doesn't exist
  const envUrl = typeof process !== 'undefined' ? process.env.BASELINE_URL : undefined;
  const base = (ctx.baseUrl ?? envUrl ?? windowOrigin() ?? 'http://localhost:7770').replace(/\/+$/, '');
  const vars: Record<string, string> = {
    key,
    title: issue.title,
    // mention tokens read back as "@Name" — the agent needs the person, not their id
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
  };
  return { key, title: issue.title, branchName: branch, url: vars.url, prompt: renderHandoff(template, vars) };
}

/** in the browser, prompt links point at the instance actually being used */
function windowOrigin(): string | undefined {
  // core is compiled without DOM types, so reach `location` through globalThis
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin?.startsWith('http') ? origin : undefined;
}
