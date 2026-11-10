import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp, useHelpers, relTime, shortDate, nameOf, localIsoDate, dateTime, copyText } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, MenuSub, useMenu, useCanConfigure, Via, ConfirmIconButton, NotFound, exclusive } from './ui.js';
import { IssueToolbar, IssueLocationRow, OpenInClaudeItems, useHandoffActions } from './CodingTools.js';
import { IssuePullRequests } from './GitHubUI.js';
import { SlaBadge } from './AutomationUI.js';
import { Markdown } from './Markdown.js';
import { RichEditor, isBlank, htmlToMarkdown } from './RichEditor.js';
import type { Editor } from '@tiptap/react';
import {
  StateIcon, PriorityIcon, Avatar, StatusMenu, PriorityMenu, AssigneeMenu, LabelsMenu, ProjectMenu, MilestoneMenu,
  DueDateMenu, EstimateMenu, CycleMenu, IssuePickerMenu, AddRelationMenu,
} from './pickers.js';
import { PropertyMenuBody, propMenuWidth } from './propertyMenus.js';
import { SubIssueSpine, AvatarStack } from './AvatarStack.js';
import { SubIssueComposer, startSubIssue, useSubIssueRequests } from './SubIssueComposer.js';
import { SubIssueProgress, subIssueProgress, estimateLabel } from './IssueViews.js';
import { archiveIssues, deleteIssues, setIssueProps, toggleSubscription, markDuplicate, convertToProject, convertToTemplate, makeRecurring, CADENCE_LABELS, triageDecide } from './actions.js';
import { navFor, neighbour, exitPathFor } from './nav.js';
import { Logo } from './Logo.js';
import { useLanding } from './motion.js';
import {
  IconPlus, IconClose, IconArchive, IconRestore, IconTrash, IconEdit, IconDuplicate,
  IconEstimate, IconCycle, IconCalendar, IconBox, IconBranch, IconHandoff, IconSpark, IconCopyId,
  IconMilestone, IconLink, IconCopy, IconFile, IconReply, IconResolve, IconChevronDown, IconChevronUp, IconExternal,
  IconBell, IconBellOff, IconTeam, IconClock, IconTriage, IconCheck, IconEmoji, IconMore, IconDoc,
  IconArrowUp,
} from './icons.js';
import type { Issue, Comment, Priority } from '../../src/core/types.js';
import { EmptyState } from './EmptyState.js';

/* shared activity text builder */
function useActivityText() {
  const snap = useApp(s => s.snap)!;
  return (a: { type: string; data: Record<string, unknown>; userId: string; viaUserId: string | null; createdAt: string }) => {
    const who = <><b>{nameOf(snap.users.find(u => u.id === a.userId))}</b><Via userId={a.viaUserId} /></>;
    // a value in a row reads as the thing it names: its icon, then its name
    const tok = (icon: React.ReactNode, text: React.ReactNode) => <span className="act-tok">{icon}<b>{text}</b></span>;
    const st = (id: unknown) => {
      const s = snap.states.find(x => x.id === id);
      return s ? tok(<StateIcon type={s.type} color={s.color} size={12} />, s.name) : tok(null, '?');
    };
    const prio = (p: unknown) => {
      const n = Number(p) as Priority;
      const label = ['No priority', 'Urgent', 'High', 'Medium', 'Low'][n];
      return label ? tok(<PriorityIcon priority={n} size={12} />, label) : tok(null, '?');
    };
    const person = (id: unknown) => {
      const u = snap.users.find(x => x.id === id);
      return tok(<Avatar user={u} size={14} />, u ? nameOf(u) : 'someone removed');
    };
    const label = (id: unknown) => {
      const l = snap.labels.find(x => x.id === id);
      return tok(<span className="label-dot" style={{ background: l?.color ?? 'var(--text-dim)' }} />, l?.name ?? '?');
    };
    const issueRef = (id: unknown) => {
      const i = snap.issues.find(x => x.id === id);
      if (!i) return 'a deleted issue';
      const t = snap.teams.find(t2 => t2.id === i.teamId);
      return `${t?.key}-${i.number} ${i.title}`;
    };
    const when = <span className="rel-time" title={dateTime(a.createdAt)}>· {relTime(a.createdAt)}</span>;
    const relLabel: Record<string, string> = { blocks: 'marked this as blocking', blocked_by: 'marked this as blocked by', related: 'related this to', duplicate: 'marked this as a duplicate of' };
    switch (a.type) {
      case 'created': return <>{who} created the issue {when}</>;
      case 'renamed': return <>{who} changed the title to <b>{String(a.data.to ?? '')}</b> {when}</>;
      case 'described': return <>{who} updated the description {when}</>;
      case 'stateChanged': return <>{who} changed status from {st(a.data.from)} to {st(a.data.to)} {when}</>;
      case 'triageAccepted': return <>{who} accepted the issue from triage into {st(a.data.to)} {when}</>;
      case 'triageDeclined': return <>{who} declined the issue {when}</>;
      case 'priorityChanged': return <>{who} set priority to {prio(a.data.to)} {when}</>;
      case 'assigned': return <>{who} assigned the issue to {a.data.to === a.userId ? 'themselves' : person(a.data.to)} {when}</>;
      case 'unassigned': return <>{who} removed the assignee {when}</>;
      case 'labeled': return <>{who} added label {label(a.data.labelId)} {when}</>;
      case 'unlabeled': return <>{who} removed label {label(a.data.labelId)} {when}</>;
      case 'projected': return a.data.to
        ? <>{who} added the issue to project {tok(<IconBox size={12} />, snap.projects.find(p => p.id === a.data.to)?.name ?? '?')} {when}</>
        : <>{who} removed the issue from its project {when}</>;
      case 'milestoneChanged': return a.data.to
        ? <>{who} moved the issue to milestone {tok(<IconMilestone size={12} />, snap.milestones.find(m => m.id === a.data.to)?.name ?? '?')} {when}</>
        : <>{who} removed the milestone {when}</>;
      case 'parented': return a.data.to
        ? <>{who} made this a sub-issue of <b>{issueRef(a.data.to)}</b> {when}</>
        : <>{who} removed the parent issue <b>{issueRef(a.data.from)}</b> {when}</>;
      case 'cycleChanged': return a.data.to
        ? <>{who} moved the issue to {tok(<IconCycle size={12} />, (() => { const c = snap.cycles.find(x => x.id === a.data.to); return c ? c.name || `Cycle ${c.number}` : 'a cycle'; })())} {when}</>
        : <>{who} removed the issue from its cycle {when}</>;
      case 'dueChanged': return a.data.to
        ? <>{who} set the due date to {tok(<IconCalendar size={12} />, shortDate(String(a.data.to).slice(0, 10) + 'T12:00'))} {when}</>
        : <>{who} removed the due date {when}</>;
      case 'estimateChanged': return a.data.to != null
        ? <>{who} set the estimate to <b>{String(a.data.to)} point{Number(a.data.to) !== 1 ? 's' : ''}</b> {when}</>
        : <>{who} removed the estimate {when}</>;
      case 'related': return <>{who} {relLabel[String(a.data.type)] ?? 'related this to'} <b>{issueRef(a.data.relatedId)}</b> {when}</>;
      case 'unrelated': return <>{who} removed the relation to <b>{issueRef(a.data.relatedId)}</b> {when}</>;
      case 'teamChanged': return <>{who} moved the issue from <b>{String(a.data.from)}</b> to <b>{String(a.data.to)}</b> {when}</>;
      case 'attached': return <>{who} {a.data.kind === 'file' ? 'attached' : 'added link'} <b>{String(a.data.title ?? '')}</b> {when}</>;
      case 'locationChanged': return a.data.to
        ? <>{who} set the location to <b>{snap.locations.find(l => l.id === a.data.to)?.name ?? 'a removed location'}</b> {when}</>
        : <>{who} removed the location {when}</>;
      case 'archived': return <>{who} archived the issue {when}</>;
      case 'restored': return <>{who} restored the issue {when}</>;
      case 'slaApplied': return <>{who} applied SLA <b>{String(a.data.rule)}</b>, due {dateTime(String(a.data.breachesAt))} {when}</>;
      case 'slaBreached': return <>{who} marked the SLA as breached {when}</>;
      case 'prLinked': return <>{who} linked {a.data.kind === 'closing' ? 'pull request' : 'a reference from'} <a href={String(a.data.url)} target="_blank" rel="noreferrer"><b>{String(a.data.pr)}</b></a> {String(a.data.title ?? '')} {when}</>;
      case 'prStateMoved': return <>{who} moved the issue: {String(a.data.why)} {when}</>;
      case 'commitLinked': return <>{who} linked commit <b className="mono">{String(a.data.sha)}</b> {String(a.data.message ?? '')} {when}</>;
      case 'loopRan': return <>{who} ran loop <b>{String(a.data.loop)}</b> — {String(a.data.detail)} {when}</>;
      default: return <>{who} {a.type} {when}</>;
    }
  };
}

