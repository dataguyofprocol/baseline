import { useEffect, useRef, useState } from 'react';
import { useApp, refresh, shortDate } from './store.js';
import { api } from './api.js';
import { Modal, Menu, MenuItem, MenuSep, useMenu, useInFlight } from './ui.js';
import { AnimatePresence } from 'framer-motion';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { IconClose, IconPlus, IconExpand, IconTag, IconCalendar, IconEstimate, IconMore, IconChevronDown, IconSubIssue, IconDoc, IconBox, IconUser, IconCheck, IconCycle, IconMilestone } from './icons.js';
import { teamScale, type Priority, type Team } from '../../src/core/types.js';
import type { Editor } from '@tiptap/react';
import { RichEditor, htmlToMarkdown } from './RichEditor.js';

const SUGGESTIONS: Array<[RegExp, string]> = [
  [/\b(bug|crash|error|broken|fix|fails?|regression)\b/i, 'Bug'],
  [/\b(feature|add|support|implement|introduce)\b/i, 'Feature'],
  [/\b(improve|refactor|polish|cleanup|optimi[sz]e|speed)\b/i, 'Improvement'],
];

// same palette as Settings → Labels; kept local to avoid importing the settings page
const LABEL_COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#3b82f6', '#5e6ad2', '#a78bfa', '#c770f4', '#8a8f98'];

interface Draft {
  title: string; description: string; statusId?: string; priority: Priority;
  assigneeId: string | null; labelIds: string[]; projectId: string | null;
  dueDate: string | null; estimate: number | null; savedAt: string;
}

const draftKey = (teamId: string) => `baseline:draft:${teamId}`;
function loadDraft(teamId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(teamId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d.title?.trim() ? d : null;
  } catch { return null; }
}

