// The inbox as rows, not an event log: every notification about one issue merges into one row
// that leads with the newest headline. Shared by GET /api/notifications and the web inbox, so
// both count the same rows. Pure: no database, safe to import in the browser.
import type { Notification, NotificationType } from './types.js';

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

/** notification kinds that ask something of you, rather than tell you something happened. An
 *  assignment isn't one: the issue is already in progress or up next. */
export const ASKS: readonly NotificationType[] = ['issueMentioned', 'issueReplied', 'issueReminder', 'slaBreached', 'agentFinished', 'agentBlocked', 'accessRequested'];
/** …and the ones that do when their text says so: a PR waiting on your review, an agent that finished or is stuck */
const ASKS_WHEN = /review|finished|blocked|needs? (you|your)|question/i;
/** whether a notification belongs in "Needs you" (My work on the web, Today in the terminal) */
export const needsYou = (n: Pick<Notification, 'type' | 'body'>) =>
  ASKS.includes(n.type) || ((n.type === 'prActivity' || n.type === 'issueStatusChanged' || n.type === 'teamActivity') && ASKS_WHEN.test(n.body));