export const REACTION_SET = ['👍', '👎', '❤️', '🎉', '🚀', '😄', '👀', '🙏'];

/* ---------------- comments & threads ---------------- */
function Reactions(props: { comment: Comment }) {
  return <ReactionChips reactions={props.comment.reactions} onToggle={async emoji => { await api.toggleReaction(props.comment.id, emoji); await useApp.getState().bootstrap(); }} />;
}
/** emoji reaction chips (a comment's, an initiative update's): click one to add or remove yours */
export function ReactionChips(props: { reactions: Record<string, string[]>; onToggle: (emoji: string) => void | Promise<unknown>; children?: React.ReactNode }) {
  const snap = useApp(s => s.snap)!;
  const me = snap.currentUser.id;
  // a click shows at once; the next snapshot replaces the guess
  const [local, setLocal] = useState<Record<string, string[]> | null>(null);
  useEffect(() => { setLocal(null); }, [props.reactions]);
  const reactions = local ?? props.reactions;
  // emoji that were already there on first render don't pop; one that arrives later does
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(Object.keys(props.reactions));
  const [bumped, setBumped] = useState<string | null>(null);
  const toggle = (emoji: string) => {
    const ids = reactions[emoji] ?? [];
    setBumped(ids.includes(me) ? null : emoji);
    const next = { ...reactions, [emoji]: ids.includes(me) ? ids.filter(x => x !== me) : [...ids, me] };
    if (!next[emoji]!.length) delete next[emoji];
    setLocal(next);
    void Promise.resolve(props.onToggle(emoji)).catch(() => setLocal(null));
  };
  const entries = Object.entries(reactions);
  if (!entries.length && !props.children) return null;
  return (
    <div className="reactions">
      {entries.map(([emoji, userIds]) => {
        const fresh = !seen.current!.has(emoji) || bumped === emoji;
        return (
          <button key={emoji} className={`reaction-chip ${userIds.includes(me) ? 'mine' : ''}${fresh ? ' pop' : ''}`}
            title={userIds.map(id => snap.users.find(u => u.id === id)?.name ?? '?').join(', ')}
            onClick={() => toggle(emoji)}>
            <span key={userIds.length} className="rc-emoji">{emoji}</span> {userIds.length}
          </button>
        );
      })}
      {props.children}
    </div>
  );
}

/* Deleting a comment can't be reversed on the server, so the delete waits out the toast: the
   comment hides at once, Undo shows it again, and the delete is sent when the toast closes
   (timed out or ×). The set lives at module level so a remount still sees the comment as gone. */
const pendingCommentDeletes = new Set<string>();
/* comments posted from this tab: each lands with a rise and a brief brand wash, once */
const justPosted = new Set<string>();

