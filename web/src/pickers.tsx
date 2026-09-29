import { useEffect, useMemo, useState } from 'react';
import { Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { useApp, useHelpers } from './store.js';
import { api } from './api.js';
import type { Issue, Priority, Team } from '../../src/core/types.js';
import {
  StatusBacklog, StatusTodo, StatusStarted, StatusDone, StatusCanceled,
  PrioNone, PrioUrgent, PrioHigh, PrioMedium, PrioLow, IconUser, IconUsers, IconAgent,
  IconCycle, IconEstimate, IconClose, IconBlocks, IconBlocked, IconRelated, IconDuplicate,
} from './icons.js';
import { STATUS_ORDER } from './store.js';

export function StateIcon({ type, color, size = 14, morph }: { type: string; color?: string; size?: number; morph?: boolean }) {
  const style = color ? { color } : undefined;
  if (type === 'backlog') return <StatusBacklog size={size} style={style} />;
  if (type === 'unstarted') return <StatusTodo size={size} style={style} />;
  if (type === 'started') return <StatusStarted size={size} style={style} />;
  if (type === 'completed') return <StatusDone size={size} style={style} morph={morph} />;
  return <StatusCanceled size={size} style={style} />;
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  if (priority === 1) return <PrioUrgent size={size} style={{ color: 'var(--prio-urgent)' }} />;
  if (priority === 2) return <PrioHigh size={size} style={{ color: 'var(--prio-high)' }} />;
  if (priority === 3) return <PrioMedium size={size} style={{ color: 'var(--prio-medium)' }} />;
  if (priority === 4) return <PrioLow size={size} style={{ color: 'var(--prio-low)' }} />;
  return <PrioNone size={size} style={{ color: 'var(--text-dim)' }} />;
}

export function Avatar({ user, size = 20 }: { user?: { name: string; initials: string; color: string; kind?: 'human' | 'agent' } | null; size?: number }) {
  if (!user) {
    return <span className="avatar placeholder" style={{ width: size, height: size }}><IconUser size={12} /></span>;
  }
  if (user.kind === 'agent') {
    // agents are tools, not people: a neutral rounded square (never a saturated
    // person-coloured disc) so a glance separates them from human avatars
    return (
      <span className="avatar agent" title={`${user.name} (agent)`} style={{ width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.3)) }}>
        <IconAgent size={Math.max(10, Math.round(size * 0.66))} />
      </span>
    );
  }
  return (
    <span className="avatar" title={user.name} style={{ width: size, height: size, background: user.color, fontSize: size * 0.42 }}>
      {user.initials}
    </span>
  );
}

export function Donut({ percent, size = 16 }: { percent: number; size?: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  // animate from zero on mount so progress reads as movement, then ease on change
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(percent));
    return () => cancelAnimationFrame(raf);
  }, [percent]);
  return (
    <svg className="progress-donut" width={size} height={size} viewBox="0 0 16 16">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="2.4" />
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--brand)" strokeWidth="2.4" strokeDasharray={`${(shown / 100) * c} ${c}`} strokeLinecap="round" />
    </svg>
  );
}

export function StatusMenu(props: { issue: Issue; children: (p: { isOpen: boolean; open: (e: React.MouseEvent) => void }) => React.ReactNode }) {
  const { anchor, open, close, isOpen } = useMenu();
  const { snap } = useApp();
  const states = useMemo(() => snap!.states.filter(s => s.teamId === props.issue.teamId), [snap, props.issue.teamId]);
  const pick = async (stateId: string) => {
    await api.updateIssue(props.issue.id, { stateId });
    await useApp.getState().bootstrap();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={224}>
          <div className="menu-header"><span>Change status…</span><span className="kbd">S</span></div>
          {states.map((s, i) => (
            <MenuItem
              key={s.id}
              icon={<StateIcon type={s.type} color={s.color} />}
              label={s.name}
              selected={s.id === props.issue.stateId}
              right={<span className="kbd">{i + 1}</span>}
              onClick={() => pick(s.id)}
            />
          ))}
        </Menu>
      )}
    </>
  );
}

