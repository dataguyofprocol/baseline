// Hand-off prompt rendering: turns an issue into a ready-to-paste prompt + branch name.
// Pure functions — no db access; Store.handoffFor assembles the inputs.

import { issueKey, PRIORITY_SHORT } from './types.js';
import type { Handoff, Issue, Label, Priority, Project, Team, WorkflowState } from './types.js';

export const DEFAULT_PROMPT_TEMPLATE = `Implement Baseline issue {{key}}: {{title}}

{{description}}

Branch: {{branch}} (create from main).

When you finish: post a short progress comment on issue {{key}} via the baseline CLI and set its state to Done. If you only partially complete it, comment what remains and leave the state unchanged.`;

export const PROMPT_TEMPLATE_VARS = [
  ['{{key}}', 'issue key, e.g. CORE-14'],
  ['{{title}}', 'issue title'],
  ['{{description}}', 'issue description (markdown)'],
  ['{{branch}}', 'suggested git branch name'],
  ['{{url}}', 'deep link to the issue in the web app'],
  ['{{team}}', 'team name'],
  ['{{project}}', 'project name (empty if none)'],
  ['{{state}}', 'current workflow state name'],
  ['{{priority}}', 'priority label'],
  ['{{estimate}}', 'estimate points (empty if unset)'],
  ['{{dueDate}}', 'due date YYYY-MM-DD (empty if unset)'],
  ['{{labels}}', 'comma-separated label names'],
] as const;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function branchName(key: string, title: string): string {
  const slug = slugify(title);
  return slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
}

export function renderHandoff(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? '');
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
  const base = (ctx.baseUrl ?? process.env.BASELINE_URL ?? 'http://localhost:7770').replace(/\/+$/, '');
  const vars: Record<string, string> = {
    key,
    title: issue.title,
    description: issue.description,
    branch,
    url: `${base}/#/issue/${key}`,
    team: team?.name ?? '',
    project: project?.name ?? '',
    state: state?.name ?? '',
    priority: PRIORITY_SHORT[issue.priority as Priority] ?? '',
    estimate: issue.estimate != null ? String(issue.estimate) : '',
    dueDate: issue.dueDate ? issue.dueDate.slice(0, 10) : '',
    labels: labelNames.join(', '),
  };
  return { key, title: issue.title, branchName: branch, url: vars.url, prompt: renderHandoff(template, vars) };
}
