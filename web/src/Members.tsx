// People in a hosted workspace: members and their access, pending invites, and who may join.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useApp, relTime, shortDate, copyText } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, Modal, useMenu } from './ui.js';
import { Avatar } from './pickers.js';
import { IconClose, IconCopy, IconMore, IconPlus, IconSearch, IconLink, IconTrash } from './icons.js';
import type { Invite, InviteResult, Team, User } from '../../src/core/types.js';

type Tab = 'all' | 'active' | 'invited' | 'suspended';

const refresh = () => useApp.getState().bootstrap();
/** two-line rows (name over email) need more than a property row's fixed height */
const ROW: React.CSSProperties = { gap: 10, height: 'auto', minHeight: 46, padding: '6px 0' };
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400_000));

/** a small toggleable team chip (invite dialog, security defaults) */
function TeamToggles(props: { teams: Team[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {props.teams.map(t => {
        const on = props.selected.includes(t.id);
        return (
          <button key={t.id} type="button" disabled={props.disabled} className={`seg seg-fill ${on ? 'selected' : ''}`}
            onClick={() => props.onChange(on ? props.selected.filter(x => x !== t.id) : [...props.selected, t.id])}>
            {t.name}
          </button>
        );
      })}
      {!props.teams.length && <span className="field-help">No teams yet.</span>}
    </div>
  );
}

export function HostedMembersSettings() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const me = snap.currentUser;
  const isAdmin = me.admin;
  const canInvite = isAdmin || snap.workspace.security.whoCanInvite === 'members';
  const [invites, setInvites] = useState<Invite[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);

  const loadInvites = useCallback(async () => {
    if (canInvite) setInvites((await api.listInvites()).invites);
  }, [canInvite]);
  useEffect(() => { void loadInvites(); }, [loadInvites]);

  /** run a change, then show the server's reason if it refused */
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      await refresh();
      await loadInvites();
      if (done) toast({ title: done });
    } catch (err) {
      toast({ title: (err as Error).message });
    }
  };

  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const people = snap.users.filter(u => u.kind === 'human' && match(`${u.name} ${u.email}`))
    .filter(u => tab === 'all' || (tab === 'active' && u.status === 'active') || (tab === 'suspended' && u.status === 'suspended'));
  const pending = tab === 'all' || tab === 'invited' ? invites.filter(i => match(i.email)) : [];
  const counts = {
    active: snap.users.filter(u => u.kind === 'human' && u.status === 'active').length,
    invited: invites.length,
    suspended: snap.users.filter(u => u.kind === 'human' && u.status === 'suspended').length,
  };

  return (
    <div className="settings-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ flex: 1 }}>Members</h1>
        {canInvite && <button className="btn primary" onClick={() => setInviting(true)}><IconPlus size={13} /> Invite</button>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
        <div className="set-filter" style={{ flex: 1, margin: 0 }}><IconSearch size={13} /><input placeholder="Search by name or email" value={q} onChange={e => setQ(e.target.value)} /></div>
        {([['all', 'All'], ['active', `Active ${counts.active}`], ...(canInvite ? [['invited', `Invited ${counts.invited}`]] : []), ['suspended', `Suspended ${counts.suspended}`]] as Array<[Tab, string]>).map(([k, label]) => (
          <button key={k} className={`seg seg-fill ${tab === k ? 'selected' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="card" style={{ padding: '4px 10px', marginBottom: 14 }}>
        {people.map(u => <MemberRow key={u.id} user={u} isAdmin={isAdmin} act={act} />)}
        {pending.map(i => <InviteRow key={i.id} invite={i} canManage={isAdmin || i.invitedBy === me.id} act={act} />)}
        {!people.length && !pending.length && <div className="prop-row" style={{ color: 'var(--text-dim)' }}>Nobody matches.</div>}
      </div>
      <div className="field-help">
        {snap.workspace.signInMethods?.includes('google')
          ? <>People join through an invite (choosing a password, or with Google), or by signing in with Google from an approved domain in <b>Security</b>.</>
          : <>People join through an invite link, where they choose a password.</>}
        {' '}Suspended people can't sign in; their issues and comments stay.
      </div>
      <AgentsSection />
      <AnimatePresence>{inviting && <InviteModal key="invite" onClose={() => setInviting(false)} onDone={async () => { await loadInvites(); }} />}</AnimatePresence>
    </div>
  );
}

function MemberRow(props: { user: User; isAdmin: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const snap = useApp(s => s.snap)!;
  const { user: u, act } = props;
  const menu = useMenu();
  const you = u.id === snap.currentUser.id;
  const teams = snap.teams.filter(t => t.memberIds.includes(u.id));
  const suspended = u.status === 'suspended';
  const [resetFor, setResetFor] = useState<User | null>(null);
  return (
    <div className="prop-row" style={{ ...ROW, opacity: suspended ? 0.6 : 1 }}>
      <AnimatePresence>{resetFor && <ResetLinkModal key="reset" user={resetFor} onClose={() => setResetFor(null)} />}</AnimatePresence>
      <Avatar user={u} size={24} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span>{u.name}{you && <span style={{ color: 'var(--text-dim)' }}> (you)</span>}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
      </span>
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 180, justifyContent: 'flex-end' }}>
        {teams.map(t => <span key={t.id} className="plabel-chip" title={t.name}>{t.key}</span>)}
      </span>
      <span style={{ width: 86, textAlign: 'right' }}>
        {suspended ? <span className="plabel-chip">Suspended</span> : <span className={`plabel-chip ${u.admin ? 'admin' : ''}`}>{u.admin ? 'Admin' : 'Member'}</span>}
      </span>
      <span style={{ width: 92, textAlign: 'right', color: 'var(--text-dim)', fontSize: 12 }} title={u.createdAt ? `Joined ${shortDate(u.createdAt)}` : undefined}>
        {u.lastSeenAt ? relTime(u.lastSeenAt) : 'Never signed in'}
      </span>
      {props.isAdmin
        ? <button className="icon-btn" style={{ width: 24, height: 24 }} title="Manage access" onClick={menu.open}><IconMore size={14} /></button>
        : <span style={{ width: 24 }} />}
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={230}>
          {!suspended && <MenuItem label={u.admin ? 'Make member' : 'Make admin'} onClick={() => void act(() => api.updateMember(u.id, { admin: !u.admin }), `${u.name} is now ${u.admin ? 'a member' : 'an admin'}`)} />}
          {snap.teams.length > 0 && <MenuSep />}
          {snap.teams.map((t, i) => {
            const on = t.memberIds.includes(u.id);
            return (
              <MenuItem key={t.id} sectionHeader={i === 0 ? 'Teams' : undefined} label={t.name} selected={on}
                onClick={() => void act(() => api.updateMember(u.id, { teamIds: on ? teams.filter(x => x.id !== t.id).map(x => x.id) : [...teams.map(x => x.id), t.id] }))} />
            );
          })}
          {!you && <MenuSep />}
          {!you && !suspended && <MenuItem icon={<IconLink size={14} />} label="Password reset link…" onClick={() => { menu.close(); setResetFor(u); }} />}
          {!you && (suspended
            ? <MenuItem label="Reactivate" onClick={() => void act(() => api.updateMember(u.id, { suspended: false }), `${u.name} can sign in again`)} />
            : <MenuItem label="Suspend…" danger onClick={() => {
                if (window.confirm(`Suspend ${u.name}? They'll be signed out and can't sign in until reactivated.`)) void act(() => api.updateMember(u.id, { suspended: true }), `${u.name} is suspended`);
              }} />)}
        </Menu>
      )}
    </div>
  );
}

function InviteRow(props: { invite: Invite; canManage: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const { invite: i, act } = props;
  const menu = useMenu();
  const by = snap.users.find(u => u.id === i.invitedBy);
  const teams = snap.teams.filter(t => i.teamIds.includes(t.id));
  return (
    <div className="prop-row" style={ROW}>
      <Avatar user={null} size={24} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span>{i.email}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          {i.expired ? 'Invite expired' : `Invited${by ? ` by ${by.name}` : ''} · expires in ${daysLeft(i.expiresAt)} day${daysLeft(i.expiresAt) === 1 ? '' : 's'}`}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 180, justifyContent: 'flex-end' }}>
        {teams.map(t => <span key={t.id} className="plabel-chip" title={t.name}>{t.key}</span>)}
      </span>
      <span style={{ width: 86, textAlign: 'right' }}><span className="plabel-chip">{i.expired ? 'Expired' : 'Invited'}</span></span>
      <span style={{ width: 92, textAlign: 'right', color: 'var(--text-dim)', fontSize: 12 }}>{i.admin ? 'as admin' : 'as member'}</span>
      {props.canManage
        ? <button className="icon-btn" style={{ width: 24, height: 24 }} title="Invite options" onClick={menu.open}><IconMore size={14} /></button>
        : <span style={{ width: 24 }} />}
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={210}>
          {!i.expired && <MenuItem icon={<IconLink size={14} />} label="Copy invite link" onClick={async () => toast({ title: await copyText(i.link) ? 'Invite link copied' : 'Couldn\'t copy the link' })} />}
          <MenuItem label={i.expired ? 'Renew and resend' : 'Resend invite'} onClick={() => void act(async () => {
            const r = await api.resendInvite(i.id);
            toast({ title: r.emailed === 'sent' ? `Invite sent to ${i.email}` : r.emailed === 'failed' ? `Couldn't email ${i.email}: ${r.error}` : 'Invite renewed — email isn\'t set up, so copy the link' });
          })} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} label="Revoke invite" danger onClick={() => void act(() => api.revokeInvite(i.id), `Invite to ${i.email} revoked`)} />
        </Menu>
      )}
    </div>
  );
}

