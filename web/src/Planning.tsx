import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useApp, shortDate, relTime } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, Modal, useMenu, RegisterMark } from './ui.js';
import { Avatar, CalendarGrid, StateIcon } from './pickers.js';
import { RichEditor, isBlank } from './RichEditor.js';
import { Markdown } from './Markdown.js';
import { LogoMark } from './Logo.js';
import { ProjectStatusIcon, projectProgress, namedStatus } from './Projects.js';
import { useViewPrefs, DEFAULT_VIEW_OPTIONS, type ViewOptions } from './IssueViews.js';
import { IssueListBody, ListToolbar } from './Views.js';
import { IconPlus, IconClose, IconTrash, IconCalendar, IconUser, IconInitiative, IconRelease, IconCheck, IconFilter, IconDisplay } from './icons.js';
import type { Initiative, InitiativeStatus, ProjectHealth, ReleaseStage } from '../../src/core/types.js';

type Snap = NonNullable<ReturnType<typeof useApp.getState>['snap']>;
const refresh = () => useApp.getState().bootstrap();
export const INITIATIVE_STATUS: Array<[InitiativeStatus, string, string]> = [['planned', 'Planned', '#8a8f98'], ['active', 'Active', '#f2c94c'], ['completed', 'Completed', '#5e6ad2']];
const HEALTH: Array<[ProjectHealth, string, string]> = [['onTrack', 'On track', '#4cb782'], ['atRisk', 'At risk', '#f2994a'], ['offTrack', 'Off track', '#eb5757']];
export const RELEASE_STAGE: Array<[ReleaseStage, string, string]> = [['planned', 'Planned', '#8a8f98'], ['started', 'In progress', '#f2c94c'], ['released', 'Released', '#5e6ad2'], ['canceled', 'Canceled', '#95a2b3']];

function InitiativeStatusIcon({ status, size = 14 }: { status: InitiativeStatus; size?: number }) {
  const c = INITIATIVE_STATUS.find(x => x[0] === status)?.[2];
  return <span style={{ display: 'inline-flex', color: c }}><StateIcon type={status === 'planned' ? 'unstarted' : status === 'active' ? 'started' : 'completed'} color={c} size={size} /></span>;
}
export function ReleaseStageIcon({ stage, size = 14 }: { stage: ReleaseStage; size?: number }) {
  const c = RELEASE_STAGE.find(x => x[0] === stage)?.[2];
  return <span style={{ display: 'inline-flex', color: c }}><StateIcon type={stage === 'planned' ? 'unstarted' : stage === 'started' ? 'started' : stage === 'released' ? 'completed' : 'canceled'} color={c} size={size} /></span>;
}

/** an initiative's progress: issues done across its projects (and its sub-initiatives' projects) */
export function initiativeProgress(snap: Snap, ini: Initiative): { pct: number; total: number; projects: number } {
  const ids = new Set(ini.projectIds);
  for (const child of snap.initiatives.filter(i => i.parentId === ini.id)) child.projectIds.forEach(p => ids.add(p));
  let done = 0; let total = 0;
  for (const p of ids) { const pr = projectProgress(snap, p); done += pr.done; total += pr.total; }
  return { pct: total ? Math.round((done / total) * 100) : 0, total, projects: ids.size };
}

