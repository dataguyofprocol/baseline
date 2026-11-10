import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, relTime, useCursor, registerVisibleList, nameOf, copyText, dateTime } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, MenuSub, useMenu, Burst } from './ui.js';
import { useEarned } from './motion.js';
import { IssueDetail } from './IssueDetail.js';
import { Avatar, teamDisplayIcon } from './pickers.js';
import { parseReminder } from './propertyMenus.js';
import { Markdown } from './Markdown.js';
import { PrIcon, prStateOfNotice } from './GitHubUI.js';
import { InitiativeIcon } from './Initiatives.js';
import { healthColor, healthLabel } from './Projects.js';
import {
  IconAssignArrow, IconComment, IconMention, IconCycle, IconFilter, IconDisplay, IconCheck, IconTrash,
  IconClock, IconSettings, IconReply, IconBell, IconClose, IconUpdates, IconPlus, IconEdit,
  IconEmoji, IconDoc, IconExternal, IconLink, IconAgent, IconLoop,
} from './icons.js';
import { notifyCategory, type Notification, type NotificationType, type NotifyCategory, type Snapshot } from '../../src/core/types.js';
import { inboxRows, needsYou } from '../../src/core/inbox.js';
import { plainText } from '../../src/core/mentions.js';
import { toggleSubscription } from './actions.js';
import { EmptyState } from './EmptyState.js';

/* Linear's inbox: notifications on the left (newest first, one row per issue), the issue on
   the right. U toggles read, ⌫ deletes, H snoozes, ⇧⌫ deletes everything read. Snoozed
   notifications and reminders stay out of sight until their time. */

type Row = { key: string; lead: Notification; actors: string[]; ids: string[]; unread: boolean; count: number };
type InboxView = 'all' | 'needs' | 'agents';
interface InboxPrefs { view?: InboxView; order: 'newest' | 'oldest'; showSnoozed: boolean; unreadFirst: boolean; types: NotificationType[]; from: string[]; priority: boolean; groupUnreads: 'none' | 'focus'; priorityCats?: NotifyCategory[] }
const PREFS_KEY = 'baseline:inboxPrefs';
/** what Priority inbox lifts to the top (Settings › Notifications › Priority notifications) */
export const DEFAULT_PRIORITY_CATS: NotifyCategory[] = ['agentWork', 'assignments', 'mentions', 'comments', 'reminders', 'updates'];
/** the inbox's display settings live in this browser; Settings › Notifications edits the same ones */
export function readInboxPrefs(): Partial<InboxPrefs> { try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'); } catch { return {}; } }
export function writeInboxPrefs(p: Partial<InboxPrefs>) { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readInboxPrefs(), ...p })); } catch { /* ignore */ } }
const TYPE_LABELS: Partial<Record<NotificationType, string>> = {
  agentFinished: 'Agent finished', agentBlocked: 'Agent blocked or stopped',
  issueAssignedToYou: 'Assignments', issueCommented: 'Comments', issueReplied: 'Replies', issueMentioned: 'Mentions', commentReacted: 'Reactions',
  issueStatusChanged: 'Status changes', issueReminder: 'Reminders', systemUpdate: 'System notices',
  projectUpdate: 'Project updates', projectIssueAdded: 'Project activity', projectUpdateReminder: 'Project update reminders', initiativeUpdateReminder: 'Initiative update reminders', updatesDigest: 'Updates summary',
  slaBreached: 'SLA breaches', prActivity: 'Pull requests', loopFailed: 'Loops', teamActivity: 'Team activity', teamMemberAdded: 'Added to a team',
  accessRequested: 'Requests',
};
/* the filter menu's sections: 19 flat types with near-identical names were hard to scan */
const TYPE_GROUPS: Array<[string, NotificationType[]]> = [
  ['Issues', ['agentFinished', 'agentBlocked', 'issueAssignedToYou', 'issueMentioned', 'issueCommented', 'issueReplied', 'commentReacted', 'issueStatusChanged', 'issueReminder', 'slaBreached', 'prActivity']],
  ['Projects and initiatives', ['projectUpdate', 'projectIssueAdded', 'updatesDigest', 'projectUpdateReminder', 'initiativeUpdateReminder']],
  ['Workspace', ['accessRequested', 'teamMemberAdded', 'teamActivity', 'loopFailed', 'systemUpdate']],
];
/* one filter value covers several kinds */
const TYPE_ALIASES: Partial<Record<NotificationType, NotificationType[]>> = { projectIssueAdded: ['projectIssueAdded', 'projectIssueClosed', 'projectChanged'] };

const VIEW_LABELS: Record<InboxView, string> = { all: 'All', needs: 'Needs you', agents: 'Agents' };

const FOCUS_LABELS: Partial<Record<NotificationType, string>> = {
  agentFinished: 'Agent work', agentBlocked: 'Agent work',
  issueAssignedToYou: 'Assigned to you', issueMentioned: 'Mentions', issueReplied: 'Replies', issueReminder: 'Reminders',
  issueStatusChanged: 'Status changes', issueCommented: 'Comments',
};

function snoozeOptions(): Array<[string, Date]> {
  const at = (h: number, add = 0) => { const d = new Date(); d.setDate(d.getDate() + add); d.setHours(h, 0, 0, 0); return d; };
  const nextMon = () => { const d = at(9); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return d; };
  return [['An hour from now', new Date(Date.now() + 3600000)], ['In 3 hours', new Date(Date.now() + 3 * 3600000)], ['Tomorrow', at(9, 1)], ['Next week', nextMon()], ['A month from now', (() => { const d = at(9); d.setMonth(d.getMonth() + 1); return d; })()]];
}
const fmt = (d: Date) => d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** when a row happened: a reminder counts from the time it was set for */
const rowAt = (r: { lead: Notification }) => r.lead.snoozedUntil && r.lead.type === 'issueReminder' ? r.lead.snoozedUntil : r.lead.createdAt;
const isAgent = (t: NotificationType) => t === 'agentFinished' || t === 'agentBlocked';
/** the day group a row sits under when the inbox isn't grouped some other way */
function dayLabel(iso: string): string {
  const day = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const ago = Math.round((day(new Date()) - day(new Date(iso))) / 86400000);
  return ago <= 0 ? 'Today' : ago === 1 ? 'Yesterday' : ago < 7 ? 'This week' : 'Older';
}
/** "X joined <workspace> (<teams>)", the systemUpdate the server sends when someone accepts an invite */
function parseJoined(n: Notification): { who: string; where: string; teams: string } | null {
  if (n.type !== 'systemUpdate' || !n.actorId) return null;
  const m = /^(.+?) joined (.+?)(?: \(([^)]*)\))?$/.exec(n.body);
  return m ? { who: m[1], where: m[2], teams: m[3] ?? '' } : null;
}

