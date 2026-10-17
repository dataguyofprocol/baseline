import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useApp, relTime } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, useMenu, RegisterMark } from './ui.js';
import { GroupedList, FilterBar, DisplayOptionsMenu, useViewPrefs, DEFAULT_VIEW_OPTIONS, activeFilterCount, applyFilters, applyDisplay, countConditions, type ViewOptions } from './IssueViews.js';
import { Board } from './Board.js';
import { ProjectsPage, countProjectView, describeProjectView } from './Projects.js';
import { StateIcon, teamDisplayIcon, Avatar } from './pickers.js';
import { IconFilter, IconDisplay, IconStar, IconMore, IconTrash, IconEdit, IconViews, IconBell, IconCheck } from './icons.js';
import type { SavedView, ViewFilters, Issue } from '../../src/core/types.js';
import { Illustration } from './illustrations.js';

/** the right-toolbar filter icon opens the filter menu anchored to itself */
export function openFilterMenu(e: React.MouseEvent) {
  window.dispatchEvent(new CustomEvent('baseline:focus-filter', { detail: (e.currentTarget as HTMLElement).getBoundingClientRect() }));
}

/** toggle a status focus filter; cross-team board columns pass every state merged into them */
function toggleStateFilter(filters: ViewFilters, stateIds: string[]): ViewFilters {
  const on = stateIds.length > 0 && stateIds.every(id => filters.states?.includes(id));
  return { ...filters, states: on ? filters.states!.filter(s => !stateIds.includes(s)) : stateIds };
}

export const TEAM_DEFAULT_OPTS: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, filters: {} };

/* ================= shared issue-list page body =================
   Every issue list (team, my issues, views, project, cycle) is the same thing: filter
   pills over a list or board, with display options. ⌘B flips list ↔ board. */
