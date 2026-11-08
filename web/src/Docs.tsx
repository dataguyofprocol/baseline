import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, relTime, copyText } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, useMenu, RegisterMark, useCanConfigure, ADMIN_NOTE } from './ui.js';
import { Markdown } from './Markdown.js';
import { RichEditor } from './RichEditor.js';
import { Avatar, teamDisplayIcon } from './pickers.js';
import { AvatarStack } from './AvatarStack.js';
import { TeamMissingRedirect } from './Views.js';
import { CustomerRequests } from './Workspace.js';
import { IconDoc, IconLink, IconPlus, IconClose, IconTrash, IconSettings, IconTriage, IconIssues, IconCycle, IconBox, IconViews } from './icons.js';
import type { Doc } from '../../src/core/types.js';

/* Documents: markdown pages (edited as rich text) that belong to a project or a team, such as
   specs, briefs and runbooks. They show up as resources next to links. */

export async function newDoc(owner: { projectId?: string; teamId?: string; initiativeId?: string }, navigate: (to: string) => void, template?: { title: string; content: string }) {
  const { doc } = await api.createDoc({ ...owner, title: template?.title ?? '', content: template?.content ?? '' });
  await useApp.getState().bootstrap();
  navigate(`/docs/${doc.id}`);
}

/** Resources: documents and links on a project, team or initiative, with "Add document or link" */
export function Resources(props: { projectId?: string; teamId?: string; initiativeId?: string; label?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const menu = useMenu();
  const [linking, setLinking] = useState<DOMRect | null>(null);
  const owner = props.projectId ? { projectId: props.projectId } : props.initiativeId ? { initiativeId: props.initiativeId } : { teamId: props.teamId };
  const docs = snap.docs.filter(d => (props.projectId && d.projectId === props.projectId) || (props.teamId && d.teamId === props.teamId) || (props.initiativeId && d.initiativeId === props.initiativeId));
  const links = props.projectId ? snap.projectLinks.filter(l => l.projectId === props.projectId)
    : props.initiativeId ? snap.initiativeLinks.filter(l => l.initiativeId === props.initiativeId) : snap.teamLinks.filter(l => l.teamId === props.teamId);
  const removeLink = async (id: string) => {
    if (props.projectId) await api.deleteProjectLink(id); else if (props.initiativeId) await api.deleteInitiativeLink(id); else await api.deleteTeamLink(id);
    await useApp.getState().bootstrap();
  };
  return (
    <div className="proj-props-row">
      {props.label !== false && <span className="ppr-label">Resources</span>}
      {docs.map(d => (
        <button key={d.id} className="res-chip doc" onClick={() => navigate(`/docs/${d.id}`)}>
          {d.icon ? <span>{d.icon}</span> : <IconDoc size={12} />}<span className="res-title">{d.title || 'Untitled'}</span>
        </button>
      ))}
      {links.map(l => (
        <span key={l.id} className="res-chip">
          <IconLink size={12} /><a href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
          <button className="res-x" title="Remove" onClick={() => void removeLink(l.id)}><IconClose size={10} /></button>
        </span>
      ))}
      <button className="prop-chip ghost dim" onClick={menu.open}><IconPlus size={12} /> Add document or link…</button>
      {props.projectId && <CustomerRequests projectId={props.projectId} asButton />}
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={210}>
          <MenuItem icon={<IconDoc size={14} />} label="New document" onClick={() => void newDoc(owner, navigate)} />
          {snap.docTemplates.length > 0 && <div className="menu-header"><span>From template</span></div>}
          {snap.docTemplates.map(t => (
            <MenuItem key={t.id} icon={<IconDoc size={14} />} label={t.name} onClick={() => void newDoc(owner, navigate, t)} />
          ))}
          <MenuItem icon={<IconLink size={14} />} label="Add link…" onClick={() => setLinking(menu.anchor)} />
        </Menu>
      )}
      {linking && <AddLink anchor={linking} onClose={() => setLinking(null)} onAdd={async (url, title) => {
        if (props.projectId) await api.addProjectLink(props.projectId, url, title);
        else if (props.initiativeId) await api.addInitiativeLink(props.initiativeId, url, title);
        else if (props.teamId) await api.addTeamLink(props.teamId, url, title);
        await useApp.getState().bootstrap();
      }} />}
    </div>
  );
}

