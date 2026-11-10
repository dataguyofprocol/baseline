import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { useApp, relTime, shortDate, copyText, dateTime } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, Modal, useMenu, useCanConfigure, useCanLead } from './ui.js';
import { Avatar } from './pickers.js';
import { IconCheck, IconClose, IconCopy, IconMore, IconPlus, IconSearch, IconLink, IconTrash } from './icons.js';
import { isEmail, type Invite, type InviteEntry, type InviteResult, type Team, type TeamJoinLink, type User } from '../../src/core/types.js';

type Tab = 'all' | 'active' | 'invited' | 'suspended';

const refresh = () => useApp.getState().bootstrap();
const ROW: React.CSSProperties = { gap: 10, height: 'auto', minHeight: 46, padding: '6px 0' };
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400_000));

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
  const canInvite = snap.workspace.canInvite ?? (isAdmin || snap.workspace.security.whoCanInvite === 'members');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);

  const loadInvites = useCallback(async () => {
    if (canInvite) setInvites((await api.listInvites()).invites);
  }, [canInvite]);
  useEffect(() => { void loadInvites(); }, [loadInvites]);

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
      {canInvite && <JoinLinks />}
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
      <AnimatePresence>{inviting && <InviteModal key="invite" onClose={() => setInviting(false)} onDone={async () => { await refresh(); await loadInvites(); }} />}</AnimatePresence>
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
  const [githubFor, setGithubFor] = useState<User | null>(null);
  const canEditGithub = props.isAdmin || you;
  return (
    <div className="prop-row" style={{ ...ROW, opacity: suspended ? 0.6 : 1 }}>
      <AnimatePresence>
        {resetFor && <ResetLinkModal key="reset" user={resetFor} onClose={() => setResetFor(null)} />}
        {githubFor && <GithubUsernameModal key="gh" user={githubFor} onClose={() => setGithubFor(null)} />}
      </AnimatePresence>
      <Avatar user={u} size={24} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span>{u.name}{you && <span style={{ color: 'var(--text-dim)' }}> (you)</span>}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {u.email}
          {u.githubUsername ? <span title="GitHub username"> · @{u.githubUsername}</span>
            : canEditGithub && <> · <button className="link-btn" style={{ fontSize: 12 }} onClick={() => setGithubFor(u)}>Add GitHub username</button></>}
        </span>
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
      {canEditGithub
        ? <button className="icon-btn" style={{ width: 24, height: 24 }} title={props.isAdmin ? 'Manage access' : 'Your options'} aria-label={`Options for ${u.name}`} onClick={menu.open}><IconMore size={14} /></button>
        : <span style={{ width: 24 }} />}
      {menu.anchor && !props.isAdmin && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={230}>
          <MenuItem label="GitHub username…" onClick={() => { menu.close(); setGithubFor(u); }} />
        </Menu>
      )}
      {menu.anchor && props.isAdmin && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={230}>
          {u.kind === 'human' && <MenuItem label="GitHub username…" onClick={() => { menu.close(); setGithubFor(u); }} />}
          {!suspended && <MenuItem label={u.admin ? 'Make member' : 'Make admin'} confirm={you && u.admin ? 'Remove your own admin access?' : undefined} onClick={() => void act(() => api.updateMember(u.id, { admin: !u.admin }), `${u.name} is now ${u.admin ? 'a member' : 'an admin'}`)} />}
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
            : <MenuItem label="Suspend" danger confirm={`Suspend ${u.name.split(' ')[0]}? Signs them out`} onClick={() => void act(() => api.updateMember(u.id, { suspended: true }), `${u.name} is suspended`)} />)}
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
            toast({ title: r.emailed === 'sent' ? `Invite sent to ${i.email}` : r.emailed === 'failed' ? `Couldn't email ${i.email}: ${r.error}` : 'Invite renewed. Email isn\'t set up, so copy the link' });
          })} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} label="Revoke invite" danger confirm="Revoke invite?" onClick={() => void act(() => api.revokeInvite(i.id), `Invite to ${i.email} revoked`)} />
        </Menu>
      )}
    </div>
  );
}