export function useListLayoutToggle(opts: ViewOptions, patch: (p: Partial<ViewOptions>) => void) {
  const ref = useRef(opts.layout);
  ref.current = opts.layout;
  useEffect(() => {
    const onToggle = () => patch({ layout: ref.current === 'list' ? 'board' : 'list' });
    window.addEventListener('baseline:toggle-layout', onToggle);
    return () => window.removeEventListener('baseline:toggle-layout', onToggle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** the right side of a list page's subnav: filter + display buttons */
export function ListToolbar(props: { opts: ViewOptions; onDisplay: (e: React.MouseEvent) => void }) {
  const n = activeFilterCount(props.opts.filters);
  return (
    <>
      <button className={`icon-btn${n ? ' on' : ''}`} data-filter-trigger title="Filter (F)" onClick={openFilterMenu}><IconFilter size={15} /></button>
      <button className="icon-btn" title="Display options" onClick={props.onDisplay}><IconDisplay size={15} /></button>
    </>
  );
}

export function IssueListBody(props: {
  issues: Issue[];
  opts: ViewOptions;
  patch: (p: Partial<ViewOptions>) => void;
  reset?: () => void;
  teamId?: string;
  displayAnchor: DOMRect | null;
  closeDisplay: () => void;
  multiTeam?: boolean;
  emptyTitle?: string;
  emptyDesc?: string;
  emptyHideCreate?: boolean;
  createDefaults?: { projectId?: string | null; cycleId?: string | null };
  onFocusStatus?: (stateId: string) => void;
  /** "Save" in the filter bar: omit where a view can't be saved (a view saves itself) */
  onSaveView?: (() => void) | null;
}) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const { opts, patch } = props;
  useListLayoutToggle(opts, patch);
  const saveView = props.onSaveView === null ? undefined : props.onSaveView ?? (async () => {
    const { view } = await api.createView({ name: 'New view', filters: opts.filters, groupBy: opts.groupBy, orderBy: opts.orderBy, layout: opts.layout, teamId: props.teamId ?? null, icon: '🗂' });
    await useApp.getState().bootstrap();
    navigate(`/views/${view.id}`, { state: { rename: true } });
  });
  useEffect(() => {
    // ⌥V: save what's on screen as a view
    const onSave = (e: Event) => { if (!saveView) return; e.preventDefault(); void saveView(); };
    window.addEventListener('baseline:save-view', onSave);
    return () => window.removeEventListener('baseline:save-view', onSave);
  });
  const boardIssues = useMemo(
    () => opts.layout === 'board' ? applyFilters(applyDisplay(props.issues, opts), opts.filters) : [],
    [opts, props.issues, snap], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <>
      <div className="filterbar">
        <FilterBar filters={opts.filters} onChange={filters => patch({ filters })} teamId={props.teamId} pool={props.issues} onSave={saveView} />
      </div>
      {props.displayAnchor && (
        <DisplayOptionsMenu opts={opts} onPatch={patch} anchor={props.displayAnchor} onClose={props.closeDisplay} multiTeam={props.multiTeam} onReset={props.reset} />
      )}
      <div className="content">
        {opts.layout === 'list' ? (
          <GroupedList
            issues={props.issues}
            teamId={props.teamId}
            opts={opts}
            emptyTitle={props.emptyTitle}
            emptyDesc={props.emptyDesc}
            emptyHideCreate={props.emptyHideCreate}
            createDefaults={props.createDefaults}
            onFocusStatus={props.onFocusStatus}
            onClearFilters={() => patch({ filters: {} })}
          />
        ) : (
          <Board
            issues={boardIssues}
            teamId={props.teamId}
            groupBy={opts.groupBy}
            subgroupBy={opts.subgroupBy}
            orderBy={opts.orderBy}
            orderReversed={opts.orderReversed}
            display={opts.display}
            showEmpty={opts.showEmpty}
            createDefaults={props.createDefaults}
            onFocusColumn={ids => patch({ filters: toggleStateFilter(opts.filters, ids) })}
          />
        )}
      </div>
    </>
  );
}

/* ================= team issues page ================= */
export function TeamPage() {
  const { teamKey = '', filter = 'all' } = useParams();
  const snap = useApp(s => s.snap)!;
  const displayBtn = useMenu();
  const team = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
  const viewKey = `baseline:view:${teamKey}:${filter}`;
  const [opts, patch, reset] = useViewPrefs<ViewOptions>(viewKey, { ...TEAM_DEFAULT_OPTS });

  const issues = useMemo(() => {
    if (!team) return [];
    const mine = snap.issues.filter(i => i.teamId === team.id);
    if (filter === 'active') return mine.filter(i => !teamStates(snap.states, team.id, ['backlog', 'canceled', 'triage']).includes(i.stateId));
    if (filter === 'backlog') return mine.filter(i => teamStates(snap.states, team.id, ['backlog']).includes(i.stateId));
    return mine;
  }, [snap.issues, snap.states, team, filter]);

  if (!team) return <TeamMissingRedirect />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        crumbs={[
          { label: team.name, icon: teamDisplayIcon(team), to: `/team/${team.key}/overview`, muted: true },
          { label: 'Issues' },
        ]}
        favoriteRef={{ type: 'view', refId: `team-${team.id}-${filter}` }}
        right={<TeamBell teamId={team.id} />}
      />
      <TeamSubnav
        teamId={team.id}
        filter={filter as 'all' | 'active' | 'backlog'}
        trailing={<ListToolbar opts={opts} onDisplay={displayBtn.open} />}
      />
      <IssueListBody
        issues={issues} opts={opts} patch={patch} reset={reset} teamId={team.id}
        displayAnchor={displayBtn.anchor} closeDisplay={displayBtn.close}
        onFocusStatus={stateId => patch({ filters: toggleStateFilter(opts.filters, [stateId]) })}
      />
    </div>
  );
}

function teamStates(states: Array<{ id: string; teamId: string; type: string }>, teamId: string, types: string[]): string[] {
  return states.filter(s => s.teamId === teamId && types.includes(s.type)).map(s => s.id);
}

/** A stale team route (pre-reset URL left in the tab, an old localStorage key) should
 *  fall back to the first team instead of dead-ending on "Team not found". */
export function TeamMissingRedirect() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  useEffect(() => { if (snap.teams[0]) navigate(`/team/${snap.teams[0].key}/all`, { replace: true }); }, []); // eslint-disable-line
  return null;
}

/** team selector + All/Active/Backlog/Cycles tabs shared by the team issues page and the cycles page */
/** the team bell: which team events reach your inbox (Linear's three options) */
function TeamBell({ teamId }: { teamId: string }) {
  const snap = useApp(s => s.snap)!;
  const menu = useMenu();
  const sub = snap.teamSubscriptions[teamId] ?? { issueAdded: false, issueClosed: false, triage: false };
  const on = sub.issueAdded || sub.issueClosed || sub.triage;
  const toggle = async (k: keyof typeof sub) => { await api.setTeamSubscription(teamId, { [k]: !sub[k] }); await useApp.getState().bootstrap(); };
  return (
    <>
      <button className={`icon-btn${on ? ' on' : ''}`} title="Notifications" data-team-bell onClick={menu.open}><IconBell size={15} /></button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={330}>
          <div className="menu-header"><span>Send inbox notifications for</span></div>
          {([['issueAdded', 'An issue is added to the team'], ['issueClosed', 'An issue is marked completed or canceled'], ['triage', 'An issue is added to the triage queue']] as const).map(([k, l]) => (
            <button key={k} className="menu-item" onClick={e => { e.stopPropagation(); void toggle(k); }}>
              <span className="mi-label">{l}</span><span className={`mi-check${sub[k] ? ' on' : ''}`} style={{ marginLeft: 'auto' }}>{sub[k] && <IconCheck size={11} />}</span>
            </button>
          ))}
        </Menu>
      )}
    </>
  );
}

