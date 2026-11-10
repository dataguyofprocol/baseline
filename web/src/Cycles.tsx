import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, shortDate } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { useMenu, Menu, MenuItem, MenuSep, ConfirmButton, NotFound, Modal, exclusive, useCanConfigure } from './ui.js';
import { Avatar, PriorityIcon, teamDisplayIcon } from './pickers.js';
import { NewCycleModal } from './Settings.js';
import { useViewPrefs, DEFAULT_VIEW_OPTIONS, type ViewOptions } from './IssueViews.js';
import { IssueListBody, ListToolbar, TeamMissingRedirect } from './Views.js';
import { IconCycle, IconMore, IconTrash, IconEdit, IconChevronDown, IconBox, IconTag, IconPanel, IconPlus, IconEstimate, IconCalendar, IconClose } from './icons.js';
import type { Issue, ActivityItem, Snapshot, Cycle, Priority } from '../../src/core/types.js';
import { EmptyState } from './EmptyState.js';

const DAY = 86400000;
type Snap = Snapshot;

function pointsOf(i: Issue, snap: Snap): number {
  const team = snap.teams.find(t => t.id === i.teamId);
  return team?.estimateScale === 'none' ? 1 : i.estimate ?? (team?.estimateCountUnestimated === false ? 0 : 1);
}

function typeAt(issue: Issue, t: number, changes: ActivityItem[], snap: Snap): string | undefined {
  const typeOf = (id: unknown) => snap.states.find(s => s.id === id)?.type;
  let state: unknown = changes.length ? changes[0].data.from ?? issue.stateId : issue.stateId;
  for (const c of changes) {
    if (new Date(c.createdAt).getTime() > t) break;
    state = c.data.to;
  }
  return typeOf(state);
}

function joinedAt(issue: Issue, cycleId: string, activity: ActivityItem[]): number {
  const moves = activity.filter(a => a.issueId === issue.id && a.type === 'cycleChanged' && a.data.to === cycleId);
  return new Date(moves.length ? moves[moves.length - 1].createdAt : issue.createdAt).getTime();
}

export function cycleStats(cycle: Cycle, snap: Snap) {
  const issues = snap.issues.filter(i => i.cycleId === cycle.id);
  const typeOf = (i: Issue) => snap.states.find(s => s.id === i.stateId)?.type;
  let scope = 0, started = 0, done = 0;
  for (const i of issues) {
    const p = pointsOf(i, snap);
    scope += p;
    const t = typeOf(i);
    if (t === 'completed' || t === 'canceled') done += p;
    else if (t === 'started') started += p;
  }
  return { issues, scope, started, done };
}

