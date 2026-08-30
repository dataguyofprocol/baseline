import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useHelpers, relTime, shortDate, copyText } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { Markdown } from './Markdown.js';
import {
  StateIcon, PriorityIcon, Avatar, StatusMenu, PriorityMenu, AssigneeMenu, LabelsMenu, ProjectMenu,
  DueDateMenu, EstimateMenu, CycleMenu, IssuePickerMenu, AddRelationMenu,
} from './pickers.js';
import { SubIssueSpine } from './AvatarStack.js';
import { Logo } from './Logo.js';
import { useLanding, playExit } from './motion.js';
import {
  IconLink, IconAttach, IconArrowUp, IconPlus, IconClose,
  IconArchive, IconRestore, IconTrash, IconEdit, IconSubIssue, IconDuplicate,
  IconEstimate, IconCycle, IconCalendar, IconBox, IconPrompt, IconCopy,
  IconAgent, IconBranch,
} from './icons.js';
import type { Issue } from '../../src/core/types.js';

/* shared activity text builder */
function useActivityText() {
  const snap = useApp(s => s.snap)!;
  return (a: { type: string; data: Record<string, unknown>; userId: string; createdAt: string }) => {
    const who = snap.users.find(u => u.id === a.userId)?.name ?? 'Someone';
    const st = (id: unknown) => snap.states.find(s => s.id === id)?.name ?? '?';
    const prio = (p: unknown) => ['', 'Urgent', 'High', 'Medium', 'Low'][Number(p)] ?? '?';
    const issueRef = (id: unknown) => {
      const i = snap.issues.find(x => x.id === id);
      if (!i) return '?';
      const t = snap.teams.find(t2 => t2.id === i.teamId);
      return `${t?.key}-${i.number} ${i.title}`;
    };
    switch (a.type) {
      case 'created': return <><b>{who}</b> created the issue · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'renamed': return <><b>{who}</b> renamed the issue · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'described': return <><b>{who}</b> updated the description · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'stateChanged': return <><b>{who}</b> changed status from <b>{st(a.data.from)}</b> to <b>{st(a.data.to)}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'priorityChanged': return <><b>{who}</b> changed priority from <b>{prio(a.data.from)}</b> to <b>{prio(a.data.to)}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'assigned': return <><b>{who}</b> assigned to <b>{snap.users.find(u => u.id === a.data.to)?.name ?? '?'}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'unassigned': return <><b>{who}</b> unassigned · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'labeled': return <><b>{who}</b> added label <b>{snap.labels.find(l => l.id === a.data.labelId)?.name ?? '?'}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'unlabeled': return <><b>{who}</b> removed label <b>{snap.labels.find(l => l.id === a.data.labelId)?.name ?? '?'}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'projected': return <><b>{who}</b> added to <b>{snap.projects.find(p => p.id === a.data.to)?.name ?? 'no project'}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'parented': return a.data.to
        ? <><b>{who}</b> added sub-issue to <b>{issueRef(a.data.to)}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>
        : <><b>{who}</b> removed sub-issue from <b>{issueRef(a.data.from)}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'cycleChanged': return a.data.to
        ? <><b>{who}</b> added the issue to <b>{snap.cycles.find(c => c.id === a.data.to)?.name ?? 'a cycle'}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>
        : <><b>{who}</b> removed the issue from its cycle · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'dueChanged': return a.data.to
        ? <><b>{who}</b> set due date to <b>{shortDate(String(a.data.to))}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>
        : <><b>{who}</b> removed the due date · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'estimateChanged': return a.data.to != null
        ? <><b>{who}</b> set estimate to <b>{String(a.data.to)} point{Number(a.data.to) !== 1 ? 's' : ''}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>
        : <><b>{who}</b> removed the estimate · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'related':
        return <><b>{who}</b> related this issue to <b>{issueRef(a.data.relatedId)}</b> · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'commented': return <><b>{who}</b> commented · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'archived': return <><b>{who}</b> archived the issue · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      case 'restored': return <><b>{who}</b> restored the issue · <span className="rel-time">{relTime(a.createdAt)}</span></>;
      default: return <><b>{who}</b> {a.type} · <span className="rel-time">{relTime(a.createdAt)}</span></>;
    }
  };
}

const REACTION_SET = ['👍', '👎', '❤️', '🎉', '🚀', '😄'];

