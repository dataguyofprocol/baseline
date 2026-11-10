// The inbox as rows, not an event log: every notification about one issue merges into one row
// that leads with the newest headline. Shared by GET /api/notifications and the web inbox, so
// both count the same rows. Pure: no database, safe to import in the browser.
import type { Notification } from './types.js';

export interface InboxRow {
  /** `issue:<id>`, or `n:<id>` for a notification about no issue (those never merge) */
  key: string;
  /** the newest notification in the row: its headline is the row's */
  lead: Notification;
  /** every merged notification, newest first (mark read / delete / snooze act on all of them) */
  ids: string[];
  /** who acted, newest first, once each */
  actorIds: string[];
  /** unread while any merged notification is unread */
  unread: boolean;
  count: number;
}

/** `list` newest first (as the snapshot holds it); the rows keep that order */
export function inboxRows(list: readonly Notification[]): InboxRow[] {
  const byKey = new Map<string, InboxRow>();
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const n of sorted) {
    const key = n.issueId ? `issue:${n.issueId}` : `n:${n.id}`;
    const row = byKey.get(key);
    if (!row) { byKey.set(key, { key, lead: n, ids: [n.id], actorIds: n.actorId ? [n.actorId] : [], unread: !n.readAt, count: 1 }); continue; }
    row.ids.push(n.id);
    row.count++;
    row.unread ||= !n.readAt;
    if (n.actorId && !row.actorIds.includes(n.actorId)) row.actorIds.push(n.actorId);
  }
  return [...byKey.values()];
}

/** what the inbox shows now: snoozed notifications stay out until their time */
export function visibleNotifications(list: readonly Notification[], now = new Date().toISOString()): Notification[] {
  return list.filter(n => !n.snoozedUntil || n.snoozedUntil <= now);
}
