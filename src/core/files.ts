import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileOwnerType, StoredFile } from './types.js';
import { FILE_OWNER_TYPES } from './types.js';
import { id as newId, nowIso } from './util.js';

/* Images: profile pictures, custom emoji, and pictures pasted into descriptions, comments and
   docs. They are small by design (Baseline doesn't host file attachments; link to them instead), so
   the bytes live in SQLite next to everything else: one database file is the whole backup.
   A file lives as long as its owner; gc() deletes those whose owner is gone. */

export class FileError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 413 | 415) { super(message); }
}

/** pictures pasted into editors, and profile pictures */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_EMOJI_BYTES = 256 * 1024;

interface FileRow { id: string; name: string; mime: string; size: number; sha256: string; owner_type: string; owner_id: string; uploaded_by: string | null; created_at: string }
const META_COLS = 'id, name, mime, size, sha256, owner_type, owner_id, uploaded_by, created_at';

/** the table that must hold an owner's id for the owner to exist */
const OWNER_TABLE: Record<Exclude<FileOwnerType, 'workspace'>, string> = {
  issue: 'issues', doc: 'documents', project: 'projects', initiative: 'initiatives', team: 'teams', avatar: 'users', emoji: 'emojis',
};

/** what image the bytes are, or null when they aren't one we take */
export function sniffImage(b: Buffer): string | null {
  const at = (o: number, sig: number[]) => b.length >= o + sig.length && sig.every((x, i) => b[o + i] === x);
  const ascii = (o: number, s: string) => b.length >= o + s.length && b.toString('latin1', o, o + s.length) === s;
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(4, 'ftyp') && /^(avif|avis)$/.test(b.toString('latin1', 8, 12))) return 'image/avif';
  const head = b.toString('utf8', 0, Math.min(b.length, 1024)).replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

export function cleanFileName(name: string | undefined, fallback: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base.normalize('NFC').replace(/[^\p{L}\p{N}._\- ()]+/gu, '_').replace(/^[.\s]+/, '').trim().slice(0, 120);
  return clean || fallback;
}

/** an image opened directly (an SVG especially) runs no script and gets no same-origin access */
export function fileHeaders(f: Pick<StoredFile, 'name' | 'mime' | 'sha256'>): Record<string, string> {
  const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const image = f.mime.startsWith('image/');
  return {
    'Content-Type': f.mime,
    'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    ETag: `"${f.sha256}"`,
  };
}

