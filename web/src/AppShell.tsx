import { useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, useMenu, RegisterMark, ConfirmButton } from './ui.js';
import { Logo } from './Logo.js';
import { teamDisplayIcon } from './pickers.js';
import {
  IconInbox, IconMyIssues, IconBox, IconViews, IconIssues, IconCycle, IconTeam, IconHelp, IconCaret,
  IconSearch, IconNew, IconSettings, IconChevronDown, IconMore, IconStar, IconMoon, IconSun,
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
  const workspaceMenu = useMenu();
  const moreMenu = useMenu();
  const collapsed = useApp(s => s.sidebarCollapsed);
  const toggleSidebar = useApp(s => s.toggleSidebar);
  const navigate = useNavigate();
  const loc = useLocation();
  const [sections, toggleSection] = useSectionState();
  if (!snap) return null;
  const unread = snap.notifications.filter(n => !n.readAt).length;
  const me = snap.currentUser;
  const isOpen = (id: string, fallback = true) => sections[id] ?? fallback;
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
        return null;
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
            <button className="icon-btn ws-collapse" title="Collapse sidebar (⌘B)" onClick={toggleSidebar}><IconSidebar size={15} /></button>
            <button className="icon-btn" title="Search (⌘K)" onClick={() => useApp.getState().setPalette(true)}><IconSearch size={15} /></button>
            <button className="ws-new" title="New issue (C)" onClick={() => useApp.getState().openCreate()}><IconNew size={14} /></button>
          </div>
        </div>
        {workspaceMenu.anchor && (
          <Menu anchor={workspaceMenu.anchor} onClose={workspaceMenu.close} width={250}>
            <div className="menu-header"><span>{me.name} — {me.email || 'local user'}</span></div>
            <MenuItem icon={<IconSettings size={14} />} label="Settings" onClick={() => navigate('/settings/workspace')} />
            <MenuSep />
            <ConfirmButton className="menu-item danger" label={<span className="mi-label">Reset sample workspace</span>} confirmLabel={<span className="mi-label">Click again to wipe all data</span>}
              onConfirm={async () => { workspaceMenu.close(); await api.reseed(); await useApp.getState().bootstrap(); }} />
          </Menu>
        )}

        <Nav to="/inbox" icon={<IconInbox />} label="Inbox" badge={unread} />
        <Nav to="/my-issues" icon={<IconMyIssues />} label="My issues" />

        <SectionHeader label="Workspace" open={isOpen('workspace')} onToggle={() => toggleSection('workspace')} />
        {isOpen('workspace') && (
          <div className="nav-group">
            <Nav to="/projects" icon={<IconBox />} label="Projects" />
            <Nav to="/views" icon={<IconViews />} label="Views" />
            <button className="nav-item" onClick={moreMenu.open}>
              <IconMore /><span className="nav-label"><span className="nav-text">More</span></span>
            </button>
            {moreMenu.anchor && (
              <Menu anchor={moreMenu.anchor} onClose={moreMenu.close} width={220}>
                <MenuItem icon={<IconTeam size={14} />} label="Members" onClick={() => navigate('/settings/members')} />
                <MenuItem label="Labels" onClick={() => navigate('/settings/labels')} />
                <MenuItem label="Issue templates" onClick={() => navigate('/settings/templates')} />
                <MenuItem label="Coding tools" onClick={() => navigate('/settings/handoff')} />
                <MenuSep />
                <MenuItem label="Import & export" onClick={() => navigate('/settings/data')} />
              </Menu>
            )}
          </div>
        )}

        {favorites.length > 0 && (
          <>
            <SectionHeader label="Favorites" open={isOpen('favorites')} onToggle={() => toggleSection('favorites')} />
            {isOpen('favorites') && (
              <div className="nav-group">
                {favorites.map(f => <Nav key={f.id} to={f.to} icon={f.icon} label={f.label} title={f.title} />)}
              </div>
            )}
          </>
        )}

        <SectionHeader label="Your teams" open={isOpen('teams')} onToggle={() => toggleSection('teams')} />
        {isOpen('teams') && (
          <div className="nav-group">
            {snap.teams.map(t => {
              const fallback = snap.teams.length === 1 || locTeam === t.key;
              const open = isOpen(`team:${t.id}`, fallback);
              const hasCycles = snap.cycles.some(c => c.teamId === t.id);
              return (
                <div key={t.id}>
                  <button className={`nav-item nav-team${open ? ' open' : ''}`} onClick={() => toggleSection(`team:${t.id}`, fallback)} aria-expanded={open}>
                    {teamDisplayIcon(t)}
                    <span className="nav-label"><span className="nav-text">{t.name}</span></span>
                    <IconCaret size={13} className="nav-caret" />
                  </button>
                  {open && (
                    <div className="nav-sub">
                      <Nav to={`/team/${t.key}/all`} icon={<IconIssues />} label="Issues"
                        isActive={l => l.pathname.startsWith(`/team/${t.key}/`) && !l.pathname.endsWith('/cycles')} />
                      {hasCycles && <Nav to={`/team/${t.key}/cycles`} icon={<IconCycle />} label="Cycles" />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="footer-help" title="Keyboard shortcuts (?)" onClick={() => useApp.getState().setShortcuts(true)}>
          <IconHelp size={15} />
        </button>
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
function SectionHeader(props: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button className={`nav-section${props.open ? ' open' : ''}`} onClick={props.onToggle} aria-expanded={props.open}>
      <span>{props.label}</span>
      <IconCaret size={12} className="nav-caret" />
    </button>
  );
}

function Nav(props: { to: string; icon: React.ReactNode; label: string; badge?: number; end?: boolean; title?: string; isActive?: (loc: { pathname: string }) => boolean }) {
  const loc = useLocation();
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
          {props.badge ? <span className="nav-count">{props.badge}</span> : null}
        </>
      )}
    </NavLink>
  );
}


/* ---------------- top bar ---------------- */
export function TopBar(props: {
  crumbs: Array<{ label: string; icon?: React.ReactNode; to?: string; muted?: boolean }>;
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
            {c.to
              ? <Link to={c.to} className={`crumb ${c.muted ? 'muted' : ''}`}>{c.icon}<span className="crumb-label">{c.label}</span></Link>
              : <span className={`crumb ${c.muted ? 'muted' : ''}`}>{c.icon}<span className="crumb-label">{c.label}</span></span>}
          </span>
        ))}
        {props.favoriteRef && (
          <button
            className="icon-btn" style={{ marginLeft: 4, width: 22, height: 22, color: faved ? 'var(--brand)' : undefined }}
            title={faved ? 'Remove from favorites' : 'Add to favorites'}
            onClick={async () => {
              await api.toggleFavorite(props.favoriteRef!.type, props.favoriteRef!.refId);
              await useApp.getState().bootstrap();
            }}
          >
            <IconStar size={14} filled={faved} />
          </button>
        )}
      </div>
      <div className="topbar-right">
        {props.right}
        <button className="icon-btn" title="More" onClick={menu.open}><IconMore size={15} /></button>
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