function CommentBody(props: { comment: Comment; issueId: string; reply?: boolean; onReply?: () => void; resolved?: boolean; onResolve?: () => void }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const c = props.comment;
  const author = snap.users.find(u => u.id === c.userId);
  const isMine = c.userId === snap.currentUser.id;
  const reactMenu = useMenu();
  const moreMenu = useMenu();
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState(() => pendingCommentDeletes.has(props.comment.id));
  const [landed] = useState(() => justPosted.delete(props.comment.id));
  const scheduleDelete = () => {
    moreMenu.close(); // the menu unmounts with the comment, so close it now or Undo brings it back open
    setHidden(true);
    pendingCommentDeletes.add(c.id);
    toast({
      title: props.reply ? 'Reply deleted' : 'Comment deleted',
      actions: [{ label: 'Undo', onClick: () => { pendingCommentDeletes.delete(c.id); setHidden(false); } }],
      onClose: () => { pendingCommentDeletes.delete(c.id); void api.deleteComment(c.id).then(() => useApp.getState().bootstrap()); },
    });
  };
  if (hidden) return null;

  return (
    <div className={`cmt${props.reply ? ' reply' : ''}${landed ? ' landed' : ''}`} id={`comment-${c.id}`}>
      <div className="cmt-head">
        <Avatar user={author} size={props.reply ? 18 : 20} />
        <span className="cmt-author">{nameOf(author)}<Via userId={c.viaUserId} /></span>
        <span className="rel-time" title={dateTime(c.createdAt)}>{relTime(c.createdAt)}{c.editedAt ? ' (edited)' : ''}</span>
        <span style={{ flex: 1 }} />
        <span className="cmt-actions">
          <button className="icon-btn" title="Add reaction" onClick={reactMenu.open}><IconEmoji size={13} /></button>
          {props.onReply && <button className="icon-btn" title="Reply" onClick={props.onReply}><IconReply size={13} /></button>}
          {props.onResolve && <button className="icon-btn" title={props.resolved ? 'Reopen thread' : 'Resolve thread'} onClick={props.onResolve}><IconResolve size={13} /></button>}
          <button className="icon-btn" title="More" onClick={moreMenu.open}><IconMore size={13} /></button>
        </span>
      </div>
      {editing ? (
        <div className="comment-box editing">
          <RichEditor value={c.body} autoFocus issueId={props.issueId}
            onSubmit={async md => {
              // save before closing: if the save fails the editor stays open with the text
              if (md !== c.body && !isBlank(md)) { await api.updateComment(c.id, md); await useApp.getState().bootstrap(); }
              setEditing(false);
            }}
            onEscape={() => setEditing(false)} />
          <div className="cbox-foot">
            <span className="cbox-hint">⌘↵ to save · Esc to cancel</span>
            <button className="btn" style={{ height: 24, fontSize: 12 }} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="cmt-body"><Markdown text={c.body} /></div>
      )}
      <Reactions comment={c} />
      {reactMenu.anchor && (
        <Menu anchor={reactMenu.anchor} onClose={reactMenu.close} width={196}>
          <div className="reaction-grid">
            {REACTION_SET.map(emoji => (
              <button key={emoji} className="reaction-pick" title={emoji}
                onClick={async () => { reactMenu.close(); await api.toggleReaction(c.id, emoji); await useApp.getState().bootstrap(); }}>{emoji}</button>
            ))}
          </div>
        </Menu>
      )}
      {moreMenu.anchor && (
        <Menu anchor={moreMenu.anchor} onClose={moreMenu.close} width={200}>
          <MenuItem icon={<IconLink size={14} />} label="Copy link to comment" onClick={async () => {
            const iss = snap.issues.find(i => i.id === props.issueId); const tk = snap.teams.find(t => t.id === iss?.teamId)?.key;
            if (iss && tk && await copyText(`${location.origin}/#/issue/${tk}-${iss.number}?comment=${c.id}`)) toast({ title: 'Copied link to comment' });
          }} />
          <MenuItem icon={<IconCopy size={14} />} label="Copy comment text" onClick={async () => { if (await copyText(c.body)) toast({ title: 'Copied comment' }); }} />
          {isMine && <MenuItem icon={<IconEdit size={14} />} label="Edit comment" onClick={() => setEditing(true)} />}
          {isMine && <MenuSep />}
          {isMine && <MenuItem icon={<IconTrash size={14} />} danger label={props.reply ? 'Delete reply' : 'Delete comment'} onClick={scheduleDelete} />}
        </Menu>
      )}
    </div>
  );
}

function CommentThread(props: { root: Comment; replies: Comment[]; issueId: string }) {
  const [replying, setReplying] = useState(false);
  const resolved = !!props.root.resolvedAt;
  const [expanded, setExpanded] = useState(!resolved);
  useEffect(() => { setExpanded(!resolved); }, [resolved]);
  const snap = useApp(s => s.snap)!;
  const resolve = async () => { await api.resolveComment(props.root.id, !resolved); await useApp.getState().bootstrap(); };
  if (resolved && !expanded) {
    const author = snap.users.find(u => u.id === props.root.userId);
    return (
      <button className="thread-resolved" onClick={() => setExpanded(true)}>
        <IconResolve size={13} /> <b>{author?.name}</b>'s thread was resolved
        {props.replies.length > 0 && <span className="dim"> · {props.replies.length} repl{props.replies.length === 1 ? 'y' : 'ies'}</span>}
        <span className="dim"> · show</span>
      </button>
    );
  }
  return (
    <div className={`thread${resolved ? ' is-resolved' : ''}`}>
      <CommentBody comment={props.root} issueId={props.issueId} onReply={() => setReplying(true)} resolved={resolved} onResolve={resolve} />
      {props.replies.map(r => <CommentBody key={r.id} comment={r} issueId={props.issueId} reply />)}
      {replying ? (
        <div className="comment-box reply-box">
          <RichEditor value="" autoFocus issueId={props.issueId} placeholder="Leave a reply…" clearOnSubmit
            onSubmit={async md => { if (isBlank(md)) return; const { comment } = await api.addComment(props.issueId, md, props.root.id); justPosted.add(comment.id); await useApp.getState().bootstrap(); setReplying(false); }}
            onEscape={() => setReplying(false)} />
          <div className="cbox-foot"><span className="cbox-hint">⌘↵ to reply</span><button className="btn" style={{ height: 24, fontSize: 12 }} onClick={() => setReplying(false)}>Cancel</button></div>
        </div>
      ) : props.replies.length > 0 && (
        <button className="thread-reply-btn" onClick={() => setReplying(true)}><IconReply size={12} /> Reply…</button>
      )}
      {resolved && <button className="thread-reply-btn" onClick={() => setExpanded(false)}>Collapse resolved thread</button>}
    </div>
  );
}

