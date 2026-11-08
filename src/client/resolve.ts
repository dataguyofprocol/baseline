// Names to ids over a snapshot: the words a person or an agent types (team keys, state and user
// names, "me", "none", "current") and the error text when one doesn't match. Pure; shared by the
// CLI and the MCP server, so both accept the same words.
import type { Label, Location, Priority, Project, Snapshot, Team, User, WorkflowState } from '../core/types.js';
import { normalizeDir } from '../core/util.js';

export class ResolveError extends Error {}
const fail = (msg: string): never => { throw new ResolveError(msg); };

export function priorityNum(v?: string): Priority | undefined {
  if (v === undefined) return undefined;
  const named: Record<string, Priority> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };
  const p = named[v.toLowerCase()] ?? (/^[0-4]$/.test(v) ? (Number(v) as Priority) : undefined);
  if (p === undefined) fail(`Invalid priority "${v}" — use none|urgent|high|medium|low (or 0-4)`);
  return p;
}

export function resolveTeam(snap: Pick<Snapshot, 'teams'>, key: string | undefined, { required = false } = {}): Team | undefined {
  if (!key) return undefined;
  const t = snap.teams.find(t => t.key.toLowerCase() === key.toLowerCase())
    ?? snap.teams.find(t => t.name.toLowerCase().includes(key.toLowerCase()));
  if (!t && required) fail(`Unknown team "${key}" — valid keys: ${snap.teams.map(t => t.key).join(', ')}`);
  return t;
}

export function resolveState(snap: Pick<Snapshot, 'states'>, teamId: string, name: string): WorkflowState {
  const st = snap.states.find(s => s.teamId === teamId && s.name.toLowerCase() === name.toLowerCase());
  if (!st) {
    const valid = snap.states.filter(s => s.teamId === teamId).map(s => s.name);
    return fail(`Unknown state "${name}" — valid states: ${valid.join(', ')}`);
  }
  return st;
}

/** "me": the snapshot's current user (a key's owner, remotely); "none": undefined */
export function resolveUser(snap: Pick<Snapshot, 'users' | 'currentUser'>, name: string): User | undefined {
  if (name.toLowerCase() === 'none') return undefined;
  if (name.toLowerCase() === 'me') return snap.currentUser;
  const u = snap.users.find(u => u.name.toLowerCase().includes(name.toLowerCase()));
  if (!u) fail(`Unknown assignee "${name}" — valid users: ${snap.users.map(u => u.name).join(', ')}`);
  return u;
}

export function resolveProject(snap: Pick<Snapshot, 'projects'>, name: string, { required = true } = {}): Project | undefined {
  if (name.toLowerCase() === 'none') return undefined;
  const p = snap.projects.find(p => p.name.toLowerCase() === name.toLowerCase())
    ?? snap.projects.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!p && required) fail(`Unknown project "${name}" — valid projects: ${snap.projects.map(p => p.name).join(', ')}`);
  return p;
}

export function resolveLabel(snap: Pick<Snapshot, 'labels'>, teamId: string, name: string): Label {
  const l = snap.labels.find(l => l.teamId === teamId && l.name.toLowerCase() === name.toLowerCase());
  if (!l) {
    const valid = snap.labels.filter(l => l.teamId === teamId).map(l => l.name);
    return fail(`Unknown label "${name}" — valid labels: ${valid.length ? valid.join(', ') : '(none for this team)'}`);
  }
  return l;
}

/** a cycle by number ("22"), name, "current", "next" or "none" */
export function resolveCycle(snap: Pick<Snapshot, 'cycles'>, teamId: string, ref: string): string | null {
  if (ref.toLowerCase() === 'none') return null;
  const now = new Date().toISOString();
  const cycles = snap.cycles.filter(c => c.teamId === teamId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const c = ref.toLowerCase() === 'current' ? cycles.find(x => x.startsAt <= now && x.endsAt >= now)
    : ref.toLowerCase() === 'next' ? cycles.find(x => x.startsAt > now)
    : cycles.find(x => String(x.number) === ref.replace(/^#/, '') || x.name.toLowerCase() === ref.toLowerCase());
  if (!c) return fail(`Unknown cycle "${ref}" — cycles: ${cycles.map(x => x.number).join(', ') || '(none)'}; or current|next|none`);
  return c.id;
}

export function milestoneIdFor(snap: Pick<Snapshot, 'milestones'>, projectId: string | null, ref: string): string | null {
  if (ref.toLowerCase() === 'none') return null;
  if (!projectId) fail('A milestone needs the issue to be in a project (--project)');
  const ms = snap.milestones.filter(m => m.projectId === projectId);
  const m = ms.find(x => x.name.toLowerCase() === ref.toLowerCase()) ?? ms.find(x => x.name.toLowerCase().includes(ref.toLowerCase()));
  if (!m) return fail(`Unknown milestone "${ref}" — milestones: ${ms.map(x => x.name).join(', ') || '(none)'}`);
  return m.id;
}

/** --as <user>, else BASELINE_AS (name or user id): whom a write is attributed to. Resolution only;
 *  whether the server honors it is the server's call. */
export function actorId(snap: Pick<Snapshot, 'users'>, flag: string | undefined, env: string | undefined): string | undefined {
  const name = flag ?? env;
  if (!name) return undefined;
  const u = snap.users.find(u => u.id === name)
    ?? snap.users.find(u => u.name.toLowerCase() === name.toLowerCase())
    ?? snap.users.find(u => u.name.toLowerCase().includes(name.toLowerCase()));
  if (!u) fail(`Unknown user "${name}" — valid users: ${snap.users.map(u => u.name).join(', ')}`);
  return u!.id;
}

/** a path-looking reference ("~/code/x", "./x", "/x") names a directory to register, not an existing location */
export const isPathRef = (ref: string) => /^[~/.]/.test(ref);

/** an existing location by id, exact name, or path */
export function resolveLocation(snap: Pick<Snapshot, 'locations'>, ref: string): Location {
  const path = normalizeDir(ref);
  const loc = snap.locations.find(l => l.id === ref) ?? snap.locations.find(l => l.name.toLowerCase() === ref.trim().toLowerCase()) ?? snap.locations.find(l => l.path === path);
  if (!loc) return fail(`Unknown location "${ref}" — known: ${snap.locations.map(l => l.name).join(', ') || '(none; add one with `location add <path>`)'}`);
  return loc;
}
