// Inline sub-issue composer on the issue page: a card that opens in place under the sub-issue list,
// pre-filled from the parent (team, priority, assignee, cycle, project). Enter creates and keeps the
// card open for the next one, so breaking an issue down is one keystroke per piece.

import { useEffect, useRef, useState } from 'react';
import { useApp, shortDate } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { StateIcon, PriorityIcon, Avatar, CalendarGrid } from './pickers.js';
import { IconEstimate, IconTag, IconCycle, IconMore, IconUser, IconBox, IconCalendar, IconCheck, IconClose, IconFolder } from './icons.js';
import { teamScale } from '../../src/core/types.js';
import type { Issue, Priority } from '../../src/core/types.js';

const PRIORITIES: Array<[Priority, string]> = [[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']];

export function SubIssueComposer(props: { parent: Issue; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const parent = props.parent;
  const team = snap.teams.find(t => t.id === parent.teamId)!;
  const teamStates = snap.states.filter(s => s.teamId === team.id).sort((a, b) => a.position - b.position);
  const defaultState = () => teamStates.find(s => s.type === 'unstarted')?.id ?? teamStates[0]?.id ?? '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateId, setStateId] = useState(defaultState);
  const [priority, setPriority] = useState<Priority>(parent.priority);
  const [assigneeId, setAssigneeId] = useState<string | null>(parent.assigneeId);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [cycleId, setCycleId] = useState<string | null>(parent.cycleId);
  const [projectId, setProjectId] = useState<string | null>(parent.projectId);
  // one location per task: until you pick one, a sub-task starts where its parent happens
  // (the server's default, shown here but never sent)
  const [pickedLocation, setPickedLocation] = useState<{ id: string | null } | null>(null);
  const setLocationId = (id: string | null) => setPickedLocation({ id });
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const status = useMenu(), prio = useMenu(), who = useMenu(), est = useMenu(), lbl = useMenu(), cyc = useMenu(), more = useMenu(), locMenu = useMenu();
  const [morePhase, setMorePhase] = useState<'root' | 'project' | 'due'>('root');

  useEffect(() => { titleRef.current?.focus(); cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, []);
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [description]);

  const st = teamStates.find(s => s.id === stateId);
  const assignee = snap.users.find(u => u.id === assigneeId);
  const labels = snap.labels.filter(l => labelIds.includes(l.id));
  const teamLabels = snap.labels.filter(l => l.teamId === team.id);
  const cycle = snap.cycles.find(c => c.id === cycleId);
  const teamCycles = snap.cycles.filter(c => c.teamId === team.id && !c.completedAt).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const project = snap.projects.find(p => p.id === projectId);
  const locationId = pickedLocation ? pickedLocation.id : parent.locationId;
  const loc = snap.locations.find(l => l.id === locationId);
  const locOrder = [...(project?.locationIds ?? []).map(id => snap.locations.find(l => l.id === id)).filter((l): l is NonNullable<typeof l> => !!l),
    ...snap.locations.filter(l => !(project?.locationIds ?? []).includes(l.id))];

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const { issue } = await api.createIssue({
        teamId: team.id, title: title.trim(), description, stateId, priority, assigneeId,
        labelIds, projectId, cycleId, dueDate, estimate, parentId: parent.id,
        ...(pickedLocation ? { locationId: pickedLocation.id } : {}),
      });
      await useApp.getState().bootstrap();
      useApp.getState().toast({ title: 'Sub-issue created', line: <>{team.key}-{issue.number} — {issue.title}</> });
      // stay open for the next piece; properties carry over, the text doesn't
      setTitle('');
      setDescription('');
      titleRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('.menu') || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void create(); return; }
    if (e.key === 'Enter' && !e.shiftKey && e.target === titleRef.current) { e.preventDefault(); void create(); }
  };

  return (
    <div className="subc" ref={cardRef} onKeyDown={onKeyDown}>
      <div className="subc-title">
        <button className="subc-status" title="Change status" onClick={status.open}>
          {st && <StateIcon type={st.type} color={st.color} size={14} />}
        </button>
        <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="Issue title" spellCheck={false} />
      </div>
      <textarea ref={descRef} className="subc-desc" rows={1} value={description} onChange={e => setDescription(e.target.value)}
        placeholder="Add description…" spellCheck={false} />
      <div className="subc-chips">
        <span className="prop-chip boxed static" title={`Team: ${team.name}`}>
          <span className="cm-team-mark" style={{ background: team.color }}>{team.key.slice(0, 1)}</span>{team.key}
        </span>
        <button className={`prop-chip boxed${priority ? ' set' : ''}`} onClick={prio.open}>
          <PriorityIcon priority={priority} size={13} /><span className="chip-text">{priority ? PRIORITIES[priority][1] : 'Priority'}</span>
        </button>
        <button className={`prop-chip boxed${assignee ? ' set' : ''}`} onClick={who.open}>
          {assignee ? <Avatar user={assignee} size={16} /> : <IconUser size={13} />}
          <span className="chip-text">{assignee?.name ?? 'Assignee'}</span>
        </button>
        <button className={`prop-chip boxed${estimate != null ? ' set' : ''}`} onClick={est.open}>
          <IconEstimate size={13} /><span className="chip-text">{estimate != null ? `${estimate} pt${estimate !== 1 ? 's' : ''}` : 'Estimate'}</span>
        </button>
        <button className={`prop-chip boxed${labels.length ? ' set' : ''}`} onClick={lbl.open}>
          {labels.length
            ? <span className="cm-label-dots">{labels.slice(0, 3).map(l => <span key={l.id} className="label-dot" style={{ background: l.color }} />)}</span>
            : <IconTag size={13} />}
          <span className="chip-text">{labels.length === 0 ? 'Labels' : labels.length === 1 ? labels[0].name : `${labels.length} labels`}</span>
        </button>
        {teamCycles.length > 0 && (
          <button className={`prop-chip boxed${cycle ? ' set' : ''}`} onClick={cyc.open}>
            <IconCycle size={13} /><span className="chip-text">{cycle ? (cycle.name || `Cycle ${cycle.number}`) : 'Cycle'}</span>
          </button>
        )}
        {(snap.locations.length > 0 || loc) && (
          <button className={`prop-chip boxed${loc ? ' set' : ''}`} onClick={locMenu.open} title={loc ? loc.path : 'Where agents work on it'}>
            <IconFolder size={13} /><span className="chip-text">{loc?.name ?? 'Location'}</span>
          </button>
        )}
        {project && project.id !== parent.projectId && (
          <button className="prop-chip boxed set" onClick={e => { setMorePhase('project'); more.open(e); }}>
            <span className="fav-emoji">{project.icon}</span><span className="chip-text">{project.name}</span>
          </button>
        )}
        {dueDate && (
          <button className="prop-chip boxed set" onClick={e => { setMorePhase('due'); more.open(e); }}>
            <IconCalendar size={13} /><span className="chip-text">{shortDate(dueDate)}</span>
          </button>
        )}
        <button className="prop-chip boxed" title="More properties" onClick={e => { setMorePhase('root'); more.open(e); }}><IconMore size={13} /></button>
      </div>
      <div className="subc-footer">
        <button className="btn secondary" onClick={props.onClose}>Cancel</button>
        <button className="btn" disabled={!title.trim() || busy} onClick={() => void create()} title="Create (↵)">Create</button>
      </div>

      {status.anchor && (
        <Menu anchor={status.anchor} onClose={status.close}>
          <div className="menu-header"><span>Change status…</span></div>
          {teamStates.map((s, i) => (
            <MenuItem key={s.id} icon={<StateIcon type={s.type} color={s.color} />} label={s.name} selected={s.id === stateId}
              right={<span className="kbd">{i + 1}</span>} onClick={() => setStateId(s.id)} />
          ))}
        </Menu>
      )}
      {prio.anchor && (
        <Menu anchor={prio.anchor} onClose={prio.close}>
          <div className="menu-header"><span>Set priority to…</span></div>
          {PRIORITIES.map(([v, label], i) => (
            <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={label} selected={priority === v}
              right={<span className="kbd">{i}</span>} onClick={() => setPriority(v)} />
          ))}
        </Menu>
      )}
      {who.anchor && (
        <Menu anchor={who.anchor} onClose={who.close}>
          <div className="menu-header"><span>Assign to…</span></div>
          {snap.users.filter(u => u.kind !== 'agent').map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} selected={u.id === assigneeId} onClick={() => setAssigneeId(u.id)} />
          ))}
          <MenuSep />
          <div className="menu-header"><span>Agents</span></div>
          {snap.users.filter(u => u.kind === 'agent').map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />}
              label={u.name}
              selected={u.id === assigneeId} onClick={() => setAssigneeId(u.id)} />
          ))}
          <MenuSep />
          <MenuItem icon={<IconUser size={14} />} label="No assignee" selected={!assigneeId} onClick={() => setAssigneeId(null)} />
        </Menu>
      )}
      {est.anchor && (
        <Menu anchor={est.anchor} onClose={est.close} width={200}>
          <div className="menu-header"><span>Set estimate to…</span></div>
          <MenuItem label="No estimate" selected={estimate == null} onClick={() => setEstimate(null)} />
          {teamScale(snap.teams.find(t => t.id === props.parent.teamId)).filter(x => x.value > 0).map(({ value: pt, label }) => (
            <MenuItem key={pt} icon={<span className="est-num">{label}</span>} label={`${pt} point${pt > 1 ? 's' : ''}`} selected={estimate === pt} onClick={() => setEstimate(pt)} />
          ))}
        </Menu>
      )}
      {lbl.anchor && (
        <Menu anchor={lbl.anchor} onClose={lbl.close} width={224}>
          <div className="menu-header"><span>Add labels…</span></div>
          {teamLabels.length === 0 && <div className="menu-header"><span>No labels in {team.name}</span></div>}
          {/* raw rows so toggling keeps the menu open */}
          {teamLabels.map(l => (
            <button key={l.id} className="menu-item" onClick={() => setLabelIds(prev => prev.includes(l.id) ? prev.filter(x => x !== l.id) : [...prev, l.id])}>
              <span className="mi-icon"><span className="label-dot" style={{ background: l.color }} /></span>
              <span className="mi-label">{l.name}</span>
              <span className="mi-right">{labelIds.includes(l.id) && <IconCheck size={13} />}</span>
            </button>
          ))}
        </Menu>
      )}
      {cyc.anchor && (
        <Menu anchor={cyc.anchor} onClose={cyc.close} width={220}>
          <div className="menu-header"><span>Add to cycle…</span></div>
          {teamCycles.map(c => (
            <MenuItem key={c.id} icon={<IconCycle size={14} />} label={c.name || `Cycle ${c.number}`} selected={c.id === cycleId} onClick={() => setCycleId(c.id)} />
          ))}
          <MenuSep />
          <MenuItem label="No cycle" selected={!cycleId} onClick={() => setCycleId(null)} />
        </Menu>
      )}
      {locMenu.anchor && (
        <Menu anchor={locMenu.anchor} onClose={locMenu.close} width={240}>
          <div className="menu-header"><span>Set location…</span></div>
          {locOrder.map(l => (
            <MenuItem key={l.id} icon={<IconFolder size={14} />} label={l.name} selected={l.id === locationId} onClick={() => setLocationId(l.id)} />
          ))}
          <MenuSep />
          <MenuItem label="No location" selected={!locationId} onClick={() => setLocationId(null)} />
        </Menu>
      )}
      {more.anchor && (
        <Menu key={morePhase} anchor={more.anchor} onClose={more.close} width={morePhase === 'due' ? 236 : 224}>
          {morePhase === 'root' && (
            <>
              <div className="menu-header"><span>More properties</span></div>
              {/* raw rows: MenuItem would close the menu before the next phase renders */}
              <button className="menu-item" onClick={() => setMorePhase('project')}>
                <span className="mi-icon"><IconBox size={14} /></span><span className="mi-label">{project ? project.name : 'Add to project…'}</span>
              </button>
              <button className="menu-item" onClick={() => setMorePhase('due')}>
                <span className="mi-icon"><IconCalendar size={14} /></span><span className="mi-label">{dueDate ? `Due ${shortDate(dueDate)}` : 'Set due date…'}</span>
              </button>
            </>
          )}
          {morePhase === 'project' && (
            <>
              <div className="menu-header"><span>Add to project…</span></div>
              {snap.projects.map(p => (
                <MenuItem key={p.id} icon={<span className="fav-emoji">{p.icon}</span>} label={p.name} selected={p.id === projectId} onClick={() => setProjectId(p.id)} />
              ))}
              <MenuSep />
              <MenuItem label="No project" selected={!projectId} onClick={() => setProjectId(null)} />
            </>
          )}
          {morePhase === 'due' && (
            <>
              <div className="menu-header"><span>Due date</span></div>
              <CalendarGrid selected={dueDate?.slice(0, 10)} onPick={iso => { setDueDate(iso); more.close(); }} />
              {dueDate && <MenuItem icon={<IconClose size={13} />} label="Clear due date" onClick={() => setDueDate(null)} />}
            </>
          )}
        </Menu>
      )}
    </div>
  );
}