export function PriorityMenu(props: { issue: Issue; children: (p: { isOpen: boolean; open: (e: React.MouseEvent) => void }) => React.ReactNode }) {
  const { anchor, open, close, isOpen } = useMenu();
  const pick = async (priority: Priority) => {
    await api.updateIssue(props.issue.id, { priority });
    await useApp.getState().bootstrap();
  };
  const opts: Array<[Priority, React.ReactNode, string]> = [
    [0, <PrioNone size={14} />, 'No priority'],
    [1, <PrioUrgent size={14} style={{ color: 'var(--prio-urgent)' }} />, 'Urgent'],
    [2, <PrioHigh size={14} style={{ color: 'var(--prio-high)' }} />, 'High'],
    [3, <PrioMedium size={14} style={{ color: 'var(--prio-medium)' }} />, 'Medium'],
    [4, <PrioLow size={14} style={{ color: 'var(--prio-low)' }} />, 'Low'],
  ];
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={224}>
          <div className="menu-header"><span>Set priority to…</span><span className="kbd">P</span></div>
          {opts.map(([v, icon, label], i) => (
            <MenuItem key={v} icon={icon} label={label} selected={props.issue.priority === v} right={<span className="kbd">{i}</span>} onClick={() => pick(v)} />
          ))}
        </Menu>
      )}
    </>
  );
}

export function AssigneeMenu(props: { issue: Issue; children: (p: { isOpen: boolean; open: (e: React.MouseEvent) => void }) => React.ReactNode }) {
  const { anchor, open, close, isOpen } = useMenu();
  const snap = useApp(s => s.snap)!;
  const pick = async (userId: string | null) => {
    await api.updateIssue(props.issue.id, { assigneeId: userId });
    await useApp.getState().bootstrap();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={224}>
          <div className="menu-header"><span>Assign to…</span></div>
          {snap.users.filter(u => u.kind !== 'agent').map(u => (
            <MenuItem
              key={u.id}
              icon={<Avatar user={u} size={18} />}
              label={u.name}
              selected={props.issue.assigneeId === u.id}
              onClick={() => pick(u.id)}
            />
          ))}
          {snap.users.some(u => u.kind === 'agent') && (
            <>
              <MenuSep />
              <div className="menu-header"><span>Agents</span></div>
              {snap.users.filter(u => u.kind === 'agent').map(u => (
                <MenuItem
                  key={u.id}
                  icon={<Avatar user={u} size={18} />}
                  label={snap.workspace.agentRunner === 'claude' && u.id === snap.workspace.agentUserId
                    ? <>{u.name}<span className="mi-hint">auto-runs</span></>
                    : u.name}
                  selected={props.issue.assigneeId === u.id}
                  onClick={() => pick(u.id)}
                />
              ))}
            </>
          )}
          <MenuSep />
          <MenuItem icon={<IconUser size={14} />} label="No assignee" selected={!props.issue.assigneeId} onClick={() => pick(null)} />
        </Menu>
      )}
    </>
  );
}

export function LabelsMenu(props: { issue: Issue; children: (p: { isOpen: boolean; open: (e: React.MouseEvent) => void }) => React.ReactNode }) {
  const { anchor, open, close, isOpen } = useMenu();
  const snap = useApp(s => s.snap)!;
  const [q, setQ] = useState('');
  const labels = snap.labels.filter(l => l.teamId === props.issue.teamId && l.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = async (labelId: string) => {
    const has = props.issue.labelIds.includes(labelId);
    const labelIds = has ? props.issue.labelIds.filter(l => l !== labelId) : [...props.issue.labelIds, labelId];
    await api.updateIssue(props.issue.id, { labelIds });
    await useApp.getState().bootstrap();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={244}>
          <div className="menu-input"><input autoFocus placeholder="Add labels…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <div className="menu-header"><span>Labels</span><span className="kbd">L</span></div>
          {labels.map(l => (
            <MenuItem
              key={l.id}
              icon={<span className="label-dot" style={{ background: l.color }} />}
              label={l.name}
              selected={props.issue.labelIds.includes(l.id)}
              onClick={() => toggle(l.id)}
            />
          ))}
        </Menu>
      )}
    </>
  );
}

