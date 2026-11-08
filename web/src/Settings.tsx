import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { useApp, shortDate } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, useMenu, Modal, ConfirmButton, AdminLock, ADMIN_NOTE, useCanConfigure, useInFlight } from './ui.js';
import { AnimatePresence } from 'framer-motion';
import { StateIcon, PriorityIcon, Avatar, CalendarGrid } from './pickers.js';
import { IconBack, IconPlus, IconClose, IconTrash, IconAgent, IconCalendar, IconSearch, IconSliders, IconUser, IconBell, IconKeyboard, IconTag, IconDoc, IconSla, IconStatusRing, IconPulse, IconInitiative, IconCustomers, IconRelease, IconAsk, IconLoop, IconEmoji, IconPr, IconSettings, IconTeam, IconUsers, IconArchive, IconShieldUser, IconCode, IconChevronRight, IconPanel, IconTriage, IconCycle } from './icons.js';
import { dateLabel } from './Views.js';
import { LocationsSettings } from './CodingTools.js';
import { HostedMembersSettings, SecuritySettings as WorkspaceSecuritySettings } from './Members.js';
import { ShortcutList } from './Palette.js';
import { CADENCE_LABELS } from './actions.js';
import { SlaSettings, AsksSettings, LoopsSettings } from './AutomationUI.js';
import { GitHubSettings, PrAutomationSettings } from './GitHubUI.js';
import { CustomizeSidebar } from './Workspace.js';
import { SecuritySettings, NewApiKey, ApiAdminSettings } from './ApiKeysUI.js';
import { InitiativesSettings, ProjectLabelsSettings, ProjectStatusesSettings, ProjectUpdatesSettings, DocumentsSettings, CustomerRequestsSettings, PulseSettings, EmojisSettings } from './SettingsMore.js';
import { DEFAULT_PROMPT_TEMPLATE, PROMPT_TEMPLATE_VARS, buildHandoff } from '../../src/core/handoff.js';
import { TERMINAL_APPS, NOTIFY_CATEGORIES, type NotifyCategory, type WorkflowStateType, type Priority, type TerminalApp } from '../../src/core/types.js';
import { readInboxPrefs, writeInboxPrefs, DEFAULT_PRIORITY_CATS } from './Inbox.js';

export const SETTINGS_NAV: Array<{ sec: string; items: Array<[string, string]> }> = [
  { sec: 'Personal', items: [['Preferences', 'preferences'], ['Profile', 'profile'], ['Notifications', 'notifications'], ['Security & access', 'security'], ['Keyboard shortcuts', 'shortcuts']] },
  { sec: 'Issues', items: [['Labels', 'labels'], ['Templates', 'templates'], ['SLAs', 'slas']] },
  { sec: 'Projects', items: [['Labels', 'project-labels'], ['Templates', 'project-templates'], ['Statuses', 'project-statuses'], ['Updates', 'project-updates']] },
  { sec: 'Features', items: [['Initiatives', 'initiatives'], ['Documents', 'documents'], ['Customer requests', 'customer-requests'], ['Releases', 'releases'], ['Pulse', 'pulse'], ['Asks', 'asks'], ['Loops', 'loops'], ['Emojis', 'emojis']] },
  { sec: 'Integrations', items: [['GitHub', 'github']] },
  { sec: 'Administration', items: [['Workspace', 'workspace'], ['Teams', 'teams'], ['Members', 'members'], ['Security', 'workspace-security'], ['API', 'api'], ['Coding tools', 'handoff'], ['Import & export', 'data']] },
];

const SETTINGS_ICONS: Record<string, React.ReactNode> = {
  preferences: <IconSliders size={14} />, profile: <IconUser size={14} />, notifications: <IconBell size={14} />, security: <IconShieldUser size={14} />, 'workspace-security': <IconShieldUser size={14} />, api: <IconCode size={14} />, shortcuts: <IconKeyboard size={14} />,
  labels: <IconTag size={14} />, templates: <IconDoc size={14} />, slas: <IconSla size={14} />,
  'project-labels': <IconTag size={14} />, 'project-templates': <IconDoc size={14} />, 'project-statuses': <IconStatusRing size={14} />, 'project-updates': <IconPulse size={14} />,
  initiatives: <IconInitiative size={14} />, documents: <IconDoc size={14} />, 'customer-requests': <IconCustomers size={14} />, releases: <IconRelease size={14} />,
  pulse: <IconPulse size={14} />, asks: <IconAsk size={14} />, loops: <IconLoop size={14} />, emojis: <IconEmoji size={14} />, github: <IconPr size={14} />,
  workspace: <IconSettings size={14} />, teams: <IconTeam size={14} />, members: <IconUsers size={14} />, handoff: <IconAgent size={14} />, data: <IconArchive size={14} />,
};

// hosted, these pages set up the workspace or a team: admins change them, members can read them
const ADMIN_SECTIONS = new Set(['workspace', 'data', 'labels', 'templates', 'slas', 'project-labels', 'project-templates', 'project-statuses', 'project-updates',
  'initiatives', 'documents', 'customer-requests', 'releases', 'pulse', 'asks', 'loops', 'github']);
const ADMIN_TEAM_PAGES = new Set(['general', 'labels', 'templates', 'statuses', 'triage', 'workflow']);
const LABELS_NOTE = 'Only admins can change labels. Anyone can add one from a label menu.';

const STATE_TYPES: Array<[WorkflowStateType, string]> = [
  ['backlog', 'Backlog'], ['unstarted', 'Todo'], ['started', 'Started'], ['completed', 'Completed'], ['canceled', 'Canceled'],
];
const STATE_COLORS = ['#95a2b3', '#8a8f98', '#f2c94c', '#5e6ad2', '#7d8084', '#4cb782', '#eb5757', '#f2994a', '#c770f4', '#3b82f6'];
const LABEL_COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#3b82f6', '#5e6ad2', '#a78bfa', '#c770f4', '#8a8f98'];

