import { useState } from 'react';
import { Menu, MenuItem, useMenu } from './ui.js';
import { useApp } from './store.js';
import { api } from './api.js';
import type { Issue, Priority, Team } from '../../src/core/types.js';
import { PropertyMenu, type PropKind } from './propertyMenus.js';
import { StatusBacklog, StatusTodo, StatusStarted, StatusDone, StatusCanceled, StatusTriage, PrioNone, PrioUrgent, PrioHigh, PrioMedium, PrioLow, IconUser, IconAgent, IconBlocks, IconBlocked, IconRelated, IconDuplicate, IconClaude } from './icons.js';

export function StateIcon({ type, color, size = 14, morph }: { type: string; color?: string; size?: number; morph?: boolean }) {
  // the seeded Todo grey is near-white — tuned for dark; theme it so it
  // doesn't vanish on a light ground
  const style = color ? { color: color.toLowerCase() === '#e2e2e2' ? 'var(--status-todo-ink)' : color } : undefined;
  if (type === 'triage') return <StatusTriage size={size} style={style ?? { color: '#fc7840' }} />;
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

export function Avatar({ user, size = 20 }: { user?: { name: string; initials: string; color: string; kind?: 'human' | 'agent'; avatarUrl?: string } | null; size?: number }) {
  if (!user) {
    return <span className="avatar placeholder" style={{ width: size, height: size }}><IconUser size={12} /></span>;
  }
  if (user.kind === 'agent' && user.name === 'Claude Code') {
    // the integrated agent wears Claude Code's own mark, on a warm tile
    return (
      <span className="avatar agent claude" title="Claude Code (agent)" style={{ width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.3)) }}>
        <IconClaude size={Math.max(12, Math.round(size * 0.86))} color="#fdf6ee" />
      </span>
    );
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
    <span className="avatar" title={user.name} style={{ width: size, height: size, background: user.color, fontSize: size * 0.42, overflow: 'hidden' }}>
      {/* Google's picture when there is one (no-referrer: googleusercontent refuses some referrers) */}
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user.initials}
    </span>
  );
}

type MenuChildren = (p: { isOpen: boolean; open: (e: React.MouseEvent) => void }) => React.ReactNode;

/* property menus over one issue, opened from any trigger (the rail, chips) — the
   menus themselves live in propertyMenus.tsx so keyboard, palette and rail share them */
function propMenu(kind: PropKind) {
  return function IssuePropMenu(props: { issue: Issue; children: MenuChildren }) {
    const { anchor, open, close, isOpen } = useMenu();
    return (
      <>
        {props.children({ isOpen, open })}
        {anchor && <PropertyMenu kind={kind} issues={[props.issue]} anchor={anchor} onClose={close} />}
      </>
    );
  };
}
export const StatusMenu = propMenu('status');
export const PriorityMenu = propMenu('priority');
export const AssigneeMenu = propMenu('assignee');
export const LabelsMenu = propMenu('labels');
export const ProjectMenu = propMenu('project');
export const MilestoneMenu = propMenu('milestone');
export const DueDateMenu = propMenu('due');
export const EstimateMenu = propMenu('estimate');
export const CycleMenu = propMenu('cycle');
export const ParentMenu = propMenu('parent');
export const TeamMoveMenu = propMenu('team');
export const ESTIMATE_POINTS = [0, 1, 2, 3, 5, 8, 13, 21];

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

/** month calendar grid shared by DueDateMenu and the palette's bulk due-date page */
export function CalendarGrid(props: { selected?: string; onPick: (iso: string) => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const y = cursor.getFullYear(), m = cursor.getMonth();
  // the week starts where Preferences says (Monday by default)
  const weekStart = useApp.getState().snap?.workspace.preferences.firstDayOfWeek ?? 1;
  const firstDow = (new Date(y, m, 1).getDay() - weekStart + 7) % 7;
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
        {(weekStart === 1 ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']).map((d, i) => <span key={i} className="cal-dow">{d}</span>)}
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