function AddLink(props: { anchor: DOMRect; onClose: () => void; onAdd: (url: string, title?: string) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const save = async () => {
    if (!url.trim()) return;
    await props.onAdd(/^[a-z]+:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`, title.trim() || undefined);
    props.onClose();
  };
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={320}>
      <div className="menu-header"><span>Add link</span></div>
      <div className="link-form" onClick={e => e.stopPropagation()}>
        <input className="text-input" autoFocus placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} />
        <input className="text-input" placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} />
        <button className="btn primary" style={{ height: 28 }} disabled={!url.trim()} onClick={save}>Add link</button>
      </div>
    </Menu>
  );
}

export function DocumentPage() {
  const { docId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const doc = snap.docs.find(d => d.id === docId);
  const [title, setTitle] = useState(doc?.title ?? '');
  useEffect(() => { setTitle(doc?.title ?? ''); }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc) return <div className="empty-state"><div className="empty-title">Document not found</div></div>;
  const project = snap.projects.find(p => p.id === doc.projectId);
  const team = snap.teams.find(t => t.id === doc.teamId);
  const initiative = snap.initiatives.find(i => i.id === doc.initiativeId);
  const author = snap.users.find(u => u.id === doc.creatorId);
  const save = async (patch: Partial<Pick<Doc, 'title' | 'content'>>) => { await api.updateDoc(doc.id, patch); await useApp.getState().bootstrap(); };
  const crumbs = project
    ? [{ label: 'Projects', to: '/projects', muted: true }, { label: project.name, icon: <span className="crumb-emoji">{project.icon}</span>, to: `/projects/${project.id}`, muted: true }, { label: doc.title || 'Untitled' }]
    : initiative ? [{ label: 'Initiatives', to: '/initiatives', muted: true }, { label: initiative.name, to: `/initiatives/${initiative.id}`, muted: true }, { label: doc.title || 'Untitled' }]
    : team ? [{ label: team.name, to: `/team/${team.key}/overview`, muted: true }, { label: 'Documents', to: `/team/${team.key}/overview/documents`, muted: true }, { label: doc.title || 'Untitled' }]
    : [{ label: doc.title || 'Untitled' }];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={crumbs} more={<>
        <MenuItem icon={<IconLink size={14} />} label="Copy link" onClick={async () => { if (await copyText(`${location.origin}/#/docs/${doc.id}`)) useApp.getState().toast({ title: 'Copied link' }); }} />
        <MenuSep />
        <MenuItem icon={<IconTrash size={14} />} danger label="Delete document" onClick={async () => { await api.deleteDoc(doc.id); await useApp.getState().bootstrap(); navigate(project ? `/projects/${project.id}` : initiative ? `/initiatives/${initiative.id}` : team ? `/team/${team.key}/overview` : '/'); useApp.getState().toast({ title: 'Document deleted' }); }} />
      </>} />
      <div className="content">
        <div className="doc-page">
          <input className="doc-title" value={title} placeholder="Untitled" autoFocus={!doc.title} spellCheck={false}
            onChange={e => setTitle(e.target.value)} onBlur={() => title !== doc.title && void save({ title })}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (document.querySelector('.doc-page .ProseMirror') as HTMLElement | null)?.focus(); } }} />
          <div className="doc-meta">{author && <><Avatar user={author} size={16} /> {author.name} · </>}edited {relTime(doc.updatedAt)}</div>
          <RichEditor key={doc.id} value={doc.content} uploadTo={`doc:${doc.id}`} placeholder="Write something, or type / for blocks…" className="doc-body"
            onChange={md => md !== doc.content && void save({ content: md })} onBlur={md => md !== doc.content && void save({ content: md })} />
        </div>
      </div>
    </div>
  );
}