export function ProjectMenu(props: { issue: Issue; children: (p: { isOpen: boolean; open: (e: React.MouseEvent) => void }) => React.ReactNode }) {
  const { anchor, open, close, isOpen } = useMenu();
  const snap = useApp(s => s.snap)!;
  const pick = async (projectId: string | null) => {
    await api.updateIssue(props.issue.id, { projectId });
    await useApp.getState().bootstrap();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={244}>
          <div className="menu-header"><span>Add to project…</span></div>
          {snap.projects.map(p => (
            <MenuItem key={p.id} icon={<span className="proj-icon" style={{ background: 'var(--bg-hover)' }}>{p.icon}</span>} label={p.name} selected={props.issue.projectId === p.id} onClick={() => pick(p.id)} />
          ))}
          <MenuSep />
          <MenuItem label="No project" selected={!props.issue.projectId} onClick={() => pick(null)} />
        </Menu>
      )}
    </>
  );
}

/** status order helper for grouping */
export function sortStates(teamId: string) {
  const { snap } = useApp.getState();
  const states = snap!.states.filter(s => s.teamId === teamId);
  return states.sort((a, b) => {
    const ia = STATUS_ORDER.indexOf(a.type as (typeof STATUS_ORDER)[number]);
    const ib = STATUS_ORDER.indexOf(b.type as (typeof STATUS_ORDER)[number]);
    if (ia !== ib) return ia - ib;
    return a.position - b.position;
  });
}

export function teamDisplayIcon(team: Team) {
  return <span className="ws-avatar" style={{ background: team.color, borderRadius: 4, fontSize: 10 }}>{team.icon?.match(/\p{Emoji}/u) ? team.icon : team.key[0]}</span>;
}

/* ================================================================
   Additional property menus: due date, estimate, cycle, parent,
   relations, project properties, generic issue search picker
   ================================================================ */

export function MenuInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return <div className="menu-input"><input autoFocus={props.autoFocus} placeholder={props.placeholder} value={props.value} onChange={e => props.onChange(e.target.value)} spellCheck={false} /></div>;
}

type MenuChildren = (p: { isOpen: boolean; open: (e: React.MouseEvent) => void }) => React.ReactNode;