/* ================= Initiatives list ================= */
export function InitiativesPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const { tab = 'active' } = useParams();
  const location = useLocation();
  // N then I lands here with the create dialog open
  const [creating, setCreating] = useState(() => !!(location.state as { create?: boolean } | null)?.create);
  // filter and display, as on Linear's initiatives list (kept in this browser)
  const [prefs, setPrefs] = useState<{ health: string[]; owners: string[]; order: 'manual' | 'name' | 'target' | 'created'; subs: boolean }>(() => {
    try { return { health: [], owners: [], order: 'manual', subs: true, ...JSON.parse(localStorage.getItem('baseline:iniPrefs') ?? '{}') }; } catch { return { health: [], owners: [], order: 'manual', subs: true }; }
  });
  const patchPrefs = (p: Partial<typeof prefs>) => setPrefs(cur => { const n = { ...cur, ...p }; try { localStorage.setItem('baseline:iniPrefs', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const filterMenu = useMenu(); const displayMenu = useMenu();
  const order = (a: Initiative, b: Initiative) => prefs.order === 'name' ? a.name.localeCompare(b.name) : prefs.order === 'target' ? (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') : prefs.order === 'created' ? b.createdAt.localeCompare(a.createdAt) : a.position - b.position;
  const list = snap.initiatives.filter(i => (prefs.subs ? !i.parentId : true) && (tab === 'all' || i.status === tab)
    && (!prefs.health.length || prefs.health.includes(i.health ?? 'none')) && (!prefs.owners.length || prefs.owners.includes(i.ownerId ?? 'none'))).sort(order);
  const toggle = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const filtered = prefs.health.length + prefs.owners.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Initiatives' }]} right={<button className="btn secondary" onClick={() => setCreating(true)}><IconPlus size={13} /> New initiative</button>} />
      <div className="subnav">
        {([['active', 'Active'], ['planned', 'Planned'], ['all', 'All initiatives']] as const).map(([k, l]) => (
          <button key={k} className={`seg ${tab === k ? 'selected' : ''}`} onClick={() => navigate(`/initiatives/view/${k}`)}>{l}{tab === k && <RegisterMark group="ini-tabs" />}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button className={`icon-btn${filtered ? " on" : ""}`} title="Filter" onClick={filterMenu.open}><IconFilter size={15} /></button>
        <button className="icon-btn" title="Display options" onClick={displayMenu.open}><IconDisplay size={15} /></button>
      </div>
      {filterMenu.anchor && (
        <Menu anchor={filterMenu.anchor} onClose={filterMenu.close} width={220}>
          <div className="menu-header"><span>Health</span></div>
          {[...HEALTH.map(h => [h[0], h[1]] as [string, string]), ['none', 'No updates'] as [string, string]].map(([k, l]) => <MenuItem key={k} label={l} selected={prefs.health.includes(k)} onClick={() => patchPrefs({ health: toggle(prefs.health, k) })} />)}
          <MenuSep />
          <div className="menu-header"><span>Owner</span></div>
          {snap.users.filter(u => snap.initiatives.some(i => i.ownerId === u.id)).map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={prefs.owners.includes(u.id)} onClick={() => patchPrefs({ owners: toggle(prefs.owners, u.id) })} />)}
          {filtered > 0 && <><MenuSep /><MenuItem label="Clear filters" onClick={() => patchPrefs({ health: [], owners: [] })} /></>}
        </Menu>
      )}
      {displayMenu.anchor && (
        <Menu anchor={displayMenu.anchor} onClose={displayMenu.close} width={260}>
          <div className="dopts">
            <div className="dopts-row"><span>Ordering</span>
              <select className="text-input" style={{ width: 130, minWidth: 0 }} aria-label="Initiative ordering" value={prefs.order} onChange={e => patchPrefs({ order: e.target.value as typeof prefs.order })}>
                <option value="manual">Manual</option><option value="name">Name</option><option value="target">Target date</option><option value="created">Created</option>
              </select></div>
            <div className="dopts-row"><span>Nest sub-initiatives</span><button className={`switch${prefs.subs ? ' on' : ''}`} role="switch" aria-checked={prefs.subs} onClick={() => patchPrefs({ subs: !prefs.subs })}><span /></button></div>
          </div>
        </Menu>
      )}
      <div className="content">
        {!snap.initiatives.length ? (
          <div className="empty-state"><div className="empty-mark"><IconInitiative size={28} /></div><div className="empty-title">Initiatives</div>
            <div className="empty-desc">Initiatives are larger, strategic product efforts that set the direction of your company. They are comprised of all projects that align with the goals of the initiative and allow you to monitor their progress at scale.</div>
            <div className="empty-actions"><button className="btn primary" onClick={() => setCreating(true)}>Create new initiative <span className="btn-keys"><span className="kbd">N</span>then<span className="kbd">I</span></span></button></div></div>
        ) : (
          <div className="wtable">
            <div className="wt-head wt-ini"><span>Name</span><span>Health</span><span>Owner</span><span>Target date</span><span className="num">Projects</span><span>Progress</span></div>
            {list.map(i => <InitiativeRow key={i.id} ini={i} depth={0} nest={prefs.subs} />)}
            {!list.length && <div className="set-empty">No {tab === 'all' ? '' : tab} initiatives</div>}
          </div>
        )}
      </div>
      <AnimatePresence>{creating && <NewInitiativeModal key="ni" onClose={() => setCreating(false)} onCreated={id => navigate(`/initiatives/${id}`)} />}</AnimatePresence>
    </div>
  );
}

function InitiativeRow({ ini, depth, nest = true }: { ini: Initiative; depth: number; nest?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const owner = snap.users.find(u => u.id === ini.ownerId);
  const prog = initiativeProgress(snap, ini);
  const kids = snap.initiatives.filter(i => i.parentId === ini.id);
  const h = HEALTH.find(x => x[0] === ini.health);
  return (
    <>
      <div className="wt-row wt-ini" onClick={() => navigate(`/initiatives/${ini.id}`)}>
        <span className="wt-name" style={{ paddingLeft: depth * 22 }}><InitiativeStatusIcon status={ini.status} /><span>{ini.icon}</span><span>{ini.name}</span></span>
        <span>{h ? <span className="pulse-health"><span className="health-dot" style={{ background: h[2] }} />{h[1]}</span> : <span className="dim">No updates</span>}</span>
        <span>{owner ? <Avatar user={owner} size={18} /> : <span className="dim">—</span>}</span>
        <span className="mono">{ini.targetDate ? shortDate(ini.targetDate.slice(0, 10) + 'T12:00') : <span className="dim">—</span>}</span>
        <span className="num mono">{prog.projects}</span>
        <span className="ini-prog"><span className="cy-bar" style={{ width: 80 }}><span className="cy-done" style={{ width: `${prog.pct}%` }} /></span><span className="mono">{prog.pct}%</span></span>
      </div>
      {nest && kids.map(k => <InitiativeRow key={k.id} ini={k} depth={depth + 1} />)}
    </>
  );
}

function NewInitiativeModal(props: { onClose: () => void; onCreated?: (id: string) => void; parentId?: string }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    const { initiative } = await api.createInitiative({ name: name.trim(), description, parentId: props.parentId ?? null, status: 'planned' });
    await refresh(); props.onClose(); props.onCreated?.(initiative.id);
  };
  return (
    <Modal onClose={props.onClose} className="small-modal">
      <div className="sm-head"><span>{props.parentId ? 'New sub-initiative' : 'New initiative'}</span><button className="icon-btn" onClick={props.onClose}><IconClose size={14} /></button></div>
      <div className="sm-body">
        <input className="text-input" autoFocus placeholder="Initiative name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
        <textarea className="text-input" style={{ minHeight: 80 }} placeholder="What is this initiative trying to achieve?" value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div className="sm-foot"><button className="btn ghost" onClick={props.onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={create}>Create initiative</button></div>
    </Modal>
  );
}

/* ================= Initiative page ================= */
export function InitiativePage() {
  const { initiativeId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const ini = snap.initiatives.find(i => i.id === initiativeId);
  const [name, setName] = useState(ini?.name ?? '');
  useEffect(() => { setName(ini?.name ?? ''); }, [ini?.id, ini?.name]);
  const menu = useMenu();
  const [kind, setKind] = useState<'status' | 'owner' | 'target' | 'project' | 'parent' | null>(null);
  const [q, setQ] = useState('');
  const [sub, setSub] = useState(false);
  if (!ini) return <div className="empty-state"><div className="empty-title">Initiative not found</div></div>;
  const patch = async (b: Record<string, unknown>) => { await api.updateInitiative(ini.id, b); await refresh(); };
  const open = (k: typeof kind) => (e: React.MouseEvent) => { setKind(k); setQ(''); menu.open(e); };
  const owner = snap.users.find(u => u.id === ini.ownerId);
  const parent = snap.initiatives.find(i => i.id === ini.parentId);
  const projects = snap.projects.filter(p => ini.projectIds.includes(p.id));
  const kids = snap.initiatives.filter(i => i.parentId === ini.id);
  const prog = initiativeProgress(snap, ini);
  const updates = snap.initiativeUpdates.filter(u => u.initiativeId === ini.id);
  const h = HEALTH.find(x => x[0] === ini.health);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Initiatives', to: '/initiatives', muted: true }, ...(parent ? [{ label: parent.name, to: `/initiatives/${parent.id}`, muted: true }] : []), { label: ini.name, icon: <span>{ini.icon}</span> }]}
        favoriteRef={{ type: 'initiative', refId: ini.id }}
        more={<MenuItem icon={<IconTrash size={14} />} danger label="Delete initiative" onClick={async () => { await api.deleteInitiative(ini.id); await refresh(); navigate('/initiatives'); }} />} />
      <div className="content">
        <div className="ini-page">
          <div className="team-hero"><span className="ini-icon">{ini.icon}</span>
            <input className="proj-hero-name" value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== ini.name && void patch({ name: name.trim() })} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          </div>
          <div className="proj-props-row">
            <span className="ppr-label">Properties</span>
            <button className="prop-chip ghost" data-iprop="status" onClick={open('status')}><InitiativeStatusIcon status={ini.status} size={13} />{INITIATIVE_STATUS.find(x => x[0] === ini.status)?.[1]}</button>
            <span className="prop-chip ghost static">{h ? <><span className="health-dot" style={{ background: h[2] }} />{h[1]}</> : 'No updates'}</span>
            <button className="prop-chip ghost" onClick={open('owner')}>{owner ? <><Avatar user={owner} size={16} />{owner.name}</> : <><IconUser size={13} />Owner</>}</button>
            <button className="prop-chip ghost" onClick={open('target')}><IconCalendar size={13} />{ini.targetDate ? shortDate(ini.targetDate.slice(0, 10) + 'T12:00') : 'Target date'}</button>
            <button className="prop-chip ghost" onClick={open('parent')}><IconInitiative size={13} />{parent ? parent.name : 'Parent initiative'}</button>
            <span className="prop-chip ghost static">{prog.pct}% of {prog.total} issues</span>
          </div>
          <div className="proj-desc"><RichEditor key={ini.id} value={ini.description} placeholder="Add a description…" onBlur={md => md !== ini.description && void patch({ description: md })} /></div>

          <div className="proj-section-label">Projects <span className="dim">{projects.length}</span></div>
          <div className="ini-list">
            {projects.map(p => { const pp = projectProgress(snap, p.id); const st = namedStatus(p, snap); const lead = snap.users.find(u => u.id === p.leadId); return (
              <div key={p.id} className="ini-item" onClick={() => navigate(`/projects/${p.id}`)}>
                <ProjectStatusIcon status={p.status} color={st.color} /><span>{p.icon}</span><span className="ini-item-name">{p.name}</span>
                <span className="dim" style={{ fontSize: 12 }}>{st.name}</span>{lead && <Avatar user={lead} size={16} />}
                <span className="ini-prog"><span className="cy-bar" style={{ width: 60 }}><span className="cy-done" style={{ width: `${pp.pct}%` }} /></span><span className="mono">{pp.pct}%</span></span>
                <button className="icon-btn hover-only" title="Remove from initiative" onClick={async e => { e.stopPropagation(); await api.removeInitiativeProject(ini.id, p.id); await refresh(); }}><IconClose size={12} /></button>
              </div>
            ); })}
            <button className="prop-line dim" onClick={open('project')}><IconPlus size={13} /><span className="prop-line-label">Add project…</span></button>
          </div>

          <div className="proj-section-label">Sub-initiatives <span className="dim">{kids.length}</span></div>
          <div className="ini-list">
            {kids.map(k => <div key={k.id} className="ini-item" onClick={() => navigate(`/initiatives/${k.id}`)}><InitiativeStatusIcon status={k.status} /><span>{k.icon}</span><span className="ini-item-name">{k.name}</span><span className="mono dim">{initiativeProgress(snap, k).pct}%</span></div>)}
            <button className="prop-line dim" onClick={() => setSub(true)}><IconPlus size={13} /><span className="prop-line-label">Add sub-initiative…</span></button>
          </div>

          <div className="proj-section-label">Updates</div>
          <InitiativeUpdateComposer initiativeId={ini.id} />
          {updates.map(u => { const a = snap.users.find(x => x.id === u.userId); const uh = HEALTH.find(x => x[0] === u.health); return (
            <article key={u.id} className="pulse-card">
              <header>{uh && <span className="pulse-health"><span className="health-dot" style={{ background: uh[2] }} />{uh[1]}</span>}<span style={{ flex: 1 }} /><Avatar user={a} size={18} /><span className="pulse-meta">{a?.name} · {relTime(u.createdAt)}</span></header>
              <div className="pulse-body"><Markdown text={u.body} /></div>
            </article>
          ); })}
        </div>
      </div>
      {menu.anchor && kind && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={kind === 'target' ? 250 : 240}>
          {kind === 'status' && INITIATIVE_STATUS.map(([v, l], n) => <MenuItem key={v} icon={<InitiativeStatusIcon status={v} />} label={l} selected={ini.status === v} right={<span className="kbd">{n + 1}</span>} onClick={() => void patch({ status: v })} />)}
          {kind === 'owner' && <>{snap.users.filter(u => u.kind !== 'agent').map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={ini.ownerId === u.id} onClick={() => void patch({ ownerId: u.id })} />)}<MenuSep /><MenuItem label="No owner" onClick={() => void patch({ ownerId: null })} /></>}
          {kind === 'target' && <><div className="menu-header"><span>Target date</span></div><CalendarGrid selected={ini.targetDate?.slice(0, 10)} onPick={async iso => { await patch({ targetDate: iso }); menu.close(); }} />{ini.targetDate && <MenuItem icon={<IconClose size={13} />} label="Clear date" onClick={() => void patch({ targetDate: null })} />}</>}
          {kind === 'parent' && <>{snap.initiatives.filter(i => i.id !== ini.id && i.parentId !== ini.id).map(i => <MenuItem key={i.id} icon={<span>{i.icon}</span>} label={i.name} selected={ini.parentId === i.id} onClick={() => void patch({ parentId: i.id })} />)}<MenuSep /><MenuItem label="No parent" onClick={() => void patch({ parentId: null })} /></>}
          {kind === 'project' && <>
            <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}><input autoFocus placeholder="Add project…" value={q} onChange={e => setQ(e.target.value)} /></div>
            {snap.projects.filter(p => !ini.projectIds.includes(p.id) && p.name.toLowerCase().includes(q.toLowerCase())).map(p => (
              <MenuItem key={p.id} icon={<span>{p.icon}</span>} label={p.name} onClick={async () => { await api.addInitiativeProject(ini.id, p.id); await refresh(); }} />
            ))}
          </>}
        </Menu>
      )}
      <AnimatePresence>{sub && <NewInitiativeModal key="sub" parentId={ini.id} onClose={() => setSub(false)} />}</AnimatePresence>
    </div>
  );
}

function InitiativeUpdateComposer({ initiativeId }: { initiativeId: string }) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<ProjectHealth>('onTrack');
  const [body, setBody] = useState('');
  if (!open) return <button className="update-card empty" onClick={() => setOpen(true)}>Write an initiative update</button>;
  const post = async () => { if (isBlank(body)) return; await api.addInitiativeUpdate(initiativeId, body, health); await refresh(); setOpen(false); setBody(''); };
  return (
    <div className="update-card composing">
      <div className="update-health-row">{HEALTH.map(([v, l, c]) => <button key={v} className={`health-pick${health === v ? ' on' : ''}`} onClick={() => setHealth(v)}><span className="health-dot" style={{ background: c }} />{l}</button>)}</div>
      <textarea className="text-input ini-update-input" autoFocus placeholder="How is the initiative going?" value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post(); if (e.key === 'Escape') setOpen(false); }} />
      <div className="cbox-foot"><span className="cbox-hint">⌘↵ to post</span><button className="btn" style={{ height: 26, fontSize: 12 }} onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={() => void post()}>Post update</button></div>
    </div>
  );
}

