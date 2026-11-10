import type { DatabaseSync } from 'node:sqlite';
import type { Store } from './store.js';
import { id } from './util.js';
import type { DateResolution, Initiative, InitiativeLabel, InitiativeLink, InitiativeUpdate, InitiativeStatus, Priority, ProjectHealth, UpdateCadence } from './types.js';

const ts = () => new Date().toISOString();

type InitiativeRow = { id: string; name: string; description: string; summary: string; icon: string; color: string; status: InitiativeStatus; health: ProjectHealth | null; owner_id: string | null; target_date: string | null; target_resolution: DateResolution | null; parent_id: string | null; position: number; created_at: string; updated_at: string;
  number: number | null; priority: number; labels: string; team_id: string | null; update_cadence: UpdateCadence | null };

export class Planning {
  constructor(private store: Store, private db: DatabaseSync) {
    store.tickHooks.push(now => this.remindUpdates(now));
  }

  private rows<T>(sql: string, ...args: Array<string | number | null>): T[] { return this.db.prepare(sql).all(...args) as unknown as T[]; }

  snapshot() {
    const links = this.rows<{ initiative_id: string; project_id: string }>('SELECT * FROM initiative_projects');
    const initiatives: Initiative[] = this.rows<InitiativeRow>('SELECT * FROM initiatives ORDER BY position, created_at').map(r => ({
      id: r.id, name: r.name, description: r.description, summary: r.summary ?? '', icon: r.icon, color: r.color, status: r.status, health: r.health,
      ownerId: r.owner_id, targetDate: r.target_date, targetResolution: r.target_resolution ?? null, parentId: r.parent_id, position: r.position, createdAt: r.created_at, updatedAt: r.updated_at,
      projectIds: links.filter(l => l.initiative_id === r.id).map(l => l.project_id),
      number: r.number ?? 0, priority: (r.priority ?? 0) as Priority, labelIds: JSON.parse(r.labels || '[]'), teamId: r.team_id ?? null, updateCadence: r.update_cadence ?? null,
    }));
    const initiativeUpdates: InitiativeUpdate[] = this.rows<{ id: string; initiative_id: string; user_id: string; body: string; health: ProjectHealth | null; created_at: string; reactions: string | null }>('SELECT * FROM initiative_updates ORDER BY created_at DESC')
      .map(u => ({ id: u.id, initiativeId: u.initiative_id, userId: u.user_id, body: u.body, health: u.health, createdAt: u.created_at, reactions: JSON.parse(u.reactions || '{}') }));
    const initiativeLabels: InitiativeLabel[] = this.rows<{ id: string; name: string; color: string; description: string; created_at: string }>('SELECT * FROM initiative_labels ORDER BY name')
      .map(l => ({ id: l.id, name: l.name, color: l.color, description: l.description, createdAt: l.created_at }));
    const initiativeLinks: InitiativeLink[] = this.rows<{ id: string; initiative_id: string; url: string; title: string; created_at: string }>('SELECT * FROM initiative_links ORDER BY created_at')
      .map(l => ({ id: l.id, initiativeId: l.initiative_id, url: l.url, title: l.title, createdAt: l.created_at }));
    return { initiatives, initiativeUpdates, initiativeLabels, initiativeLinks };
  }