export function SettingsLayout() {
  const { section = 'workspace', teamKey, sub, page } = useParams();
  const snap = useApp(s => s.snap)!;
  const [q, setQ] = useState('');
  const lockable = teamKey ? ADMIN_TEAM_PAGES.has(page ?? '') : ADMIN_SECTIONS.has(section);
  const lockNote = (teamKey ? page : section)?.endsWith('labels') ? LABELS_NOTE : ADMIN_NOTE;
  const match = (label: string, sec: string) => !q.trim() || `${label} ${sec}`.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        <Link to="/" className="back"><IconBack size={14} /> Back to app</Link>
        <div className="settings-search"><IconSearch size={13} /><input placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} /></div>
        {SETTINGS_NAV.map(g => {
          // workspace Security is who may sign in — only a hosted workspace has sign-in
          const items = g.items.filter(([label, key]) => match(label, g.sec) && (key !== 'workspace-security' || snap.workspace.auth === 'google'));
          if (!items.length) return null;
          return (
            <div key={g.sec}>
              <div className="sec">{g.sec}</div>
              {items.map(([label, key]) => (
                <NavLink key={key} to={`/settings/${key}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ height: 30 }}>
                  <span className="settings-icon">{SETTINGS_ICONS[key]}</span>
                  <span className="nav-label">{label}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
        <div>
          <div className="sec">Your teams</div>
          {snap.teams.map(t => (
            <NavLink key={t.id} to={`/settings/team/${t.key}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ height: 30 }}>
              <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 9, width: 16, height: 16 }}>{t.key[0]}</span>
              <span className="nav-label">{t.name}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="settings-content">
        {lockable ? <AdminLock note={lockNote}><SettingsPage /></AdminLock> : <SettingsPage />}
      </div>
    </div>
  );
}

function SettingsPage() {
  const { section = 'workspace', teamKey, sub } = useParams();
  const snap = useApp(s => s.snap)!;
  return (
    <>
      {teamKey && <TeamSettingsPage teamKey={teamKey} />}
      {!teamKey && section === 'preferences' && <PreferencesSettings />}
      {!teamKey && section === 'profile' && <ProfileSettings />}
      {!teamKey && section === 'notifications' && <NotificationSettings key={sub ?? ''} />}
      {section === 'security' && (sub === 'new-api-key' ? <NewApiKey /> : <SecuritySettings />)}
      {section === 'api' && <ApiAdminSettings />}
      {!teamKey && section === 'workspace' && <WorkspaceSettings />}
      {section === 'teams' && <TeamsSettings />}
      {section === 'new-team' && <NewTeamSettings />}
      {section === 'members' && (snap.workspace.auth === 'google' ? <HostedMembersSettings /> : <MembersSettings />)}
      {section === 'workspace-security' && snap.workspace.auth === 'google' && <WorkspaceSecuritySettings />}
      {section === 'labels' && <LabelsSettings />}
      {section === 'templates' && <TemplatesSettings />}
      {section === 'handoff' && <HandoffSettings />}
      {section === 'appearance' && <PreferencesSettings />}
      {section === 'data' && <DataSettings />}
      {section === 'shortcuts' && <ShortcutSettings />}
      {section === 'project-labels' && <ProjectLabelsSettings />}
      {section === 'project-templates' && <div className="settings-card"><h1>Project templates</h1><ProjectTemplatesSection /></div>}
      {section === 'project-statuses' && <ProjectStatusesSettings />}
      {section === 'project-updates' && <ProjectUpdatesSettings />}
      {section === 'documents' && <DocumentsSettings />}
      {section === 'customer-requests' && <CustomerRequestsSettings />}
      {section === 'pulse' && <PulseSettings />}
      {section === 'emojis' && <EmojisSettings />}
      {section === 'slas' && <SlaSettings />}
      {section === 'asks' && <AsksSettings />}
      {section === 'loops' && <LoopsSettings />}
      {section === 'github' && <GitHubSettings />}
      {section === 'initiatives' && <InitiativesSettings />}
      {section === 'releases' && <FeatureToggle title="Releases" flag="releasesEnabled" help="Track which issues ship in each release: give issues a Release, move releases from Planned to In progress to Released." link={['/releases', 'Open releases']} />}
    </>
  );
}

function WorkspaceSettings() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState(snap.workspace.name);
  const save = async () => { await api.updateWorkspace({ name }); await useApp.getState().bootstrap(); };
  return (
    <div className="settings-card">
      <h1>Workspace</h1>
      <div className="field-row">
        <div><div className="field-label">Name</div><div className="field-help">Shown in the top nav and page titles.</div></div>
        <input className="text-input" value={name} onChange={e => setName(e.target.value)} onBlur={save} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Members</div><div className="field-help">{snap.users.length} member{snap.users.length === 1 ? '' : 's'} in this local workspace.</div></div>
        <span style={{ color: 'var(--text-secondary)' }}>{snap.users.map(u => u.name).join(', ')}</span>
      </div>
      <div className="field-row">
        <div><div className="field-label">Agents</div><div className="field-help">Coding agents drive this workspace through the baseline CLI — the repo ships a skill (<code>skills/baseline/SKILL.md</code>) that teaches them the commands.</div></div>
        <code className="cli-chip">node bin/baseline.js --help</code>
      </div>
    </div>
  );
}

/* ---------------- teams: rename + workflow states CRUD + cycles ---------------- */
function TeamsSettings() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const create = async () => {
    if (!name.trim() || !key.trim()) return;
    await api.createTeam({ key, name });
    setName(''); setKey('');
    await useApp.getState().bootstrap();
  };
  return (
    <div className="settings-card">
      <h1>Teams</h1>
      <div className="card" style={{ padding: '4px 10px', marginBottom: 14 }}>
        {snap.teams.map(t => (
          <Link key={t.id} to={`/settings/team/${t.key}`} className="team-list-row">
            <span className="ws-avatar" style={{ background: t.color, borderRadius: 4 }}>{t.key.slice(0, 2)}</span>
            <b>{t.name}</b>
            <span className="dim">{t.key}</span>
            <span style={{ flex: 1 }} />
            <span className="dim">{snap.issues.filter(i => i.teamId === t.id).length} issues</span>
            {t.triageEnabled && <span className="team-flag">Triage</span>}
            {t.autoCycles && <span className="team-flag">Auto cycles</span>}
          </Link>
        ))}
      </div>
      <div className="field-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div><div className="field-label">Create team</div><div className="field-help">Default workflow states are added automatically.</div></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="text-input" style={{ minWidth: 60, width: 60 }} placeholder="KEY" value={key} onChange={e => setKey(e.target.value)} />
          <input className="text-input" placeholder="Team name" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}

/* Linear's "Create a new team": name, identifier derived from it (editable), then straight to the team */
function NewTeamSettings() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const derived = name.replace(/[^a-z0-9 ]/gi, '').trim().split(/\s+/).length > 1
    ? name.replace(/[^a-z0-9 ]/gi, '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 5).toUpperCase()
    : name.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase();
  const ident = keyTouched ? key : derived;
  const taken = snap.teams.some(t => t.key.toUpperCase() === ident.toUpperCase());
  const create = async () => {
    if (!name.trim() || !ident || taken) return;
    const { team } = await api.createTeam({ key: ident, name: name.trim() });
    await useApp.getState().bootstrap();
    useApp.getState().toast({ title: 'Team created', line: <>{team.name} ({team.key})</> });
    navigate(`/team/${team.key}/all`);
  };
  return (
    <div className="settings-card">
      <h1>Create a new team</h1>
      <p className="field-help" style={{ marginBottom: 18 }}>Create a new team to manage separate cycles, workflows and notifications.</p>
      <div className="card" style={{ padding: '6px 14px' }}>
        <div className="field-row">
          <div><div className="field-label">Team name</div></div>
          <input className="text-input" autoFocus placeholder="e.g. Engineering" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
        </div>
        <div className="field-row">
          <div><div className="field-label">Identifier</div><div className="field-help">Used in issue IDs — {ident || 'KEY'}-123.{taken && <span style={{ color: 'var(--danger, #e5484d)' }}> Already in use.</span>}</div></div>
          <input className="text-input" style={{ width: 100 }} placeholder="KEY" value={ident} onChange={e => { setKeyTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)); }} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn primary" disabled={!name.trim() || !ident || taken} onClick={create}>Create team</button>
      </div>
    </div>
  );
}