export function TeamSubnav(props: { teamId: string; filter: 'all' | 'active' | 'backlog' | 'cycles'; trailing?: React.ReactNode }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const teamMenu = useMenu();
  const team = snap.teams.find(t => t.id === props.teamId);
  useEffect(() => { if (team) localStorage.setItem('baseline:issuesTeam', team.key); }, [team]);
  if (!team) return null;

  const goTeam = (key: string) => {
    teamMenu.close();
    navigate(`/team/${key}/${props.filter}`);
  };
  const chip = (t: { key: string; color: string; icon?: string }) => (
    <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 9, width: 18, height: 18 }}>
      {t.icon?.match(/\p{Emoji}/u) ? t.icon : t.key[0]}
    </span>
  );

  return (
    <div className="subnav">
      {(['active', 'backlog', 'all'] as const).map(f => (
        <button key={f} className={`seg ${props.filter === f ? 'selected' : ''}`} onClick={() => navigate(`/team/${team.key}/${f}`)}>
          {f === 'all' ? 'All issues' : f === 'active' ? 'Active' : 'Backlog'}
          {props.filter === f && <RegisterMark group="team-tabs" />}
        </button>
      ))}
      <button className="icon-btn seg-add" title="New view from this list (⌥V)" onClick={() => { const ev = new CustomEvent('baseline:save-view', { cancelable: true }); window.dispatchEvent(ev); }}><IconViews size={14} /></button>
      <span style={{ flex: 1 }} />
      {props.trailing}
      {teamMenu.anchor && (
        <Menu anchor={teamMenu.anchor} onClose={teamMenu.close}>
          {snap.teams.map(t => (
            <MenuItem key={t.id} icon={chip(t)} label={t.name} onClick={() => goTeam(t.key)} />
          ))}
        </Menu>
      )}
    </div>
  );
}