function InviteModal(props: { onClose: () => void; onDone: () => Promise<void> }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const isAdmin = snap.currentUser.admin;
  const [emails, setEmails] = useState('');
  const [admin, setAdmin] = useState(false);
  const [teamIds, setTeamIds] = useState<string[]>(snap.teams.filter(t => t.memberIds.includes(snap.currentUser.id)).map(t => t.id).slice(0, 1));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(t); }, []);

  const send = async () => {
    if (!emails.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.createInvites({ emails, admin, teamIds });
      setResults(r.results);
      await props.onDone();
    } catch (err) {
      toast({ title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const describe = (r: InviteResult) =>
    r.status === 'invalid' ? 'Not an email address'
    : r.status === 'already-member' ? 'Already a member'
    : r.emailed === 'sent' ? 'Invite emailed'
    : r.emailed === 'failed' ? `Invited — the email failed (${r.error}), share the link`
    : 'Invited — email isn\'t set up on this server, share the link';

  return (
    <Modal onClose={props.onClose} className="modal modal-create cy-modal">
      <div className="cm-root" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !results) { e.preventDefault(); void send(); } }}>
        <div className="cm-header">
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Invite to {snap.workspace.name}</span>
          <span style={{ marginLeft: 'auto', display: 'flex' }}><button className="icon-btn" onClick={props.onClose}><IconClose size={14} /></button></span>
        </div>
        {!results ? (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="field-label">Email</div>
              <textarea ref={ref} className="text-input" rows={3} style={{ width: '100%', marginTop: 6, height: 'auto', padding: 8, resize: 'vertical' }}
                placeholder="name@acme.dev, another@acme.dev" value={emails} onChange={e => setEmails(e.target.value)} />
              <div className="field-help">{snap.workspace.signInMethods?.includes('google')
                ? 'They open the invite link and choose a password, or sign in with the Google account for that address.'
                : 'They open the invite link and choose a password.'}</div>
            </div>
            <div>
              <div className="field-label">Role</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className={`seg seg-fill ${!admin ? 'selected' : ''}`} onClick={() => setAdmin(false)}>Member</button>
                <button className={`seg seg-fill ${admin ? 'selected' : ''}`} disabled={!isAdmin} title={isAdmin ? undefined : 'Only admins can invite admins'} onClick={() => setAdmin(true)}>Admin</button>
              </div>
            </div>
            <div>
              <div className="field-label" style={{ marginBottom: 6 }}>Teams</div>
              <TeamToggles teams={snap.teams} selected={teamIds} onChange={setTeamIds} />
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {results.map(r => (
              <div key={r.email} className="prop-row" style={ROW}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div>{r.email}</div>
                  <div style={{ fontSize: 12, color: r.status === 'invited' && r.emailed !== 'failed' ? 'var(--text-dim)' : '#eb5757' }}>{describe(r)}</div>
                </span>
                {r.invite && <button className="btn" style={{ height: 24, fontSize: 12 }} onClick={async () => toast({ title: await copyText(r.invite!.link) ? 'Invite link copied' : 'Couldn\'t copy the link' })}><IconLink size={12} /> Copy link</button>}
              </div>
            ))}
            {results.some(r => r.invite && r.emailed !== 'sent') && (
              <div className="field-help">Send each person their link yourself — anyone with it can join as that address once they type it.</div>
            )}
            {results.filter(r => r.invite && r.emailed !== 'sent').map(r => <LinkBox key={`link-${r.email}`} label={r.email} link={r.invite!.link} />)}
          </div>
        )}
        <div className="cm-footer">
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {!results ? (
              <>
                <button className="btn" onClick={props.onClose}>Cancel</button>
                <button className="btn primary" disabled={busy || !emails.trim()} onClick={send}>{busy ? 'Sending…' : 'Send invites'}<span className="btn-kbd kbd">⌘↵</span></button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => { setResults(null); setEmails(''); }}>Invite more</button>
                <button className="btn primary" onClick={props.onClose}>Done</button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** agent identities stay hand-made: they're assigned work, they don't sign in */
function AgentsSection() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const [name, setName] = useState('');
  const agents = snap.users.filter(u => u.kind === 'agent');
  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.createUser({ name: name.trim(), kind: 'agent' });
      setName('');
      await refresh();
      toast({ title: 'Agent identity added' });
    } catch (err) { toast({ title: (err as Error).message }); }
  };
  return (
    <div style={{ marginTop: 22 }}>
      <div className="field-label">Agents</div>
      <div className="field-help">Coding agents write as Agent on behalf of the person who started them ("Agent via you"). Another agent user's writes land under its name with <code>--as "Name"</code>.</div>
      <div className="card" style={{ padding: '4px 10px', margin: '8px 0' }}>
        {agents.map(u => <div key={u.id} className="prop-row" style={{ gap: 10 }}><Avatar user={u} size={22} /><span>{u.name}</span></div>)}
      </div>
      {snap.currentUser.admin && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="text-input" placeholder="Agent name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button className="btn" onClick={add}>Add agent</button>
        </div>
      )}
    </div>
  );
}