/** month calendar grid shared by DueDateMenu and the palette's bulk due-date page */
export function CalendarGrid(props: { selected?: string; onPick: (iso: string) => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const isoOf = (d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const now = new Date();
  return (
    <>
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
            <button key={i} className={`cal-day ${props.selected === iso ? 'selected' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => props.onPick(iso)}>{d}</button>
          );
        })}
      </div>
    </>
  );
}

export function DueDateMenu(props: { issue: { id: string; dueDate: string | null }; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const setDue = async (iso: string | null) => { await api.updateIssue(props.issue.id, { dueDate: iso }); await useApp.getState().bootstrap(); close(); };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={232}>
          <div className="menu-header"><span>Due date</span><span className="kbd">D</span></div>
          <div style={{ display: 'flex', gap: 4, padding: '2px 6px 6px', flexWrap: 'wrap' }}>
            {[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([label, off]) => (
              <button key={label as string} className="prop-chip boxed" style={{ height: 22, fontSize: 11.5 }}
                onClick={() => setDue(new Date(Date.now() + (off as number) * 86400000).toISOString().slice(0, 10))}>{label}</button>
            ))}
          </div>
          <CalendarGrid selected={props.issue.dueDate?.slice(0, 10)} onPick={setDue} />
          {props.issue.dueDate && <MenuItem icon={<IconClose size={13} />} label="Clear due date" onClick={() => setDue(null)} />}
        </Menu>
      )}
    </>
  );
}

export const ESTIMATE_POINTS = [0, 1, 2, 3, 5, 8, 13, 21];
export function EstimateMenu(props: { issue: { id: string; estimate: number | null }; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const pick = async (estimate: number | null) => {
    await api.updateIssue(props.issue.id, { estimate });
    await useApp.getState().bootstrap();
    close();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={200}>
          <div className="menu-header"><span>Set estimate to…</span></div>
          <MenuItem icon={<IconEstimate size={14} />} label="No estimate" selected={props.issue.estimate == null} onClick={() => pick(null)} />
          {ESTIMATE_POINTS.filter(p => p > 0).map(pt => (
            <MenuItem key={pt} icon={<span style={{ fontSize: 12, fontWeight: 600, width: 16, textAlign: 'center' }}>{pt}</span>} label={`point${pt > 1 ? 's' : ''}`} selected={props.issue.estimate === pt} onClick={() => pick(pt)} />
          ))}
        </Menu>
      )}
    </>
  );
}

export function CycleMenu(props: { issue: { id: string; cycleId: string | null; teamId: string }; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const snap = useApp(s => s.snap)!;
  const cycles = snap.cycles.filter(c => c.teamId === props.issue.teamId);
  const pick = async (cycleId: string | null) => {
    await api.updateIssue(props.issue.id, { cycleId });
    await useApp.getState().bootstrap();
    close();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={230}>
          <div className="menu-header"><span>Add to cycle…</span></div>
          <MenuItem icon={<IconCycle size={14} />} label="No cycle" selected={!props.issue.cycleId} onClick={() => pick(null)} />
          {cycles.map(c => (
            <MenuItem key={c.id} icon={<IconCycle size={14} />} label={c.name || `Cycle ${c.number}`} selected={props.issue.cycleId === c.id} onClick={() => pick(c.id)} />
          ))}
        </Menu>
      )}
    </>
  );
}

/** searchable issue picker — used for parents, relations, sub-issue attach */
export function IssuePickerMenu(props: {
  title: string;
  teamId?: string;
  excludeId?: string;
  onPick: (issue: Issue) => Promise<void> | void;
  children: MenuChildren;
}) {
  const { anchor, open, close, isOpen } = useMenu();
  const snap = useApp(s => s.snap)!;
  const [q, setQ] = useState('');
  const pool = snap.issues.filter(i => i.id !== props.excludeId && (!props.teamId || i.teamId === props.teamId));
  const results = (q.trim() ? pool.filter(i => `${i.title} ${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`.toLowerCase().includes(q.toLowerCase())) : pool).slice(0, 8);
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={() => { setQ(''); close(); }} width={300}>
          <MenuInput value={q} onChange={setQ} placeholder={props.title} />
          {results.map(i => {
            const team = snap.teams.find(t => t.id === i.teamId);
            const state = snap.states.find(s => s.id === i.stateId);
            return (
              <MenuItem
                key={i.id}
                icon={state ? <StateIcon type={state.type} color={state.color} /> : undefined}
                label={<span><span style={{ color: 'var(--text-dim)', marginRight: 6 }}>{team?.key}-{i.number}</span>{i.title}</span>}
                onClick={async () => { await props.onPick(i); setQ(''); close(); }}
              />
            );
          })}
          {results.length === 0 && <div className="menu-header"><span>No matching issues</span></div>}
        </Menu>
      )}
    </>
  );
}

const RELATION_TYPES: Array<[string, string, React.ReactNode]> = [
  ['blocks', 'blocks', <IconBlocks size={14} />],
  ['blocked_by', 'is blocked by', <IconBlocked size={14} />],
  ['related', 'relates to', <IconRelated size={14} />],
  ['duplicate', 'duplicates', <IconDuplicate size={14} />],
];

export function AddRelationMenu(props: { issue: Issue; children: MenuChildren }) {
  const [phase, setPhase] = useState<'type' | 'issue'>('type');
  const [type, setType] = useState<string>('related');
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const snap = useApp(s => s.snap)!;
  const pickIssue = async (other: Issue) => {
    await api.addRelation(props.issue.id, other.id, type);
    await useApp.getState().bootstrap();
    setPhase('type');
    setAnchor(null);
  };
  return (
    <>
      {props.children({ isOpen: anchor !== null, open: (e) => { setAnchor(e.currentTarget.getBoundingClientRect()); setPhase('type'); } })}
      {anchor && phase === 'type' && (
        <Menu anchor={anchor} onClose={() => { setAnchor(null); setPhase('type'); }} width={220}>
          <div className="menu-header"><span>Add relationship…</span></div>
          {RELATION_TYPES.map(([value, label, icon]) => (
            <MenuItem key={value} icon={icon} label={label} onClick={() => { setType(value); setPhase('issue'); }} />
          ))}
        </Menu>
      )}
      {anchor && phase === 'issue' && (
        <Menu anchor={anchor} onClose={() => { setAnchor(null); setPhase('type'); }} width={300}>
          <IssueSearchList
            teamId={props.issue.teamId}
            exclude={[props.issue.id, ...snap.relations.filter(r => r.issueId === props.issue.id).map(r => r.relatedIssueId)]}
            onPick={pickIssue}
          />
        </Menu>
      )}
    </>
  );
}

export function IssueSearchList(props: { teamId?: string; exclude?: string[]; onPick: (issue: Issue) => void }) {
  const snap = useApp(s => s.snap)!;
  const [q, setQ] = useState('');
  const pool = snap.issues.filter(i => !props.exclude?.includes(i.id) && (!props.teamId || i.teamId === props.teamId));
  const results = (q.trim() ? pool.filter(i => `${i.title} ${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`.toLowerCase().includes(q.toLowerCase())) : pool).slice(0, 8);
  return (
    <>
      <MenuInput value={q} onChange={setQ} placeholder="Search issues…" autoFocus />
      {results.map(i => {
        const team = snap.teams.find(t => t.id === i.teamId);
        const state = snap.states.find(s => s.id === i.stateId);
        return (
          <MenuItem
            key={i.id}
            icon={state ? <StateIcon type={state.type} color={state.color} /> : undefined}
            label={<span><span style={{ color: 'var(--text-dim)', marginRight: 6 }}>{team?.key}-{i.number}</span>{i.title}</span>}
            onClick={() => props.onPick(i)}
          />
        );
      })}
      {results.length === 0 && <div className="menu-header"><span>No matching issues</span></div>}
    </>
  );
}

/* ---------- project property menus ---------- */
export const PROJECT_STATUS_LABELS: Record<string, string> = { planned: 'Planned', started: 'In Progress', completed: 'Completed', paused: 'Paused' };
export const PROJECT_HEALTH_LABELS: Record<string, string> = { onTrack: 'On track', atRisk: 'At risk', offTrack: 'Off track' };
export const HEALTH_COLORS: Record<string, string> = { onTrack: '#4cb782', atRisk: '#f2994a', offTrack: '#eb5757' };

export function ProjectStatusMenu(props: { project: { id: string; status: string }; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const pick = async (status: string) => {
    await api.updateProject(props.project.id, { status, completedAt: status === 'completed' ? new Date().toISOString() : null });
    await useApp.getState().bootstrap();
    close();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={200}>
          <div className="menu-header"><span>Change status…</span></div>
          {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
            <MenuItem key={value} icon={<span style={{ color: value === 'started' ? '#f2c94c' : value === 'completed' ? '#4cb782' : value === 'paused' ? '#f2994a' : '#8a8f98' }}><StateIcon type={value === 'started' ? 'started' : value === 'completed' ? 'completed' : value === 'paused' ? 'canceled' : 'unstarted'} size={13} /></span>} label={label} selected={props.project.status === value} onClick={() => pick(value)} />
          ))}
        </Menu>
      )}
    </>
  );
}

export function ProjectHealthMenu(props: { project: { id: string; health: string }; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const pick = async (health: string) => {
    await api.updateProject(props.project.id, { health });
    await useApp.getState().bootstrap();
    close();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={180}>
          <div className="menu-header"><span>Set health to…</span></div>
          {Object.entries(PROJECT_HEALTH_LABELS).map(([value, label]) => (
            <MenuItem key={value} icon={<span style={{ color: HEALTH_COLORS[value], fontSize: 12 }}>●</span>} label={label} selected={props.project.health === value} onClick={() => pick(value)} />
          ))}
        </Menu>
      )}
    </>
  );
}

export function ProjectPriorityMenu(props: { project: { id: string; priority: Priority }; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const pick = async (priority: Priority) => {
    await api.updateProject(props.project.id, { priority });
    await useApp.getState().bootstrap();
    close();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={210}>
          <div className="menu-header"><span>Set priority to…</span></div>
          {([[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']] as Array<[Priority, string]>).map(([v, label]) => (
            <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={label} selected={props.project.priority === v} onClick={() => pick(v)} />
          ))}
        </Menu>
      )}
    </>
  );
}

export function UserPickMenu(props: { title: string; value: string | null; allowNone?: boolean; onPick: (userId: string | null) => void; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const snap = useApp(s => s.snap)!;
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={220}>
          <div className="menu-header"><span>{props.title}</span></div>
          {snap.users.map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} selected={props.value === u.id} onClick={() => { props.onPick(u.id); close(); }} />
          ))}
          {props.allowNone !== false && <MenuSep />}
          {props.allowNone !== false && <MenuItem label="None" selected={!props.value} onClick={() => { props.onPick(null); close(); }} />}
        </Menu>
      )}
    </>
  );
}

export function ProjectDatesMenu(props: { project: { id: string; startDate: string | null; targetDate: string | null }; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const [start, setStart] = useState(props.project.startDate?.slice(0, 10) ?? '');
  const [target, setTarget] = useState(props.project.targetDate?.slice(0, 10) ?? '');
  const save = async () => {
    await api.updateProject(props.project.id, { startDate: start || null, targetDate: target || null });
    await useApp.getState().bootstrap();
    close();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={250}>
          <div className="menu-header"><span>Dates</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 10px 10px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--text-secondary)' }}>
              Start date
              <input type="date" className="text-input" value={start} onChange={e => setStart(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--text-secondary)' }}>
              Target date
              <input type="date" className="text-input" value={target} onChange={e => setTarget(e.target.value)} />
            </label>
            <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={save}>Save</button>
          </div>
        </Menu>
      )}
    </>
  );
}

export function MembersMenu(props: { project: { id: string; memberIds: string[] }; children: MenuChildren }) {
  const { anchor, open, close, isOpen } = useMenu();
  const snap = useApp(s => s.snap)!;
  const toggle = async (userId: string) => {
    const memberIds = props.project.memberIds.includes(userId) ? props.project.memberIds.filter(x => x !== userId) : [...props.project.memberIds, userId];
    await api.updateProject(props.project.id, { memberIds });
    await useApp.getState().bootstrap();
  };
  return (
    <>
      {props.children({ isOpen, open })}
      {anchor && (
        <Menu anchor={anchor} onClose={close} width={220}>
          <div className="menu-header"><span>Members</span></div>
          {snap.users.map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} selected={props.project.memberIds.includes(u.id)} onClick={() => toggle(u.id)} />
          ))}
        </Menu>
      )}
    </>
  );
}