function SnoozeItems(props: { onPick: (d: Date) => void }) {
  const [q, setQ] = useState('');
  const typed = parseReminder(q);
  return (
    <>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Try: 4 pm, 2 days, in 5 weeks…" />
      </div>
      {typed && <MenuItem icon={<IconClock size={14} />} label={<>Snooze until {fmt(typed)}</>} onClick={() => props.onPick(typed)} />}
      {snoozeOptions().filter(([l]) => l.toLowerCase().includes(q.toLowerCase())).map(([l, d]) => (
        <MenuItem key={l} icon={<IconClock size={14} />} label={l} right={<span className="mi-hint">{fmt(d)}</span>} onClick={() => props.onPick(d)} />
      ))}
    </>
  );
}

export function InboxPage() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<InboxPrefs>(() => {
    const base: InboxPrefs = { order: 'newest', showSnoozed: false, unreadFirst: false, types: [], from: [], priority: false, groupUnreads: 'none' };
    try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return base; }
  });
  const patchPrefs = (p: Partial<InboxPrefs>) => setPrefs(cur => { const n = { ...cur, ...p }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const filterMenu = useMenu();
  const displayMenu = useMenu();
  const rowMenu = useMenu();
  const snoozeMenu = useMenu();
  const [menuRow, setMenuRow] = useState<Row | null>(null);
  const now = new Date().toISOString();
  // muting status changes is the per-person preference the server also honours for new ones
  const notifyPrefs = snap.workspace.preferences.notify;
  const statusMuted = notifyPrefs.statusChanged === false;
  const setStatusMuted = async (muted: boolean) => { await api.updatePreferences({ notify: { ...notifyPrefs, statusChanged: !muted } }); await useApp.getState().bootstrap(); };

  const notifications = useMemo(() => snap.notifications.filter(n =>
    (!statusMuted || n.type !== 'issueStatusChanged')
    && (prefs.showSnoozed || !n.snoozedUntil || n.snoozedUntil <= now)
    && (!prefs.types.length || prefs.types.some(t => (TYPE_ALIASES[t] ?? [t]).includes(n.type)))
    && (!prefs.from.length || prefs.from.includes(n.actorId ?? 'none'))
    && (n.type !== 'issueReminder' || !n.snoozedUntil || n.snoozedUntil <= now || prefs.showSnoozed),
  ), [snap.notifications, prefs, now, statusMuted]);

  /* Everything about one issue is one row (core/inbox.ts, as GET /api/notifications counts
     them): it leads with the newest headline, stacks everyone who acted, and stays unread
     while any part is unread. */
  const allRows = useMemo(() => {
    const out: Row[] = inboxRows(notifications).map(r => ({ key: r.key, lead: r.lead, actors: r.actorIds, ids: r.ids, unread: r.unread, count: r.count }));
    out.sort((a, b) => (prefs.unreadFirst ? Number(b.unread) - Number(a.unread) : 0) || (prefs.order === 'newest' ? rowAt(b).localeCompare(rowAt(a)) : rowAt(a).localeCompare(rowAt(b))));
    return out;
  }, [notifications, prefs.order, prefs.unreadFirst]);
  /* the view tabs: everything, what waits on you (core/inbox.ts needsYou, the same rule as My work
     and the terminal's Today), and agent reports */
  const view: InboxView = prefs.view ?? 'all';
  const inView = (r: Row, v: InboxView) => v === 'all' || (v === 'needs' ? needsYou(r.lead) : isAgent(r.lead.type));
  const viewCount = { all: allRows.length, needs: allRows.filter(r => inView(r, 'needs')).length, agents: allRows.filter(r => inView(r, 'agents')).length };
  const needsUnread = allRows.some(r => r.unread && inView(r, 'needs'));
  const rows = useMemo(() => allRows.filter(r => inView(r, view)), [allRows, view]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Priority inbox puts what needs you (assignments, mentions, replies, reminders) above
     everything else; Focus groups the unread ones by kind. Rows are re-ordered to match
     the sections so J/K walks them top to bottom. */
  const sectionOf = (r: Row): string | null => {
    if (prefs.groupUnreads === 'focus' && r.unread) return FOCUS_LABELS[r.lead.type] ?? 'Other updates';
    // an agent's finished or blocked report is always priority: it's waiting on you
    if (prefs.priority) { const c = notifyCategory(r.lead.type, r.lead.body); return c === 'agentWork' || (c && (prefs.priorityCats ?? DEFAULT_PRIORITY_CATS).includes(c)) ? 'Priority' : 'Other'; }
    if (prefs.groupUnreads === 'focus') return 'Read';
    // no grouping: the list reads by day (not with unread first, which mixes the days)
    return prefs.unreadFirst ? null : dayLabel(rowAt(r));
  };
  const sectionRank = (name: string | null) => {
    if (name === null || (!prefs.priority && prefs.groupUnreads !== 'focus')) return 0;
    const order = prefs.groupUnreads === 'focus' ? [...Object.values(FOCUS_LABELS), 'Other updates', ...(prefs.priority ? ['Priority', 'Other'] : ['Read'])] : ['Priority', 'Other'];
    const i = order.indexOf(name);
    return i < 0 ? 99 : i;
  };
  const sectioned = useMemo(() => rows.map((r, i) => ({ r, i, sec: sectionOf(r) })).sort((a, b) => sectionRank(a.sec) - sectionRank(b.sec) || a.i - b.i), [rows, prefs.priority, prefs.groupUnreads]); // eslint-disable-line react-hooks/exhaustive-deps
  const orderedRows = sectioned.map(x => x.r);

  /** a teamMemberAdded body is "<teamId>|<name at the time>"; the team may since be renamed or gone */
  const teamOf = (n: Notification) => { const [id, ...name] = n.body.split('|'); const t = snap.teams.find(x => x.id === id); return { key: t?.key, name: t?.name ?? name.join('|') }; };
  const issueOf = (n: Notification) => n.issueId ? snap.issues.find(i => i.id === n.issueId) : undefined;
  const keyOf = (n: Notification) => { const i = issueOf(n); const t = i && snap.teams.find(x => x.id === i.teamId); return i && t ? `${t.key}-${i.number}` : ''; };
  /** where a notification leads (the row menu's Open and Copy link) */
  const pathOf = (n: Notification): string | null => {
    if (n.type === 'docChanged') return `/docs/${n.body.split('|')[0]}`;
    if (n.type === 'teamMemberAdded') { const t = teamOf(n); return t.key ? `/team/${t.key}/overview` : null; }
    // "Ask <name>": body is "<settings path>|<what>"
    if (n.type === 'accessRequested') return n.body.split('|')[0] || '/settings';
    const ini = n.type === 'initiativeUpdateReminder' ? n.body.split('|')[0] : updateTarget(snap, n)?.initiative?.id;
    if (ini) return `/initiatives/${ini}`;
    const k = keyOf(n);
    if (k) return `/issue/${k}`;
    return n.projectId ? `/projects/${n.projectId}` : null;
  };

  // J/K and the issue shortcuts run on the shared list cursor
  const navigable = useMemo(() => orderedRows.filter(r => issueOf(r.lead)), [orderedRows, snap.issues]); // eslint-disable-line react-hooks/exhaustive-deps
  const cursor = useCursor(s => s.index);
  useEffect(() => { registerVisibleList(navigable.map(r => issueOf(r.lead)!), ''); }, [navigable]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const first = navigable.findIndex(r => r.unread);
    useCursor.setState({ index: navigable.length ? Math.max(first, 0) : -1 });
    return () => useCursor.getState().reset();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cursor >= navigable.length && navigable.length) useCursor.setState({ index: navigable.length - 1 }); }, [navigable.length, cursor]);

  const selected = cursor >= 0 ? navigable[cursor] : undefined;
  const selectedIssue = selected ? issueOf(selected.lead) : undefined;
  // project notifications and summaries have no issue: clicking one previews it here
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const refresh = () => useApp.getState().bootstrap();
  const markRead = async (row: Row, value: boolean) => { for (const id of row.ids) await api.markNotificationRead(id, value); await refresh(); };
  const remove = async (row: Row) => { for (const id of row.ids) await api.deleteNotification(id); await refresh(); };
  const snooze = async (row: Row, d: Date) => {
    for (const id of row.ids) await api.snoozeNotification(id, d.toISOString());
    await refresh();
    useApp.getState().toast({ title: 'Snoozed', line: <>Back in your inbox {fmt(d)}</> });
  };

  /* Viewing a row marks it read after a short delay, so skimming past doesn't clear it. Only a
     row the person picked counts (a click, or moving the cursor with J/K/arrows): the row the
     inbox selects by itself on open, or that slides under the cursor as rows arrive, stays
     unread. `picked` is the row key (one per issue), so a new event on it doesn't count as read. */
  const [picked, setPicked] = useState<string | null>(null);
  // a cursor move counts as a pick only right after the person pressed a list key
  const keyMove = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) { keyMove.current = true; setTimeout(() => { keyMove.current = false; }, 300); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (!keyMove.current) return;
    keyMove.current = false;
    if (cursor >= 0 && navigable[cursor]) setPicked(navigable[cursor].key);
  }, [cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected?.unread || selected.key !== picked) return;
    const t = setTimeout(() => void markRead(selected, true), 900);
    return () => clearTimeout(t);
  }, [selected?.lead.id, selected?.unread, picked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.querySelector('.inbox-row.selected')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  // inbox keys (U, ⌫, H, ⇧⌫) listen in the capture phase so they run before the list shortcuts
  const selRef = useRef(selected);
  selRef.current = selected;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.menu:not(.closing)') || useApp.getState().peekIssueId) return;
      const row = selRef.current;
      if (e.key === 'Backspace' && e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); void api.deleteReadNotifications().then(refresh); return; }
      if (!row) return;
      if (e.key.toLowerCase() === 'u' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); void markRead(row, row.unread); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); e.stopImmediatePropagation(); void remove(row); }
      else if (e.key.toLowerCase() === 'h' && !e.shiftKey) {
        e.preventDefault(); e.stopImmediatePropagation();
        const el = document.querySelector<HTMLElement>('.inbox-row.selected');
        if (el) { setMenuRow(row); snoozeMenu.setAnchor(el.getBoundingClientRect()); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const describe = (n: Notification, z = 12): { icon: React.ReactNode; what: string } => {
    switch (n.type) {
      case 'agentFinished': return { icon: <IconCheck size={z} />, what: n.body.startsWith('Ready') ? 'finished, ready for your review' : 'finished' };
      case 'agentBlocked': return { icon: <IconClose size={z} />, what: n.body.startsWith('Stopped') ? 'stopped before finishing' : 'needs an answer' };
      case 'issueAssignedToYou': return { icon: <IconAssignArrow size={z} />, what: 'assigned the issue to you' };
      case 'issueCommented': return { icon: <IconComment size={z} />, what: 'commented' };
      case 'issueReplied': return { icon: <IconReply size={z} />, what: 'replied to your thread' };
      case 'docChanged': return { icon: <IconDoc size={z} />, what: 'edited your document' };
      case 'commentReacted': return { icon: <IconEmoji size={z} />, what: `reacted ${n.body.split(' ')[0]} to your comment` };
      case 'issueMentioned': return { icon: <IconMention size={z} />, what: 'mentioned you' };
      case 'issueStatusChanged': return { icon: <IconCycle size={z} />, what: n.body ? `changed status to ${n.body}` : 'changed the status' };
      case 'issueReminder': return { icon: <IconClock size={z} />, what: 'Reminder' };
      case 'systemUpdate': return { icon: parseJoined(n) ? <IconPlus size={z} /> : <IconBell size={z} />, what: '' };
      case 'projectUpdate': return { icon: <IconUpdates size={z} />, what: 'posted a project update' };
      case 'projectIssueAdded': return { icon: <IconPlus size={z} />, what: 'added an issue to the project' };
      case 'projectIssueClosed': return { icon: <IconCheck size={z} />, what: n.body.startsWith('Canceled') ? 'canceled an issue in the project' : 'completed an issue in the project' };
      case 'projectChanged': return { icon: <IconEdit size={z} />, what: 'changed the project description' };
      case 'projectUpdateReminder': return { icon: <IconClock size={z} />, what: 'Project update due' };
      case 'initiativeUpdateReminder': return { icon: <IconClock size={z} />, what: 'Initiative update due' };
      case 'updatesDigest': return { icon: <IconUpdates size={z} />, what: 'Project updates summary' };
      case 'slaBreached': return { icon: <IconClock size={z} />, what: 'SLA breached' };
      case 'prActivity': return { icon: <PrIcon state={prStateOfNotice(n.body)} size={z + 2} title="Pull request" />, what: n.body };
      case 'loopFailed': return { icon: <IconClose size={z} />, what: `loop failed: ${n.body}` };
      case 'teamActivity': return { icon: <IconBell size={z} />, what: n.body };
      case 'teamMemberAdded': return { icon: <IconPlus size={z} />, what: 'added you to the team' };
      case 'accessRequested': return { icon: <IconBell size={z} />, what: `asked you to ${n.body.split('|').slice(1).join('|').replace(/^./, c => c.toLowerCase())}` };
      default: return { icon: <IconComment size={z} />, what: 'updated the issue' };
    }
  };
  /** the left mark: who acted, with a small mark for the kind; a tile when no person did. The
   *  tile's tone carries an agent's state (orange: waiting on you, red: stopped), so rows need no tags */
  const leadOf = (row: Row): React.ReactNode => {
    const n = row.lead;
    const actors = row.actors.map(a => snap.users.find(u => u.id === a)).filter(Boolean) as typeof snap.users;
    if (isAgent(n.type)) {
      const tone = n.type === 'agentFinished' ? 'agent' : n.body.startsWith('Stopped') ? 'stop' : 'ask';
      return <span className={`inbox-sys ${tone}`} title={tone === 'agent' ? 'Agent finished' : tone === 'ask' ? 'Agent needs an answer' : 'Agent stopped'}><IconAgent size={14} />{tone === 'agent' && <span className="inbox-badge done"><IconCheck size={8} /></span>}</span>;
    }
    const tile = (tone = '') => <span className={`inbox-sys${tone ? ' ' + tone : ''}`}>{describe(n).icon}</span>;
    if (n.type === 'slaBreached') return tile('urgent');
    if (n.type === 'loopFailed') return <span className="inbox-sys stop"><IconLoop size={12} /></span>;
    if (n.type === 'issueReminder' || n.type === 'projectUpdateReminder' || n.type === 'initiativeUpdateReminder' || n.type === 'updatesDigest') return tile();
    // several people: the newest two, overlapped in the same 20px slot, so every row's text lines up
    if (actors.length > 1) return <span className="inbox-pair" title={actors.map(a => a.name).join(', ')}><Avatar user={actors[0]} size={15} /><Avatar user={actors[1]} size={15} /></span>;
    if (actors.length === 1) {
      const mark = n.type === 'prActivity' ? <PrIcon state={prStateOfNotice(n.body)} size={9} title="Pull request" /> : describe(n, 9).icon;
      return <span className="inbox-av"><Avatar user={actors[0]} size={20} /><span className={`inbox-badge${n.type === 'issueMentioned' ? ' mention' : ''}`}>{mark}</span></span>;
    }
    return tile();
  };
  /** line two: who did what, as one sentence */
  const whoWhat = (row: Row): React.ReactNode => {
    const n = row.lead;
    const actors = row.actors.map(a => snap.users.find(u => u.id === a)).filter(Boolean) as typeof snap.users;
    if (n.type === 'issueReminder') return 'Reminder you set';
    if (n.type === 'projectUpdateReminder' || n.type === 'updatesDigest') return n.body;
    if (n.type === 'initiativeUpdateReminder') return n.body.split('|').slice(1).join('|');
    if (n.type === 'systemUpdate') { const j = parseJoined(n); return j ? `New member${j.teams ? `, added to ${j.teams}` : ''}` : 'Workspace notice'; }
    if (n.type === 'loopFailed') return n.body;
    const target = updateTarget(snap, n);
    if (isAgent(n.type) && !actors.length) return <><b>Agent</b> {describe(n).what}</>;
    return <>{actors[0] ? <><b>{nameOf(actors[0])}</b>{actors.length === 2 ? <> and <b>{nameOf(actors[1])}</b></> : actors.length > 2 ? ` and ${actors.length - 1} others` : ''} </> : null}{target?.initiative ? 'posted an initiative update' : describe(n).what}</>;
  };
  /** what was said, when there's text worth showing (stored previews are plain text; rows written
   *  before that may still hold markdown) */
  const excerptOf = (row: Row): string => {
    const n = row.lead;
    if (n.type === 'issueCommented' || n.type === 'issueMentioned' || n.type === 'issueReplied') return plainText(n.body);
    if (isAgent(n.type)) return plainText(n.body.slice(n.body.indexOf(':') + 1));
    if ((n.type === 'projectIssueAdded' || n.type === 'projectIssueClosed' || n.type === 'projectUpdate') && n.body) { const t = updateTarget(snap, n); return plainText(t ? t.excerpt : n.body.replace(/^(Completed|Canceled): /, '')); }
    return '';
  };
  const unreadCount = rows.filter(r => r.unread).length;
  // reading the last unread row here is worth a word; opening an inbox that was already read isn't
  // the whole inbox, not what the Type/From filters leave showing: hiding the unread rows isn't reading them
  const allUnread = useMemo(() => inboxRows(snap.notifications.filter(n => (!statusMuted || n.type !== 'issueStatusChanged') && (!n.snoozedUntil || n.snoozedUntil <= now))).filter(r => r.unread).length, [snap.notifications, statusMuted, now]);
  const readAllNow = useEarned(allUnread === 0);
  const emptiedNow = useEarned(rows.length === 0);
  useEffect(() => {
    if (!readAllNow || snap.notifications.length === 0) return;
    const lines = ['Everything is read. Enjoy the quiet.', 'All read. Back to the good stuff.', 'Nothing new. Go build something.'];
    useApp.getState().toast({ title: 'Inbox zero', line: lines[Math.floor(Math.random() * lines.length)] });
  }, [readAllNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const senders = [...new Set(snap.notifications.map(n => n.actorId).filter(Boolean))] as string[];

  return (
    <div className="inbox">
      <div className="inbox-list">
        <TopBar crumbs={[{ label: 'Inbox' }]} more={<>
          <MenuItem icon={<IconCheck size={14} />} label="Mark all as read" onClick={async () => { await api.markAllNotificationsRead(); await refresh(); }} />
          <MenuItem icon={<IconTrash size={14} />} label="Delete all read" right={<span className="mi-kbd">⇧⌫</span>} onClick={async () => { await api.deleteReadNotifications(); await refresh(); }} />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete all" confirm={`Delete all ${snap.notifications.length}?`}
            onClick={async () => { const n = snap.notifications.length; try { await Promise.all(snap.notifications.map(x => api.deleteNotification(x.id))); } finally { await refresh(); } toast({ title: `Deleted ${n} notification${n === 1 ? '' : 's'}` }); }} />
          <MenuSep />
          <MenuItem icon={<IconSettings size={14} />} label="Notification settings" onClick={() => navigate('/settings/notifications')} />
        </>} right={<>
          {unreadCount > 0 && <button className="icon-btn" title="Mark all as read" onClick={async () => { await api.markAllNotificationsRead(); await refresh(); }}><IconCheck size={15} /></button>}
          <button className={`icon-btn${prefs.types.length || prefs.from.length ? ' on' : ''}`} title="Filter" onClick={filterMenu.open}><IconFilter size={15} /></button>
          <button className="icon-btn" title="Display options" onClick={displayMenu.open}><IconDisplay size={15} /></button>
        </>} />
        {(prefs.types.length > 0 || prefs.from.length > 0) && (
          <div className="filterbar">
            {prefs.types.length > 0 && <span className="fpill"><span className="fp-part fp-field">Type</span><span className="fp-part fp-vals">{prefs.types.map(t => TYPE_LABELS[t] ?? t).join(', ')}</span><button className="fp-part fp-x" onClick={() => patchPrefs({ types: [] })}><IconClose size={11} /></button></span>}
            {prefs.from.length > 0 && <span className="fpill"><span className="fp-part fp-field">From</span><span className="fp-part fp-vals">{prefs.from.map(id => snap.users.find(u => u.id === id)?.name ?? 'App').join(', ')}</span><button className="fp-part fp-x" onClick={() => patchPrefs({ from: [] })}><IconClose size={11} /></button></span>}
          </div>
        )}
        <div className="subnav inbox-tabs" role="tablist" aria-label="Inbox views">
          {(['all', 'needs', 'agents'] as const).map(v => (
            <button key={v} role="tab" aria-selected={view === v} className={`seg${view === v ? ' selected' : ''}`} onClick={() => patchPrefs({ view: v })}>
              {v === 'needs' && needsUnread && <span className="inbox-ask-dot" aria-hidden="true" />}
              {VIEW_LABELS[v]}<span className="seg-n">{viewCount[v]}</span>
            </button>
          ))}
        </div>
        <div className="content">
          {rows.length === 0 && (prefs.types.length > 0 || prefs.from.length > 0) && snap.notifications.length > 0 ? (
            <EmptyState kind="filtered" word="No matches" illo="inbox" title="No notifications match these filters"
              desc={<>{snap.notifications.length} notification{snap.notifications.length === 1 ? ' is' : 's are'} hidden by the type or sender filter.</>}
              actions={<button className="btn secondary" onClick={() => patchPrefs({ types: [], from: [] })}>Clear filters</button>} />
          ) : rows.length === 0 && view !== 'all' && allRows.length > 0 ? (
            <EmptyState kind="done" word={view === 'needs' ? 'Nothing waiting' : 'No reports'} illo="inbox"
              title={view === 'needs' ? 'Nothing is waiting on you' : 'No agent reports'}
              desc={view === 'needs' ? 'Mentions, replies, reminders, reviews and agents that need an answer show up here.' : 'When an agent finishes or gets stuck on one of your issues, it reports here.'}
              actions={<button className="btn secondary" onClick={() => patchPrefs({ view: 'all' })}>Show all {allRows.length}</button>} />
          ) : rows.length === 0 ? (
            <EmptyState kind="done" word={emptiedNow ? 'Inbox zero' : 'Caught up'} illo="inbox"
              dot={emptiedNow && <Burst count={12} reach={46} />}
              title={emptiedNow ? 'Inbox zero' : 'You’re all caught up'}
              desc={emptiedNow ? 'Everything is read and cleared away. Enjoy the quiet.' : 'Assignments, mentions, agent reports and reviews on issues you follow land here.'} />
          ) : sectioned.map(({ r: row, sec }, k) => {
            const n = row.lead;
            const header = sec && (k === 0 || sectioned[k - 1].sec !== sec) ? sec : null;
            const issue = issueOf(n);
            const idx = navigable.indexOf(row);
            const isSel = idx >= 0 && idx === cursor;
            const excerpt = excerptOf(row);
            const project = !issue && n.projectId ? snap.projects.find(p => p.id === n.projectId) : undefined;
            const doc = n.type === 'docChanged' ? { id: n.body.split('|')[0], title: n.body.split('|').slice(1).join('|') } : null;
            const ini = n.type === 'initiativeUpdateReminder' ? snap.initiatives.find(i => i.id === n.body.split('|')[0]) : updateTarget(snap, n)?.initiative;
            const addedTo = n.type === 'teamMemberAdded' ? teamOf(n) : null;
            const joined = parseJoined(n);
            const projTitle: React.ReactNode = doc ? <span className="inbox-ini"><IconDoc size={12} />{doc.title}</span> : addedTo ? addedTo.name : joined ? `${joined.who} joined ${joined.where}` : n.type === 'accessRequested' ? 'Request' : ini ? <span className="inbox-ini"><InitiativeIcon ini={ini} size={12} />{ini.name}</span> : project ? `${project.icon} ${project.name}` : n.type === 'updatesDigest' ? 'Project updates summary' : n.type === 'loopFailed' ? 'Loop failed' : '';
            const snoozed = n.snoozedUntil && n.snoozedUntil > now;
            const k2 = keyOf(n);
            return (
              <div key={row.key}>
              {header && <div className="inbox-group"><span>{header}</span><span className="count">{sectioned.filter(x => x.sec === sec).length}</span></div>}
              <div
                className={`inbox-row${row.unread ? ' unread' : ''}${(isSel && !openRow) || openRow?.lead.id === n.id ? ' selected' : ''}${idx < 0 ? ' static' : ''}${snoozed ? ' snoozed' : ''}`}
                onClick={() => { if (idx >= 0) { setPicked(row.key); useCursor.setState({ index: idx }); setOpenRow(null); } else { setOpenRow(row); if (row.unread) void markRead(row, true); } }}
                onDoubleClick={() => { const to = pathOf(n); if (to) navigate(to); }}
                onContextMenu={e => { setMenuRow(row); rowMenu.open(e); }}>
                <span className="inbox-lead">{leadOf(row)}</span>
                <div className="inbox-body">
                  <div className="inbox-line1">
                    {k2 && <span className="inbox-key">{k2}</span>}
                    <span className="inbox-title">{issue ? issue.title : projTitle || n.body || 'Issue no longer exists'}</span>
                    <span className="rel-time" title={snoozed ? undefined : dateTime(n.createdAt)}>{snoozed ? <><IconClock size={11} />{fmt(new Date(n.snoozedUntil!))}</> : relTime(rowAt(row))}</span>
                  </div>
                  <div className="inbox-line2">
                    <span className="inbox-what">
                      {whoWhat(row)}
                      {excerpt && <>: <span className="inbox-excerpt">{excerpt}</span></>}
                      {row.count > 1 && <span className="inbox-count"> · {row.count} updates</span>}
                    </span>
                  </div>
                </div>
                {/* hover: the time steps aside for the three triage keys */}
                <span className="inbox-qa" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
                  <button className="icon-btn" title={row.unread ? 'Mark as read (U)' : 'Mark as unread (U)'} aria-label={row.unread ? 'Mark as read' : 'Mark as unread'} onClick={() => void markRead(row, row.unread)}><IconCheck size={13} /></button>
                  <button className="icon-btn" title="Snooze (H)" aria-label="Snooze" onClick={e => { setMenuRow(row); snoozeMenu.setAnchor(e.currentTarget.getBoundingClientRect()); }}><IconClock size={13} /></button>
                  <button className="icon-btn" title="Delete (⌫)" aria-label="Delete notification" onClick={() => void remove(row)}><IconTrash size={13} /></button>
                </span>
              </div>
              </div>
            );
          })}
          {/* a new workspace's inbox is nearly empty: say what will land here, so it doesn't look broken */}
          {view === 'all' && !prefs.types.length && !prefs.from.length && rows.length > 0 && snap.notifications.length <= 3 && (
            <div className="inbox-lands">
              <div className="inbox-lands-line" aria-hidden="true"><span /></div>
              <div className="inbox-lands-title">Your inbox fills as work starts</div>
              <div className="inbox-lands-desc">Anything that needs you lands here first.</div>
              {([
                [<IconAssignArrow size={12} />, 'Assignments', notifyPrefs.assigned !== false],
                [<IconMention size={12} />, 'Mentions and replies', notifyPrefs.mentions !== false],
                [<IconComment size={12} />, 'Comments on issues you follow', notifyPrefs.comments !== false],
                [<IconAgent size={12} />, 'Agents that finish or need an answer', true],
                [<IconCycle size={12} />, 'Status changes', notifyPrefs.statusChanged !== false],
              ] as Array<[React.ReactNode, string, boolean]>).map(([icon, label, on]) => (
                <div key={label} className="inbox-land"><span className="inbox-sys">{icon}</span><span>{label}</span><span className="inbox-land-on">{on ? 'On' : 'Off'}</span></div>
              ))}
              <div><button className="btn secondary sm" onClick={() => navigate('/settings/notifications')}>Notification settings</button></div>
            </div>
          )}
        </div>
        <div className="inbox-keys" aria-hidden="true">
          <span><span className="kbd">J</span><span className="kbd">K</span>move</span>
          <span><span className="kbd">U</span>read</span>
          <span><span className="kbd">H</span>snooze</span>
          <span><span className="kbd">⌫</span>delete</span>
          <span><span className="kbd">⇧</span><span className="kbd">⌫</span>clear read</span>
        </div>
      </div>
      <div className="inbox-preview">
        {openRow ? <ProjectNotice n={openRow.lead} /> : selectedIssue && selected ? (
          <IssueDetail key={selectedIssue.id} issue={selectedIssue} banner={
            <WhyBand row={selected} lead={leadOf(selected)} what={whoWhat(selected)} excerpt={excerptOf(selected)}
              onSnooze={el => { setMenuRow(selected); snoozeMenu.setAnchor(el.getBoundingClientRect()); }}
              onDelete={() => void remove(selected)} />
          } />
        ) : (
          <EmptyState kind="holding" size="pane" illo="inbox" title={rows.length ? 'No notification selected' : 'Nothing to preview'}
            desc={rows.length > 0 && <><span className="kbd">J</span> <span className="kbd">K</span> to move · <span className="kbd">U</span> read/unread · <span className="kbd">⌫</span> delete · <span className="kbd">H</span> snooze</>} />
        )}
      </div>

      {rowMenu.anchor && menuRow && (
        <Menu anchor={rowMenu.anchor} onClose={rowMenu.close} width={230}>
          {(to => to && <>
            <MenuItem icon={<IconExternal size={14} />} label="Open" onClick={() => navigate(to)} />
            <MenuItem icon={<IconLink size={14} />} label="Copy link" onClick={async () => { if (await copyText(`${location.origin}/#${to}`)) toast({ title: 'Copied link' }); }} />
            {menuRow.lead.issueId && snap.subscriptions.some(x => x.issueId === menuRow.lead.issueId && x.userId === snap.currentUser.id) &&
              <MenuItem icon={<IconBell size={14} />} label="Unsubscribe from issue" onClick={() => void toggleSubscription(menuRow.lead.issueId!)} />}
            <MenuSep />
          </>)(pathOf(menuRow.lead))}
          <MenuItem icon={<IconCheck size={14} />} label={menuRow.unread ? 'Mark as read' : 'Mark as unread'} right={<span className="mi-kbd">U</span>} onClick={() => void markRead(menuRow, menuRow.unread)} />
          <MenuItem icon={<IconTrash size={14} />} label="Delete notification" right={<span className="mi-kbd">⌫</span>} onClick={() => void remove(menuRow)} />
          <MenuSub icon={<IconClock size={14} />} label="Snooze" right={<span className="mi-kbd">H</span>} width={300}>
            <SnoozeItems onPick={d => void snooze(menuRow, d)} />
          </MenuSub>
          {menuRow.lead.snoozedUntil && menuRow.lead.snoozedUntil > now && <MenuItem icon={<IconClock size={14} />} label="Unsnooze" onClick={async () => { for (const id of menuRow.ids) await api.snoozeNotification(id, null); await refresh(); }} />}
        </Menu>
      )}
      {snoozeMenu.anchor && menuRow && (
        <Menu anchor={snoozeMenu.anchor} onClose={snoozeMenu.close} width={300}>
          <SnoozeItems onPick={d => void snooze(menuRow, d)} />
        </Menu>
      )}
      {filterMenu.anchor && (
        <Menu anchor={filterMenu.anchor} onClose={filterMenu.close} width={250}>
          {TYPE_GROUPS.map(([group, types], gi) => (
            <div key={group}>
              {gi > 0 && <MenuSep />}
              <div className="menu-header"><span>{group}</span></div>
              {types.map(t => (
                <button key={t} className="menu-item" onClick={e => { e.stopPropagation(); patchPrefs({ types: prefs.types.includes(t) ? prefs.types.filter(x => x !== t) : [...prefs.types, t] }); }}>
                  <span className={`mi-check${prefs.types.includes(t) ? ' on' : ''}`}>{prefs.types.includes(t) && <IconCheck size={11} />}</span>
                  <span className="mi-label">{TYPE_LABELS[t]}</span>
                </button>
              ))}
            </div>
          ))}
          {senders.length > 0 && <><MenuSep /><div className="menu-header"><span>From</span></div></>}
          {senders.map(id => {
            const u = snap.users.find(x => x.id === id);
            return (
              <button key={id} className="menu-item" onClick={e => { e.stopPropagation(); patchPrefs({ from: prefs.from.includes(id) ? prefs.from.filter(x => x !== id) : [...prefs.from, id] }); }}>
                <span className={`mi-check${prefs.from.includes(id) ? ' on' : ''}`}>{prefs.from.includes(id) && <IconCheck size={11} />}</span>
                <span className="mi-icon"><Avatar user={u} size={16} /></span>
                <span className="mi-label">{u?.name ?? 'Someone'}</span>
              </button>
            );
          })}
        </Menu>
      )}
      {displayMenu.anchor && (
        <Menu anchor={displayMenu.anchor} onClose={displayMenu.close} width={300}>
          <div className="dopts">
            <div className="dopts-row"><span>Enable priority inbox</span><button className={`switch${prefs.priority ? ' on' : ''}`} onClick={() => patchPrefs({ priority: !prefs.priority })}><span /></button></div>
            <div className="dopts-sep" />
            <div className="dopts-row"><span>Group unreads by</span>
              <span className="seg-pair">
                <button className={`seg${prefs.groupUnreads === 'none' ? ' selected' : ''}`} onClick={() => patchPrefs({ groupUnreads: 'none' })}>No grouping</button>
                <button className={`seg${prefs.groupUnreads === 'focus' ? ' selected' : ''}`} onClick={() => patchPrefs({ groupUnreads: 'focus' })}>Focus</button>
              </span>
            </div>
            <div className="dopts-row"><span>Ordering</span>
              <span className="seg-pair">
                <button className={`seg${prefs.order === 'newest' ? ' selected' : ''}`} onClick={() => patchPrefs({ order: 'newest' })}>Newest</button>
                <button className={`seg${prefs.order === 'oldest' ? ' selected' : ''}`} onClick={() => patchPrefs({ order: 'oldest' })}>Oldest</button>
              </span>
            </div>
            <div className="dopts-sep" />
            <div className="dopts-row"><span>Show snoozed</span><button className={`switch${prefs.showSnoozed ? ' on' : ''}`} onClick={() => patchPrefs({ showSnoozed: !prefs.showSnoozed })}><span /></button></div>
            <div className="dopts-row"><span>Show status changes</span><button className={`switch${statusMuted ? '' : ' on'}`} aria-label="Show status changes" onClick={() => void setStatusMuted(!statusMuted)}><span /></button></div>
            <div className="dopts-row"><span>Show unread first</span><button className={`switch${prefs.unreadFirst ? ' on' : ''}`} onClick={() => patchPrefs({ unreadFirst: !prefs.unreadFirst })}><span /></button></div>
          </div>
        </Menu>
      )}
    </div>
  );
}

/** what a 'projectUpdate' notification points at. Initiative updates reuse that type with no
 *  projectId and a "New update on <name>: <body>" text, so the initiative is matched by name */
function updateTarget(snap: Snapshot, n: Notification) {
  if (n.type !== 'projectUpdate') return null;
  const near = <T extends { createdAt: string }>(list: T[]) =>
    list.slice().sort((a, b) => Math.abs(Date.parse(a.createdAt) - Date.parse(n.createdAt)) - Math.abs(Date.parse(b.createdAt) - Date.parse(n.createdAt)))[0];
  const p = n.projectId ? snap.projects.find(x => x.id === n.projectId) : undefined;
  if (p) {
    const update = near(snap.projectUpdates.filter(u => u.projectId === p.id));
    return { project: p, initiative: undefined, update, excerpt: n.body.replace(`New update on ${p.name}: `, '') };
  }
  const ini = snap.initiatives.filter(i => n.body.startsWith(`New update on ${i.name}: `)).sort((a, b) => b.name.length - a.name.length)[0];
  if (!ini) return null;
  const update = near(snap.initiativeUpdates.filter(u => u.initiativeId === ini.id));
  return { project: undefined, initiative: ini, update, excerpt: n.body.slice(`New update on ${ini.name}: `.length) };
}

/** above an issue in the preview: the notification itself, on the line, with its triage keys. The
 *  register under it turns orange when the row waits on you and red when an agent stopped */
function WhyBand({ row, lead, what, excerpt, onSnooze, onDelete }: {
  row: Row; lead: React.ReactNode; what: React.ReactNode; excerpt: string; onSnooze: (el: HTMLElement) => void; onDelete: () => void;
}) {
  const n = row.lead;
  const tone = n.type === 'agentBlocked' ? (n.body.startsWith('Stopped') ? ' stop' : ' ask') : n.type === 'slaBreached' ? ' ask' : '';
  return (
    <div className={`inbox-why${tone}`} data-inbox-why>
      <span className="inbox-why-lead">{lead}</span>
      <div className="inbox-why-body">
        <div className="inbox-why-head"><span className="inbox-why-what">{what}</span><span className="rel-time" title={dateTime(n.createdAt)}>{relTime(rowAt(row))}</span></div>
        {excerpt && <div className="inbox-why-quote">{excerpt}</div>}
      </div>
      <div className="inbox-why-keys">
        <button className="icon-btn" title="Snooze (H)" aria-label="Snooze" onClick={e => onSnooze(e.currentTarget)}><IconClock size={14} /></button>
        <button className="icon-btn" title="Delete (⌫)" aria-label="Delete notification" onClick={onDelete}><IconTrash size={14} /></button>
      </div>
    </div>
  );
}

/** one posted update as a card: who, health, when, the body and where to go */
function UpdateCard({ title, update, onOpen, openLabel }: {
  title: React.ReactNode; update: { body: string; health: Parameters<typeof healthColor>[0] | null; userId: string; createdAt: string }; onOpen: () => void; openLabel: string;
}) {
  const snap = useApp(s => s.snap)!;
  const author = snap.users.find(x => x.id === update.userId);
  return (
    <article className="summary-update" data-summary-update>
      <header>
        <span className="summary-proj">{title}</span>
        {update.health && <span className="summary-health"><span className="health-dot" style={{ background: healthColor(update.health) }} />{healthLabel(update.health)}</span>}
        <span style={{ flex: 1 }} />
        <Avatar user={author} size={18} /><span className="summary-meta">{author?.name} · {relTime(update.createdAt)}</span>
      </header>
      <Markdown text={update.body} />
      <div><button className="btn secondary sm" onClick={onOpen}>{openLabel}</button></div>
    </article>
  );
}

/** the updates a summary covers, as the server counted them: posted since the person's previous
 *  summary (or one schedule period back) on projects they lead, are a member of, or follow */
function summaryUpdates(snap: Snapshot, n: Notification) {
  const me = snap.currentUser.id;
  const prev = snap.notifications.filter(x => x.type === 'updatesDigest' && x.createdAt < n.createdAt).map(x => x.createdAt).sort().pop();
  const days = snap.workspace.preferences.updatesSummary === 'daily' ? 1 : 7;
  const since = prev ?? new Date(new Date(n.createdAt).getTime() - days * 86400000).toISOString();
  return snap.projectUpdates
    .filter(u => u.createdAt > since && u.createdAt <= n.createdAt)
    .filter(u => {
      const p = snap.projects.find(x => x.id === u.projectId);
      return !!p && (p.leadId === me || p.memberIds.includes(me) || snap.projectSubscriptions.some(s => s.projectId === p.id && s.userId === me && s.updates));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** preview for a notification about a project (or a project updates summary) */
function ProjectNotice({ n }: { n: Notification }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const p = n.projectId ? snap.projects.find(x => x.id === n.projectId) : undefined;
  const target = updateTarget(snap, n);
  const issue = n.issueId ? snap.issues.find(i => i.id === n.issueId) : undefined;
  if (n.type === 'docChanged') {
    const [docId, ...rest] = n.body.split('|');
    return (
      <div className="proj-notice">
        <div className="pn-title"><IconDoc size={16} />{rest.join('|')}</div>
        <div className="pn-body">{snap.users.find(u => u.id === n.actorId)?.name ?? 'Someone'} edited this document{p ? ` in ${p.name}` : ''}.</div>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn primary sm" onClick={() => navigate(`/docs/${docId}`)}>Open document</button></div>
      </div>
    );
  }
  if (n.type === 'accessRequested') {
    const [path, ...what] = n.body.split('|');
    return (
      <div className="proj-notice">
        <div className="pn-title">{snap.users.find(u => u.id === n.actorId)?.name ?? 'Someone'} asked you</div>
        <div className="pn-body">{what.join('|')}</div>
        {path && <div style={{ display: 'flex', gap: 8 }}><button className="btn primary sm" onClick={() => navigate(path)}>Open settings</button></div>}
      </div>
    );
  }
  if (n.type === 'teamMemberAdded') {
    const [teamId, ...name] = n.body.split('|');
    const t = snap.teams.find(x => x.id === teamId);
    return (
      <div className="proj-notice">
        <div className="pn-title">{t ? <>{teamDisplayIcon(t)}{t.name}</> : name.join('|')}</div>
        <div className="pn-body">{snap.users.find(u => u.id === n.actorId)?.name ?? 'Someone'} added you to this team.</div>
        {t && <div style={{ display: 'flex', gap: 8 }}><button className="btn primary sm" onClick={() => navigate(`/team/${t.key}/overview`)}>Open team</button></div>}
      </div>
    );
  }
  if (n.type === 'updatesDigest') {
    const updates = summaryUpdates(snap, n);
    return (
      <div className="proj-notice">
        <div className="pn-title"><IconUpdates size={16} />Project updates summary</div>
        <div className="pn-body">{n.body}</div>
        {updates.map(u => {
          const up = snap.projects.find(x => x.id === u.projectId)!;
          return <UpdateCard key={u.id} title={<><span>{up.icon}</span>{up.name}</>} update={u} openLabel="Open project" onOpen={() => navigate(`/projects/${up.id}`)} />;
        })}
      </div>
    );
  }
  if (target) {
    const { project: tp, initiative: ti, update } = target;
    const title = tp ? <><span>{tp.icon}</span>{tp.name}</> : <><InitiativeIcon ini={ti!} size={16} />{ti!.name}</>;
    const open = () => navigate(tp ? `/projects/${tp.id}` : `/initiatives/${ti!.id}`);
    const openLabel = tp ? 'Open project' : 'Open initiative';
    const who = snap.users.find(u => u.id === n.actorId)?.name ?? 'Someone';
    return (
      <div className="proj-notice">
        <div className="pn-title">{title}</div>
        <div className="pn-body">{who} posted {tp ? 'a project' : 'an initiative'} update.</div>
        {update ? <UpdateCard title={tp ? 'Project update' : 'Initiative update'} update={update} openLabel={openLabel} onOpen={open} />
          : <><div className="summary-update">{target.excerpt}</div><div><button className="btn secondary sm" onClick={open}>{openLabel}</button></div></>}
      </div>
    );
  }
  if (n.type === 'systemUpdate') {
    // someone joined: the person, not a "Project" heading over the server's sentence
    const j = parseJoined(n);
    const who = n.actorId ? snap.users.find(u => u.id === n.actorId) : undefined;
    if (j) return (
      <div className="proj-notice">
        <div className="pn-person"><Avatar user={who} size={40} /><div><div className="pn-title">{who?.name ?? j.who}</div><div className="pn-body">Joined {j.where} {relTime(n.createdAt)}</div></div></div>
        <dl className="pn-facts">
          {j.teams && <><dt>Teams</dt><dd>{j.teams}</dd></>}
          <dt>Role</dt><dd>{who?.admin ? 'Admin' : 'Member'}</dd>
          <dt>Assigned</dt><dd>{(c => c ? `${c} issue${c === 1 ? '' : 's'}` : 'No issues yet')(snap.issues.filter(i => i.assigneeId === who?.id && !i.archivedAt).length)}</dd>
        </dl>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn primary sm" onClick={() => navigate('/members')}>Open members</button></div>
      </div>
    );
    return (
      <div className="proj-notice">
        <div className="pn-title"><IconBell size={16} />Workspace notice</div>
        <div className="pn-body">{n.body}</div>
      </div>
    );
  }
  if (n.type === 'loopFailed') {
    const [name, ...detail] = n.body.split(': ');
    return (
      <div className="proj-notice">
        <div className="pn-title"><IconLoop size={16} />{name} didn’t run</div>
        <div className="pn-body pn-code">{detail.join(': ') || n.body}</div>
      </div>
    );
  }
  if (n.type === 'initiativeUpdateReminder') {
    const [iniId, ...rest] = n.body.split('|');
    const ini = snap.initiatives.find(i => i.id === iniId);
    return (
      <div className="proj-notice">
        <div className="pn-title">{ini ? <><InitiativeIcon ini={ini} size={16} />{ini.name}</> : 'Initiative'}</div>
        <div className="pn-body">{rest.join('|')}</div>
        {ini && <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary sm" onClick={() => navigate(`/initiatives/${ini.id}/updates`, { state: { compose: true } })}>Write update</button>
          <button className="btn secondary sm" onClick={() => navigate(`/initiatives/${ini.id}`)}>Open initiative</button>
        </div>}
      </div>
    );
  }
  return (
    <div className="proj-notice">
      <div className="pn-title">{p ? <><span>{p.icon}</span>{p.name}</> : 'Project'}</div>
      <div className="pn-body">{n.body}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {p && <button className="btn primary sm" onClick={() => navigate(`/projects/${p.id}`)}>Open project</button>}
        {issue && <button className="btn secondary sm" onClick={() => navigate(`/issue/${snap.teams.find(t => t.id === issue.teamId)?.key}-${issue.number}`)}>Open issue</button>}
        {n.type === 'projectUpdateReminder' && p && <button className="btn secondary sm" onClick={() => navigate(`/projects/${p.id}`)}>Write update</button>}
      </div>
    </div>
  );
}