export function SecuritySettings() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const sec = snap.workspace.security;
  const isAdmin = snap.currentUser.admin;
  const [domain, setDomain] = useState('');
  // joining by domain trusts Google's hd claim, so it only exists where Google sign-in does
  const google = !!snap.workspace.signInMethods?.includes('google');
  const save = async (patch: Parameters<typeof api.updateSecurity>[0], done?: string) => {
    try {
      await api.updateSecurity(patch);
      await refresh();
      if (done) toast({ title: done });
    } catch (err) { toast({ title: (err as Error).message }); }
  };
  const addDomain = async () => {
    const d = domain.trim().toLowerCase().replace(/^@/, '');
    if (!d) return;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) { toast({ title: `${d} isn't a domain` }); return; }
    setDomain('');
    await save({ approvedDomains: [...sec.approvedDomains, d] }, `Workspace accounts at ${d} can now join`);
  };
  return (
    <div className="settings-card">
      <h1>Security</h1>
      {!isAdmin && <div className="field-help" style={{ marginBottom: 12 }}>Only admins can change these settings.</div>}

      {google && <div className="field-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="field-label">Approved email domains</div>
          <div className="field-help">People whose Google Workspace account is at one of these domains join as members the first time they sign in — no invite needed. Personal Google accounts never qualify.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
          {sec.approvedDomains.map(d => (
            <div key={d} className="prop-row" style={{ gap: 8 }}>
              <span style={{ flex: 1 }}>@{d}</span>
              {isAdmin && <button className="icon-btn" style={{ width: 22, height: 22 }} title={`Remove ${d}`} onClick={() => void save({ approvedDomains: sec.approvedDomains.filter(x => x !== d) }, `${d} removed`)}><IconClose size={12} /></button>}
            </div>
          ))}
          {!sec.approvedDomains.length && <span className="field-help">No approved domains — only invited people can join.</span>}
          {isAdmin && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="text-input" placeholder="acme.dev" value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDomain()} />
              <button className="btn" onClick={addDomain}>Add</button>
            </div>
          )}
        </div>
      </div>}

      {google && sec.approvedDomains.length > 0 && (
        <div className="field-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="field-label">Teams for people who join by domain</div>
            <div className="field-help">They start on these teams; anyone can join other teams later.</div>
          </div>
          <TeamToggles teams={snap.teams} selected={sec.domainTeamIds} disabled={!isAdmin} onChange={ids => void save({ domainTeamIds: ids })} />
        </div>
      )}

      <div className="field-row">
        <div>
          <div className="field-label">Who can invite</div>
          <div className="field-help">Members can invite other members; only admins can invite admins.</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['admins', 'Admins only'], ['members', 'All members']] as const).map(([k, label]) => (
            <button key={k} className={`seg seg-fill ${sec.whoCanInvite === k ? 'selected' : ''}`} disabled={!isAdmin} onClick={() => void save({ whoCanInvite: k })}>{label}</button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <div>
          <div className="field-label">Sign-in method</div>
          <div className="field-help">{google ? 'Email and password, or Google.' : 'Email and password. Google sign-in is added by setting GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.'} Sessions last 30 days and renew while in use.</div>
        </div>
        <span style={{ display: 'flex', gap: 4 }}><span className="plabel-chip">Password</span>{google && <span className="plabel-chip">Google</span>}</span>
      </div>
    </div>
  );
}

