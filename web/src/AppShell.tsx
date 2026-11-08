import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, useMenu, RegisterMark, ConfirmButton } from './ui.js';
import { Logo } from './Logo.js';
import { teamDisplayIcon } from './pickers.js';
import { AnimatePresence } from 'framer-motion';
import { CustomizeSidebar, sidebarVisibility, useDrafts } from './Workspace.js';
import { InitiativeIcon } from './Initiatives.js';
import { GettingStartedMenu } from './GettingStarted.js';
import {
  IconInbox, IconMyIssues, IconBox, IconViews, IconIssues, IconCycle, IconTeam, IconHelp, IconCaret,
  IconSearch, IconNew, IconSettings, IconChevronDown, IconMore, IconStar, IconMoon, IconSun,
  IconTriage, IconArchive, IconTrash, IconLink, IconPlus, IconPulse, IconCustomers, IconDrafts, IconMembers, IconHome, IconInitiative, IconRelease, IconAsk, IconKeyboard,
} from './icons.js';

/** Panel-with-a-left-rail glyph: the standard "toggle the nav" affordance. */
function IconSidebar({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M6.25 2.75v10.5" />
    </svg>
  );
}

const SECTIONS_KEY = 'baseline:navSections';
function useSectionState(): [Record<string, boolean>, (id: string, fallback?: boolean) => void] {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}'); } catch { return {}; }
  });
  const toggle = (id: string, fallback = true) => setOpen(prev => {
    const next = { ...prev, [id]: !(prev[id] ?? fallback) };
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  return [open, toggle];
}

export function Sidebar() {
  const snap = useApp(s => s.snap);
  const resolvedTheme = useApp(s => s.resolvedTheme);
  // ? opens the help menu from anywhere
  const helpMenu = useMenu();
  const helpRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const open = () => { const r = helpRef.current?.getBoundingClientRect(); if (r) helpMenu.setAnchor(r); };
    window.addEventListener('baseline:help-menu', open);
    return () => window.removeEventListener('baseline:help-menu', open);
  }, [helpMenu.setAnchor]);
  const workspaceMenu = useMenu();
  const moreMenu = useMenu();
  const collapsed = useApp(s => s.sidebarCollapsed);
  const toggleSidebar = useApp(s => s.toggleSidebar);
  const navigate = useNavigate();
  const loc = useLocation();
  const [sections, toggleSection] = useSectionState();
  const teamMenu = useMenu();
  const [teamMenuFor, setTeamMenuFor] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const drafts = useDrafts();
  if (!snap) return null;
  // hosted: the teams you're on, as in Linear (everyone else's are a click away in Teams); a laptop,
  // where there's one person, sees them all
  const hosted = snap.workspace.auth === 'hosted';
  const yourTeams = hosted ? snap.teams.filter(t => t.memberIds.includes(snap.currentUser.id)) : snap.teams;
  const triageState = (teamId: string) => snap.states.find(s => s.teamId === teamId && s.type === 'triage');
  const triageCount = (teamId: string) => { const st = triageState(teamId); return st ? snap.issues.filter(i => i.stateId === st.id).length : 0; };
  const menuTeam = snap.teams.find(t => t.id === teamMenuFor);
  const nowIso = new Date().toISOString();
  const unread = snap.notifications.filter(n => !n.readAt && (!n.snoozedUntil || n.snoozedUntil <= nowIso)).length;
  const me = snap.currentUser;
  const isOpen = (id: string, fallback = true) => sections[id] ?? fallback;
  // Customize sidebar: each item always shows, shows only with a badge, or moves to More
  const f = snap.workspace.features;
  const ALL = [
    { key: 'inbox', to: '/inbox', icon: <IconInbox />, label: 'Inbox', badge: unread, section: 'personal' },
    { key: 'my-issues', to: '/my-issues', icon: <IconMyIssues />, label: 'My issues', badge: 0, section: 'personal' },
    { key: 'drafts', to: '/drafts', icon: <IconDrafts />, label: 'Drafts', badge: drafts.length, section: 'personal' },
    ...(f.initiativesEnabled ? [{ key: 'initiatives', to: '/initiatives', icon: <IconInitiative />, label: 'Initiatives', badge: 0, section: 'workspace' }] : []),
    { key: 'projects', to: '/projects', icon: <IconBox />, label: 'Projects', badge: 0, section: 'workspace' },
    { key: 'views', to: '/views', icon: <IconViews />, label: 'Views', badge: 0, section: 'workspace' },
    ...(f.releasesEnabled ? [{ key: 'releases', to: '/releases', icon: <IconRelease />, label: 'Releases', badge: 0, section: 'workspace' }] : []),
    { key: 'asks', to: '/asks', icon: <IconAsk />, label: 'Asks', badge: 0, section: 'workspace' },
    ...(f.pulseEnabled ? [{ key: 'pulse', to: '/pulse', icon: <IconPulse />, label: 'Pulse', badge: 0, section: 'workspace' }] : []),
    ...(f.customerRequestsEnabled ? [{ key: 'customers', to: '/customers', icon: <IconCustomers />, label: 'Customers', badge: 0, section: 'workspace' }] : []),
    { key: 'teams', to: '/teams', icon: <IconTeam />, label: 'Teams', badge: 0, section: 'workspace' },
    { key: 'members', to: '/members', icon: <IconMembers />, label: 'Members', badge: 0, section: 'workspace' },
  ];
  const shown = (i: (typeof ALL)[number]) => { const v = sidebarVisibility(snap, i.key); return v === 'show' || (v === 'badged' && i.badge > 0); };
  const personal = ALL.filter(i => i.section === 'personal' && shown(i));
  const workspaceItems = ALL.filter(i => i.section === 'workspace' && shown(i));
  const hiddenItems = ALL.filter(i => i.section === 'workspace' && !shown(i));
  const locTeam = /^\/team\/([^/]+)/.exec(loc.pathname)?.[1];

  const favorites = snap.favorites
    .slice().sort((a, b) => a.position - b.position)
    .map(f => {
      if (f.type === 'project') {
        const p = snap.projects.find(x => x.id === f.refId);
        return p ? { id: f.id, label: p.name, icon: <span className="fav-emoji">{p.icon}</span>, to: `/projects/${p.id}` } : null;
      }
      if (f.type === 'view') {
        const v = snap.views.find(x => x.id === f.refId);
        if (v) return { id: f.id, label: v.name, icon: <span className="fav-emoji">{v.icon || '🗂'}</span>, to: `/views/${v.id}` };
        const teamMatch = /^team-(.+)-(all|active|backlog)$/.exec(f.refId);
        if (teamMatch) {
          const t = snap.teams.find(x => x.id === teamMatch[1]);
          if (t) {
            const filter = teamMatch[2];
            const label = filter === 'all' ? `${t.name} · All issues` : filter === 'active' ? `${t.name} · Active` : `${t.name} · Backlog`;
            return { id: f.id, label, icon: <IconIssues size={14} />, to: `/team/${t.key}/${filter}` };
          }
        }
        const labelMatch = /^label-(.+)$/.exec(f.refId);
        const l = labelMatch && snap.labels.find(x => x.id === labelMatch[1]);
        if (l) return { id: f.id, label: l.name, icon: <span className="label-dot" style={{ background: l.color }} />, to: `/labels/${l.id}` };
        return null;
      }
      if (f.type === 'initiative') {
        const ini = snap.initiatives.find(x => x.id === f.refId);
        return ini ? { id: f.id, label: ini.name, icon: <InitiativeIcon ini={ini} size={15} />, to: `/initiatives/${ini.id}` } : null;
      }
      if (f.type === 'cycle') {
        const c = snap.cycles.find(x => x.id === f.refId);
        const t = c ? snap.teams.find(x => x.id === c.teamId) : undefined;
        return c && t ? { id: f.id, label: c.name || `Cycle ${c.number}`, icon: <IconCycle size={14} />, to: `/team/${t.key}/cycles/${c.id}` } : null;
      }
      if (f.type === 'issue') {
        const i = snap.issues.find(x => x.id === f.refId);
        if (i) {
          const t = snap.teams.find(x => x.id === i.teamId);
          const key = `${t?.key}-${i.number}`;
          return { id: f.id, label: key, title: `${key} ${i.title}`, icon: <IconIssues size={14} />, to: `/issue/${key}` };
        }
        return null;
      }
      return null;
    })
    .filter(Boolean) as Array<{ id: string; label: string; title?: string; icon: React.ReactNode; to: string }>;

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-hidden={collapsed}>
      <div className="sidebar-main">
        <div className="ws-row">
          <button className="ws-switch" onClick={workspaceMenu.open}>
            <Logo size={20} />
            <span className="ws-name">{snap.workspace.name}</span>
            <IconChevronDown size={12} style={{ color: 'var(--text-dim)' }} />
          </button>
          <div className="ws-actions">
            <button className="icon-btn ws-collapse" title="Collapse sidebar ([)" onClick={toggleSidebar}><IconSidebar size={15} /></button>
            <button className="icon-btn" title="Search (/)" onClick={() => navigate('/search')}><IconSearch size={15} /></button>
            <button className="ws-new" title="New issue (C)" onClick={() => useApp.getState().openCreate()}><IconNew size={14} /></button>
          </div>
        </div>
        {workspaceMenu.anchor && (
          <Menu anchor={workspaceMenu.anchor} onClose={workspaceMenu.close} width={250}>
            <div className="menu-header"><span>{me.name} — {me.email || 'local user'}</span></div>
            <MenuItem icon={<IconSettings size={14} />} label="Settings" onClick={() => navigate('/settings/workspace')} />
            <MenuSep />
            {snap.workspace.auth === 'hosted'
              ? <MenuItem label="Log out" onClick={async () => { workspaceMenu.close(); await api.logout(); useApp.setState({ signedOut: true, loaded: false, snap: null }); }} />
              : <ConfirmButton className="menu-item danger" label={<span className="mi-label">Reset sample workspace</span>} confirmLabel={<span className="mi-label">Click again to wipe all data</span>}
                  onConfirm={async () => { workspaceMenu.close(); await api.reseed(); await useApp.getState().bootstrap(); }} />}
          </Menu>
        )}

        {personal.map(i => <Nav key={i.key} to={i.to} icon={i.icon} label={i.label} badge={i.badge} />)}

        <SectionHeader label="Workspace" open={isOpen('workspace')} onToggle={() => toggleSection('workspace')} />
        {isOpen('workspace') && (
          <div className="nav-group">
            {workspaceItems.map(i => <Nav key={i.key} to={i.to} icon={i.icon} label={i.label} badge={i.badge} />)}
            <button className="nav-item" onClick={moreMenu.open}>
              <IconMore /><span className="nav-label"><span className="nav-text">More</span></span>
            </button>
            {moreMenu.anchor && (
              <Menu anchor={moreMenu.anchor} onClose={moreMenu.close} width={220}>
                {hiddenItems.map(i => <MenuItem key={i.key} icon={i.icon} label={i.label} onClick={() => navigate(i.to)} />)}
                <MenuItem icon={<IconTrash size={14} />} label="Trash" onClick={() => navigate('/trash')} />
                <MenuSep />
                <MenuItem icon={<IconSettings size={14} />} label="Customize sidebar" onClick={() => setCustomizing(true)} />
              </Menu>
            )}
          </div>
        )}
        <AnimatePresence>{customizing && <CustomizeSidebar key="cs" onClose={() => setCustomizing(false)} />}</AnimatePresence>

        {favorites.length > 0 && (
          <>
            <SectionHeader label="Favorites" open={isOpen('favorites')} onToggle={() => toggleSection('favorites')} />
            {isOpen('favorites') && (
              <div className="nav-group">
                {favorites.map(f => f.to.startsWith('/projects/')
                  ? <ProjectHoverCard key={f.id} projectId={f.to.slice('/projects/'.length)}><Nav to={f.to} icon={f.icon} label={f.label} title="" /></ProjectHoverCard>
                  : <Nav key={f.id} to={f.to} icon={f.icon} label={f.label} title={f.title} />)}
              </div>
            )}
          </>
        )}

        <SectionHeader label="Your teams" open={isOpen('teams')} onToggle={() => toggleSection('teams')}
          action={<button className="icon-btn nav-section-add" title="Create a team" onClick={() => navigate('/settings/new-team')}><IconPlus size={13} /></button>} />
        {isOpen('teams') && (
          <div className="nav-group">
            {!yourTeams.length && snap.teams.length > 0 && <Nav to="/teams" icon={<IconTeam />} label="Browse teams to join" end />}
            {yourTeams.map(t => {
              const fallback = yourTeams.length === 1 || locTeam === t.key;
              const open = isOpen(`team:${t.id}`, fallback);
              const hasCycles = snap.cycles.some(c => c.teamId === t.id);
              return (
                <div key={t.id}>
                  <div className="nav-team-row">
                    <button className={`nav-item nav-team${open ? ' open' : ''}`} onClick={() => toggleSection(`team:${t.id}`, fallback)} aria-expanded={open}>
                      {teamDisplayIcon(t)}
                      <span className="nav-label"><span className="nav-text">{t.name}</span></span>
                      <IconCaret size={13} className="nav-caret" />
                    </button>
                    <button className="icon-btn nav-team-more" title="Team options" onClick={e => { setTeamMenuFor(t.id); teamMenu.open(e); }}><IconMore size={13} /></button>
                  </div>
                  {open && (
                    <div className="nav-sub">
                      <Nav to={`/team/${t.key}/overview`} icon={<IconHome />} label="Home" isActive={l => l.pathname.startsWith(`/team/${t.key}/overview`)} />
                      {t.triageEnabled && <Nav to={`/team/${t.key}/triage`} icon={<IconTriage />} label="Triage" badge={triageCount(t.id)} />}
                      <Nav to={`/team/${t.key}/all`} icon={<IconIssues />} label="Issues"
                        isActive={l => /^\/team\/[^/]+\/(all|active|backlog)$/.test(l.pathname) && l.pathname.startsWith(`/team/${t.key}/`)} />
                      {(hasCycles || t.autoCycles) && <>
                        <Nav to={`/team/${t.key}/cycles`} icon={<IconCycle />} label="Cycles" end />
                        <div className="nav-subsub">
                          <Nav to={`/team/${t.key}/cycles/current`} icon={null} label="Current" title="Current cycle (G then V)"
                            isActive={l => { const now = new Date().toISOString(); const cur = snap.cycles.find(c => c.teamId === t.id && c.startsAt <= now && c.endsAt >= now); return !!cur && l.pathname === `/team/${t.key}/cycles/${cur.id}`; }} />
                          <Nav to={`/team/${t.key}/cycles/upcoming`} icon={null} label="Upcoming"
                            isActive={l => { const now = new Date().toISOString(); const up = snap.cycles.filter(c => c.teamId === t.id && c.startsAt > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]; return !!up && l.pathname === `/team/${t.key}/cycles/${up.id}`; }} />
                        </div>
                      </>}
                      <Nav to={`/team/${t.key}/projects`} icon={<IconBox />} label="Projects" />
                      <Nav to={`/team/${t.key}/views`} icon={<IconViews />} label="Views" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {teamMenu.anchor && menuTeam && (
        <Menu anchor={teamMenu.anchor} onClose={teamMenu.close} width={220}>
          <MenuItem icon={<IconTeam size={14} />} label="Team overview" onClick={() => navigate(`/team/${menuTeam.key}/overview`)} />
          <MenuItem icon={<IconIssues size={14} />} label="Issues" onClick={() => navigate(`/team/${menuTeam.key}/all`)} />
          <MenuItem icon={<IconCycle size={14} />} label="Cycles" onClick={() => navigate(`/team/${menuTeam.key}/cycles`)} />
          <MenuItem icon={<IconTriage size={14} />} label="Triage" onClick={() => navigate(`/team/${menuTeam.key}/triage`)} />
          <MenuItem icon={<IconArchive size={14} />} label="Archive" onClick={() => navigate(`/team/${menuTeam.key}/archive`)} />
          <MenuSep />
          <MenuItem icon={<IconSettings size={14} />} label="Team settings" onClick={() => navigate(`/settings/team/${menuTeam.key}`)} />
          {hosted && menuTeam.memberIds.includes(snap.currentUser.id) && <MenuItem icon={<IconTeam size={14} />} label="Leave team" danger onClick={async () => {
            try { await api.leaveTeam(menuTeam.id); await useApp.getState().bootstrap(); useApp.getState().toast({ title: `You left ${menuTeam.name}` }); }
            catch (err) { useApp.getState().toast({ title: (err as Error).message }); }
          }} />}
          <MenuItem icon={<IconLink size={14} />} label="Copy link to team" onClick={async () => { await navigator.clipboard.writeText(`${location.origin}/#/team/${menuTeam.key}/all`).catch(() => {}); useApp.getState().toast({ title: 'Copied link' }); }} />
        </Menu>
      )}

      <div className="sidebar-footer">
        <button className="footer-help" title="Help (?)" ref={helpRef} onClick={helpMenu.open}>
          <IconHelp size={15} />
        </button>
        {helpMenu.anchor && (
          <Menu anchor={helpMenu.anchor} onClose={helpMenu.close} width={230}>
            <GettingStartedMenu />
            <MenuItem icon={<IconKeyboard size={14} />} label="Keyboard shortcuts" right={<span className="mi-kbd">⌘/</span>} onClick={() => useApp.getState().setShortcuts(true)} />
            <MenuItem icon={<IconSearch size={14} />} label="Command menu" right={<span className="mi-kbd">⌘K</span>} onClick={() => useApp.getState().setPalette(true)} />
            <MenuItem icon={<IconSettings size={14} />} label="Settings" right={<span className="mi-kbd">G then S</span>} onClick={() => navigate('/settings/workspace')} />
            <MenuItem icon={<IconArchive size={14} />} label="Import & export" onClick={() => navigate('/settings/data')} />
          </Menu>
        )}
        <span style={{ flex: 1 }} />
        <button
          className="icon-btn footer-btn"
          title="Toggle theme"
          onClick={() => useApp.getState().setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {resolvedTheme === 'dark' ? <IconMoon size={15} /> : <IconSun size={15} />}
        </button>
        <button className="icon-btn footer-btn" title="Settings" onClick={() => navigate('/settings/workspace')}>
          <IconSettings size={15} />
        </button>
      </div>
    </aside>
  );
}

/* Linear's section header: the label, then a small caret that turns when the section folds */
function SectionHeader(props: { label: string; open: boolean; onToggle: () => void; action?: React.ReactNode }) {
  const btn = (
    <button className={`nav-section${props.open ? ' open' : ''}`} onClick={props.onToggle} aria-expanded={props.open}>
      <span>{props.label}</span>
      <IconCaret size={12} className="nav-caret" />
    </button>
  );
  return props.action ? <div className="nav-section-row">{btn}{props.action}</div> : btn;
}

/* Linear's sidebar preview: rest on a favorite project and its card appears beside it */
function ProjectHoverCard(props: { projectId: string; children: React.ReactNode }) {
  const snap = useApp(s => s.snap)!;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const p = snap.projects.find(x => x.id === props.projectId);
  if (!p) return <>{props.children}</>;
  const issues = snap.issues.filter(i => i.projectId === p.id);
  const done = issues.filter(i => ['completed', 'canceled'].includes(snap.states.find(s => s.id === i.stateId)?.type ?? '')).length;
  const pct = issues.length ? Math.round((done / issues.length) * 100) : 0;
  const team = snap.teams.find(t => t.id === p.teamId);
  const status = snap.projectStatuses.find(s => s.id === p.statusId)?.name ?? p.status;
  const lead = snap.users.find(u => u.id === p.leadId);
  return (
    <div onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); clearTimeout(timer.current); timer.current = setTimeout(() => setPos({ x: r.right + 6, y: r.top }), 450); }}
      onMouseLeave={() => { clearTimeout(timer.current); setPos(null); }}>
      {props.children}
      {pos && createPortal(
        <div className="hover-card" style={{ left: pos.x, top: Math.min(pos.y, window.innerHeight - 170) }} data-hover-card>
          <div className="hc-title"><span>{p.icon}</span>{p.name}</div>
          {(p.summary || p.description) && <div className="hc-desc">{p.summary || p.description.replace(/[#*_`>]/g, '').slice(0, 140)}</div>}
          <div className="hc-props">
            <span>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
            {team && <span><span className="ws-avatar" style={{ background: team.color, borderRadius: 3, fontSize: 7, width: 13, height: 13 }}>{team.key[0]}</span>{team.name}</span>}
            {lead && <span>{lead.name}</span>}
            <span>{pct}% of {issues.length}</span>
          </div>
        </div>, document.body)}
    </div>
  );
}

function Nav(props: { to: string; icon: React.ReactNode; label: string; badge?: number; end?: boolean; title?: string; isActive?: (loc: { pathname: string }) => boolean }) {
  const loc = useLocation();
  const badgeStyle = useApp(s => s.snap?.workspace.preferences.sidebar.badgeStyle ?? 'count');
  const active = props.isActive ? props.isActive(loc) : undefined;
  return (
    <NavLink
      to={props.to}
      className={({ isActive }) => `nav-item ${active ?? isActive ? 'active' : ''}`}
      end={props.end}
      title={props.title ?? props.label}
    >
      {({ isActive }) => (
        <>
          {props.icon}
          <span className="nav-label">
            {/* the mark sits outside .nav-text's ellipsis clip, sized to the label */}
            <span className="nav-text-wrap">
              <span className="nav-text">{props.label}</span>
              {(active ?? isActive) && <RegisterMark group="nav" />}
            </span>
          </span>
          {props.badge ? (badgeStyle === 'dot' ? <span className="nav-dot" aria-label={`${props.badge} unread`} /> : badgeStyle === 'none' ? null : <span className="nav-count">{props.badge}</span>) : null}
        </>
      )}
    </NavLink>
  );
}


/* ---------------- top bar ---------------- */
export function TopBar(props: {
  crumbs: Array<{ label: string; icon?: React.ReactNode; to?: string; muted?: boolean; onClick?: (e: React.MouseEvent) => void }>;
  right?: React.ReactNode;
  favoriteRef?: { type: string; refId: string };
  more?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const snap = useApp(s => s.snap);
  const menu = useMenu();
  const faved = props.favoriteRef && snap
    ? snap.favorites.some(f => f.type === props.favoriteRef!.type && f.refId === props.favoriteRef!.refId)
    : false;

  const sidebarCollapsed = useApp(s => s.sidebarCollapsed);

  return (
    <div className="topbar">
      {sidebarCollapsed && (
        <button
          className="icon-btn topbar-sidebar-btn" title="Show sidebar (⌘B)"
          onClick={() => useApp.getState().toggleSidebar()}
        >
          <IconSidebar size={15} />
        </button>
      )}
      <div className="breadcrumb">
        {props.crumbs.map((c, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span className="crumb-sep">›</span>}
            {c.onClick
              ? <button className={`crumb crumb-menu ${c.muted ? 'muted' : ''}`} onClick={c.onClick}>{c.icon}<span className="crumb-label">{c.label}</span><IconChevronDown size={11} style={{ color: 'var(--text-dim)' }} /></button>
              : c.to
              ? <Link to={c.to} className={`crumb ${c.muted ? 'muted' : ''}`}>{c.icon}<span className="crumb-label">{c.label}</span></Link>
              : <span className={`crumb ${c.muted ? 'muted' : ''}`}>{c.icon}<span className="crumb-label">{c.label}</span></span>}
          </span>
        ))}
        {props.favoriteRef && (
          <button
            className="icon-btn" style={{ marginLeft: 4, width: 22, height: 22, color: faved ? 'var(--brand)' : undefined }}
            data-favorite-star
            title={faved ? 'Remove from favorites' : 'Add to favorites'}
            onClick={async () => {
              await api.toggleFavorite(props.favoriteRef!.type, props.favoriteRef!.refId);
              await useApp.getState().bootstrap();
            }}
          >
            <IconStar size={14} filled={faved} />
          </button>
        )}
        {/* Linear keeps the page's "…" beside the title, and only on pages that have actions */}
        {props.more && <button className="icon-btn topbar-more" title="More" onClick={menu.open}><IconMore size={15} /></button>}
      </div>
      <div className="topbar-right">
        {props.right}
      </div>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close}>
          {props.more}
          {props.more && <MenuSep />}
          <MenuItem icon={<IconSettings size={14} />} label="Settings" onClick={() => navigate('/settings/workspace')} />
          <MenuItem label="Keyboard shortcuts" right={<span className="kbd">?</span>} onClick={() => useApp.getState().setShortcuts(true)} />
          <MenuSep />
          <MenuItem
            icon={<span>🌓</span>}
            label="Toggle theme"
            onClick={() => {
              const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
              useApp.getState().setTheme(next as 'dark' | 'light');
            }}
          />
        </Menu>
      )}
    </div>
  );
}