export const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Math.round(bytes / 1024 / 1024 * 10) / 10} MB`;
export const fileUrl = (fileId: string, name: string) => `/api/files/${fileId}/${encodeURIComponent(name)}`;

export class FileService {
  constructor(private db: DatabaseSync, private legacyDir?: string) {}

  private map = (r: FileRow): StoredFile => ({
    id: r.id, name: r.name, mime: r.mime, size: r.size, sha256: r.sha256, ownerType: r.owner_type as FileOwnerType, ownerId: r.owner_id,
    uploadedBy: r.uploaded_by, createdAt: r.created_at, url: fileUrl(r.id, r.name),
  });

  get(fileId: string): StoredFile | undefined {
    const r = this.db.prepare(`SELECT ${META_COLS} FROM files WHERE id = ?`).get(fileId) as FileRow | undefined;
    return r ? this.map(r) : undefined;
  }
  data(fileId: string): Buffer | null {
    const r = this.db.prepare('SELECT data FROM files WHERE id = ?').get(fileId) as { data: Uint8Array } | undefined;
    return r ? Buffer.from(r.data) : null;
  }
  byOwner(type: FileOwnerType, ownerId: string): StoredFile[] {
    return (this.db.prepare(`SELECT ${META_COLS} FROM files WHERE owner_type = ? AND owner_id = ? ORDER BY created_at`).all(type, ownerId) as unknown as FileRow[]).map(this.map);
  }

  ownerExists(type: string, ownerId: string): boolean {
    if (!FILE_OWNER_TYPES.includes(type as FileOwnerType)) return false;
    if (type === 'workspace') return true;
    return !!this.db.prepare(`SELECT 1 FROM ${OWNER_TABLE[type as Exclude<FileOwnerType, 'workspace'>]} WHERE id = ?`).get(ownerId);
  }

  /** store an image; the bytes decide its type, whatever the upload claimed */
  upload(i: { data: Buffer; name?: string; ownerType: FileOwnerType; ownerId: string; uploadedBy?: string | null; maxBytes?: number }): StoredFile {
    const max = i.maxBytes ?? MAX_IMAGE_BYTES;
    if (!i.data.length) throw new FileError('The image is empty', 400);
    if (i.data.length > max) throw new FileError(`Images are limited to ${formatBytes(max)}. Link to bigger files instead.`, 413);
    if (!this.ownerExists(i.ownerType, i.ownerId)) throw new FileError(`That ${i.ownerType} doesn't exist`, 404);
    const mime = sniffImage(i.data);
    if (!mime) throw new FileError('Only images can be uploaded (PNG, JPEG, GIF, WebP, AVIF or SVG). Link to other files instead.', 415);
    const fallback = `image.${mime.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg')}`;
    return this.insert(newId('file'), i.data, cleanFileName(i.name, fallback), mime, i.ownerType, i.ownerId, i.uploadedBy ?? null, nowIso());
  }
  private insert(fileId: string, data: Buffer, name: string, mime: string, ownerType: FileOwnerType, ownerId: string, uploadedBy: string | null, createdAt: string): StoredFile {
    this.db.prepare(`INSERT INTO files (${META_COLS}, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(fileId, name, mime, data.length, createHash('sha256').update(data).digest('hex'), ownerType, ownerId, uploadedBy, createdAt, data);
    return this.get(fileId)!;
  }

  reassign(fileId: string, type: FileOwnerType, ownerId: string): void {
    this.db.prepare('UPDATE files SET owner_type = ?, owner_id = ? WHERE id = ?').run(type, ownerId, fileId);
  }
  remove(fileId: string): void { this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId); }
  removeOwner(type: FileOwnerType, ownerId: string): void { this.db.prepare('DELETE FROM files WHERE owner_type = ? AND owner_id = ?').run(type, ownerId); }

  /** delete files whose owner no longer exists (types this version doesn't know are left alone); returns how many went */
  gc(): number {
    let n = 0;
    for (const [type, table] of Object.entries(OWNER_TABLE)) {
      n += Number(this.db.prepare(`DELETE FROM files WHERE owner_type = ? AND owner_id NOT IN (SELECT id FROM ${table})`).run(type).changes);
    }
    return n;
  }

  /* Before the files table, uploads sat in `attachments/<id>/<name>` beside the database (one
     folder shared by every database there). Copy in what this database references, keeping
     each upload's id so URLs already pasted into descriptions keep working; the old folder is
     left as it was, since another database may still use it. */
  migrateLegacy(): number {
    const dir = this.legacyDir;
    if (!dir || !existsSync(dir)) return 0;
    let moved = 0;
    const copy = (fileId: string, name: string, ownerType: FileOwnerType, ownerId: string, uploadedBy: string | null, createdAt: string | null): StoredFile | null => {
      const existing = this.get(fileId);
      if (existing) return existing;
      const path = join(dir, fileId, name);
      if (!/^[\w-]+$/.test(fileId) || name.includes('/') || !existsSync(path)) return null;
      const data = readFileSync(path);
      // uploads from before images-only keep working: images inline, anything else as a download
      const mime = sniffImage(data) ?? 'application/octet-stream';
      moved++;
      return this.insert(fileId, data, cleanFileName(name, 'file'), mime, ownerType, ownerId, uploadedBy, createdAt ?? nowIso());
    };
    const tail = (url: string, prefix: string) => {
      const [fileId, name] = url.slice(prefix.length).split(/[?#]/)[0].split('/');
      try { return fileId && name ? { fileId, name: decodeURIComponent(name) } : null; } catch { return null; }
    };
    for (const a of this.db.prepare("SELECT id, issue_id, user_id, url, created_at FROM attachments WHERE kind = 'file' AND url LIKE '/api/attachments/%'").all() as Array<{ id: string; issue_id: string; user_id: string; url: string; created_at: string }>) {
      const t = tail(a.url, '/api/attachments/');
      const f = t && copy(a.id, t.name, 'issue', a.issue_id, a.user_id, a.created_at);
      if (f) this.db.prepare('UPDATE attachments SET url = ?, mime = ? WHERE id = ?').run(f.url, f.mime, a.id);
    }
    for (const u of this.db.prepare("SELECT id, avatar_url FROM users WHERE avatar_url LIKE '/api/emoji-files/%'").all() as Array<{ id: string; avatar_url: string }>) {
      const t = tail(u.avatar_url, '/api/emoji-files/');
      const f = t && copy(t.fileId, t.name, 'avatar', u.id, u.id, null);
      if (f) this.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(f.url, u.id);
    }
    for (const e of this.db.prepare("SELECT id, url, created_at FROM emojis WHERE url LIKE '/api/emoji-files/%'").all() as Array<{ id: string; url: string; created_at: string }>) {
      const t = tail(e.url, '/api/emoji-files/');
      const f = t && copy(t.fileId, t.name, 'emoji', e.id, null, e.created_at);
      if (f) this.db.prepare('UPDATE emojis SET url = ? WHERE id = ?').run(f.url, e.id);
    }
    return moved;
  }
}
