import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { Logo } from './Logo.js';
import {
  IconInbox, IconMyIssues, IconBox, IconViews, IconHome, IconIssues,
  IconSearch, IconNew, IconSettings, IconChevronDown, IconChevronRight, IconPlus, IconMore, IconStar, IconCycle,
} from './icons.js';

export function Sidebar() {
  const snap = useApp(s => s.snap);
  const workspaceMenu = useMenu();
  const [openTeam, setOpenTeam] = useState<string | null>(() => localStorage.getItem('baseline:openTeam'));
  if (!snap) return null;
  const unread = snap.notifications.filter(n => !n.readAt).length;
  const me = snap.currentUser;

  const favorites = snap.favorites
    .slice().sort((a, b) => a.position - b.position)
    .map(f => {
      if (f.type === 'project') {
        const p = snap.projects.find(x => x.id === f.refId);
        return p ? { id: f.id, label: p.name, icon: <span>{p.icon}</span>, to: `/projects/${p.id}` } : null;
      }
      if (f.type === 'view') {
        const v = snap.views.find(x => x.id === f.refId);
        if (v) return { id: f.id, label: v.name, icon: <span>{v.icon || '🗂'}</span>, to: `/views/${v.id}` };
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
          return { id: f.id, label: `${t?.key}-${i.number} ${i.title}`, icon: <IconIssues size={14} />, to: `/issue/${t?.key}-${i.number}` };
        }
        return null;
      }
      return null;
    })
    .filter(Boolean) as Array<{ id: string; label: string; icon: React.ReactNode; to: string }>;

  return (
    <aside className="sidebar">
      <div className="sidebar-main">
        <div className="ws-row">
          <button className="ws-switch" onClick={workspaceMenu.open}>
            <Logo size={20} />
            <span className="ws-name">{snap.workspace.name}</span>
            <IconChevronDown size={13} style={{ color: 'var(--text-secondary)' }} />
          </button>
          <div className="ws-actions">
            <button className="icon-btn" title="Search (⌘K)" onClick={() => useApp.getState().setPalette(true)}><IconSearch size={15} /></button>
            <button className="icon-btn" title="New issue (C)" onClick={() => useApp.getState().openCreate()}><IconNew size={15} /></button>
          </div>
        </div>
        {workspaceMenu.anchor && (
          <Menu anchor={workspaceMenu.anchor} onClose={workspaceMenu.close} width={250}>
            <div className="menu-header"><span>{me.name} — {me.email || 'local user'}</span></div>
            <MenuItem icon={<IconSettings size={14} />} label="Settings" onClick={() => { location.hash = '#/settings/workspace'; }} />
            <MenuItem
              icon={<span>🌓</span>}
              label="Toggle theme"
              onClick={() => {
                const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
                useApp.getState().setTheme(next as 'dark' | 'light');
              }}
            />
            <MenuSep />
            <MenuItem danger label="Reset sample workspace" onClick={async () => { await api.reseed(); await useApp.getState().bootstrap(); }} />
          </Menu>
        )}

        <Nav to="/inbox" icon={<IconInbox />} label="Inbox" badge={unread} />
        <Nav to="/my-issues" icon={<IconMyIssues />} label="My issues" />

        {/* favorites sit directly under the primary nav, Linear-style (no section header) */}
        {favorites.map(f => (
          <Nav key={f.id} to={f.to} icon={f.icon} label={f.label} />
        ))}

        <SectionHeader label="Workspace" />
        <Nav to="/projects" icon={<IconBox />} label="Projects" />
        <Nav to="/views" icon={<IconViews />} label="Views" />

        <SectionHeader label="Your teams" action={<IconPlus size={13} />} onAction={() => { location.hash = '#/settings/teams'; }} />
        {snap.teams.map(team => {
          const isOpen = openTeam === team.id;
          return (
            <div key={team.id}>
              <button
                className={`nav-item ${isOpen ? 'active' : ''}`}
                onClick={() => {
                  const next = isOpen ? null : team.id;
                  setOpenTeam(next);
                  if (next) localStorage.setItem('baseline:openTeam', next); else localStorage.removeItem('baseline:openTeam');
                }}
              >
                <span className="ws-avatar" style={{ background: team.color, borderRadius: 4, fontSize: 9, width: 18, height: 18 }}>
                  {team.icon?.match(/\p{Emoji}/u) ? team.icon : team.key[0]}
                </span>
                <span className="nav-label">{team.name}</span>
                {isOpen
                  ? <IconChevronDown size={13} style={{ color: 'var(--text-dim)' }} />
                  : <IconChevronRight size={13} style={{ color: 'var(--text-dim)', opacity: 0 }} />}
              </button>
              {isOpen && (
                <div style={{ paddingLeft: 22 }}>
                  <Nav to={`/team/${team.key}`} icon={<IconHome size={14} />} label="Home" end />
                  <Nav to={`/team/${team.key}/all`} icon={<IconIssues size={14} />} label="All issues" />
                  <Nav to={`/team/${team.key}/active`} icon={<IconIssues size={14} />} label="Active" />
                  <Nav to={`/team/${team.key}/backlog`} icon={<IconIssues size={14} />} label="Backlog" />
                  {snap.cycles.some(c => c.teamId === team.id) && (
                    <Nav to={`/team/${team.key}/cycles`} icon={<IconCycle size={14} />} label="Cycles" />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Nav(props: { to: string; icon: React.ReactNode; label: string; badge?: number; end?: boolean }) {
  return (
    <NavLink to={props.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end={props.end} title={props.label}>
      {props.icon}
      <span className="nav-label">{props.label}</span>
      {props.badge ? <span className="nav-count">{props.badge}</span> : null}
    </NavLink>
  );
}

function SectionHeader(props: { label: string; action?: React.ReactNode; onAction?: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="nav-section" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span style={{ color: 'var(--text-secondary)' }}>{props.label}</span>
      <span style={{ flex: 1 }} />
      {props.action && (
        <button className="icon-btn" style={{ width: 20, height: 20, opacity: hover ? 1 : 0 }} onClick={props.onAction}>
          {props.action}
        </button>
      )}
    </div>
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

  return (
    <div className="topbar">
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
