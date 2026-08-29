import { useEffect, useRef, useState } from 'react';
import { useApp, refresh, shortDate } from './store.js';
import { api } from './api.js';
import { Modal, Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { IconClose, IconExpand, IconEmoji, IconTag, IconCalendar, IconEstimate, IconMore, IconChevronDown, IconSubIssue } from './icons.js';
import type { Priority, Team } from '../../src/core/types.js';

const SUGGESTIONS: Array<[RegExp, string]> = [
  [/\b(bug|crash|error|broken|fix|fails?|regression)\b/i, 'Bug'],
  [/\b(feature|add|support|implement|introduce)\b/i, 'Feature'],
  [/\b(improve|refactor|polish|cleanup|optimi[sz]e|speed)\b/i, 'Improvement'],
];

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

  const titleRef = useRef<HTMLInputElement>(null);
  const teamMenu = useMenu();
  const statusMenu = useMenu();
  const priorityMenu = useMenu();
  const assigneeMenu = useMenu();
  const labelsMenu = useMenu();
  const projectMenu = useMenu();
  const moreMenu = useMenu();

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

  const team: Team | undefined = snap ? (teamId ? snap.teams.find(t => t.id === teamId) : snap.teams[0]) : undefined;
  const states = snap ? snap.states.filter(s => s.teamId === team?.id) : [];
  const current = states.find(s => s.id === statusId) ?? states[0];
  const selectedLabels = snap?.labels.filter(l => labelIds.includes(l.id)) ?? [];
  const teamLabels = snap?.labels.filter(l => l.teamId === team?.id) ?? [];
  const suggestion = title.trim()
    ? SUGGESTIONS.find(([re, name]) => re.test(title) && !selectedLabels.some(l => l.name === name))
    : undefined;
  const parent = state.parentId && snap ? snap.issues.find(i => i.id === state.parentId) : undefined;
  const parentKey = parent ? `${snap?.teams.find(t => t.id === parent.teamId)?.key}-${parent.number}` : '';

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
  };

  return (
    <Modal onClose={closeCreate}>
      <div className="cm-header">
        <button className="cm-team" onClick={teamMenu.open} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="ws-avatar" style={{ background: team.color, borderRadius: 4, fontSize: 9, width: 18, height: 18 }}>{team.key.slice(0, 2)}</span>
          <span>{team.key}</span>
          <IconChevronDown size={12} style={{ color: 'var(--text-dim)' }} />
        </button>
        <span className="crumb-sep">›</span>
        {parent ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
            <IconSubIssue size={13} /> New sub-issue of <b style={{ color: 'var(--text-primary)' }}>{parentKey}</b>
          </span>
        ) : (
          <span>New issue</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          {title.trim() && <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={saveDraft}>Save as draft</button>}
          <button className="icon-btn"><IconExpand size={14} /></button>
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
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create(); }}
          placeholder="Issue title"
          spellCheck={false}
        />
      </div>
      <div className="cm-desc">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create(); }}
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

      <div className="cm-pills">
        <button className="prop-chip boxed" onClick={statusMenu.open}>
          {current && <StateIcon type={current.type} color={current.color} size={13} />}
          {current?.name ?? 'Status'}
        </button>
        <button className="prop-chip boxed" onClick={priorityMenu.open}>
          <PriorityIcon priority={priority} size={13} />
          {priority === 0 ? 'Priority' : ['', 'Urgent', 'High', 'Medium', 'Low'][priority]}
        </button>
        <button className="prop-chip boxed" onClick={assigneeMenu.open}>
          <Avatar user={snap.users.find(u => u.id === assigneeId)} size={16} />
          {assigneeId ? snap.users.find(u => u.id === assigneeId)?.name.split(' ')[0] : 'Assignee'}
        </button>
        <button className="prop-chip boxed" onClick={labelsMenu.open}>
          <IconTag size={13} />
          {selectedLabels.length ? selectedLabels.map(l => l.name).join(', ') : 'Labels'}
        </button>
        <button className="prop-chip boxed" onClick={projectMenu.open}>
          {projectId ? snap.projects.find(p => p.id === projectId)?.name : 'Project'}
        </button>
        {dueDate && (
          <button className="prop-chip boxed" onClick={moreMenu.open}>
            <IconCalendar size={13} /> {shortDate(dueDate)}
          </button>
        )}
        {estimate != null && (
          <button className="prop-chip boxed" onClick={moreMenu.open}>
            <IconEstimate size={13} /> {estimate} pt{estimate !== 1 ? 's' : ''}
          </button>
        )}
        <button className="prop-chip boxed" style={{ opacity: 0.7 }} onClick={moreMenu.open} title="More properties">
          <IconMore size={13} />
        </button>
      </div>

      <div className="cm-footer">
        <button className="icon-btn"><IconEmoji size={15} /></button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <button className={`toggle ${createMore ? 'on' : ''}`} onClick={() => setCreateMore(v => !v)} aria-label="Create more" />
            Create more
          </span>
          <button className="btn primary" onClick={create} disabled={!title.trim()}>
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
          {snap.users.map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} selected={u.id === assigneeId} onClick={() => { setAssigneeId(u.id); assigneeMenu.close(); }} />
          ))}
          <MenuSep />
          <MenuItem label="No assignee" selected={!assigneeId} onClick={() => { setAssigneeId(null); assigneeMenu.close(); }} />
        </Menu>
      )}
      {labelsMenu.anchor && (
        <Menu anchor={labelsMenu.anchor} onClose={labelsMenu.close} width={244}>
          <div className="menu-header"><span>Add labels…</span><span className="kbd">L</span></div>
          {teamLabels.map(l => (
            <MenuItem
              key={l.id}
              icon={<span className="label-dot" style={{ background: l.color }} />}
              label={l.name}
              selected={labelIds.includes(l.id)}
              onClick={() => setLabelIds(prev => prev.includes(l.id) ? prev.filter(x => x !== l.id) : [...prev, l.id])}
            />
          ))}
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
          dueDate={dueDate}
          estimate={estimate}
          setDueDate={setDueDate}
          setEstimate={setEstimate}
        />
      )}
    </Modal>
  );
}

