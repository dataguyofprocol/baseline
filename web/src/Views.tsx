import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useApp, useHelpers, shortDate, relTime, copyText, refresh } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Modal, Menu, MenuItem, MenuSep, useMenu, RegisterMark } from './ui.js';
import { AnimatePresence } from 'framer-motion';
import {
  GroupedList, IssueRow, FlatIssueList, FilterBar, DisplayOptionsMenu, useViewPrefs,
  DEFAULT_DISPLAY, activeFilterCount, applyFilters, type ViewOptions,
} from './IssueViews.js';
import { Board } from './Board.js';
import { Logo, LogoMark } from './Logo.js';
import { AvatarStack } from './AvatarStack.js';
import { Markdown } from './Markdown.js';
import {
  StateIcon, PriorityIcon, Avatar, Donut, DueDateMenu, EstimateMenu, CycleMenu, CalendarGrid,
  IssuePickerMenu, PROJECT_STATUS_LABELS, PROJECT_HEALTH_LABELS, HEALTH_COLORS,
  ProjectStatusMenu, ProjectHealthMenu, ProjectPriorityMenu, UserPickMenu, ProjectDatesMenu, MembersMenu,
} from './pickers.js';
import {
  IconFilter, IconDisplay, IconPlus, IconStar, IconMore, IconTrash, IconClose,
  IconCalendar, IconComment, IconAssignArrow, IconMention, IconCheck, IconCycle, IconUsers,
  IconLink, IconSettings, IconEdit, IconUser, IconChevronDown,
} from './icons.js';
import type { GroupBy, Priority, Project, ProjectHealth, SavedView, ViewFilters, Issue } from '../../src/core/types.js';

/** the right-toolbar filter icon opens the filter menu anchored to itself */
export function openFilterMenu(e: React.MouseEvent) {
  window.dispatchEvent(new CustomEvent('baseline:focus-filter', { detail: (e.currentTarget as HTMLElement).getBoundingClientRect() }));
}

/** toggle a status focus filter; cross-team board columns pass every state merged into them */
function toggleStateFilter(filters: ViewFilters, stateIds: string[]): ViewFilters {
  const on = stateIds.length > 0 && stateIds.every(id => filters.states?.includes(id));
  return { ...filters, states: on ? filters.states!.filter(s => !stateIds.includes(s)) : stateIds };
}

const TEAM_DEFAULT_OPTS: ViewOptions = {
  layout: 'list', groupBy: 'status', subgroupBy: 'none', orderBy: 'priority', showEmpty: false,
  display: DEFAULT_DISPLAY, filters: {},
};

/* ================= team issues page ================= */
export function TeamPage() {
  const { teamKey = '', filter = 'all' } = useParams();
  const snap = useApp(s => s.snap)!;
  const displayBtn = useMenu();
  const team = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
  const viewKey = `baseline:view:${teamKey}:${filter}`;
  const [opts, patch] = useViewPrefs<ViewOptions>(viewKey, { ...TEAM_DEFAULT_OPTS });

  const issues = useMemo(() => {
    if (!team) return [];
    return snap.issues.filter(i => i.teamId === team.id);
  }, [snap.issues, team]);

  const visible = useMemo(() => {
    if (!team) return [];
    let out = issues;
    if (filter === 'active') out = out.filter(i => !teamStates(snap.states, team.id, ['backlog', 'canceled']).includes(i.stateId));
    else if (filter === 'backlog') out = out.filter(i => !teamStates(snap.states, team.id, ['unstarted', 'started', 'completed', 'canceled']).includes(i.stateId));
    return applyFilters(out, opts.filters, snap.states);
  }, [issues, team, filter, snap.states, opts.filters]);

  if (!team) return <TeamMissingRedirect />;

  const faved = snap.favorites.some(f => f.type === 'view' && f.refId === `team-${team.id}-${filter}`);
  const title = filter === 'active' ? 'Active' : filter === 'backlog' ? 'Backlog' : 'All issues';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        crumbs={[
          { label: team.name, icon: <span className="ws-avatar" style={{ background: team.color, borderRadius: 4, fontSize: 9, width: 18, height: 18 }}>{team.key.slice(0, 2)}</span>, to: `/team/${team.key}`, muted: true },
          { label: 'Issues', muted: true },
          { label: title },
        ]}
        favoriteRef={{ type: 'view', refId: `team-${team.id}-${filter}` }}
      />
      <TeamSubnav
        teamId={team.id}
        filter={filter as 'all' | 'active' | 'backlog'}
        trailing={<>
          {activeFilterCount(opts.filters) > 0 && <span className="filter-count">{activeFilterCount(opts.filters)}</span>}
          <button className="icon-btn" title="Filter" onClick={openFilterMenu}><IconFilter size={15} /></button>
          <button className="icon-btn" title="Display options" onClick={displayBtn.open} style={opts.layout === 'board' ? { color: 'var(--brand)' } : undefined}><IconDisplay size={15} /></button>
        </>}
      />
      <div className="filterbar">
        <FilterBar
          filters={opts.filters}
          onChange={filters => patch({ filters })}
          teamId={team.id}
        />
      </div>

      {displayBtn.anchor && (
        <DisplayOptionsMenu opts={opts} onPatch={patch} anchor={displayBtn.anchor} onClose={displayBtn.close} />
      )}

      <div className="content">
        {opts.layout === 'list' ? (
          <GroupedList
            issues={visible}
            teamId={team.id}
            opts={opts}
            onFocusStatus={stateId => patch({ filters: toggleStateFilter(opts.filters, [stateId]) })}
          />
        ) : (
          <Board
            issues={visible}
            teamId={team.id}
            groupBy={opts.groupBy}
            orderBy={opts.orderBy}
            onFocusColumn={ids => patch({ filters: toggleStateFilter(opts.filters, ids) })}
          />
        )}
      </div>
    </div>
  );
}

function teamStates(states: Array<{ id: string; teamId: string; type: string }>, teamId: string, types: string[]): string[] {
  return states.filter(s => s.teamId === teamId && types.includes(s.type)).map(s => s.id);
}

/** A stale team route (pre-reset URL left in the tab, an old localStorage key) should
 *  fall back to the first team instead of dead-ending on "Team not found". */
function TeamMissingRedirect() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  useEffect(() => { if (snap.teams[0]) navigate(`/team/${snap.teams[0].key}/all`, { replace: true }); }, []); // eslint-disable-line
  return null;
}

