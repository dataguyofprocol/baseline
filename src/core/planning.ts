import type { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.js';
import { getMeta } from './db.js';
import { id } from './util.js';
import type { DateResolution, Initiative, InitiativeUpdate, InitiativeStatus, ProjectHealth, Release, ReleaseStage } from './types.js';

const ts = () => new Date().toISOString();

type InitiativeRow = { id: string; name: string; description: string; summary: string; icon: string; color: string; status: InitiativeStatus; health: ProjectHealth | null; owner_id: string | null; target_date: string | null; target_resolution: DateResolution | null; parent_id: string | null; position: number; created_at: string; updated_at: string };
type ReleaseRow = { id: string; name: string; description: string; stage: ReleaseStage; team_id: string | null; target_date: string | null; released_at: string | null; created_at: string };

/* Initiatives (groups of projects with their own status, health and updates) and releases
   (which issues ship in a version). */
export class Planning {
  constructor(private store: Store, private db: DatabaseSync) {}

  private rows<T>(sql: string, ...args: Array<string | number | null>): T[] { return this.db.prepare(sql).all(...args) as unknown as T[]; }

  snapshot() {
    const links = this.rows<{ initiative_id: string; project_id: string }>('SELECT * FROM initiative_projects');
    const initiatives: Initiative[] = this.rows<InitiativeRow>('SELECT * FROM initiatives ORDER BY position, created_at').map(r => ({
      id: r.id, name: r.name, description: r.description, summary: r.summary ?? '', icon: r.icon, color: r.color, status: r.status, health: r.health,
      ownerId: r.owner_id, targetDate: r.target_date, targetResolution: r.target_resolution ?? null, parentId: r.parent_id, position: r.position, createdAt: r.created_at, updatedAt: r.updated_at,
      projectIds: links.filter(l => l.initiative_id === r.id).map(l => l.project_id),
    }));
    const initiativeUpdates: InitiativeUpdate[] = this.rows<{ id: string; initiative_id: string; user_id: string; body: string; health: ProjectHealth | null; created_at: string }>('SELECT * FROM initiative_updates ORDER BY created_at DESC')
      .map(u => ({ id: u.id, initiativeId: u.initiative_id, userId: u.user_id, body: u.body, health: u.health, createdAt: u.created_at }));
    const releases: Release[] = this.rows<ReleaseRow>('SELECT * FROM releases ORDER BY created_at').map(r => ({
      id: r.id, name: r.name, description: r.description, stage: r.stage, teamId: r.team_id, targetDate: r.target_date, releasedAt: r.released_at, createdAt: r.created_at,
    }));
    return { initiatives, initiativeUpdates, releases };
  }

  // ---------- initiatives ----------
  createInitiative(input: { name: string; description?: string; summary?: string; icon?: string; color?: string; status?: InitiativeStatus; ownerId?: string | null; targetDate?: string | null; targetResolution?: DateResolution | null; parentId?: string | null; projectIds?: string[] }): Initiative {
    const now = ts();
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 p FROM initiatives').get() as { p: number }).p;
    const ini: Initiative = {
      id: id('in'), name: input.name.trim(), description: input.description ?? '', summary: input.summary?.trim() ?? '', icon: input.icon ?? 'glyph:initiative', color: input.color ?? '#5e6ad2',
      status: input.status ?? 'planned', health: null, ownerId: input.ownerId ?? getMeta(this.db, 'currentUser'), targetDate: input.targetDate ?? null, targetResolution: input.targetDate ? input.targetResolution ?? null : null,
      parentId: input.parentId ?? null, projectIds: [], position: pos, createdAt: now, updatedAt: now,
    };
    this.db.prepare('INSERT INTO initiatives (id, name, description, summary, icon, color, status, health, owner_id, target_date, target_resolution, parent_id, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(ini.id, ini.name, ini.description, ini.summary, ini.icon, ini.color, ini.status, null, ini.ownerId, ini.targetDate, ini.targetResolution, ini.parentId, pos, now, now);
    for (const p of input.projectIds ?? []) this.addProject(ini.id, p);
    ini.projectIds = input.projectIds ?? [];
    return ini;
  }
  updateInitiative(initiativeId: string, patch: Partial<Pick<Initiative, 'name' | 'description' | 'summary' | 'icon' | 'color' | 'status' | 'health' | 'ownerId' | 'targetDate' | 'targetResolution' | 'parentId' | 'position'>>): void {
    const col: Record<string, string> = { ownerId: 'owner_id', targetDate: 'target_date', targetResolution: 'target_resolution', parentId: 'parent_id' };
    // clearing the date clears its resolution too
    if (patch.targetDate === null) patch = { ...patch, targetResolution: null };
    const sets: string[] = []; const vals: Array<string | number | null> = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !['name', 'description', 'summary', 'icon', 'color', 'status', 'health', 'ownerId', 'targetDate', 'targetResolution', 'parentId', 'position'].includes(k)) continue;
      if (k === 'parentId' && v === initiativeId) continue; // never its own parent
      sets.push(`${col[k] ?? k} = ?`); vals.push(v as string | number | null);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?'); vals.push(ts(), initiativeId);
    this.db.prepare(`UPDATE initiatives SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteInitiative(initiativeId: string): void {
    this.db.prepare('UPDATE initiatives SET parent_id = NULL WHERE parent_id = ?').run(initiativeId);
    this.db.prepare('DELETE FROM initiatives WHERE id = ?').run(initiativeId);
  }
  addProject(initiativeId: string, projectId: string): void { this.db.prepare('INSERT OR IGNORE INTO initiative_projects (initiative_id, project_id) VALUES (?, ?)').run(initiativeId, projectId); }
  removeProject(initiativeId: string, projectId: string): void { this.db.prepare('DELETE FROM initiative_projects WHERE initiative_id = ? AND project_id = ?').run(initiativeId, projectId); }
  /** an initiative update also sets its health, and notifies you when someone else posts on one you own */
  addInitiativeUpdate(initiativeId: string, userId: string, body: string, health?: ProjectHealth | null): InitiativeUpdate {
    const u: InitiativeUpdate = { id: id('iu'), initiativeId, userId, body, health: health ?? null, createdAt: ts() };
    this.db.prepare('INSERT INTO initiative_updates (id, initiative_id, user_id, body, health, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, initiativeId, userId, body, u.health, u.createdAt);
    if (health) this.updateInitiative(initiativeId, { health });
    const ini = this.db.prepare('SELECT name, owner_id FROM initiatives WHERE id = ?').get(initiativeId) as { name: string; owner_id: string | null } | undefined;
    const me = getMeta(this.db, 'currentUser');
    if (ini && ini.owner_id === me && userId !== me) this.store.notify('projectUpdate', { actorId: userId, body: `New update on ${ini.name}: ${body.replace(/\s+/g, ' ').slice(0, 120)}` });
    return u;
  }

  // ---------- releases ----------
  createRelease(input: { name: string; description?: string; stage?: ReleaseStage; teamId?: string | null; targetDate?: string | null }): Release {
    const r: Release = { id: id('rl'), name: input.name.trim(), description: input.description ?? '', stage: input.stage ?? 'planned', teamId: input.teamId ?? null, targetDate: input.targetDate ?? null, releasedAt: input.stage === 'released' ? ts() : null, createdAt: ts() };
    this.db.prepare('INSERT INTO releases (id, name, description, stage, team_id, target_date, released_at, created_at) VALUES (?,?,?,?,?,?,?,?)').run(r.id, r.name, r.description, r.stage, r.teamId, r.targetDate, r.releasedAt, r.createdAt);
    return r;
  }
  updateRelease(releaseId: string, patch: Partial<Pick<Release, 'name' | 'description' | 'stage' | 'teamId' | 'targetDate'>>): void {
    const col: Record<string, string> = { teamId: 'team_id', targetDate: 'target_date' };
    const sets: string[] = []; const vals: Array<string | null> = [];
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || !['name', 'description', 'stage', 'teamId', 'targetDate'].includes(k)) continue; sets.push(`${col[k] ?? k} = ?`); vals.push(v as string | null); }
    // shipping a release stamps it
    if (patch.stage) { sets.push('released_at = ?'); vals.push(patch.stage === 'released' ? ts() : null); }
    if (!sets.length) return;
    vals.push(releaseId);
    this.db.prepare(`UPDATE releases SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteRelease(releaseId: string): void {
    this.db.prepare('UPDATE issues SET release_id = NULL WHERE release_id = ?').run(releaseId);
    this.db.prepare('DELETE FROM releases WHERE id = ?').run(releaseId);
  }
}