function TeamSettingsPage(props: { teamKey: string }) {
  const { page } = useParams();
  const navigate = useNavigate();
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const canConfigure = useCanConfigure();
  const team = snap.teams.find(t => t.key.toLowerCase() === props.teamKey.toLowerCase());
  const [name, setName] = useState(team?.name ?? '');
  const [key, setKey] = useState(team?.key ?? '');
  const [desc, setDesc] = useState(team?.description ?? '');
  useEffect(() => { setName(team?.name ?? ''); setKey(team?.key ?? ''); setDesc(team?.description ?? ''); }, [team?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!team) return <div className="settings-card"><h1>Team not found</h1></div>;
  const patch = async (p: Record<string, unknown>) => { await api.updateTeam(team.id, p); await useApp.getState().bootstrap(); };
  const wf = snap.teamWorkflows?.[team.id];
  const setWf = async (p: Record<string, unknown>) => { await api.setTeamWorkflow(team.id, p); await useApp.getState().bootstrap(); };
  const triageCount = snap.issues.filter(i => snap.states.find(s => s.id === i.stateId)?.type === 'triage' && i.teamId === team.id).length;
  const states = snap.states.filter(s => s.teamId === team.id).sort((a, b) => a.position - b.position);
  const base = `/settings/team/${team.key}`;
  const back = <Link to={page ? base : '/settings/teams'} className="settings-crumb"><IconBack size={13} /> {page ? <><span className="ws-avatar" style={{ background: team.color, borderRadius: 3, fontSize: 7, width: 13, height: 13 }}>{team.key[0]}</span>{team.name}</> : 'Teams'}</Link>;
  const link = (to: string, icon: React.ReactNode, label: string, help: string, right: React.ReactNode) => (
    <button className="set-row notif-row notif-link" onClick={() => navigate(`${base}/${to}`)}>
      <span className="notif-icon">{icon}</span>
      <div style={{ flex: 1, textAlign: 'left' }}><div className="field-label">{label}</div><div className="field-help">{help}</div></div>
      <span className="set-meta">{right}</span><IconChevronRight size={12} />
    </button>
  );
  const scaleNote: Record<string, string> = { none: 'Not in use', exponential: 'Exponential (1, 2, 4, 8, 16 Points)', fibonacci: 'Fibonacci (1, 2, 3, 5, 8 Points)', linear: 'Linear (1, 2, 3, 4, 5 Points)', tshirt: 'T-shirt (XS, S, M, L, XL)' };

  if (page === 'general') return (
    <div className="settings-card">
      {back}
      <h1>General</h1>
      <div className="card set-list">
        <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Name</div></div>
          <span className="ws-avatar" style={{ background: team.color, borderRadius: 4, fontSize: 9, width: 20, height: 20 }}>{team.key[0]}</span>
          <input className="text-input" aria-label="Team name" value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== team.name && void patch({ name: name.trim() })} /></div>
        <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Identifier</div><div className="field-help">Used in issue IDs</div></div>
          <input className="text-input" aria-label="Team identifier" value={key} onChange={e => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7))} onBlur={async () => { if (key && key !== team.key) { await patch({ key }); navigate(`/settings/team/${key}/general`, { replace: true }); } }} /></div>
      </div>
      <div className="settings-h2">Description</div>
      <div className="field-help" style={{ marginBottom: 8 }}>A short summary shown on the team page</div>
      <textarea className="text-input team-desc" aria-label="Team description" placeholder="e.g. Builds and maintains core platform infrastructure" value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => desc !== team.description && void patch({ description: desc })} />
      <div className="settings-h2">Estimates</div>
      <div className="field-help" style={{ marginBottom: 8 }}>Used to estimate issue complexity and plan cycle capacity.</div>
      <div className="card set-list">
        <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Issue estimation</div></div>
          <select className="text-input" style={{ width: 240 }} aria-label="Issue estimation" value={team.estimateScale} onChange={e => void patch({ estimateScale: e.target.value })}>
            {Object.entries(scaleNote).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        {team.estimateScale !== 'none' && <>
          <div className="set-row notif-row sub"><div style={{ flex: 1 }}><div className="field-label">Allow zero estimates</div><div className="field-help">When enabled, issues can be estimated with zero points. This is useful if, for example, you don’t want to count parent issues towards the total estimate.</div></div><SettingSwitch on={!!team.estimateZero} onChange={v => void patch({ estimateZero: v })} /></div>
          <div className="set-row notif-row sub"><div style={{ flex: 1 }}><div className="field-label">Extended estimate scale</div><div className="field-help">When enabled, the estimate scale is extended. This is normally not recommended, as large estimates usually mean that an issue should be broken up into smaller issues.</div></div><SettingSwitch on={!!team.estimateExtended} onChange={v => void patch({ estimateExtended: v })} /></div>
          <div className="set-row notif-row sub"><div style={{ flex: 1 }}><div className="field-label">Count unestimated issues</div><div className="field-help">When enabled, issues that have not been estimated will count as 1 estimate point. When disabled, unestimated issues count as 0 estimate points.</div></div><SettingSwitch on={team.estimateCountUnestimated !== false} onChange={v => void patch({ estimateCountUnestimated: v })} /></div>
        </>}
      </div>
    </div>
  );
  if (page === 'members') return (
    <div className="settings-card">
      {back}
      <h1>Members</h1>
      <div className="field-help" style={{ marginBottom: 12 }}>Everyone in this workspace can work in every team. Add people and agent identities in Administration › Members.</div>
      <div className="card set-list">
        {snap.users.map(u => <div key={u.id} className="set-row notif-row"><Avatar user={u} size={22} /><div style={{ flex: 1 }}><div className="field-label">{u.name}</div><div className="field-help">{u.kind === 'agent' ? 'Agent' : u.email || (u.admin ? 'Admin' : 'Member')}</div></div><span className="set-meta">{u.admin ? 'Admin' : u.kind === 'agent' ? 'Agent' : 'Member'}</span></div>)}
      </div>
    </div>
  );
  if (page === 'labels') return <div>{back}<LabelsSettings onlyTeamId={team.id} /></div>;
  if (page === 'templates') return <div>{back}<TemplatesSettings onlyTeamId={team.id} /></div>;
  if (page === 'recurring') return <div className="settings-card">{back}<h1>Recurring issues</h1><RecurringIssues teamId={team.id} /></div>;
  if (page === 'statuses') return <div className="settings-card">{back}<h1>Issue statuses</h1><div className="field-help" style={{ marginBottom: 12 }}>Customize the statuses issues go through. Number keys 1–9 pick a status in that order.</div><TeamEditor teamId={team.id} part="states" /></div>;
  if (page === 'triage') return (
    <div className="settings-card">
      {back}
      <h1>Triage</h1>
      <div className="field-help" style={{ marginBottom: 12 }}>Streamline how you handle requests from outside your team</div>
      <div className="card set-list">
        <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Enable triage</div><div className="field-help">Issues that agents, Asks and teammates outside the team file land in a Triage queue for review before they reach the backlog.{triageCount ? ` ${triageCount} issue${triageCount === 1 ? ' is' : 's are'} waiting now.` : ''}</div></div>
          <SettingSwitch on={team.triageEnabled} onChange={v => void patch({ triageEnabled: v })} /></div>
      </div>
    </div>
  );
  if (page === 'cycles') return (
    <div className="settings-card">
      {back}
      <h1>Cycles</h1>
      <div className="field-help" style={{ marginBottom: 12 }}>Focus your team over short, time-boxed windows</div>
      <AdminLock>
      <div className="card set-list">
        <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Enable cycles</div><div className="field-help">Keep the current cycle and upcoming ones scheduled, laid end to end.</div></div><SettingSwitch on={team.autoCycles} onChange={v => void patch({ autoCycles: v })} /></div>
        {team.autoCycles && <>
          <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Cycle duration</div></div>
            <select className="text-input" style={{ width: 160 }} aria-label="Cycle duration" value={team.cycleDuration} onChange={e => void patch({ cycleDuration: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7, 8].map(w => <option key={w} value={w}>{w} week{w === 1 ? '' : 's'}</option>)}</select></div>
          <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Cooldown</div><div className="field-help">Weeks off between cycles.</div></div>
            <select className="text-input" style={{ width: 160 }} aria-label="Cooldown" value={team.cycleCooldown} onChange={e => void patch({ cycleCooldown: Number(e.target.value) })}>{[0, 1, 2].map(w => <option key={w} value={w}>{w ? `${w} week${w === 1 ? '' : 's'}` : 'No cooldown'}</option>)}</select></div>
          <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Upcoming cycles</div><div className="field-help">How many future cycles to keep created.</div></div>
            <select className="text-input" style={{ width: 160 }} aria-label="Upcoming cycles" value={team.cycleUpcoming} onChange={e => void patch({ cycleUpcoming: Number(e.target.value) })}>{[1, 2, 3, 4, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
        </>}
        <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Roll over unfinished work</div><div className="field-help">When a cycle ends, its open issues move into the next cycle.</div></div><SettingSwitch on={team.cycleRollover} onChange={v => void patch({ cycleRollover: v })} /></div>
      </div>
      </AdminLock>
      <div className="settings-h2">All cycles</div>
      <TeamEditor teamId={team.id} part="cycles" />
    </div>
  );
  if (page === 'workflow') return (
    <div className="settings-card">
      {back}
      <h1>Workflows &amp; automations</h1>
      <div className="field-help" style={{ marginBottom: 4 }}>Manage issue automations, git workflows and other workflows.</div>
      <PrAutomationSettings teamId={team.id} />
      {wf && <>
        <div className="settings-h2">Auto-close automations</div>
        <div className="field-help" style={{ marginBottom: 8 }}>Automate closing issues based on status changes to related issues, staleness, etc.</div>
        <div className="card set-list">
          <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Auto-close parent issues</div><div className="field-help">Automatically close an open parent issue when its last sub-issue is closed</div></div><SettingSwitch on={wf.closeParent} onChange={v => void setWf({ closeParent: v })} /></div>
          <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Auto-close sub-issues</div><div className="field-help">Automatically close all sub-issues when their parent issue is closed</div></div><SettingSwitch on={wf.closeSubIssues} onChange={v => void setWf({ closeSubIssues: v })} /></div>
          <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Auto-close stale issues</div><div className="field-help">Automatically close issues that haven’t been completed, canceled, or updated in a while</div></div><SettingSwitch on={wf.closeStale} onChange={v => void setWf({ closeStale: v })} /></div>
          {wf.closeStale && <>
            <div className="set-row notif-row sub"><div style={{ flex: 1 }}><div className="field-label">Close after being stale for</div></div>
              <select className="text-input" style={{ width: 160 }} aria-label="Close after being stale for" value={wf.staleMonths} onChange={e => void setWf({ staleMonths: Number(e.target.value) })}>{[1, 3, 6, 9, 12].map(m => <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>)}</select></div>
            <div className="set-row notif-row sub"><div style={{ flex: 1 }}><div className="field-label">When closing stale issues, set status to</div></div>
              <select className="text-input" style={{ width: 160 }} aria-label="Stale status" value={wf.staleStateId ?? ''} onChange={e => void setWf({ staleStateId: e.target.value || null })}>
                <option value="">{states.find(s => s.type === 'canceled')?.name ?? 'Canceled'}</option>
                {states.filter(s => s.type === 'canceled' || s.type === 'completed').slice(1).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          </>}
        </div>
        <div className="settings-h2">Auto-archive closed issues</div>
        <div className="field-help" style={{ marginBottom: 8 }}>Closed (completed or canceled) issues are archived after the set time period. Issues in a project also wait until the project has been completed or canceled for that period. Changes apply within an hour.</div>
        <div className="card set-list">
          <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Auto-archive closed items after</div></div>
            <select className="text-input" style={{ width: 160 }} aria-label="Auto-archive after" value={wf.archiveMonths} onChange={e => void setWf({ archiveMonths: Number(e.target.value) })}>{[[1, '1 month'], [3, '3 months'], [6, '6 months'], [9, '9 months'], [12, '12 months'], [0, 'Never']].map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></div>
        </div>
        <div className="settings-h2">Re-order issues when moved to a new status</div>
        <div className="field-help" style={{ marginBottom: 8 }}>Define how issues should be ordered as they progress. Unless no action is chosen, issues moving to a previous status are always placed at the top of that status. This affects manual ordering.</div>
        <div className="card set-list">
          <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">When progressing status, place issues…</div></div>
            <select className="text-input" style={{ width: 160 }} aria-label="Re-order on status change" value={wf.reorder} onChange={e => void setWf({ reorder: e.target.value })}><option value="first">First</option><option value="last">Last</option><option value="none">No action</option></select></div>
        </div>
      </>}
    </div>
  );

  const recurringCount = snap.recurring.filter(r => r.teamId === team.id).length;
  const labelCount = snap.labels.filter(l => l.teamId === team.id).length;
  const templateCount = snap.templates.filter(t => t.teamId === team.id).length;
  return (
    <div className="settings-card">
      {back}
      <div className="team-hub-head"><h1>{team.name}</h1><Link to={`/team/${team.key}/overview`} className="set-meta team-hub-link">Team overview <IconChevronRight size={11} /></Link></div>
      <div className="field-help" style={{ margin: '-16px 0 16px' }}>Accessible to all workspace members</div>
      <div className="card set-list">
        {link('general', <IconSettings size={14} />, 'General', 'Name, identifier, description and estimates', '')}
        {link('members', <IconUsers size={14} />, 'Members', 'Manage team members', `${snap.users.length} member${snap.users.length === 1 ? '' : 's'}`)}
      </div>
      <div className="settings-h2">Issues, projects, and documents</div>
      <div className="card set-list">
        {link('labels', <IconTag size={14} />, 'Issue labels', 'Labels available to this team’s issues', labelCount || 'None')}
        {link('templates', <IconDoc size={14} />, 'Templates', 'Pre-filled templates for issues', templateCount || 'None')}
        {link('recurring', <IconCycle size={14} />, 'Recurring issues', 'Automatically create issues on a schedule', recurringCount || 'None')}
      </div>
      <div className="settings-h2">Workflow</div>
      <div className="card set-list">
        {link('statuses', <IconStatusRing size={14} />, 'Issue statuses', 'Customize the statuses issues go through', `${states.length} statuses`)}
        {link('workflow', <IconLoop size={14} />, 'Workflows & automations', 'Manage issue automations, git workflows and other workflows', '')}
        {link('triage', <IconTriage size={14} />, 'Triage', 'Streamline how you handle requests from outside your team', team.triageEnabled ? 'Enabled' : 'Off')}
        {link('cycles', <IconCycle size={14} />, 'Cycles', 'Focus your team over short, time-boxed windows', team.autoCycles ? `Every ${team.cycleDuration === 1 ? 'week' : `${team.cycleDuration} weeks`}` : 'Off')}
      </div>
      {canConfigure && <>
      <div className="settings-h2">Danger zone</div>
      <div className="card set-list">
        <div className="set-row notif-row"><div style={{ flex: 1 }}><div className="field-label">Delete team</div><div className="field-help">Permanently delete this team and all its issues</div></div>
          <ConfirmButton className="btn ghost sm" label="Delete…" confirmLabel="Delete team?" onConfirm={async () => { await api.deleteTeam(team.id); await useApp.getState().bootstrap(); toast({ title: `${team.name} deleted` }); navigate('/settings/teams'); }} /></div>
      </div>
      </>}
    </div>
  );
}

function RecurringIssues(props: { teamId: string }) {
  const snap = useApp(s => s.snap)!;
  const list = snap.recurring.filter(r => r.teamId === props.teamId);
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState<keyof typeof CADENCE_LABELS>('weekly');
  const add = async () => {
    if (!title.trim()) return;
    await api.createRecurring({ teamId: props.teamId, title: title.trim(), cadence, startAt: new Date().toISOString() });
    setTitle('');
    await useApp.getState().bootstrap();
  };
  return (
    <div className="card" style={{ padding: '6px 10px' }}>
      <div className="field-help" style={{ padding: '4px 0 8px' }}>Issues that file themselves on a schedule — a weekly dependency bump, a monthly review. Any issue can become one from its menu (Convert to ▸ Recurring issue).</div>
      {list.map(r => (
        <div key={r.id} className="recurring-row group">
          <span className="rr-title">{r.title}</span>
          <select className="text-input" style={{ width: 150, height: 26 }} value={r.cadence} onChange={async e => { await api.updateRecurring(r.id, { cadence: e.target.value }); await useApp.getState().bootstrap(); }}>
            {(Object.keys(CADENCE_LABELS) as Array<keyof typeof CADENCE_LABELS>).map(c => <option key={c} value={c}>{CADENCE_LABELS[c]}</option>)}
          </select>
          <span className="rr-next">next {shortDate(r.nextAt)}</span>
          <button className="icon-btn" title="Stop recurring" onClick={async () => { await api.deleteRecurring(r.id); await useApp.getState().bootstrap(); }}><IconTrash size={13} /></button>
        </div>
      ))}
      <div className="recurring-row">
        <input className="text-input" placeholder="New recurring issue title…" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(); }} />
        <select className="text-input" style={{ width: 150, height: 28 }} value={cadence} onChange={e => setCadence(e.target.value as keyof typeof CADENCE_LABELS)}>
          {(Object.keys(CADENCE_LABELS) as Array<keyof typeof CADENCE_LABELS>).map(c => <option key={c} value={c}>{CADENCE_LABELS[c]}</option>)}
        </select>
        <button className="btn primary" style={{ height: 28 }} disabled={!title.trim()} onClick={add}>Add</button>
      </div>
    </div>
  );
}

/** a settings page that's mostly one switch (Initiatives, Releases) */
function FeatureToggle(props: { title: string; flag: 'initiativesEnabled' | 'releasesEnabled'; help: string; link: [string, string] }) {
  const snap = useApp(s => s.snap)!;
  const on = snap.workspace.features[props.flag];
  return (
    <div className="settings-card">
      <h1>{props.title}</h1>
      <div className="field-row">
        <div><div className="field-label">Enable {props.title.toLowerCase()}</div><div className="field-help">{props.help}</div></div>
        <SettingSwitch on={on} onChange={async v => { await api.setFeatures({ [props.flag]: v }); await useApp.getState().bootstrap(); }} />
      </div>
      {on && <Link className="btn secondary sm" to={props.link[0]}>{props.link[1]}</Link>}
    </div>
  );
}

function SettingSwitch(props: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch${props.on ? ' on' : ''}`} role="switch" aria-checked={props.on} onClick={() => props.onChange(!props.on)}><span /></button>;
}

/* ---------------- account ---------------- */
function PreferencesSettings() {
  const snap = useApp(s => s.snap)!;
  const [customizing, setCustomizing] = useState(false);
  const theme = useApp(s => s.theme);
  const setTheme = useApp(s => s.setTheme);
  const prefs = snap.workspace.preferences;
  const save = async (p: Record<string, unknown>) => { await api.updatePreferences(p); await useApp.getState().bootstrap(); };
  return (
    <div className="settings-card">
      <h1>Preferences</h1>
      <div className="settings-h2">General</div>
      <div className="field-row">
        <div><div className="field-label">Default home view</div><div className="field-help">Where Baseline opens.</div></div>
        <select className="text-input" style={{ width: 180 }} value={prefs.homeView} onChange={e => void save({ homeView: e.target.value })}>
          <option value="inbox">Inbox</option>
          <option value="my-issues">My issues</option>
          <option value="team">Team issues</option>
        </select>
      </div>
      <div className="field-row">
        <div><div className="field-label">First day of the week</div><div className="field-help">Used by date pickers and cycles.</div></div>
        <select className="text-input" style={{ width: 180 }} value={prefs.firstDayOfWeek} onChange={e => void save({ firstDayOfWeek: Number(e.target.value) })}>
          <option value={1}>Monday</option>
          <option value={0}>Sunday</option>
        </select>
      </div>
      <div className="field-row">
        <div><div className="field-label">Display names</div><div className="field-help">How people's names show in lists, activity and the inbox.</div></div>
        <select className="text-input" aria-label="Display names" value={prefs.displayNames} onChange={e => void save({ displayNames: e.target.value })}><option value="full">Full name</option><option value="first">First name</option></select>
      </div>
      <div className="field-row">
        <div><div className="field-label">Convert text emoticons into emojis</div><div className="field-help">Strings like :) will be converted to 🙂</div></div>
        <SettingSwitch on={prefs.convertEmoticons} onChange={v => void save({ convertEmoticons: v })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Send comments on…</div><div className="field-help">Which key press submits a comment.</div></div>
        <select className="text-input" aria-label="Send comments on" value={prefs.sendCommentsOn} onChange={e => void save({ sendCommentsOn: e.target.value })}><option value="enter">Enter</option><option value="mod-enter">⌘ + Enter</option></select>
      </div>
      <div className="settings-h2">Interface and theme</div>
      <div className="field-row">
        <div><div className="field-label">App sidebar</div><div className="field-help">Customize sidebar item visibility and badge style.</div></div>
        <button className="btn ghost sm" onClick={() => setCustomizing(true)}>Customize</button>
      </div>
      <div className="field-row">
        <div><div className="field-label">Font size</div><div className="field-help">Adjust the size of text across the app.</div></div>
        <select className="text-input" aria-label="Font size" value={prefs.fontSize} onChange={e => void save({ fontSize: e.target.value })}><option value="small">Small</option><option value="default">Default</option><option value="large">Large</option></select>
      </div>
      <div className="field-row">
        <div><div className="field-label">Use pointer cursors</div><div className="field-help">Change the cursor to a pointer when hovering over any interactive element.</div></div>
        <SettingSwitch on={prefs.pointerCursors} onChange={v => void save({ pointerCursors: v })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Underline links</div><div className="field-help">Always underline links in text content.</div></div>
        <SettingSwitch on={prefs.underlineLinks} onChange={v => void save({ underlineLinks: v })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Theme</div><div className="field-help">System follows your device appearance; light and dark override it.</div></div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['system', 'light', 'dark'] as const).map(t => (
            <button key={t} className={`seg seg-fill ${theme === t ? 'selected' : ''}`} style={{ textTransform: 'capitalize' }} onClick={() => setTheme(t)}>{t}</button>
          ))}
        </div>
      </div>
      <div className="settings-h2">Automations and workflows</div>
      <div className="field-row">
        <div><div className="field-label">Auto-assign to self</div><div className="field-help">When creating new issues, always assign them to yourself by default.</div></div>
        <SettingSwitch on={prefs.autoAssign} onChange={v => void save({ autoAssign: v })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">On move to started status, assign to yourself</div><div className="field-help">When you move an unassigned issue to started, it will be automatically assigned to you.</div></div>
        <SettingSwitch on={prefs.assignOnStart} onChange={v => void save({ assignOnStart: v })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">On git branch copy, move issue to started status</div><div className="field-help">Copying the branch name (⌘⇧.) moves a backlog or unstarted issue to started and assigns it to you if no one has it. Hold ⌥ while copying to skip this once.</div></div>
        <SettingSwitch on={prefs.startOnBranchCopy} onChange={v => void save({ startOnBranchCopy: v })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">On copy as prompt or hand-off, move issue to started status</div><div className="field-help">The same for Copy as prompt (⌘⌥P) and Open in Claude Code. ⌥-click Copy as prompt to skip this once.</div></div>
        <SettingSwitch on={prefs.startOnHandoff} onChange={v => void save({ startOnHandoff: v })} />
      </div>
      <AnimatePresence>{customizing && <CustomizeSidebar key="cs" onClose={() => setCustomizing(false)} />}</AnimatePresence>
    </div>
  );
}

function ProfileSettings() {
  const snap = useApp(s => s.snap)!;
  const me = snap.currentUser;
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [title, setTitle] = useState(me.title ?? '');
  const [username, setUsername] = useState(me.username ?? '');
  const [github, setGithub] = useState(me.githubUsername ?? '');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const colors = ['#5e6ad2', '#c770f4', '#f2994a', '#4cb782', '#eb5757', '#307ec6', '#26b5ce', '#8a8f98'];
  const save = async (p: Record<string, unknown>) => { await api.updateUser(me.id, p); await useApp.getState().bootstrap(); };
  const upload = async (f: File | null) => { try { await api.uploadAvatar(me.id, f); setErr(''); await useApp.getState().bootstrap(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="settings-card">
      <h1>Profile</h1>
      <div className="field-row">
        <div><div className="field-label">Profile picture</div>{err ? <div className="field-help" style={{ color: 'var(--danger, #e5484d)' }}>{err}</div> : !me.avatarUrl && <div className="field-help">Or your initials on a colour of your choice.</div>}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!me.avatarUrl && <div style={{ display: 'flex', gap: 4 }}>
            {colors.map(c => <button key={c} className="label-dot" title={c} style={{ background: c, width: 16, height: 16, outline: me.color === c ? '2px solid var(--brand)' : 'none', outlineOffset: 2 }} onClick={() => void save({ color: c })} />)}
          </div>}
          {me.avatarUrl && <button className="btn ghost sm" onClick={() => void upload(null)}>Remove</button>}
          <button className="avatar-upload" title="Upload a picture" aria-label="Upload profile picture" onClick={() => fileRef.current?.click()}><Avatar user={me} size={32} /></button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        </div>
      </div>
      <div className="field-row">
        <div><div className="field-label">Email</div><div className="field-help">{snap.workspace.auth === 'google' ? 'Your Google account’s address.' : 'Shown to agents in hand-off prompts.'}</div></div>
        <input className="text-input" value={email} disabled={snap.workspace.auth === 'google'} onChange={e => setEmail(e.target.value)} onBlur={() => email !== me.email && void save({ email })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Full name</div></div>
        <input className="text-input" value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== me.name && void save({ name: name.trim() })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Title</div><div className="field-help">Your job title or role</div></div>
        <input className="text-input" placeholder="Software engineer" value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title !== (me.title ?? '') && void save({ title: title.trim() })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Username</div><div className="field-help">One word, like a nickname or first name</div></div>
        <input className="text-input" aria-label="Username" placeholder={me.name.split(' ')[0].toLowerCase()} value={username} onChange={e => setUsername(e.target.value.replace(/\s+/g, ''))} onBlur={() => username !== (me.username ?? '') && void save({ username })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">GitHub username</div><div className="field-help">Pull requests you open are attributed to you, and an unassigned issue your PR closes is assigned to you.</div></div>
        <input className="text-input" aria-label="GitHub username" placeholder="octocat" spellCheck={false} value={github} onChange={e => setGithub(e.target.value.replace(/\s+/g, ''))} onBlur={() => github !== (me.githubUsername ?? '') && void save({ githubUsername: github.replace(/^@/, '') })} />
      </div>
    </div>
  );
}

function NotificationSettings() {
  const { sub } = useParams();
  const navigate = useNavigate();
  const snap = useApp(s => s.snap)!;
  const push = snap.workspace.preferences.push;
  const [inbox, setInbox] = useState(readInboxPrefs);
  const patchInbox = (p: Parameters<typeof writeInboxPrefs>[0]) => { writeInboxPrefs(p); setInbox(readInboxPrefs()); };
  const priorityCats = inbox.priorityCats ?? DEFAULT_PRIORITY_CATS;
  const savePush = async (p: Partial<typeof push>) => { await api.updatePreferences({ push: { ...push, ...p } }); await useApp.getState().bootstrap(); };
  const [perm, setPerm] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const back = <Link to="/settings/notifications" className="settings-crumb"><IconBack size={13} /> Notifications</Link>;
  const catRows = (on: (c: NotifyCategory) => boolean, set: (c: NotifyCategory, v: boolean) => void, disabled = false) => (
    <div className="card set-list">
      {NOTIFY_CATEGORIES.map(([c, label, help]) => (
        <div key={c} className={`set-row notif-row${disabled ? ' dim' : ''}`}>
          <div style={{ flex: 1 }}><div className="field-label">{label}</div><div className="field-help">{help}</div></div>
          <SettingSwitch on={on(c)} onChange={v => set(c, v)} />
        </div>
      ))}
    </div>
  );
  if (sub === 'priority') return (
    <div className="settings-card">
      {back}
      <h1>Priority notifications</h1>
      <div className="field-help" style={{ marginBottom: 16 }}>With Priority inbox on, these kinds sit above everything else in your inbox.</div>
      {catRows(c => priorityCats.includes(c), (c, v) => patchInbox({ priorityCats: v ? [...priorityCats, c] : priorityCats.filter(x => x !== c) }))}
    </div>
  );
  if (sub === 'desktop') return (
    <div className="settings-card">
      {back}
      <h1>Desktop</h1>
      <div className="field-help" style={{ marginBottom: 16 }}>Notifications from this browser while Baseline is open in a tab, even in the background</div>
      <div className="card set-list">
        <div className="set-row notif-row">
          <div style={{ flex: 1 }}><div className="field-label">Enable desktop notifications</div><div className="field-help">{perm === 'unsupported' ? 'This browser doesn’t support notifications.' : perm === 'denied' ? 'Notifications are blocked for this site — allow them in your browser’s site settings.' : perm === 'granted' ? 'Allowed in this browser.' : 'Your browser will ask for permission.'}</div></div>
          <SettingSwitch on={push.desktop && perm === 'granted'} onChange={async v => {
            if (v && perm !== 'granted' && typeof Notification !== 'undefined') { const r = await Notification.requestPermission(); setPerm(r); if (r !== 'granted') return; }
            await savePush({ desktop: v });
          }} />
        </div>
      </div>
      <div className="settings-h2">General notifications</div>
      {catRows(c => push.types[c], (c, v) => void savePush({ types: { ...push.types, [c]: v } }), !push.desktop)}
    </div>
  );
  const enabledCount = Object.values(push.types).filter(Boolean).length;
  return (
    <div className="settings-card">
      <h1>Notifications</h1>
      <div className="settings-h2">Inbox</div>
      <div className="field-help" style={{ marginBottom: 8 }}>Manage how notifications are organized in your inbox</div>
      <div className="card set-list">
        <div className="set-row notif-row">
          <div style={{ flex: 1 }}><div className="field-label">Priority inbox</div><div className="field-help">Separate important notifications from the rest of your inbox</div></div>
          <SettingSwitch on={!!inbox.priority} onChange={v => patchInbox({ priority: v })} />
        </div>
        <button className={`set-row notif-row notif-link${inbox.priority ? '' : ' dim'}`} onClick={() => navigate('/settings/notifications/priority')}>
          <div style={{ flex: 1, textAlign: 'left' }}><div className="field-label">Priority notifications</div><div className="field-help">Choose which notifications are treated as priority</div></div>
          <span className="set-meta">{priorityCats.length} types</span><IconChevronRight size={12} />
        </button>
      </div>
      <div className="settings-h2">Push notifications</div>
      <div className="field-help" style={{ marginBottom: 8 }}>Choose which notifications are pushed to your devices. All notifications will still appear in your inbox.</div>
      <div className="card set-list">
        <button className="set-row notif-row notif-link" onClick={() => navigate('/settings/notifications/desktop')}>
          <span className="notif-icon"><IconPanel size={14} /></span>
          <div style={{ flex: 1, textAlign: 'left' }}><div className="field-label">Desktop</div><div className="field-help"><span className={`notif-dot${push.desktop && perm === 'granted' ? ' on' : ''}`} />{push.desktop && perm === 'granted' ? (enabledCount === NOTIFY_CATEGORIES.length ? 'Enabled for all notifications' : `Enabled for ${enabledCount} types`) : 'Disabled'}</div></div>
          <IconChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

function TeamEditor(props: { teamId: string; part?: 'states' | 'cycles' }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const moreMenu = useMenu();
  const team = snap.teams.find(t => t.id === props.teamId)!;
  const states = snap.states.filter(s => s.teamId === team.id).sort((a, b) => a.position - b.position);
  const cycles = snap.cycles.filter(c => c.teamId === team.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const [addingState, setAddingState] = useState(false);
  const [stName, setStName] = useState('');
  const [stType, setStType] = useState<WorkflowStateType>('unstarted');
  const [stColor, setStColor] = useState(STATE_COLORS[1]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(team.name);
  const [addingCycle, setAddingCycle] = useState(false);

  const patchTeam = async (patch: Record<string, unknown>) => {
    await api.updateTeam(team.id, patch);
    await useApp.getState().bootstrap();
  };
  const addState = async () => {
    if (!stName.trim()) return;
    await api.createState({ teamId: team.id, name: stName.trim(), type: stType, color: stColor });
    setStName(''); setAddingState(false);
    await useApp.getState().bootstrap();
  };
  const moveState = async (stateId: string, dir: -1 | 1) => {
    const idx = states.findIndex(s => s.id === stateId);
    const other = states[idx + dir];
    if (!other) return;
    await api.updateState(stateId, { position: other.position });
    await api.updateState(other.id, { position: states[idx].position });
    await useApp.getState().bootstrap();
  };

  const nextCycleNumber = cycles.length ? Math.max(...cycles.map(c => c.number)) + 1 : 1;

  return (
    <div style={{ marginBottom: 28 }}>
      {!props.part && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="ws-avatar" style={{ background: team.color, borderRadius: 4 }}>{team.key.slice(0, 2)}</span>
        {editingName ? (
          <input className="text-input" style={{ height: 26, width: 180 }} autoFocus value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={async () => { await patchTeam({ name: nameDraft || team.name }); setEditingName(false); }}
            onKeyDown={async e => { if (e.key === 'Enter') { await patchTeam({ name: nameDraft || team.name }); setEditingName(false); } }} />
        ) : (
          <b style={{ cursor: 'text' }} onClick={() => { setNameDraft(team.name); setEditingName(true); }}>{team.name}</b>
        )}
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{team.key}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="More team actions" onClick={moreMenu.open}><IconClose size={0} /><span style={{ fontSize: 13 }}>…</span></button>
      </div>}
      {moreMenu.anchor && (
        <Menu anchor={moreMenu.anchor} onClose={moreMenu.close}>
          <div className="menu-header"><span>{team.key}</span></div>
          <MenuItem label="Cycle key" onClick={() => {
            const k = prompt('Team key', team.key);
            if (k && k.trim()) void patchTeam({ key: k.trim().toUpperCase() });
          }} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete team (deletes its issues)"
            onClick={async () => {
              await api.deleteTeam(team.id);
              await useApp.getState().bootstrap();
              toast({ title: `${team.name} deleted` });
            }} />
        </Menu>
      )}

      {props.part !== 'cycles' && <div className="card" style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Workflow states</span>
          <span style={{ flex: 1 }} />
          <button className="prop-chip" style={{ color: 'var(--text-dim)', height: 22, fontSize: 11.5 }} onClick={() => setAddingState(a => !a)}>＋ Add state</button>
        </div>
        {addingState && (
          <div style={{ display: 'flex', gap: 6, padding: '4px 0', alignItems: 'center' }}>
            <span className="label-dot" style={{ background: stColor }} />
            <input className="text-input" style={{ height: 26 }} autoFocus placeholder="State name" value={stName}
              onChange={e => setStName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addState(); if (e.key === 'Escape') setAddingState(false); }} />
            <select className="text-input" style={{ height: 26, width: 110 }} value={stType} onChange={e => setStType(e.target.value as WorkflowStateType)}>
              {STATE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 3 }}>
              {STATE_COLORS.map(c => (
                <button key={c} className={`label-dot ${stColor === c ? 'sel' : ''}`} style={{ background: c, width: 14, height: 14, cursor: 'pointer', outline: stColor === c ? '2px solid var(--brand)' : 'none' }} onClick={() => setStColor(c)} />
              ))}
            </div>
            <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={addState}>Add</button>
          </div>
        )}
        {states.map((s, i) => (
          <StateRow key={s.id} stateId={s.id} onMove={dir => moveState(s.id, dir)} canUp={i > 0} canDown={i < states.length - 1} />
        ))}
      </div>}

      {props.part !== 'states' && <div className="card" style={{ padding: '8px 10px', marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cycles</span>
          <span style={{ flex: 1 }} />
          <button className="prop-chip" style={{ color: 'var(--text-dim)', height: 22, fontSize: 11.5 }} onClick={() => setAddingCycle(true)}>＋ Add cycle</button>
        </div>
        <AnimatePresence>{addingCycle && <NewCycleModal key="cy" teamId={team.id} number={nextCycleNumber} onClose={() => setAddingCycle(false)} />}</AnimatePresence>
        {cycles.map(c => (
          <div key={c.id} className="prop-row group">
            <span style={{ color: 'var(--text-secondary)', fontSize: 12, width: 16 }}>#{c.number}</span>
            <span style={{ flex: 1 }}>{c.name}</span>
            <span className="cy-dates">{shortDate(c.startsAt)} – {shortDate(c.endsAt)}</span>
            <button className="icon-btn hover-only" title="Delete cycle" onClick={async () => { await api.deleteCycle(c.id); await useApp.getState().bootstrap(); }}>
              <IconTrash size={13} />
            </button>
          </div>
        ))}
        {cycles.length === 0 && !addingCycle && <div style={{ color: 'var(--text-dim)', padding: '4px 0', fontSize: 12 }}>No cycles yet.</div>}
      </div>}
    </div>
  );
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/* Linear-style create-cycle modal: big name field + calendar pill pickers */
export function NewCycleModal(props: { teamId: string; number: number; onClose: () => void }) {
  const toast = useApp(s => s.toast);
  const { busy, guard } = useInFlight();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const startMenu = useMenu();
  const endMenu = useMenu();

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const valid = !!start && !!end && end >= start;
  const create = guard(async () => {
    if (!valid) return;
    await api.createCycle({
      teamId: props.teamId, number: props.number,
      name: name.trim() || `Cycle ${props.number}`,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end + 'T23:59:59').toISOString(),
    });
    await useApp.getState().bootstrap();
    props.onClose();
    toast({ title: 'Cycle created', line: `${name.trim() || `Cycle ${props.number}`} · ${dateLabel(start)} → ${dateLabel(end)}` });
  });

  // ⌘/Ctrl+Enter creates from anywhere in the modal (menus portal outside this
  // wrapper, but their React events still bubble here — so exclude them)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('.menu')) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void create();
    } else if (e.key === 'Enter' && !e.shiftKey && e.target === nameRef.current) {
      e.preventDefault();
      void create();
    }
  };

  return (
    <Modal onClose={props.onClose} className="modal modal-create cy-modal">
      <div className="cm-root" onKeyDown={onKeyDown}>
        <div className="cm-header">
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>New cycle</span>
          <span style={{ marginLeft: 'auto', display: 'flex' }}>
            <button className="icon-btn" onClick={props.onClose}><IconClose size={14} /></button>
          </span>
        </div>

        <div className="np-head">
          <input ref={nameRef} className="np-name" placeholder={`Cycle ${props.number} name`} value={name} spellCheck={false}
            onChange={e => setName(e.target.value)} />
        </div>

        <div className="cm-pills">
          <button className="prop-chip" onClick={startMenu.open}>
            <IconCalendar size={13} style={{ color: 'var(--text-dim)' }} />
            {start ? dateLabel(start) : 'Start date'}
          </button>
          <button className="prop-chip" onClick={endMenu.open}>
            <IconCalendar size={13} style={{ color: 'var(--text-dim)' }} />
            {end ? dateLabel(end) : 'End date'}
          </button>
        </div>

        <div className="cm-footer">
          {start && end && end < start ? (
            <span style={{ color: '#eb5757', fontSize: 12 }}>End date must be on or after the start date.</span>
          ) : (
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{start && !end ? 'End date defaults to a two-week cycle.' : undefined}</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn" onClick={props.onClose}>Cancel</button>
            <button className="btn primary" style={{ whiteSpace: 'nowrap' }} onClick={() => void create()} disabled={!valid || busy}>
              Create cycle
              <span className="btn-kbd kbd">⌘↵</span>
            </button>
          </div>
        </div>
      </div>

      {startMenu.anchor && (
        <Menu anchor={startMenu.anchor} onClose={startMenu.close} width={250}>
          <div className="menu-header"><span>Start date</span></div>
          <CalendarGrid selected={start || undefined} onPick={iso => { setStart(iso); if (!end) setEnd(addDaysIso(iso, 13)); startMenu.close(); }} />
        </Menu>
      )}
      {endMenu.anchor && (
        <Menu anchor={endMenu.anchor} onClose={endMenu.close} width={250}>
          <div className="menu-header"><span>End date</span></div>
          <CalendarGrid selected={end || undefined} onPick={iso => { setEnd(iso); endMenu.close(); }} />
        </Menu>
      )}
    </Modal>
  );
}

function StateRow(props: { stateId: string; onMove: (dir: -1 | 1) => void; canUp: boolean; canDown: boolean }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const menu = useMenu();
  const st = snap.states.find(s => s.id === props.stateId)!;
  const issueCount = snap.issues.filter(i => i.stateId === st.id).length;
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(st.name);

  const patch = async (p: Record<string, unknown>) => {
    await api.updateState(st.id, p);
    await useApp.getState().bootstrap();
  };

  return (
    <div className="prop-row group">
      <button title="Change color" onClick={menu.open}>
        <StateIcon type={st.type} color={st.color} size={14} />
      </button>
      {editing ? (
        <input className="text-input" style={{ height: 24, width: 140 }} autoFocus value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          onBlur={async () => { await patch({ name: nameDraft || st.name }); setEditing(false); }}
          onKeyDown={async e => { if (e.key === 'Enter') { await patch({ name: nameDraft || st.name }); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
      ) : (
        <span style={{ flex: 1, cursor: 'text' }} onClick={() => { setNameDraft(st.name); setEditing(true); }}>{st.name}</span>
      )}
      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{issueCount || ''}</span>
      <button className="prop-chip boxed" style={{ height: 20, fontSize: 10.5, textTransform: 'capitalize' }} onClick={menu.open}>{st.type}</button>
      <span style={{ display: 'flex' }} className="hover-only">
        <button className="icon-btn" style={{ width: 20, height: 20 }} disabled={!props.canUp} onClick={() => props.onMove(-1)} title="Move up">↑</button>
        <button className="icon-btn" style={{ width: 20, height: 20 }} disabled={!props.canDown} onClick={() => props.onMove(1)} title="Move down">↓</button>
      </span>
      <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Delete state"
        onClick={async () => {
          try {
            const { movedTo } = await api.deleteState(st.id);
            await useApp.getState().bootstrap();
            const movedName = movedTo ? useApp.getState().snap?.states.find(s => s.id === movedTo)?.name : undefined;
            toast({ title: `State “${st.name}” deleted`, line: issueCount ? `Its ${issueCount} issues moved to ${movedName ?? 'another state'}.` : undefined });
          } catch (e) {
            toast({ title: `Can’t delete “${st.name}”`, line: e instanceof Error ? e.message : String(e) });
          }
        }}>
        <IconTrash size={13} />
      </button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={210}>
          <div className="menu-header"><span>State type</span></div>
          {STATE_TYPES.map(([v, l]) => (
            <MenuItem key={v} icon={<StateIcon type={v} color={st.color} size={13} />} label={l} selected={st.type === v} onClick={() => { void patch({ type: v }); menu.close(); }} />
          ))}
          <MenuSep />
          <div className="menu-header"><span>Color</span></div>
          <div style={{ display: 'flex', gap: 5, padding: '2px 10px 10px', flexWrap: 'wrap' }}>
            {STATE_COLORS.map(c => (
              <button key={c} className={`label-dot ${st.color === c ? 'sel' : ''}`} style={{ background: c, width: 16, height: 16, outline: st.color === c ? '2px solid var(--brand)' : 'none' }}
                onClick={() => { void patch({ color: c }); menu.close(); }} />
            ))}
          </div>
        </Menu>
      )}
    </div>
  );
}

/* ---------------- members ---------------- */
function MembersSettings() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const [name, setName] = useState('');
  const [asAgent, setAsAgent] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    await api.createUser({ name: name.trim(), kind: asAgent ? 'agent' : 'human' });
    setName('');
    await useApp.getState().bootstrap();
    toast({ title: asAgent ? 'Agent identity added' : 'Member added' });
  };
  return (
    <div className="settings-card">
      <h1>Members</h1>
      <div className="card" style={{ padding: '4px 10px', marginBottom: 14 }}>
        {snap.users.map(u => (
          <div key={u.id} className="prop-row">
            <Avatar user={u} size={22} />
            <span style={{ flex: 1 }}>{u.name}{u.id === snap.currentUser.id ? <span style={{ color: 'var(--text-dim)' }}> (you)</span> : null}</span>
            {u.kind === 'agent' && <span className="kbd" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconAgent size={11} /> Agent</span>}
            {u.admin && <span className="kbd">Admin</span>}
            {u.kind === 'human' && <GithubLoginInput userId={u.id} value={u.githubUsername ?? ''} />}
            {u.id !== snap.currentUser.id && (
              <button className="btn" style={{ height: 24, fontSize: 12 }} onClick={async () => {
                await api.updateWorkspace({ currentUserId: u.id });
                await useApp.getState().bootstrap();
                toast({ title: `Switched current user to ${u.name}` });
              }}>Set as me</button>
            )}
          </div>
        ))}
      </div>
      <div className="field-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div>
          <div className="field-label">Add member</div>
          <div className="field-help">Agents (Claude, Codex, OpenCode…) can be assigned issues; their CLI writes land under their name when passed <code>--as "Name"</code>.</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="text-input" placeholder={asAgent ? 'Agent name' : 'Full name'} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()} />
          <div style={{ display: 'flex', gap: 4 }}>
            {(['human', 'agent'] as const).map(k => (
              <button key={k} className={`seg seg-fill ${asAgent === (k === 'agent') ? 'selected' : ''}`} style={{ textTransform: 'capitalize' }} onClick={() => setAsAgent(k === 'agent')}>{k}</button>
            ))}
          </div>
          <button className="btn primary" onClick={create}>Add</button>
        </div>
      </div>
    </div>
  );
}

/** a member's GitHub login: their pull requests are attributed to them and assign them */
function GithubLoginInput(props: { userId: string; value: string }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => { setDraft(props.value); }, [props.value]);
  return (
    <input className="text-input" style={{ width: 130, height: 24, fontSize: 12 }} aria-label="GitHub username" title="GitHub username — links their pull requests to them" placeholder="GitHub username" spellCheck={false}
      value={draft} onChange={e => setDraft(e.target.value.replace(/\s+/g, ''))}
      onBlur={async () => { if (draft !== props.value) { await api.updateUser(props.userId, { githubUsername: draft.replace(/^@/, '') }); await useApp.getState().bootstrap(); } }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

/* ---------------- labels CRUD ---------------- */
function LabelsSettings(props: { onlyTeamId?: string } = {}) {
  const snap = useApp(s => s.snap)!;
  const teams = props.onlyTeamId ? snap.teams.filter(t => t.id === props.onlyTeamId) : snap.teams;
  const toast = useApp(s => s.toast);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [teamId, setTeamId] = useState(props.onlyTeamId ?? snap.teams[0]?.id ?? '');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#8a8f98');
  const create = async () => {
    if (!name.trim() || !teamId) return;
    await api.createLabel({ teamId, name: name.trim(), color });
    setName('');
    await useApp.getState().bootstrap();
  };
  return (
    <div className="settings-card">
      <h1>Labels</h1>
      {teams.map(t => (
        <div key={t.id} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{t.name}</div>
          <div className="card" style={{ padding: '6px 10px' }}>
            {snap.labels.filter(l => l.teamId === t.id).map(l => (
              <div key={l.id} className="prop-row group">
                {editing === l.id ? (
                  <>
                    <span className="label-dot" style={{ background: editColor }} />
                    <input className="text-input" style={{ height: 24, width: 140 }} autoFocus value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onBlur={async () => { await api.updateLabel(l.id, { name: editName || l.name, color: editColor }); await useApp.getState().bootstrap(); setEditing(null); }}
                      onKeyDown={async e => {
                        if (e.key === 'Enter') { await api.updateLabel(l.id, { name: editName || l.name, color: editColor }); await useApp.getState().bootstrap(); setEditing(null); }
                        if (e.key === 'Escape') setEditing(null);
                      }} />
                    <div style={{ display: 'flex', gap: 3 }}>
                      {LABEL_COLORS.map(c => (
                        <button key={c} className="label-dot" style={{ background: c, width: 14, height: 14, outline: editColor === c ? '2px solid var(--brand)' : 'none' }} onClick={() => setEditColor(c)} />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <button className="label-dot" style={{ background: l.color }} title="Click to edit" onClick={() => { setEditing(l.id); setEditName(l.name); setEditColor(l.color); }} />
                    <span style={{ flex: 1 }}>{l.name}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                      {snap.issues.filter(i => i.labelIds.includes(l.id)).length || ''}
                    </span>
                    <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Edit label" onClick={() => { setEditing(l.id); setEditName(l.name); setEditColor(l.color); }}>
                      <IconPlus size={0} /><span style={{ fontSize: 11 }}>✎</span>
                    </button>
                    <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Delete label"
                      onClick={async () => {
                        await api.deleteLabel(l.id);
                        await useApp.getState().bootstrap();
                        toast({ title: `Label “${l.name}” deleted` });
                      }}>
                      <IconTrash size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
            {snap.labels.filter(l => l.teamId === t.id).length === 0 && <div style={{ color: 'var(--text-dim)', padding: '4px 0' }}>No labels</div>}
          </div>
        </div>
      ))}
      <div className="field-row stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div><div className="field-label">Create label</div></div>
        <div className="label-form">
          <select className="text-input" value={teamId} onChange={e => setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 3 }}>
            {LABEL_COLORS.map(c => (
              <button key={c} className="label-dot" style={{ background: c, width: 14, height: 14, outline: color === c ? '2px solid var(--brand)' : 'none' }} onClick={() => setColor(c)} />
            ))}
          </div>
          <input className="text-input" placeholder="Label name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
          <button className="btn primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- handoff (prompt template for coding agents) ---------------- */
function HandoffSettings() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const saved = snap.workspace.handoffPromptTemplate || DEFAULT_PROMPT_TEMPLATE;
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;

  const save = async () => {
    await api.updateWorkspace({ handoffPromptTemplate: draft });
    await useApp.getState().bootstrap();
    toast({ title: 'Handoff template saved' });
  };
  const reset = async () => {
    await api.updateWorkspace({ handoffPromptTemplate: null });
    await useApp.getState().bootstrap();
    setDraft(DEFAULT_PROMPT_TEMPLATE);
    toast({ title: 'Template reset to default' });
  };

  // live preview against a real issue so you see exactly what gets pasted
  const sample = snap.issues[0];
  const preview = sample
    ? buildHandoff(sample, { teams: snap.teams, states: snap.states, projects: snap.projects, labels: snap.labels }, draft || DEFAULT_PROMPT_TEMPLATE)
    : null;

  return (
    <div className="settings-card">
      <h1>Coding tools</h1>
      <div className="field-help" style={{ marginBottom: 16 }}>
        Hand an issue to Claude Code from its toolbar: <b>Copy as prompt</b> puts the brief on your clipboard, and <b>Open in Claude Code</b> starts
        an interactive session in a terminal window, in the issue's location. Every issue works in exactly one location; nothing runs without one.
      </div>
      <LocationsSettings />
      {/* the terminal Claude Code opens in is this machine's — hosted, that's the companion's to know */}
      {snap.workspace.auth !== 'google' && <ClaudeCodeSettings />}
      <h2 className="settings-h2">Prompt template</h2>
      <div className="field-help" style={{ marginBottom: 10 }}>
        The same brief is used by the toolbar, <code>baseline issue handoff</code>, the palette and both Claude Code launchers.
      </div>
      <textarea
        className="text-input"
        style={{ width: '100%', minHeight: 190, fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, lineHeight: 1.55, resize: 'vertical' }}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        spellCheck={false}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
        <button className="btn primary" disabled={!dirty} onClick={save}>Save template</button>
        <button className="btn" onClick={reset}>Reset to default</button>
        {dirty && <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Unsaved changes</span>}
      </div>
      <div className="field-row" style={{ borderTop: '1px solid var(--border)', marginTop: 18, paddingTop: 14, display: 'block' }}>
        <div className="field-label" style={{ marginBottom: 8 }}>Variables</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PROMPT_TEMPLATE_VARS.map(([v, d]) => (
            <span key={v} className="kbd" title={d} style={{ fontWeight: 400 }}>{v}</span>
          ))}
        </div>
      </div>
      {preview && (
        <div className="field-row" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 14, display: 'block' }}>
          <div className="field-label" style={{ marginBottom: 8 }}>Preview — {preview.key}</div>
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg-secondary, #141414)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{preview.prompt}</pre>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 6 }}>branch: <code>{preview.branchName}</code></div>
        </div>
      )}
    </div>
  );
}

/* where "Open in Claude Code" launches, and the directory it falls back to */
function ClaudeCodeSettings() {
  const ws = useApp(s => s.snap)!.workspace;
  const toast = useApp(s => s.toast);
  // null until the server says which terminals this Mac has; none found (off macOS) lists them all
  const [installed, setInstalled] = useState<TerminalApp[] | null>(null);
  useEffect(() => { void api.installedTerminals().then(r => setInstalled(r.installed)).catch(() => setInstalled([])); }, []);
  const choices = !installed?.length ? [...TERMINAL_APPS] : installed.includes(ws.terminalApp) ? installed : [ws.terminalApp, ...installed];
  const save = async (terminalApp: TerminalApp) => {
    await api.updateWorkspace({ terminalApp });
    await useApp.getState().bootstrap();
    toast({ title: `Sessions open in ${terminalApp}` });
  };
  return (
    <div className="card settings-block">
      <div className="field-row">
        <div><div className="field-label">Open sessions in</div><div className="field-help">The macOS terminal app that runs interactive <code>claude</code> sessions.</div></div>
        <select className="text-input" style={{ width: 170 }} value={ws.terminalApp} onChange={e => void save(e.target.value as TerminalApp)}>
          {choices.map(t => <option key={t} value={t}>{t}{installed?.length && !installed.includes(t) ? ' (not installed)' : ''}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ---------------- issue templates ---------------- */
function TemplatesSettings(props: { onlyTeamId?: string } = {}) {
  const snap = useApp(s => s.snap)!;
  const teams = props.onlyTeamId ? snap.teams.filter(t => t.id === props.onlyTeamId) : snap.teams;
  const toast = useApp(s => s.toast);
  const [teamId, setTeamId] = useState(props.onlyTeamId ?? snap.teams[0]?.id ?? '');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', title: '', description: '' });

  const create = async () => {
    if (!name.trim() || !teamId) return;
    await api.createTemplate({ teamId, name: name.trim() });
    setName('');
    await useApp.getState().bootstrap();
  };
  const startEdit = (id: string, name: string, title: string, description: string) => {
    setEditing(id);
    setDraft({ name, title, description });
  };
  const saveEdit = async (id: string) => {
    await api.updateTemplate(id, draft);
    setEditing(null);
    await useApp.getState().bootstrap();
    toast({ title: 'Template saved' });
  };

  return (
    <div className="settings-card">
      <h1>Templates</h1>
      <div className="field-help" style={{ marginBottom: 12 }}>
        Starter text for new issues. Templates are offered in the create modal and make hand-off prompts consistently rich.
      </div>
      {teams.map(t => {
        const tpls = snap.templates.filter(x => x.teamId === t.id);
        return (
          <div key={t.id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{t.name}</div>
            <div className="card" style={{ padding: '6px 10px' }}>
              {tpls.map(tpl => (
                <div key={tpl.id} className={'prop-row group' + (editing === tpl.id ? ' editing' : '')} style={{ alignItems: 'flex-start' }}>
                  {editing === tpl.id ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="text-input" style={{ height: 26, width: 160 }} value={draft.name} placeholder="Template name" onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                        <input className="text-input" style={{ height: 26, flex: 1 }} value={draft.title} placeholder="Title template (optional)" onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
                      </div>
                      <textarea className="text-input" style={{ minHeight: 90, fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }} value={draft.description} placeholder="Description body (markdown)…" onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={() => saveEdit(tpl.id)}>Save</button>
                        <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span style={{ flex: 1 }}>
                        {tpl.name}
                        {tpl.description && <span style={{ color: 'var(--text-dim)', fontSize: 12 }}> — {tpl.description.slice(0, 60).replace(/\n/g, ' ')}{tpl.description.length > 60 ? '…' : ''}</span>}
                      </span>
                      <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Edit template" onClick={() => startEdit(tpl.id, tpl.name, tpl.title, tpl.description)}>
                        <span style={{ fontSize: 11 }}>✎</span>
                      </button>
                      <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Delete template"
                        onClick={async () => { await api.deleteTemplate(tpl.id); await useApp.getState().bootstrap(); toast({ title: `Template “${tpl.name}” deleted` }); }}>
                        <IconTrash size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {tpls.length === 0 && <div style={{ color: 'var(--text-dim)', padding: '4px 0', fontSize: 12 }}>No templates yet.</div>}
            </div>
          </div>
        );
      })}
      <div className="field-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div><div className="field-label">Create template</div><div className="field-help">Add the body from the template’s edit view after creating.</div></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="text-input" value={teamId} onChange={e => setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input className="text-input" placeholder="Template name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
          <button className="btn primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}

/* project templates: the fields a new project starts with, plus the milestones and issues created with it */
function ProjectTemplatesSection() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', icon: '', summary: '', description: '', milestones: '', issues: '' });
  const create = async () => {
    if (!name.trim()) return;
    const { template } = await api.createProjectTemplate({ name: name.trim() });
    setName('');
    await useApp.getState().bootstrap();
    const t = useApp.getState().snap!.projectTemplates.find(x => x.id === template.id);
    if (t) edit(t);
  };
  const edit = (t: (typeof snap.projectTemplates)[number]) => {
    setEditing(t.id);
    setDraft({ name: t.name, icon: t.icon, summary: t.summary, description: t.description, milestones: t.milestones.join('\n'), issues: t.issues.join('\n') });
  };
  const save = async (id: string) => {
    const lines = (v: string) => v.split('\n').map(x => x.trim()).filter(Boolean);
    await api.updateProjectTemplate(id, { name: draft.name, icon: draft.icon || '🧊', summary: draft.summary, description: draft.description, milestones: lines(draft.milestones), issues: lines(draft.issues) });
    setEditing(null);
    await useApp.getState().bootstrap();
    useApp.getState().toast({ title: 'Project template saved' });
  };
  return (
    <>
      <div className="field-help" style={{ marginBottom: 8 }}>Offered in New project. A template fills the project's fields and creates its milestones and starter issues.</div>
      <div className="card" style={{ padding: '6px 10px' }}>
        {snap.projectTemplates.map(t => editing === t.id ? (
          <div key={t.id} className="ptpl-edit">
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="text-input" style={{ width: 44, textAlign: 'center' }} value={draft.icon} onChange={e => setDraft(d => ({ ...d, icon: e.target.value }))} />
              <input className="text-input" style={{ flex: 1 }} placeholder="Template name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            </div>
            <input className="text-input" placeholder="Summary" value={draft.summary} onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))} />
            <textarea className="text-input" placeholder="Description (markdown)" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
            <div style={{ display: 'flex', gap: 6 }}>
              <textarea className="text-input" style={{ flex: 1 }} placeholder="Milestones — one per line" value={draft.milestones} onChange={e => setDraft(d => ({ ...d, milestones: e.target.value }))} />
              <textarea className="text-input" style={{ flex: 1 }} placeholder="Starter issues — one title per line" value={draft.issues} onChange={e => setDraft(d => ({ ...d, issues: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={() => save(t.id)}>Save</button>
              <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={t.id} className="prop-row group">
            <span>{t.icon}</span>
            <span style={{ flex: 1 }}>{t.name}<span style={{ color: 'var(--text-dim)', fontSize: 12 }}> — {t.milestones.length} milestone{t.milestones.length === 1 ? '' : 's'}, {t.issues.length} issue{t.issues.length === 1 ? '' : 's'}</span></span>
            <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Edit template" onClick={() => edit(t)}><span style={{ fontSize: 11 }}>✎</span></button>
            <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Delete template" onClick={async () => { await api.deleteProjectTemplate(t.id); await useApp.getState().bootstrap(); }}><IconTrash size={13} /></button>
          </div>
        ))}
        {snap.projectTemplates.length === 0 && <div style={{ color: 'var(--text-dim)', padding: '4px 0', fontSize: 12 }}>No project templates yet.</div>}
        <div className="recurring-row">
          <input className="text-input" placeholder="New project template name…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
          <button className="btn primary" style={{ height: 28 }} disabled={!name.trim()} onClick={create}>Create</button>
        </div>
      </div>
    </>
  );
}

function DataSettings() {
  const toast = useApp(s => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const importFile = async (file: File) => {
    const json = await file.text();
    try {
      await api.importWorkspace(json);
      await useApp.getState().bootstrap();
      toast({ title: 'Workspace imported' });
    } catch (err) {
      toast({ title: 'Import failed', line: String(err) });
    }
  };
  return (
    <div className="settings-card">
      <h1>Import & export</h1>
      <div className="field-row">
        <div><div className="field-label">Export workspace</div><div className="field-help">Download the full workspace as JSON, images included.</div></div>
        <a className="btn" href="/api/export" download>Export JSON</a>
      </div>
      <div className="field-row">
        <div><div className="field-label">Import workspace</div><div className="field-help">Restore from an exported JSON file. Replaces all current data.</div></div>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Reset sample workspace</div><div className="field-help">Wipes everything and reseeds the demo data.</div></div>
        <ConfirmButton label="Reset" confirmLabel="Wipe all data?" onConfirm={async () => { await api.reseed(); await useApp.getState().bootstrap(); toast({ title: 'Workspace reset' }); }} />
      </div>
    </div>
  );
}

function ShortcutSettings() {
  return (
    <div className="settings-card">
      <h1>Keyboard shortcuts</h1>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Press <span className="kbd">?</span> anywhere in the app to open this list.</div>
      <ShortcutList />
    </div>
  );
}

/* keep imports referenced */
export { Menu, MenuItem, useMenu, PriorityIcon, IconPlus, IconBack, IconClose };
export type { WorkflowStateType, Priority };