/* ---------------- sub-issues ---------------- */
function SubIssuesSection(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const toast = useApp(s => s.toast);
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => { setComposing(false); }, [props.issue.id]);
  useSubIssueRequests(props.issue.id, () => setComposing(true));
  const children = snap.issues.filter(i => i.parentId === props.issue.id && !i.archivedAt && !i.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const childKey = (ch: Issue) => `${snap.teams.find(t => t.id === ch.teamId)?.key}-${ch.number}`;
  const done = children.filter(i => {
    const st = snap.states.find(s => s.id === i.stateId);
    return st?.type === 'completed' || st?.type === 'canceled';
  }).length;

  return (
    <div className="subissues">
      {children.length > 0 && (
        <>
          <div className="subissues-head">
            <button className={`subissues-toggle${open ? '' : ' closed'}`} onClick={() => setOpen(o => !o)}><IconChevronDown size={11} /> Sub-issues</button>
            <SubIssueProgress done={done} total={children.length} issueId={props.issue.id} />
            <span style={{ flex: 1 }} />
            <IssuePickerMenu title="Add existing issue as sub-issue…" teamId={props.issue.teamId} excludeId={props.issue.id}
              onPick={async (child) => { await setIssueProps([child.id], { parentId: props.issue.id }); toast({ title: 'Sub-issue added', line: <>{child.title}</> }); }}>
              {({ open: o }) => <button className="icon-btn" title="Add existing issue" onClick={o}><IconLink size={13} /></button>}
            </IssuePickerMenu>
            <button className="icon-btn" title="Add sub-issue (⌘⇧O)" aria-label="Add sub-issue" onClick={() => setComposing(true)}><IconPlus size={13} /></button>
          </div>
          {open && (
            <div style={{ display: 'flex', gap: 4 }}>
              {/* the nodes cut through the spine they sit on instead of an opaque dot on a continuous rule */}
              <SubIssueSpine rows={children.map(ch => ({ active: snap.states.find(s => s.id === ch.stateId)?.type === 'started' }))} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {children.map(ch => {
                  const st = snap.states.find(s => s.id === ch.stateId);
                  return (
                    <div key={ch.id} className="prop-row sub-row group" onClick={() => navigate(`/issue/${childKey(ch)}`)}>
                      <PriorityIcon priority={ch.priority} size={13} />
                      <span className="issue-key">{childKey(ch)}</span>
                      {st && <StateIcon type={st.type} color={st.color} size={13} />}
                      <span className="sub-title">{ch.title}</span>
                      <Avatar user={snap.users.find(u => u.id === ch.assigneeId)} size={18} />
                      <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Remove from sub-issues"
                        onClick={async (e) => { e.stopPropagation(); await setIssueProps([ch.id], { parentId: null }); toast({ title: 'Sub-issue removed', line: <>{childKey(ch)} — {ch.title}</> }); }}><IconClose size={12} /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      {composing && <SubIssueComposer parent={props.issue} onClose={() => setComposing(false)} />}
    </div>
  );
}

/* "Sub-issue of ◐ KEY title  ◌ 1/3" under the title: the parent, its state, and how far along its siblings are */
function ParentLine(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const parent = props.issue.parentId ? snap.issues.find(i => i.id === props.issue.parentId) : undefined;
  if (!parent) return null;
  const key = `${snap.teams.find(t => t.id === parent.teamId)?.key}-${parent.number}`;
  const st = snap.states.find(s => s.id === parent.stateId);
  const progress = subIssueProgress(parent.id, snap);
  return (
    <div className="parent-line">
      <span className="parent-line-label">Sub-issue of</span>
      <button className="parent-line-link" onClick={() => navigate(`/issue/${key}`)} title={`Go to ${key}`}>
        {st && <StateIcon type={st.type} color={st.color} size={13} />}
        <span className="issue-key">{key}</span>
        <span className="parent-line-title">{parent.title}</span>
      </button>
      {progress && <span className="parent-line-progress"><SubIssueProgress done={progress.done} total={progress.total} issueId={parent.id} /></span>}
    </div>
  );
}

/* ---------------- links & files ---------------- */
function Attachments(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const items = snap.attachments.filter(a => a.issueId === props.issue.id);
  if (!items.length) return null;
  const host = (u: string) => { try { return new URL(u, location.origin).host; } catch { return ''; } };
  return (
    <div className="attachments">
      {items.map(a => (
        <div key={a.id} className="att-row group">
          <span className="att-icon">{a.kind === 'file' ? (a.mime.startsWith('image/') ? <img src={a.url} alt="" /> : <IconFile size={14} />) : <IconLink size={14} />}</span>
          <a className="att-title" href={a.url} target="_blank" rel="noreferrer">{a.title}</a>
          <span className="att-meta">{a.kind === 'file' ? `${Math.max(1, Math.round(a.size / 1024))} KB` : host(a.url)} · {relTime(a.createdAt)}</span>
          <a className="icon-btn hover-only" href={a.url} target="_blank" rel="noreferrer" title="Open"><IconExternal size={12} /></a>
          <ConfirmIconButton confirmLabel="Remove?" className="icon-btn hover-only" title="Remove" onConfirm={async () => { await api.deleteAttachment(a.id); await useApp.getState().bootstrap(); }}><IconClose size={12} /></ConfirmIconButton>
        </div>
      ))}
    </div>
  );
}

function AddLinkMenu(props: { issue: Issue; anchor: DOMRect; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const save = () => exclusive(`link-${props.issue.id}`, async () => {
    const u = url.trim();
    if (!u) return;
    await api.addLink(props.issue.id, /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`, title.trim() || undefined);
    await useApp.getState().bootstrap();
    props.onClose();
  });
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={320}>
      <div className="menu-header"><span>Add link</span><span className="kbd">⌃L</span></div>
      <div className="link-form" onClick={e => e.stopPropagation()}>
        <input className="text-input" autoFocus placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} />
        <input className="text-input" placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }} />
        <button className="btn primary" style={{ height: 28 }} onClick={save} disabled={!url.trim()}>Add link</button>
      </div>
    </Menu>
  );
}

/* ---------------- relations ---------------- */
function RelationsCard(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const relations = snap.relations.filter(r => r.issueId === props.issue.id);
  const keyOf = (id: string) => {
    const i = snap.issues.find(x => x.id === id);
    if (!i) return null;
    const t = snap.teams.find(t2 => t2.id === i.teamId);
    return { key: `${t?.key}-${i.number}`, title: i.title, state: snap.states.find(s => s.id === i.stateId) };
  };
  const typeLabel: Record<string, string> = { blocks: 'Blocking', blocked_by: 'Blocked by', related: 'Related', duplicate: 'Duplicate of' };
  const groups = ['blocked_by', 'blocks', 'related', 'duplicate'].map(t => ({ t, rels: relations.filter(r => r.type === t) })).filter(g => g.rels.length);
  return (
    <div className="rail-section">
      <div className="rail-header">Relations</div>
      {groups.map(g => (
        <div key={g.t}>
          <div className="rel-kind">{typeLabel[g.t]}</div>
          {g.rels.map(r => {
            const other = keyOf(r.relatedIssueId);
            if (!other) return null;
            return (
              <div key={r.id} className="prop-line rel-line" onClick={() => navigate(`/issue/${other.key}`)}>
                {other.state && <StateIcon type={other.state.type} color={other.state.color} size={13} />}
                <span className="issue-key">{other.key}</span>
                <span className="prop-line-label">{other.title}</span>
                <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Remove relation"
                  onClick={async (e) => { e.stopPropagation(); await api.removeRelation(r.id); await useApp.getState().bootstrap(); }}>
                  <IconClose size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
      <AddRelationMenu issue={props.issue}>
        {({ open }) => (
          <button className="prop-line dim" onClick={open}><IconPlus size={13} /> <span className="prop-line-label">Add relation…</span></button>
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
  const milestone = snap.milestones.find(m => m.id === issue.milestoneId);
  const hasMilestones = !!project && snap.milestones.some(m => m.projectId === project.id);
  const cycle = snap.cycles.find(c => c.id === issue.cycleId);
  const team = snap.teams.find(t => t.id === issue.teamId);
  const f = snap.workspace.features;
  const estimatesOn = f.estimatesEnabled && team?.estimateScale !== 'none';
  const est = estimateLabel(issue, snap);
  // a one-line bug shows what it has: empty optional properties wait behind "Add property"
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); }, [issue.id]);
  const show = { estimate: estimatesOn && (issue.estimate != null || more), cycle: !!cycle || (f.cyclesEnabled && more), due: !!issue.dueDate || more, project: !!project || more };
  const hidden = (estimatesOn && !show.estimate) || (f.cyclesEnabled && !show.cycle) || !show.due || !show.project;
  const closed = state?.type === 'completed' || state?.type === 'canceled';
  const due = issue.dueDate?.slice(0, 10);
  const overdue = !!due && !closed && due < localIsoDate();
  // the rail's own status line morphs when the issue lands on completed
  const { becameDone } = useLanding(issue, state?.type);

  return (
    <aside className="props-rail">
      <div className="rail-section">
        <div className="rail-header">Properties</div>
        <StatusMenu issue={issue}>
          {({ open }) => (
            <button className="prop-line" data-prop="status" onClick={open} title="Change status (S)">
              {state && <StateIcon type={state.type} color={state.color} size={14} morph={becameDone} />}
              <span className="prop-line-label">{state?.name ?? 'Set status'}</span>
            </button>
          )}
        </StatusMenu>
        <PriorityMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${issue.priority === 0 ? 'dim' : ''}`} data-prop="priority" onClick={open} title="Set priority (P)">
              <PriorityIcon priority={issue.priority} size={14} />
              <span className="prop-line-label">{['Set priority', 'Urgent', 'High', 'Medium', 'Low'][issue.priority]}</span>
            </button>
          )}
        </PriorityMenu>
        <AssigneeMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${assignee ? '' : 'dim'}`} data-prop="assignee" onClick={open} title="Assign (A)">
              <Avatar user={assignee} size={18} />
              <span className="prop-line-label">{assignee?.name ?? 'Assign'}</span>
            </button>
          )}
        </AssigneeMenu>
        {show.estimate && (
          <EstimateMenu issue={issue}>
            {({ open }) => (
              <button className={`prop-line ${issue.estimate == null ? 'dim' : ''}`} data-prop="estimate" onClick={open} title="Set estimate (⇧E)">
                <IconEstimate size={14} />
                <span className="prop-line-label">{est != null ? (team?.estimateScale === 'tshirt' ? est : `${est} point${issue.estimate !== 1 ? 's' : ''}`) : 'Set estimate'}</span>
              </button>
            )}
          </EstimateMenu>
        )}
        {show.cycle && <CycleMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${cycle ? '' : 'dim'}`} data-prop="cycle" onClick={open} title="Add to cycle (⇧C)">
              <IconCycle size={14} />
              <span className="prop-line-label">{cycle ? (cycle.name || `Cycle ${cycle.number}`) : 'Add to cycle'}</span>
            </button>
          )}
        </CycleMenu>}
        {show.due && <DueDateMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${issue.dueDate ? '' : 'dim'}${overdue ? ' overdue' : ''}`} data-prop="due" onClick={open} title="Set due date (⇧D)">
              <IconCalendar size={14} />
              <span className="prop-line-label">{due ? `${overdue ? 'Overdue · ' : ''}${shortDate(due + 'T12:00')}` : 'Set due date'}</span>
            </button>
          )}
        </DueDateMenu>}
        <IssueLocationRow issue={issue} expanded={more} />
        {hidden && <button className="prop-line dim" data-add-property onClick={() => setMore(true)} title="Show the properties this issue doesn’t use yet"><IconPlus size={13} /><span className="prop-line-label">Add property</span></button>}
      </div>

      <div className="rail-section">
        <div className="rail-header">Labels</div>
        <LabelsMenu issue={issue}>
          {({ open }) => (
            <div className="rail-labels" data-prop="labels">
              {labels.map(l => (
                <button key={l.id} className="label-pill" onClick={open} style={{ background: `color-mix(in srgb, ${l.color} calc(var(--label-bg-alpha) * 100%), transparent)`, color: 'var(--text-secondary)' }}>
                  <span className="label-dot" style={{ background: l.color }} />
                  {l.name}
                </button>
              ))}
              {labels.length === 0
                ? <button className="prop-line dim" onClick={open} title="Add label (L)"><IconPlus size={13} /><span className="prop-line-label">Add label</span></button>
                : <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={open} title="Add label (L)"><IconPlus size={13} /></button>}
            </div>
          )}
        </LabelsMenu>
      </div>

      {show.project && <div className="rail-section">
        <div className="rail-header">Project</div>
        <ProjectMenu issue={issue}>
          {({ open }) => (
            <button className={`prop-line ${project ? '' : 'dim'}`} data-prop="project" onClick={open} title="Add to project (⇧P)">
              {project
                ? <span className="proj-icon" style={{ width: 15, height: 15, fontSize: 9, background: 'var(--bg-hover)' }}>{project.icon}</span>
                : <IconBox size={14} />}
              <span className="prop-line-label">{project ? project.name : 'Add to project'}</span>
            </button>
          )}
        </ProjectMenu>
        {hasMilestones && (
          <MilestoneMenu issue={issue}>
            {({ open }) => (
              <button className={`prop-line ${milestone ? '' : 'dim'}`} data-prop="milestone" onClick={open} title="Set milestone (⇧M)">
                <IconMilestone size={14} />
                <span className="prop-line-label">{milestone ? milestone.name : 'Add to milestone'}</span>
              </button>
            )}
          </MilestoneMenu>
        )}
        {f.slasEnabled && issue.slaBreachesAt && <div className="prop-line" data-prop="sla"><SlaBadge issue={issue} long /></div>}
      </div>}

      <RelationsCard issue={issue} />
    </aside>
  );
}

/* ---------------- triage banner ---------------- */
function TriageBanner(props: { issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const state = snap.states.find(s => s.id === props.issue.stateId);
  const dup = useMenu();
  if (state?.type !== 'triage') return null;
  const creator = snap.users.find(u => u.id === props.issue.creatorId);
  return (
    <div className="triage-banner">
      <IconTriage size={14} />
      <span className="tb-text"><b>{creator?.name ?? 'Someone'}</b> filed this into triage {relTime(props.issue.createdAt)}</span>
      <span style={{ flex: 1 }} />
      <button className="btn primary sm" title="Accept into the backlog" onClick={() => void triageDecide(props.issue, 'accept')}><IconCheck size={12} /> Accept</button>
      <button className="btn secondary sm" title="Mark as duplicate (⇧M)" onClick={dup.open}><IconDuplicate size={12} /> Duplicate</button>
      <button className="btn secondary sm" title="Decline (cancel the issue)" onClick={() => void triageDecide(props.issue, 'decline')}><IconClose size={12} /> Decline</button>
      {dup.anchor && (
        <Menu anchor={dup.anchor} onClose={dup.close} width={propMenuWidth('duplicate')}>
          <PropertyMenuBody kind="duplicate" issues={[props.issue]} onClose={dup.close} />
        </Menu>
      )}
    </div>
  );
}

/* ---------------- issue detail body ---------------- */
export function IssueDetail(props: { issue: Issue; onClose?: () => void; full?: boolean; peek?: boolean; hideTriage?: boolean;
  /** above the title (the inbox puts the notification that brought you here) */
  banner?: React.ReactNode }) {
  const snap = useApp(s => s.snap)!;
  const issue = props.issue;
  const helpers = useHelpers();
  // issue templates are team setup (admins', hosted)
  const canConfigure = useCanConfigure();
  const key = helpers.keyOf(issue);
  const team = helpers.teamById(issue.teamId)!;
  const activityText = useActivityText();
  // ?comment=<id> (from "Copy link to comment"): bring that comment into view and mark it briefly
  const linkedComment = new URLSearchParams(useLocation().search).get('comment');
  useEffect(() => {
    if (!linkedComment) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`comment-${linkedComment}`);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('cmt-linked');
      setTimeout(() => el.classList.remove('cmt-linked'), 2400);
    }, 150);
    return () => clearTimeout(t);
  }, [linkedComment, issue.id]);
  const toast = useApp(s => s.toast);
  const [titleDraft, setTitleDraft] = useState(issue.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const linkMenu = useMenu();
  const handoff = useHandoffActions(issue);
  const nav = props.full ? navFor(issue.id) : { ids: [], origin: null };
  const navIndex = nav.ids.indexOf(issue.id);

  useEffect(() => { setTitleDraft(issue.title); }, [issue.id, issue.title]);
  // the title wraps like Linear's: a textarea that grows with its text
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const fit = () => { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; };
    fit();
    // re-fit when the column width changes: the peek pane slides in narrow, and windows resize
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== lastWidth) { lastWidth = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [titleDraft]);
  useEffect(() => {
    const onRename = () => { titleRef.current?.focus(); titleRef.current?.select(); };
    window.addEventListener('baseline:rename-issue', onRename);
    return () => window.removeEventListener('baseline:rename-issue', onRename);
  }, []);
  // ⌃L adds a link, like Linear
  useEffect(() => {
    if (props.peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const btn = document.querySelector<HTMLElement>('.issue-page [data-add-link]');
        if (btn) linkMenu.setAnchor(btn.getBoundingClientRect());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.peek]); // eslint-disable-line react-hooks/exhaustive-deps

  const comments = snap.comments.filter(c => c.issueId === issue.id);
  const roots = comments.filter(c => !c.parentId);
  const repliesOf = (id: string) => comments.filter(c => c.parentId === id);
  const timeline = useMemo(() => {
    const events = snap.activity
      .filter(a => a.issueId === issue.id && a.type !== 'commented')
      .map(a => ({ kind: 'event' as const, at: a.createdAt, a }));
    const threads = roots.map(c => ({ kind: 'thread' as const, at: c.createdAt, c }));
    return [...events, ...threads].sort((x, y) => x.at.localeCompare(y.at));
  }, [snap.activity, comments, issue.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = snap.currentUser.id;
  const subscribers = snap.subscriptions.filter(s => s.issueId === issue.id).map(s => snap.users.find(u => u.id === s.userId)).filter(Boolean) as typeof snap.users;
  const subscribed = subscribers.some(u => u.id === me);

  const saveTitle = async (value: string) => {
    if (titleTimer.current) { clearTimeout(titleTimer.current); titleTimer.current = null; }
    const v = value.trim();
    // typing autosaves every pause; the field's own undo covers that, so it stays off the ⌘Z stack
    if (v && v !== issue.title) await setIssueProps([issue.id], { title: v }, { undoable: false });
    else setTitleDraft(issue.title);
  };
  const onTitleChange = (value: string) => {
    setTitleDraft(value.replace(/\n/g, ' '));
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => void saveTitle(value), 900);
  };
  const saveDesc = async (md: string) => {
    const cur = useApp.getState().snap?.issues.find(i => i.id === issue.id)?.description ?? '';
    if (md !== cur) await setIssueProps([issue.id], { description: md }, { undoable: false });
  };
  const commentEditor = useRef<Editor | null>(null);
  const postComment = async (md: string) => {
    if (isBlank(md)) return;
    const { comment } = await api.addComment(issue.id, md);
    justPosted.add(comment.id);
    await useApp.getState().bootstrap();
  };
  const go = (delta: 1 | -1) => {
    const id = neighbour(issue.id, delta);
    const next = id ? snap.issues.find(i => i.id === id) : null;
    if (next) navigate(`/issue/${helpers.keyOf(next)}`, { replace: true });
  };

  const project = snap.projects.find(p => p.id === issue.projectId);
  const crumbs = nav.origin
    ? [{ label: nav.origin.label, to: nav.origin.to, muted: true }, { label: `${key} ${issue.title}` }]
    : project
      ? [{ label: project.name, icon: <span className="crumb-emoji">{project.icon}</span>, to: `/projects/${project.id}`, muted: true }, { label: `${key} ${issue.title}` }]
      : [{ label: team.name, to: `/team/${team.key}/all`, muted: true }, { label: `${key} ${issue.title}` }];

  return (
    <div className="issue-page">
      {/* Print / export header: the app appears as an object on paper. Screen-hidden. */}
      <div className="print-head" aria-hidden="true">
        <div className="print-head-row">
          <Logo size={26} tone="paper" />
          <span className="print-wordmark">Baseline</span>
          <span className="print-key">{key}</span>
        </div>
        <div className="print-rule" />
      </div>
      <TopBar
        crumbs={crumbs}
        favoriteRef={{ type: 'issue', refId: issue.id }}
        more={
          <>
            <MenuItem icon={subscribed ? <IconBellOff size={14} /> : <IconBell size={14} />} label={subscribed ? 'Unsubscribe' : 'Subscribe'} right={<span className="mi-kbd">⇧S</span>} onClick={() => void toggleSubscription(issue.id)} />
            <MenuSub icon={<IconClock size={14} />} label="Remind me" right={<span className="mi-kbd">⇧H</span>} width={propMenuWidth('remind')}>
              <PropertyMenuBody kind="remind" issues={[issue]} onClose={() => {}} />
            </MenuSub>
            <MenuSub icon={<IconTeam size={14} />} label="Move to team" right={<span className="mi-kbd">⌘⇧M</span>} width={propMenuWidth('team')}>
              <PropertyMenuBody kind="team" issues={[issue]} onClose={() => {}} />
            </MenuSub>
            <MenuSub icon={<IconDuplicate size={14} />} label="Mark as duplicate of" right={<span className="mi-kbd">M M</span>} width={propMenuWidth('duplicate')}>
              <PropertyMenuBody kind="duplicate" issues={[issue]} onClose={() => {}} />
            </MenuSub>
            <MenuSub icon={<IconBox size={14} />} label="Convert to" width={220}>
              <MenuItem icon={<IconBox size={14} />} label="Project" onClick={() => void convertToProject(issue.id, navigate)} />
              {canConfigure && <MenuItem icon={<IconDoc size={14} />} label="Template" onClick={() => void convertToTemplate(issue.id)} />}
              <MenuSub icon={<IconCycle size={14} />} label="Recurring issue" width={200}>
                {(Object.keys(CADENCE_LABELS) as Array<keyof typeof CADENCE_LABELS>).map(c => <MenuItem key={c} label={CADENCE_LABELS[c]} onClick={() => void makeRecurring(issue.id, c)} />)}
              </MenuSub>
            </MenuSub>
            <MenuSep />
            <MenuItem icon={<IconHandoff size={14} />} label="Copy as prompt" right={<span className="mi-kbd">⌘⌥P</span>} onClick={e => void handoff.copyPrompt({ skipStart: e.altKey })} />
            <MenuSub icon={<IconSpark size={14} />} label="Open in Claude Code">
              <OpenInClaudeItems issue={issue} actions={handoff} />
            </MenuSub>
            <MenuItem icon={<IconBranch size={14} />} label="Copy git branch name" right={<span className="mi-kbd">⌘⇧.</span>} onClick={e => void handoff.copyBranch({ skipStart: e.altKey })} />
            <MenuItem icon={<IconCopyId size={14} />} label="Copy issue ID" right={<span className="mi-kbd">⌘.</span>} onClick={() => void handoff.copyId()} />
            {/* same as the row menu: open the copy in the create modal so it can be edited before it exists */}
            <MenuItem icon={<IconDuplicate size={14} />} label="Make a copy…" onClick={() => useApp.getState().openCreate({ teamId: issue.teamId, copyFrom: issue.id })} />
            <MenuSep />
            {issue.archivedAt
              ? <MenuItem icon={<IconRestore size={14} />} label="Unarchive" onClick={async () => { await api.unarchiveIssue(issue.id); await useApp.getState().bootstrap(); }} />
              : <MenuItem icon={<IconArchive size={14} />} label="Archive" right={<span className="mi-kbd">E</span>} onClick={async () => { await archiveIssues([issue.id]); if (props.full) navigate(exitPathFor(issue)); }} />}
            <MenuItem icon={<IconTrash size={14} />} danger label="Delete" right={<span className="mi-kbd">⌘⌫</span>} onClick={async () => { await deleteIssues([issue.id]); if (props.full) navigate(exitPathFor(issue)); }} />
          </>
        }
        right={
          <>
            {/* the copy / branch / prompt tools sit in the top bar, not a strip of their own above the title */}
            <IssueToolbar issue={issue} />
            {props.full && nav.ids.length > 1 && navIndex >= 0 && (
              <span className="issue-nav">
                <span className="issue-nav-count">{navIndex + 1} / {nav.ids.length}</span>
                <button className="icon-btn" title="Next issue (J)" disabled={navIndex >= nav.ids.length - 1} onClick={() => go(1)}><IconChevronDown size={14} /></button>
                <button className="icon-btn" title="Previous issue (K)" disabled={navIndex <= 0} onClick={() => go(-1)}><IconChevronUp size={14} /></button>
              </span>
            )}
            {props.onClose && <button className="icon-btn" title="Close (Esc)" onClick={props.onClose}><IconClose size={14} /></button>}
          </>
        }
      />
      <div className="issue-body">
        <div className="issue-main">
          <div className="issue-scroll">
            <div className="issue-col" style={props.full ? undefined : { maxWidth: 'none' }}>
              {props.banner}
              {!props.hideTriage && <TriageBanner issue={issue} />}
              <textarea
                ref={titleRef}
                className="issue-title"
                rows={1}
                value={titleDraft}
                placeholder="Issue title"
                onChange={e => onTitleChange(e.target.value)}
                onBlur={e => void saveTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === 'Escape') { e.stopPropagation(); setTitleDraft(issue.title); (e.target as HTMLTextAreaElement).blur(); } }}
                spellCheck={false}
              />
              <ParentLine issue={issue} />
              <div className="issue-desc">
                <RichEditor key={issue.id} value={issue.description} issueId={issue.id} placeholder="Add description…"
                  onChange={md => void saveDesc(md)} onBlur={md => void saveDesc(md)} />
              </div>
              <div className="issue-under-desc">
                {/* labeled: two bare icons here read as decoration */}
                <button className="btn ghost sm under-desc-btn" data-add-link title="Add link (⌃L)" onClick={linkMenu.open}><IconLink size={13} /> Add link</button>
                {/* once there are sub-issues their section header has its own +, so this one would be a second copy */}
                {!snap.issues.some(i => i.parentId === issue.id) && <button className="btn ghost sm under-desc-btn" title="Add sub-issue (⌘⇧O)" onClick={() => startSubIssue(issue)}><IconPlus size={13} /> Add sub-issue</button>}
              </div>
              <Attachments issue={issue} />
              <SubIssuesSection issue={issue} />
              <IssuePullRequests issueId={issue.id} />

              <div className="activity">
                <div className="activity-head">
                  <span className="activity-title">Activity</span>
                  <span style={{ flex: 1 }} />
                  <button className="subscribe-btn" onClick={() => void toggleSubscription(issue.id)} title={subscribed ? 'Stop notifications for this issue (⇧S)' : 'Get notified about this issue (⇧S)'}>
                    {subscribed ? 'Unsubscribe' : 'Subscribe'}
                  </button>
                  {subscribers.length > 0 && (
                    <span className="subscribers" title={`Subscribers: ${subscribers.map(u => u.name).join(', ')}`}>
                      <AvatarStack size={18} people={subscribers.slice(0, 4).map(u => ({ name: u.name, initials: u.initials, color: u.color }))} />
                    </span>
                  )}
                </div>

                {timeline.map(item => item.kind === 'event' ? (
                  <div key={item.a.id} className="activity-item">
                    <Avatar user={snap.users.find(u => u.id === item.a.userId)} size={16} />
                    <span className="activity-body">{activityText(item.a)}</span>
                  </div>
                ) : (
                  <CommentThread key={item.c.id} root={item.c} replies={repliesOf(item.c.id)} issueId={issue.id} />
                ))}

                <div className="comment-box composer">
                  <RichEditor key={`c-${issue.id}`} value="" issueId={issue.id} placeholder="Leave a comment…" clearOnSubmit onSubmit={postComment} editorRef={commentEditor} />
                  <div className="cbox-foot">
                    <span className="cbox-hint">{snap.workspace.preferences.sendCommentsOn === 'enter' ? '↵ to comment · ⇧↵ new line' : '⌘↵ to comment'}</span>
                    <span style={{ flex: 1 }} />
                    <button className="icon-btn cbox-send" title="Comment (⌘↵)" onClick={async () => { const ed = commentEditor.current; if (!ed) return; const html = ed.getHTML(); const md = htmlToMarkdown(html); if (isBlank(md)) return; ed.commands.clearContent(); try { await postComment(md); } catch (err) { if (ed.isEmpty) ed.commands.setContent(html); throw err; } }}><IconArrowUp size={14} /></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <PropertiesRail issue={issue} />
      </div>
      {linkMenu.anchor && <AddLinkMenu issue={issue} anchor={linkMenu.anchor} onClose={linkMenu.close} />}
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
  if (!issue) return <MissingIssue issueKey={props.issueKey} />;
  return <IssueDetail issue={issue} full />;
}

/* an archived or trashed issue still opens, read-only and with a way back */
function MissingIssue(props: { issueKey: string }) {
  const navigate = useNavigate();
  const [found, setFound] = useState<{ issue: Issue; where: 'archive' | 'trash' } | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    void (async () => {
      const lists = await Promise.all([api.archivedIssues(), api.deletedIssues()]).catch(() => null);
      if (!lists) { if (!off) setFailed(true); return; }
      const [a, d] = lists;
      const snap = useApp.getState().snap!;
      const keyOf = (i: Issue) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`.toLowerCase();
      const k = props.issueKey.toLowerCase();
      const hitA = a.issues.find(i => keyOf(i) === k);
      const hitD = d.issues.find(i => keyOf(i) === k);
      if (!off) setFound(hitD ? { issue: hitD, where: 'trash' } : hitA ? { issue: hitA, where: 'archive' } : null);
    })();
    return () => { off = true; };
  }, [props.issueKey]);
  if (failed) return <NotFound what="Issue" detail={`Couldn’t check the archive and trash for ${props.issueKey}. Reload to try again.`} back={{ label: 'Go to my issues', to: '/my-issues' }} />;
  if (found === undefined) return null;
  if (!found) return <NotFound what="Issue" detail={`${props.issueKey} doesn’t exist, or was deleted permanently.`} back={{ label: 'Go to my issues', to: '/my-issues' }} />;
  return (
    <EmptyState kind="holding" word={found.where === 'trash' ? 'Trash' : 'Archive'} illo={found.where === 'trash' ? 'trash' : 'archive'}
      title={<>{props.issueKey.toUpperCase()} is {found.where === 'trash' ? 'in the trash' : 'archived'}</>} desc={found.issue.title}
      actions={<>
        <button className="btn primary" onClick={async () => {
          if (found.where === 'trash') await api.restoreIssue(found.issue.id); else await api.unarchiveIssue(found.issue.id);
          await useApp.getState().bootstrap();
        }}>{found.where === 'trash' ? 'Restore issue' : 'Unarchive issue'}</button>
        <button className="btn secondary" onClick={() => navigate(-1)}>Go back</button>
      </>} />
  );
}

/* ---------------- peek (Space on a row) ---------------- */
export function PeekPanel() {
  const peekId = useApp(s => s.peekIssueId);
  const setPeek = useApp(s => s.setPeek);
  const issue = useApp(s => s.snap?.issues.find(i => i.id === peekId));
  useEffect(() => { if (peekId && !issue) setPeek(null); }, [peekId, issue, setPeek]);
  return createPortal(
    <AnimatePresence>
      {issue && (
        <>
          <motion.div key="peek-scrim" className="peek-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setPeek(null)} />
          <motion.div key="peek" className="peek-panel"
            initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <IssueDetail key={issue.id} issue={issue} peek onClose={() => setPeek(null)} />
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export { markDuplicate };
