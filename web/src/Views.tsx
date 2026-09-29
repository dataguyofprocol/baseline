import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useApp, useHelpers, shortDate, relTime, copyText, refresh, useCursor, registerVisibleList } from './store.js';
import { IssueDetail } from './IssueDetail.js';
import { NewCycleModal } from './Settings.js';
import { api } from './api.js';
import { ProjectDirectoryRow } from './CodingTools.js';
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
              <span>Name</span><span>Status</span><span>Health</span><span>Priority</span><span>Lead</span><span>Target</span>
              <span className="num">Issues</span><span className="num">Progress</span>
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
                  <span className="pc">{statusGlyph(p.status)}{PROJECT_STATUS_LABELS[p.status]}</span>
                  <span className="pc">
                    <span className="health-dot" style={{ background: HEALTH_COLORS[p.health] }} />
                    {PROJECT_HEALTH_LABELS[p.health]}
                  </span>
                  <span className="pc">
                    {p.priority ? <PriorityIcon priority={p.priority} size={14} /> : <span className="dim">—</span>}
                  </span>
                  <span className="pc">
                    {lead ? <><Avatar user={lead} size={18} /><span className="pc-name">{lead.name.split(' ')[0]}</span></> : <span className="dim">—</span>}
                  </span>
                  <span className={`pc mono${p.targetDate && p.status !== 'completed' && p.targetDate.slice(0, 10) < new Date().toISOString().slice(0, 10) ? ' overdue' : ''}`}>
                    {p.targetDate ? shortDate(p.targetDate) : <span className="dim">—</span>}
                  </span>
                  <span className="pc mono num">{issueCount}</span>
                  <span className="pc num">
                    <span className="proj-bar"><span style={{ width: `${prog}%` }} /></span>
                    <span className="mono">{prog}%</span>
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
                {/* properties live in the rail (as on an issue); the column reads
                    top-down: what it is, where it stands, what's next */}
                <EditableProjectHeader project={project} />
                <ProjectDescription project={project} />
                <UpdatesSection projectId={project.id} updates={updates} />
                <MilestonesSection projectId={project.id} milestones={milestones} />
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
        <ProjectHealthMenu project={project}>
          {({ open }) => (
            <button className="rail-kv" onClick={open}>
              <span className="rail-kv-label">Health</span>
              <span className="rail-kv-value"><HealthDot health={project.health} /> {PROJECT_HEALTH_LABELS[project.health]}</span>
            </button>
          )}
        </ProjectHealthMenu>
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
        <ProjectDirectoryRow project={project} />
      </div>
      <ProjectProgressCard project={project} prog={props.prog} />
      <div className="rail-card">
        <div className="rail-card-header">Activity</div>
        {activity.length === 0 && <div className="rail-kv"><span className="rail-kv-value dim">No activity yet.</span></div>}
        {activity.map(a => (
          <div key={a.id} className="rail-activity">
            <span style={{ display: 'flex', paddingTop: 1 }}><Avatar user={snap.users.find(u => u.id === a.userId)} size={16} /></span>
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

/* where the project stands: one segmented bar over its issues, the count per
   bucket, and the time left against the target date */
function ProjectProgressCard(props: { project: Project; prog: number }) {
  const snap = useApp(s => s.snap)!;
  const issues = snap.issues.filter(i => i.projectId === props.project.id && !i.archivedAt && !i.deletedAt);
  const typeOf = (i: Issue) => snap.states.find(s => s.id === i.stateId)?.type;
  const done = issues.filter(i => typeOf(i) === 'completed' || typeOf(i) === 'canceled').length;
  const started = issues.filter(i => typeOf(i) === 'started').length;
  const rest = issues.length - done - started;
  const target = props.project.targetDate?.slice(0, 10);
  const days = target ? Math.ceil((new Date(target + 'T23:59:59').getTime() - Date.now()) / 86400000) : null;
  const when = days === null ? null
    : props.project.status === 'completed' ? 'Completed'
    : days < 0 ? `${-days} day${days === -1 ? '' : 's'} past target`
    : days === 0 ? 'Due today' : `${days} day${days === 1 ? '' : 's'} to target`;
  return (
    <div className="rail-card">
      <div className="rail-card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Progress</span>
        <span className="mono" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{props.prog}%</span>
      </div>
      <div style={{ padding: '4px 8px 8px' }}>
        <span className="cy-bar" style={{ width: '100%' }}>
          <span className="cy-done" style={{ width: issues.length ? `${(done / issues.length) * 100}%` : 0 }} />
          <span className="cy-started" style={{ width: issues.length ? `${(started / issues.length) * 100}%` : 0 }} />
        </span>
        <div className="pp-stats">
          <span><b>{done}</b> done</span>
          <span><b>{started}</b> in progress</span>
          <span><b>{rest}</b> to do</span>
        </div>
        {when && <div className={`pp-when${days !== null && days < 0 && props.project.status !== 'completed' ? ' late' : ''}`}>{when}</div>}
      </div>
    </div>
  );
}

/* ================= inbox ================= */
export function InboxPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const notifications = snap.notifications;
  const unread = notifications.filter(n => !n.readAt).length;

  const describe = (n: typeof notifications[number]) => {
    const issue = n.issueId ? snap.issues.find(i => i.id === n.issueId && !i.deletedAt) : undefined;
    const team = issue ? snap.teams.find(t => t.id === issue.teamId) : undefined;
    const key = issue && team ? `${team.key}-${issue.number}` : '';
    if (n.type === 'issueAssignedToYou') return { verb: 'assigned you', issue, key, icon: <IconAssignArrow size={12} /> };
    if (n.type === 'issueCommented') return { verb: 'commented', issue, key, icon: <IconComment size={12} /> };
    if (n.type === 'issueMentioned') return { verb: 'mentioned you', issue, key, icon: <IconMention size={12} /> };
    if (n.type === 'systemUpdate') return { verb: '', issue, key, icon: <IconCycle size={12} /> };
    return { verb: 'updated', issue, key, icon: <IconComment size={12} /> };
  };

  /* Multiple actors on the same issue collapse into one row with a punched-gap
     stack — two people saying the same thing about BAS-214 is one thing to read,
     not two. Only same-issue, same-kind notifications merge; the merged row keeps
     the newest timestamp and stays unread while any part is unread. */
  type Row = { lead: typeof notifications[number]; actors: string[]; ids: string[]; unread: boolean; group: string };
  const rows = useMemo(() => {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
    const groupOf = (iso: string) => {
      const d = new Date(iso);
      return d >= startOfToday ? 'Today' : d >= startOfYesterday ? 'Yesterday' : 'Earlier';
    };
    const out: Row[] = [];
    for (const n of notifications) {
      const group = groupOf(n.createdAt);
      const kind = n.type;
      const hit = n.issueId ? out.find(r => r.group === group && r.lead.issueId === n.issueId && r.lead.type === kind) : undefined;
      if (hit) {
        if (n.actorId && !hit.actors.includes(n.actorId)) hit.actors.push(n.actorId);
        hit.ids.push(n.id);
        hit.unread = hit.unread || !n.readAt;
      } else {
        out.push({ lead: n, actors: n.actorId ? [n.actorId] : [], ids: [n.id], unread: !n.readAt, group });
      }
    }
    return out;
  }, [notifications]);

  // J/K and the row shortcuts (S, P, A, L, E) run on the shared list cursor, so
  // the inbox registers the issues its rows point at; rows without an issue
  // (system notices) are read-only and the cursor steps over them.
  const navigable = useMemo(() => rows.filter(r => describe(r.lead).issue), [rows, snap.issues]); // eslint-disable-line react-hooks/exhaustive-deps
  const cursor = useCursor(s => s.index);
  useEffect(() => {
    registerVisibleList(navigable.map(r => describe(r.lead).issue!), '');
  }, [navigable]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // land on the newest unread notification (or the newest one) on arrival
    const first = navigable.findIndex(r => r.unread);
    useCursor.setState({ index: navigable.length ? Math.max(first, 0) : -1 });
    return () => useCursor.getState().reset();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = cursor >= 0 ? navigable[cursor] : undefined;
  const selectedIssue = selected ? describe(selected.lead).issue : undefined;
  const markRead = async (row: Row, value: boolean) => {
    for (const nid of row.ids) await api.markNotificationRead(nid, value);
    await useApp.getState().bootstrap();
  };
  // viewing a notification reads it — after a beat, so skimming with J/K past
  // a row doesn't silently clear it
  useEffect(() => {
    if (!selected?.unread) return;
    const t = setTimeout(() => void markRead(selected, true), 900);
    return () => clearTimeout(t);
  }, [selected?.lead.id, selected?.unread]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.querySelector('.inbox-row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let lastGroup = '';
  return (
    <div className="inbox">
      <div className="inbox-list">
        <TopBar crumbs={[{ label: 'Inbox' }]} right={
          unread > 0 ? <button className="btn secondary" style={{ height: 26, fontSize: 12 }} onClick={async () => { await api.markAllNotificationsRead(); await useApp.getState().bootstrap(); }}>Mark all read</button> : undefined
        } />
        <div className="content">
          {notifications.length === 0 ? (
            <div className="empty-state">
              <div className="empty-mark"><LogoMark size={30} /></div>
              <div className="empty-title">You're all caught up</div>
              <div className="empty-desc">Assignments, mentions and comments land here.</div>
            </div>
          ) : rows.map(row => {
            const n = row.lead;
            const d = describe(n);
            const actors = row.actors.map(a => snap.users.find(u => u.id === a)).filter(Boolean) as NonNullable<ReturnType<typeof snap.users.find>>[];
            const others = actors.length > 1 ? ` +${actors.length - 1}` : '';
            const header = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            const idx = navigable.indexOf(row);
            const isSel = idx >= 0 && idx === cursor;
            const excerpt = n.type === 'issueCommented' || n.type === 'issueMentioned' ? n.body : '';
            return (
              <div key={n.id}>
                {header && <div className="inbox-group">{header}</div>}
                <div
                  className={`inbox-row${row.unread ? ' unread' : ''}${isSel ? ' selected' : ''}${idx < 0 ? ' static' : ''}`}
                  onClick={() => { if (idx >= 0) useCursor.setState({ index: idx }); }}
                  onDoubleClick={() => { if (d.key) navigate(`/issue/${d.key}`); }}
                >
                  <span className="inbox-lead">
                    {actors.length > 1
                      ? <AvatarStack size={20} people={actors.map(a => ({ name: a.name, initials: a.initials, color: a.color }))} />
                      : actors.length === 1 ? <Avatar user={actors[0]} size={20} />
                      : <span className="inbox-sys">{d.icon}</span>}
                  </span>
                  <div className="inbox-body">
                    <div className="inbox-line1">
                      <span className="inbox-title">{d.issue ? d.issue.title : (n.body || 'Issue no longer exists')}</span>
                      <span className="rel-time">{relTime(n.createdAt)}</span>
                    </div>
                    <div className="inbox-line2">
                      {d.key && <span className="inbox-key">{d.key}</span>}
                      {d.verb && (
                        <span className="inbox-what">
                          {actors[0] ? <>{actors[0].name}{others} {d.verb}</> : d.verb === 'assigned you' ? 'Assigned to you' : d.verb}
                          {excerpt && <>: <span className="inbox-excerpt">{excerpt}</span></>}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className="icon-btn hover-only" title={row.unread ? 'Mark read' : 'Mark unread'}
                    onClick={async (e) => { e.stopPropagation(); await markRead(row, row.unread); }}
                  ><IconCheck size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="inbox-preview">
        {selectedIssue
          ? <IssueDetail key={selectedIssue.id} issue={selectedIssue} />
          : (
            <div className="empty-state">
              <div className="empty-mark"><LogoMark size={26} /></div>
              <div className="empty-title">{notifications.length ? 'Pick a notification' : 'Nothing to preview'}</div>
              {notifications.length > 0 && <div className="empty-desc"><span className="kbd">J</span> <span className="kbd">K</span> to move through the list, <span className="kbd">↵</span> to open the issue.</div>}
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
    return bits;
  };
  const live = snap.issues.filter(i => !i.archivedAt && !i.deletedAt);

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
          <div style={{ padding: '0 16px' }}>
            <div className="view-grid proj-head">
              <span>Name</span><span>Filters</span><span className="num">Issues</span><span />
            </div>
            {snap.views.map(v => {
              const chips = describe(v.filters);
              const count = applyFilters(live.filter(i => !v.teamId || i.teamId === v.teamId), v.filters, snap.states).length;
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
                {faved && <IconStar size={12} filled style={{ color: 'var(--brand)', flex: 'none' }} />}
                </span>
                <span className="view-chips">
                  {chips.length === 0
                    ? <span className="view-chip all">All issues</span>
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
  const openCreate = useApp(s => s.openCreate);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const team = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
  if (!team) return <TeamMissingRedirect />;
  const cycles = snap.cycles.filter(c => c.teamId === team.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = new Date().toISOString();
  const current = cycles.find(c => c.startsAt <= now && c.endsAt >= now);
  const upcoming = cycles.filter(c => c.startsAt > now);
  const previous = cycles.filter(c => c.endsAt < now).reverse();
  const nextNumber = cycles.length ? Math.max(...cycles.map(c => c.number)) + 1 : 1;

  const statsOf = (cycleId: string) => {
    const issues = snap.issues.filter(i => i.cycleId === cycleId && !i.archivedAt && !i.deletedAt);
    const typeOf = (i: Issue) => snap.states.find(s => s.id === i.stateId)?.type;
    const done = issues.filter(i => typeOf(i) === 'completed' || typeOf(i) === 'canceled').length;
    const started = issues.filter(i => typeOf(i) === 'started').length;
    return { issues, done, started, total: issues.length, pct: issues.length ? Math.round((done / issues.length) * 100) : 0 };
  };
  const daysBetween = (a: string, b: string) => Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  const rowDisplay = { id: true, status: true, assignee: true, priority: true, labels: true, project: false, due: false };

  /* one bar, three segments: done (brand), in progress (started yellow), the rest track */
  const Bar = ({ done, started, total }: { done: number; started: number; total: number }) => (
    <span className="cy-bar">
      <span className="cy-done" style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
      <span className="cy-started" style={{ width: total ? `${(started / total) * 100}%` : 0 }} />
    </span>
  );

  const compactRow = (c: typeof cycles[number], when: string) => {
    const st = statsOf(c.id);
    const isOpen = open === c.id;
    return (
      <div key={c.id} className={`cy-row-wrap${isOpen ? ' open' : ''}`}>
        <button className="cy-row" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
          <IconChevronDown size={12} className="cy-chev" />
          <span className="cy-name">{c.name || `Cycle ${c.number}`}</span>
          <span className="cy-dates">{shortDate(c.startsAt)} – {shortDate(c.endsAt)}</span>
          <span className="cy-when">{when}</span>
          <span className="cy-fill" />
          <Bar done={st.done} started={st.started} total={st.total} />
          <span className="cy-count">{st.done}/{st.total}</span>
        </button>
        {isOpen && (
          <div className="cy-issues">
            {st.issues.map(i => <IssueRow key={i.id} issue={i} display={rowDisplay} />)}
            <button className="lane-add" onClick={() => openCreate({ teamId: team.id, cycleId: c.id })}><IconPlus size={12} /> New issue in this cycle</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: team.name, to: `/team/${team.key}`, muted: true }, { label: 'Cycles' }]}
        right={<button className="btn secondary" onClick={() => setCreating(true)}><IconPlus size={13} /> New cycle</button>} />
      <TeamSubnav teamId={team.id} filter="cycles" />
      <div className="content">
        {cycles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-mark"><LogoMark size={28} /></div>
            <div className="empty-title">No cycles yet</div>
            <div className="empty-desc">Cycles are time-boxed iterations for {team.name}. Give one a start and end date, then pull issues into it.</div>
            <div className="empty-actions">
              <button className="btn primary" onClick={() => setCreating(true)}>Start a cycle</button>
            </div>
          </div>
        ) : (
        <div className="cy-page">
          {current ? (() => {
            const st = statsOf(current.id);
            const left = daysBetween(now, current.endsAt);
            const length = Math.max(1, daysBetween(current.startsAt, current.endsAt));
            const elapsed = Math.min(100, Math.max(0, ((length - left) / length) * 100));
            return (
              <section className="cy-current">
                <div className="cy-cur-head">
                  <span className="cy-live">Current</span>
                  <span className="cy-cur-name">{current.name || `Cycle ${current.number}`}</span>
                  <span className="cy-dates">{shortDate(current.startsAt)} – {shortDate(current.endsAt)}</span>
                  <span className="cy-fill" />
                  <span className="cy-left">{left <= 0 ? 'Ends today' : `${left} day${left === 1 ? '' : 's'} left`}</span>
                </div>
                <div className="cy-stats">
                  <span><b>{st.done}</b> done</span>
                  <span><b>{st.started}</b> in progress</span>
                  <span><b>{st.total - st.done - st.started}</b> not started</span>
                  <span className="cy-fill" />
                  <span className="cy-pct">{st.pct}%</span>
                </div>
                {/* the bar carries a tick for how much of the cycle's time has passed */}
                <div className="cy-bar-wrap">
                  <Bar done={st.done} started={st.started} total={st.total} />
                  <span className="cy-now" style={{ left: `${elapsed}%` }} title="Today" />
                </div>
                <div className="cy-issues">
                  {st.issues.map(i => <IssueRow key={i.id} issue={i} display={rowDisplay} />)}
                  <button className="lane-add" onClick={() => openCreate({ teamId: team.id, cycleId: current.id })}><IconPlus size={12} /> New issue in this cycle</button>
                </div>
              </section>
            );
          })() : (
            <section className="cy-none">
              <span>No cycle is running for {team.name}.</span>
              <button className="btn secondary" onClick={() => setCreating(true)}>Start a cycle</button>
            </section>
          )}

          {upcoming.length > 0 && (
            <section>
              <div className="cy-section">Upcoming</div>
              {upcoming.map(c => {
                const d = daysBetween(now, c.startsAt);
                return compactRow(c, d <= 1 ? 'starts tomorrow' : `starts in ${d} days`);
              })}
            </section>
          )}

          {previous.length > 0 && (
            <section>
              <div className="cy-section">Previous</div>
              {previous.map(c => {
                const st = statsOf(c.id);
                return compactRow(c, !st.total ? 'no issues' : st.done < st.total ? `ended with ${st.total - st.done} open` : 'completed');
              })}
            </section>
          )}
        </div>
        )}
      </div>
      <AnimatePresence>{creating && <NewCycleModal key="cy" teamId={team.id} number={nextNumber} onClose={() => setCreating(false)} />}</AnimatePresence>
    </div>
  );
}
