import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, relTime, shortDate } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, Modal, useMenu, ConfirmIconButton } from './ui.js';
import { Avatar, teamDisplayIcon } from './pickers.js';
import { AvatarStack } from './AvatarStack.js';
import {
  IconPlus, IconSearch, IconTrash, IconClose, IconCheck, IconCycle, IconBox,
  IconInbox, IconMyIssues, IconDrafts, IconInitiative, IconViews, IconTeam, IconMembers, IconChevronDown,
} from './icons.js';
import { SIDEBAR_DEFAULTS, type SidebarVisibility, type Team } from '../../src/core/types.js';
import { EmptyState } from './EmptyState.js';

type Snap = NonNullable<ReturnType<typeof useApp.getState>['snap']>;
const refresh = () => useApp.getState().bootstrap();

/* ================= Teams & Members (workspace directories) ================= */
/** join or leave a team right in a list whose row opens the team. Joining is one click; leaving
 *  takes two ("Joined" → "Leave?"), since the chip sits inside a row that opens the team. */
export function TeamJoinChip({ team }: { team: Team }) {
  const joined = useApp(s => team.memberIds.includes(s.snap!.currentUser.id));
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (joined && !armed) { setArmed(true); return; }
    setArmed(false);
    try {
      await (joined ? api.leaveTeam(team.id) : api.joinTeam(team.id));
      await useApp.getState().bootstrap();
      useApp.getState().toast({ title: joined ? `You left ${team.name}` : `You joined ${team.name}` });
    } catch (err) { useApp.getState().toast({ title: (err as Error).message }); }
  };
  return (
    <button className={`plabel-chip team-join${joined ? ' joined' : ''}${armed ? ' armed' : ''}`} title={joined ? `Leave ${team.name}` : `Join ${team.name}`} aria-label={joined ? `Leave ${team.name}` : `Join ${team.name}`} onClick={toggle} onBlur={() => setArmed(false)}>
      {armed ? 'Leave?' : joined ? <><IconCheck size={11} /> Joined</> : 'Join'}
    </button>
  );
}