export function InviteModal(props: { onClose: () => void; onDone: () => Promise<void>; teamIds?: string[] }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const isAdmin = snap.currentUser.admin;
  const [entries, setEntries] = useState<InviteEntry[]>([]);
  const [text, setText] = useState('');
  const [admin, setAdmin] = useState(false);
  const [teamIds, setTeamIds] = useState<string[]>(props.teamIds ?? snap.teams.filter(t => t.memberIds.includes(snap.currentUser.id)).map(t => t.id).slice(0, 1));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [tab, setTab] = useState<'email' | 'link'>('email');

  const people = snap.users.filter(u => u.kind === 'human' && u.status === 'active');
  const byEmail = (email: string) => people.find(u => u.email.toLowerCase() === email.toLowerCase());
  const toEntries = (raw: string, into: InviteEntry[]): { entries: InviteEntry[]; rest: string } => {
    const next = [...into];
    const rest: string[] = [];
    for (const token of raw.split(/[\s,;]+/).filter(Boolean)) {
      if (!isEmail(token)) { rest.push(token); continue; }
      const u = byEmail(token);
      const entry: InviteEntry = u ? { kind: 'member', userId: u.id } : { kind: 'email', email: token.toLowerCase() };
      if (!next.some(e => sameEntry(e, entry))) next.push(entry);
    }
    return { entries: next, rest: rest.join(' ') };
  };
  const commit = (raw: string) => {
    const r = toEntries(raw, entries);
    setEntries(r.entries);
    setText(r.rest);
  };

  const pending = toEntries(text, entries).entries;
  const sendable = pending.some(e => e.kind === 'email') || (teamIds.length > 0 && pending.length > 0);
  const send = async () => {
    if (!sendable || busy) return;
    setEntries(pending);
    setText('');
    setBusy(true);
    try {
      const r = await api.createInvites({
        userIds: pending.flatMap(e => e.kind === 'member' ? [e.userId] : []),
        emails: pending.flatMap(e => e.kind === 'email' ? [e.email] : []),
        admin, teamIds,
      });
      setResults(r.results);
      await props.onDone();
    } catch (err) {
      toast({ title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const teamNames = (ids: string[] = []) => ids.map(id => snap.teams.find(t => t.id === id)?.name).filter(Boolean).join(', ');
  const describe = (r: InviteResult) =>
    r.status === 'invalid' ? r.error ?? 'Not an email address'
    : r.status === 'added-to-teams' ? `Added to ${teamNames(r.teamIds)}`
    : r.status === 'already-on-teams' ? `Already on ${teamNames(r.teamIds)}`
    : r.status === 'already-in-workspace' ? 'Already in the workspace'
    : r.emailed === 'sent' ? 'Invite emailed'
    : r.emailed === 'failed' ? `Invited, but the email failed (${r.error}). Share the link`
    : 'Invited. Email isn\'t set up on this server, so share the link';
  const onlyPeople = pending.length > 0 && pending.every(e => e.kind === 'member');
  const mail = !!snap.workspace.mail;
  const shareable = results?.filter(r => r.invite && r.emailed !== 'sent') ?? [];
  const allLinks = shareable.map(r => `${r.email}: ${r.invite!.link}`).join('\n');

  const chosenTeams = snap.teams.filter(t => teamIds.includes(t.id));
  const teamLine = chosenTeams.length ? listNames(chosenTeams.map(t => t.name)) : snap.workspace.name;
  const firstName = snap.currentUser.name.split(' ')[0];
  const sentCount = results?.filter(r => r.invite).length ?? 0;
  const addedCount = results?.filter(r => r.status === 'added-to-teams').length ?? 0;

  return (
    <Modal onClose={props.onClose} className="modal inv-modal">
      <div className="inv" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !results && tab === 'email') { e.preventDefault(); void send(); } }}>
        {!results ? (
          <div className="inv-cols">
            <div className="inv-main">
              <div className="inv-head">
                <div>
                  <h2>Bring your people into {snap.workspace.name}</h2>
                  <p>Baseline is better with the people you ship with. They'll start right next to you.</p>
                </div>
                <button className="icon-btn" title="Close" aria-label="Close" onClick={props.onClose}><IconClose size={14} /></button>
              </div>
              <div className="inv-tabs" role="tablist" aria-label="How to invite">
                <button role="tab" aria-selected={tab === 'email'} className={tab === 'email' ? 'on' : undefined} onClick={() => setTab('email')}>By email</button>
                <button role="tab" aria-selected={tab === 'link'} className={tab === 'link' ? 'on' : undefined} onClick={() => setTab('link')}>Share a link</button>
              </div>
              {tab === 'email' ? (
                <div className="inv-form">
                  <div>
                    <div className="inv-label">People</div>
                    <PeopleField people={people} teams={chosenTeams} entries={entries} text={text}
                      onText={setText} onEntries={setEntries} onCommit={commit} />
                    <div className="field-help">
                      {onlyPeople && !teamIds.length ? 'They\'re already in the workspace. Choose a team to add them to.'
                        : `Paste a list or a whole email thread. People already here are added to the teams below; new addresses get an invite${mail ? ' by email' : ' link to send yourself, since email isn\'t set up on this server'}.`}
                    </div>
                  </div>
                  <div>
                    <div className="inv-label">Teams they join</div>
                    <TeamToggles teams={snap.teams} selected={teamIds} onChange={setTeamIds} />
                  </div>
                  <div>
                    <div className="inv-label">Access</div>
                    <div className="inv-role">
                      <div className="inv-seg" role="radiogroup" aria-label="Access">
                        <button role="radio" aria-checked={!admin} className={!admin ? 'on' : undefined} onClick={() => setAdmin(false)}>Member</button>
                        <button role="radio" aria-checked={admin} className={admin ? 'on' : undefined} disabled={!isAdmin} title={isAdmin ? 'For new people; it doesn\'t change anyone already here' : 'Only admins can invite admins'} onClick={() => setAdmin(true)}>Admin</button>
                      </div>
                      <span className="field-help" style={{ margin: 0 }}>{admin ? 'Can also change settings, members and GitHub.' : 'Can create, assign and move issues, and connect an agent.'}</span>
                    </div>
                  </div>
                </div>
              ) : <InviteLinkTab teams={chosenTeams.length ? chosenTeams : snap.teams.slice(0, 1)} />}
              <div className="inv-foot">
                <span className="field-help" style={{ margin: 0 }}>{tab === 'email' ? (chosenTeams.length ? `Joining ${teamLine}` : 'Pick a team for people already here') : 'Anyone with the link lands on that team'}</span>
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={props.onClose}>Cancel</button>
                {tab === 'email' && (
                  <button className="btn primary" disabled={busy || !sendable} onClick={send}>
                    {busy ? (mail ? 'Sending…' : 'Creating…') : onlyPeople ? 'Add to team' + (teamIds.length === 1 ? '' : 's') : mail ? (pending.length > 1 ? `Send ${pending.length} invites` : 'Send invite') : 'Create invite links'}<span className="btn-kbd kbd">⌘↵</span>
                  </button>
                )}
              </div>
            </div>
            <aside className="inv-preview" aria-label="What they'll get">
              <div className="inv-label">What they'll get</div>
              <div className={`inv-mail${busy ? ' flying' : ''}`}>
                <div className="inv-mail-from"><span className="inv-mail-logo">{snap.workspace.name[0]?.toUpperCase()}</span>Baseline</div>
                <div className="inv-mail-title">{firstName} invited you to work on {teamLine} at {snap.workspace.name}</div>
                <div className="inv-mail-line">Join to see the team's issues and connect your own coding agent.</div>
                <span className="inv-mail-btn">Join {snap.workspace.name}</span>
              </div>
              <div className="field-help">When they join, they get their own short setup, and their agent's work shows under their name.</div>
            </aside>
          </div>
        ) : (
          <div className="inv-sent">
            <div className="inv-sent-head">
              <svg className="inv-pop" width="30" height="30" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6.5" fill="var(--brand)" /><path d="M4.3 7.2l1.8 1.8 3.6-3.9" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <div>
                <h2>{sentCount > 0 ? (mail ? `${sentCount} invite${sentCount === 1 ? ' is' : 's are'} on the way` : `${sentCount} invite link${sentCount === 1 ? ' is' : 's are'} ready to share`) : addedCount > 0 ? `${addedCount} ${addedCount === 1 ? 'person' : 'people'} added` : 'Nothing new to send'}</h2>
                <p className="field-help" style={{ margin: 0 }}>{mail ? 'They\'ll show up in Members the moment they join.' : 'Send each person their link. They\'ll show up in Members when they join.'}</p>
              </div>
              <button className="icon-btn" title="Close" aria-label="Close" onClick={props.onClose} style={{ marginLeft: 'auto' }}><IconClose size={14} /></button>
            </div>
            <div className="inv-results">
              {results.map((r, i) => {
                const u = r.userId ? snap.users.find(x => x.id === r.userId) : undefined;
                const bad = r.status === 'invalid' || r.emailed === 'failed';
                return (
                  <div key={r.userId ?? r.email} className="inv-result" style={{ ['--i' as string]: i }} data-invite-result={r.status}>
                    <Avatar user={u ?? null} size={24} />
                    <span className="inv-result-name">{u?.name ?? r.email}</span>
                    <span className={`inv-result-status${bad ? ' bad' : ''}`}>{describe(r)}</span>
                    {r.invite && <button className="btn" style={{ height: 24, fontSize: 12 }} onClick={async () => toast({ title: await copyText(r.invite!.link) ? 'Invite link copied' : 'Couldn\'t copy the link' })}><IconLink size={12} /> Copy link</button>}
                  </div>
                );
              })}
            </div>
            {shareable.length > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="field-help">Or copy them all into one message. A link only lets in the address it was made for.</div>
                <textarea className="text-input mono" data-share-all readOnly rows={Math.min(6, shareable.length)} value={allLinks} style={{ fontSize: 12, height: 'auto', resize: 'none', padding: '6px 8px' }} onFocus={e => e.target.select()} />
                <div><button className="btn" onClick={async () => toast({ title: await copyText(allLinks) ? `${shareable.length} invite links copied` : 'Couldn\'t copy. Select the links and copy them' })}><IconCopy size={13} /> Copy all</button></div>
              </div>
            )}
            {sentCount > 0 && (
              <div>
                <div className="inv-label">What happens next</div>
                <ol className="inv-next">
                  <li style={{ ['--i' as string]: 0 }}><span>01</span><b>They open the invite</b><em>They choose a password{snap.workspace.signInMethods?.includes('google') ? ' or use Google' : ''}, and they're in.</em></li>
                  <li style={{ ['--i' as string]: 1 }}><span>02</span><b>They land on {chosenTeams[0]?.name ?? 'your team'}</b><em>With its issues and their own short setup.</em></li>
                  <li style={{ ['--i' as string]: 2 }}><span>03</span><b>Give them something</b><em>Assign an issue the minute they show up in Members.</em></li>
                </ol>
              </div>
            )}
            <div className="inv-foot">
              <button className="btn" onClick={() => { setResults(null); setEntries([]); setText(''); }}>Invite more</button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" onClick={props.onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

const listNames = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

function InviteLinkTab({ teams }: { teams: Team[] }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const isAdmin = snap.currentUser.admin;
  const [links, setLinks] = useState<Record<string, TeamJoinLink | null> | null>(null);
  const ids = teams.map(t => t.id).join();
  const load = useCallback(async () => {
    const got = await Promise.all(teams.map(async t => [t.id, (await api.teamJoinLink(t.id).catch(() => ({ joinLink: null }))).joinLink] as const));
    setLinks(Object.fromEntries(got));
  }, [ids]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (err) { toast({ title: (err as Error).message }); } };
  return (
    <div className="inv-form">
      <p className="field-help" style={{ margin: 0 }}>For Slack, a team chat, or when email isn't set up. Anyone who opens it can make an account and lands on that team.</p>
      {!links ? <div className="field-help">Loading…</div> : teams.map(t => {
        const l = links[t.id];
        return (
          <div key={t.id} className="inv-link" data-join-team={t.key}>
            <div className="inv-label">{t.name}</div>
            {l ? (
              <div className="inv-link-row">
                <input className="text-input mono" readOnly value={l.link} onFocus={e => e.target.select()} aria-label={`${t.name} join link`} />
                <button className="btn primary" onClick={async () => toast({ title: await copyText(l.link) ? `${t.name} join link copied` : 'Couldn\'t copy. Select the link and copy it' })}><IconCopy size={12} /> Copy link</button>
              </div>
            ) : isAdmin ? (
              <div className="inv-link-row"><span className="field-help" style={{ margin: 0, flex: 1 }}>No join link yet.</span><button className="btn" onClick={() => void run(() => api.createTeamJoinLink(t.id))}><IconLink size={12} /> Create link</button></div>
            ) : <span className="field-help" style={{ margin: 0 }}>No join link yet. An admin can make one.</span>}
            {l && isAdmin && <button className="inv-text-btn" onClick={() => void run(() => api.revokeTeamJoinLink(t.id))}>Shared it somewhere you shouldn't have? Turn it off</button>}
          </div>
        );
      })}
    </div>
  );
}

const sameEntry = (a: InviteEntry, b: InviteEntry) =>
  a.kind === 'member' ? b.kind === 'member' && a.userId === b.userId : b.kind === 'email' && a.email === b.email;

function PeopleField(props: {
  people: User[]; teams: Team[]; entries: InviteEntry[]; text: string;
  onText: (s: string) => void; onEntries: (e: InviteEntry[]) => void; onCommit: (raw: string) => void;
}) {
  const { people, teams, entries, text } = props;
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [hl, setHl] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 30); return () => clearTimeout(t); }, []);

  const q = text.trim().toLowerCase();
  const picked = new Set(entries.flatMap(e => e.kind === 'member' ? [e.userId] : []));
  const typedEmail = isEmail(q) && !people.some(u => u.email.toLowerCase() === q) && !entries.some(e => e.kind === 'email' && e.email === q) ? q : null;
  type Option = { kind: 'member'; user: User; on: Team[]; disabled: boolean } | { kind: 'email'; email: string };
  const options: Option[] = !q ? [] : [
    ...people.filter(u => !picked.has(u.id) && `${u.name} ${u.email}`.toLowerCase().includes(q)).slice(0, 8).map(u => {
      const on = teams.filter(t => t.memberIds.includes(u.id));
      return { kind: 'member' as const, user: u, on, disabled: teams.length > 0 && on.length === teams.length };
    }),
    ...(typedEmail ? [{ kind: 'email' as const, email: typedEmail }] : []),
  ];
  const selectable = options.flatMap((o, i) => o.kind === 'email' || !o.disabled ? [i] : []);
  const [dismissed, setDismissed] = useState(false);
  const open = focused && !dismissed && options.length > 0;
  const active = selectable.includes(hl) ? hl : selectable[0] ?? -1;

  useLayoutEffect(() => { if (open) setRect(fieldRef.current!.getBoundingClientRect()); }, [open, entries.length, text]);
  useEffect(() => { setHl(0); setDismissed(false); }, [q]);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && openRef.current) { e.stopImmediatePropagation(); setDismissed(true); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const choose = (o: Option) => {
    if (o.kind === 'email') props.onCommit(o.email);
    else if (!o.disabled) { props.onEntries([...entries, { kind: 'member', userId: o.user.id }]); props.onText(''); }
    inputRef.current?.focus();
  };
  const move = (by: number) => {
    if (!selectable.length) return;
    const at = selectable.indexOf(active);
    setHl(selectable[(at + by + selectable.length) % selectable.length]!);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (open) { if (active >= 0) choose(options[active]!); }
      else props.onCommit(text);
    } else if (e.key === ',' || e.key === ';') { e.preventDefault(); props.onCommit(text); }
    else if (e.key === 'Backspace' && !text && entries.length) props.onEntries(entries.slice(0, -1));
  };

  return (
    <>
      <div ref={fieldRef} className="text-input invite-field" onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}>
        {entries.map(e => {
          const u = e.kind === 'member' ? people.find(x => x.id === e.userId) : undefined;
          const label = u?.name ?? (e.kind === 'email' ? e.email : 'Someone');
          return (
            <span key={e.kind === 'member' ? e.userId : e.email} className="invite-chip" title={u?.email}>
              <Avatar user={u ?? null} size={16} />
              <span className="chip-label">{label}</span>
              <button type="button" className="chip-x" aria-label={`Remove ${label}`} onClick={() => props.onEntries(entries.filter(x => x !== e))}><IconClose size={10} /></button>
            </span>
          );
        })}
        <input ref={inputRef} value={text} placeholder={entries.length ? '' : 'Name or email'} aria-label="Name or email"
          onChange={e => props.onText(e.target.value)} onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (text.trim()) props.onCommit(text); }}
          onPaste={e => {
            const pasted = e.clipboardData.getData('text');
            if (!/[\s,;]/.test(pasted.trim()) && !isEmail(pasted.trim())) return;
            e.preventDefault();
            props.onCommit(`${text} ${pasted}`);
          }} />
      </div>
      {open && rect && createPortal(
        <div className="menu invite-options" role="listbox" style={{ top: rect.bottom + 4, left: rect.left, width: rect.width }}
          onMouseDown={e => e.preventDefault()}>
          {options.map((o, i) => o.kind === 'member' ? (
            <button key={o.user.id} type="button" role="option" aria-selected={i === active} aria-disabled={o.disabled}
              className={`menu-item${i === active ? ' highlighted' : ''}${o.disabled ? ' disabled' : ''}`}
              onMouseMove={() => { if (!o.disabled) setHl(i); }} onClick={() => choose(o)}>
              <Avatar user={o.user} size={18} />
              <span className="mi-label">{o.user.name}<span className="mi-hint">{o.user.email}</span></span>
              <span className="mi-right invite-on">{o.on.length ? `On ${o.on.map(t => t.name).join(', ')}` : !teams.length ? 'In workspace' : ''}</span>
            </button>
          ) : (
            <button key="email" type="button" role="option" aria-selected={i === active}
              className={`menu-item${i === active ? ' highlighted' : ''}`} onMouseMove={() => setHl(i)} onClick={() => choose(o)}>
              <Avatar user={null} size={18} />
              <span className="mi-label">Invite {o.email}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function TeamMembersSettings(props: { team: Team }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const { team } = props;
  const me = snap.currentUser;
  const admin = useCanConfigure();
  const lead = useCanLead(team.id);
  const onTeam = team.memberIds.includes(me.id);
  const canAdd = admin || onTeam;
  const canInvite = snap.workspace.auth === 'hosted' && (snap.workspace.canInvite ?? (me.admin || snap.workspace.security.whoCanInvite === 'members'));
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const members = team.memberIds.map(id => snap.users.find(u => u.id === id)).filter((u): u is User => !!u && u.kind === 'human');
  const shown = members.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); await refresh(); toast({ title: done }); } catch (err) { toast({ title: (err as Error).message }); }
  };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ flex: 1 }}>Members</h1>
        {!onTeam && <button className="btn" onClick={() => void act(() => api.joinTeam(team.id), `You joined ${team.name}`)}>Join team</button>}
        {canAdd && <button className="btn primary" onClick={() => setAdding(true)}><IconPlus size={13} /> Add members</button>}
      </div>
      <div className="field-help" style={{ marginBottom: 8 }}>{members.length} member{members.length === 1 ? '' : 's'}. Anyone in the workspace can join {team.name}.</div>
      <div className="set-filter" style={{ margin: '4px 0 10px' }}><IconSearch size={13} /><input placeholder="Search by name or email" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="card" style={{ padding: '4px 10px', marginBottom: 14 }}>
        {shown.map(u => <TeamMemberRow key={u.id} team={team} user={u} canRemove={lead} act={act} />)}
        {!shown.length && <div className="prop-row" style={{ color: 'var(--text-dim)' }}>{members.length ? 'Nobody matches.' : 'Nobody is on this team yet.'}</div>}
      </div>
      <div className="field-help">Agents can work in every team: they're assigned issues, not added to teams.</div>
      <AnimatePresence>
        {adding && <AddTeamMembersModal key="add" team={team} onClose={() => setAdding(false)}
          onInvite={canInvite ? () => { setAdding(false); setInviting(true); } : undefined} />}
        {inviting && <InviteModal key="invite" teamIds={[team.id]} onClose={() => setInviting(false)} onDone={refresh} />}
      </AnimatePresence>
    </>
  );
}

