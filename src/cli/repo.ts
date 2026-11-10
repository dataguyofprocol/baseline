// The repo a local front door (the CLI, `baseline mcp`, the hooks) runs in: git, read and
// branch switching, and the committed .baseline.json that `baseline connect` writes. Only the
// front doors import this; ops get it as OpContext.local.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Checkout, LocalRepo } from '../ops/operation.js';

/** .baseline.json at the repo root: committed, so every teammate's agent maps the repo to one team */
export const REPO_CONFIG = '.baseline.json';
export interface RepoConfig {
  /** the team key this repo's work belongs to */
  team?: string;
  /** the UserPromptSubmit nudge ("no Baseline issue is active…"); default on */
  promptHook?: boolean;
}

export function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

export function repoRoot(cwd: string): string | null {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok ? r.out : null;
}

/** the checked-out branch; null when detached or not a repo */
export function currentBranch(cwd: string): string | null {
  const r = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return r.ok && r.out ? r.out : null;
}

export function readRepoConfig(root: string | null): RepoConfig {
  if (!root) return {};
  try {
    const c = JSON.parse(readFileSync(join(root, REPO_CONFIG), 'utf8')) as RepoConfig;
    return c && typeof c === 'object' ? c : {};
  } catch { return {}; }
}

const hasRef = (cwd: string, ref: string) => git(cwd, ['rev-parse', '--verify', '--quiet', ref]).ok;

/** where a new branch starts: the local default branch, else origin's, else nothing (HEAD) */
function defaultBase(cwd: string): { local: string | null; ref: string | null } {
  const head = git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const name = head.ok ? head.out.replace(/^origin\//, '') : ['main', 'master', 'trunk'].find(b => hasRef(cwd, `refs/heads/${b}`)) ?? null;
  if (!name) return { local: null, ref: null };
  if (hasRef(cwd, `refs/heads/${name}`)) return { local: name, ref: name };
  return hasRef(cwd, `refs/remotes/origin/${name}`) ? { local: name, ref: `origin/${name}` } : { local: null, ref: null };
}

/** Switch to the issue's branch when nothing can be lost: a clean tree (untracked files are fine), or
 *  uncommitted work on the default branch, which comes along to the new branch. Anything else is the
 *  person's call, so it returns the command instead of running it. */
export function checkoutBranch(cwd: string, branch: string): Checkout {
  const manual = (command: string, note: string): Checkout => ({ status: 'manual', branch, command, note });
  const root = repoRoot(cwd);
  if (!root) return manual(`git checkout -b ${branch}`, `${cwd} is not a git repository`);
  if (!git(root, ['check-ref-format', '--branch', branch]).ok) return manual(`git checkout -b <branch>`, `"${branch}" is not a valid branch name`);
  const cur = currentBranch(root);
  if (cur === branch) return { status: 'already_on', branch, command: `git checkout ${branch}` };
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']).out !== '';
  const run = (args: string[], status: Checkout['status'], note?: string): Checkout => {
    const command = `git ${args.join(' ')}`;
    const r = git(root, args);
    return r.ok ? { status, branch, command, ...(note ? { note } : {}) } : manual(command, r.err.split('\n')[0] || 'git refused');
  };
  if (hasRef(root, `refs/heads/${branch}`)) {
    return dirty ? manual(`git checkout ${branch}`, 'the working tree has uncommitted changes; commit or stash them first') : run(['checkout', branch], 'checked_out');
  }
  if (hasRef(root, `refs/remotes/origin/${branch}`)) {
    return dirty ? manual(`git checkout -b ${branch} --track origin/${branch}`, 'the working tree has uncommitted changes; commit or stash them first')
      : run(['checkout', '-b', branch, '--track', `origin/${branch}`], 'checked_out');
  }
  const base = defaultBase(root);
  if (dirty) {
    // uncommitted work started on the default branch belongs on the issue's branch
    if (cur && cur === base.local) return run(['checkout', '-b', branch], 'created', `from ${cur}, with your uncommitted changes`);
    return manual(`git checkout -b ${branch}${base.ref ? ` ${base.ref}` : ''}`, `you are on ${cur ?? 'a detached HEAD'} with uncommitted changes; commit or stash them first`);
  }
  if (!base.ref) return run(['checkout', '-b', branch], 'created', `from ${cur ?? 'HEAD'}`);
  return run(['checkout', '--no-track', '-b', branch, base.ref], 'created', `from ${base.ref}`);
}

export function localRepo(cwd = process.cwd()): LocalRepo {
  const root = repoRoot(cwd);
  return {
    team: readRepoConfig(root).team?.trim() || null,
    checkout: async (branch: string) => checkoutBranch(cwd, branch),
  };
}

/** issue keys a branch name carries ("parth/core-12-fix-login" → CORE-12), for the team keys given */
export function keysInBranch(branch: string, teamKeys: readonly string[]): string[] {
  const keys = new Set(teamKeys.map(k => k.toLowerCase()));
  const out: string[] = [];
  for (const m of branch.matchAll(/(?:^|[^a-z0-9])([a-z][a-z0-9]{0,9})-(\d+)(?=$|[^0-9])/gi)) {
    if (keys.has(m[1]!.toLowerCase())) out.push(`${m[1]!.toUpperCase()}-${m[2]}`);
  }
  return [...new Set(out)];
}