/** team selector + All/Active/Backlog/Cycles tabs shared by the team issues page and the cycles page */
function TeamSubnav(props: { teamId: string; filter: 'all' | 'active' | 'backlog' | 'cycles'; trailing?: React.ReactNode }) {
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
      <button className="team-switch" onClick={teamMenu.open} title="Switch team">
        {chip(team)}
        <span>{team.name}</span>
        <IconChevronDown size={13} style={{ color: 'var(--text-secondary)' }} />
      </button>
      {(['all', 'active', 'backlog', 'cycles'] as const).map(f => (
        <button key={f} className={`seg ${props.filter === f ? 'selected' : ''}`} onClick={() => navigate(`/team/${team.key}/${f}`)}>
          {f === 'all' ? 'All issues' : f === 'active' ? 'Active' : f === 'backlog' ? 'Backlog' : 'Cycles'}
          {props.filter === f && <RegisterMark group="team-tabs" />}
        </button>
      ))}
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

/* ================= projects ================= */
export function ProjectsPage({ startWithCreate = false }: { startWithCreate?: boolean } = {}) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const toast = useApp(s => s.toast);
  const rowMenu = useMenu();
  const [menuProject, setMenuProject] = useState<string | null>(null);
  const [creating, setCreating] = useState(startWithCreate);
  // when mounted on /projects/new (palette/route entry), closing lands the URL back on the list
  const closeCreate = () => { setCreating(false); if (startWithCreate) navigate('/projects', { replace: true }); };

  const del = async (projectId: string) => {
    const p = snap.projects.find(x => x.id === projectId);
    await api.deleteProject(projectId);
    await useApp.getState().bootstrap();
    toast({ title: 'Project deleted', line: p ? <>{p.icon} {p.name}</> : undefined });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Projects' }]} right={<button className="btn" onClick={() => setCreating(true)}>＋ New project</button>} />
      <div className="subnav">
        <button className="seg selected">All projects</button>
      </div>
      <div className="content">
        {snap.projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-mark"><LogoMark size={30} /></div>
            <div className="empty-title">Projects</div>
            <div className="empty-desc">Projects are larger units of work with a clear outcome, such as a new feature you want to ship. They can be shared across multiple teams and are comprised of issues and optional documents.</div>
            <div className="empty-actions">
              <button className="btn primary" onClick={() => setCreating(true)}>Create new project <span className="btn-kbd kbd">N</span><span className="kbd">P</span></button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 16px' }}>
            <div className="proj-grid proj-head">
              <span>Name</span><span>Health</span><span>Priority</span><span>Lead</span><span>Target date</span><span>Issues</span><span>Status</span>
            </div>
            {snap.projects.map(p => {
              const prog = progressOf(snap, p.id);
              const lead = snap.users.find(u => u.id === p.leadId);
              const issueCount = snap.issues.filter(i => i.projectId === p.id).length;
              const faved = snap.favorites.some(f => f.type === 'project' && f.refId === p.id);
              return (
                <div
                  key={p.id}
                  className="proj-row proj-grid" style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  onContextMenu={(e) => { setMenuProject(p.id); rowMenu.open(e); }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="proj-icon" style={{ background: 'var(--bg-hover)' }}>{p.icon}</span>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    {faved && <IconStar size={12} filled style={{ color: 'var(--brand)' }} />}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                    <span style={{ color: HEALTH_COLORS[p.health] }}>●</span>
                    {PROJECT_HEALTH_LABELS[p.health]}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    {p.priority ? <PriorityIcon priority={p.priority} size={14} /> : <span style={{ color: 'var(--text-dim)' }}>---</span>}
                  </span>
                  <span style={{ display: 'flex' }}><Avatar user={lead} size={20} /></span>
                  <span style={{ color: 'var(--text-secondary)' }}>{p.targetDate ? shortDate(p.targetDate) : '---'}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{issueCount}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Donut percent={prog} />
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{prog}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {rowMenu.anchor && menuProject && (
        <Menu anchor={rowMenu.anchor} onClose={() => { rowMenu.close(); setMenuProject(null); }}>
          <MenuItem icon={<IconStar size={14} />} label="Toggle favorite" onClick={async () => { await api.toggleFavorite('project', menuProject); await useApp.getState().bootstrap(); }} />
          <MenuItem label="Copy link" onClick={async () => {
            if (await copyText(`${location.origin}${location.pathname}#/projects/${menuProject}`)) useApp.getState().toast({ title: 'Copied link' });
            else useApp.getState().toast({ title: 'Clipboard unavailable' });
          }} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete project" onClick={() => del(menuProject)} />
        </Menu>
      )}
      <AnimatePresence>{creating && <NewProjectModal key="np" onClose={closeCreate} />}</AnimatePresence>
    </div>
  );
}

function progressOf(snap: NonNullable<ReturnType<typeof useApp.getState>['snap']>, projectId: string): number {
  const issues = snap.issues.filter(i => i.projectId === projectId);
  if (!issues.length) return 0;
  const done = issues.filter(i => {
    const st = snap.states.find(s => s.id === i.stateId);
    return st?.type === 'completed' || st?.type === 'canceled';
  }).length;
  return Math.round((done / issues.length) * 100);
}

/* ================= new project ================= */
const PROJECT_ICONS = ['🧊', '🤖', '📱', '🎨', '🚀', '⚡', '🔧', '📦', '🌐', '💡', '🧪', '📊', '🔒', '🛠️', '📝', '🎯'];

/** local-timezone label for a YYYY-MM-DD input value (shortDate parses it as UTC and can shift a day) */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** same status dot coloring the project detail properties use */
function statusGlyph(s: string) {
  return (
    <span style={{ color: s === 'started' ? '#f2c94c' : s === 'completed' ? '#4cb782' : s === 'paused' ? '#f2994a' : '#8a8f98', display: 'flex' }}>
      <StateIcon type={s === 'started' ? 'started' : s === 'completed' ? 'completed' : s === 'paused' ? 'canceled' : 'unstarted'} size={13} />
    </span>
  );
}

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('🧊');
  const [status, setStatus] = useState<Project['status']>('planned');
  const [priority, setPriority] = useState<Priority>(0);
  const [leadId, setLeadId] = useState<string | null>(snap.currentUser.id);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const iconMenu = useMenu();
  const statusMenu = useMenu();
  const priorityMenu = useMenu();
  const membersMenu = useMenu();
  const startMenu = useMenu();
  const targetMenu = useMenu();

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    const { project } = await api.createProject({
      name: name.trim(), description, icon, status,
      startDate: startDate || null, targetDate: targetDate || null,
      leadId, priority, memberIds, teamId: snap.teams[0]?.id ?? null,
    });
    await refresh();
    onClose();
    navigate(`/projects/${project.id}`);
    useApp.getState().toast({ title: 'Project created', line: <>{icon} {project.name}</> });
  };

  // ⌘/Ctrl+Enter creates from anywhere in the modal (menus portal outside this
  // wrapper, but their React events still bubble here — so exclude them)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('.menu')) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (name.trim()) void create();
    } else if (e.key === 'Enter' && !e.shiftKey && e.target === nameRef.current) {
      e.preventDefault();
      descRef.current?.focus();
    }
  };

  const lead = snap.users.find(u => u.id === leadId);
  return (
    <Modal onClose={onClose} className="modal modal-create np-modal">
      <div className="cm-root" onKeyDown={onKeyDown}>
        <div className="cm-header">
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>New project</span>
          <span style={{ marginLeft: 'auto', display: 'flex' }}>
            <button className="icon-btn" onClick={onClose}><IconClose size={14} /></button>
          </span>
        </div>

        <div className="np-head">
          <button className="np-icon" onClick={iconMenu.open} title="Choose icon">{icon}</button>
          <input ref={nameRef} className="np-name" placeholder="Project name" value={name} spellCheck={false}
            onChange={e => setName(e.target.value)} />
        </div>

        <div className="cm-pills">
          <button className="prop-chip" onClick={statusMenu.open}>
            {statusGlyph(status)}
            {PROJECT_STATUS_LABELS[status]}
          </button>
          <button className="prop-chip" onClick={priorityMenu.open}>
            <PriorityIcon priority={priority} size={13} />
            {priority === 0 ? 'Priority' : ['', 'Urgent', 'High', 'Medium', 'Low'][priority]}
          </button>
          <UserPickMenu title="Set lead to…" value={leadId} onPick={setLeadId}>
            {({ open }) => (
              <button className="prop-chip" onClick={open}>
                {lead
                  ? <Avatar user={lead} size={16} />
                  : <IconUser size={13} style={{ color: 'var(--text-dim)', margin: '0 1px' }} />}
                {lead ? lead.name.split(' ')[0] : 'Lead'}
              </button>
            )}
          </UserPickMenu>
          <button className="prop-chip" onClick={membersMenu.open}>
            <IconUsers size={13} style={{ color: 'var(--text-dim)' }} />
            {memberIds.length
              ? memberIds.map(id => snap.users.find(u => u.id === id)?.name.split(' ')[0]).filter(Boolean).join(', ')
              : 'Members'}
          </button>
          <button className="prop-chip" onClick={startMenu.open}>
            <IconCalendar size={13} style={{ color: 'var(--text-dim)' }} />
            {startDate ? dateLabel(startDate) : 'Start date'}
          </button>
          <button className="prop-chip" onClick={targetMenu.open}>
            <IconCalendar size={13} style={{ color: 'var(--text-dim)' }} />
            {targetDate ? dateLabel(targetDate) : 'Target date'}
          </button>
        </div>

        <div className="np-desc">
          <textarea ref={descRef} value={description} spellCheck={false}
            onChange={e => setDescription(e.target.value)}
            placeholder="Write a description, a project brief, or collect ideas…" />
        </div>

        <div className="cm-footer">
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={create} disabled={!name.trim()}>
              Create project
              <span className="btn-kbd kbd">⌘↵</span>
            </button>
          </div>
        </div>
      </div>

      {iconMenu.anchor && (
        <Menu anchor={iconMenu.anchor} onClose={iconMenu.close} width={252}>
          <div className="menu-header"><span>Choose icon</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 10px 10px' }}>
            {PROJECT_ICONS.map(ic => (
              <button key={ic} className={`proj-icon ${icon === ic ? 'sel' : ''}`}
                style={{ width: 30, height: 30, fontSize: 17, background: icon === ic ? 'var(--brand-dim)' : 'var(--bg-hover)' }}
                onClick={() => { setIcon(ic); iconMenu.close(); }}>{ic}</button>
            ))}
          </div>
        </Menu>
      )}
      {statusMenu.anchor && (
        <Menu anchor={statusMenu.anchor} onClose={statusMenu.close} width={200}>
          <div className="menu-header"><span>Change status…</span></div>
          {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
            <MenuItem key={value} icon={statusGlyph(value)} label={label} selected={status === value}
              onClick={() => { setStatus(value as Project['status']); statusMenu.close(); }} />
          ))}
        </Menu>
      )}
      {priorityMenu.anchor && (
        <Menu anchor={priorityMenu.anchor} onClose={priorityMenu.close} width={210}>
          <div className="menu-header"><span>Set priority to…</span></div>
          {([[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']] as Array<[Priority, string]>).map(([v, label], i) => (
            <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={label} selected={priority === v}
              right={<span className="kbd">{i}</span>} onClick={() => { setPriority(v); priorityMenu.close(); }} />
          ))}
        </Menu>
      )}
      {membersMenu.anchor && (
        <Menu anchor={membersMenu.anchor} onClose={membersMenu.close} width={220}>
          <div className="menu-header"><span>Members</span></div>
          {/* raw menu-item buttons (not MenuItem) so a toggle doesn't auto-close — multi-select stays open */}
          {snap.users.map(u => {
            const on = memberIds.includes(u.id);
            return (
              <button key={u.id} className="menu-item"
                onClick={() => setMemberIds(prev => prev.includes(u.id) ? prev.filter(x => x !== u.id) : [...prev, u.id])}>
                <span className="mi-icon"><Avatar user={u} size={18} /></span>
                <span className="mi-label">{u.name}</span>
                <span className="mi-right">{on && <IconCheck size={13} />}</span>
              </button>
            );
          })}
        </Menu>
      )}
      {startMenu.anchor && (
        <Menu anchor={startMenu.anchor} onClose={startMenu.close} width={250}>
          <div className="menu-header"><span>Start date</span></div>
          <CalendarGrid selected={startDate || undefined} onPick={iso => { setStartDate(iso); startMenu.close(); }} />
          {startDate && <MenuItem label="Clear start date" onClick={() => { setStartDate(''); startMenu.close(); }} />}
        </Menu>
      )}
      {targetMenu.anchor && (
        <Menu anchor={targetMenu.anchor} onClose={targetMenu.close} width={250}>
          <div className="menu-header"><span>Target date</span></div>
          <CalendarGrid selected={targetDate || undefined} onPick={iso => { setTargetDate(iso); targetMenu.close(); }} />
          {targetDate && <MenuItem label="Clear target date" onClick={() => { setTargetDate(''); targetMenu.close(); }} />}
        </Menu>
      )}
    </Modal>
  );
}

/** deep-link/palette entry: projects list with the create modal already open */
export function NewProjectPage() {
  return <ProjectsPage startWithCreate />;
}

/* ================= project detail ================= */
export function ProjectPage() {
  const { projectId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const openCreate = useApp(s => s.openCreate);
  const toast = useApp(s => s.toast);
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'issues'>('overview');
  const projectMenu = useMenu();
  const viewKey = `baseline:view:project:${projectId}`;
  const [opts, patch] = useViewPrefs<ViewOptions>(viewKey, { ...TEAM_DEFAULT_OPTS, groupBy: 'status' });
  const project = snap.projects.find(p => p.id === projectId);
  if (!project) return <div className="empty-state"><div className="empty-title">Project not found</div></div>;
  const issues = snap.issues.filter(i => i.projectId === project.id);
  const visibleIssues = applyFilters(issues, opts.filters, snap.states);
  const prog = progressOf(snap, project.id);
  const lead = snap.users.find(u => u.id === project.leadId);
  const updates = snap.projectUpdates.filter(u => u.projectId === project.id);
  const milestones = snap.milestones.filter(m => m.projectId === project.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        crumbs={[{ label: 'Projects', to: '/projects', muted: true }, { label: project.name, icon: <span className="proj-icon" style={{ background: 'var(--bg-hover)', width: 18, height: 18, fontSize: 11 }}>{project.icon}</span> }]}
        favoriteRef={{ type: 'project', refId: project.id }}
        right={<div className="issue-toolbar">
          <button className="icon-btn" title="Copy link" onClick={async () => {
            if (await copyText(location.href)) toast({ title: 'Copied link' });
            else toast({ title: 'Clipboard unavailable' });
          }}><IconLink size={15} /></button>
          <button className="icon-btn" title="Project options" onClick={projectMenu.open}><IconSettings size={15} /></button>
        </div>}
      />
      <div className="subnav" style={{ paddingTop: 0 }}>
        {(['overview', 'issues'] as const).map(t => (
          <button key={t} className={`tab ${tab === t ? 'selected' : ''}`} onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>
            {t}{tab === t && <RegisterMark group="project-tabs" />}
          </button>
        ))}
      </div>
      <div className="content">
        {tab === 'overview' ? (
          <div style={{ display: 'flex', minHeight: '100%' }}>
            <div style={{ flex: 1, minWidth: 0, padding: '4px 40px 80px' }}>
              <div className="issue-col" style={{ maxWidth: 760 }}>
                <EditableProjectHeader project={project} />
                <ProjectPropertiesRow project={project} />
                <UpdatesSection projectId={project.id} updates={updates} />
                <MilestonesSection projectId={project.id} milestones={milestones} />
                <ProjectDescription project={project} />
              </div>
            </div>
            <ProjectRail project={project} prog={prog} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div className="filterbar">
              <button className="filter-pill" onClick={() => openCreate({ projectId: project.id, teamId: project.teamId ?? snap.teams[0]?.id })}><IconPlus size={12} /> New issue</button>
              <IssuePickerMenu title="Add existing issue…" onPick={async (issue: Issue) => {
                await api.updateIssue(issue.id, { projectId: project.id });
                await useApp.getState().bootstrap();
                toast({ title: `${issue.title} added to ${project.name}` });
              }}>
                {({ open }) => <button className="filter-pill" onClick={open}>＋ Add existing issue</button>}
              </IssuePickerMenu>
              <FilterBar filters={opts.filters} onChange={filters => patch({ filters })} teamId={project.teamId ?? undefined} />
              <span style={{ flex: 1 }} />
              {activeFilterCount(opts.filters) > 0 && <span className="filter-count">{activeFilterCount(opts.filters)}</span>}
              <button className="icon-btn" title="Filter" onClick={openFilterMenu}><IconFilter size={15} /></button>
              <button className="icon-btn" title="Display options" onClick={projectMenu.open} style={opts.layout === 'board' ? { color: 'var(--brand)' } : undefined}><IconDisplay size={15} /></button>
            </div>
            <div className="content">
              {opts.layout === 'list' ? (
                <GroupedList issues={visibleIssues} teamId={project.teamId ?? undefined} opts={opts} emptyTitle="No issues in this project yet" emptyDesc="Create a new issue or add an existing one to start tracking work for this project." emptyHideCreate />
              ) : (
                <Board
                  issues={visibleIssues}
                  teamId={project.teamId ?? undefined}
                  groupBy={opts.groupBy}
                  orderBy={opts.orderBy}
                  onFocusColumn={ids => patch({ filters: toggleStateFilter(opts.filters, ids) })}
                />
              )}
            </div>
          </div>
        )}
      </div>
      {projectMenu.anchor && tab === 'overview' && (
        <Menu anchor={projectMenu.anchor} onClose={projectMenu.close}>
          <MenuItem label="Copy project URL" onClick={async () => {
            if (await copyText(location.href)) toast({ title: 'Copied project URL' });
            else toast({ title: 'Clipboard unavailable' });
          }} />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete project" onClick={async () => {
            await api.deleteProject(project.id);
            await useApp.getState().bootstrap();
            navigate('/projects');
            toast({ title: 'Project deleted', line: <>{project.icon} {project.name}</> });
          }} />
        </Menu>
      )}
      {projectMenu.anchor && tab === 'issues' && (
        <DisplayOptionsMenu opts={opts} onPatch={patch} anchor={projectMenu.anchor} onClose={projectMenu.close} />
      )}
    </div>
  );
}

