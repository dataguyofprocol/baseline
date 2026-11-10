import type { Notification, NotificationType } from './types.js';

export interface InboxRow {
  key: string;
  lead: Notification;
  ids: string[];
  actorIds: string[];
  unread: boolean;
  count: number;
}

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

export function visibleNotifications(list: readonly Notification[], now = new Date().toISOString()): Notification[] {
  return list.filter(n => !n.snoozedUntil || n.snoozedUntil <= now);
}

export const ASKS: readonly NotificationType[] = ['issueMentioned', 'issueReplied', 'issueReminder', 'slaBreached', 'agentFinished', 'agentBlocked', 'accessRequested'];
const ASKS_WHEN = /review|finished|blocked|needs? (you|your)|question/i;
export const needsYou = (n: Pick<Notification, 'type' | 'body'>) =>
  ASKS.includes(n.type) || ((n.type === 'prActivity' || n.type === 'issueStatusChanged' || n.type === 'teamActivity') && ASKS_WHEN.test(n.body));