/* ---------------- comment ---------------- */
function CommentItem(props: { comment: { id: string; userId: string; body: string; createdAt: string; editedAt: string | null; reactions: Record<string, string[]> } }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const c = props.comment;
  const author = snap.users.find(u => u.id === c.userId);
  const isMine = c.userId === snap.currentUser.id;
  const menu = useMenu();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  useEffect(() => { setBody(c.body); }, [c.body]);

  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
      <Avatar user={author} size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{author?.name ?? 'Someone'}</span>
          <span className="rel-time">{relTime(c.createdAt)}{c.editedAt ? ' (edited)' : ''}</span>
          <span style={{ flex: 1 }} />
          <button className="icon-btn hover-only" style={{ width: 22, height: 22 }} title="Add reaction" onClick={menu.open}>🙂</button>
          {isMine && <button className="icon-btn hover-only" style={{ width: 22, height: 22 }} title="Edit comment" onClick={() => setEditing(true)}><IconEdit size={13} /></button>}
          {isMine && (
            <button className="icon-btn hover-only" style={{ width: 22, height: 22 }} title="Delete comment"
              onClick={async () => {
                await api.deleteComment(c.id);
                await useApp.getState().bootstrap();
                toast({ title: 'Comment deleted' });
              }}><IconTrash size={13} /></button>
          )}
        </div>
        {editing ? (
          <div className="comment-box" style={{ padding: 0 }}>
            <textarea autoFocus value={body} onChange={e => setBody(e.target.value)} style={{ padding: '8px 10px', minHeight: 60 }}
              onKeyDown={async e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { setEditing(false); if (body !== c.body) { await api.updateComment(c.id, body); await useApp.getState().bootstrap(); } }
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
              }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '4px 8px 8px' }}>
              <button className="btn" style={{ height: 24, fontSize: 12 }} onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn primary" style={{ height: 24, fontSize: 12 }} disabled={body === c.body}
                onClick={async () => { setEditing(false); await api.updateComment(c.id, body); await useApp.getState().bootstrap(); }}>Save</button>
            </div>
          </div>
        ) : (
          <div className="comment-card"><Markdown text={c.body} /></div>
        )}
        {Object.keys(c.reactions).length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {Object.entries(c.reactions).map(([emoji, userIds]) => (
              <button key={emoji} className={`reaction-chip ${userIds.includes(snap.currentUser.id) ? 'mine' : ''}`}
                title={userIds.map(id => snap.users.find(u => u.id === id)?.name ?? '?').join(', ')}
                onClick={async () => { await api.toggleReaction(c.id, emoji); await useApp.getState().bootstrap(); }}>
                {emoji} {userIds.length}
              </button>
            ))}
          </div>
        )}
      </div>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={170}>
          <div className="menu-header"><span>Reactions</span></div>
          <div style={{ display: 'flex', gap: 2, padding: '2px 8px 8px', flexWrap: 'wrap' }}>
            {REACTION_SET.map(emoji => (
              <button key={emoji} className="reaction-chip"
                onClick={async () => { await api.toggleReaction(c.id, emoji); await useApp.getState().bootstrap(); menu.close(); }}>
                {emoji}
              </button>
            ))}
          </div>
        </Menu>
      )}
    </div>
  );
}