function EditableProjectHeader(props: { project: NonNullable<ReturnType<typeof useApp.getState>['snap']>['projects'][number] }) {
  const project = props.project;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const save = async (patch: Record<string, unknown>) => {
    await api.updateProject(project.id, patch);
    await useApp.getState().bootstrap();
    setEditing(false);
  };
  return (
    <div className="proj-page-hero">
      <div className="proj-icon" style={{ width: 32, height: 32, fontSize: 19, borderRadius: 8, background: 'var(--bg-hover)', marginBottom: 12 }}>{project.icon}</div>
      {editing ? (
        <input className="text-input" style={{ fontSize: 21, fontWeight: 600, height: 38, background: 'var(--bg-input)' }} autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => save({ name })}
          onKeyDown={e => { if (e.key === 'Enter') save({ name }); if (e.key === 'Escape') setEditing(false); }} />
      ) : (
        <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.017em', cursor: 'text' }} onClick={() => setEditing(true)}>{project.name}</div>
      )}
    </div>
  );
}

function HealthDot({ health }: { health: ProjectHealth }) {
  return <span style={{ width: 8, height: 8, borderRadius: 99, background: HEALTH_COLORS[health], flex: 'none' }} />;
}

function ProjectPropertiesRow(props: { project: NonNullable<ReturnType<typeof useApp.getState>['snap']>['projects'][number] }) {
  const project = props.project;
  const snap = useApp(s => s.snap)!;
  const lead = snap.users.find(u => u.id === project.leadId);
  return (
    <div className="proj-props">
      <div className="proj-props-label">Properties</div>
      <div className="proj-props-list">
        <ProjectStatusMenu project={project}>
          {({ open }) => <button className="proj-chip" onClick={open}>
            <StateIcon type={project.status === 'started' ? 'started' : project.status === 'completed' ? 'completed' : project.status === 'paused' ? 'canceled' : 'unstarted'} size={13} />
            {PROJECT_STATUS_LABELS[project.status]}
          </button>}
        </ProjectStatusMenu>
        <ProjectHealthMenu project={project}>
          {({ open }) => <button className="proj-chip" onClick={open}><HealthDot health={project.health} /> {PROJECT_HEALTH_LABELS[project.health]}</button>}
        </ProjectHealthMenu>
        <ProjectPriorityMenu project={project}>
          {({ open }) => <button className={`proj-chip ${project.priority === 0 ? 'dim' : ''}`} onClick={open}><PriorityIcon priority={project.priority} size={13} /> {project.priority === 0 ? 'Priority' : ['', 'Urgent', 'High', 'Medium', 'Low'][project.priority]}</button>}
        </ProjectPriorityMenu>
        <UserPickMenu title="Set lead to…" value={project.leadId} onPick={async uid => { await api.updateProject(project.id, { leadId: uid }); await useApp.getState().bootstrap(); }}>
          {({ open }) => <button className={`proj-chip ${lead ? '' : 'dim'}`} onClick={open}>{lead ? <><Avatar user={lead} size={16} /> {lead.name}</> : 'Lead'}</button>}
        </UserPickMenu>
        <ProjectDatesMenu project={project}>
          {({ open }) => <button className={`proj-chip ${project.targetDate || project.startDate ? '' : 'dim'}`} onClick={open}>
            <IconCalendar size={13} />
            {project.startDate || project.targetDate
              ? <>{project.startDate ? shortDate(project.startDate) : 'Start'} → {project.targetDate ? shortDate(project.targetDate) : 'Target'}</>
              : 'Target date'}
          </button>}
        </ProjectDatesMenu>
      </div>
    </div>
  );
}

