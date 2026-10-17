import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useApp, relTime, shortDate } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, Modal, useMenu } from './ui.js';
import { Avatar, StateIcon, teamDisplayIcon } from './pickers.js';
import { AvatarStack } from './AvatarStack.js';
import { Markdown } from './Markdown.js';
import {
  IconPlus, IconSearch, IconTrash, IconClose, IconStar, IconCheck, IconEdit, IconPulse, IconCustomers, IconCycle, IconBox,
  IconInbox, IconMyIssues, IconDrafts, IconInitiative, IconViews, IconRelease, IconAsk, IconTeam, IconMembers, IconChevronDown,
} from './icons.js';
import { SIDEBAR_DEFAULTS, type SidebarVisibility } from '../../src/core/types.js';
import { Illustration } from './illustrations.js';

type Snap = NonNullable<ReturnType<typeof useApp.getState>['snap']>;
const refresh = () => useApp.getState().bootstrap();
const HEALTH_COLOR: Record<string, string> = { onTrack: '#4cb782', atRisk: '#f2994a', offTrack: '#eb5757' };
const HEALTH_LABEL: Record<string, string> = { onTrack: 'On track', atRisk: 'At risk', offTrack: 'Off track' };

/* ================= Pulse: every project update in one feed ================= */
export function PulsePage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [scope, setScope] = useState<'all' | 'following' | 'lead'>('all');
  const me = snap.currentUser.id;
  const updates = snap.projectUpdates.filter(u => {
    const p = snap.projects.find(x => x.id === u.projectId);
    if (!p) return false;
    if (scope === 'lead') return p.leadId === me || p.memberIds.includes(me);
    if (scope === 'following') return snap.projectSubscriptions.some(s => s.projectId === p.id && s.userId === me && s.updates);
    return true;
  });
  // group by day, newest first
  const days = new Map<string, typeof updates>();
  for (const u of updates) { const d = u.createdAt.slice(0, 10); days.set(d, [...(days.get(d) ?? []), u]); }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Pulse', icon: <IconPulse size={14} /> }]} right={<button className="btn ghost sm" onClick={() => navigate('/settings/pulse')}>Summary settings</button>} />
      <div className="subnav">
        {([['all', 'All updates'], ['following', 'Following'], ['lead', 'My projects']] as const).map(([k, l]) => (
          <button key={k} className={`seg ${scope === k ? 'selected' : ''}`} onClick={() => setScope(k)}>{l}</button>
        ))}
      </div>
      <div className="content">
        {!snap.workspace.features.pulseEnabled ? (
          <div className="empty-state"><div className="empty-title">Pulse is off</div><div className="empty-desc">Turn it on in Settings › Pulse to see every project update in one feed.</div><div className="empty-actions"><button className="btn primary" onClick={async () => { await api.setFeatures({ pulseEnabled: true }); await refresh(); }}>Enable Pulse</button></div></div>
        ) : !updates.length ? (
          <div className="empty-state"><Illustration name="updates" /><div className="empty-title">No updates yet</div><div className="empty-desc">Project updates posted from a project's overview show up here.</div></div>
        ) : (
          <div className="pulse-feed">
            {[...days.entries()].map(([day, list]) => (
              <div key={day}>
                <div className="pulse-day">{new Date(day + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                {list.map(u => {
                  const p = snap.projects.find(x => x.id === u.projectId)!;
                  const author = snap.users.find(x => x.id === u.userId);
                  return (
                    <article key={u.id} className="pulse-card">
                      <header>
                        <button className="pulse-proj" onClick={() => navigate(`/projects/${p.id}`)}><span>{p.icon}</span>{p.name}</button>
                        {u.health && <span className="pulse-health"><span className="health-dot" style={{ background: HEALTH_COLOR[u.health] }} />{HEALTH_LABEL[u.health]}</span>}
                        <span style={{ flex: 1 }} />
                        <Avatar user={author} size={18} /><span className="pulse-meta">{author?.name} · {relTime(u.createdAt)}</span>
                      </header>
                      <div className="pulse-body"><Markdown text={u.body} /></div>
                    </article>
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

/* ================= customers ================= */
const money = (n: number | null) => n == null ? '—' : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;

export function CustomersPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = snap.customers.filter(c => `${c.name} ${c.domains.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  const reqs = (id: string) => snap.customerRequests.filter(r => r.customerId === id).length;
  if (!snap.workspace.features.customerRequestsEnabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <TopBar crumbs={[{ label: 'Customers' }]} />
        <div className="empty-state"><Illustration name="customers" /><div className="empty-title">Customer requests are off</div>
          <div className="empty-desc">Track which customers asked for which issues and projects.</div>
          <div className="empty-actions"><button className="btn primary" onClick={async () => { await api.setFeatures({ customerRequestsEnabled: true }); await refresh(); }}>Enable customer requests</button></div></div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Customers' }]} right={<button className="btn secondary" onClick={() => setCreating(true)}><IconPlus size={13} /> New customer</button>} />
      <div className="subnav"><div className="set-filter" style={{ border: 0, margin: 0, flex: 1 }}><IconSearch size={13} /><input placeholder="Find customers…" value={q} onChange={e => setQ(e.target.value)} /></div></div>
      <div className="content">
        {!snap.customers.length ? (
          <div className="empty-state"><Illustration name="customers" /><div className="empty-title">No customers</div><div className="empty-desc">Add the customers you hear from, then attach their requests to issues and projects.</div><div className="empty-actions"><button className="btn primary" onClick={() => setCreating(true)}>New customer</button></div></div>
        ) : (
          <div className="wtable">
            <div className="wt-head wt-cust"><span>Name</span><span>Status</span><span>Tier</span><span className="num">Requests</span><span className="num">Revenue</span><span className="num">Size</span><span>Owner</span></div>
            {list.map(c => {
              const st = snap.customerStatuses.find(x => x.id === c.statusId);
              const tier = snap.customerTiers.find(x => x.id === c.tierId);
              const owner = snap.users.find(u => u.id === c.ownerId);
              return (
                <div key={c.id} className="wt-row wt-cust" onClick={() => navigate(`/customers/${c.id}`)}>
                  <span className="wt-name"><span className="cust-logo">{c.name[0]}</span><span>{c.name}</span>{c.domains[0] && <span className="dim">{c.domains[0]}</span>}</span>
                  <span>{st ? <span className="plabel-chip"><span className="label-dot" style={{ background: st.color }} />{st.name}</span> : <span className="dim">—</span>}</span>
                  <span>{tier ? <span className="plabel-chip"><span className="label-dot" style={{ background: tier.color }} />{tier.name}</span> : <span className="dim">—</span>}</span>
                  <span className="num mono">{reqs(c.id)}</span>
                  <span className="num mono">{money(c.revenue)}</span>
                  <span className="num mono">{c.size ?? '—'}</span>
                  <span>{owner ? <Avatar user={owner} size={18} /> : <span className="dim">—</span>}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <AnimatePresence>{creating && <NewCustomerModal key="nc" onClose={() => setCreating(false)} onCreated={id => navigate(`/customers/${id}`)} />}</AnimatePresence>
    </div>
  );
}

function NewCustomerModal(props: { onClose: () => void; onCreated?: (id: string) => void; initialName?: string }) {
  const [name, setName] = useState(props.initialName ?? '');
  const [domain, setDomain] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    const { customer } = await api.createCustomer({ name: name.trim(), domains: domain.trim() ? [domain.trim()] : [] });
    await refresh();
    props.onClose();
    props.onCreated?.(customer.id);
  };
  return (
    <Modal onClose={props.onClose} className="small-modal">
      <div className="sm-head"><span>New customer</span><button className="icon-btn" onClick={props.onClose}><IconClose size={14} /></button></div>
      <div className="sm-body">
        <input className="text-input" autoFocus placeholder="Customer name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
        <input className="text-input" placeholder="Domain (e.g. acme.com)" value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
      </div>
      <div className="sm-foot"><button className="btn ghost" onClick={props.onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={create}>Create customer</button></div>
    </Modal>
  );
}

export function CustomerPage() {
  const { customerId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const c = snap.customers.find(x => x.id === customerId);
  const [name, setName] = useState(c?.name ?? '');
  useEffect(() => { setName(c?.name ?? ''); }, [c?.id, c?.name]);
  const menu = useMenu();
  const [menuKind, setMenuKind] = useState<'status' | 'tier' | 'owner' | null>(null);
  if (!c) return <div className="empty-state"><div className="empty-title">Customer not found</div></div>;
  const reqs = snap.customerRequests.filter(r => r.customerId === c.id);
  const st = snap.customerStatuses.find(x => x.id === c.statusId);
  const tier = snap.customerTiers.find(x => x.id === c.tierId);
  const owner = snap.users.find(u => u.id === c.ownerId);
  const patch = async (b: Record<string, unknown>) => { await api.updateCustomer(c.id, b); await refresh(); };
  const open = (k: 'status' | 'tier' | 'owner') => (e: React.MouseEvent) => { setMenuKind(k); menu.open(e); };
  const newIssue = () => {
    const f = snap.workspace.features;
    const teamId = f.customerDefaultTeamId ?? snap.teams[0]?.id;
    const triage = snap.states.find(s => s.teamId === teamId && s.type === 'triage');
    useApp.getState().openCreate({ teamId, stateId: snap.teams.find(t => t.id === teamId)?.triageEnabled ? triage?.id : undefined, title: '' });
    // link the next issue created to this customer
    const before = new Set(useApp.getState().snap!.issues.map(i => i.id));
    const unsub = useApp.subscribe(async s => {
      if (s.createModal.open) return;
      unsub();
      const fresh = s.snap?.issues.find(i => !before.has(i.id));
      if (fresh) { await api.addCustomerRequest({ customerId: c.id, issueId: fresh.id, body: '' }); await refresh(); }
    });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Customers', to: '/customers', muted: true }, { label: c.name }]} more={<>
        <MenuItem icon={<IconTrash size={14} />} danger label="Delete customer" onClick={async () => { await api.deleteCustomer(c.id); await refresh(); navigate('/customers'); }} />
      </>} right={<button className="btn secondary" onClick={newIssue}><IconPlus size={13} /> New issue</button>} />
      <div className="content">
        <div className="cust-page">
          <div className="team-hero"><span className="cust-logo big">{c.name[0]}</span>
            <input className="proj-hero-name" value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && void patch({ name: name.trim() })} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          </div>
          <div className="proj-props-row">
            <span className="ppr-label">Properties</span>
            <button className="prop-chip ghost" onClick={open('status')}>{st ? <><span className="label-dot" style={{ background: st.color }} />{st.name}</> : 'Status'}</button>
            <button className="prop-chip ghost" onClick={open('tier')}>{tier ? <><span className="label-dot" style={{ background: tier.color }} />{tier.name}</> : 'Tier'}</button>
            <button className="prop-chip ghost" onClick={open('owner')}>{owner ? <><Avatar user={owner} size={16} />{owner.name}</> : 'Owner'}</button>
            <InlineNumber label="Revenue" value={c.revenue} format={money} onSave={v => void patch({ revenue: v })} />
            <InlineNumber label="Size" value={c.size} format={v => v == null ? '—' : `${v} people`} onSave={v => void patch({ size: v })} />
            <InlineText label="Domains" value={c.domains.join(', ')} onSave={v => void patch({ domains: v.split(',').map(x => x.trim()).filter(Boolean) })} />
          </div>
          <div className="proj-section-label">Requests <span className="dim">{reqs.length}</span></div>
          {reqs.map(r => <RequestRow key={r.id} request={r} showTarget />)}
          {!reqs.length && <div className="bd-empty">No requests yet. Add one from an issue or project (Customer requests), or create a new issue here.</div>}
        </div>
      </div>
      {menu.anchor && menuKind && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={220}>
          {menuKind === 'owner' ? <>
            <MenuItem label="No owner" selected={!c.ownerId} onClick={() => void patch({ ownerId: null })} />
            {snap.users.map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={c.ownerId === u.id} onClick={() => void patch({ ownerId: u.id })} />)}
          </> : <>
            <MenuItem label={menuKind === 'status' ? 'No status' : 'No tier'} selected={!(menuKind === 'status' ? c.statusId : c.tierId)} onClick={() => void patch({ [menuKind === 'status' ? 'statusId' : 'tierId']: null })} />
            {(menuKind === 'status' ? snap.customerStatuses : snap.customerTiers).map(x => (
              <MenuItem key={x.id} icon={<span className="label-dot" style={{ background: x.color }} />} label={x.name} selected={(menuKind === 'status' ? c.statusId : c.tierId) === x.id} onClick={() => void patch({ [menuKind === 'status' ? 'statusId' : 'tierId']: x.id })} />
            ))}
            {!(menuKind === 'status' ? snap.customerStatuses : snap.customerTiers).length && <div className="menu-empty">Add {menuKind === 'status' ? 'statuses' : 'tiers'} in Settings › Customer requests.</div>}
          </>}
        </Menu>
      )}
    </div>
  );
}

function InlineNumber(props: { label: string; value: number | null; format: (v: number | null) => string; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  if (editing) return <input className="text-input" style={{ height: 26, width: 110 }} autoFocus placeholder={props.label} value={v} onChange={e => setV(e.target.value)}
    onBlur={() => { setEditing(false); props.onSave(v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, ''))); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }} />;
  return <button className="prop-chip ghost" title={props.label} onClick={() => { setV(props.value == null ? '' : String(props.value)); setEditing(true); }}>{props.value == null ? props.label : props.format(props.value)}</button>;
}
function InlineText(props: { label: string; value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(props.value);
  if (editing) return <input className="text-input" style={{ height: 26, width: 200 }} autoFocus placeholder={props.label} value={v} onChange={e => setV(e.target.value)}
    onBlur={() => { setEditing(false); if (v !== props.value) props.onSave(v); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }} />;
  return <button className="prop-chip ghost" title={props.label} onClick={() => { setV(props.value); setEditing(true); }}>{props.value || props.label}</button>;
}

function RequestRow(props: { request: Snap['customerRequests'][number]; showTarget?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const r = props.request;
  const c = snap.customers.find(x => x.id === r.customerId);
  const issue = r.issueId ? snap.issues.find(i => i.id === r.issueId) : undefined;
  const project = r.projectId ? snap.projects.find(p => p.id === r.projectId) : undefined;
  const team = issue ? snap.teams.find(t => t.id === issue.teamId) : undefined;
  const state = issue ? snap.states.find(s => s.id === issue.stateId) : undefined;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(r.body);
  return (
    <div className="creq">
      <div className="creq-head">
        {props.showTarget ? (
          issue ? <button className="creq-target" onClick={() => navigate(`/issue/${team?.key}-${issue.number}`)}>{state && <StateIcon type={state.type} color={state.color} size={13} />}<span className="mono dim">{team?.key}-{issue.number}</span>{issue.title}</button>
            : project ? <button className="creq-target" onClick={() => navigate(`/projects/${project.id}`)}><span>{project.icon}</span>{project.name}</button> : <span className="dim">Removed</span>
        ) : (
          <button className="creq-target" onClick={() => c && navigate(`/customers/${c.id}`)}><span className="cust-logo">{c?.name[0] ?? '?'}</span>{c?.name ?? 'Unknown customer'}</button>
        )}
        {r.important && <span className="creq-imp" title="Important"><IconStar size={11} filled /> Important</span>}
        <span style={{ flex: 1 }} />
        <span className="dim" style={{ fontSize: 12 }}>{shortDate(r.createdAt)}</span>
        <button className="icon-btn hover-only" title={r.important ? 'Unmark important' : 'Mark important'} onClick={async () => { await api.updateCustomerRequest(r.id, { important: !r.important }); await refresh(); }}><IconStar size={12} filled={r.important} /></button>
        <button className="icon-btn hover-only" title="Edit request" onClick={() => { setBody(r.body); setEditing(true); }}><IconEdit size={12} /></button>
        <button className="icon-btn hover-only" title="Remove request" onClick={async () => { await api.deleteCustomerRequest(r.id); await refresh(); }}><IconTrash size={12} /></button>
      </div>
      {editing ? (
        <textarea className="text-input creq-edit" autoFocus value={body} onChange={e => setBody(e.target.value)}
          onBlur={async () => { setEditing(false); if (body !== r.body) { await api.updateCustomerRequest(r.id, { body }); await refresh(); } }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur(); if (e.key === 'Escape') setEditing(false); }} />
      ) : r.body ? <div className="creq-body"><Markdown text={r.body} /></div> : null}
    </div>
  );
}

/** "Customer requests" on an issue or a project: who asked, what they said, add another */
export function CustomerRequests(props: { issueId?: string; projectId?: string; compact?: boolean; asButton?: boolean; hideWhenEmpty?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const menu = useMenu();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [q, setQ] = useState('');
  const [creatingName, setCreatingName] = useState<string | null>(null);
  if (!snap.workspace.features.customerRequestsEnabled) return null;
  const reqs = snap.customerRequests.filter(r => (props.issueId && r.issueId === props.issueId) || (props.projectId && r.projectId === props.projectId));
  if (props.hideWhenEmpty && !reqs.length) return null;
  const add = async () => {
    if (!customerId) return;
    await api.addCustomerRequest({ customerId, issueId: props.issueId ?? null, projectId: props.projectId ?? null, body: body.trim() });
    setCustomerId(null); setBody(''); menu.close();
    await refresh();
  };
  const opener = (e: React.MouseEvent) => { setCustomerId(null); setQ(''); menu.open(e); };
  return (
    <div className={props.asButton ? 'creq-btn' : 'creq-section'} data-customer-requests={props.asButton ? undefined : ''}>
      {props.asButton ? <button className="icon-btn" title="Add customer request" onClick={opener}><IconCustomers size={14} /></button> : <>
        <div className="proj-section-label">Customer requests {reqs.length > 0 && <span className="dim">{reqs.length}</span>}</div>
        {reqs.map(r => <RequestRow key={r.id} request={r} />)}
        <button className="prop-line dim" onClick={opener}><IconPlus size={13} /><span className="prop-line-label">Add customer request…</span></button>
      </>}
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={300}>
          {!customerId ? <>
            <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}><input autoFocus placeholder="Customer…" value={q} onChange={e => setQ(e.target.value)} /></div>
            {snap.customers.filter(c => c.name.toLowerCase().includes(q.trim().toLowerCase())).map(c => (
              <button key={c.id} className="menu-item" onClick={e => { e.stopPropagation(); setCustomerId(c.id); }}><span className="mi-icon"><span className="cust-logo">{c.name[0]}</span></span><span className="mi-label">{c.name}</span></button>
            ))}
            <MenuSep />
            <MenuItem icon={<IconPlus size={13} />} label={q.trim() ? `New customer “${q.trim()}”` : 'New customer…'} onClick={() => setCreatingName(q.trim())} />
          </> : (
            <div className="creq-form" onClick={e => e.stopPropagation()}>
              <div className="menu-header"><span>{snap.customers.find(c => c.id === customerId)?.name} asked for this</span></div>
              <textarea className="text-input" autoFocus placeholder="What did they say? (optional)" value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(); }} />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><button className="btn ghost sm" onClick={() => setCustomerId(null)}>Back</button><button className="btn primary sm" onClick={add}>Add request</button></div>
            </div>
          )}
        </Menu>
      )}
      <AnimatePresence>{creatingName !== null && <NewCustomerModal key="ncr" initialName={creatingName} onClose={() => setCreatingName(null)} onCreated={id => { setCustomerId(id); setCreatingName(null); }} />}</AnimatePresence>
    </div>
  );
}

/* ================= Teams & Members (workspace directories) ================= */
export function TeamsPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const now = new Date().toISOString();
  const list = snap.teams.filter(t => `${t.name} ${t.key}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Teams' }]} right={<button className="btn secondary" onClick={() => navigate('/settings/new-team')}><IconPlus size={13} /> New team</button>} />
      <div className="subnav"><div className="set-filter" style={{ border: 0, margin: 0, flex: 1 }}><IconSearch size={13} /><input placeholder="Find teams…" value={q} onChange={e => setQ(e.target.value)} /></div></div>
      <div className="content">
        <div className="wtable">
          <div className="wt-head wt-teams"><span>Name</span><span>Description</span><span>Membership</span><span>Members</span><span>Cycle</span><span>Active projects</span></div>
          {list.map(t => {
            const members = [...new Set(snap.issues.filter(i => i.teamId === t.id && i.assigneeId).map(i => i.assigneeId!))].map(id => snap.users.find(u => u.id === id)).filter(Boolean);
            const cur = snap.cycles.find(c => c.teamId === t.id && c.startsAt <= now && c.endsAt >= now);
            const active = snap.projects.filter(p => p.teamId === t.id && p.status === 'started').length;
            return (
              <div key={t.id} className="wt-row wt-teams" onClick={() => navigate(`/team/${t.key}/overview`)}>
                <span className="wt-name">{teamDisplayIcon(t)}<span>{t.name}</span><span className="dim mono">{t.key}</span></span>
                <span className="dim wt-clip">{t.description?.replace(/\s+/g, ' ') || ''}</span>
                <span className="wt-joined"><IconCheck size={12} /> Joined</span>
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
      <TopBar crumbs={[{ label: 'Members' }]} right={<button className="btn secondary" onClick={() => navigate('/settings/members')}><IconPlus size={13} /> Add member</button>} />
      <div className="subnav"><div className="set-filter" style={{ border: 0, margin: 0, flex: 1 }}><IconSearch size={13} /><input placeholder="Find members…" value={q} onChange={e => setQ(e.target.value)} /></div></div>
      <div className="content">
        <div className="wtable">
          <div className="wt-head wt-members"><span>Name ↓</span><span>Status</span><span>Joined</span><span>Teams</span><span>Last seen</span></div>
          {list.map(u => {
            const teams = snap.teams.filter(t => snap.issues.some(i => i.teamId === t.id && (i.assigneeId === u.id || i.creatorId === u.id)));
            const me = u.id === snap.currentUser.id;
            return (
              <div key={u.id} className="wt-row wt-members" onClick={() => navigate(`/profiles/${u.id}`)}>
                <span className="wt-name"><Avatar user={u} size={22} /><span className="wt-stack"><span>{u.name}</span><span className="dim">{u.username || u.email}</span></span></span>
                <span>{u.kind === 'agent' ? <span className="plabel-chip">Agent</span> : u.admin ? <span className="plabel-chip admin">Admin</span> : <span className="plabel-chip">Member</span>}</span>
                <span className="mono dim">{firstSeen.get(u.id) ? shortDate(firstSeen.get(u.id)!) : shortDate(snap.workspace.createdAt)}</span>
                <span className="wt-teams-cell">{teams.map(t => <span key={t.id} className="wt-team"><span className="ws-avatar" style={{ background: t.color, borderRadius: 3, fontSize: 7, width: 13, height: 13 }}>{t.key[0]}</span>{t.key}</span>)}</span>
                <span>{me ? <span className="online"><span className="online-dot" />Online</span> : <span className="dim mono">{lastSeen.get(u.id) ? relTime(lastSeen.get(u.id)!) : '—'}</span>}</span>
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
          <div className="empty-state"><Illustration name="drafts" /><div className="empty-title">No active drafts</div><div className="empty-desc">"Save draft" in the new-issue modal keeps an issue here until you finish it.</div></div>
        ) : (
          <div className="static-list">
            {drafts.map(d => {
              const t = snap.teams.find(x => x.id === d.teamId);
              return (
                <div key={d.teamId} className="issue-row static-row" onClick={() => useApp.getState().openCreate({ teamId: d.teamId })}>
                  {t && teamDisplayIcon(t)}
                  <span className="row-title-wrap"><span className="row-title">{d.title || 'Untitled draft'}</span><span className="row-parent">{d.description.replace(/\s+/g, ' ').slice(0, 80)}</span></span>
                  <span className="row-meta"><span className="row-date">{d.savedAt ? relTime(d.savedAt) : ''}</span>
                    <button className="icon-btn" title="Delete draft" onClick={e => { e.stopPropagation(); try { localStorage.removeItem(`baseline:draft:${d.teamId}`); } catch { /* ignore */ } window.dispatchEvent(new Event('baseline:drafts')); }}><IconTrash size={13} /></button>
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
  { key: 'releases', label: 'Releases', section: 'Workspace' }, { key: 'asks', label: 'Asks', section: 'Workspace' }, { key: 'pulse', label: 'Pulse', section: 'Workspace' },
  { key: 'customers', label: 'Customers', section: 'Workspace' }, { key: 'teams', label: 'Teams', section: 'Workspace' }, { key: 'members', label: 'Members', section: 'Workspace' },
];
export function sidebarVisibility(snap: Snap, key: string): SidebarVisibility {
  return snap.workspace.preferences.sidebar.items[key] ?? SIDEBAR_DEFAULTS[key] ?? 'show';
}

const SIDEBAR_ICONS: Record<string, React.ReactNode> = {
  inbox: <IconInbox />, 'my-issues': <IconMyIssues />, drafts: <IconDrafts />, initiatives: <IconInitiative />, projects: <IconBox />, views: <IconViews />,
  releases: <IconRelease />, asks: <IconAsk />, pulse: <IconPulse />, customers: <IconCustomers />, teams: <IconTeam />, members: <IconMembers />,
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
  const off: Record<string, boolean> = { initiatives: !f.initiativesEnabled, releases: !f.releasesEnabled, pulse: !f.pulseEnabled, customers: !f.customerRequestsEnabled };
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
