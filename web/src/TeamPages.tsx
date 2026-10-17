import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, relTime, shortDate, useCursor, registerVisibleList } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, ConfirmButton } from './ui.js';
import { IssueDetail } from './IssueDetail.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { PropertyMenuBody, propMenuWidth, parseReminder } from './propertyMenus.js';
import { setIssueProps } from './actions.js';
import { useViewPrefs, DEFAULT_VIEW_OPTIONS, FilterBar, applyFilters, activeFilterCount, type ViewOptions } from './IssueViews.js';
import { IssueListBody, ListToolbar, openFilterMenu } from './Views.js';
import { useMenu } from './ui.js';
import { IconCheck, IconClose, IconDuplicate, IconClock, IconRestore, IconSearch, IconPlus, IconFilter, IconDisplay } from './icons.js';
import type { Issue, ViewFilters } from '../../src/core/types.js';
import { InitiativeIcon } from './Initiatives.js';
import { Illustration } from './illustrations.js';

interface TriagePrefs { filters: ViewFilters; orderBy: 'oldest' | 'newest' | 'priority'; showSnoozed: boolean }
const DEFAULT_TRIAGE: TriagePrefs = { filters: {}, orderBy: 'oldest', showSnoozed: false };

function teamFromKey(teamKey: string) {
  const snap = useApp.getState().snap!;
  return snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
}

/* ================= triage =================
   Issues filed into the team from outside (agents, the CLI, other people) wait here.
   Left: the queue, oldest first. Right: the issue. 1 accepts, 2 marks a duplicate,
   3 declines — the decision moves the cursor to the next one. */