export function TeamsPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const now = new Date().toISOString();
  const cyclesOn = snap.workspace.features.cyclesEnabled;
  const list = snap.teams.filter(t => `${t.name} ${t.key}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Teams' }]} right={<button className="btn secondary" onClick={() => navigate('/settings/new-team')}><IconPlus size={13} /> New team</button>} />
      <div className="subnav"><div className="set-filter" style={{ border: 0, margin: 0, flex: 1 }}><IconSearch size={13} /><input placeholder="Find teams…" value={q} onChange={e => setQ(e.target.value)} /></div></div>
      <div className="content">
        {/* the Cycle column stays (the grid is fixed) but says nothing while cycles are off */}
        <div className="wtable">
          <div className="wt-head wt-teams"><span>Name</span><span>Description</span><span>Membership</span><span>Members</span><span>{cyclesOn ? 'Cycle' : ''}</span><span>Active projects</span></div>
          {!list.length && <div className="set-empty">No teams match “{q.trim()}”.</div>}
          {list.map(t => {
            const members = t.memberIds.map(id => snap.users.find(u => u.id === id)).filter(Boolean);
            const cur = cyclesOn ? snap.cycles.find(c => c.teamId === t.id && c.startsAt <= now && c.endsAt >= now) : undefined;
            const active = snap.projects.filter(p => p.teamId === t.id && p.status === 'started').length;
            return (
              <div key={t.id} className="wt-row wt-teams" onClick={() => navigate(`/team/${t.key}/overview`)}>
                <span className="wt-name">{teamDisplayIcon(t)}<span>{t.name}</span><span className="dim mono">{t.key}</span></span>
                <span className="dim wt-clip">{t.description?.replace(/\s+/g, ' ') || ''}</span>
                <span><TeamJoinChip team={t} /></span>
                <span><AvatarStack size={18} people={members.slice(0, 5).map(u => ({ name: u!.name, initials: u!.initials, color: u!.color }))} /></span>
                <span className="wt-iconnum">{cur ? <><IconCycle size={12} />{cur.number}</> : null}</span>
                <span className="wt-iconnum"><IconBox size={12} />{active}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MembersPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list = snap.users.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  const firstSeen = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of snap.activity) if (a.userId && (!m.has(a.userId) || a.createdAt < m.get(a.userId)!)) m.set(a.userId, a.createdAt);
    return m;
  }, [snap.activity]);
  const lastSeen = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of snap.activity) if (a.userId && (!m.has(a.userId) || a.createdAt > m.get(a.userId)!)) m.set(a.userId, a.createdAt);
    return m;
  }, [snap.activity]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Members' }]} right={<button className="btn secondary" onClick={() => navigate('/settings/members')}><IconPlus size={13} /> {snap.workspace.auth === 'hosted' ? 'Invite' : 'Add member'}</button>} />
      <div className="subnav"><div className="set-filter" style={{ border: 0, margin: 0, flex: 1 }}><IconSearch size={13} /><input placeholder="Find members…" value={q} onChange={e => setQ(e.target.value)} /></div></div>
      <div className="content">
        <div className="wtable">
          <div className="wt-head wt-members"><span>Name</span><span>Role</span><span>Joined</span><span>Teams</span><span>Last seen</span></div>
          {!list.length && <div className="set-empty">No one matches “{q.trim()}”.</div>}
          {list.map(u => {
            const teams = snap.teams.filter(t => t.memberIds.includes(u.id));
            const joinedAt = u.createdAt ?? firstSeen.get(u.id) ?? snap.workspace.createdAt;
            const seenAt = u.lastSeenAt ?? lastSeen.get(u.id);
            const me = u.id === snap.currentUser.id;
            return (
              <div key={u.id} className="wt-row wt-members" onClick={() => navigate(`/profiles/${u.id}`)}>
                <span className="wt-name"><Avatar user={u} size={22} /><span className="wt-stack"><span>{u.name}</span><span className="dim">{u.username || u.email}</span></span></span>
                <span>{u.kind === 'agent' ? <span className="plabel-chip">Agent</span> : u.status === 'suspended' ? <span className="plabel-chip">Suspended</span> : u.admin ? <span className="plabel-chip admin">Admin</span> : <span className="plabel-chip">Member</span>}</span>
                <span className="mono dim">{shortDate(joinedAt)}</span>
                <span className="wt-teams-cell">{teams.map(t => <span key={t.id} className="wt-team"><span className="ws-avatar" style={{ background: t.color, borderRadius: 3, fontSize: 7, width: 13, height: 13 }}>{t.key[0]}</span>{t.key}</span>)}</span>
                <span>{me ? <span className="online"><span className="online-dot" />Online</span> : <span className="dim mono">{seenAt ? relTime(seenAt) : '—'}</span>}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================= Drafts ================= */
export interface DraftEntry { teamId: string; title: string; description: string; savedAt: string }
export function readDrafts(): DraftEntry[] {
  const out: DraftEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && /^baseline:draft:(.+)$/.exec(k);
      if (!m) continue;
      const d = JSON.parse(localStorage.getItem(k!) ?? 'null') as { title?: string; description?: string; savedAt?: string } | null;
      if (d) out.push({ teamId: m[1], title: d.title ?? '', description: d.description ?? '', savedAt: d.savedAt ?? '' });
    }
  } catch { /* storage unavailable */ }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export function useDrafts(): DraftEntry[] {
  const [list, setList] = useState(readDrafts);
  useEffect(() => {
    const on = () => setList(readDrafts());
    window.addEventListener('baseline:drafts', on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener('baseline:drafts', on); window.removeEventListener('storage', on); };
  }, []);
  return list;
}

export function DraftsPage() {
  const snap = useApp(s => s.snap)!;
  const drafts = useDrafts();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Drafts' }]} />
      <div className="content">
        {!drafts.length ? (
          <EmptyState kind="holding" word="Drafts" illo="drafts" title="No active drafts" desc={<>"Save draft" in the new-issue modal keeps an issue here until you finish it.</>} />
        ) : (
          <div className="static-list">
            {drafts.map(d => {
              const t = snap.teams.find(x => x.id === d.teamId);
              return (
                <div key={d.teamId} className="issue-row static-row" onClick={() => useApp.getState().openCreate({ teamId: d.teamId })}>
                  {t && teamDisplayIcon(t)}
                  <span className="row-title-wrap"><span className="row-title">{d.title || 'Untitled draft'}</span><span className="row-parent">{d.description.replace(/\s+/g, ' ').slice(0, 80)}</span></span>
                  <span className="row-meta"><span className="row-date">{d.savedAt ? relTime(d.savedAt) : ''}</span>
                    <ConfirmIconButton className="icon-btn" title="Delete draft" onConfirm={e => { e.stopPropagation(); try { localStorage.removeItem(`baseline:draft:${d.teamId}`); } catch { /* ignore */ } window.dispatchEvent(new Event('baseline:drafts')); }}><IconTrash size={13} /></ConfirmIconButton>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= Customize sidebar ================= */
export const SIDEBAR_ITEMS: Array<{ key: string; label: string; section: 'Personal' | 'Workspace' }> = [
  { key: 'inbox', label: 'Inbox', section: 'Personal' }, { key: 'my-issues', label: 'My issues', section: 'Personal' }, { key: 'drafts', label: 'Drafts', section: 'Personal' },
  { key: 'initiatives', label: 'Initiatives', section: 'Workspace' }, { key: 'projects', label: 'Projects', section: 'Workspace' }, { key: 'views', label: 'Views', section: 'Workspace' },
  { key: 'teams', label: 'Teams', section: 'Workspace' }, { key: 'members', label: 'Members', section: 'Workspace' },
];
// Customize sidebar is cut (CORE_FLOW.md › Core vs niche): everyone gets the defaults. Stored
// choices stay in preferences, unread, in case it comes back
export function sidebarVisibility(_snap: Snap, key: string): SidebarVisibility {
  return SIDEBAR_DEFAULTS[key] ?? 'show';
}

const SIDEBAR_ICONS: Record<string, React.ReactNode> = {
  inbox: <IconInbox />, 'my-issues': <IconMyIssues />, drafts: <IconDrafts />, initiatives: <IconInitiative />, projects: <IconBox />, views: <IconViews />,
  teams: <IconTeam />, members: <IconMembers />,
};
const VISIBILITY_LABEL: Record<SidebarVisibility, string> = { show: 'Always show', badged: 'Show when badged', hide: "Don't show" };
const BADGE_LABEL = { count: 'Count', dot: 'Dot', none: 'None' } as const;
type BadgeStyle = keyof typeof BADGE_LABEL;
function BadgePreview({ style }: { style: BadgeStyle }) {
  return style === 'count' ? <span className="cs-badge-count">1</span> : style === 'dot' ? <span className="cs-badge-dot" /> : null;
}

export function CustomizeSidebar(props: { onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const sb = snap.workspace.preferences.sidebar;
  const menu = useMenu();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const save = async (patch: { badgeStyle?: BadgeStyle; items?: Record<string, SidebarVisibility> }) => { await api.updatePreferences({ sidebar: { ...sb, ...patch, items: { ...sb.items, ...(patch.items ?? {}) } } }); await refresh(); };
  // only items the sidebar can actually show: feature-gated pages are left out while their feature is off
  const f = snap.workspace.features;
  const off: Record<string, boolean> = { initiatives: !f.initiativesEnabled };
  const items = SIDEBAR_ITEMS.filter(i => !off[i.key]);
  const openMenu = (key: string) => (e: React.MouseEvent) => { setMenuFor(key); menu.open(e); };
  const menuItem = items.find(i => i.key === menuFor);
  return (
    <Modal onClose={props.onClose} className="modal small-modal wide cs-modal">
      <div className="sm-head"><span>Customize sidebar</span><button className="icon-btn" aria-label="Close" onClick={props.onClose}><IconClose size={14} /></button></div>
      <div className="sm-body">
        <div className="cs-card">
          <div className="cs-row">
            <span className="cs-label">Default badge style</span>
            <button className={`cs-pick${menuFor === 'badge' && menu.anchor ? ' open' : ''}`} aria-label="Default badge style" onClick={openMenu('badge')}>
              <BadgePreview style={sb.badgeStyle} /><span>{BADGE_LABEL[sb.badgeStyle]}</span><IconChevronDown size={12} />
            </button>
          </div>
        </div>
        {(['Personal', 'Workspace'] as const).map(sec => (
          <section key={sec} className="cs-section">
            <h3 className="cs-sec">{sec}</h3>
            <div className="cs-card">
              {items.filter(i => i.section === sec).map(i => {
                const v = sidebarVisibility(snap, i.key);
                return (
                  <div key={i.key} className={`cs-row${v === 'hide' ? ' hidden' : ''}`}>
                    <span className="cs-icon">{SIDEBAR_ICONS[i.key]}</span>
                    <span className="cs-label">{i.label}</span>
                    <button className={`cs-pick${menuFor === i.key && menu.anchor ? ' open' : ''}`} aria-label={`${i.label} visibility`} onClick={openMenu(i.key)}>
                      <span>{VISIBILITY_LABEL[v]}</span><IconChevronDown size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {menu.anchor && menuFor && (
        <Menu anchor={menu.anchor} onClose={() => { menu.close(); setMenuFor(null); }} width={200}>
          {menuFor === 'badge'
            ? (Object.keys(BADGE_LABEL) as BadgeStyle[]).map(b => <MenuItem key={b} label={BADGE_LABEL[b]} selected={sb.badgeStyle === b} onClick={() => void save({ badgeStyle: b })} />)
            : menuItem && (['show', 'badged', 'hide'] as const).map(v => <MenuItem key={v} label={VISIBILITY_LABEL[v]} selected={sidebarVisibility(snap, menuItem.key) === v} onClick={() => void save({ items: { [menuItem.key]: v } })} />)}
        </Menu>
      )}
    </Modal>
  );
}