/** "Initiatives" row in a project's properties: add to / remove from initiatives */
export function ProjectInitiatives({ projectId }: { projectId: string }) {
  const snap = useApp(s => s.snap)!;
  const menu = useMenu();
  if (!snap.workspace.features.initiativesEnabled) return null;
  const mine = snap.initiatives.filter(i => i.projectIds.includes(projectId));
  return (
    <>
      <button className="prop-chip ghost" data-pprop="initiatives" onClick={menu.open}><IconInitiative size={13} />{mine.length ? mine.map(i => i.name).join(', ') : 'Initiatives'}</button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={240}>
          <div className="menu-header"><span>Initiatives</span></div>
          {snap.initiatives.map(i => { const on = i.projectIds.includes(projectId); return (
            <button key={i.id} className="menu-item" onClick={async e => { e.stopPropagation(); if (on) await api.removeInitiativeProject(i.id, projectId); else await api.addInitiativeProject(i.id, projectId); await refresh(); }}>
              <span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span><span className="mi-icon">{i.icon}</span><span className="mi-label">{i.name}</span>
            </button>
          ); })}
          {!snap.initiatives.length && <div className="menu-empty">No initiatives yet.</div>}
        </Menu>
      )}
    </>
  );
}

/* ================= Releases ================= */
export function ReleasesPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = async () => { if (!name.trim()) return; const { release } = await api.createRelease({ name: name.trim() }); await refresh(); setName(''); navigate(`/releases/${release.id}`); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Releases' }]} />
      <div className="subnav"><div className="rel-new"><IconRelease size={14} /><input placeholder="New release, e.g. v1.5.0 — Enter to create" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} /></div></div>
      <div className="content">
        {!snap.releases.length ? (
          <div className="empty-state"><div className="empty-mark"><LogoMark size={30} /></div><div className="empty-title">Releases</div><div className="empty-desc">Track which issues ship in each release. Create one above, then add issues from the issue's Release property.</div></div>
        ) : RELEASE_STAGE.map(([stage, label]) => {
          const list = snap.releases.filter(r => r.stage === stage);
          if (!list.length) return null;
          return (
            <div key={stage}>
              <div className="group-header"><ReleaseStageIcon stage={stage} /><span>{label}</span><span className="count">{list.length}</span><span className="gh-rule" /></div>
              {list.map(r => { const issues = snap.issues.filter(i => i.releaseId === r.id); const done = issues.filter(i => ['completed', 'canceled'].includes(snap.states.find(s => s.id === i.stateId)?.type ?? '')).length; return (
                <div key={r.id} className="wt-row wt-rel" onClick={() => navigate(`/releases/${r.id}`)}>
                  <span className="wt-name"><IconRelease size={14} /><span className="mono">{r.name}</span>{r.description && <span className="dim">{r.description.replace(/\s+/g, ' ').slice(0, 60)}</span>}</span>
                  <span className="mono">{r.releasedAt ? `Released ${shortDate(r.releasedAt)}` : r.targetDate ? shortDate(r.targetDate.slice(0, 10) + 'T12:00') : <span className="dim">No date</span>}</span>
                  <span className="mono">{done}/{issues.length} issues</span>
                </div>
              ); })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReleasePage() {
  const { releaseId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const r = snap.releases.find(x => x.id === releaseId);
  const [opts, patchOpts, reset] = useViewPrefs<ViewOptions>(`baseline:view:release:${releaseId}`, { ...DEFAULT_VIEW_OPTIONS, filters: {} });
  const display = useMenu();
  const menu = useMenu();
  const [kind, setKind] = useState<'stage' | 'target' | 'add' | null>(null);
  const [q, setQ] = useState('');
  const issues = useMemo(() => snap.issues.filter(i => i.releaseId === releaseId), [snap.issues, releaseId]);
  if (!r) return <div className="empty-state"><div className="empty-title">Release not found</div></div>;
  const patch = async (b: Record<string, unknown>) => { await api.updateRelease(r.id, b); await refresh(); };
  const open = (k: typeof kind) => (e: React.MouseEvent) => { setKind(k); setQ(''); menu.open(e); };
  const key = (i: (typeof snap.issues)[number]) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Releases', to: '/releases', muted: true }, { label: r.name, icon: <IconRelease size={14} /> }]}
        more={<MenuItem icon={<IconTrash size={14} />} danger label="Delete release" onClick={async () => { await api.deleteRelease(r.id); await refresh(); navigate('/releases'); }} />} />
      <div className="rel-head">
        <button className="prop-chip ghost" data-rprop="stage" onClick={open('stage')}><ReleaseStageIcon stage={r.stage} size={13} />{RELEASE_STAGE.find(x => x[0] === r.stage)?.[1]}</button>
        <button className="prop-chip ghost" onClick={open('target')}><IconCalendar size={13} />{r.targetDate ? shortDate(r.targetDate.slice(0, 10) + 'T12:00') : 'Target date'}</button>
        {r.releasedAt && <span className="prop-chip ghost static">Released {shortDate(r.releasedAt)}</span>}
        <button className="prop-chip ghost" onClick={open('add')}><IconPlus size={13} />Add issues</button>
        <span style={{ flex: 1 }} />
        <ListToolbar opts={opts} onDisplay={display.open} />
      </div>
      <IssueListBody issues={issues} opts={opts} patch={patchOpts} reset={reset} multiTeam displayAnchor={display.anchor} closeDisplay={display.close}
        emptyTitle="No issues in this release yet" emptyDesc="Add issues here, or set Release on an issue." emptyHideCreate />
      {menu.anchor && kind && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={kind === 'add' ? 320 : 240}>
          {kind === 'stage' && RELEASE_STAGE.map(([v, l]) => <MenuItem key={v} icon={<ReleaseStageIcon stage={v} />} label={l} selected={r.stage === v} onClick={() => void patch({ stage: v })} />)}
          {kind === 'target' && <><div className="menu-header"><span>Target date</span></div><CalendarGrid selected={r.targetDate?.slice(0, 10)} onPick={async iso => { await patch({ targetDate: iso }); menu.close(); }} /></>}
          {kind === 'add' && <>
            <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}><input autoFocus placeholder="Search issues…" value={q} onChange={e => setQ(e.target.value)} /></div>
            {snap.issues.filter(i => i.releaseId !== r.id && `${key(i)} ${i.title}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30).map(i => (
              <button key={i.id} className="menu-item" onClick={async e => { e.stopPropagation(); await api.updateIssue(i.id, { releaseId: r.id }); await refresh(); }}>
                <span className="mi-label"><span className="mono dim">{key(i)}</span> {i.title}</span>
              </button>
            ))}
          </>}
        </Menu>
      )}
    </div>
  );
}