export function CreateIssueModal() {
  const snap = useApp(s => s.snap);
  const state = useApp(s => s.createModal);
  const closeCreate = useApp(s => s.closeCreate);
  const openCreate = useApp(s => s.openCreate);
  const toast = useApp(s => s.toast);
  const { busy, guard } = useInFlight();

  const [teamId, setTeamId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState<string | undefined>(undefined);
  const [priority, setPriority] = useState<Priority>(0);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [morePhase, setMorePhase] = useState<'root' | 'due' | 'estimate'>('root');
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[3]);
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | undefined>(undefined);

  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const teamMenu = useMenu();
  const statusMenu = useMenu();
  const priorityMenu = useMenu();
  const assigneeMenu = useMenu();
  const labelsMenu = useMenu();
  const projectMenu = useMenu();
  const moreMenu = useMenu();
  const templateMenu = useMenu();
  const cycleMenu = useMenu();
  const milestoneMenu = useMenu();

  useEffect(() => {
    if (state.open && snap) {
      const tid = state.teamId ?? snap.teams[0]?.id;
      setTeamId(tid);
      setExpanded(!!state.expanded);
      setTitle(state.title ?? '');
      setDescription('');
      setPriority(0);
      // Preferences › Auto-assign to self (off by default, as in Linear)
      setAssigneeId(snap.workspace.preferences.autoAssign ? snap.currentUser?.id ?? null : null);
      setLabelIds([]);
      setProjectId(state.projectId ?? null);
      setDueDate(null);
      setEstimate(null);
      setCycleId(state.cycleId ?? null);
      setMilestoneId(null);
      setCreateMore(false);
      setMoreOpen(false);
      setAppliedTemplateId(undefined);
      // "Make a copy…": the same properties and text, as a new issue
      const src = state.copyFrom ? snap.issues.find(i => i.id === state.copyFrom) : undefined;
      if (src) {
        setTitle(src.title); setDescription(src.description); setPriority(src.priority); setAssigneeId(src.assigneeId);
        setLabelIds(src.labelIds); setProjectId(src.projectId); setDueDate(src.dueDate); setEstimate(src.estimate);
        setCycleId(src.cycleId); setMilestoneId(src.milestoneId); setStatusId(src.stateId); setDraft(null);
        setTimeout(() => titleRef.current?.select(), 30);
        return;
      }
      const existing = (state.parentId ? null : loadDraft(tid ?? ''));
      setDraft(existing);
      if (existing) {
        setTitle(existing.title);
        setDescription(existing.description ?? '');
        setPriority(existing.priority ?? 0);
        setAssigneeId(existing.assigneeId ?? null);
        setLabelIds(existing.labelIds ?? []);
        setProjectId(existing.projectId ?? state.projectId ?? null);
        setDueDate(existing.dueDate ?? null);
        setEstimate(existing.estimate ?? null);
        setStatusId(existing.statusId);
      } else {
        setStatusId(state.stateId ?? snap.states.find(s => s.teamId === tid && s.type === 'unstarted')?.id ?? snap.states[0]?.id);
      }
      setTimeout(() => titleRef.current?.focus(), 30);
    }
  }, [state.open]); // eslint-disable-line react-hooks/exhaustive-deps

  // the editor remounts when the modal resets (new issue, discarded draft, create-more)
  const [editorKey, setEditorKey] = useState(0);
  useEffect(() => { if (state.open) setEditorKey(k => k + 1); }, [state.open, state.parentId, state.cycleId]);

  const team: Team | undefined = snap ? (teamId ? snap.teams.find(t => t.id === teamId) : snap.teams[0]) : undefined;
  const states = snap ? snap.states.filter(s => s.teamId === team?.id) : [];
  const current = states.find(s => s.id === statusId) ?? states[0];
  const selectedLabels = snap?.labels.filter(l => labelIds.includes(l.id)) ?? [];
  const assignee = assigneeId ? snap?.users.find(u => u.id === assigneeId) : undefined;
  const project = projectId ? snap?.projects.find(p => p.id === projectId) : undefined;
  const teamLabels = snap?.labels.filter(l => l.teamId === team?.id) ?? [];
  const nowIso = new Date().toISOString();
  // the cycles an issue can still go into: the current one and those ahead
  const openCycles = (snap?.cycles ?? []).filter(c => c.teamId === team?.id && !c.completedAt && c.endsAt >= nowIso).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const cycle = cycleId ? snap?.cycles.find(c => c.id === cycleId) : undefined;
  const cycleName = (c: { name?: string | null; number: number }) => c.name || `Cycle ${c.number}`;
  const milestones = project ? (snap?.milestones ?? []).filter(m => m.projectId === project.id).sort((a, b) => a.position - b.position) : [];
  const milestone = milestones.find(m => m.id === milestoneId);
  const suggestion = title.trim()
    ? SUGGESTIONS.find(([re, name]) =>
        re.test(title)
        && !selectedLabels.some(l => l.name === name)
        && teamLabels.some(l => l.name === name))
    : undefined;
  const parent = state.parentId && snap ? snap.issues.find(i => i.id === state.parentId) : undefined;
  const parentKey = parent ? `${snap?.teams.find(t => t.id === parent.teamId)?.key}-${parent.number}` : '';
  const templates = snap?.templates.filter(t => t.teamId === team?.id) ?? [];
  const appliedTemplate = templates.find(t => t.id === appliedTemplateId);
  const applyTemplate = (tplId: string | null) => {
    setAppliedTemplateId(tplId ?? undefined);
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    setDescription(tpl.description);
    setEditorKey(k => k + 1);
    if (tpl.title && !title.trim()) setTitle(tpl.title);
  };

  const createLabelInline = async () => {
    const name = newLabelName.trim();
    if (!name || !team) return;
    const dupe = teamLabels.find(l => l.name.toLowerCase() === name.toLowerCase());
    if (dupe) {
      setLabelIds(prev => prev.includes(dupe.id) ? prev : [...prev, dupe.id]);
    } else {
      const { label } = await api.createLabel({ teamId: team.id, name, color: newLabelColor });
      setLabelIds(prev => prev.includes(label.id) ? prev : [...prev, label.id]);
      await refresh();
    }
    setNewLabelName('');
    setNewLabelColor(LABEL_COLORS[(LABEL_COLORS.indexOf(newLabelColor) + 1) % LABEL_COLORS.length]);
  };

  const saveDraft = () => {
    if (!team) return;
    const d: Draft = {
      title: title.trim(), description, statusId: current?.id, priority, assigneeId,
      labelIds, projectId, dueDate, estimate, savedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(draftKey(team.id), JSON.stringify(d)); } catch { /* ignore */ }
    window.dispatchEvent(new Event('baseline:drafts'));
    closeCreate();
    toast({ title: 'Draft saved', line: <>{d.title}</> });
  };
  const discardDraft = () => {
    if (team) { try { localStorage.removeItem(draftKey(team.id)); } catch { /* ignore */ } window.dispatchEvent(new Event('baseline:drafts')); }
    setDraft(null);
    setTitle('');
    setDescription('');
    setEditorKey(k => k + 1);
    setPriority(0);
    setLabelIds([]);
    setDueDate(null);
    setEstimate(null);
    setTimeout(() => titleRef.current?.focus(), 30);
  };

  // after a pill menu closes, focus falls back to the page outside the modal, and ⌘↵ must still create
  const createRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.cm-root') || document.querySelector('.menu:not(.closing)')) return;
      e.preventDefault();
      createRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open]);

  if (!snap || !team) return null;

  // ⌘↵ in the description reaches both the editor's onSubmit and the modal's keydown, so
  // the guard is what keeps one keystroke from filing two issues
  const create = guard(async (descOverride?: string) => {
    if (!title.trim() || !current) return;
    // read the editor's own content, because its onChange is debounced
    const desc = descOverride ?? (editorRef.current ? htmlToMarkdown(editorRef.current.getHTML()) : description);
    const { issue } = await api.createIssue({
      teamId: team.id, title: title.trim(), description: desc,
      stateId: current.id, priority, assigneeId, labelIds, projectId,
      parentId: state.parentId ?? null, cycleId, milestoneId: project && milestoneId ? milestoneId : null,
      dueDate, estimate,
    });
    try { localStorage.removeItem(draftKey(team.id)); } catch { /* ignore */ }
    window.dispatchEvent(new Event('baseline:drafts'));
    // "Create related": wire the new issue to the one it was created from
    // the issue exists now: if wiring it up fails, still finish (close/reset) so a retry can't file a duplicate
    const rel = state.related;
    let relFailed = false;
    if (rel) {
      try {
        if (rel.kind === 'parent') await api.updateIssue(rel.issueId, { parentId: issue.id });
        else await api.addRelation(issue.id, rel.issueId, rel.kind);
      } catch { relFailed = true; }
    }
    await refresh();
    const key = `${team.key}-${issue.number}`;
    const toastBody = {
      title: relFailed ? 'Issue created, but it couldn’t be linked' : state.parentId ? 'Sub-issue created' : 'Issue created',
      line: <><StateIcon type={current.type} color={current.color} size={12} /> {key} — {issue.title}</>,
    };
    if (createMore) {
      openCreate({ teamId: team.id, projectId, parentId: state.parentId, cycleId: cycleId ?? undefined });
      useApp.getState().toast(toastBody);
    } else {
      closeCreate();
      useApp.getState().toast({ ...toastBody, link: { label: 'View issue', to: `/issue/${key}` } });
    }
  });

  createRef.current = () => { if (title.trim() && current) void create(); };
  const switchTeam = (t: Team) => {
    setTeamId(t.id);
    setStatusId(snap.states.find(s => s.teamId === t.id && s.type === 'unstarted')?.id ?? snap.states.find(s => s.teamId === t.id)?.id);
    setLabelIds(prev => prev.filter(lid => snap.labels.find(l => l.id === lid)?.teamId === t.id));
    setCycleId(null);
    setAppliedTemplateId(undefined);
  };

  // ⌘/Ctrl+Enter creates from anywhere in the modal (menus portal outside this
  // wrapper, but their React events still bubble here, so exclude them)
  const onModalKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('.menu')) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (title.trim() && current) void create();
    } else if (e.key === 'Enter' && !e.shiftKey && e.target === titleRef.current) {
      e.preventDefault();
      // the editor remounts on reset, so reach it through the DOM rather than a stale ref
      const pm = document.querySelector<HTMLElement>('.cm-desc .ProseMirror');
      if (pm) { pm.focus(); editorRef.current?.commands.focus('end'); }
    }
  };

  return (
    <AnimatePresence>
    {state.open && (
    <Modal onClose={closeCreate} className={`modal modal-create ${expanded ? 'expanded' : ''}`}>
      <div className="cm-root" onKeyDown={onModalKeyDown}>
      <div className="cm-header">
        {snap.teams.length > 1 ? (
          <button className="cm-team" onClick={teamMenu.open} title="Switch team">
            <span className="cm-team-mark" style={{ background: team.color }}>{team.key.slice(0, 1)}</span>
            <span>{team.key}</span>
          </button>
        ) : (
          <span className="cm-team static">
            <span className="cm-team-mark" style={{ background: team.color }}>{team.key.slice(0, 1)}</span>
            <span>{team.key}</span>
          </span>
        )}
        <span className="crumb-sep">›</span>
        {state.related ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            New issue <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{({ parent: 'parent of', blocks: 'blocking', blocked_by: 'blocked by', related: 'related to' } as const)[state.related.kind]} {(() => { const r = snap.issues.find(i => i.id === state.related!.issueId); return r ? `${snap.teams.find(t => t.id === r.teamId)?.key}-${r.number}` : ''; })()}</b>
          </span>
        ) : parent ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            <IconSubIssue size={13} style={{ color: 'var(--text-dim)' }} /> New sub-issue of <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{parentKey}</b>
          </span>
        ) : (
          <span style={{ color: 'var(--text-primary)' }}>New issue</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          {templates.length > 0 && (
            <button className={`cm-template${appliedTemplate ? ' on' : ''}`} onClick={templateMenu.open} title="Apply a template">
              <IconDoc size={13} />
              {appliedTemplate?.name ?? 'Template'}
              <IconChevronDown size={10} style={{ color: 'var(--text-dim)' }} />
            </button>
          )}
          <button className="icon-btn" title={expanded ? 'Contract' : 'Expand'} onClick={() => setExpanded(v => !v)}>
            <IconExpand size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 140ms var(--ease)' }} />
          </button>
          <button className="icon-btn" title="Close (Esc)" onClick={closeCreate}><IconClose size={14} /></button>
        </span>
      </div>

      {draft && (
        <div className="cm-draft">
          <span>Restored your draft from {shortDate(draft.savedAt)}</span>
          <button className="cm-link" onClick={discardDraft}>Discard</button>
        </div>
      )}

      <div className="cm-title">
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Issue title"
          spellCheck={false}
        />
      </div>
      <div className="cm-desc">
        <RichEditor key={editorKey} value={description} editorRef={editorRef} placeholder="Add description…"
          onChange={setDescription} onBlur={setDescription} onSubmit={md => { if (title.trim() && current) void create(md); }} />
      </div>

      {templateMenu.anchor && (
        <Menu anchor={templateMenu.anchor} onClose={templateMenu.close} width={220}>
          <div className="menu-header"><span>Apply template</span></div>
          {templates.map(tpl => (
            <MenuItem key={tpl.id} label={tpl.name} selected={appliedTemplateId === tpl.id}
              onClick={() => { applyTemplate(tpl.id); templateMenu.close(); }} />
          ))}
          <MenuSep />
          <MenuItem label="No template" selected={!appliedTemplateId}
            onClick={() => { applyTemplate(null); setDescription(''); templateMenu.close(); }} />
        </Menu>
      )}

      <div className="cm-pills">
        <button className="prop-chip set" onClick={statusMenu.open}>
          {current && <StateIcon type={current.type} color={current.color} size={13} />}
          <span className="chip-text">{current?.name ?? 'Status'}</span>
        </button>
        <button className={`prop-chip${priority ? ' set' : ''}`} onClick={priorityMenu.open}>
          <PriorityIcon priority={priority} size={13} />
          <span className="chip-text">{priority === 0 ? 'Priority' : ['', 'Urgent', 'High', 'Medium', 'Low'][priority]}</span>
        </button>
        <button className={`prop-chip${assignee ? ' set' : ''}`} onClick={assigneeMenu.open}>
          {assignee
            ? <Avatar user={assignee} size={16} />
            : <IconUser size={13} style={{ color: 'var(--text-dim)', margin: '0 1px' }} />}
          <span className="chip-text">{assignee ? (assignee.kind === 'agent' ? assignee.name : assignee.name.split(' ')[0]) : 'Assignee'}</span>
        </button>
        <button className={`prop-chip${project ? ' set' : ''}`} onClick={projectMenu.open}>
          {project
            ? <span className="proj-icon" style={{ width: 14, height: 14, fontSize: 11 }}>{project.icon}</span>
            : <IconBox size={13} style={{ color: 'var(--text-dim)' }} />}
          <span className="chip-text">{project?.name ?? 'Project'}</span>
        </button>
        {milestones.length > 0 && (
          <button className={`prop-chip${milestone ? ' set' : ''}`} onClick={milestoneMenu.open}>
            <IconMilestone size={13} style={{ color: 'var(--text-dim)' }} />
            <span className="chip-text">{milestone?.name ?? 'Milestone'}</span>
          </button>
        )}
        {(openCycles.length > 0 || cycle) && (
          <button className={`prop-chip${cycle ? ' set' : ' cm-icon-chip'}`} onClick={cycleMenu.open} title="Cycle">
            <IconCycle size={13} style={{ color: 'var(--text-dim)' }} />
            {cycle && <span className="chip-text">{cycleName(cycle)}</span>}
          </button>
        )}
        <button className={`prop-chip${estimate != null ? ' set' : ''}`} onClick={e => { setMorePhase('estimate'); moreMenu.open(e); }}>
          <IconEstimate size={13} style={{ color: 'var(--text-dim)' }} />
          <span className="chip-text">{estimate != null ? `${estimate} pt${estimate !== 1 ? 's' : ''}` : 'Estimate'}</span>
        </button>
        <button className={`prop-chip${selectedLabels.length ? ' set' : ''}`} onClick={e => { setNewLabelName(''); labelsMenu.open(e); }}>
          {selectedLabels.length
            ? <span className="cm-label-dots">{selectedLabels.slice(0, 3).map(l => <span key={l.id} className="label-dot" style={{ background: l.color }} />)}</span>
            : <IconTag size={13} style={{ color: 'var(--text-dim)' }} />}
          <span className="chip-text">
            {selectedLabels.length === 0 ? 'Labels' : selectedLabels.length === 1 ? selectedLabels[0].name : `${selectedLabels.length} labels`}
          </span>
        </button>
        {dueDate && (
          <button className="prop-chip set" onClick={e => { setMorePhase('due'); moreMenu.open(e); }}>
            <IconCalendar size={13} style={{ color: 'var(--text-dim)' }} />
            <span className="chip-text">{shortDate(dueDate)}</span>
          </button>
        )}
        <button className="prop-chip cm-more-chip" onClick={e => { setMorePhase('root'); moreMenu.open(e); }} title="More properties">
          <IconMore size={13} />
        </button>
        {/* the title reads like a known label, so offer it in place as a dashed chip
            at the end of the row, where it moves nothing above it */}
        {suggestion && (
          <button
            key={suggestion[1]} className="prop-chip cm-suggest-chip" title="Suggested from the title"
            onClick={() => {
              const l = teamLabels.find(x => x.name === suggestion[1]);
              if (l) setLabelIds(prev => [...prev, l.id]);
            }}
          >
            <IconPlus size={11} />
            <span className="label-dot" style={{ background: teamLabels.find(x => x.name === suggestion[1])?.color ?? '#8a8f98' }} />
            {suggestion[1]}
          </button>
        )}
      </div>

      <div className="cm-footer">
        {/* always laid out but only shown once there's something to save, so nothing reflows */}
        <button className="cm-link" style={{ visibility: title.trim() ? 'visible' : 'hidden' }} onClick={saveDraft}>Save draft</button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="cm-more" role="switch" aria-checked={createMore} onClick={() => setCreateMore(v => !v)}>
            <span className={`toggle ${createMore ? 'on' : ''}`} />
            Create more
          </button>
          <button className="btn primary cm-create" disabled={busy} onClick={() => { if (title.trim()) void create(); else titleRef.current?.focus(); }} title="Create issue (⌘↵)">
            {state.parentId ? 'Create sub-issue' : 'Create issue'}
          </button>
        </div>
      </div>

      {teamMenu.anchor && (
        <Menu anchor={teamMenu.anchor} onClose={teamMenu.close} width={220}>
          <div className="menu-header"><span>Change team…</span></div>
          {snap.teams.map(t => (
            <MenuItem
              key={t.id}
              icon={<span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 8, width: 16, height: 16 }}>{t.key.slice(0, 2)}</span>}
              label={t.name} selected={t.id === team.id}
              onClick={() => { switchTeam(t); teamMenu.close(); }}
            />
          ))}
        </Menu>
      )}
      {statusMenu.anchor && (
        <Menu anchor={statusMenu.anchor} onClose={statusMenu.close}>
          <div className="menu-header"><span>Change status…</span></div>
          {snap.states.filter(s => s.teamId === team.id).map((s, i) => (
            <MenuItem key={s.id} icon={<StateIcon type={s.type} color={s.color} />} label={s.name} selected={s.id === current?.id}
              right={<span className="kbd">{i + 1}</span>} onClick={() => { setStatusId(s.id); statusMenu.close(); }} />
          ))}
        </Menu>
      )}
      {priorityMenu.anchor && (
        <Menu anchor={priorityMenu.anchor} onClose={priorityMenu.close}>
          <div className="menu-header"><span>Set priority to…</span></div>
          {([[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']] as Array<[Priority, string]>).map(([v, label], i) => (
            <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={label} selected={priority === v}
              right={<span className="kbd">{i}</span>} onClick={() => { setPriority(v); priorityMenu.close(); }} />
          ))}
        </Menu>
      )}
      {assigneeMenu.anchor && (
        <Menu anchor={assigneeMenu.anchor} onClose={assigneeMenu.close}>
          <div className="menu-header"><span>Assign to…</span></div>
          {snap.users.filter(u => u.kind !== 'agent').map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} selected={u.id === assigneeId} onClick={() => { setAssigneeId(u.id); assigneeMenu.close(); }} />
          ))}
          {snap.users.some(u => u.kind === 'agent') && (
            <>
              <MenuSep />
              <div className="menu-header"><span>Agents</span></div>
              {snap.users.filter(u => u.kind === 'agent').map(u => (
                <MenuItem
                  key={u.id} icon={<Avatar user={u} size={18} />}
                  label={u.name}
                  selected={u.id === assigneeId} onClick={() => { setAssigneeId(u.id); assigneeMenu.close(); }}
                />
              ))}
            </>
          )}
          <MenuSep />
          <MenuItem icon={<IconUser size={14} />} label="No assignee" selected={!assigneeId}
            onClick={() => { setAssigneeId(null); assigneeMenu.close(); }} />
        </Menu>
      )}
      {labelsMenu.anchor && (
        <Menu anchor={labelsMenu.anchor} onClose={labelsMenu.close} width={244}>
          <div className="menu-header"><span>Add labels…</span></div>
          {/* create-on-the-fly row: dot cycles the color, Enter or Add creates + applies */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 8px 8px' }} onClick={e => e.stopPropagation()}>
            <button
              className="icon-btn" title="Change color"
              style={{ width: 22, height: 22, flex: 'none' }}
              onClick={() => setNewLabelColor(c => LABEL_COLORS[(LABEL_COLORS.indexOf(c) + 1) % LABEL_COLORS.length])}
            >
              <span className="label-dot" style={{ background: newLabelColor, width: 11, height: 11 }} />
            </button>
            <input
              className="text-input"
              style={{ flex: 1, minWidth: 0, height: 28, fontSize: 12.5 }}
              placeholder="New label…"
              value={newLabelName}
              onChange={e => setNewLabelName(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void createLabelInline(); } }}
            />
            <button className="btn" style={{ height: 26, fontSize: 12, flex: 'none' }} disabled={!newLabelName.trim()} onClick={() => void createLabelInline()}>Add</button>
          </div>
          {teamLabels.length > 0 && <MenuSep />}
          {/* raw menu-item buttons (not MenuItem) so a toggle doesn't auto-close and multi-select stays open */}
          {teamLabels.map(l => {
            const on = labelIds.includes(l.id);
            return (
              <button key={l.id} className="menu-item"
                onClick={() => setLabelIds(prev => prev.includes(l.id) ? prev.filter(x => x !== l.id) : [...prev, l.id])}>
                <span className="mi-icon"><span className="label-dot" style={{ background: l.color }} /></span>
                <span className="mi-label">{l.name}</span>
                <span className="mi-right">{on && <IconCheck size={13} />}</span>
              </button>
            );
          })}
        </Menu>
      )}
      {projectMenu.anchor && (
        <Menu anchor={projectMenu.anchor} onClose={projectMenu.close} width={244}>
          <div className="menu-header"><span>Add to project…</span></div>
          {snap.projects.map(p => (
            <MenuItem key={p.id} icon={<span className="proj-icon" style={{ background: 'var(--bg-hover)' }}>{p.icon}</span>} label={p.name}
              selected={projectId === p.id} onClick={() => { if (p.id !== projectId) setMilestoneId(null); setProjectId(p.id); projectMenu.close(); }} />
          ))}
          <MenuSep />
          <MenuItem label="No project" selected={!projectId} onClick={() => { setProjectId(null); setMilestoneId(null); projectMenu.close(); }} />
        </Menu>
      )}
      {cycleMenu.anchor && (
        <Menu anchor={cycleMenu.anchor} onClose={cycleMenu.close} width={240}>
          <div className="menu-header"><span>Add to cycle…</span></div>
          {openCycles.map((c, i) => (
            <MenuItem key={c.id} icon={<IconCycle size={14} />} label={cycleName(c)} selected={cycleId === c.id}
              right={<span className="mi-hint">{c.startsAt <= nowIso ? 'Current' : i === 0 || openCycles[i - 1]?.startsAt <= nowIso ? 'Upcoming' : shortDate(c.startsAt)}</span>}
              onClick={() => { setCycleId(c.id); cycleMenu.close(); }} />
          ))}
          <MenuSep />
          <MenuItem label="No cycle" selected={!cycleId} onClick={() => { setCycleId(null); cycleMenu.close(); }} />
        </Menu>
      )}
      {milestoneMenu.anchor && (
        <Menu anchor={milestoneMenu.anchor} onClose={milestoneMenu.close} width={240}>
          <div className="menu-header"><span>Set milestone…</span></div>
          {milestones.map(m => (
            <MenuItem key={m.id} icon={<IconMilestone size={14} />} label={m.name} selected={milestoneId === m.id} onClick={() => { setMilestoneId(m.id); milestoneMenu.close(); }} />
          ))}
          <MenuSep />
          <MenuItem label="No milestone" selected={!milestoneId} onClick={() => { setMilestoneId(null); milestoneMenu.close(); }} />
        </Menu>
      )}
      {moreMenu.anchor && (
        <MorePropsMenu
          scale={teamScale(team)}
          anchor={moreMenu.anchor}
          onClose={moreMenu.close}
          initialPhase={morePhase}
          dueDate={dueDate}
          estimate={estimate}
          setDueDate={setDueDate}
          setEstimate={setEstimate}
        />
      )}
      </div>
    </Modal>
    )}
    </AnimatePresence>
  );
}

