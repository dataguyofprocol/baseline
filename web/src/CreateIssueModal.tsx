import { useEffect, useRef, useState } from 'react';
import { useApp, refresh, shortDate } from './store.js';
import { api } from './api.js';
import { Modal, Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { IconClose, IconExpand, IconAttach, IconTag, IconCalendar, IconEstimate, IconMore, IconChevronDown, IconSubIssue, IconDoc, IconBox, IconUser, IconCheck } from './icons.js';
import type { Priority, Team } from '../../src/core/types.js';

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
  const [createMore, setCreateMore] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [morePhase, setMorePhase] = useState<'root' | 'due' | 'estimate'>('root');
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[3]);
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | undefined>(undefined);

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const teamMenu = useMenu();
  const statusMenu = useMenu();
  const priorityMenu = useMenu();
  const assigneeMenu = useMenu();
  const labelsMenu = useMenu();
  const projectMenu = useMenu();
  const moreMenu = useMenu();
  const templateMenu = useMenu();

  useEffect(() => {
    if (state.open && snap) {
      const tid = state.teamId ?? snap.teams[0]?.id;
      setTeamId(tid);
      setTitle(state.title ?? '');
      setDescription('');
      setPriority(0);
      setAssigneeId(snap.currentUser?.id ?? null);
      setLabelIds([]);
      setProjectId(state.projectId ?? null);
      setDueDate(null);
      setEstimate(null);
      setCreateMore(false);
      setMoreOpen(false);
      setExpanded(false);
      setAppliedTemplateId(undefined);
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

  // content-height modal: description starts ~3 lines and grows with input,
  // capped at 40vh (in expanded mode the textarea stretches via CSS instead)
  useEffect(() => {
    const el = descRef.current;
    if (!el || !state.open) return;
    if (expanded) { el.style.height = ''; return; }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [description, expanded, state.open]);

  const team: Team | undefined = snap ? (teamId ? snap.teams.find(t => t.id === teamId) : snap.teams[0]) : undefined;
  const states = snap ? snap.states.filter(s => s.teamId === team?.id) : [];
  const current = states.find(s => s.id === statusId) ?? states[0];
  const selectedLabels = snap?.labels.filter(l => labelIds.includes(l.id)) ?? [];
  const teamLabels = snap?.labels.filter(l => l.teamId === team?.id) ?? [];
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
    closeCreate();
    toast({ title: 'Draft saved', line: <>{d.title}</> });
  };
  const discardDraft = () => {
    if (team) { try { localStorage.removeItem(draftKey(team.id)); } catch { /* ignore */ } }
    setDraft(null);
    setTitle('');
    setDescription('');
    setPriority(0);
    setLabelIds([]);
    setDueDate(null);
    setEstimate(null);
    setTimeout(() => titleRef.current?.focus(), 30);
  };

  if (!snap || !team || !state.open) return null;

  const create = async () => {
    if (!title.trim() || !current) return;
    const { issue } = await api.createIssue({
      teamId: team.id, title: title.trim(), description,
      stateId: current.id, priority, assigneeId, labelIds, projectId,
      parentId: state.parentId ?? null, cycleId: state.cycleId ?? null,
      dueDate, estimate,
    });
    try { localStorage.removeItem(draftKey(team.id)); } catch { /* ignore */ }
    await refresh();
    const key = `${team.key}-${issue.number}`;
    const toastBody = {
      title: state.parentId ? 'Sub-issue created' : 'Issue created',
      line: <><StateIcon type={current.type} color={current.color} size={12} /> {key} — {issue.title}</>,
    };
    if (createMore) {
      openCreate({ teamId: team.id, projectId, parentId: state.parentId, cycleId: state.cycleId });
      useApp.getState().toast(toastBody);
    } else {
      closeCreate();
      useApp.getState().toast({ ...toastBody, link: { label: 'View issue', to: `/issue/${key}` } });
    }
  };

  const switchTeam = (t: Team) => {
    setTeamId(t.id);
    setStatusId(snap.states.find(s => s.teamId === t.id && s.type === 'unstarted')?.id ?? snap.states.find(s => s.teamId === t.id)?.id);
    setLabelIds(prev => prev.filter(lid => snap.labels.find(l => l.id === lid)?.teamId === t.id));
    setAppliedTemplateId(undefined);
  };

  // ⌘/Ctrl+Enter creates from anywhere in the modal (menus portal outside this
  // wrapper, but their React events still bubble here — so exclude them)
  const onModalKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('.menu')) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (title.trim() && current) void create();
    } else if (e.key === 'Enter' && !e.shiftKey && e.target === titleRef.current) {
      e.preventDefault();
      descRef.current?.focus();
    }
  };

  return (
    <Modal onClose={closeCreate} className={`modal modal-create ${expanded ? 'expanded' : ''}`}>
      <div className="cm-root" onKeyDown={onModalKeyDown}>
      <div className="cm-header">
        <button className="cm-team" onClick={teamMenu.open} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="ws-avatar" style={{ background: team.color, borderRadius: 4, fontSize: 9, width: 18, height: 18 }}>{team.key.slice(0, 2)}</span>
          <span>{team.key}</span>
          <IconChevronDown size={12} style={{ color: 'var(--text-dim)' }} />
        </button>
        <span className="crumb-sep">›</span>
        {parent ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            <IconSubIssue size={13} style={{ color: 'var(--text-dim)' }} /> New sub-issue of <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{parentKey}</b>
          </span>
        ) : (
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>New issue</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          {title.trim() && <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={saveDraft}>Save as draft</button>}
          <button className="icon-btn" title={expanded ? 'Contract' : 'Expand'} onClick={() => setExpanded(v => !v)}>
            <IconExpand size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 140ms var(--ease)' }} />
          </button>
          <button className="icon-btn" onClick={closeCreate}><IconClose size={14} /></button>
        </span>
      </div>

      {draft && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px 0', fontSize: 12, color: 'var(--text-secondary)' }}>
          <span>Draft restored · saved {shortDate(draft.savedAt)}</span>
          <button className="btn" style={{ height: 20, fontSize: 11 }} onClick={discardDraft}>Discard</button>
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
        <textarea
          ref={descRef}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Add description…"
          spellCheck={false}
        />
      </div>

      {suggestion && (
        <div className="cm-suggest">
          <span style={{ display: 'flex' }}>💡</span>
          Quick suggestions
          <button
            className="label-pill" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
            onClick={() => {
              const l = teamLabels.find(x => x.name === suggestion[1]);
              if (l) setLabelIds(prev => [...prev, l.id]);
            }}
          >
            <span className="label-dot" style={{ background: teamLabels.find(x => x.name === suggestion[1])?.color ?? '#8a8f98' }} />
            {suggestion[1]}
          </button>
        </div>
      )}

      {templates.length > 0 && (
        <div className="cm-suggest">
          <IconDoc size={13} style={{ color: 'var(--text-dim)', display: 'flex' }} />
          Template
          <button
            className="label-pill" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', gap: 4 }}
            onClick={templateMenu.open}
          >
            {appliedTemplate?.name ?? 'None'}
            <IconChevronDown size={10} style={{ color: 'var(--text-dim)' }} />
          </button>
        </div>
      )}
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
        <button className="prop-chip" onClick={statusMenu.open}>
          {current && <StateIcon type={current.type} color={current.color} size={13} />}
          {current?.name ?? 'Status'}
        </button>
        <button className="prop-chip" onClick={priorityMenu.open}>
          <PriorityIcon priority={priority} size={13} />
          {priority === 0 ? 'Priority' : ['', 'Urgent', 'High', 'Medium', 'Low'][priority]}
        </button>
        <button className="prop-chip" onClick={assigneeMenu.open}>
          {assigneeId
            ? <Avatar user={snap.users.find(u => u.id === assigneeId)} size={16} />
            : <IconUser size={13} style={{ color: 'var(--text-dim)', margin: '0 1px' }} />}
          {assigneeId ? snap.users.find(u => u.id === assigneeId)?.name.split(' ')[0] : 'Assignee'}
        </button>
        <button className="prop-chip" onClick={projectMenu.open}>
          <IconBox size={13} style={{ color: 'var(--text-dim)' }} />
          {projectId ? snap.projects.find(p => p.id === projectId)?.name : 'Project'}
        </button>
        <button className="prop-chip" onClick={e => { setMorePhase('estimate'); moreMenu.open(e); }}>
          <IconEstimate size={13} style={{ color: 'var(--text-dim)' }} />
          {estimate != null ? `${estimate} pt${estimate !== 1 ? 's' : ''}` : 'Estimate'}
        </button>
        <button className="prop-chip" onClick={e => { setNewLabelName(''); labelsMenu.open(e); }}>
          <IconTag size={13} style={{ color: 'var(--text-dim)' }} />
          {selectedLabels.length ? selectedLabels.map(l => l.name).join(', ') : 'Labels'}
        </button>
        {dueDate && (
          <button className="prop-chip" onClick={e => { setMorePhase('due'); moreMenu.open(e); }}>
            <IconCalendar size={13} style={{ color: 'var(--text-dim)' }} /> {shortDate(dueDate)}
          </button>
        )}
        <button className="prop-chip" style={{ padding: '0 8px' }} onClick={e => { setMorePhase('root'); moreMenu.open(e); }} title="More properties">
          <IconMore size={13} />
        </button>
      </div>

      <div className="cm-footer">
        <button className="icon-btn" title="Attach file"><IconAttach size={15} /></button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <button className={`toggle ${createMore ? 'on' : ''}`} onClick={() => setCreateMore(v => !v)} aria-label="Create more" />
            Create more
          </span>
          <button className="btn primary" onClick={create} disabled={!title.trim()}>
            {state.parentId ? 'Create sub-issue' : 'Create issue'}
            <span className="btn-kbd kbd">⌘↵</span>
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
          <div className="menu-header"><span>Change status…</span><span className="kbd">S</span></div>
          {snap.states.filter(s => s.teamId === team.id).map((s, i) => (
            <MenuItem key={s.id} icon={<StateIcon type={s.type} color={s.color} />} label={s.name} selected={s.id === current?.id}
              right={<span className="kbd">{i + 1}</span>} onClick={() => { setStatusId(s.id); statusMenu.close(); }} />
          ))}
        </Menu>
      )}
      {priorityMenu.anchor && (
        <Menu anchor={priorityMenu.anchor} onClose={priorityMenu.close}>
          <div className="menu-header"><span>Set priority to…</span><span className="kbd">P</span></div>
          {([[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']] as Array<[Priority, string]>).map(([v, label], i) => (
            <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={label} selected={priority === v}
              right={<span className="kbd">{i}</span>} onClick={() => { setPriority(v); priorityMenu.close(); }} />
          ))}
        </Menu>
      )}
      {assigneeMenu.anchor && (
        <Menu anchor={assigneeMenu.anchor} onClose={assigneeMenu.close}>
          <div className="menu-header"><span>Assign to…</span></div>
          <MenuItem icon={<IconUser size={14} />} label="No assignee" selected={!assigneeId}
            onClick={() => { setAssigneeId(null); assigneeMenu.close(); }} />
          <MenuSep />
          {snap.users.map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} selected={u.id === assigneeId} onClick={() => { setAssigneeId(u.id); assigneeMenu.close(); }} />
          ))}
        </Menu>
      )}
      {labelsMenu.anchor && (
        <Menu anchor={labelsMenu.anchor} onClose={labelsMenu.close} width={244}>
          <div className="menu-header"><span>Add labels…</span><span className="kbd">L</span></div>
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
          {/* raw menu-item buttons (not MenuItem) so a toggle doesn't auto-close — multi-select stays open */}
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
              selected={projectId === p.id} onClick={() => { setProjectId(p.id); projectMenu.close(); }} />
          ))}
          <MenuSep />
          <MenuItem label="No project" selected={!projectId} onClick={() => { setProjectId(null); projectMenu.close(); }} />
        </Menu>
      )}
      {moreMenu.anchor && (
        <MorePropsMenu
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
        {[1, 2, 3, 5, 8, 13, 21].map(pt => (
          <MenuItem key={pt} icon={<span style={{ fontSize: 12, fontWeight: 600, width: 16, textAlign: 'center' }}>{pt}</span>}
            label={`point${pt > 1 ? 's' : ''}`} selected={props.estimate === pt}
            onClick={() => { props.setEstimate(pt); setPhase('root'); props.onClose(); }} />
        ))}
      </Menu>
    );
  }
  return (
    <Menu key={phase} anchor={props.anchor} onClose={props.onClose} width={220}>
      <div className="menu-header"><span>More properties</span></div>
      {/* raw menu-item buttons (not MenuItem) — MenuItem auto-closes the menu on
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