function cycleStatus(c: Cycle, all: Cycle[]): 'Current' | 'Upcoming' | 'Planned' | 'Completed' {
  const now = new Date().toISOString();
  if (c.startsAt <= now && c.endsAt >= now) return 'Current';
  if (c.endsAt < now) return 'Completed';
  const next = all.filter(x => x.startsAt > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return next?.id === c.id ? 'Upcoming' : 'Planned';
}
const cycleName = (c: Cycle) => c.name || `Cycle ${c.number}`;
function Ring({ pct: p, over }: { pct: number; over?: boolean }) {
  const r = 5.5; const c = 2 * Math.PI * r; const f = Math.min(p, 100) / 100;
  return <svg width="14" height="14" viewBox="0 0 14 14" className="cy-ring"><circle cx="7" cy="7" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="1.6" /><circle cx="7" cy="7" r={r} fill="none" stroke={over ? '#eb5757' : 'var(--brand)'} strokeWidth="1.6" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 7 7)" strokeLinecap="round" /></svg>;
}
function CycleIcon({ status, pct: p }: { status: ReturnType<typeof cycleStatus>; pct: number }) {
  const r = 5.6; const c = 2 * Math.PI * r;
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" className={`cy-glyph ${status.toLowerCase()}`}>
      <circle cx="7.5" cy="7.5" r={r} fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray={status === 'Planned' ? '2 2' : undefined} opacity={status === 'Current' ? 0.35 : 1} />
      {status === 'Current' && <circle cx="7.5" cy="7.5" r={r} fill="none" stroke="var(--brand)" strokeWidth="1.3" strokeDasharray={`${c * Math.max(p, 8) / 100} ${c}`} transform="rotate(-90 7.5 7.5)" />}
      <path d="M6.3 5.2v4.6l3.8-2.3z" fill="currentColor" />
    </svg>
  );
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function BurnUp(props: { cycle: Cycle; height?: number }) {
  const snap = useApp(s => s.snap)!;
  const issues = useMemo(() => snap.issues.filter(i => i.cycleId === props.cycle.id), [snap.issues, props.cycle.id]);
  const start = new Date(props.cycle.startsAt).getTime();
  const end = new Date(props.cycle.endsAt).getTime();
  const days = Math.max(1, Math.round((end - start) / DAY));
  const now = Date.now();
  const series = useMemo(() => {
    const asc = [...snap.activity].reverse();
    const changes = new Map<string, ActivityItem[]>();
    for (const a of asc) if ((a.type === 'stateChanged' || a.type === 'triageAccepted' || a.type === 'triageDeclined') && a.issueId) {
      changes.set(a.issueId, [...(changes.get(a.issueId) ?? []), a]);
    }
    const out: Array<{ t: number; scope: number; started: number; done: number }> = [];
    for (let d = 0; d <= days; d++) {
      const t = Math.min(start + d * DAY, end);
      if (t > now) { out.push({ t: Math.min(now, end), ...lastPoint() }); break; }
      let scope = 0, started = 0, done = 0;
      for (const i of issues) {
        if (joinedAt(i, props.cycle.id, asc) > t && i.createdAt > new Date(t).toISOString()) continue;
        const p = pointsOf(i, snap);
        scope += p;
        const type = typeAt(i, t, changes.get(i.id) ?? [], snap);
        if (type === 'completed' || type === 'canceled') done += p;
        else if (type === 'started') started += p;
      }
      out.push({ t, scope, started: started + done, done });
    }
    function lastPoint() { const st = cycleStats(props.cycle, snap); return { scope: st.scope, started: st.started + st.done, done: st.done }; }
    return out;
  }, [issues, props.cycle, snap, start, end, days, now]);

  const W = 640, H = props.height ?? 150, pad = 6;
  const max = Math.max(1, ...series.map(p => p.scope));
  const x = (t: number) => pad + ((t - start) / (end - start)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2 - 8);
  const path = (k: 'scope' | 'started' | 'done') => series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const last = series[series.length - 1] ?? { scope: 0, started: 0, done: 0, t: start };
  const weekends: Array<[number, number]> = [];
  for (let d = new Date(start); d.getTime() < end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 6) { const s0 = new Date(d); s0.setHours(0, 0, 0, 0); weekends.push([Math.max(start, s0.getTime()), Math.min(end, s0.getTime() + 2 * DAY)]); }
  }
  const mid = start + (end - start) / 2;
  return (
    <div className="burnup">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={`${cycleName(props.cycle)} progress`}>
        <defs>
          <pattern id="bu-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="bu-hatch-line" /></pattern>
        </defs>
        {weekends.map(([a, b], i) => <rect key={i} x={x(a)} y={pad} width={Math.max(0, x(b) - x(a))} height={H - pad * 2} fill="url(#bu-hatch)" />)}
        <line x1={x(start)} y1={y(0)} x2={x(end)} y2={y(last.scope)} className="bu-ideal" />
        <path d={`${path('started')} L${x(last.t)},${y(0)} L${x(start)},${y(0)} Z`} className="bu-started-area" />
        <path d={path('scope')} className="bu-scope" />
        <path d={path('started')} className="bu-started" />
        <path d={path('done')} className="bu-done" />
        {now >= start && now <= end && <>
          <line x1={x(now)} x2={x(now)} y1={pad} y2={H - pad} className="bu-today" />
          <circle cx={x(last.t)} cy={y(last.started)} r="3" className="bu-dot started" />
          <circle cx={x(last.t)} cy={y(last.done)} r="3" className="bu-dot done" />
        </>}
      </svg>
      <div className="bu-axis"><span>{shortDate(props.cycle.startsAt)}</span><span>{shortDate(new Date(mid).toISOString())}</span><span>{shortDate(props.cycle.endsAt)}</span></div>
    </div>
  );
}