/** local-timezone label for a YYYY-MM-DD input value (shortDate parses it as UTC and can shift a day) */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ================= my issues ================= */
type MyTab = 'assigned' | 'created' | 'subscribed' | 'activity';
export function MyIssuesPage() {
  const { tab: rawTab } = useParams();
  const tab: MyTab = (['assigned', 'created', 'subscribed', 'activity'] as const).includes(rawTab as MyTab) ? rawTab as MyTab : 'assigned';
  const navigate = useNavigate();
  const snap = useApp(s => s.snap)!;
  const me = snap.currentUser;
  const [opts, patch, reset] = useViewPrefs<ViewOptions>(`baseline:view:my-issues:${tab}`, { ...TEAM_DEFAULT_OPTS, showTriage: true });
  const displayBtn = useMenu();

  const issues = useMemo(() => {
    if (tab === 'assigned') return snap.issues.filter(i => i.assigneeId === me.id);
    if (tab === 'created') return snap.issues.filter(i => i.creatorId === me.id);
    const subs = new Set(snap.subscriptions.filter(x => x.userId === me.id).map(x => x.issueId));
    return snap.issues.filter(i => subs.has(i.id));
  }, [snap.issues, snap.subscriptions, me.id, tab]);

  const empty: Record<Exclude<MyTab, 'activity'>, { title: string; desc: string }> = {
    assigned: { title: 'No issues assigned to you', desc: 'Issues assigned to you will show up here.' },
    created: { title: 'No issues created by you', desc: 'Issues you create will show up here.' },
    subscribed: { title: 'No subscriptions', desc: 'Issues you subscribe to — and the ones you create, are assigned or comment on — show up here.' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'My issues' }]} />
      <div className="subnav">
        {(['assigned', 'created', 'subscribed', 'activity'] as const).map(t => (
          <button key={t} className={`seg ${tab === t ? 'selected' : ''}`} onClick={() => navigate(`/my-issues/${t}`)}>
            {t[0].toUpperCase() + t.slice(1)}
            {tab === t && <RegisterMark group="my-issues-tabs" />}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {tab !== 'activity' && <ListToolbar opts={opts} onDisplay={displayBtn.open} />}
      </div>
      {tab === 'activity' ? <MyActivity /> : (
        <IssueListBody issues={issues} opts={opts} patch={patch} reset={reset} multiTeam
          displayAnchor={displayBtn.anchor} closeDisplay={displayBtn.close}
          emptyTitle={empty[tab].title} emptyDesc={empty[tab].desc} />
      )}
    </div>
  );
}

/** everything you did, newest first, grouped by day — Linear's My issues › Activity */
function MyActivity() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const me = snap.currentUser.id;
  const items = snap.activity.filter(a => a.userId === me && a.issueId).slice(0, 300);
  const issueOf = (id: string | null) => snap.issues.find(i => i.id === id);
  const keyOf = (i: Issue) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
  const verb = (a: typeof items[number]) => {
    const st = (id: unknown) => snap.states.find(s => s.id === id)?.name ?? '?';
    switch (a.type) {
      case 'created': return 'created';
      case 'commented': return 'commented on';
      case 'stateChanged': return `moved to ${st(a.data.to)}`;
      case 'priorityChanged': return 'changed priority of';
      case 'assigned': return 'assigned';
      case 'unassigned': return 'unassigned';
      case 'labeled': case 'unlabeled': return 'changed labels of';
      case 'renamed': return 'renamed';
      case 'described': return 'updated the description of';
      case 'projected': return 'changed the project of';
      case 'cycleChanged': return 'changed the cycle of';
      case 'dueChanged': return 'changed the due date of';
      case 'estimateChanged': return 'estimated';
      case 'archived': return 'archived';
      default: return 'updated';
    }
  };
  const dayOf = (iso: string) => {
    const d = new Date(iso); const t = new Date(); t.setHours(0, 0, 0, 0);
    if (d >= t) return 'Today';
    if (d >= new Date(t.getTime() - 86400000)) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };
  let last = '';
  if (!items.length) return <div className="content"><div className="empty-state"><Illustration name="activity" /><div className="empty-title">No activity yet</div><div className="empty-desc">Changes you make to issues show up here.</div></div></div>;
  return (
    <div className="content">
      <div className="my-activity">
        {items.map(a => {
          const issue = issueOf(a.issueId);
          if (!issue) return null;
          const day = dayOf(a.createdAt);
          const head = day !== last ? day : null;
          last = day;
          const st = snap.states.find(s => s.id === issue.stateId);
          return (
            <div key={a.id}>
              {head && <div className="inbox-group">{head}</div>}
              <button className="ma-row" onClick={() => navigate(`/issue/${keyOf(issue)}`)}>
                {st && <StateIcon type={st.type} color={st.color} size={14} />}
                <span className="issue-key">{keyOf(issue)}</span>
                <span className="ma-title">{issue.title}</span>
                <span className="ma-verb">You {verb(a)} this</span>
                <span className="rel-time">{relTime(a.createdAt)}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================= views ================= */
export function ViewsIndexPage({ kind = 'issues' }: { kind?: 'issues' | 'projects' } = {}) {
  const { teamKey } = useParams();
  const snapAll = useApp(s => s.snap)!;
  const team = teamKey ? snapAll.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase()) : undefined;
  // a team's Views page lists only that team's views; the workspace page lists them all.
  // Issues and Projects views sit on their own tabs, as in Linear
  const snap = { ...snapAll, views: snapAll.views.filter(v => v.kind === kind && (!team || v.teamId === team.id)) };
  const base = team ? `/team/${team.key}/views` : '/views';
  const navigate = useNavigate();
  const toast = useApp(s => s.toast);
  const rowMenu = useMenu();
  const [menuView, setMenuView] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement | null>(null);
  // select after mount — a focus-event select() loses to the caret's default placement
  useEffect(() => { if (renaming) renameRef.current?.select(); }, [renaming]);

  // each active filter becomes one chip: what it filters on, and the values
  const describe = (filters: ViewFilters): Array<[string, string]> => {
    const bits: Array<[string, string]> = [];
    if (filters.query) bits.push(['Text', `“${filters.query}”`]);
    if (filters.priority?.length) bits.push(['Priority', filters.priority.slice().sort().map(p => ['None', 'Urgent', 'High', 'Medium', 'Low'][p]).join(', ')]);
    if (filters.assigneeIds?.length) bits.push(['Assignee', filters.assigneeIds.map(id => snap.users.find(u => u.id === id)?.name ?? id).join(', ')]);
    if (filters.labelIds?.length) bits.push(['Label', filters.labelIds.map(id => snap.labels.find(l => l.id === id)?.name ?? id).join(', ')]);
    if (filters.projectIds?.length) bits.push(['Project', filters.projectIds.map(id => snap.projects.find(p => p.id === id)?.name ?? id).join(', ')]);
    if (filters.states?.length) bits.push(['Status', [...new Set(filters.states.map(id => snap.states.find(s => s.id === id)?.name ?? id))].join(', ')]);
    if (filters.stateTypes?.length) bits.push(['Status', filters.stateTypes.join(', ')]);
    if (filters.advanced && countConditions(filters.advanced)) bits.push(['Advanced', `${countConditions(filters.advanced)} conditions (${filters.advanced.op === 'and' ? 'all' : 'any'})`]);
    const more = activeFilterCount(filters) - bits.length;
    if (more > 0) bits.push(['+', `${more} more`]);
    return bits;
  };
  const live = snap.issues.filter(i => !i.archivedAt && !i.deletedAt);

  const createView = async () => {
    const { view } = await api.createView(kind === 'projects'
      ? { name: 'New view', kind: 'projects', projectOptions: {}, filters: {}, icon: '📁', teamId: team?.id ?? null }
      : { name: 'New view', filters: {}, icon: '🗂', teamId: team?.id ?? null });
    await useApp.getState().bootstrap();
    // land inside the fresh view with its name selected — naming it is the next natural step
    navigate(`/views/${view.id}`, { state: { rename: true } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={team ? [{ label: team.name, to: `/team/${team.key}/all`, muted: true }, { label: 'Views' }] : [{ label: 'Views' }]} right={<button className="btn secondary" onClick={createView}>＋ New view</button>} />
      <div className="subnav">
        {(['issues', 'projects'] as const).map(k => (
          <button key={k} className={`seg ${kind === k ? 'selected' : ''}`} onClick={() => navigate(k === 'issues' ? base : `${base}/projects`)}>
            {k === 'issues' ? 'Issues' : 'Projects'}{kind === k && <RegisterMark group="views-kind" />}
          </button>
        ))}
      </div>
      <div className="content">
        {snap.views.length === 0 ? (
          <div className="empty-state">
            <Illustration name="views" />
            <div className="empty-title">Views</div>
            <div className="empty-desc">{kind === 'projects' ? 'Save project filters, groupings and layouts — a roadmap, a team’s portfolio, at-risk work — and come back to them.' : 'Create views to save filters and groupings you return to.'}</div>
            <div className="empty-actions">
              <button className="btn primary" onClick={createView}>New view</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 16px' }}>
            <div className="view-grid proj-head">
              <span>Name</span><span>Filters</span><span className="num">{kind === 'projects' ? 'Projects' : 'Issues'}</span><span />
            </div>
            {snap.views.map(v => {
              const chips = kind === 'projects' ? describeProjectView(v, snapAll) : describe(v.filters);
              const count = kind === 'projects'
                ? countProjectView(v, snapAll)
                : applyFilters(live.filter(i => !v.teamId || i.teamId === v.teamId), v.filters, snap.states).length;
              const faved = snap.favorites.some(f => f.type === 'view' && f.refId === v.id);
              return (
              <div key={v.id} className="view-grid view-row" onClick={() => navigate(`/views/${v.id}`)}
                onContextMenu={(e) => { setMenuView(v.id); rowMenu.open(e); }}>
                <span className="view-name">
                <span className="view-icon">{v.icon || '🗂'}</span>
                {renaming === v.id ? (
                  <input ref={renameRef} className="text-input" style={{ height: 26, flex: 1 }} autoFocus value={renameValue}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={async () => { await api.updateView(v.id, { name: renameValue || v.name }); await useApp.getState().bootstrap(); setRenaming(null); }}
                    onKeyDown={async e => {
                      if (e.key === 'Enter') { await api.updateView(v.id, { name: renameValue || v.name }); await useApp.getState().bootstrap(); setRenaming(null); }
                      if (e.key === 'Escape') setRenaming(null);
                    }} />
                ) : (
                  <span className="row-title" style={{ fontWeight: 600 }}>{v.name}</span>
                )}
                {!team && v.teamId && <span className="view-team">{snap.teams.find(t => t.id === v.teamId)?.key}</span>}
                {faved && <IconStar size={12} filled style={{ color: 'var(--brand)', flex: 'none' }} />}
                </span>
                <span className="view-chips">
                  {chips.length === 0
                    ? <span className="view-chip all">{kind === 'projects' ? 'All projects' : 'All issues'}</span>
                    : chips.map(([k, val], i) => <span key={i} className="view-chip"><span className="vk">{k}</span>{val}</span>)}
                </span>
                <span className="pc mono num">{count}</span>
                <button className="icon-btn hover-only" title="View actions" onClick={(e) => { e.stopPropagation(); setMenuView(v.id); rowMenu.open(e); }}><IconMore size={13} /></button>
              </div>
              );
            })}
          </div>
        )}
      </div>
      {rowMenu.anchor && menuView && (
        <Menu anchor={rowMenu.anchor} onClose={() => { rowMenu.close(); setMenuView(null); }}>
          <MenuItem icon={<IconStar size={14} />} label="Toggle favorite" onClick={async () => { await api.toggleFavorite('view', menuView); await useApp.getState().bootstrap(); }} />
          <MenuItem label="Rename" onClick={() => {
            const v = snap.views.find(x => x.id === menuView);
            setRenameValue(v?.name ?? '');
            setRenaming(menuView);
            rowMenu.close();
          }} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete view" onClick={async () => {
            await api.deleteView(menuView);
            await useApp.getState().bootstrap();
            toast({ title: 'View deleted' });
          }} />
        </Menu>
      )}
    </div>
  );
}

/** the view's name rendered as the subnav tab — click it (or arrive from "New view") to rename in place */
export function ViewNameSeg(props: { view: SavedView; startEditing?: boolean }) {
  const [editing, setEditing] = useState(props.startEditing ?? false);
  const [name, setName] = useState(props.view.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(props.view.name); }, [props.view.name]);
  // select after mount — a focus-event select() loses to the caret's default placement
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const save = async () => {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== props.view.name) {
      await api.updateView(props.view.id, { name: trimmed });
      await useApp.getState().bootstrap();
      useApp.getState().toast({ title: 'View renamed', line: <>{props.view.icon} {trimmed}</> });
    }
  };
  if (editing) return (
    <input ref={inputRef} className="text-input" style={{ height: 28, width: 240, fontWeight: 600 }} autoFocus value={name}
      onChange={e => setName(e.target.value)}
      onBlur={save}
      onKeyDown={e => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') { setName(props.view.name); setEditing(false); }
      }} />
  );
  return (
    <button className="seg selected" title="Click to rename" style={{ gap: 6 }}
      onClick={() => { setName(props.view.name); setEditing(true); }}>
      {props.view.name}
      <IconEdit size={11} style={{ opacity: 0.45 }} />
    </button>
  );
}

export function SavedViewPage() {
  const { viewId = '' } = useParams();
  const view = useApp(s => s.snap!.views.find(v => v.id === viewId));
  if (view?.kind === 'projects') return <ProjectsPage key={view.id} savedView={view} />;
  return <IssueViewPage key={viewId} />;
}

function IssueViewPage() {
  const { viewId = '' } = useParams();
  const location = useLocation();
  const snap = useApp(s => s.snap)!;
  const view = snap.views.find(v => v.id === viewId);
  const defaults = useMemo<ViewOptions>(() => ({
    ...TEAM_DEFAULT_OPTS,
    filters: view?.filters ?? {},
    groupBy: (view?.groupBy as ViewOptions['groupBy']) ?? 'status',
    orderBy: (view?.orderBy as ViewOptions['orderBy']) ?? 'priority',
    layout: view?.layout ?? 'list',
  }), [view?.filters, view?.groupBy, view?.orderBy, view?.layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const [opts, patch, reset] = useViewPrefs<ViewOptions>(`baseline:view:saved:${viewId}`, defaults);
  const displayBtn = useMenu();
  const savedJson = JSON.stringify({ filters: view?.filters, groupBy: view?.groupBy, orderBy: view?.orderBy, layout: view?.layout });
  const localJson = JSON.stringify({ filters: opts.filters, groupBy: opts.groupBy, orderBy: opts.orderBy, layout: opts.layout });
  const dirty = view && savedJson !== localJson;
  const issues = useMemo(() => view?.teamId ? snap.issues.filter(i => i.teamId === view.teamId) : snap.issues, [snap.issues, view?.teamId]);
  if (!view) return <div className="empty-state"><div className="empty-title">View not found</div></div>;
  const team = view.teamId ? snap.teams.find(t => t.id === view.teamId) : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        crumbs={[...(team ? [{ label: team.name, to: `/team/${team.key}/all`, muted: true }] : []), { label: 'Views', to: '/views', muted: true }, { label: view.name, icon: <span>{view.icon || '🗂'}</span> }]}
        favoriteRef={{ type: 'view', refId: view.id }}
        right={dirty ? (
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn ghost" style={{ height: 26, fontSize: 12 }} onClick={() => reset()}>Discard changes</button>
            <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={async () => {
              await api.updateView(view.id, { filters: opts.filters, groupBy: opts.groupBy, orderBy: opts.orderBy, layout: opts.layout });
              await useApp.getState().bootstrap();
              useApp.getState().toast({ title: 'View saved' });
            }}>Save view</button>
          </span>
        ) : undefined}
      />
      <div className="subnav">
        <ViewNameSeg view={view} startEditing={Boolean((location.state as { rename?: boolean } | null)?.rename)} />
        <span style={{ flex: 1 }} />
        <ListToolbar opts={opts} onDisplay={displayBtn.open} />
      </div>
      <IssueListBody issues={issues} opts={opts} patch={patch} teamId={view.teamId ?? undefined} multiTeam={!view.teamId}
        displayAnchor={displayBtn.anchor} closeDisplay={displayBtn.close} onSaveView={null}
        emptyTitle={view.name} emptyDesc="No issues match this view right now." />
    </div>
  );
}

/* ================= label page (O then L) and profile page (O then U), as in Linear ================= */
export function LabelPage() {
  const { labelId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const displayBtn = useMenu();
  const switcher = useMenu();
  const label = snap.labels.find(l => l.id === labelId);
  const [opts, patch, reset] = useViewPrefs<ViewOptions>(`baseline:view:label:${labelId}`, { ...TEAM_DEFAULT_OPTS });
  const issues = useMemo(() => snap.issues.filter(i => i.labelIds.includes(labelId)), [snap.issues, labelId]);
  if (!label) return <div className="empty-state"><div className="es-title">Label not found</div></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        crumbs={[{ label: label.name, icon: <span className="label-dot" style={{ background: label.color }} />, onClick: switcher.open }]}
        favoriteRef={{ type: 'view', refId: `label-${label.id}` }}
        right={<ListToolbar opts={opts} onDisplay={displayBtn.open} />}
      />
      {switcher.anchor && (
        <Menu anchor={switcher.anchor} onClose={switcher.close} width={220}>
          {snap.labels.map(l => <MenuItem key={l.id} icon={<span className="label-dot" style={{ background: l.color }} />} label={l.name} selected={l.id === label.id} onClick={() => { switcher.close(); navigate(`/labels/${l.id}`); }} />)}
        </Menu>
      )}
      <IssueListBody issues={issues} opts={opts} patch={patch} reset={reset} multiTeam
        displayAnchor={displayBtn.anchor} closeDisplay={displayBtn.close}
        emptyTitle="No matching issues" emptyDesc={`Issues labelled ${label.name} show up here.`} emptyHideCreate />
    </div>
  );
}

export function ProfilePage() {
  const { userId = '', tab: rawTab } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const displayBtn = useMenu();
  const switcher = useMenu();
  const user = snap.users.find(u => u.id === userId);
  const tab = rawTab === 'created' ? 'created' : 'assigned';
  const [opts, patch, reset] = useViewPrefs<ViewOptions>(`baseline:view:profile:${tab}`, { ...TEAM_DEFAULT_OPTS });
  const issues = useMemo(() => snap.issues.filter(i => (tab === 'created' ? i.creatorId : i.assigneeId) === userId), [snap.issues, userId, tab]);
  if (!user) return <div className="empty-state"><div className="es-title">User not found</div></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: user.name, icon: <Avatar user={user} size={16} />, onClick: switcher.open }]} />
      {switcher.anchor && (
        <Menu anchor={switcher.anchor} onClose={switcher.close} width={220}>
          {snap.users.map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={u.id === user.id} onClick={() => { switcher.close(); navigate(`/profiles/${u.id}/${tab}`); }} />)}
        </Menu>
      )}
      <div className="subnav">
        {(['assigned', 'created'] as const).map(t => (
          <button key={t} className={`seg ${tab === t ? 'selected' : ''}`} onClick={() => navigate(`/profiles/${user.id}/${t}`)}>
            {t === 'assigned' ? 'Assigned' : 'Created'}
            {tab === t && <RegisterMark group="profile-tabs" />}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <ListToolbar opts={opts} onDisplay={displayBtn.open} />
      </div>
      <IssueListBody issues={issues} opts={opts} patch={patch} reset={reset} multiTeam
        displayAnchor={displayBtn.anchor} closeDisplay={displayBtn.close}
        emptyTitle={tab === 'created' ? `No issues created by ${user.name}` : `No issues assigned to ${user.name}`} emptyDesc="" emptyHideCreate />
    </div>
  );
}
