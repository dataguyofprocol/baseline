// My work: the home page. One screen across every team you're on, in the order a morning goes:
// what needs you (reviews, mentions, an agent that finished or got stuck, triage), what you're in
// the middle of, and what's next. The inbox stays one click away as "all notifications".
import { useEffect, useMemo, useState } from 'react';
import { Burst } from './ui.js';
import { useEarned, reducedMotion } from './motion.js';
import { useNavigate } from 'react-router-dom';
import { useApp, useCursor, registerVisibleList, relTime, refresh, dateTime } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { IssueRow } from './IssueViews.js';
import { StateIcon, Avatar } from './pickers.js';
import { IconCheck, IconChevronRight, IconInbox, IconTriage } from './icons.js';
import type { Issue, Notification } from '../../src/core/types.js';
import { needsYou } from '../../src/core/inbox.js';
import { EmptyState } from './EmptyState.js';

/** A greeting that knows the hour and the day of the week: one quiet line, no banner. */
function greeting(first: string, d = new Date()): string {
  const h = d.getHours(), day = d.getDay();
  if (h >= 22 || h < 5) return `Working late, ${first}`;
  if (day === 1 && h < 12) return `Fresh week, ${first}`;
  if (day === 5 && h >= 12) return `Happy Friday, ${first}`;
  if (day === 0 || day === 6) return `Weekend mode, ${first}`;
  return `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${first}`;
}

/** Seven bars, one per day ending today, for the issues you closed. Today's bar is the brand. */
function WeekBars({ closed }: { closed: Issue[] }) {
  const days = Array.from({ length: 7 }, (_, k) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - k));
    return d;
  });
  const counts = days.map(d => {
    const next = new Date(d); next.setDate(d.getDate() + 1);
    return closed.filter(i => { const t = new Date(i.completedAt ?? i.updatedAt); return t >= d && t < next; }).length;
  });
  const max = Math.max(1, ...counts);
  const label = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' });
  return (
    <span className="mw-bars" aria-hidden="true" title={counts.map((n, k) => `${label(days[k]!)} ${n}`).join(' · ')}>
      {counts.map((n, k) => (
        <i key={k} className={[k === 6 && 'today', !n && 'zero'].filter(Boolean).join(' ') || undefined}
          style={{ height: n ? 6 + Math.round((n / max) * 10) : 4, animationDelay: `${k * 40}ms` }} />
      ))}
    </span>
  );
}

/** Urgent first, No priority last (0 is "none") */
const byPriority = (a: Issue, b: Issue) => (a.priority || 5) - (b.priority || 5) || a.sortOrder - b.sortOrder;