function MorePropsMenu(props: {
  anchor: DOMRect;
  onClose: () => void;
  dueDate: string | null;
  estimate: number | null;
  setDueDate: (d: string | null) => void;
  setEstimate: (e: number | null) => void;
}) {
  const [phase, setPhase] = useState<'root' | 'due' | 'estimate'>('root');
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
      <Menu anchor={props.anchor} onClose={() => { setPhase('root'); props.onClose(); }} width={236}>
        <div className="menu-header"><span>Due date</span></div>
        <div style={{ display: 'flex', gap: 4, padding: '2px 6px 6px', flexWrap: 'wrap' }}>
          {[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([label, off]) => (
            <button key={label as string} className="prop-chip boxed" style={{ height: 22, fontSize: 11.5 }}
              onClick={() => { props.setDueDate(new Date(Date.now() + (off as number) * 86400000).toISOString().slice(0, 10)); setPhase('root'); props.onClose(); }}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '2px 8px' }}>
          <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => setCursor(new Date(y, m - 1, 1))}>‹</button>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 12.5, fontWeight: 560 }}>{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
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
      <Menu anchor={props.anchor} onClose={() => { setPhase('root'); props.onClose(); }} width={200}>
        <div className="menu-header"><span>Set estimate to…</span></div>
        <MenuItem label="No estimate" selected={props.estimate == null}
          onClick={() => { props.setEstimate(null); setPhase('root'); props.onClose(); }} />
        {[1, 2, 3, 5, 8, 13, 21].map(pt => (
          <MenuItem key={pt} icon={<span style={{ fontSize: 12, fontWeight: 590, width: 16, textAlign: 'center' }}>{pt}</span>}
            label={`point${pt > 1 ? 's' : ''}`} selected={props.estimate === pt}
            onClick={() => { props.setEstimate(pt); setPhase('root'); props.onClose(); }} />
        ))}
      </Menu>
    );
  }
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={220}>
      <div className="menu-header"><span>More properties</span></div>
      <MenuItem icon={<IconCalendar size={14} />} label={props.dueDate ? `Due ${shortDate(props.dueDate)}` : 'Set due date…'} onClick={() => setPhase('due')} />
      <MenuItem icon={<IconEstimate size={14} />} label={props.estimate != null ? `${props.estimate} point${props.estimate !== 1 ? 's' : ''}` : 'Set estimate…'} onClick={() => setPhase('estimate')} />
    </Menu>
  );
}