function TeamMemberRow(props: { team: Team; user: User; canRemove: boolean; act: (fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  const snap = useApp(s => s.snap)!;
  const { team, user: u, act } = props;
  const menu = useMenu();
  const you = u.id === snap.currentUser.id;
  return (
    <div className="prop-row" style={{ ...ROW, opacity: u.status === 'suspended' ? 0.6 : 1 }}>
      <Avatar user={u} size={24} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span>{u.name}{you && <span style={{ color: 'var(--text-dim)' }}> (you)</span>}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
      </span>
      <span style={{ width: 86, textAlign: 'right' }}>
        {u.status === 'suspended' ? <span className="plabel-chip">Suspended</span> : <span className={`plabel-chip ${u.admin || team.leadIds.includes(u.id) ? 'admin' : ''}`}>{team.leadIds.includes(u.id) ? 'Lead' : u.admin ? 'Workspace admin' : 'Member'}</span>}
      </span>
      {you || props.canRemove
        ? <button className="icon-btn" style={{ width: 24, height: 24 }} title="Member options" aria-label={`Options for ${u.name}`} onClick={menu.open}><IconMore size={14} /></button>
        : <span style={{ width: 24 }} />}
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={210}>
          {you
            ? <MenuItem label="Leave team" danger onClick={() => void act(() => api.leaveTeam(team.id), `You left ${team.name}`)} />
            : <MenuItem icon={<IconTrash size={14} />} label="Remove from team" danger confirm="Remove from team?" onClick={() => void act(() => api.removeTeamMember(team.id, u.id), `${u.name} removed from ${team.name}`)} />}
        </Menu>
      )}
    </div>
  );
}