export function MyWorkPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const me = snap.currentUser.id;
  const [closedOpen, setClosedOpen] = useState(false);
  const now = new Date().toISOString();
  const typeOf = (i: Issue) => snap.states.find(s => s.id === i.stateId)?.type;
  const keyOf = (i: Issue) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;

  const mine = useMemo(() => snap.issues.filter(i => i.assigneeId === me && !i.archivedAt && !i.deletedAt), [snap.issues, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const started = mine.filter(i => typeOf(i) === 'started').sort(byPriority);
  const upNext = mine.filter(i => typeOf(i) === 'unstarted').sort(byPriority);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const closed = mine.filter(i => (typeOf(i) === 'completed' || typeOf(i) === 'canceled') && (i.completedAt ?? i.updatedAt) > weekAgo)
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));

  // rows marked done here: they slide out at once and stay gone while the server catches up
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  // one row per issue (its newest ask), so an agent run or a thread reads as one thing to do
  const asks = useMemo(() => {
    const seen = new Map<string, Notification[]>();
    for (const n of snap.notifications) {
      if (n.readAt || cleared.has(n.id) || (n.snoozedUntil && n.snoozedUntil > now) || !needsYou(n)) continue;
      const k = n.issueId ?? n.id;
      seen.set(k, [...(seen.get(k) ?? []), n]);
    }
    return [...seen.values()].map(ns => ns.sort((a, b) => b.createdAt.localeCompare(a.createdAt))).sort((a, b) => b[0]!.createdAt.localeCompare(a[0]!.createdAt));
  }, [snap.notifications, cleared]); // eslint-disable-line react-hooks/exhaustive-deps
  // an issue that needs you (say, an agent finished it for your review) shows once, up there
  const askIds = new Set(asks.map(ns => ns[0]!.issueId).filter(Boolean));
  const inProgress = started.filter(i => !askIds.has(i.id));
  // triage waiting on the teams you're on
  const triage = snap.teams.filter(t => t.memberIds.includes(me) && t.triageEnabled).map(t => {
    const st = snap.states.find(s => s.teamId === t.id && s.type === 'triage');
    return { team: t, count: st ? snap.issues.filter(i => i.stateId === st.id && !i.deletedAt).length : 0 };
  }).filter(x => x.count > 0);

  // J/K and the issue shortcuts run over the two work lists, top to bottom
  const listed = useMemo(() => [...inProgress, ...upNext], [inProgress.map(i => i.id).join(), upNext.map(i => i.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const cursor = useCursor(s => s.index);
  useEffect(() => { registerVisibleList(listed, ''); }, [listed]);
  useEffect(() => () => useCursor.getState().reset(), []);

  const done = async (ns: Notification[], animate = true) => {
    const ids = ns.map(n => n.id);
    const write = Promise.all(ids.map(id => api.markNotificationRead(id)));
    if (animate && !reducedMotion()) {
      setLeaving(l => new Set([...l, ns[0]!.id]));
      await new Promise(r => setTimeout(r, 240));
    }
    setCleared(c => new Set([...c, ...ids]));
    try { await write; } catch {
      // the server said no: put the row back and say so
      setCleared(c => new Set([...c].filter(x => !ids.includes(x))));
      setLeaving(l => new Set([...l].filter(x => x !== ns[0]!.id)));
      useApp.getState().toast({ title: 'Couldn’t mark that as read' });
    }
    await refresh();
  };
  const open = async (ns: Notification[]) => {
    const issue = snap.issues.find(i => i.id === ns[0]!.issueId);
    void done(ns, false);
    if (issue) navigate(`/issue/${keyOf(issue)}`);
    // an access request's body is "<settings path>|<what>": open the setting it asks about
    else if (ns[0]!.type === 'accessRequested') navigate(ns[0]!.body.split('|')[0] || '/settings');
    else navigate('/inbox');
  };
  const what = (n: Notification) => {
    const who = snap.users.find(u => u.id === n.actorId)?.name ?? 'Someone';
    switch (n.type) {
      case 'issueMentioned': return `${who} mentioned you`;
      case 'issueReplied': return `${who} replied`;
      case 'issueReminder': return 'Reminder';
      case 'slaBreached': return 'SLA breached';
      case 'accessRequested': return `${who} asked for a change`;
      default: return n.body || 'Needs you';
    }
  };

  const section = (title: string, count: number, children: React.ReactNode, empty: React.ReactNode) => (
    <section className="mw-section">
      <div className="inbox-group">{title}<span key={count} className="count mw-count">{count}</span></div>
      {count ? children : <div className="mw-empty">{empty}</div>}
    </section>
  );
  const row = (i: Issue) => {
    const idx = listed.indexOf(i);
    return <IssueRow key={i.id} issue={i} cursor={idx === cursor} onHover={() => { if (useCursor.getState().index !== idx) useCursor.setState({ index: idx }); }} />;
  };
  const myTeam = snap.teams.find(t => t.memberIds.includes(me)) ?? snap.teams[0];
  const nothing = !asks.length && !triage.length && !inProgress.length && !upNext.length;
  // the last thing waiting on you was answered on this screen: say so, once
  const clearedNow = useEarned(!asks.length && !triage.length);
  const first = snap.currentUser.name.split(/\s+/)[0] || snap.currentUser.name;
  const needCount = asks.length + triage.length;
  const summary = [
    needCount && `${needCount} need${needCount === 1 ? 's' : ''} you`,
    inProgress.length && `${inProgress.length} in progress`,
    upNext.length && `${upNext.length} up next`,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'My work' }]} right={
        <button className="btn ghost sm" onClick={() => navigate('/inbox')}><IconInbox size={13} /> All notifications</button>
      } />
      <div className="content mw">
        <header className="mw-hello">
          <div>
            <h1 className="mw-hello-title">{greeting(first)}</h1>
            {summary && <div className="mw-hello-sub">{summary}</div>}
          </div>
          {closed.length > 0 && (
            <button className="mw-week" onClick={() => setClosedOpen(o => !o)} aria-expanded={closedOpen}
              title={closedOpen ? 'Hide what you closed this week' : 'Show what you closed this week'}>
              <WeekBars closed={closed} />
              <span><b>{closed.length}</b> closed this week</span>
            </button>
          )}
        </header>
        {nothing && (
          <EmptyState kind="done" size="pane" className="mw-empty" illo="inbox" title="Nothing on your plate"
            desc="Issues assigned to you, and anything that needs your answer, show up here across all your teams."
            actions={myTeam && <button className="btn secondary" onClick={() => navigate(`/team/${myTeam.key}/active`)}>See what {myTeam.name} is working on</button>} />
        )}
        {!nothing && section('Needs you', asks.length + triage.length, <>
          {asks.map(ns => {
            const n = ns[0]!;
            const issue = snap.issues.find(i => i.id === n.issueId);
            const st = issue && snap.states.find(s => s.id === issue.stateId);
            const actor = snap.users.find(u => u.id === n.actorId);
            return (
              <div key={n.id} className={`ma-row mw-ask${leaving.has(n.id) ? ' leaving' : ''}`} role="button" tabIndex={0} onClick={() => void open(ns)} onKeyDown={e => { if (e.key === 'Enter') void open(ns); }}>
                {actor ? <Avatar user={actor} size={18} /> : st ? <StateIcon type={st.type} color={st.color} size={14} /> : null}
                {issue && <span className="issue-key">{keyOf(issue)}</span>}
                <span className="ma-title">{issue?.title ?? (n.type === 'accessRequested' ? n.body.split('|').slice(1).join('|') : n.body)}</span>
                <span className="ma-verb">{what(n)}{ns.length > 1 ? ` +${ns.length - 1}` : ''}</span>
                <span className="rel-time" title={dateTime(n.createdAt)}>{relTime(n.createdAt)}</span>
                <button className="icon-btn" title="Done: mark read" aria-label="Mark read" onClick={e => { e.stopPropagation(); void done(ns); }}><IconCheck size={13} /></button>
              </div>
            );
          })}
          {triage.map(({ team, count }) => (
            <button key={team.id} className="ma-row" onClick={() => navigate(`/team/${team.key}/triage`)}>
              <IconTriage size={14} />
              <span className="ma-title">{count} issue{count === 1 ? '' : 's'} to triage in {team.name}</span>
              <IconChevronRight size={12} />
            </button>
          ))}
        </>, clearedNow
          ? <span className="mw-clear"><span className="mw-clear-check"><IconCheck size={11} /><Burst count={8} reach={12} /></span>All clear. Nothing is waiting on you.</span>
          : 'Nothing waiting on you.')}
        {!nothing && section('In progress', inProgress.length, <div className="issue-list">{inProgress.map(row)}</div>, 'Nothing started. Pick something from Up next.')}
        {!nothing && section('Up next', upNext.length, <div className="issue-list">{upNext.map(row)}</div>, 'No Todo issues assigned to you.')}
        {closed.length > 0 && (
          <section className="mw-section">
            <button className="inbox-group mw-toggle" aria-expanded={closedOpen} onClick={() => setClosedOpen(o => !o)}>
              <IconChevronRight size={11} style={{ transform: closedOpen ? 'rotate(90deg)' : undefined }} /> Closed this week<span className="count">{closed.length}</span>
            </button>
            {closedOpen && closed.map((i, k) => {
              const st = snap.states.find(s => s.id === i.stateId);
              return (
                <button key={i.id} className="ma-row mw-closed-row" style={{ animationDelay: `${Math.min(k, 8) * 28}ms` }} onClick={() => navigate(`/issue/${keyOf(i)}`)}>
                  {st && <StateIcon type={st.type} color={st.color} size={14} />}
                  <span className="issue-key">{keyOf(i)}</span>
                  <span className="ma-title">{i.title}</span>
                  <span className="rel-time" title={dateTime(i.completedAt ?? i.updatedAt)}>{relTime(i.completedAt ?? i.updatedAt)}</span>
                </button>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