/* ---------------- sub-issues ---------------- */
function SubIssuesSection(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const openCreate = useApp(s => s.openCreate);
  const navigate = useNavigate();
  const toast = useApp(s => s.toast);
  const children = snap.issues.filter(i => i.parentId === props.issue.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const childKey = (ch: Issue) => {
    const t = snap.teams.find(t => t.id === ch.teamId);
    return `${t?.key}-${ch.number}`;
  };
  const done = children.filter(i => {
    const st = snap.states.find(s => s.id === i.stateId);
    return st?.type === 'completed' || st?.type === 'canceled';
  }).length;

  return (
    <div style={{ marginTop: 14 }}>
      {children.length > 0 && (
        <div className="card" style={{ padding: '4px 10px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', color: 'var(--text-secondary)', fontSize: 12 }}>
            <IconSubIssue size={13} /> Sub-issues
            <span style={{ flex: 1 }} />
            <span>{done}/{children.length} done</span>
            <span className="progress-track" style={{ width: 80 }}><span className="progress-fill" style={{ width: `${children.length ? (done / children.length) * 100 : 0}%` }} /></span>
          </div>
          {/* the nodes punch the spine they sit on — no opaque dot on a continuous rule */}
          <div style={{ display: 'flex', gap: 4 }}>
          <SubIssueSpine rows={children.map(ch => ({ active: snap.states.find(s => s.id === ch.stateId)?.type === 'started' }))} />
          <div style={{ flex: 1, minWidth: 0 }}>
          {children.map(ch => {
            const st = snap.states.find(s => s.id === ch.stateId);
            const team = snap.teams.find(t => t.id === ch.teamId);
            return (
              <div key={ch.id} className="prop-row group" style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/issue/${childKey(ch)}`)}>
                {st && <StateIcon type={st.type} color={st.color} size={13} />}
                <span className="issue-key">{team?.key}-{ch.number}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
                <PriorityIcon priority={ch.priority} size={13} />
                <Avatar user={snap.users.find(u => u.id === ch.assigneeId)} size={18} />
                <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Remove sub-issue"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.updateIssue(ch.id, { parentId: null });
                    await useApp.getState().bootstrap();
                    toast({ title: 'Sub-issue removed', line: <>{team?.key}-{ch.number} — {ch.title}</> });
                  }}><IconClose size={12} /></button>
              </div>
            );
          })}
          </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="prop-chip" style={{ color: 'var(--text-dim)' }} onClick={() => openCreate({ teamId: props.issue.teamId, parentId: props.issue.id })}>
          <IconPlus size={13} /> Add sub-issue
        </button>
        <IssuePickerMenu
          title="Attach existing issue…"
          teamId={props.issue.teamId}
          excludeId={props.issue.id}
          onPick={async (child) => {
            await api.updateIssue(child.id, { parentId: props.issue.id });
            await useApp.getState().bootstrap();
            toast({ title: 'Sub-issue added', line: <>{child.title}</> });
          }}
        >
          {({ open }) => <button className="prop-chip" style={{ color: 'var(--text-dim)' }} onClick={open}>Attach existing…</button>}
        </IssuePickerMenu>
      </div>
    </div>
  );
}

/* ---------------- relations ---------------- */
function RelationsCard(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const relations = snap.relations.filter(r => r.issueId === props.issue.id);
  if (relations.length === 0) return null;
  const keyOf = (id: string) => {
    const i = snap.issues.find(x => x.id === id);
    if (!i) return null;
    const t = snap.teams.find(t2 => t2.id === i.teamId);
    return { key: `${t?.key}-${i.number}`, title: i.title, id: i.id };
  };
  const typeLabel: Record<string, string> = { blocks: 'blocks', blocked_by: 'blocked by', related: 'related to', duplicate: 'duplicate of' };
  return (
    <div className="rail-section">
      <div className="rail-header">Relations</div>
      {relations.map(r => {
        const other = keyOf(r.relatedIssueId);
        if (!other) return null;
        return (
          <div key={r.id} className="prop-line" style={{ cursor: 'pointer' }} onClick={() => navigate(`/issue/${other.key}`)}>
            <span className="prop-line-meta" style={{ width: 70 }}>{typeLabel[r.type]}</span>
            <span className="prop-line-label">{other.key} {other.title}</span>
            <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Remove relation"
              onClick={async (e) => { e.stopPropagation(); await api.removeRelation(r.id); await useApp.getState().bootstrap(); }}>
              <IconClose size={12} />
            </button>
          </div>
        );
      })}
      <AddRelationMenu issue={props.issue}>
        {({ open }) => (
          <button className="prop-line dim" onClick={open}><IconPlus size={13} /> <span className="prop-line-label">Add relationship…</span></button>
        )}
      </AddRelationMenu>
    </div>
  );
}

/* ---------------- properties rail ---------------- */
export function PropertiesRail(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const issue = props.issue;
  const state = snap.states.find(s => s.id === issue.stateId);
  const assignee = snap.users.find(u => u.id === issue.assigneeId);
  const labels = snap.labels.filter(l => issue.labelIds.includes(l.id));
  const project = snap.projects.find(p => p.id === issue.projectId);
  const cycle = snap.cycles.find(c => c.id === issue.cycleId);
  const parent = issue.parentId ? snap.issues.find(i => i.id === issue.parentId) : undefined;
  const parentTeam = parent ? snap.teams.find(t => t.id === parent.teamId) : undefined;
  // the rail's own status line morphs when the issue lands on completed
  const { becameDone } = useLanding(issue, state?.type);
  const navigate = useNavigate();

  return (
    <aside className="props-rail">
      <div className="rail-section">
        <div className="rail-header">Properties</div>
        <StatusMenu issue={issue}>
          {({ open }) => (
            <button className="prop-line" onClick={open}>
              {state && <StateIcon type={state.type} color={state.color} size={14} morph={becameDone} />}
              <span className="prop-line-label">{state?.name ?? 'Set status'}</span>
            </button>
          )}
        </StatusMenu>
        <PriorityMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${issue.priority === 0 ? 'dim' : ''}`} onClick={open}>
              <PriorityIcon priority={issue.priority} size={14} />
              <span className="prop-line-label">{['Set priority', 'Urgent', 'High', 'Medium', 'Low'][issue.priority]}</span>
            </button>
          )}
        </PriorityMenu>
        <AssigneeMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${assignee ? '' : 'dim'}`} onClick={open}>
              <Avatar user={assignee} size={18} />
              <span className="prop-line-label">{assignee?.name ?? 'Assign'}</span>
            </button>
          )}
        </AssigneeMenu>
        {parent && (
          <button className="prop-line" onClick={() => navigate(`/issue/${parentTeam?.key}-${parent.number}`)} title={parent.title}>
            <span className="issue-key" style={{ width: 52 }}>{parentTeam?.key}-{parent.number}</span>
            <span className="prop-line-label">{parent.title}</span>
          </button>
        )}
        <EstimateMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${issue.estimate == null ? 'dim' : ''}`} onClick={open}>
              <IconEstimate size={14} />
              <span className="prop-line-label">{issue.estimate != null ? `${issue.estimate} point${issue.estimate !== 1 ? 's' : ''}` : 'Set estimate'}</span>
            </button>
          )}
        </EstimateMenu>
        <CycleMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${cycle ? '' : 'dim'}`} onClick={open}>
              <IconCycle size={14} />
              <span className="prop-line-label">{cycle ? (cycle.name || `Cycle ${cycle.number}`) : 'Add to cycle'}</span>
            </button>
          )}
        </CycleMenu>
        <DueDateMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${issue.dueDate ? '' : 'dim'}`} onClick={open}>
              <IconCalendar size={14} />
              <span className="prop-line-label">{issue.dueDate ? shortDate(issue.dueDate) : 'Set date'}</span>
            </button>
          )}
        </DueDateMenu>
      </div>

      <div className="rail-section">
        <div className="rail-header">Labels</div>
        <div className="rail-labels">
          {labels.map(l => (
            <span key={l.id} className="label-pill" style={{ background: `color-mix(in srgb, ${l.color} calc(var(--label-bg-alpha) * 100%), transparent)`, color: 'var(--text-secondary)' }}>
              <span className="label-dot" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
          <LabelsMenu issue={issue}>
            {({ open }) => (
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={open} title="Add label">
                <IconPlus size={13} />
              </button>
            )}
          </LabelsMenu>
        </div>
      </div>

      <div className="rail-section">
        <div className="rail-header">Project</div>
        <ProjectMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${project ? '' : 'dim'}`} onClick={open}>
              {project
                ? <span className="proj-icon" style={{ width: 15, height: 15, fontSize: 9, background: 'var(--bg-hover)' }}>{project.icon}</span>
                : <IconBox size={14} />}
              <span className="prop-line-label">{project ? project.name : 'Add to project'}</span>
            </button>
          )}
        </ProjectMenu>
      </div>

      <RelationsCard issue={issue} />
    </aside>
  );
}

/* ---------------- issue detail body ---------------- */
export function IssueDetail(props: { issue: Issue; onClose?: () => void; full?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const issue = props.issue;
  const helpers = useHelpers();
  const key = helpers.keyOf(issue);
  const team = helpers.teamById(issue.teamId)!;
  const activityText = useActivityText();
  const toast = useApp(s => s.toast);
  const [comment, setComment] = useState('');
  const [descEditing, setDescEditing] = useState(false);
  const [desc, setDesc] = useState(issue.description);
  const [titleDraft, setTitleDraft] = useState(issue.title);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  useEffect(() => { setDesc(issue.description); setDescEditing(false); setComment(''); setTitleDraft(issue.title); }, [issue.id, issue.description]); // eslint-disable-line

  const comments = snap.comments.filter(c => c.issueId === issue.id);
  const commentIds = new Set(comments.map(c => c.id));
  const activity = snap.activity
    .filter(a => a.issueId === issue.id && (a.type !== 'commented' || !commentIds.has(String(a.data.commentId))))
    .slice()
    .reverse();

  const saveTitle = async (value: string) => {
    const v = value.trim();
    if (v && v !== issue.title) {
      await api.updateIssue(issue.id, { title: v });
      await useApp.getState().bootstrap();
    } else {
      setTitleDraft(issue.title);
    }
  };
  const onTitleChange = (value: string) => {
    setTitleDraft(value);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => void saveTitle(value), 900);
  };
  const saveDesc = async () => {
    setDescEditing(false);
    if (desc !== issue.description) {
      await api.updateIssue(issue.id, { description: desc });
      await useApp.getState().bootstrap();
    }
  };
  const postComment = async () => {
    if (!comment.trim()) return;
    await api.addComment(issue.id, comment.trim());
    setComment('');
    await useApp.getState().bootstrap();
  };
  const archive = async () => {
    await playExit([issue.id]);
    await api.archiveIssue(issue.id);
    await useApp.getState().bootstrap();
    navigate(`/team/${team.key}/all`);
    toast({
      title: 'Issue archived', line: <>{key} — {issue.title}</>,
      actions: [{ label: 'Undo', onClick: async () => { await api.unarchiveIssue(issue.id); await useApp.getState().bootstrap(); } }],
    });
  };
  const copyPrompt = async () => {
    const { handoff } = await api.getHandoff(issue.id);
    if (await copyText(handoff.prompt)) toast({ title: `Copied prompt for ${handoff.key}`, line: <>branch: <b>{handoff.branchName}</b></> });
    else toast({ title: 'Clipboard unavailable', line: <>{handoff.key} — bring the app tab into focus and retry</> });
  };
  const copyBranch = async () => {
    const { handoff } = await api.getHandoff(issue.id);
    if (await copyText(handoff.branchName)) toast({ title: `Copied branch ${handoff.branchName}` });
    else toast({ title: 'Clipboard unavailable', line: <>branch: <b>{handoff.branchName}</b></> });
  };
  const copyUrl = async () => {
    if (await copyText(location.origin + '/#/issue/' + key)) toast({ title: 'Copied issue URL' });
    else toast({ title: 'Clipboard unavailable' });
  };
  const copyId = async () => {
    if (await copyText(key)) toast({ title: 'Copied issue ID' });
    else toast({ title: 'Clipboard unavailable' });
  };

  return (
    <div className="issue-page">
      {/* Print / export header: the app appears as an object on paper, so it is
          the paper cut of the tile over an ink rule. Screen-hidden; @media print
          strips the chrome around it. */}
      <div className="print-head" aria-hidden="true">
        <div className="print-head-row">
          <Logo size={26} tone="paper" />
          <span className="print-wordmark">Baseline</span>
          <span className="print-key">{key}</span>
        </div>
        <div className="print-rule" />
      </div>
      <TopBar
          crumbs={[
            { label: team.name, to: `/team/${team.key}/all`, muted: true },
            { label: `${key} ${issue.title}` },
          ]}
          favoriteRef={{ type: 'issue', refId: issue.id }}
          more={
            <>
              <MenuItem icon={<IconPrompt size={14} />} label="Copy as prompt" onClick={copyPrompt} />
              <MenuItem icon={<IconCopy size={14} />} label="Copy branch name" onClick={copyBranch} />
              <MenuItem label="Copy issue ID" onClick={copyId} />
              <MenuItem icon={<IconDuplicate size={14} />} label="Duplicate issue" onClick={async () => {
                const { issue: dup } = await api.createIssue({
                  teamId: issue.teamId, title: issue.title, description: issue.description,
                  priority: issue.priority, assigneeId: issue.assigneeId, projectId: issue.projectId,
                  labelIds: issue.labelIds, dueDate: issue.dueDate, estimate: issue.estimate,
                });
                await useApp.getState().bootstrap();
                toast({ title: 'Issue duplicated', line: <>{team.key}-{dup.number} — {dup.title}</> });
              }} />
              <MenuSep />
              {issue.archivedAt
                ? <MenuItem icon={<IconRestore size={14} />} label="Unarchive" onClick={archive} />
                : <MenuItem icon={<IconArchive size={14} />} label="Archive" onClick={archive} />}
              <MenuItem icon={<IconTrash size={14} />} danger label="Delete issue"
                onClick={async () => {
                  await api.deleteIssue(issue.id);
                  await useApp.getState().bootstrap();
                  navigate(`/team/${team.key}/all`);
                  toast({
                    title: 'Issue deleted', line: <>{key} — {issue.title}</>,
                    actions: [{ label: 'Undo', onClick: async () => { await api.restoreIssue(issue.id); await useApp.getState().bootstrap(); } }],
                  });
                }} />
            </>
          }
          right={
            <div className="issue-toolbar">
              {/* copy-as-prompt is the core workflow — brand-colored terminal glyph, first position */}
              <button className="icon-btn prompt-btn" title="Copy agent prompt" onClick={copyPrompt}><IconAgent size={15} /></button>
              <button className="icon-btn" title="Copy branch name" onClick={copyBranch}><IconBranch size={15} /></button>
              <button className="icon-btn" title="Copy issue URL" onClick={copyUrl}><IconLink size={15} /></button>
              <button className="icon-btn" title="Copy issue ID" onClick={copyId}><IconCopy size={15} /></button>
            </div>
          }
        />
        <div className="issue-body">
        <div className="issue-main">
        <div className="issue-scroll">
          <div className="issue-col" style={props.full ? undefined : { maxWidth: 'none' }}>
            <input
              className="issue-title"
              value={titleDraft}
              onChange={e => onTitleChange(e.target.value)}
              onBlur={e => void saveTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              spellCheck={false}
            />
            {descEditing ? (
              <div className="comment-box" style={{ padding: 0 }}>
                <textarea
                  autoFocus
                  value={desc}
                  onChange={e => setDesc(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveDesc();
                    if (e.key === 'Escape') { e.stopPropagation(); setDescEditing(false); }
                  }}
                  onBlur={saveDesc}
                  style={{ padding: '10px 12px', minHeight: 120 }}
                  placeholder="Add description…"
                />
              </div>
            ) : issue.description ? (
              <div onClick={() => setDescEditing(true)} style={{ cursor: 'text' }}>
                <Markdown text={issue.description} />
              </div>
            ) : (
              <div className="desc-placeholder" onClick={() => setDescEditing(true)}>
                Add description…
              </div>
            )}

            <SubIssuesSection issue={issue} />

            <div className="activity">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>Activity</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: 12.5 }}>
                  Unsubscribe
                  <Avatar user={snap.users.find(u => u.id === snap.currentUser.id)} size={20} />
                </span>
              </div>

              {activity.map(a => (
                <div key={a.id} className="activity-item">
                  <Avatar user={snap.users.find(u => u.id === a.userId)} size={20} />
                  <span className="activity-body" style={{ fontSize: 13 }}>{activityText(a)}</span>
                </div>
              ))}

              {comments.map(c => <CommentItem key={c.id} comment={c} />)}

              <div className="comment-box">
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postComment(); }}
                  placeholder="Leave a comment…"
                  style={{ minHeight: 40 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button className="icon-btn"><IconAttach size={14} /></button>
                  <button
                    className="icon-btn"
                    style={comment.trim() ? { background: 'var(--brand)', color: '#fff' } : undefined}
                    onClick={postComment}
                    title="Submit (⌘⏎)"
                  >
                    <IconArrowUp size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PropertiesRail issue={issue} />
      </div>
    </div>
  );
}

/* ---------------- full page ---------------- */
export function IssuePage(props: { issueKey: string }) {
  const snap = useApp(s => s.snap);
  if (!snap) return null;
  const m = /^(.+)-(\d+)$/.exec(props.issueKey);
  const team = snap.teams.find(t => t.key.toLowerCase() === (m?.[1] ?? '').toLowerCase());
  const issue = snap.issues.find(i => i.teamId === team?.id && i.number === Number(m?.[2]));
  if (!issue) {
    return <div className="empty-state"><div className="empty-title">Issue not found</div></div>;
  }
  return <IssueDetail issue={issue} full />;
}