export function TriagePage() {
  const { teamKey = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const team = teamFromKey(teamKey);
  const cursor = useCursor(s => s.index);
  const dup = useMenu();
  const triageState = team ? snap.states.find(s => s.teamId === team.id && s.type === 'triage') : undefined;
  const [prefs, patchPrefs] = useViewPrefs<TriagePrefs>(`baseline:triage:${team?.id ?? ''}`, DEFAULT_TRIAGE);
  const showSnoozed = prefs.showSnoozed;
  const displayMenu = useMenu();
  const nowIso = new Date().toISOString();
  const all = useMemo(() => {
    const list = triageState ? applyFilters(snap.issues.filter(i => i.stateId === triageState.id && !i.archivedAt && !i.deletedAt), prefs.filters) : [];
    const by = prefs.orderBy;
    return list.sort((a, b) => by === 'newest' ? b.createdAt.localeCompare(a.createdAt) : by === 'priority' ? ((a.priority || 9) - (b.priority || 9) || a.createdAt.localeCompare(b.createdAt)) : a.createdAt.localeCompare(b.createdAt));
  }, [snap.issues, triageState, prefs.filters, prefs.orderBy]);
  const pool = useMemo(() => triageState ? snap.issues.filter(i => i.stateId === triageState.id) : [], [snap.issues, triageState]);
  const snoozedCount = all.filter(i => i.snoozedUntil && i.snoozedUntil > nowIso).length;
  // snoozed issues leave the queue until their time comes back round
  const queue = useMemo(() => showSnoozed ? all : all.filter(i => !i.snoozedUntil || i.snoozedUntil <= nowIso), [all, showSnoozed, nowIso]);
  const snoozeMenu = useMenu();
  const createTriage = () => team && triageState && useApp.getState().openCreate({ teamId: team.id, stateId: triageState.id });

  useEffect(() => { registerVisibleList(queue, team?.id ?? ''); }, [queue, team?.id]);
  useEffect(() => { useCursor.setState({ index: queue.length ? 0 : -1 }); return () => useCursor.getState().reset(); }, [team?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cursor >= queue.length && queue.length) useCursor.setState({ index: queue.length - 1 }); }, [queue.length, cursor]);
  const current = cursor >= 0 ? queue[cursor] : undefined;

  const stateOf = (type: string) => team ? snap.states.filter(s => s.teamId === team.id && s.type === type).sort((a, b) => a.position - b.position)[0] : undefined;
  const accept = (i: Issue) => { const s = stateOf('unstarted') ?? stateOf('backlog'); if (s) void setIssueProps([i.id], { stateId: s.id }); };
  const decline = (i: Issue) => { const s = stateOf('canceled'); if (s) void setIssueProps([i.id], { stateId: s.id }); };

  // the triage keys win over the global 1–9 status shortcuts while this page is up
  const currentRef = useRef(current);
  currentRef.current = current;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.menu:not(.closing)')) return;
      const cur = currentRef.current;
      if (!cur) return;
      if (e.key === '1') { e.preventDefault(); e.stopImmediatePropagation(); accept(cur); }
      else if (e.key === '2') { e.preventDefault(); e.stopImmediatePropagation(); const el = document.querySelector<HTMLElement>('[data-triage-dup]'); if (el) dup.setAnchor(el.getBoundingClientRect()); }
      else if (e.key === '3') { e.preventDefault(); e.stopImmediatePropagation(); decline(cur); }
      else if (e.key.toLowerCase() === 'h' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); const el = document.querySelector<HTMLElement>('[data-triage-snooze]'); if (el) snoozeMenu.setAnchor(el.getBoundingClientRect()); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!team) return null;
  if (!team.triageEnabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <TopBar crumbs={[{ label: team.name, to: `/team/${team.key}/all`, muted: true }, { label: 'Triage' }]} />
        <div className="empty-state">
          <Illustration name="triage" />
          <div className="empty-title">Triage is off for {team.name}</div>
          <div className="empty-desc">With triage on, issues that agents and teammates file through the CLI land in a review queue before they reach the backlog.</div>
          <div className="empty-actions">
            <button className="btn primary" onClick={async () => { await api.updateTeam(team.id, { triageEnabled: true }); await useApp.getState().bootstrap(); }}>Turn on triage</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="inbox">
      <div className="inbox-list">
        <TopBar crumbs={[{ label: 'Triage' }]} favoriteRef={{ type: 'view', refId: `team-${team.id}-triage` }}
          right={<>
            <button className={`icon-btn${activeFilterCount(prefs.filters) ? ' on' : ''}`} data-filter-trigger title="Filter (F)" onClick={openFilterMenu}><IconFilter size={15} /></button>
            <button className="icon-btn" title="Display options" onClick={displayMenu.open}><IconDisplay size={15} /></button>
            <button className="icon-btn" title="Create triage issue" onClick={createTriage}><IconPlus size={15} /></button>
          </>} />
        <div className="filterbar"><FilterBar filters={prefs.filters} onChange={filters => patchPrefs({ filters })} teamId={team.id} pool={pool} /></div>
        {displayMenu.anchor && (
          <Menu anchor={displayMenu.anchor} onClose={displayMenu.close} width={260}>
            <div className="menu-header"><span>Ordering</span></div>
            {([['oldest', 'Oldest first'], ['newest', 'Newest first'], ['priority', 'Priority']] as const).map(([v, l]) => (
              <button key={v} className="menu-item" onClick={() => patchPrefs({ orderBy: v })}>
                <span className="mi-label">{l}</span><span className="mi-right">{prefs.orderBy === v && <IconCheck size={13} />}</span>
              </button>
            ))}
            <div className="menu-sep" />
            <button className="menu-item" role="switch" aria-checked={showSnoozed} onClick={() => patchPrefs({ showSnoozed: !showSnoozed })}>
              <span className="mi-label">Show snoozed{snoozedCount ? ` (${snoozedCount})` : ''}</span><span className="mi-right"><span className={`toggle ${showSnoozed ? 'on' : ''}`} /></span>
            </button>
          </Menu>
        )}
        <div className="content">
          {queue.length === 0 ? (
            <div className="empty-state">
              <Illustration name="triage" />
              <div className="empty-title">{activeFilterCount(prefs.filters) ? 'No triage issues match' : 'Nothing to triage'}</div>
              <div className="empty-actions">
                {activeFilterCount(prefs.filters) ? <button className="btn secondary" onClick={() => patchPrefs({ filters: {} })}>Clear filters</button>
                  : <button className="btn secondary" onClick={createTriage}><IconPlus size={12} /> Create triage issue</button>}
              </div>
            </div>
          ) : queue.map((i, n) => {
            const creator = snap.users.find(u => u.id === i.creatorId);
            return (
              <div key={i.id} className={`inbox-row${n === cursor ? ' selected' : ''}`} data-issue-row={i.id}
                onClick={() => useCursor.setState({ index: n })}
                onDoubleClick={() => navigate(`/issue/${team.key}-${i.number}`)}>
                <span className="inbox-lead"><Avatar user={creator} size={20} /></span>
                <div className="inbox-body">
                  <div className="inbox-line1"><span className="inbox-title">{i.title}</span><span className="rel-time">{relTime(i.createdAt)}</span></div>
                  <div className="inbox-line2"><span className="inbox-key">{team.key}-{i.number}</span><span className="inbox-what">{i.snoozedUntil && i.snoozedUntil > nowIso ? `Snoozed until ${new Date(i.snoozedUntil).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })}` : `${creator?.name ?? 'Someone'} filed this`}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="inbox-preview">
        {current ? (
          <div className="triage-preview">
            <div className="triage-actions">
              <button className="btn primary sm" onClick={() => accept(current)}><IconCheck size={12} /> Accept <span className="kbd">1</span></button>
              <button className="btn secondary sm" data-triage-dup onClick={dup.open}><IconDuplicate size={12} /> Duplicate <span className="kbd">2</span></button>
              <button className="btn secondary sm" onClick={() => decline(current)}><IconClose size={12} /> Decline <span className="kbd">3</span></button>
              <button className="btn secondary sm" data-triage-snooze onClick={snoozeMenu.open}><IconClock size={12} /> Snooze <span className="kbd">H</span></button>
              <span style={{ flex: 1 }} />
              <span className="triage-pos">{cursor + 1} of {queue.length}</span>
            </div>
            <IssueDetail key={current.id} issue={current} hideTriage />
            {snoozeMenu.anchor && (
              <Menu anchor={snoozeMenu.anchor} onClose={snoozeMenu.close} width={290}>
                <TriageSnooze onPick={async d => { await api.snoozeIssue(current.id, d ? d.toISOString() : null); await useApp.getState().bootstrap(); snoozeMenu.close(); if (d) useApp.getState().toast({ title: 'Snoozed', line: <>{team.key}-{current.number} returns to triage {d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</> }); }} snoozed={!!current.snoozedUntil && current.snoozedUntil > nowIso} />
              </Menu>
            )}
            {dup.anchor && (
              <Menu anchor={dup.anchor} onClose={dup.close} width={propMenuWidth('duplicate')}>
                <PropertyMenuBody kind="duplicate" issues={[current]} onClose={dup.close} />
              </Menu>
            )}
          </div>
        ) : (
          <div className="empty-state"><Illustration name="issues" /><div className="empty-title">Nothing to review</div></div>
        )}
      </div>
    </div>
  );
}

function TriageSnooze(props: { onPick: (d: Date | null) => void; snoozed: boolean }) {
  const [q, setQ] = useState('');
  const at = (h: number, add = 0) => { const d = new Date(); d.setDate(d.getDate() + add); d.setHours(h, 0, 0, 0); return d; };
  const opts: Array<[string, Date]> = [['Tomorrow', at(9, 1)], ['In 3 days', at(9, 3)], ['Next week', (() => { const d = at(9); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return d; })()], ['In a month', (() => { const d = at(9); d.setMonth(d.getMonth() + 1); return d; })()]];
  const typed = parseReminder(q);
  return (
    <>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Snooze until… (fri, 3 days, dec 2)" /></div>
      {typed && <MenuItem icon={<IconClock size={14} />} label={<>Until {typed.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })}</>} onClick={() => props.onPick(typed)} />}
      {opts.filter(([l]) => l.toLowerCase().includes(q.toLowerCase())).map(([l, d]) => <MenuItem key={l} icon={<IconClock size={14} />} label={l} onClick={() => props.onPick(d)} />)}
      {props.snoozed && <MenuItem icon={<IconClose size={13} />} label="Unsnooze" onClick={() => props.onPick(null)} />}
    </>
  );
}

/* ================= archive (team) & trash (workspace) ================= */
function useServerList(load: () => Promise<{ issues: Issue[] }>, deps: unknown[]) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const snapIssues = useApp(s => s.snap?.issues);
  const reload = () => { void load().then(r => setIssues(r.issues)); };
  useEffect(reload, [...deps, snapIssues]); // eslint-disable-line react-hooks/exhaustive-deps
  return { issues, reload };
}

function StaticIssueRow(props: { issue: Issue; when: string; actions: React.ReactNode }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const team = snap.teams.find(t => t.id === props.issue.teamId);
  const st = snap.states.find(s => s.id === props.issue.stateId);
  const key = `${team?.key}-${props.issue.number}`;
  return (
    <div className="issue-row static-row" onClick={() => navigate(`/issue/${key}`)}>
      <PriorityIcon priority={props.issue.priority} size={14} />
      <span className="issue-key">{key}</span>
      {st && <StateIcon type={st.type} color={st.color} size={14} />}
      <span className="row-title-wrap"><span className="row-title">{props.issue.title}</span></span>
      <span className="row-meta">
        <Avatar user={snap.users.find(u => u.id === props.issue.assigneeId)} />
        <span className="row-date">{props.when}</span>
        <span className="row-actions" onClick={e => e.stopPropagation()}>{props.actions}</span>
      </span>
    </div>
  );
}

export function ArchivePage() {
  const { teamKey = '' } = useParams();
  const team = teamFromKey(teamKey);
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [tab, setTab] = useState<'issues' | 'cycles' | 'deleted'>('issues');
  const { issues } = useServerList(() => api.archivedIssues(team?.id), [team?.id]);
  const { issues: deleted, reload } = useServerList(() => api.deletedIssues(), []);
  if (!team) return null;
  const now = new Date().toISOString();
  const cycles = snap.cycles.filter(c => c.teamId === team.id && c.endsAt < now).sort((a, b) => b.endsAt.localeCompare(a.endsAt));
  const gone = (deleted ?? []).filter(i => i.teamId === team.id);
  const title = tab === 'issues' ? 'Archived issues' : tab === 'cycles' ? 'Archived cycles' : 'Recently deleted issues';
  const count = tab === 'issues' ? issues?.length ?? 0 : tab === 'cycles' ? cycles.length : gone.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: title }]} right={<span className="set-meta">{count || ''}</span>} />
      <div className="subnav">
        {([['issues', 'Issues'], ['cycles', 'Cycles'], ['deleted', 'Recently deleted issues']] as const).map(([k, l]) => (
          <button key={k} className={`seg ${tab === k ? 'selected' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="content">
        {tab === 'issues' && (issues === null ? null : issues.length === 0 ? (
          <div className="empty-state"><Illustration name="archive" /><div className="empty-title">No archived issues</div><div className="empty-desc">Issues you archive in {team.name} (E) — and closed issues the team’s auto-archive picks up — are kept here and can be brought back at any time.</div></div>
        ) : (
          <div className="static-list">
            {issues.map(i => (
              <StaticIssueRow key={i.id} issue={i} when={`Archived ${shortDate(i.archivedAt!)}`} actions={
                <button className="btn secondary sm" onClick={async () => { await api.unarchiveIssue(i.id); await useApp.getState().bootstrap(); useApp.getState().toast({ title: 'Issue restored' }); }}><IconRestore size={12} /> Unarchive</button>
              } />
            ))}
          </div>
        ))}
        {tab === 'cycles' && (cycles.length === 0 ? (
          <div className="empty-state"><div className="empty-title">No archived cycles</div><div className="empty-desc">Cycles move here once they end.</div></div>
        ) : (
          <div className="static-list">
            {cycles.map(c => (
              <button key={c.id} className="sr-row" onClick={() => navigate(`/team/${team.key}/cycles/${c.id}`)}>
                <span className="sr-icon">#{c.number}</span><span className="sr-title">{c.name || `Cycle ${c.number}`}</span>
                <span className="sr-right">{shortDate(c.startsAt)} – {shortDate(c.endsAt)}</span>
              </button>
            ))}
          </div>
        ))}
        {tab === 'deleted' && (deleted === null ? null : gone.length === 0 ? (
          <div className="empty-state"><Illustration name="trash" /><div className="empty-title">Nothing deleted recently</div><div className="empty-desc">Deleted issues stay here until you restore them or delete them for good.</div></div>
        ) : (
          <div className="static-list">
            {gone.map(i => (
              <StaticIssueRow key={i.id} issue={i} when={`Deleted ${relTime(i.deletedAt!)}`} actions={<>
                <button className="btn secondary sm" onClick={async () => { await api.restoreIssue(i.id); await useApp.getState().bootstrap(); reload(); useApp.getState().toast({ title: 'Issue restored' }); }}><IconRestore size={12} /> Restore</button>
                <ConfirmButton className="btn ghost sm" label="Delete forever" confirmLabel="Click to confirm" onConfirm={async () => { await api.purgeIssue(i.id); reload(); }} />
              </>} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrashPage() {
  const { issues, reload } = useServerList(() => api.deletedIssues(), []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Trash' }]} right={issues && issues.length > 0 ? (
        <ConfirmButton className="btn secondary" label="Empty trash" confirmLabel={`Delete ${issues.length} forever?`} onConfirm={async () => {
          for (const i of issues) await api.purgeIssue(i.id);
          reload();
          useApp.getState().toast({ title: 'Trash emptied' });
        }} />
      ) : undefined} />
      <div className="content">
        {issues === null ? null : issues.length === 0 ? (
          <div className="empty-state"><Illustration name="trash" /><div className="empty-title">Trash is empty</div><div className="empty-desc">Deleted issues stay here until you restore them or delete them for good.</div></div>
        ) : (
          <div className="static-list">
            <div className="static-head">{issues.length} deleted issue{issues.length === 1 ? '' : 's'}</div>
            {issues.map(i => (
              <StaticIssueRow key={i.id} issue={i} when={`Deleted ${relTime(i.deletedAt!)}`} actions={<>
                <button className="btn secondary sm" onClick={async () => { await api.restoreIssue(i.id); await useApp.getState().bootstrap(); useApp.getState().toast({ title: 'Issue restored' }); }}><IconRestore size={12} /> Restore</button>
                <ConfirmButton className="btn ghost sm" label="Delete forever" confirmLabel="Click to confirm" onConfirm={async () => { await api.purgeIssue(i.id); reload(); }} />
              </>} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= search =================
   Linear's search page: one field, results update as you type, filters and display
   options apply on top. Matches titles, descriptions, IDs and comments. */
type SearchTab = 'all' | 'issues' | 'projects' | 'initiatives' | 'documents';
/** the matched words in bold, as Linear's results show them */
function Bolded({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(re).map((part, i) => words.some(w => w.toLowerCase() === part.toLowerCase()) ? <b key={i}>{part}</b> : <span key={i}>{part}</span>)}</>;
}

export function SearchPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [q, setQ] = useState(() => sessionStorage.getItem('baseline:search') ?? '');
  const [tab, setTab] = useState<SearchTab>(() => (sessionStorage.getItem('baseline:searchTab') as SearchTab) || 'all');
  const [archived, setArchived] = useState<Issue[]>([]);
  const [opts, patch, reset] = useViewPrefs<ViewOptions>('baseline:view:search', { ...DEFAULT_VIEW_OPTIONS, groupBy: 'none', orderBy: 'updated', filters: {}, showTriage: true });
  const displayBtn = useMenu();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); void api.archivedIssues().then(r => setArchived(r.issues)).catch(() => {}); }, []);
  useEffect(() => { try { sessionStorage.setItem('baseline:search', q); sessionStorage.setItem('baseline:searchTab', tab); } catch { /* ignore */ } }, [q, tab]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (hay: string) => words.length > 0 && words.every(w => hay.toLowerCase().includes(w));
  // Linear searches archived issues too
  const issues = useMemo(() => {
    if (!words.length) return [];
    const commentText = new Map<string, string>();
    for (const c of snap.comments) commentText.set(c.issueId, (commentText.get(c.issueId) ?? '') + ' ' + c.body);
    const seen = new Set<string>();
    return [...snap.issues, ...archived].filter(i => {
      if (seen.has(i.id)) return false; seen.add(i.id);
      const key = `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
      return hit(`${key} ${i.title} ${i.description} ${commentText.get(i.id) ?? ''}`);
    });
  }, [q, snap.issues, snap.comments, snap.teams, archived]); // eslint-disable-line react-hooks/exhaustive-deps
  const projects = words.length ? snap.projects.filter(p => hit(`${p.name} ${p.description} ${p.summary ?? ''}`)) : [];
  const initiatives = words.length ? snap.initiatives.filter(i => hit(`${i.name} ${i.description}`)) : [];
  const docs = words.length ? snap.docs.filter(d => hit(`${d.title} ${d.content}`)) : [];
  const counts: Record<SearchTab, number> = { all: issues.length + projects.length + initiatives.length + docs.length, issues: issues.length, projects: projects.length, initiatives: initiatives.length, documents: docs.length };
  const keyOf = (i: Issue) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
  type Row = { id: string; kind: string; icon: React.ReactNode; title: string; right: React.ReactNode; at: string; to: string };
  const rows: Row[] = [
    ...(tab === 'all' || tab === 'issues' ? issues.map(i => { const st = snap.states.find(s => s.id === i.stateId); const team = snap.teams.find(t => t.id === i.teamId); return { id: i.id, kind: 'Issue', icon: st ? <StateIcon type={st.type} color={st.color} size={14} /> : null, title: i.title, right: team && <span className="sr-team"><span className="ws-avatar" style={{ background: team.color, borderRadius: 3, fontSize: 7, width: 13, height: 13 }}>{team.key[0]}</span>{team.name}</span>, at: i.updatedAt, to: `/issue/${keyOf(i)}` }; }) : []),
    ...(tab === 'all' || tab === 'projects' ? projects.map(p => ({ id: p.id, kind: 'Project', icon: <span>{p.icon}</span>, title: p.name, right: null, at: p.updatedAt ?? p.createdAt, to: `/projects/${p.id}` })) : []),
    ...(tab === 'all' || tab === 'initiatives' ? initiatives.map(i => ({ id: i.id, kind: 'Initiative', icon: <InitiativeIcon ini={i} size={14} />, title: i.name, right: null, at: i.updatedAt, to: `/initiatives/${i.id}` })) : []),
    ...(tab === 'all' || tab === 'documents' ? docs.map(d => ({ id: d.id, kind: 'Document', icon: <span>{d.icon || '📄'}</span>, title: d.title || 'Untitled document', right: null, at: d.updatedAt, to: `/docs/${d.id}` })) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="topbar search-top">
        <IconSearch size={14} />
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search issues, projects, and documents…" spellCheck={false} aria-label="Search"
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } if (e.key === 'ArrowDown' || e.key === 'Enter') { (e.target as HTMLInputElement).blur(); useCursor.setState({ index: 0 }); } }} />
        {q && <button className="icon-btn" title="Clear" onClick={() => { setQ(''); inputRef.current?.focus(); }}><IconClose size={13} /></button>}
      </div>
      <div className="subnav">
        {(['all', 'issues', 'projects', 'initiatives', 'documents'] as const).map(t => (
          <button key={t} className={`seg ${tab === t ? 'selected' : ''}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}{words.length > 0 && counts[t] > 0 && t !== 'all' ? <span className="seg-count">{counts[t]}</span> : null}</button>
        ))}
        <span style={{ flex: 1 }} />
        {tab === 'issues' && words.length > 0 && <ListToolbar opts={opts} onDisplay={displayBtn.open} />}
      </div>
      {!words.length ? (
        <div className="content"><div className="empty-state"><Illustration name="search" /><div className="empty-title">Search</div><div className="empty-desc">Find issues, projects, initiatives, and documents</div></div></div>
      ) : tab === 'issues' ? (
        <IssueListBody issues={issues} opts={opts} patch={patch} reset={reset} multiTeam
          displayAnchor={displayBtn.anchor} closeDisplay={displayBtn.close} emptyHideCreate
          emptyTitle="No results" emptyDesc={`Nothing matches “${q.trim()}”.`} />
      ) : (
        <div className="content search-results">
          {rows.map(r => (
            <button key={`${r.kind}-${r.id}`} className="sr-row" data-search-row={r.kind} onClick={() => navigate(r.to)}>
              <span className="sr-kind">{r.kind}</span>
              <span className="sr-icon">{r.icon}</span>
              <span className="sr-title"><Bolded text={r.title} words={words} /></span>
              <span className="sr-right">{r.right}</span>
              <span className="sr-at">{relTime(r.at).replace(/ ago$/, "")}</span>
            </button>
          ))}
          {!rows.length && <div className="empty-state"><div className="empty-title">No results</div><div className="empty-desc">Nothing matches “{q.trim()}”.</div></div>}
        </div>
      )}
    </div>
  );
}