function MorePropsMenu(props: {
  anchor: DOMRect;
  onClose: () => void;
  initialPhase?: 'root' | 'due' | 'estimate';
  dueDate: string | null;
  estimate: number | null;
  setDueDate: (d: string | null) => void;
  setEstimate: (e: number | null) => void;
  /** the team's estimate scale (Settings › team › Estimates) */
  scale: Array<{ value: number; label: string }>;
}) {
  const [phase, setPhase] = useState<'root' | 'due' | 'estimate'>(props.initialPhase ?? 'root');
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const isoOf = (d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const now = new Date();

  if (phase === 'due') {
    return (
      <Menu key={phase} anchor={props.anchor} onClose={() => { setPhase('root'); props.onClose(); }} width={236}>
        <div className="menu-header"><span>Due date</span></div>
        <div style={{ display: 'flex', gap: 4, padding: '2px 6px 6px', flexWrap: 'wrap' }}>
          {[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([label, off]) => (
            <button key={label as string} className="prop-chip boxed" style={{ height: 22, fontSize: 11.5 }}
              onClick={() => { props.setDueDate(new Date(Date.now() + (off as number) * 86400000).toISOString().slice(0, 10)); setPhase('root'); props.onClose(); }}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '2px 8px' }}>
          <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => setCursor(new Date(y, m - 1, 1))}>‹</button>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 12.5, fontWeight: 600 }}>{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => setCursor(new Date(y, m + 1, 1))}>›</button>
        </div>
        <div className="cal-grid">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="cal-dow">{d}</span>)}
          {cells.map((d, i) => {
            if (d === null) return <span key={i} />;
            const iso = isoOf(d);
            const isToday = y === now.getFullYear() && m === now.getMonth() && d === now.getDate();
            return (
              <button key={i} className={`cal-day ${props.dueDate?.slice(0, 10) === iso ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => { props.setDueDate(iso); setPhase('root'); props.onClose(); }}>{d}</button>
            );
          })}
        </div>
        {props.dueDate && <MenuItem icon={<IconClose size={13} />} label="Clear due date" onClick={() => { props.setDueDate(null); setPhase('root'); props.onClose(); }} />}
      </Menu>
    );
  }
  if (phase === 'estimate') {
    return (
      <Menu key={phase} anchor={props.anchor} onClose={() => { setPhase('root'); props.onClose(); }} width={200}>
        <div className="menu-header"><span>Set estimate to…</span></div>
        <MenuItem label="No estimate" selected={props.estimate == null}
          onClick={() => { props.setEstimate(null); setPhase('root'); props.onClose(); }} />
        {props.scale.filter(s => s.value > 0).map(({ value: pt, label }) => (
          <MenuItem key={pt} icon={<span className="est-glyph">{label}</span>}
            label={`${pt} point${pt > 1 ? 's' : ''}`} selected={props.estimate === pt}
            onClick={() => { props.setEstimate(pt); setPhase('root'); props.onClose(); }} />
        ))}
      </Menu>
    );
  }
  return (
    <Menu key={phase} anchor={props.anchor} onClose={props.onClose} width={220}>
      <div className="menu-header"><span>More properties</span></div>
      {/* raw menu-item buttons (not MenuItem), because MenuItem auto-closes the menu on
          click, which would unmount it before the due/estimate phase can render */}
      <button className="menu-item" onClick={() => setPhase('due')}>
        <span className="mi-icon"><IconCalendar size={14} /></span>
        <span className="mi-label">{props.dueDate ? `Due ${shortDate(props.dueDate)}` : 'Set due date…'}</span>
      </button>
      <button className="menu-item" onClick={() => setPhase('estimate')}>
        <span className="mi-icon"><IconEstimate size={14} /></span>
        <span className="mi-label">{props.estimate != null ? `${props.estimate} point${props.estimate !== 1 ? 's' : ''}` : 'Set estimate…'}</span>
      </button>
    </Menu>
  );
}