/* ================= team home ================= */
export function TeamHomePage() {
  const { teamKey = '', tab: rawTab } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const team = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
  const tab = rawTab === 'documents' || rawTab === 'members' ? rawTab : 'overview';
  // a team's name and description are its settings (admins', hosted)
  const canConfigure = useCanConfigure();
  const [name, setName] = useState(team?.name ?? '');
  useEffect(() => { setName(team?.name ?? ''); }, [team?.id, team?.name]);
  if (!team) return <TeamMissingRedirect />;
  const docs = snap.docs.filter(d => d.teamId === team.id || snap.projects.some(p => p.id === d.projectId && p.teamId === team.id));
  const memberIds = [...new Set(snap.issues.filter(i => i.teamId === team.id && i.assigneeId).map(i => i.assigneeId!))];
  const members = snap.users.filter(u => memberIds.includes(u.id) || u.id === snap.currentUser.id);
  const go = (label: string, icon: React.ReactNode, to: string) => <button className="go-link" onClick={() => navigate(to)}>{icon}{label}</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: team.name, icon: teamDisplayIcon(team) }]} />
      <div className="subnav">
        {(['overview', 'documents', 'members'] as const).map(t => (
          <button key={t} className={`seg ${tab === t ? 'selected' : ''}`} onClick={() => navigate(`/team/${team.key}/overview${t === 'overview' ? '' : `/${t}`}`)}>
            {t[0].toUpperCase() + t.slice(1)}{tab === t && <RegisterMark group="team-home-tabs" />}
          </button>
        ))}
      </div>
      <div className="content">
        {tab === 'overview' && (
          <div className="team-home">
            <div className="team-home-main">
              <div className="team-hero">
                <span className="ws-avatar" style={{ background: team.color, borderRadius: 8, width: 36, height: 36, fontSize: 15 }}>{team.icon?.match(/\p{Emoji}/u) ? team.icon : team.key[0]}</span>
                <input className="proj-hero-name" value={name} readOnly={!canConfigure} title={canConfigure ? undefined : ADMIN_NOTE} onChange={e => setName(e.target.value)} onBlur={async () => { if (name.trim() && name !== team.name) { await api.updateTeam(team.id, { name: name.trim() }); await useApp.getState().bootstrap(); } }} />
              </div>
              {canConfigure ? <RichEditor key={team.id} value={team.description} uploadTo={`team:${team.id}`} placeholder="Add a description…"
                onBlur={async md => { if (md !== team.description) { await api.updateTeam(team.id, { description: md }); await useApp.getState().bootstrap(); } }} />
                : team.description ? <Markdown text={team.description} /> : null}
              <div className="proj-section-label">Team resources</div>
              <Resources teamId={team.id} label={false} />
            </div>
            <aside className="team-home-rail">
              <div className="rail-header" style={{ padding: 0 }}>Members</div>
              <AvatarStack size={22} people={members.slice(0, 8).map(u => ({ name: u.name, initials: u.initials, color: u.color }))} />
              <div className="rail-header" style={{ padding: 0, marginTop: 14 }}>Go to</div>
              {go('Team settings', <IconSettings size={14} />, `/settings/team/${team.key}`)}
              {team.triageEnabled && go('Triage', <IconTriage size={14} />, `/team/${team.key}/triage`)}
              {go('Issues', <IconIssues size={14} />, `/team/${team.key}/all`)}
              {go('Cycles', <IconCycle size={14} />, `/team/${team.key}/cycles`)}
              {go('Projects', <IconBox size={14} />, `/team/${team.key}/projects`)}
              {go('Views', <IconViews size={14} />, `/team/${team.key}/views`)}
            </aside>
          </div>
        )}
        {tab === 'documents' && (
          <div className="static-list">
            <div className="static-head" style={{ display: 'flex', alignItems: 'center' }}>{docs.length} document{docs.length === 1 ? '' : 's'}<span style={{ flex: 1 }} /><button className="btn secondary sm" onClick={() => void newDoc({ teamId: team.id }, navigate)}><IconPlus size={12} /> New document</button></div>
            {docs.map(d => {
              const p = snap.projects.find(x => x.id === d.projectId);
              const author = snap.users.find(u => u.id === d.creatorId);
              return (
                <div key={d.id} className="issue-row static-row" onClick={() => navigate(`/docs/${d.id}`)}>
                  <IconDoc size={14} /><span className="row-title-wrap"><span className="row-title">{d.title || 'Untitled'}</span>{p && <span className="row-parent">{p.icon} {p.name}</span>}</span>
                  <span className="row-meta"><Avatar user={author} size={18} /><span className="row-date">{relTime(d.updatedAt)}</span></span>
                </div>
              );
            })}
          </div>
        )}
        {tab === 'members' && (
          <div className="static-list">
            <div className="static-head">{members.length} member{members.length === 1 ? '' : 's'}</div>
            {members.map(u => (
              <div key={u.id} className="issue-row static-row">
                <Avatar user={u} size={20} /><span className="row-title-wrap"><span className="row-title">{u.name}</span><span className="row-parent">{u.email}</span></span>
                <span className="row-meta"><span className="row-date">{snap.issues.filter(i => i.teamId === team.id && i.assigneeId === u.id).length} assigned</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