function AddTeamMembersModal(props: { team: Team; onClose: () => void; onInvite?: () => void }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const { team } = props;
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(t); }, []);
  const candidates = snap.users.filter(u => u.kind === 'human' && u.status === 'active' && !team.memberIds.includes(u.id));
  const shown = candidates.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  const add = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      const r = await api.addTeamMembers(team.id, picked);
      await refresh();
      toast({ title: `${r.added.length} member${r.added.length === 1 ? '' : 's'} added to ${team.name}` });
      props.onClose();
    } catch (err) {
      toast({ title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={props.onClose} className="modal modal-create cy-modal">
      <div className="cm-root" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void add(); } }}>
        <div className="cm-header">
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Add members to {team.name}</span>
          <span style={{ marginLeft: 'auto', display: 'flex' }}><button className="icon-btn" title="Close" aria-label="Close" onClick={props.onClose}><IconClose size={14} /></button></span>
        </div>
        <div style={{ padding: '8px 16px 12px', display: 'flex', flexDirection: 'column' }}>
          <div className="set-filter"><IconSearch size={13} /><input ref={ref} placeholder="Search people in the workspace" value={q} onChange={e => setQ(e.target.value)} /></div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {shown.map(u => {
              const on = picked.includes(u.id);
              return (
                <button key={u.id} type="button" className="prop-row" aria-pressed={on}
                  style={{ ...ROW, width: '100%', background: 'transparent', border: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => setPicked(on ? picked.filter(x => x !== u.id) : [...picked, u.id])}>
                  <span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span>
                  <Avatar user={u} size={22} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                    <span>{u.name}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
                  </span>
                </button>
              );
            })}
            {!shown.length && <div className="field-help">{candidates.length ? 'Nobody matches.' : `Everyone in the workspace is on ${team.name}.`}</div>}
          </div>
        </div>
        <div className="cm-footer">
          {props.onInvite && <button className="btn ghost" onClick={props.onInvite}><IconLink size={13} /> Invite by email…</button>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={props.onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || !picked.length} onClick={add}>
              {busy ? 'Adding…' : picked.length ? `Add ${picked.length} member${picked.length === 1 ? '' : 's'}` : 'Add members'}<span className="btn-kbd kbd">⌘↵</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

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
      <div className="field-help">Each coding tool writes as its own agent user on behalf of the person running it, so its changes read "Claude Code via you". The user is made the first time that tool connects.</div>
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
          <div className="field-help">People whose Google Workspace account is at one of these domains join as members the first time they sign in, with no invite needed. Personal Google accounts never qualify.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 260, flex: 'none' }}>
          {sec.approvedDomains.map(d => (
            <div key={d} className="prop-row" style={{ gap: 8 }}>
              <span style={{ flex: 1 }}>@{d}</span>
              {isAdmin && <button className="icon-btn" style={{ width: 22, height: 22 }} title={`Remove ${d}`} onClick={() => void save({ approvedDomains: sec.approvedDomains.filter(x => x !== d) }, `${d} removed`)}><IconClose size={12} /></button>}
            </div>
          ))}
          {!sec.approvedDomains.length && <span className="field-help">No approved domains, so only invited people can join.</span>}
          {isAdmin && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="text-input" style={{ flex: 1, minWidth: 0 }} placeholder="acme.dev" value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDomain()} />
              <button className="btn" style={{ flex: 'none' }} onClick={addDomain}>Add</button>
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
      {sec.whoCanInvite === 'admins' && (
        <div className="field-row">
          <div>
            <div className="field-label">Members invite while the workspace is small</div>
            <div className="field-help">Under 10 people, anyone can bring in the next teammate. Admins only after that.</div>
          </div>
          <button className={`switch${sec.smallTeamInvites ? ' on' : ''}`} role="switch" aria-checked={sec.smallTeamInvites} aria-label="Members invite while the workspace is small" disabled={!isAdmin} onClick={() => void save({ smallTeamInvites: !sec.smallTeamInvites })}><span /></button>
        </div>
      )}

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