  createInitiative(input: { name: string; description?: string; summary?: string; icon?: string; color?: string; status?: InitiativeStatus; ownerId?: string | null; targetDate?: string | null; targetResolution?: DateResolution | null; parentId?: string | null; projectIds?: string[]; priority?: Priority; labelIds?: string[]; teamId?: string | null; updateCadence?: UpdateCadence | null }): Initiative {
    const now = ts();
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 p FROM initiatives').get() as { p: number }).p;
    const num = (this.db.prepare('SELECT COALESCE(MAX(number), 0) + 1 n FROM initiatives').get() as { n: number }).n;
    const ini: Initiative = {
      id: id('in'), name: input.name.trim(), description: input.description ?? '', summary: input.summary?.trim() ?? '', icon: input.icon ?? 'glyph:initiative', color: input.color ?? '#5e6ad2',
      status: input.status ?? 'planned', health: null, ownerId: input.ownerId ?? this.store.actor(), targetDate: input.targetDate ?? null, targetResolution: input.targetDate ? input.targetResolution ?? null : null,
      parentId: input.parentId ?? null, projectIds: [], position: pos, createdAt: now, updatedAt: now,
      number: num, priority: input.priority ?? 0, labelIds: input.labelIds ?? [], teamId: input.teamId ?? null, updateCadence: input.updateCadence ?? null,
    };
    this.db.prepare('INSERT INTO initiatives (id, name, description, summary, icon, color, status, health, owner_id, target_date, target_resolution, parent_id, position, created_at, updated_at, number, priority, labels, team_id, update_cadence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(ini.id, ini.name, ini.description, ini.summary, ini.icon, ini.color, ini.status, null, ini.ownerId, ini.targetDate, ini.targetResolution, ini.parentId, pos, now, now, num, ini.priority, JSON.stringify(ini.labelIds), ini.teamId, ini.updateCadence);
    for (const p of input.projectIds ?? []) this.addProject(ini.id, p);
    ini.projectIds = input.projectIds ?? [];
    return ini;
  }
  updateInitiative(initiativeId: string, patch: Partial<Pick<Initiative, 'name' | 'description' | 'summary' | 'icon' | 'color' | 'status' | 'health' | 'ownerId' | 'targetDate' | 'targetResolution' | 'parentId' | 'position' | 'priority' | 'labelIds' | 'teamId' | 'updateCadence'>>): void {
    const col: Record<string, string> = { ownerId: 'owner_id', targetDate: 'target_date', targetResolution: 'target_resolution', parentId: 'parent_id', labelIds: 'labels', teamId: 'team_id', updateCadence: 'update_cadence' };
    if (patch.targetDate === null) patch = { ...patch, targetResolution: null };
    const sets: string[] = []; const vals: Array<string | number | null> = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !['name', 'description', 'summary', 'icon', 'color', 'status', 'health', 'ownerId', 'targetDate', 'targetResolution', 'parentId', 'position', 'priority', 'labelIds', 'teamId', 'updateCadence'].includes(k)) continue;
      if (k === 'parentId' && v === initiativeId) continue;
      if (k === 'priority' && ![0, 1, 2, 3, 4].includes(v as number)) continue;
      sets.push(`${col[k] ?? k} = ?`); vals.push(k === 'labelIds' ? JSON.stringify(v) : v as string | number | null);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?'); vals.push(ts(), initiativeId);
    this.db.prepare(`UPDATE initiatives SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  deleteInitiative(initiativeId: string): void {
    this.db.prepare('UPDATE initiatives SET parent_id = NULL WHERE parent_id = ?').run(initiativeId);
    this.db.prepare('UPDATE documents SET initiative_id = NULL WHERE initiative_id = ?').run(initiativeId);
    this.db.prepare('DELETE FROM initiatives WHERE id = ?').run(initiativeId);
  }
  addProject(initiativeId: string, projectId: string): void { this.db.prepare('INSERT OR IGNORE INTO initiative_projects (initiative_id, project_id) VALUES (?, ?)').run(initiativeId, projectId); }
  removeProject(initiativeId: string, projectId: string): void { this.db.prepare('DELETE FROM initiative_projects WHERE initiative_id = ? AND project_id = ?').run(initiativeId, projectId); }
  addInitiativeUpdate(initiativeId: string, userId: string, body: string, health?: ProjectHealth | null): InitiativeUpdate {
    const u: InitiativeUpdate = { id: id('iu'), initiativeId, userId, body, health: health ?? null, createdAt: ts(), reactions: {} };
    this.db.prepare('INSERT INTO initiative_updates (id, initiative_id, user_id, body, health, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(u.id, initiativeId, userId, body, u.health, u.createdAt);
    if (health) this.updateInitiative(initiativeId, { health });
    const ini = this.db.prepare('SELECT name, owner_id FROM initiatives WHERE id = ?').get(initiativeId) as { name: string; owner_id: string | null } | undefined;
    if (ini) this.store.notifyEach([ini.owner_id], 'projectUpdate', { actorId: userId, body: `New update on ${ini.name}: ${body.replace(/\s+/g, ' ').slice(0, 120)}` });
    return u;
  }

  updateAuthor(updateId: string): string | null {
    return (this.db.prepare('SELECT user_id FROM initiative_updates WHERE id = ?').get(updateId) as { user_id: string } | undefined)?.user_id ?? null;
  }
  editUpdate(updateId: string, body: string): void {
    this.db.prepare('UPDATE initiative_updates SET body = ? WHERE id = ?').run(body, updateId);
  }
  deleteUpdate(updateId: string): void {
    this.db.prepare('DELETE FROM initiative_updates WHERE id = ?').run(updateId);
  }

  toggleUpdateReaction(updateId: string, emoji: string, userId: string): void {
    const row = this.db.prepare('SELECT reactions FROM initiative_updates WHERE id = ?').get(updateId) as { reactions: string | null } | undefined;
    if (!row) return;
    const r: Record<string, string[]> = JSON.parse(row.reactions || '{}');
    const list = r[emoji] ?? [];
    r[emoji] = list.includes(userId) ? list.filter(u => u !== userId) : [...list, userId];
    if (!r[emoji].length) delete r[emoji];
    this.db.prepare('UPDATE initiative_updates SET reactions = ? WHERE id = ?').run(JSON.stringify(r), updateId);
  }

  createLabel(input: { name: string; color?: string; description?: string }): InitiativeLabel {
    const l: InitiativeLabel = { id: id('il'), name: input.name.trim(), color: input.color ?? '#5e6ad2', description: input.description ?? '', createdAt: ts() };
    this.db.prepare('INSERT INTO initiative_labels (id, name, color, description, created_at) VALUES (?, ?, ?, ?, ?)').run(l.id, l.name, l.color, l.description, l.createdAt);
    return l;
  }
  updateLabel(labelId: string, patch: Partial<Pick<InitiativeLabel, 'name' | 'color' | 'description'>>): void {
    for (const k of ['name', 'color', 'description'] as const) if (typeof patch[k] === 'string') this.db.prepare(`UPDATE initiative_labels SET ${k} = ? WHERE id = ?`).run(patch[k]!, labelId);
  }
  deleteLabel(labelId: string): void {
    for (const r of this.rows<{ id: string; labels: string }>('SELECT id, labels FROM initiatives WHERE labels LIKE ?', `%${labelId}%`)) {
      this.db.prepare('UPDATE initiatives SET labels = ? WHERE id = ?').run(JSON.stringify((JSON.parse(r.labels) as string[]).filter(x => x !== labelId)), r.id);
    }
    this.db.prepare('DELETE FROM initiative_labels WHERE id = ?').run(labelId);
  }
  addLink(initiativeId: string, url: string, title?: string): InitiativeLink {
    const l: InitiativeLink = { id: id('ilk'), initiativeId, url, title: title?.trim() || url, createdAt: ts() };
    this.db.prepare('INSERT INTO initiative_links (id, initiative_id, url, title, created_at) VALUES (?, ?, ?, ?, ?)').run(l.id, initiativeId, l.url, l.title, l.createdAt);
    return l;
  }
  deleteLink(linkId: string): void { this.db.prepare('DELETE FROM initiative_links WHERE id = ?').run(linkId); }

  updateDueAt(ini: { id: string; status: InitiativeStatus; updateCadence: UpdateCadence | null; createdAt: string }): string | null {
    if (ini.status === 'completed' || ini.status === 'canceled') return null;
    const c = ini.updateCadence ?? this.store.getFeatures().initiativeUpdateCadence;
    const days = c === 'weekly' ? 7 : c === 'biweekly' ? 14 : c === 'monthly' ? 30 : 0;
    if (!days) return null;
    const last = this.db.prepare('SELECT MAX(created_at) t FROM initiative_updates WHERE initiative_id = ?').get(ini.id) as { t: string | null };
    return new Date(new Date(last.t ?? ini.createdAt).getTime() + days * 86400000).toISOString();
  }
  private remindUpdates(now: Date): void {
    for (const r of this.rows<{ id: string; name: string; status: InitiativeStatus; update_cadence: UpdateCadence | null; created_at: string; owner_id: string }>('SELECT id, name, status, update_cadence, created_at, owner_id FROM initiatives WHERE owner_id IS NOT NULL')) {
      const due = this.updateDueAt({ id: r.id, status: r.status, updateCadence: r.update_cadence, createdAt: r.created_at });
      if (!due || due > now.toISOString()) continue;
      const already = this.db.prepare("SELECT 1 FROM notifications WHERE type = 'initiativeUpdateReminder' AND user_id = ? AND body LIKE ? AND created_at >= ?").get(r.owner_id, `${r.id}|%`, due);
      if (!already) this.store.notifyEach([r.owner_id], 'initiativeUpdateReminder', { actorId: null, body: `${r.id}|An update on ${r.name} is due`, createdAt: now.toISOString() });
    }
  }
}