function Legend(props: { cycle: Cycle; vertical?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const st = cycleStats(props.cycle, snap);
  return (
    <div className={`bu-legend${props.vertical ? ' vertical' : ''}`}>
      <span><i className="sw scope" /><span className="lg-label">Scope</span><b><IconEstimate size={11} /> {st.scope}</b></span>
      <span><i className="sw started" /><span className="lg-label">Started</span><b><IconEstimate size={11} /> {st.started + st.done}</b><em>· {pct(st.started + st.done, st.scope)}%</em></span>
      <span><i className="sw done" /><span className="lg-label">Completed</span><b><IconEstimate size={11} /> {st.done}</b><em>· {pct(st.done, st.scope)}%</em></span>
    </div>
  );
}

function Breakdown(props: { issues: Issue[] }) {
  const snap = useApp(s => s.snap)!;
  const [tab, setTab] = useState<'assignees' | 'labels' | 'priority' | 'projects'>('assignees');
  const closed = new Set(snap.states.filter(s => s.type === 'completed' || s.type === 'canceled').map(s => s.id));
  type Row = { id: string; label: string; icon: React.ReactNode; total: number; done: number };
  const rows: Row[] = useMemo(() => {
    const m = new Map<string, Row>();
    const add = (id: string, label: string, icon: React.ReactNode, i: Issue) => {
      const r = m.get(id) ?? { id, label, icon, total: 0, done: 0 };
      const p = pointsOf(i, snap);
      r.total += p; if (closed.has(i.stateId)) r.done += p;
      m.set(id, r);
    };
    for (const i of props.issues) {
      if (tab === 'assignees') { const u = snap.users.find(x => x.id === i.assigneeId); add(u?.id ?? 'none', u?.name ?? 'No assignee', <Avatar user={u} size={16} />, i); }
      else if (tab === 'labels') { if (!i.labelIds.length) add('none', 'No label', <IconTag size={12} />, i); for (const l of snap.labels.filter(x => i.labelIds.includes(x.id))) add(l.id, l.name, <span className="label-dot" style={{ background: l.color }} />, i); }
      else if (tab === 'priority') add(String(i.priority), ['No priority', 'Urgent', 'High', 'Medium', 'Low'][i.priority], <PriorityIcon priority={i.priority as Priority} size={13} />, i);
      else { const p = snap.projects.find(x => x.id === i.projectId); add(p?.id ?? 'none', p?.name ?? 'No project', p ? <span>{p.icon}</span> : <IconBox size={12} />, i); }
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [props.issues, tab, snap]);
  return (
    <div className="breakdown">
      <div className="bd-tabs">
        {(['assignees', 'labels', 'priority', 'projects'] as const).map(t => <button key={t} className={`bd-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {rows.map(r => (
        <div key={r.id} className="bd-row">
          <span className="bd-icon">{r.icon}</span>
          <span className="bd-label">{r.label}</span>
          <span className="bd-bar"><span style={{ width: `${pct(r.done, r.total)}%` }} /></span>
          <span className="bd-num" title={`${pct(r.done, r.total)}% done`}>{r.done} of <IconEstimate size={10} /> {r.total}</span>
        </div>
      ))}
      {rows.length === 0 && <div className="bd-empty">No issues in this cycle yet.</div>}
    </div>
  );
}

function CyclesOff() {
  const admin = useCanConfigure();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <TopBar crumbs={[{ label: 'Cycles' }]} />
      <div className="content"><EmptyState kind="off" word="Cycles" illo="cycles" title="Cycles are off in this workspace"
        desc={<>Cycles time-box a team’s work into short windows. {admin ? 'Turn them on in Settings › Features.' : 'An admin can turn them on in Settings › Features.'}</>}
        actions={admin && <Link className="btn secondary" to="/settings/features">Open Features</Link>} /></div>
    </div>
  );
}
const useCyclesOn = () => useApp(s => !!s.snap?.workspace.features.cyclesEnabled);
export function CyclesPage() { return useCyclesOn() ? <CyclesList /> : <CyclesOff />; }
export function CycleDetailPage() { return useCyclesOn() ? <CycleDetail /> : <CyclesOff />; }

function CyclesList() {
  const { teamKey = '' } = useParams();
  const navigate = useNavigate();
  const snap = useApp(s => s.snap)!;
  const [creating, setCreating] = useState(false);
  const team = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
  if (!team) return <TeamMissingRedirect />;
  const cycles = snap.cycles.filter(c => c.teamId === team.id).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const nextNumber = cycles.length ? Math.max(...cycles.map(c => c.number)) + 1 : 1;
  const past = cycles.filter(c => cycleStatus(c, cycles) === 'Completed').slice(0, 3);
  const velocity = past.length ? past.reduce((a, c) => a + cycleStats(c, snap).done, 0) / past.length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: team.name, icon: teamDisplayIcon(team), to: `/team/${team.key}/overview`, muted: true }, { label: 'Cycles' }]} favoriteRef={{ type: 'view', refId: `team-${team.id}-cycles` }}
        right={cycles.length ? <button className="btn secondary" onClick={() => setCreating(true)}><IconPlus size={13} /> New cycle</button> : undefined}
        more={<><MenuItem icon={<IconPlus size={14} />} label="New cycle" onClick={() => setCreating(true)} /><MenuItem label="Cycle settings" onClick={() => navigate(`/settings/team/${team.key}`)} /></>} />
      <div className="content">
        {cycles.length === 0 ? (
          <EmptyState kind="first" word="Cycles" illo="cycles" title="No cycles yet"
            desc={<>Cycles are time-boxed iterations for {team.name}. Create one, or turn on automation in the team's settings and they'll be scheduled for you.</>}
            actions={<>
              <button className="btn primary" onClick={() => setCreating(true)}>Create cycle</button>
              <button className="btn secondary" onClick={() => navigate(`/settings/team/${team.key}`)}>Cycle settings</button>
            </>} />
        ) : (
          <div className="cy-timeline">
            {cycles.map(c => {
              const status = cycleStatus(c, cycles);
              const st = cycleStats(c, snap);
              return (
                <div key={c.id} className={`cyt-item ${status.toLowerCase()}`}>
                  <div className="cyt-date">{new Date(c.startsAt).toLocaleDateString('en-US', { month: 'short' })}<b>{new Date(c.startsAt).getDate()}</b></div>
                  <div className="cyt-rail"><span className="cyt-node" /></div>
                  <div className="cyt-body">
                    <button className="cyt-row" onClick={() => navigate(`/team/${team.key}/cycles/${c.id}`)}>
                      <CycleIcon status={status} pct={pct(st.done, st.scope)} />
                      <span className="cyt-name" title={`${shortDate(c.startsAt)} – ${shortDate(c.endsAt)}`}>{cycleName(c)}</span>
                      <span className="cy-fill" />
                      <span className={`cycle-badge ${status.toLowerCase()}`}>{status}</span>
                      {status === 'Completed'
                        ? <><span className="cyt-metric"><Ring pct={pct(st.done, st.scope)} /><b>{pct(st.done, st.scope)}%</b> success</span><span className="cyt-metric"><IconEstimate size={11} /><b>{st.done}</b> completed</span></>
                        : (() => { if (!velocity) return <span className="cyt-metric" title="Capacity compares scope with the points finished in past cycles. No cycle has finished points yet.">No capacity data yet</span>; const cap = pct(st.scope, velocity); return <span className={`cyt-metric${cap > 100 ? ' over' : ''}`}><Ring pct={cap} over={cap > 100} /><b>{cap}%</b> of capacity</span>; })()}
                      <span className="cyt-metric"><IconEstimate size={11} /><b>{st.scope}</b> scope</span>
                    </button>
                    {status === 'Current' && (
                      <div className="cyt-current">
                        <BurnUp cycle={c} />
                        <Legend cycle={c} vertical />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <AnimatePresence>{creating && <NewCycleModal key="cy" teamId={team.id} number={nextNumber} onClose={() => setCreating(false)} />}</AnimatePresence>
    </div>
  );
}

export function CycleAlias({ which }: { which: 'current' | 'upcoming' }) {
  const { teamKey = '' } = useParams();
  const navigate = useNavigate();
  const snap = useApp(s => s.snap)!;
  const team = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
  useEffect(() => {
    if (!team) return;
    const cycles = snap.cycles.filter(c => c.teamId === team.id);
    const now = new Date().toISOString();
    const hit = which === 'upcoming'
      ? cycles.filter(c => c.startsAt > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
      : cycles.find(c => c.startsAt <= now && c.endsAt >= now);
    navigate(hit ? `/team/${team.key}/cycles/${hit.id}` : `/team/${team.key}/cycles`, { replace: true });
    if (!hit) useApp.getState().toast({ title: which === 'upcoming' ? 'No upcoming cycle' : 'No cycle is running', line: 'Create one, or turn on cycle automation in the team settings' });
  }, [team?.id, which]);
  return null;
}

function CycleDetail() {
  const { teamKey = '', cycleId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const team = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
  const cycle = snap.cycles.find(c => c.id === cycleId);
  const [opts, patch, reset] = useViewPrefs<ViewOptions>(`baseline:view:cycle:${cycleId}`, { ...DEFAULT_VIEW_OPTIONS, filters: {} });
  const displayBtn = useMenu();
  const menu = useMenu();
  const switcher = useMenu();
  const [renaming, setRenaming] = useState(false);
  const [editingDates, setEditingDates] = useState(false);
  const [panel, setPanel] = useState(() => localStorage.getItem('baseline:cyclePanel') !== '0');
  const issues = useMemo(() => snap.issues.filter(i => i.cycleId === cycleId), [snap.issues, cycleId]);
  if (!team) return <TeamMissingRedirect />;
  if (!cycle) return <NotFound what="Cycle" back={{ label: 'Back to cycles', to: `/team/${team.key}/cycles` }} />;
  const teamCycles = snap.cycles.filter(c => c.teamId === team.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const status = cycleStatus(cycle, teamCycles);
  const togglePanel = () => setPanel(p => { try { localStorage.setItem('baseline:cyclePanel', p ? '0' : '1'); } catch { } return !p; });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        crumbs={[{ label: team.name, icon: teamDisplayIcon(team), to: `/team/${team.key}/overview`, muted: true }, { label: 'Cycles', to: `/team/${team.key}/cycles`, muted: true },
          { label: '', icon: <button className="cy-switch" onClick={switcher.open}><IconCycle size={13} />{cycleName(cycle)}<IconChevronDown size={11} /></button> }]}
        favoriteRef={{ type: 'cycle', refId: cycle.id }}
        right={<button className="icon-btn" title="Cycle actions" onClick={menu.open}><IconMore size={15} /></button>}
      />
      <div className="subnav cycle-head">
        <span className="cy-count">{issues.length} issue{issues.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <ListToolbar opts={opts} onDisplay={displayBtn.open} />
        <button className={`icon-btn${panel ? ' on' : ''}`} title="Cycle details" onClick={togglePanel}><IconPanel size={15} /></button>
      </div>
      <div className="cycle-body">
        <div className="cycle-main">
          <IssueListBody issues={issues} opts={opts} patch={patch} reset={reset} teamId={team.id}
            displayAnchor={displayBtn.anchor} closeDisplay={displayBtn.close} createDefaults={{ cycleId: cycle.id }}
            emptyTitle="No issues in this cycle" emptyDesc="Add issues from the backlog with ⇧C, or create one here (C)." />
        </div>
        {panel && (
          <aside className="cycle-rail">
            <div className="cyr-head">
              <span className={`cycle-badge ${status.toLowerCase()}`}>{status}</span>
              <span className="cyr-dates">{shortDate(cycle.startsAt)} → {shortDate(cycle.endsAt)}</span>
            </div>
            {renaming ? (
              <input className="text-input" autoFocus defaultValue={cycleName(cycle)} style={{ height: 30, fontWeight: 600 }}
                onBlur={async e => { setRenaming(false); if (e.target.value.trim() && e.target.value.trim() !== cycleName(cycle)) { await api.updateCycle(cycle.id, { name: e.target.value.trim() }); await useApp.getState().bootstrap(); } }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = cycleName(cycle); setRenaming(false); } }} />
            ) : <div className="cyr-name" onDoubleClick={() => setRenaming(true)}><IconCycle size={15} /> {cycleName(cycle)}</div>}
            <div className="rail-header" style={{ padding: 0 }}>Progress</div>
            <Legend cycle={cycle} vertical />
            <BurnUp cycle={cycle} height={140} />
            <Breakdown issues={issues} />
          </aside>
        )}
      </div>
      {switcher.anchor && (
        <Menu anchor={switcher.anchor} onClose={switcher.close} width={260}>
          {[...teamCycles].reverse().map(c => (
            <MenuItem key={c.id} icon={<IconCycle size={14} />} label={cycleName(c)} selected={c.id === cycle.id}
              right={<span className="mi-hint">{cycleStatus(c, teamCycles)}</span>} onClick={() => navigate(`/team/${team.key}/cycles/${c.id}`)} />
          ))}
        </Menu>
      )}
      <AnimatePresence>{editingDates && <CycleDatesModal key="cyd" cycle={cycle} onClose={() => setEditingDates(false)} />}</AnimatePresence>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={220}>
          <MenuItem icon={<IconEdit size={14} />} label="Rename cycle" onClick={() => { if (!panel) togglePanel(); setRenaming(true); }} />
          <MenuItem icon={<IconCalendar size={14} />} label="Change dates…" onClick={() => setEditingDates(true)} />
          <MenuSep />
          <ConfirmButton className="menu-item danger" label={<><span className="mi-icon"><IconTrash size={14} /></span><span className="mi-label">Delete cycle</span></>} confirmLabel={<span className="mi-label">Delete cycle? Its issues stay</span>}
            onConfirm={async () => { menu.close(); await api.deleteCycle(cycle.id); await useApp.getState().bootstrap(); navigate(`/team/${team.key}/cycles`); }} />
        </Menu>
      )}
    </div>
  );
}

function CycleDatesModal(props: { cycle: Cycle; onClose: () => void }) {
  const day = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [start, setStart] = useState(day(props.cycle.startsAt));
  const [end, setEnd] = useState(day(props.cycle.endsAt));
  const valid = !!start && !!end && end >= start;
  const save = () => exclusive(`cycle-dates-${props.cycle.id}`, async () => {
    if (!valid) return;
    await api.updateCycle(props.cycle.id, { startsAt: new Date(start + 'T00:00:00').toISOString(), endsAt: new Date(end + 'T23:59:59').toISOString() });
    await useApp.getState().bootstrap();
    useApp.getState().toast({ title: 'Cycle dates changed', line: `${shortDate(start + 'T12:00')} → ${shortDate(end + 'T12:00')}` });
    props.onClose();
  });
  return (
    <Modal onClose={props.onClose} className="modal modal-create cy-modal">
      <div className="cm-root" onKeyDown={e => { if (e.key === 'Enter') void save(); }}>
        <div className="cm-header"><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Change dates · {props.cycle.name || `Cycle ${props.cycle.number}`}</span>
          <span style={{ marginLeft: 'auto' }}><button className="icon-btn" title="Close" aria-label="Close" onClick={props.onClose}><IconClose size={14} /></button></span></div>
        <div style={{ display: 'flex', gap: 12, padding: '16px 16px 4px' }}>
          <label className="auth-field" style={{ flex: 1 }}><span className="field-label">Start</span><input className="text-input" type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label className="auth-field" style={{ flex: 1 }}><span className="field-label">End</span><input className="text-input" type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
        </div>
        {!valid && <div className="field-help" style={{ color: 'var(--danger)', padding: '0 16px' }}>The end date must be on or after the start date.</div>}
        <div className="cm-footer"><div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid} onClick={() => void save()}>Save dates</button>
        </div></div>
      </div>
    </Modal>
  );
}