function JoinLinks() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const isAdmin = snap.currentUser.admin;
  const [links, setLinks] = useState<Record<string, TeamJoinLink | null>>({});
  const load = useCallback(async () => {
    const got = await Promise.all(snap.teams.map(async t => [t.id, (await api.teamJoinLink(t.id).catch(() => ({ joinLink: null }))).joinLink] as const));
    setLinks(Object.fromEntries(got));
  }, [snap.teams.map(t => t.id).join()]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); await load(); toast({ title: done }); } catch (err) { toast({ title: (err as Error).message }); }
  };
  const teams = snap.teams.filter(t => isAdmin || links[t.id]);
  if (!teams.length) return null;
  return (
    <div style={{ margin: '4px 0 14px' }}>
      <div className="field-label">Team join links</div>
      <div className="field-help" style={{ marginBottom: 6 }}>Paste one where your team talks: anyone who opens it can make an account and lands on that team. Turning a link off stops it working.</div>
      <div className="card" style={{ padding: '4px 10px' }}>
        {teams.map(t => {
          const l = links[t.id];
          return (
            <div key={t.id} className="prop-row" style={{ gap: 8 }} data-join-team={t.key}>
              <span style={{ width: 120, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              {l ? <>
                <input className="text-input mono" readOnly value={l.link} style={{ flex: 1, minWidth: 0, fontSize: 12, height: 26 }} onFocus={e => e.target.select()} aria-label={`${t.name} join link`} />
                <button className="btn" style={{ height: 26 }} onClick={async () => toast({ title: await copyText(l.link) ? `${t.name} join link copied` : 'Couldn\'t copy. Select the link and copy it' })}><IconCopy size={12} /> Copy</button>
                {isAdmin && <button className="btn ghost" style={{ height: 26 }} onClick={() => void run(() => api.revokeTeamJoinLink(t.id), `${t.name}'s join link is off`)}>Turn off</button>}
              </> : <>
                <span style={{ flex: 1, color: 'var(--text-dim)', fontSize: 12 }}>No join link</span>
                <button className="btn" style={{ height: 26 }} onClick={() => void run(() => api.createTeamJoinLink(t.id), `${t.name} join link created`)}><IconLink size={12} /> Create link</button>
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GithubUsernameModal({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useApp(s => s.toast);
  const [value, setValue] = useState(user.githubUsername ?? '');
  const [error, setError] = useState('');
  const [authors, setAuthors] = useState<string[]>([]);
  useEffect(() => {
    void fetch('/api/github/authors').then(r => r.ok ? r.json() : null).then((b: { authors?: Array<{ login: string; prs?: number; userId?: string | null; suggestedUserId?: string | null }> } | Array<{ login: string; userId?: string | null; suggestedUserId?: string | null }> | null) => {
      const list = Array.isArray(b) ? b : b?.authors ?? [];
      const open = list.filter(a => !a.userId);
      setAuthors([...open.filter(a => a.suggestedUserId === user.id), ...open.filter(a => a.suggestedUserId !== user.id)].map(a => a.login).slice(0, 5));
    }).catch(() => {});
  }, [user.id]);
  const save = async () => {
    try {
      await api.updateUser(user.id, { githubUsername: value.trim().replace(/^@/, '') });
      await refresh();
      toast({ title: value.trim() ? `${user.name}'s GitHub username is ${value.trim().replace(/^@/, '')}` : `${user.name}'s GitHub username was removed` });
      onClose();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Modal onClose={onClose} className="modal modal-create cy-modal">
      <div className="cm-root">
        <div className="cm-header">
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>GitHub username for {user.name}</span>
          <span style={{ marginLeft: 'auto', display: 'flex' }}><button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}><IconClose size={14} /></button></span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="text-input mono" aria-label="GitHub username" autoFocus placeholder="octocat" spellCheck={false} value={value}
            onChange={e => setValue(e.target.value.replace(/\s+/g, ''))} onKeyDown={e => { if (e.key === 'Enter') void save(); }} />
          {authors.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span className="field-help" style={{ marginTop: 0 }}>From pull requests:</span>
              {authors.map(a => <button key={a} type="button" className={`seg seg-fill ${value === a ? 'selected' : ''}`} onClick={() => setValue(a)}>{a}</button>)}
            </div>
          )}
          <div className="field-help" style={{ marginTop: 0, color: error ? 'var(--danger)' : undefined }}>{error || 'Pull requests by this login are attributed to them, and an unassigned issue their PR closes is assigned to them.'}</div>
        </div>
        <div className="cm-footer">
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={() => void save()}>Save</button>
          </div>
        </div>
      </div>
    </Modal>
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
        <button className="btn" onClick={async () => toast({ title: await copyText(link) ? 'Link copied' : 'Couldn\'t copy. Select the link and copy it' })}><IconCopy size={13} /> Copy</button>
      </div>
    </div>
  );
}

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
          <span style={{ marginLeft: 'auto', display: 'flex' }}><button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}><IconClose size={14} /></button></span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!state && <div className="field-help" style={{ marginTop: 0 }}>
            {user.name} opens the link and chooses a new password. It works once, for 24 hours, and replaces any earlier link.
            Their other sessions are signed out when they use it. Send it to them privately.
          </div>}
          {state && 'link' in state && <>
            <LinkBox link={state.link} />
            <div className="field-help" style={{ marginTop: 0 }}>Works once, until {dateTime(state.expiresAt)}. Anyone with it can sign in as {user.name}.</div>
          </>}
          {state && 'error' in state && <div className="field-help" style={{ color: 'var(--danger)', marginTop: 0 }}>{state.error}</div>}
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