/** a link to hand over by hand: visible and selectable, since copying can fail (plain http, no clipboard) */
function LinkBox({ label, link }: { label?: string; link: string }) {
  const toast = useApp(s => s.toast);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <div className="field-help" style={{ marginTop: 0 }}>{label}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="text-input mono" data-share-link readOnly value={link} style={{ flex: 1, minWidth: 0, fontSize: 12 }} onFocus={e => e.target.select()} />
        <button className="btn" onClick={async () => toast({ title: await copyText(link) ? 'Link copied' : 'Couldn\'t copy — select the link and copy it' })}><IconCopy size={13} /> Copy</button>
      </div>
    </div>
  );
}

/** an admin's one-use link that lets someone set a new password (they forgot it, or signed up with Google) */
function ResetLinkModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [state, setState] = useState<{ link: string; expiresAt: string } | { error: string } | null>(null);
  const make = async () => {
    try { setState(await api.passwordResetLink(user.id)); } catch (err) { setState({ error: (err as Error).message }); }
  };
  return (
    <Modal onClose={onClose} className="modal modal-create cy-modal">
      <div className="cm-root">
        <div className="cm-header">
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Password reset link for {user.name}</span>
          <span style={{ marginLeft: 'auto', display: 'flex' }}><button className="icon-btn" onClick={onClose}><IconClose size={14} /></button></span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!state && <div className="field-help" style={{ marginTop: 0 }}>
            {user.name} opens the link and chooses a new password. It works once, for 24 hours, and replaces any earlier link.
            Their other sessions are signed out when they use it. Send it to them privately.
          </div>}
          {state && 'link' in state && <>
            <LinkBox link={state.link} />
            <div className="field-help" style={{ marginTop: 0 }}>Works once, until {new Date(state.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. Anyone with it can sign in as {user.name}.</div>
          </>}
          {state && 'error' in state && <div className="field-help" style={{ color: '#eb5757', marginTop: 0 }}>{state.error}</div>}
        </div>
        <div className="cm-footer">
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {state && 'link' in state
              ? <button className="btn primary" onClick={onClose}>Done</button>
              : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => void make()}>Create link</button></>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