function ProjectDescription(props: { project: NonNullable<ReturnType<typeof useApp.getState>['snap']>['projects'][number] }) {
  const project = props.project;
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(project.description);
  useEffect(() => { setDesc(project.description); setEditing(false); }, [project.id, project.description]);
  const save = async () => {
    setEditing(false);
    if (desc !== project.description) { await api.updateProject(project.id, { description: desc }); await useApp.getState().bootstrap(); }
  };
  return (
    <div style={{ marginTop: 26 }}>
      <div className="sec-label" style={{ marginBottom: 6 }}>Description</div>
      {editing ? (
        <div className="comment-box" style={{ padding: 0 }}>
          <textarea autoFocus value={desc} onChange={e => setDesc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}
            onBlur={save}
            style={{ padding: '10px 12px', minHeight: 110 }} placeholder="Add description…" />
        </div>
      ) : (
        <div onClick={() => setEditing(true)} style={{ cursor: 'text' }}>
          {project.description ? <Markdown text={project.description} /> : <div style={{ color: 'var(--text-dim)' }}>Add description…</div>}
        </div>
      )}
    </div>
  );
}

function UpdatesSection(props: { projectId: string; updates: Array<{ id: string; userId: string; body: string; health: ProjectHealth | null; createdAt: string }> }) {
  const snap = useApp(s => s.snap)!;
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [health, setHealth] = useState<ProjectHealth>('onTrack');
  const submit = async () => {
    if (!body.trim()) return;
    await api.addProjectUpdate(props.projectId, body.trim(), health);
    setBody(''); setComposing(false);
    await useApp.getState().bootstrap();
  };
  return (
    <div style={{ marginTop: 20 }}>
      {composing ? (
        <div className="comment-box">
          <div style={{ display: 'flex', gap: 4, padding: '2px 2px 0' }}>
            {(['onTrack', 'atRisk', 'offTrack'] as ProjectHealth[]).map(h => (
              <button key={h} className={`proj-chip ${health === h ? 'on' : ''}`} style={{ height: 26 }} onClick={() => setHealth(h)}>
                <HealthDot health={h} /> {PROJECT_HEALTH_LABELS[h]}
              </button>
            ))}
          </div>
          <textarea autoFocus value={body} onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }}
            placeholder="Share an update with your team…" style={{ minHeight: 80 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '4px 2px 2px' }}>
            <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={() => setComposing(false)}>Cancel</button>
            <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={submit} disabled={!body.trim()}>Update</button>
          </div>
        </div>
      ) : (
        <button className="update-compose" onClick={() => setComposing(true)}>
          <IconEdit size={14} />
          Write a project update
        </button>
      )}
      {props.updates.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {props.updates.map(u => (
            <div key={u.id} className="comment-card">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <Avatar user={snap.users.find(x => x.id === u.userId)} size={18} />
                <b>{snap.users.find(x => x.id === u.userId)?.name}</b>
                {u.health && <span className="proj-update-health"><HealthDot health={u.health} /> {PROJECT_HEALTH_LABELS[u.health]}</span>}
                <span className="rel-time">{relTime(u.createdAt)}</span>
              </div>
              <Markdown text={u.body} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MilestonesSection(props: { projectId: string; milestones: Array<{ id: string; name: string; targetDate: string | null; status: string }> }) {
  const toast = useApp(s => s.toast);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    await api.createMilestone({ projectId: props.projectId, name: name.trim(), targetDate: target || null });
    setName(''); setTarget(''); setAdding(false);
    await useApp.getState().bootstrap();
  };
  const nextStatus = (s: string) => (s === 'planned' ? 'inProgress' : s === 'inProgress' ? 'done' : 'planned');
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div className="sec-label">Milestones</div>
        <button className="proj-chip dim" style={{ height: 26 }} onClick={() => setAdding(a => !a)}><IconPlus size={12} /> Milestone</button>
      </div>
      {adding && (
        <div style={{ display: 'flex', gap: 6, margin: '6px 0 8px' }}>
          <input className="text-input" autoFocus placeholder="Milestone name" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setAdding(false); }} />
          <input type="date" className="text-input" style={{ width: 140 }} value={target} onChange={e => setTarget(e.target.value)} />
          <button className="btn primary" style={{ height: 30 }} onClick={create}>Add</button>
        </div>
      )}
      {props.milestones.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {props.milestones.map(m => (
            <div key={m.id} className="ms-row group">
              <button className="ms-state" title="Click to advance status" onClick={async () => { await api.updateMilestone(m.id, { status: nextStatus(m.status) }); await useApp.getState().bootstrap(); }}>
                <StateIcon type={m.status === 'done' ? 'completed' : m.status === 'inProgress' ? 'started' : 'unstarted'} size={13} />
              </button>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{m.targetDate ? shortDate(m.targetDate) : ''}</span>
              <button className="icon-btn hover-only" title="Delete milestone" onClick={async () => { await api.deleteMilestone(m.id); await useApp.getState().bootstrap(); toast({ title: 'Milestone deleted' }); }}>
                <IconTrash size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {props.milestones.length === 0 && !adding && (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: '17px', marginTop: 6 }}>
          Add milestones to organize work within your project and break it into more granular stages.
        </div>
      )}
    </div>
  );
}

function ProjectRail(props: { project: NonNullable<ReturnType<typeof useApp.getState>['snap']>['projects'][number]; prog: number }) {
  const project = props.project;
  const snap = useApp(s => s.snap)!;
  const lead = snap.users.find(u => u.id === project.leadId);
  const activity = snap.activity.filter(a => a.projectId === project.id).slice(0, 5);
  return (
    <aside className="props-rail">
      <div className="rail-card">
        <div className="rail-card-header">Properties</div>
        <ProjectStatusMenu project={project}>
          {({ open }) => (
            <button className="rail-kv" onClick={open}>
              <span className="rail-kv-label">Status</span>
              <span className="rail-kv-value">
                <StateIcon type={project.status === 'started' ? 'started' : project.status === 'completed' ? 'completed' : project.status === 'paused' ? 'canceled' : 'unstarted'} size={13} />
                {PROJECT_STATUS_LABELS[project.status]}
              </span>
            </button>
          )}
        </ProjectStatusMenu>
        <ProjectPriorityMenu project={project}>
          {({ open }) => (
            <button className="rail-kv" onClick={open}>
              <span className="rail-kv-label">Priority</span>
              <span className={`rail-kv-value ${project.priority === 0 ? 'dim' : ''}`}>
                <PriorityIcon priority={project.priority} size={13} />
                {project.priority === 0 ? 'No priority' : ['', 'Urgent', 'High', 'Medium', 'Low'][project.priority]}
              </span>
            </button>
          )}
        </ProjectPriorityMenu>
        <UserPickMenu title="Set lead to…" value={project.leadId} onPick={async uid => { await api.updateProject(project.id, { leadId: uid }); await useApp.getState().bootstrap(); }}>
          {({ open }) => (
            <button className="rail-kv" onClick={open}>
              <span className="rail-kv-label">Lead</span>
              <span className={`rail-kv-value ${lead ? '' : 'dim'}`}>
                <Avatar user={lead} size={16} />
                {lead?.name ?? 'Add lead'}
              </span>
            </button>
          )}
        </UserPickMenu>
        <MembersMenu project={project}>
          {({ open }) => (
            <button className="rail-kv" onClick={open}>
              <span className="rail-kv-label">Members</span>
              <span className={`rail-kv-value ${project.memberIds.length ? '' : 'dim'}`}>
                <span style={{ display: 'flex' }}>
                  {/* overlapping avatars punch a gap in the one behind, no surface-coloured ring */}
                  <AvatarStack size={16} people={project.memberIds.slice(0, 3)
                    .map(id => snap.users.find(u => u.id === id))
                    .filter(Boolean)
                    .map(u => ({ name: u!.name, initials: u!.initials, color: u!.color }))} />
                  {project.memberIds.length === 0 && <IconUsers size={13} />}
                </span>
                {project.memberIds.length ? `${project.memberIds.length} member${project.memberIds.length !== 1 ? 's' : ''}` : 'Add members'}
              </span>
            </button>
          )}
        </MembersMenu>
        <ProjectDatesMenu project={project}>
          {({ open }) => (
            <button className="rail-kv" onClick={open}>
              <span className="rail-kv-label">Dates</span>
              <span className={`rail-kv-value ${project.startDate || project.targetDate ? '' : 'dim'}`}>
                <IconCalendar size={13} />
                {project.startDate ? shortDate(project.startDate) : 'Start'} → {project.targetDate ? shortDate(project.targetDate) : 'Target'}
              </span>
            </button>
          )}
        </ProjectDatesMenu>
        <div className="rail-kv">
          <span className="rail-kv-label">Progress</span>
          <span className="rail-kv-value"><Donut percent={props.prog} size={13} /> {props.prog}%</span>
        </div>
      </div>
      <div className="rail-card">
        <div className="rail-card-header">Activity</div>
        {activity.length === 0 && <div className="rail-kv"><span className="rail-kv-value dim">No activity yet.</span></div>}
        {activity.map(a => (
          <div key={a.id} className="rail-activity">
            <span style={{ color: 'var(--text-secondary)', display: 'flex', paddingTop: 1, fontSize: 12 }}>{project.icon}</span>
            <span style={{ fontSize: 12, lineHeight: '17px', color: 'var(--text-secondary)', minWidth: 0 }}>
              <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{snap.users.find(u => u.id === a.userId)?.name}</b>{' '}
              {a.type === 'projectCreated' ? 'created the project' : a.type === 'projectHealth' ? `set health to ${PROJECT_HEALTH_LABELS[String(a.data.to)] ?? String(a.data.to)}` : a.type === 'projectUpdated' ? `updated ${((a.data.fields as string[]) ?? []).join(', ')}` : 'updated the project'}
              {' · '}{relTime(a.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ================= inbox ================= */
export function InboxPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const notifications = snap.notifications;
  const unread = notifications.filter(n => !n.readAt).length;

  const label = (n: typeof notifications[number]) => {
    const issue = n.issueId ? snap.issues.find(i => i.id === n.issueId) : undefined;
    const team = issue ? snap.teams.find(t => t.id === issue.teamId) : undefined;
    const key = issue && team ? `${team.key}-${issue.number}` : '';
    if (n.type === 'issueAssignedToYou') return { text: 'assigned you', issue, key, icon: <IconAssignArrow size={14} /> };
    if (n.type === 'issueCommented') return { text: 'commented on', issue, key, icon: <IconComment size={14} /> };
    if (n.type === 'issueMentioned') return { text: 'mentioned you on', issue, key, icon: <IconMention size={14} /> };
    if (n.type === 'systemUpdate') return { text: '', issue, key, icon: undefined };
    return { text: 'updated', issue, key, icon: <IconComment size={14} /> };
  };

  /* Multiple actors on the same issue collapse into one row with a punched-gap
     stack — two people saying the same thing about BAS-214 is one thing to read,
     not two. Only same-issue, same-kind, same-day notifications merge; the merged
     row keeps the newest timestamp and stays unread while any part is unread. */
  type Row = { lead: typeof notifications[number]; actors: string[]; ids: string[]; unread: boolean };
  const collapse = (items: typeof notifications): Row[] => {
    const rows: Row[] = [];
    for (const n of items) {
      const kind = n.type === 'issueMentioned' ? 'issueMentioned' : n.type;
      const hit = n.issueId ? rows.find(r => r.lead.issueId === n.issueId && (r.lead.type === 'issueMentioned' ? 'issueMentioned' : r.lead.type) === kind) : undefined;
      if (hit) {
        if (n.actorId && !hit.actors.includes(n.actorId)) hit.actors.push(n.actorId);
        hit.ids.push(n.id);
        hit.unread = hit.unread || !n.readAt;
      } else {
        rows.push({ lead: n, actors: n.actorId ? [n.actorId] : [], ids: [n.id], unread: !n.readAt });
      }
    }
    return rows;
  };

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const groups: Array<[string, typeof notifications, number]> = [];
  const today = notifications.filter(n => new Date(n.createdAt) >= startOfToday);
  const yesterday = notifications.filter(n => new Date(n.createdAt) >= startOfYesterday && new Date(n.createdAt) < startOfToday);
  const earlier = notifications.filter(n => new Date(n.createdAt) < startOfYesterday);
  if (today.length) groups.push(['Today', today, 0]);
  if (yesterday.length) groups.push(['Yesterday', yesterday, today.length]);
  if (earlier.length) groups.push(['Earlier', earlier, today.length + yesterday.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Inbox' }]} right={
        unread > 0 ? <button className="btn secondary" style={{ height: 26, fontSize: 12 }} onClick={async () => { await api.markAllNotificationsRead(); await useApp.getState().bootstrap(); }}>Mark all as read</button> : undefined
      } />
      <div className="content">
        {notifications.length === 0 ? (
          <div className="empty-state">
            <div className="empty-mark"><LogoMark size={30} /></div>
            <div className="empty-title">You're all caught up</div>
            <div className="empty-desc">Notifications about assignments, mentions and comments will show up here.</div>
          </div>
        ) : (
          <div style={{ padding: '6px 16px' }}>
            {groups.map(([name, items]) => (
              <div key={name}>
                <div className="group-header" style={{ marginTop: 8 }}>
                  <span>{name}</span>
                  <span className="count">{collapse(items).length}</span>
                  <span className="gh-rule" />
                </div>
                {collapse(items).map(row => {
                  const n = row.lead;
                  const l = label(n);
                  const actors = row.actors.map(a => snap.users.find(u => u.id === a)).filter(Boolean) as NonNullable<ReturnType<typeof snap.users.find>>[];
                  const read = async (value: boolean) => {
                    for (const nid of row.ids) await api.markNotificationRead(nid, value);
                    await useApp.getState().bootstrap();
                  };
                  const others = actors.length > 1 ? ` and ${actors.length - 1} other${actors.length > 2 ? 's' : ''}` : '';
                  return (
                    <div
                      key={n.id}
                      className={`inbox-row ${row.unread ? 'unread' : ''}`}
                      onClick={async () => {
                        await read(true);
                        if (l.key) navigate(`/issue/${l.key}`);
                      }}
                    >
                      {/* unread is a paper node in its own 6px gutter — no wash, no rail */}
                      <span className="inbox-node" />
                      {actors.length > 1 ? (
                        /* several actors on one issue: the punched-gap stack, not a row each */
                        <span style={{ display: 'flex', paddingTop: 1 }}>
                          <AvatarStack size={24} people={actors.map(a => ({ name: a.name, initials: a.initials, color: a.color }))} />
                        </span>
                      ) : actors.length === 1 ? <Avatar user={actors[0]} size={24} /> : (
                        /* no human actor: the app signs as its own tile */
                        <span style={{ display: 'flex', paddingTop: 4 }}><Logo size={16} /></span>
                      )}
                      <div className="inbox-body">
                        <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {l.icon && <span style={{ color: 'var(--text-secondary)', display: 'flex' }}>{l.icon}</span>}
                          <span>
                            <b>{actors[0]?.name ?? 'Baseline'}</b>{others} {l.text}{' '}
                            {l.issue ? <b>{l.issue.title}</b> : n.body}
                          </span>
                        </div>
                        {(n.type === 'issueCommented' || n.type === 'issueMentioned') && <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>}
                        {/* rel-time and key ride one mono line: "2h · BAS-214" */}
                        <div className="rel-time">{relTime(n.createdAt)} · {l.key || 'SYSTEM'}</div>
                      </div>
                      <button
                        className="icon-btn hover-only" title={row.unread ? 'Mark read' : 'Mark unread'}
                        onClick={async (e) => { e.stopPropagation(); await read(row.unread); }}
                      ><IconCheck size={13} /></button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= my issues ================= */
export function MyIssuesPage() {
  const snap = useApp(s => s.snap)!;
  const me = snap.currentUser;
  const [tab, setTab] = useState<'assigned' | 'created' | 'subscribed'>('assigned');
  const viewKey = 'baseline:view:my-issues';
  const [opts, patch] = useViewPrefs<ViewOptions>(viewKey, { ...TEAM_DEFAULT_OPTS });
  const displayBtn = useMenu();

  const assigned = useMemo(() => snap.issues.filter(i => i.assigneeId === me.id), [snap.issues, me.id]);
  const createdIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of snap.activity) if (a.type === 'created' && a.userId === me.id && a.issueId) ids.add(a.issueId);
    return ids;
  }, [snap.activity, me.id]);
  const created = useMemo(() => snap.issues.filter(i => createdIds.has(i.id)), [snap.issues, createdIds]);
  const subscribed = useMemo(() => {
    const interacted = new Set<string>();
    for (const c of snap.comments) if (c.userId === me.id) interacted.add(c.issueId);
    for (const a of snap.activity) if (a.userId === me.id && a.issueId) interacted.add(a.issueId);
    return snap.issues.filter(i => i.assigneeId === me.id || createdIds.has(i.id) || interacted.has(i.id));
  }, [snap.issues, snap.comments, snap.activity, me.id, createdIds]);
  const tabIssues = tab === 'assigned' ? assigned : tab === 'created' ? created : subscribed;

  const visible = useMemo(
    () => applyFilters(tabIssues, opts.filters, snap.states),
    [tabIssues, opts.filters, snap.states],
  );

  const empty: Record<typeof tab, { title: string; desc: string }> = {
    assigned: { title: 'No issues assigned to you', desc: 'Issues assigned to you will show up here.' },
    created: { title: 'No issues created by you', desc: 'Issues you create will show up here.' },
    subscribed: { title: 'No subscriptions', desc: 'Issues you created, were assigned, commented on or mentioned in will show up here.' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'My issues' }]} />
      <div className="subnav">
        {(['assigned', 'created', 'subscribed'] as const).map(t => (
          <button key={t} className={`seg ${tab === t ? 'selected' : ''}`} onClick={() => setTab(t)}>
            {t === 'assigned' ? 'Assigned' : t === 'created' ? 'Created' : 'Subscribed'}
            {tab === t && <RegisterMark group="my-issues-tabs" />}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {activeFilterCount(opts.filters) > 0 && <span className="filter-count">{activeFilterCount(opts.filters)}</span>}
        <button className="icon-btn" title="Filter" onClick={openFilterMenu}><IconFilter size={15} /></button>
        <button className="icon-btn" title="Display options" onClick={displayBtn.open} style={opts.layout === 'board' ? { color: 'var(--brand)' } : undefined}><IconDisplay size={15} /></button>
      </div>
      <div className="filterbar">
        <FilterBar filters={opts.filters} onChange={filters => patch({ filters })} />
      </div>
      {displayBtn.anchor && <DisplayOptionsMenu opts={opts} onPatch={patch} anchor={displayBtn.anchor} onClose={displayBtn.close} />}
      <div className="content">
        {opts.layout === 'list' ? (
          <GroupedList
            issues={visible}
            opts={opts}
            emptyTitle={empty[tab].title}
            emptyDesc={empty[tab].desc}
          />
        ) : (
          /* cross-team board: columns merge same-named states across teams */
          <Board issues={visible} groupBy={opts.groupBy} orderBy={opts.orderBy} onFocusColumn={ids => patch({ filters: toggleStateFilter(opts.filters, ids) })} />
        )}
      </div>
    </div>
  );
}

/* ================= views ================= */
export function ViewsIndexPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const toast = useApp(s => s.toast);
  const rowMenu = useMenu();
  const [menuView, setMenuView] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement | null>(null);
  // select after mount — a focus-event select() loses to the caret's default placement
  useEffect(() => { if (renaming) renameRef.current?.select(); }, [renaming]);

  const describe = (filters: ViewFilters) => {
    const bits: string[] = [];
    if (filters.query) bits.push(`“${filters.query}”`);
    if (filters.priority?.length) bits.push(`Priority: ${filters.priority.slice().sort().map(p => ['', 'Urgent', 'High', 'Medium', 'Low'][p]).join(', ')}`);
    if (filters.assigneeIds?.length) bits.push(`Assignee: ${filters.assigneeIds.map(id => snap.users.find(u => u.id === id)?.name ?? id).join(', ')}`);
    if (filters.labelIds?.length) bits.push(`Label: ${filters.labelIds.map(id => snap.labels.find(l => l.id === id)?.name ?? id).join(', ')}`);
    if (filters.projectIds?.length) bits.push(`Project: ${filters.projectIds.map(id => snap.projects.find(p => p.id === id)?.name ?? id).join(', ')}`);
    if (filters.states?.length) bits.push(`Status: ${filters.states.map(id => snap.states.find(s => s.id === id)?.name ?? id).join(', ')}`);
    return bits.join(' · ') || 'All issues';
  };

  const createView = async () => {
    const { view } = await api.createView({ name: 'New view', filters: {}, icon: '🗂' });
    await useApp.getState().bootstrap();
    // land inside the fresh view with its name selected — naming it is the next natural step
    navigate(`/views/${view.id}`, { state: { rename: true } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Views' }]} right={<button className="btn secondary" onClick={createView}>＋ New view</button>} />
      <div className="content">
        {snap.views.length === 0 ? (
          <div className="empty-state">
            <div className="empty-mark"><LogoMark size={30} /></div>
            <div className="empty-title">Views</div>
            <div className="empty-desc">Create views to save filters and groupings you return to.</div>
            <div className="empty-actions">
              <button className="btn primary" onClick={createView}>New view</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '6px 16px' }}>
            {snap.views.map(v => (
              <div key={v.id} className="issue-row" style={{ cursor: 'pointer' }} onClick={() => navigate(`/views/${v.id}`)}
                onContextMenu={(e) => { setMenuView(v.id); rowMenu.open(e); }}>
                <span style={{ fontSize: 15 }}>{v.icon || '🗂'}</span>
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
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{describe(v.filters)}</span>
                <button className="icon-btn hover-only" onClick={(e) => { e.stopPropagation(); setMenuView(v.id); rowMenu.open(e); }}><IconMore size={13} /></button>
              </div>
            ))}
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
function ViewNameSeg(props: { view: SavedView; startEditing?: boolean }) {
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
  const [opts, patch] = useViewPrefs<ViewOptions>(`baseline:view:saved:${viewId}`, defaults);
  const displayBtn = useMenu();
  const savedJson = JSON.stringify({ filters: view?.filters, groupBy: view?.groupBy, orderBy: view?.orderBy, layout: view?.layout });
  const localJson = JSON.stringify({ filters: opts.filters, groupBy: opts.groupBy, orderBy: opts.orderBy, layout: opts.layout });
  const dirty = view && savedJson !== localJson;
  if (!view) return <div className="empty-state"><div className="empty-title">View not found</div></div>;
  const visible = applyFilters(snap.issues, opts.filters, snap.states);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        crumbs={[{ label: 'Views', to: '/views', muted: true }, { label: view.name, icon: <span>{view.icon || '🗂'}</span> }]}
        favoriteRef={{ type: 'view', refId: view.id }}
        right={dirty ? (
          <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={async () => {
            await api.updateView(view.id, { filters: opts.filters, groupBy: opts.groupBy, orderBy: opts.orderBy, layout: opts.layout });
            await useApp.getState().bootstrap();
            useApp.getState().toast({ title: 'View saved' });
          }}>Save view</button>
        ) : undefined}
      />
      <div className="subnav">
        <ViewNameSeg view={view} startEditing={Boolean((location.state as { rename?: boolean } | null)?.rename)} />
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Filter" onClick={openFilterMenu}><IconFilter size={15} /></button>
        <button className="icon-btn" title="Display options" onClick={displayBtn.open} style={opts.layout === 'board' ? { color: 'var(--brand)' } : undefined}><IconDisplay size={15} /></button>
      </div>
      <div className="filterbar">
        <FilterBar filters={opts.filters} onChange={filters => patch({ filters })} />
      </div>
      {displayBtn.anchor && <DisplayOptionsMenu opts={opts} onPatch={patch} anchor={displayBtn.anchor} onClose={displayBtn.close} />}
      <div className="content">
        {opts.layout === 'list' ? (
          <GroupedList issues={visible} opts={opts} emptyTitle={view.name} emptyDesc="No issues match this view right now." />
        ) : (
          <Board issues={visible} groupBy={opts.groupBy} orderBy={opts.orderBy} onFocusColumn={ids => patch({ filters: toggleStateFilter(opts.filters, ids) })} />
        )}
      </div>
    </div>
  );
}

/* ================= cycles ================= */
export function CyclesPage() {
  const { teamKey = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const openCreate = useApp(s => s.openCreate);
  const team = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
  if (!team) return <TeamMissingRedirect />;
  const cycles = snap.cycles.filter(c => c.teamId === team.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = new Date().toISOString();
  const current = cycles.find(c => c.startsAt <= now && c.endsAt >= now);
  const upcoming = cycles.filter(c => c.startsAt > now);
  const previous = cycles.filter(c => c.endsAt < now).reverse();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: team.name, to: `/team/${team.key}`, muted: true }, { label: 'Cycles' }]} />
      <TeamSubnav teamId={team.id} filter="cycles" />
      <div className="content">
        {cycles.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, animation: 'bl-fade-up 320ms var(--ease) both' }}>
            <div className="empty-mark"><LogoMark size={28} /></div>
            <div className="empty-title">No cycles yet</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, maxWidth: 360, textAlign: 'center' }}>
              Cycles are time-boxed iterations for {team.name}. Create one with a name and start/end dates, then add issues to it.
            </div>
            <button className="btn primary" style={{ height: 28, fontSize: 12, marginTop: 6 }} onClick={() => navigate('/settings/teams')}>Create a cycle</button>
          </div>
        ) : (
        <div style={{ padding: '8px 24px', display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 860 }}>
          {[['Current', current ? [current] : []], ['Upcoming', upcoming], ['Previous', previous.slice(0, 3)]].map(([label, list]) => {
            const items = list as typeof cycles;
            return (
              <div key={label as string}>
                <div className="menu-header" style={{ padding: '0 0 8px' }}><span>{label as string}</span></div>
                {items.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No {String(label).toLowerCase()} cycle.</div>}
                {items.map(c => {
                  const issues = snap.issues.filter(i => i.cycleId === c.id);
                  const done = issues.filter(i => {
                    const st = snap.states.find(s => s.id === i.stateId);
                    return st?.type === 'completed' || st?.type === 'canceled';
                  }).length;
                  const pct = issues.length ? Math.round((done / issues.length) * 100) : 0;
                  return (
                    <div key={c.id} className="card" style={{ padding: '12px 14px', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <IconCycle size={15} style={{ color: 'var(--text-secondary)' }} />
                        <b>{c.name || `Cycle ${c.number}`}</b>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{shortDate(c.startsAt)} → {shortDate(c.endsAt)}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{done}/{issues.length} issues</span>
                        <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={() => openCreate({ teamId: team.id, cycleId: c.id })}>＋ Issue</button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 4px' }}>
                        <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{pct}%</span>
                      </div>
                      {issues.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          {issues.map(i => <IssueRow key={i.id} issue={i} display={{ id: true, status: true, assignee: true, priority: false, labels: true, project: false, due: false }} />)}
                        </div>
                      )}
                      {issues.length === 0 && (
                        <button className="prop-chip" style={{ color: 'var(--text-dim)', marginTop: 4 }} onClick={() => openCreate({ teamId: team.id, cycleId: c.id })}>＋ Add issue to this cycle</button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <button className="prop-chip" style={{ color: 'var(--text-dim)', alignSelf: 'flex-start' }} onClick={() => navigate(`/settings/teams`)}>Manage cycles in team settings</button>
        </div>
        )}
      </div>
    </div>
  );
}
