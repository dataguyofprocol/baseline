import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useApp, shortDate, relTime, copyText } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, MenuSub, useMenu, Modal, RegisterMark, useInFlight, Via } from './ui.js';
import { Avatar, PriorityIcon, CalendarGrid, StateIcon } from './pickers.js';
import { AvatarStack } from './AvatarStack.js';
import { RichEditor, isBlank, htmlToMarkdown } from './RichEditor.js';
import type { Editor } from '@tiptap/react';
import { Markdown } from './Markdown.js';
import { ProjectLocationsRow } from './CodingTools.js';
import { Resources } from './Docs.js';
import { ProjectInitiatives } from './Initiatives.js';
import { useViewPrefs, DEFAULT_VIEW_OPTIONS, type ViewOptions } from './IssueViews.js';
import { IssueListBody, ListToolbar, useListLayoutToggle, openFilterMenu, ViewNameSeg } from './Views.js';
import {
  IconPlus, IconStar, IconLink, IconTrash, IconClose, IconCalendar, IconUsers, IconUser, IconEdit, IconMilestone,
  IconChevronDown, IconCheck, IconFilter, IconDisplay, IconList, IconBoard, IconTimeline, IconMore, IconPanel,
  IconBox, IconTag, IconCycle, IconTeam, IconBell, IconViews,
} from './icons.js';
import { UPDATE_CADENCE_LABELS, type Project, type ProjectStatus, type ProjectHealth, type Priority, type Issue, type SavedView, type UpdateCadence } from '../../src/core/types.js';
import { Illustration } from './illustrations.js';

type Snap = NonNullable<ReturnType<typeof useApp.getState>['snap']>;

/* ================= vocabulary ================= */
export const PROJECT_STATUS: Array<[ProjectStatus, string, string]> = [
  ['backlog', 'Backlog', '#95a2b3'], ['planned', 'Planned', '#8a8f98'], ['started', 'In Progress', '#f2c94c'],
  ['paused', 'Paused', '#f2994a'], ['completed', 'Completed', '#5e6ad2'], ['canceled', 'Canceled', '#7d8084'],
];
export const statusLabel = (s: ProjectStatus) => PROJECT_STATUS.find(x => x[0] === s)?.[1] ?? s;
/** the project's named status (Settings › Projects › Statuses), falling back to its category */
export function namedStatus(p: Pick<Project, 'status' | 'statusId'>, snap: Snap): { name: string; color: string } {
  const st = snap.projectStatuses.find(x => x.id === p.statusId);
  return st ? { name: st.name, color: st.color } : { name: statusLabel(p.status), color: PROJECT_STATUS.find(x => x[0] === p.status)?.[2] ?? '#8a8f98' };
}
/** statuses in workflow order: by category, then position */
export function orderedStatuses(snap: Snap) {
  const order = PROJECT_STATUS.map(x => x[0]);
  return [...snap.projectStatuses].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.position - b.position);
}
function ProjectStatusBadge({ project, size = 13 }: { project: Project; size?: number }) {
  const snap = useApp(s => s.snap)!;
  const st = namedStatus(project, snap);
  return <><ProjectStatusIcon status={project.status} size={size} color={st.color} />{st.name}</>;
}
/** project labels on a project, as small chips */
export function ProjectLabelChips({ project, max = 3 }: { project: Pick<Project, 'labelIds'>; max?: number }) {
  const snap = useApp(s => s.snap)!;
  const labels = snap.projectLabels.filter(l => project.labelIds.includes(l.id));
  if (!labels.length) return null;
  return <span className="plabel-chips">{labels.slice(0, max).map(l => <span key={l.id} className="plabel-chip"><span className="label-dot" style={{ background: l.color }} />{l.name}</span>)}{labels.length > max && <span className="plabel-chip">+{labels.length - max}</span>}</span>;
}
const HEALTH: Array<[ProjectHealth, string, string]> = [['onTrack', 'On track', '#4cb782'], ['atRisk', 'At risk', '#f2994a'], ['offTrack', 'Off track', '#eb5757']];
export const healthLabel = (h: ProjectHealth) => HEALTH.find(x => x[0] === h)?.[1] ?? h;
export const healthColor = (h: ProjectHealth) => HEALTH.find(x => x[0] === h)?.[2] ?? '#8a8f98';
const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
const ICONS = ['🧊', '🤖', '📱', '🎨', '🚀', '⚡', '🔧', '📦', '🌐', '💡', '🧪', '📊', '🔒', '🛠️', '📝', '🎯', '🧭', '🔥', '🌱', '🧩', '📣', '💬', '🏗️', '🛰️'];

export function ProjectStatusIcon({ status, size = 14, color: override }: { status: ProjectStatus; size?: number; color?: string }) {
  const color = override ?? PROJECT_STATUS.find(x => x[0] === status)?.[2];
  if (status === 'paused') {
    return (
      <svg width={size} height={size} viewBox="0 0 15 15" fill="none" style={{ color, flex: 'none' }}>
        <circle cx="7.5" cy="7.5" r="5.4" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6 5.4v4.2M9 5.4v4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  const type = status === 'backlog' ? 'backlog' : status === 'planned' ? 'unstarted' : status === 'started' ? 'started' : status === 'completed' ? 'completed' : 'canceled';
  return <span style={{ display: 'inline-flex', color }}><StateIcon type={type} color={color} size={size} /></span>;
}

export function projectProgress(snap: Snap, projectId: string, milestoneId?: string) {
  const issues = snap.issues.filter(i => i.projectId === projectId && (!milestoneId || i.milestoneId === milestoneId));
  const typeOf = (i: Issue) => snap.states.find(s => s.id === i.stateId)?.type;
  const done = issues.filter(i => typeOf(i) === 'completed' || typeOf(i) === 'canceled').length;
  const started = issues.filter(i => typeOf(i) === 'started').length;
  return { total: issues.length, done, started, pct: issues.length ? Math.round((done / issues.length) * 100) : 0 };
}

export function ProgressRing({ pct, size = 14 }: { pct: number; size?: number }) {
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-strong)" strokeWidth="1.6" />
      {pct > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--brand)" strokeWidth="1.6" strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
    </svg>
  );
}

async function patchProject(id: string, patch: Record<string, unknown>) {
  await api.updateProject(id, patch);
  await useApp.getState().bootstrap();
}

/* ================= property menus (filterable, like the issue ones) ================= */
type ProjKind = 'status' | 'priority' | 'lead' | 'members' | 'health' | 'team' | 'start' | 'target' | 'icon' | 'labels' | 'cadence';

function FilterShell(props: { q: string; setQ: (q: string) => void; placeholder: string; children: React.ReactNode }) {
  return (
    <>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
        <input autoFocus value={props.q} onChange={e => props.setQ(e.target.value)} placeholder={props.placeholder} spellCheck={false} />
      </div>
      {props.children}
    </>
  );
}

export function ProjectMenuBody(props: { kind: ProjKind; project: Project; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const p = snap.projects.find(x => x.id === props.project.id) ?? props.project;
  const [q, setQ] = useState('');
  const m = (t: string) => t.toLowerCase().includes(q.trim().toLowerCase());
  switch (props.kind) {
    case 'status': return (
      <FilterShell q={q} setQ={setQ} placeholder="Change status…">
        {orderedStatuses(snap).filter(s => m(s.name)).map((st, n) => (
          <MenuItem key={st.id} icon={<ProjectStatusIcon status={st.type} color={st.color} />} label={st.name} selected={p.statusId ? p.statusId === st.id : p.status === st.type} right={n < 9 ? <span className="kbd">{n + 1}</span> : undefined}
            onClick={() => void patchProject(p.id, { statusId: st.id })} />
        ))}
      </FilterShell>
    );
    case 'priority': return (
      <FilterShell q={q} setQ={setQ} placeholder="Set priority…">
        {([0, 1, 2, 3, 4] as Priority[]).filter(v => m(PRIORITY_LABEL[v])).map(v => (
          <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={PRIORITY_LABEL[v]} selected={p.priority === v} right={<span className="kbd">{v}</span>}
            onClick={() => void patchProject(p.id, { priority: v })} />
        ))}
      </FilterShell>
    );
    case 'health': return (
      <FilterShell q={q} setQ={setQ} placeholder="Set health…">
        {HEALTH.filter(h => m(h[1])).map(([v, l, c]) => (
          <MenuItem key={v} icon={<span className="health-dot" style={{ background: c }} />} label={l} selected={p.health === v} onClick={() => void patchProject(p.id, { health: v })} />
        ))}
      </FilterShell>
    );
    case 'lead': return (
      <FilterShell q={q} setQ={setQ} placeholder="Set lead…">
        {m('No lead') && <MenuItem icon={<IconUser size={14} />} label="No lead" selected={!p.leadId} onClick={() => void patchProject(p.id, { leadId: null })} />}
        {snap.users.filter(u => m(u.name)).map(u => (
          <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={p.leadId === u.id} onClick={() => void patchProject(p.id, { leadId: u.id })} />
        ))}
      </FilterShell>
    );
    case 'members': return (
      <FilterShell q={q} setQ={setQ} placeholder="Change members…">
        {snap.users.filter(u => m(u.name)).map(u => {
          const on = p.memberIds.includes(u.id);
          return (
            <button key={u.id} className="menu-item" onClick={e => { e.stopPropagation(); void patchProject(p.id, { memberIds: on ? p.memberIds.filter(x => x !== u.id) : [...p.memberIds, u.id] }); }}>
              <span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span>
              <span className="mi-icon"><Avatar user={u} size={16} /></span>
              <span className="mi-label">{u.name}</span>
            </button>
          );
        })}
      </FilterShell>
    );
    case 'team': return (
      <FilterShell q={q} setQ={setQ} placeholder="Set team…">
        {snap.teams.filter(t => m(t.name)).map(t => (
          <MenuItem key={t.id} icon={<span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 9, width: 16, height: 16 }}>{t.key[0]}</span>} label={t.name} selected={p.teamId === t.id} onClick={() => void patchProject(p.id, { teamId: t.id })} />
        ))}
      </FilterShell>
    );
    case 'start': case 'target': {
      const key = props.kind === 'start' ? 'startDate' : 'targetDate';
      const cur = p[key]?.slice(0, 10);
      return (
        <>
          <div className="menu-header"><span>{props.kind === 'start' ? 'Start date' : 'Target date'}</span></div>
          <CalendarGrid selected={cur} onPick={async iso => { await patchProject(p.id, { [key]: iso }); props.onClose(); }} />
          {cur && <><MenuSep /><MenuItem icon={<IconClose size={13} />} label="Clear date" onClick={() => void patchProject(p.id, { [key]: null })} /></>}
        </>
      );
    }
    case 'labels': {
      // labels inside a group are exclusive: picking one replaces its siblings
      const toggle = (id: string) => {
        const l = snap.projectLabels.find(x => x.id === id);
        const on = p.labelIds.includes(id);
        const siblings = l?.parentId ? snap.projectLabels.filter(x => x.parentId === l.parentId).map(x => x.id) : [];
        void patchProject(p.id, { labelIds: on ? p.labelIds.filter(x => x !== id) : [...p.labelIds.filter(x => !siblings.includes(x)), id] });
      };
      const loose = snap.projectLabels.filter(l => !l.isGroup && !l.parentId && m(l.name));
      const groups = snap.projectLabels.filter(l => l.isGroup);
      const item = (l: (typeof snap.projectLabels)[number]) => {
        const on = p.labelIds.includes(l.id);
        return (
          <button key={l.id} className="menu-item" onClick={e => { e.stopPropagation(); toggle(l.id); }}>
            <span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span>
            <span className="mi-icon"><span className="label-dot" style={{ background: l.color }} /></span>
            <span className="mi-label">{l.name}</span>
          </button>
        );
      };
      return (
        <FilterShell q={q} setQ={setQ} placeholder="Add labels…">
          {loose.map(item)}
          {groups.map(g => {
            const kids = snap.projectLabels.filter(l => l.parentId === g.id && (m(l.name) || m(g.name)));
            return kids.length ? <div key={g.id}><div className="menu-header"><span>{g.name}</span></div>{kids.map(item)}</div> : null;
          })}
          {!snap.projectLabels.length && <div className="menu-empty">No project labels yet — add them in Settings › Projects › Labels.</div>}
          {q.trim() && !snap.projectLabels.some(l => l.name.toLowerCase() === q.trim().toLowerCase()) && (
            <MenuItem icon={<IconPlus size={13} />} label={`Create label “${q.trim()}”`} onClick={async () => {
              const { label } = await api.createProjectLabel({ name: q.trim(), color: '#5e6ad2' });
              await patchProject(p.id, { labelIds: [...p.labelIds, label.id] });
            }} />
          )}
        </FilterShell>
      );
    }
    case 'cadence': return (
      <>
        <div className="menu-header"><span>Update schedule</span></div>
        <MenuItem label={`Workspace default (${UPDATE_CADENCE_LABELS[snap.workspace.features.updateCadence].toLowerCase()})`} selected={!p.updateCadence} onClick={() => void patchProject(p.id, { updateCadence: null })} />
        {(Object.keys(UPDATE_CADENCE_LABELS) as UpdateCadence[]).map(c => (
          <MenuItem key={c} label={UPDATE_CADENCE_LABELS[c]} selected={p.updateCadence === c} onClick={() => void patchProject(p.id, { updateCadence: c })} />
        ))}
      </>
    );
    case 'icon': return (
      <div className="icon-grid">
        {ICONS.map(ic => <button key={ic} className={`icon-pick${p.icon === ic ? ' on' : ''}`} onClick={async () => { await patchProject(p.id, { icon: ic }); props.onClose(); }}>{ic}</button>)}
      </div>
    );
  }
}

function ProjectMenu(props: { kind: ProjKind; project: Project; children: (open: (e: React.MouseEvent) => void) => React.ReactNode; width?: number }) {
  const menu = useMenu();
  return (
    <>
      {props.children(menu.open)}
      {menu.anchor && <Menu anchor={menu.anchor} onClose={menu.close} width={props.width ?? (props.kind === 'start' || props.kind === 'target' ? 250 : 230)}><ProjectMenuBody kind={props.kind} project={props.project} onClose={menu.close} /></Menu>}
    </>
  );
}

/* ================= project list: filters & display ================= */
interface ProjectFilters {
  /** named status ids (older saved filters hold categories, which still match) */
  statuses?: string[]; priorities?: number[]; leads?: string[]; members?: string[]; health?: string[]; teams?: string[]; labels?: string[];
  target?: Array<'overdue' | 'month' | 'quarter' | 'none'>; query?: string;
}
type ProjDisplay = Record<'summary' | 'priority' | 'status' | 'health' | 'team' | 'lead' | 'members' | 'start' | 'target' | 'issues' | 'created' | 'updated' | 'milestones' | 'dependencies' | 'labels', boolean>;
interface ProjOptions {
  layout: 'list' | 'board' | 'timeline';
  groupBy: 'none' | 'status' | 'priority' | 'lead' | 'health' | 'team';
  orderBy: 'manual' | 'name' | 'priority' | 'target' | 'start' | 'created' | 'updated' | 'progress';
  closed: 'all' | 'month' | 'week' | 'none';
  display: ProjDisplay;
  filters: ProjectFilters;
}
const DEFAULT_PROJ: ProjOptions = {
  layout: 'list', groupBy: 'none', orderBy: 'manual', closed: 'all', filters: {},
  display: { summary: false, priority: true, status: true, health: true, team: false, lead: true, members: false, start: false, target: true, issues: true, created: false, updated: false, milestones: false, dependencies: false, labels: true },
};

function applyProjectFilters(list: Project[], f: ProjectFilters, snap: Snap): Project[] {
  const today = new Date().toISOString().slice(0, 10);
  const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  return list.filter(p =>
    (!f.statuses?.length || f.statuses.includes(p.status) || (!!p.statusId && f.statuses.includes(p.statusId)))
    && (!f.labels?.length || f.labels.some(l => l === 'none' ? !p.labelIds.length : p.labelIds.includes(l)))
    && (!f.priorities?.length || f.priorities.includes(p.priority))
    && (!f.leads?.length || f.leads.includes(p.leadId ?? 'none'))
    && (!f.members?.length || f.members.some(m => p.memberIds.includes(m)))
    && (!f.health?.length || f.health.includes(p.health))
    && (!f.teams?.length || f.teams.includes(p.teamId ?? 'none'))
    && (!f.target?.length || f.target.some(t => {
      const d = p.targetDate?.slice(0, 10);
      if (t === 'none') return !d;
      if (!d) return false;
      if (t === 'overdue') return d < today && p.status !== 'completed' && p.status !== 'canceled';
      return d >= today && d <= inDays(t === 'month' ? 31 : 92);
    }))
    && (!f.query || `${p.name} ${p.summary} ${p.description}`.toLowerCase().includes(f.query.toLowerCase())),
  ).filter(() => snap !== null);
}

const PF_FIELDS: Array<{ key: keyof ProjectFilters; label: string; icon: React.ReactNode }> = [
  { key: 'statuses', label: 'Status', icon: <ProjectStatusIcon status="planned" /> },
  { key: 'priorities', label: 'Priority', icon: <PriorityIcon priority={2} size={14} /> },
  { key: 'leads', label: 'Lead', icon: <IconUser size={14} /> },
  { key: 'members', label: 'Members', icon: <IconUsers size={14} /> },
  { key: 'health', label: 'Health', icon: <span className="health-dot" style={{ background: '#4cb782' }} /> },
  { key: 'teams', label: 'Team', icon: <IconTeam size={14} /> },
  { key: 'labels', label: 'Labels', icon: <IconTag size={14} /> },
  { key: 'target', label: 'Target date', icon: <IconCalendar size={14} /> },
  { key: 'query', label: 'Title & summary', icon: <IconEdit size={14} /> },
];
function pfValues(key: keyof ProjectFilters, snap: Snap): Array<{ id: string; label: string; icon?: React.ReactNode }> {
  switch (key) {
    case 'statuses': return orderedStatuses(snap).map(st => ({ id: st.id, label: st.name, icon: <ProjectStatusIcon status={st.type} color={st.color} /> }));
    case 'priorities': return [0, 1, 2, 3, 4].map(v => ({ id: String(v), label: PRIORITY_LABEL[v], icon: <PriorityIcon priority={v as Priority} size={14} /> }));
    case 'leads': return [{ id: 'none', label: 'No lead', icon: <IconUser size={13} /> }, ...snap.users.map(u => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={16} /> }))];
    case 'members': return snap.users.map(u => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={16} /> }));
    case 'health': return HEALTH.map(([v, l, c]) => ({ id: v, label: l, icon: <span className="health-dot" style={{ background: c }} /> }));
    case 'teams': return snap.teams.map(t => ({ id: t.id, label: t.name }));
    case 'labels': return [{ id: 'none', label: 'No labels', icon: <IconTag size={13} /> }, ...snap.projectLabels.filter(l => !l.isGroup).map(l => ({ id: l.id, label: l.parentId ? `${snap.projectLabels.find(g => g.id === l.parentId)?.name ?? ''} › ${l.name}` : l.name, icon: <span className="label-dot" style={{ background: l.color }} /> }))];
    case 'target': return [{ id: 'overdue', label: 'Overdue' }, { id: 'month', label: 'Within a month' }, { id: 'quarter', label: 'Within 3 months' }, { id: 'none', label: 'No target date' }];
    default: return [];
  }
}

function ProjectFilterBar(props: { filters: ProjectFilters; onChange: (f: ProjectFilters) => void; onSave?: () => void }) {
  const snap = useApp(s => s.snap)!;
  const [menu, setMenu] = useState<{ anchor: DOMRect; field?: keyof ProjectFilters } | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const rect = (e as CustomEvent).detail as DOMRect | undefined ?? document.querySelector<HTMLElement>('[data-filter-trigger]')?.getBoundingClientRect();
      if (rect) setMenu({ anchor: rect });
    };
    window.addEventListener('baseline:focus-filter', onOpen);
    return () => window.removeEventListener('baseline:focus-filter', onOpen);
  }, []);
  const f = props.filters;
  const active = PF_FIELDS.filter(x => { const v = f[x.key]; return Array.isArray(v) ? v.length > 0 : !!v; });
  const vals = (k: keyof ProjectFilters): string[] => { const v = f[k]; return Array.isArray(v) ? v.map(String) : v ? [String(v)] : []; };
  const setVals = (k: keyof ProjectFilters, list: string[]) => {
    const next = { ...f } as Record<string, unknown>;
    if (!list.length) delete next[k];
    else next[k] = k === 'priorities' ? list.map(Number) : k === 'query' ? list[0] : list;
    props.onChange(next as ProjectFilters);
  };
  return (
    <>
      {active.map(fd => (
        <span key={fd.key} className="fpill">
          <span className="fp-part fp-field">{fd.icon}{fd.label}</span>
          <span className="fp-part fp-op">{fd.key === 'query' ? 'contains' : vals(fd.key).length > 1 ? 'is any of' : 'is'}</span>
          <button className="fp-part fp-vals" onClick={e => setMenu({ anchor: e.currentTarget.getBoundingClientRect(), field: fd.key })}>
            {fd.key === 'query' ? `“${f.query}”` : vals(fd.key).length > 2 ? `${vals(fd.key).length} values` : vals(fd.key).map(v => pfValues(fd.key, snap).find(x => x.id === v)?.label ?? v).join(', ')}
          </button>
          <button className="fp-part fp-x" onClick={() => setVals(fd.key, [])}><IconClose size={11} /></button>
        </span>
      ))}
      {active.length > 0 && <>
        <button className="icon-btn fp-add" title="Add filter" onClick={e => setMenu({ anchor: e.currentTarget.getBoundingClientRect() })}><IconPlus size={13} /></button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost fp-clear" onClick={() => props.onChange({})}>Clear</button>
        {props.onSave && <button className="btn secondary fp-save" onClick={props.onSave}>Save</button>}
      </>}
      {menu && (
        <ProjectFilterMenu anchor={menu.anchor} startField={menu.field} onClose={() => setMenu(null)} filters={f} vals={vals} setVals={setVals} />
      )}
    </>
  );
}

function ProjectFilterMenu(props: { anchor: DOMRect; startField?: keyof ProjectFilters; onClose: () => void; filters: ProjectFilters; vals: (k: keyof ProjectFilters) => string[]; setVals: (k: keyof ProjectFilters, v: string[]) => void }) {
  const snap = useApp(s => s.snap)!;
  const [field, setField] = useState<keyof ProjectFilters | null>(props.startField ?? null);
  const [q, setQ] = useState('');
  if (field === 'query') {
    return (
      <Menu anchor={props.anchor} onClose={props.onClose} width={280}>
        <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
          <input autoFocus defaultValue={props.filters.query ?? ''} placeholder="Name or summary contains…"
            onKeyDown={e => { if (e.key === 'Enter') { props.setVals('query', (e.target as HTMLInputElement).value.trim() ? [(e.target as HTMLInputElement).value.trim()] : []); props.onClose(); } }} />
        </div>
      </Menu>
    );
  }
  if (field) {
    const cur = props.vals(field);
    return (
      <Menu anchor={props.anchor} onClose={props.onClose} width={250}>
        <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`${PF_FIELDS.find(x => x.key === field)?.label}…`} />
        </div>
        {pfValues(field, snap).filter(v => v.label.toLowerCase().includes(q.toLowerCase())).map(v => (
          <button key={v.id} className="menu-item" onClick={e => { e.stopPropagation(); props.setVals(field, cur.includes(v.id) ? cur.filter(x => x !== v.id) : [...cur, v.id]); }}>
            <span className={`mi-check${cur.includes(v.id) ? ' on' : ''}`}>{cur.includes(v.id) && <IconCheck size={11} />}</span>
            {v.icon && <span className="mi-icon">{v.icon}</span>}
            <span className="mi-label">{v.label}</span>
          </button>
        ))}
      </Menu>
    );
  }
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={240}>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Add filter…" /><span className="kbd">F</span>
      </div>
      {PF_FIELDS.filter(fd => fd.label.toLowerCase().includes(q.toLowerCase())).map(fd => (
        <button key={fd.key} className="menu-item" onClick={e => { e.stopPropagation(); setQ(''); setField(fd.key); }}>
          <span className="mi-icon">{fd.icon}</span><span className="mi-label">{fd.label}</span><span className="mi-right">›</span>
        </button>
      ))}
    </Menu>
  );
}

function Seg<T extends string>(props: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <select className="dd-select" value={props.value} onChange={e => props.onChange(e.target.value as T)}>
      {props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function ProjectDisplayMenu(props: { anchor: DOMRect; onClose: () => void; opts: ProjOptions; patch: (p: Partial<ProjOptions>) => void }) {
  const { opts, patch } = props;
  const rows: Array<[keyof ProjDisplay, string]> = [['milestones', 'Milestones'], ['dependencies', 'Dependencies'], ['labels', 'Labels'], ['summary', 'Summary'], ['priority', 'Priority'], ['status', 'Status'], ['health', 'Health'], ['team', 'Team'], ['lead', 'Lead'], ['members', 'Members'], ['start', 'Start date'], ['target', 'Target date'], ['issues', 'Issues'], ['created', 'Created'], ['updated', 'Updated']];
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={320}>
      <div className="dopts">
        <div className="dopts-layout three">
          <button className={`dopts-lay${opts.layout === 'list' ? ' on' : ''}`} onClick={() => patch({ layout: 'list' })}><IconList size={14} /> List</button>
          <button className={`dopts-lay${opts.layout === 'board' ? ' on' : ''}`} onClick={() => patch({ layout: 'board' })}><IconBoard size={14} /> Board</button>
          <button className={`dopts-lay${opts.layout === 'timeline' ? ' on' : ''}`} onClick={() => patch({ layout: 'timeline' })}><IconTimeline size={14} /> Timeline</button>
        </div>
        <div className="dopts-row"><span>{opts.layout === 'board' ? 'Columns' : 'Grouping'}</span>
          <Seg value={opts.groupBy} onChange={v => patch({ groupBy: v })} options={[['none', 'No grouping'], ['status', 'Status'], ['priority', 'Priority'], ['lead', 'Lead'], ['health', 'Health'], ['team', 'Team']]} /></div>
        <div className="dopts-row"><span>Ordering</span>
          <Seg value={opts.orderBy} onChange={v => patch({ orderBy: v })} options={[['manual', 'Manual'], ['name', 'Name'], ['priority', 'Priority'], ['target', 'Target date'], ['start', 'Start date'], ['progress', 'Progress'], ['created', 'Created'], ['updated', 'Last updated']]} /></div>
        <div className="dopts-sep" />
        <div className="dopts-row"><span>Show closed projects</span>
          <Seg value={opts.closed} onChange={v => patch({ closed: v })} options={[['all', 'All'], ['month', 'Past month'], ['week', 'Past week'], ['none', 'None']]} /></div>
        {opts.layout === 'list' && <>
          <div className="dopts-sep" />
          <div className="dopts-head">Display properties</div>
          <div className="dopts-props">
            {rows.map(([k, l]) => <button key={k} className={`dprop${opts.display[k] ? ' on' : ''}`} onClick={() => patch({ display: { ...opts.display, [k]: !opts.display[k] } })}>{l}</button>)}
          </div>
        </>}
      </div>
    </Menu>
  );
}

/* ================= projects page ================= */
/** the closed-projects window, then the filters */
function shownProjects(list: Project[], opts: Pick<ProjOptions, 'closed' | 'filters'>, snap: Snap): Project[] {
  const windowMs = opts.closed === 'week' ? 7 * 86400000 : opts.closed === 'month' ? 31 * 86400000 : null;
  return applyProjectFilters(list.filter(p => {
    if (p.status !== 'completed' && p.status !== 'canceled') return true;
    if (opts.closed === 'none') return false;
    if (windowMs === null) return true;
    return Date.now() - new Date(p.completedAt ?? p.updatedAt).getTime() <= windowMs;
  }), opts.filters, snap);
}

function projectViewOpts(v: SavedView): ProjOptions {
  return { ...DEFAULT_PROJ, ...(v.projectOptions as Partial<ProjOptions> | null ?? {}) };
}

/** for the Views page: how many projects a project view shows */
export function countProjectView(v: SavedView, snap: Snap): number {
  return shownProjects(v.teamId ? snap.projects.filter(p => p.teamId === v.teamId) : snap.projects, projectViewOpts(v), snap).length;
}

/** for the Views page: one chip per active filter, plus the layout when it isn't a list */
export function describeProjectView(v: SavedView, snap: Snap): Array<[string, string]> {
  const o = projectViewOpts(v);
  const f = o.filters as Record<string, unknown>;
  const chips: Array<[string, string]> = PF_FIELDS.filter(x => { const val = f[x.key]; return Array.isArray(val) ? val.length > 0 : !!val; }).map(x => {
    const val = f[x.key];
    if (x.key === 'query') return ['Text', `“${String(val)}”`];
    return [x.label, (val as unknown[]).map(id => pfValues(x.key, snap).find(o2 => o2.id === String(id))?.label ?? String(id)).join(', ')];
  });
  if (o.layout !== 'list') chips.push(['Layout', o.layout === 'timeline' ? 'Timeline' : 'Board']);
  return chips;
}

/** save the projects page's current filters and display as a project view, then open it to name it */
export async function saveProjectView(opts: unknown, teamId: string | null, navigate: (to: string, o?: { state: unknown }) => void) {
  const { view } = await api.createView({ name: 'New view', kind: 'projects', projectOptions: opts, filters: {}, teamId, icon: '📁' });
  await useApp.getState().bootstrap();
  navigate(`/views/${view.id}`, { state: { rename: true } });
}

export function ProjectsPage({ startWithCreate = false, savedView }: { startWithCreate?: boolean; savedView?: SavedView } = {}) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const location = useLocation();
  const { teamKey } = useParams();
  const team = savedView ? snap.teams.find(t => t.id === savedView.teamId) : teamKey ? snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase()) : undefined;
  const viewDefaults = useMemo<ProjOptions>(() => savedView ? { ...DEFAULT_PROJ, ...(savedView.projectOptions as Partial<ProjOptions> | null ?? {}), display: { ...DEFAULT_PROJ.display, ...((savedView.projectOptions as Partial<ProjOptions> | null)?.display ?? {}) } } : DEFAULT_PROJ,
    [savedView?.id, JSON.stringify(savedView?.projectOptions)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [opts, patch, reset] = useViewPrefs<ProjOptions>(savedView ? `baseline:view:saved:${savedView.id}` : `baseline:projects:${team?.id ?? 'all'}`, viewDefaults);
  const dirty = !!savedView && JSON.stringify(viewDefaults) !== JSON.stringify({ ...viewDefaults, ...opts });
  const saveAsView = () => void saveProjectView(opts, team?.id ?? null, navigate);
  useEffect(() => {
    // ⌥V: save what's on screen as a view
    const onSave = (e: Event) => { if (savedView) return; e.preventDefault(); saveAsView(); };
    window.addEventListener('baseline:save-view', onSave);
    return () => window.removeEventListener('baseline:save-view', onSave);
  });
  const displayMenu = useMenu();
  const [creating, setCreating] = useState(startWithCreate);
  const [createStatus, setCreateStatus] = useState<ProjectStatus | undefined>(undefined);
  const closeCreate = () => { setCreating(false); if (startWithCreate) navigate('/projects', { replace: true }); };
  useListLayoutToggle({ layout: opts.layout === 'list' ? 'list' : 'board' } as ViewOptions, p => patch({ layout: p.layout === 'board' ? 'board' : 'list' }));

  const visible = useMemo(() => {
    const list = shownProjects(team ? snap.projects.filter(p => p.teamId === team.id) : snap.projects, opts, snap);
    const prog = (p: Project) => projectProgress(snap, p.id).pct;
    const sorted = [...list];
    switch (opts.orderBy) {
      case 'name': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'priority': sorted.sort((a, b) => (a.priority || 9) - (b.priority || 9)); break;
      case 'target': sorted.sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999')); break;
      case 'start': sorted.sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999')); break;
      case 'progress': sorted.sort((a, b) => prog(b) - prog(a)); break;
      case 'created': sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); break;
      case 'updated': sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); break;
      default: sorted.sort((a, b) => a.position - b.position);
    }
    return sorted;
  }, [snap, team, opts.closed, opts.filters, opts.orderBy]);

  const groups = useMemo(() => groupProjects(visible, opts.groupBy, snap), [visible, opts.groupBy, snap]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={savedView
          ? [...(team ? [{ label: team.name, to: `/team/${team.key}/all`, muted: true }] : []), { label: 'Views', to: team ? `/team/${team.key}/views/projects` : '/views/projects', muted: true }, { label: savedView.name, icon: <span>{savedView.icon || '📁'}</span> }]
          : team ? [{ label: team.name, to: `/team/${team.key}/all`, muted: true }, { label: 'Projects' }] : [{ label: 'Projects' }]}
        favoriteRef={savedView ? { type: 'view', refId: savedView.id } : undefined}
        right={savedView && dirty ? (
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn ghost" style={{ height: 26, fontSize: 12 }} onClick={() => reset()}>Discard changes</button>
            <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={async () => {
              await api.updateView(savedView.id, { projectOptions: opts });
              await useApp.getState().bootstrap();
              useApp.getState().toast({ title: 'View saved' });
            }}>Save view</button>
          </span>
        ) : <button className="btn secondary" onClick={() => setCreating(true)}><IconPlus size={13} /> New project</button>} />
      <div className="subnav">
        {savedView
          ? <ViewNameSeg view={savedView} startEditing={Boolean((location.state as { rename?: boolean } | null)?.rename)} />
          : <button className="seg selected">All projects<RegisterMark group="proj-tabs" /></button>}
        <span style={{ flex: 1 }} />
        <button className={`icon-btn${Object.keys(opts.filters).length ? ' on' : ''}`} data-filter-trigger title="Filter (F)" onClick={openFilterMenu}><IconFilter size={15} /></button>
        <button className="icon-btn" title="Display options" onClick={displayMenu.open}><IconDisplay size={15} /></button>
      </div>
      <div className="filterbar"><ProjectFilterBar filters={opts.filters} onChange={filters => patch({ filters })} onSave={savedView ? undefined : saveAsView} /></div>
      {displayMenu.anchor && <ProjectDisplayMenu anchor={displayMenu.anchor} onClose={displayMenu.close} opts={opts} patch={patch} />}
      <div className="content">
        {snap.projects.length === 0 ? (
          <div className="empty-state">
            <Illustration name="projects" />
            <div className="empty-title">Projects</div>
            <div className="empty-desc">Projects are larger units of work with a clear outcome, such as a new feature you want to ship. They can be shared across multiple teams and are comprised of issues and optional documents.</div>
            <div className="empty-actions"><button className="btn primary" onClick={() => setCreating(true)}>Create new project</button></div>
          </div>
        ) : opts.layout === 'board' ? (
          <ProjectBoard groups={opts.groupBy === 'none' ? groupProjects(visible, 'status', snap) : groups} groupBy={opts.groupBy === 'none' ? 'status' : opts.groupBy} onCreate={st => { setCreateStatus(st); setCreating(true); }} />
        ) : opts.layout === 'timeline' ? (
          <ProjectTimeline projects={visible} />
        ) : (
          <ProjectList groups={groups} display={opts.display} grouped={opts.groupBy !== 'none'} />
        )}
      </div>
      <AnimatePresence>{creating && <NewProjectModal key="np" teamId={team?.id} initialStatus={createStatus} onClose={() => { setCreateStatus(undefined); closeCreate(); }} />}</AnimatePresence>
    </div>
  );
}

export interface ProjGroup { id: string; label: string; icon: React.ReactNode; projects: Project[] }
export function groupProjects(list: Project[], groupBy: ProjOptions['groupBy'], snap: Snap): ProjGroup[] {
  switch (groupBy) {
    case 'status': return PROJECT_STATUS.map(([v, l]) => ({ id: v, label: l, icon: <ProjectStatusIcon status={v} />, projects: list.filter(p => p.status === v) }));
    case 'priority': return [1, 2, 3, 4, 0].map(v => ({ id: String(v), label: PRIORITY_LABEL[v], icon: <PriorityIcon priority={v as Priority} size={14} />, projects: list.filter(p => p.priority === v) }));
    case 'health': return HEALTH.map(([v, l, c]) => ({ id: v, label: l, icon: <span className="health-dot" style={{ background: c }} />, projects: list.filter(p => p.health === v) }));
    case 'lead': return [...snap.users.map(u => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={16} />, projects: list.filter(p => p.leadId === u.id) })), { id: 'none', label: 'No lead', icon: <IconUser size={14} />, projects: list.filter(p => !p.leadId) }];
    case 'team': return [...snap.teams.map(t => ({ id: t.id, label: t.name, icon: <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 9, width: 16, height: 16 }}>{t.key[0]}</span>, projects: list.filter(p => p.teamId === t.id) })), { id: 'none', label: 'No team', icon: <IconTeam size={14} />, projects: list.filter(p => !p.teamId) }];
    default: return [{ id: 'all', label: '', icon: null, projects: list }];
  }
}

function HealthCell({ project }: { project: Project }) {
  const snap = useApp(s => s.snap)!;
  const hasUpdates = snap.projectUpdates.some(u => u.projectId === project.id);
  if (!hasUpdates) return <span className="pc dim"><span className="health-dot empty" />No updates</span>;
  return <span className="pc"><span className="health-dot" style={{ background: healthColor(project.health) }} />{healthLabel(project.health)}</span>;
}

function ProjectList(props: { groups: ProjGroup[]; display: ProjDisplay; grouped: boolean }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const d = props.display;
  const cols: Array<[keyof ProjDisplay, string, string]> = ([
    ['health', 'Health', '130px'], ['priority', 'Priority', '64px'], ['lead', 'Lead', '64px'], ['members', 'Members', '90px'], ['team', 'Team', '110px'],
    ['start', 'Start', '80px'], ['target', 'Target date', '96px'], ['issues', 'Issues', '56px'], ['created', 'Created', '80px'], ['updated', 'Updated', '80px'], ['status', 'Status', '96px'],
  ] as Array<[keyof ProjDisplay, string, string]>).filter(([k]) => d[k]);
  const grid = { gridTemplateColumns: `minmax(220px, 1fr) ${cols.map(c => c[2]).join(' ')} 28px` };
  return (
    <div className="plist">
      <div className="plist-head" style={grid}>
        <span>Name</span>
        {cols.map(([k, l]) => <span key={k} className={k === 'issues' ? 'num' : ''}>{l}</span>)}
        <span />
      </div>
      {props.groups.map(g => {
        if (props.grouped && !g.projects.length) return null;
        return (
          <div key={g.id}>
            {props.grouped && (
              <div className="group-header" onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}>
                <button className={`gh-chevron${collapsed[g.id] ? ' collapsed' : ''}`}><IconChevronDown size={13} /></button>
                {g.icon}<span>{g.label}</span><span className="count">{g.projects.length}</span><span className="gh-rule" />
              </div>
            )}
            {!collapsed[g.id] && g.projects.map(p => {
              const prog = projectProgress(snap, p.id);
              const lead = snap.users.find(u => u.id === p.leadId);
              const t = snap.teams.find(x => x.id === p.teamId);
              const faved = snap.favorites.some(f => f.type === 'project' && f.refId === p.id);
              const overdue = !!p.targetDate && p.status !== 'completed' && p.status !== 'canceled' && p.targetDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
              const ms = snap.milestones.filter(m => m.projectId === p.id);
              return (
                <ProjectRowShell key={p.id} project={p} style={grid} onOpen={() => navigate(`/projects/${p.id}`)}>
                  <span className="pl-name">
                    <span className="proj-icon">{p.icon}</span>
                    <span className="pl-title">{p.name}</span>
                    {faved && <IconStar size={11} filled style={{ color: 'var(--brand)', flex: 'none' }} />}
                    {snap.updateDrafts?.some(x => x.projectId === p.id) && <span className="pl-ms" data-draft-marker title="An agent drafted a project update for you to review"><IconEdit size={11} /> Draft update</span>}
                    {d.summary && p.summary && <span className="pl-summary">{p.summary}</span>}
                    {d.dependencies && snap.projectRelations.some(r => r.projectId === p.id || r.relatedProjectId === p.id) && (
                      <span className="pl-ms" title="Blocked by / blocking">⛓ {snap.projectRelations.filter(r => r.relatedProjectId === p.id).length}/{snap.projectRelations.filter(r => r.projectId === p.id).length}</span>
                    )}
                    {d.labels && <ProjectLabelChips project={p} />}
                    {d.milestones && ms.length > 0 && <span className="pl-ms"><IconMilestone size={11} /> {ms.filter(m => projectProgress(snap, p.id, m.id).pct === 100 && projectProgress(snap, p.id, m.id).total > 0).length}/{ms.length}</span>}
                  </span>
                  {cols.map(([k]) => {
                    switch (k) {
                      case 'health': return <HealthCell key={k} project={p} />;
                      case 'priority': return <span key={k} className="pc"><PriorityIcon priority={p.priority} size={14} /></span>;
                      case 'lead': return <span key={k} className="pc">{lead ? <Avatar user={lead} size={18} /> : <span className="dim">—</span>}</span>;
                      case 'members': return <span key={k} className="pc"><AvatarStack size={16} people={p.memberIds.slice(0, 4).map(id => snap.users.find(u => u.id === id)).filter(Boolean).map(u => ({ name: u!.name, initials: u!.initials, color: u!.color }))} /></span>;
                      case 'team': return <span key={k} className="pc">{t?.name ?? <span className="dim">—</span>}</span>;
                      case 'start': return <span key={k} className="pc mono">{p.startDate ? shortDate(p.startDate.slice(0, 10) + 'T12:00') : <span className="dim">—</span>}</span>;
                      case 'target': return <span key={k} className={`pc mono${overdue ? ' overdue' : ''}`}>{p.targetDate ? shortDate(p.targetDate.slice(0, 10) + 'T12:00') : <span className="dim">—</span>}</span>;
                      case 'issues': return <span key={k} className="pc mono num">{prog.total}</span>;
                      case 'created': return <span key={k} className="pc mono">{shortDate(p.createdAt)}</span>;
                      case 'updated': return <span key={k} className="pc mono">{relTime(p.updatedAt)}</span>;
                      case 'status': { const st = namedStatus(p, snap); return <span key={k} className="pc" title={st.name}><ProjectStatusIcon status={p.status} color={st.color} /><span className="mono">{prog.pct}%</span></span>; }
                      default: return null;
                    }
                  })}
                  <span className="pc pl-more" />
                </ProjectRowShell>
              );
            })}
          </div>
        );
      })}
      {props.groups.every(g => !g.projects.length) && <div className="empty-state"><div className="empty-title">No projects match</div><div className="empty-desc">Try clearing filters or showing closed projects.</div></div>}
    </div>
  );
}

function ProjectRowShell(props: { project: Project; style: React.CSSProperties; onOpen: () => void; children: React.ReactNode }) {
  const menu = useMenu();
  return (
    <div className="plist-row" style={props.style} onClick={props.onOpen} onContextMenu={menu.open}>
      {props.children}
      {menu.anchor && <ProjectContextMenu project={props.project} anchor={menu.anchor} onClose={menu.close} />}
    </div>
  );
}

function ProjectContextMenu(props: { project: Project; anchor: DOMRect; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const p = props.project;
  const faved = snap.favorites.some(f => f.type === 'project' && f.refId === p.id);
  const sub = (kind: ProjKind, label: string, icon: React.ReactNode) => (
    <MenuSub icon={icon} label={label} width={kind === 'start' || kind === 'target' ? 250 : 230}>
      <ProjectMenuBody kind={kind} project={p} onClose={props.onClose} />
    </MenuSub>
  );
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={230}>
      {sub('status', 'Status', <ProjectStatusIcon status={p.status} />)}
      {sub('priority', 'Priority', <PriorityIcon priority={p.priority} size={14} />)}
      {sub('health', 'Health', <span className="health-dot" style={{ background: healthColor(p.health) }} />)}
      {sub('lead', 'Lead', <IconUser size={14} />)}
      {sub('members', 'Members', <IconUsers size={14} />)}
      {sub('start', 'Start date', <IconCalendar size={14} />)}
      {sub('target', 'Target date', <IconCalendar size={14} />)}
      <MenuSep />
      <MenuItem icon={<IconStar size={14} filled={faved} />} label={faved ? 'Unfavorite' : 'Favorite'} onClick={async () => { await api.toggleFavorite('project', p.id); await useApp.getState().bootstrap(); }} />
      <MenuItem icon={<IconLink size={14} />} label="Copy link" onClick={async () => { if (await copyText(`${location.origin}/#/projects/${p.id}`)) useApp.getState().toast({ title: 'Copied link' }); }} />
      <MenuItem icon={<IconBox size={14} />} label="Open project" onClick={() => navigate(`/projects/${p.id}`)} />
      <MenuSep />
      <MenuItem icon={<IconTrash size={14} />} danger label="Delete project" onClick={async () => {
        await api.deleteProject(p.id);
        await useApp.getState().bootstrap();
        useApp.getState().toast({ title: 'Project deleted', line: <>{p.icon} {p.name}</> });
      }} />
    </Menu>
  );
}

/* ---------- board ---------- */
export function ProjectBoard(props: { groups: ProjGroup[]; groupBy: ProjOptions['groupBy']; onCreate?: (status: ProjectStatus) => void }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const fieldFor: Record<string, string> = { status: 'status', priority: 'priority', health: 'health', lead: 'leadId', team: 'teamId' };
  const drop = async (groupId: string) => {
    setOver(null);
    if (!dragId) return;
    const f = fieldFor[props.groupBy];
    if (!f) return;
    const v = props.groupBy === 'priority' ? Number(groupId) : groupId === 'none' ? null : groupId;
    await patchProject(dragId, { [f]: v, ...(f === 'status' ? { completedAt: v === 'completed' ? new Date().toISOString() : null } : {}) });
    setDragId(null);
  };
  return (
    <div className="board pboard">
      {props.groups.map(g => (
        <div key={g.id} className={`board-col pcol${over === g.id ? ' drop-active' : ''}`}
          onDragOver={e => { e.preventDefault(); setOver(g.id); }} onDragLeave={() => setOver(o => o === g.id ? null : o)} onDrop={() => void drop(g.id)}>
          <div className="board-col-header">{g.icon}<span className="bch-label">{g.label}</span><span className="count">{g.projects.length}</span>
            <span style={{ flex: 1 }} />
            {props.groupBy === 'status' && props.onCreate && <button className="icon-btn bch-add" title={`New project in ${g.label}`} onClick={() => props.onCreate!(g.id as ProjectStatus)}><IconPlus size={13} /></button>}
          </div>
          <div className="board-col-body">
            {g.projects.map(p => {
              const prog = projectProgress(snap, p.id);
              const lead = snap.users.find(u => u.id === p.leadId);
              return (
                <div key={p.id} className="board-card pcard" draggable onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)} onClick={() => navigate(`/projects/${p.id}`)}>
                  {/* Linear's card: name, then status · priority · lead on the right; description; issue count */}
                  <div className="bc-head"><span className="proj-icon">{p.icon}</span><span className="bc-title">{p.name}</span>
                    <span className="pcard-props"><ProjectStatusIcon status={p.status} size={13} color={namedStatus(p, snap).color} /><PriorityIcon priority={p.priority} size={13} />{lead ? <Avatar user={lead} size={16} /> : <Avatar user={null} size={16} />}</span></div>
                  {(p.summary || p.description) && <div className="pcard-summary">{p.summary || p.description.replace(/[#*_`>]/g, '').slice(0, 160)}</div>}
                  <div className="bc-chips pcard-foot">
                    <span className="pcard-count">{prog.total} issue{prog.total === 1 ? '' : 's'}</span>
                    {p.targetDate && <span className="bc-chip"><IconCalendar size={12} />{shortDate(p.targetDate.slice(0, 10) + 'T12:00')}</span>}
                    {snap.projectUpdates.some(u => u.projectId === p.id) && <span className="bc-chip"><span className="health-dot" style={{ background: healthColor(p.health) }} />{healthLabel(p.health)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- timeline (roadmap) ----------
   Months across the top, one row per project, a bar from start to target. Drag a bar to
   move it, drag its ends to change the start or target date. Projects without dates get a
   faint two-week bar from today that you can drag into place. */
export function ProjectTimeline(props: { projects: Project[] }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const DAY = 86400000;
  const [zoom, setZoom] = useState<'week' | 'month' | 'quarter' | 'year'>(() => (localStorage.getItem('baseline:tlZoom') as 'month') || 'month');
  useEffect(() => { try { localStorage.setItem('baseline:tlZoom', zoom); } catch { /* ignore */ } }, [zoom]);
  const pxPerDay = zoom === 'week' ? 28 : zoom === 'month' ? 8 : zoom === 'quarter' ? 3 : 1.4;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dates = props.projects.flatMap(p => [p.startDate, p.targetDate].filter(Boolean) as string[]).map(d => new Date(d.slice(0, 10) + 'T00:00').getTime());
  const span = zoom === 'year' ? 240 : zoom === 'quarter' ? 120 : 60;
  const min = Math.min(today.getTime() - span * DAY, ...dates);
  const max = Math.max(today.getTime() + span * 2 * DAY, ...dates.map(d => d + 30 * DAY));
  const start = new Date(min); start.setDate(1);
  const startMs = start.getTime();
  const totalDays = Math.ceil((max - startMs) / DAY);
  const x = (ms: number) => ((ms - startMs) / DAY) * pxPerDay;
  const iso = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const months: Array<{ label: string; left: number; width: number }> = [];
  for (let d = new Date(start); d.getTime() < max; d.setMonth(d.getMonth() + 1)) {
    const next = new Date(d); next.setMonth(next.getMonth() + 1);
    months.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: d.getMonth() === 0 ? 'numeric' : undefined }).toUpperCase(), left: x(d.getTime()), width: x(next.getTime()) - x(d.getTime()) });
  }
  // the day numbers under the months: every day zoomed in, Mondays by month, every other Monday further out
  const ticks: Array<{ label: string; left: number }> = [];
  const step = zoom === 'week' ? 1 : zoom === 'month' ? 7 : 14;
  const firstMonday = new Date(start); while (step > 1 && firstMonday.getDay() !== 1) firstMonday.setDate(firstMonday.getDate() + 1);
  for (let d = new Date(firstMonday); d.getTime() < max; d.setDate(d.getDate() + step)) ticks.push({ label: String(d.getDate()), left: x(d.getTime()) });
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(today.getTime()) - 200); }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'start' | 'end'; originX: number; s: number; e: number; dx: number } | null>(null);
  // the listeners below are bound once per drag, so they read the live drag (with its
  // current dx) through this ref — the `drag` they close over is the dx: 0 start value
  const dragRef = useRef(drag);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => setDrag(d => d ? { ...d, dx: ev.clientX - d.originX } : d);
    const onUp = async () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const days = Math.round(d.dx / pxPerDay);
      if (!days) return;
      const s = d.mode === 'end' ? d.s : d.s + days * DAY;
      const e = d.mode === 'start' ? d.e : d.e + days * DAY;
      if (e < s) return;
      await patchProject(d.id, { startDate: iso(s), targetDate: iso(e) });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [drag?.id, drag?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="timeline">
      <div className="tl-left">
        <div className="tl-left-head" />
        {props.projects.map(p => {
          const lead = snap.users.find(u => u.id === p.leadId);
          return (
            <div key={p.id} className="tl-name" onClick={() => navigate(`/projects/${p.id}`)}>
              <span className="proj-icon">{p.icon}</span><span className="tl-title">{p.name}</span>
              <span className="tl-props"><ProjectStatusIcon status={p.status} size={13} color={namedStatus(p, snap).color} /><PriorityIcon priority={p.priority} size={13} />{lead ? <Avatar user={lead} size={16} /> : <Avatar user={null} size={16} />}</span>
            </div>
          );
        })}
      </div>
      <div className="tl-controls">
        <button className="btn secondary sm" title="Center the timeline on today’s date" onClick={() => { if (scroller.current) scroller.current.scrollTo({ left: Math.max(0, x(today.getTime()) - scroller.current.clientWidth / 2), behavior: 'smooth' }); }}>Today</button>
        <select className="text-input tl-zoom" aria-label="Timeline zoom" value={zoom} onChange={e => setZoom(e.target.value as typeof zoom)}>
          <option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option>
        </select>
      </div>
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-canvas" style={{ width: totalDays * pxPerDay }}>
          <div className="tl-months">{months.map((m, i) => <div key={i} className="tl-month" style={{ left: m.left, width: m.width }}>{m.label}</div>)}</div>
          <div className="tl-ticks">{ticks.map((t, i) => <span key={i} style={{ left: t.left }}>{t.label}</span>)}</div>
          {months.map((m, i) => <div key={i} className="tl-gridline" style={{ left: m.left }} />)}
          <div className="tl-today" style={{ left: x(today.getTime()) }}><span>{today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}</span></div>
          {props.projects.map((p, row) => {
            const has = !!(p.startDate || p.targetDate);
            const s0 = p.startDate ? new Date(p.startDate.slice(0, 10) + 'T00:00').getTime() : p.targetDate ? new Date(p.targetDate.slice(0, 10) + 'T00:00').getTime() - 14 * DAY : today.getTime();
            const e0 = p.targetDate ? new Date(p.targetDate.slice(0, 10) + 'T00:00').getTime() : s0 + 14 * DAY;
            const live = drag?.id === p.id ? drag : null;
            const dd = live ? Math.round(live.dx / pxPerDay) * DAY : 0;
            const s = live && live.mode !== 'end' ? s0 + dd : s0;
            const e = live && live.mode !== 'start' ? e0 + dd : e0;
            const prog = projectProgress(snap, p.id);
            const color = PROJECT_STATUS.find(x2 => x2[0] === p.status)?.[2];
            return (
              <div key={p.id} className="tl-row" style={{ top: 34 + row * 40 }}>
                <div className={`tl-bar${has ? '' : ' undated'}`} style={{ left: x(s), width: Math.max(pxPerDay, x(e + DAY) - x(s)), '--bar': color } as React.CSSProperties}
                  title={`${p.name} · ${shortDate(iso(s) + 'T12:00')} → ${shortDate(iso(e) + 'T12:00')}`}
                  onPointerDown={ev => { ev.preventDefault(); setDrag({ id: p.id, mode: 'move', originX: ev.clientX, s: s0, e: e0, dx: 0 }); }}
                  onDoubleClick={() => navigate(`/projects/${p.id}`)}>
                  <span className="tl-handle left" onPointerDown={ev => { ev.stopPropagation(); ev.preventDefault(); setDrag({ id: p.id, mode: 'start', originX: ev.clientX, s: s0, e: e0, dx: 0 }); }} />
                  <span className="tl-fill" style={{ width: `${prog.pct}%` }} />
                  <span className="tl-label">{p.icon} {p.name}{has ? '' : ' · no dates'}</span>
                  <span className="tl-handle right" onPointerDown={ev => { ev.stopPropagation(); ev.preventDefault(); setDrag({ id: p.id, mode: 'end', originX: ev.clientX, s: s0, e: e0, dx: 0 }); }} />
                </div>
              </div>
            );
          })}
          {/* dependency arrows: from the blocker's end to the blocked project's start */}
          <svg className="tl-deps" width={totalDays * pxPerDay} height={34 + props.projects.length * 40}>
            <defs><marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" fill="currentColor" /></marker></defs>
            {snap.projectRelations.map(r => {
              const ai = props.projects.findIndex(x => x.id === r.projectId);
              const bi = props.projects.findIndex(x => x.id === r.relatedProjectId);
              if (ai < 0 || bi < 0) return null;
              const span = (p2: Project) => {
                const s0 = p2.startDate ? new Date(p2.startDate.slice(0, 10) + 'T00:00').getTime() : p2.targetDate ? new Date(p2.targetDate.slice(0, 10) + 'T00:00').getTime() - 14 * DAY : today.getTime();
                const e0 = p2.targetDate ? new Date(p2.targetDate.slice(0, 10) + 'T00:00').getTime() : s0 + 14 * DAY;
                return [s0, e0];
              };
              const [, aEnd] = span(props.projects[ai]);
              const [bStart] = span(props.projects[bi]);
              const x1 = x(aEnd + DAY), y1 = 34 + ai * 40 + 20, x2 = x(bStart), y2 = 34 + bi * 40 + 20;
              const late = aEnd >= bStart;
              const mid = Math.max(x1 + 10, (x1 + x2) / 2);
              return <path key={r.id} className={`tl-dep${late ? ' late' : ''}`} d={`M${x1},${y1} C${mid},${y1} ${Math.min(mid, x2 - 10)},${y2} ${x2},${y2}`} markerEnd="url(#tl-arrow)" />;
            })}
          </svg>
          <div style={{ height: 34 + props.projects.length * 40 + 20 }} />
        </div>
      </div>
    </div>
  );
}

/* ================= new project ================= */
export function NewProjectModal({ onClose, teamId, initialStatus }: { onClose: () => void; teamId?: string; initialStatus?: ProjectStatus }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('🧊');
  const [status, setStatus] = useState<ProjectStatus>(initialStatus ?? 'planned');
  const [statusId, setStatusId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority>(0);
  const [leadId, setLeadId] = useState<string | null>(snap.currentUser.id);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [team, setTeam] = useState<string | null>(teamId ?? snap.teams[0]?.id ?? null);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [descKey, setDescKey] = useState(0);
  const tpl = snap.projectTemplates.find(t => t.id === templateId);
  const applyTemplate = (id: string | null) => {
    setTemplateId(id);
    const t = snap.projectTemplates.find(x => x.id === id);
    if (!t) return;
    setIcon(t.icon); setSummary(t.summary); setDescription(t.description); setStatus(t.status); setStatusId(null); setPriority(t.priority);
    if (!name.trim()) setName(t.name);
    setDescKey(k => k + 1);
  };
  const menus = { labels: useMenu(), template: useMenu(), icon: useMenu(), status: useMenu(), priority: useMenu(), lead: useMenu(), members: useMenu(), team: useMenu(), start: useMenu(), target: useMenu() };
  useEffect(() => { const t = setTimeout(() => nameRef.current?.focus(), 30); return () => clearTimeout(t); }, []);
  const { busy, guard } = useInFlight();
  const create = guard(async () => {
    if (!name.trim()) return;
    const { project } = await api.createProject({ name: name.trim(), summary: summary.trim(), description, icon, status, statusId, labelIds, startDate: startDate || null, targetDate: targetDate || null, leadId, priority, memberIds, teamId: team });
    // the project exists now: a failed template must not leave the modal open, where Create would make a second one
    let templateFailed = false;
    if (templateId) { try { await api.applyProjectTemplate(project.id, templateId); } catch { templateFailed = true; } }
    await useApp.getState().bootstrap();
    onClose();
    navigate(`/projects/${project.id}`);
    useApp.getState().toast(templateFailed
      ? { title: 'Project created without its template', line: <>{icon} {project.name} — apply the template again from the project</> }
      : { title: 'Project created', line: <>{icon} {project.name}</> });
  });
  const lead = snap.users.find(u => u.id === leadId);
  const teamObj = snap.teams.find(t => t.id === team);
  const fmt = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  return (
    <Modal onClose={onClose} className="modal modal-create np-modal">
      <div className="cm-root" onKeyDown={e => {
        if ((e.target as HTMLElement).closest?.('.menu')) return;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void create(); }
      }}>
        <div className="cm-header">
          <button className="cm-team" onClick={menus.team.open}>{teamObj ? <><span className="ws-avatar" style={{ background: teamObj.color, borderRadius: 4, fontSize: 9, width: 16, height: 16 }}>{teamObj.key[0]}</span>{teamObj.key}</> : 'No team'}</button>
          <span className="crumb-sep">›</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>New project</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {snap.projectTemplates.length > 0 && <button className={`cm-template${tpl ? ' on' : ''}`} onClick={menus.template.open}>{tpl ? `${tpl.icon} ${tpl.name}` : 'Template'} <IconChevronDown size={10} /></button>}
            <button className="icon-btn" onClick={onClose}><IconClose size={14} /></button>
          </span>
        </div>
        <div className="np-head">
          <button className="np-icon" onClick={menus.icon.open} title="Choose icon">{icon}</button>
        </div>
        <input ref={nameRef} className="np-name" placeholder="Project name" value={name} spellCheck={false} onChange={e => setName(e.target.value)} />
        <input className="np-summary" placeholder="Add a short summary…" value={summary} spellCheck={false} onChange={e => setSummary(e.target.value)} />
        <div className="cm-pills">
          <button className="prop-chip" onClick={menus.status.open}>{(() => { const st = namedStatus({ status, statusId }, snap); return <><ProjectStatusIcon status={status} size={13} color={st.color} />{st.name}</>; })()}</button>
          <button className="prop-chip" onClick={menus.priority.open}><PriorityIcon priority={priority} size={13} />{priority ? PRIORITY_LABEL[priority] : 'Priority'}</button>
          <button className="prop-chip" onClick={menus.lead.open}>{lead ? <Avatar user={lead} size={16} /> : <IconUser size={13} />}{lead ? lead.name.split(' ')[0] : 'Lead'}</button>
          <button className="prop-chip" onClick={menus.members.open}><IconUsers size={13} />{memberIds.length ? `${memberIds.length} member${memberIds.length === 1 ? '' : 's'}` : 'Members'}</button>
          <button className="prop-chip" onClick={menus.start.open}><IconCalendar size={13} />{startDate ? fmt(startDate) : 'Start'}</button>
          <button className="prop-chip" onClick={menus.target.open}><IconCalendar size={13} />{targetDate ? fmt(targetDate) : 'Target'}</button>
          <button className="prop-chip" onClick={menus.labels.open}><IconTag size={13} />{labelIds.length ? snap.projectLabels.filter(l => labelIds.includes(l.id)).map(l => l.name).join(', ') : 'Labels'}</button>
        </div>
        <div className="np-desc">
          <RichEditor key={descKey} value={description} placeholder="Write a description, a project brief, or collect ideas…" onChange={setDescription} onBlur={setDescription} />
        </div>
        <div className="cm-footer">
          {tpl && (tpl.milestones.length > 0 || tpl.issues.length > 0) && <span className="cbox-hint">Also creates {[tpl.milestones.length && `${tpl.milestones.length} milestone${tpl.milestones.length === 1 ? '' : 's'}`, tpl.issues.length && `${tpl.issues.length} issue${tpl.issues.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ')}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={() => void create()} disabled={!name.trim() || busy}>Create project <span className="btn-kbd kbd">⌘↵</span></button>
          </div>
        </div>
      </div>
      {menus.template.anchor && <Menu anchor={menus.template.anchor} onClose={menus.template.close} width={240}>
        <div className="menu-header"><span>Project templates</span></div>
        {snap.projectTemplates.map(t => <MenuItem key={t.id} icon={<span>{t.icon}</span>} label={t.name} selected={templateId === t.id} onClick={() => applyTemplate(t.id)} />)}
        <MenuSep /><MenuItem label="No template" selected={!templateId} onClick={() => setTemplateId(null)} />
      </Menu>}
      {menus.icon.anchor && <Menu anchor={menus.icon.anchor} onClose={menus.icon.close} width={252}><div className="icon-grid">{ICONS.map(ic => <button key={ic} className={`icon-pick${icon === ic ? ' on' : ''}`} onClick={() => { setIcon(ic); menus.icon.close(); }}>{ic}</button>)}</div></Menu>}
      {menus.status.anchor && <Menu anchor={menus.status.anchor} onClose={menus.status.close} width={210}>{orderedStatuses(snap).map(st => <MenuItem key={st.id} icon={<ProjectStatusIcon status={st.type} color={st.color} />} label={st.name} selected={statusId ? statusId === st.id : status === st.type} onClick={() => { setStatus(st.type); setStatusId(st.id); }} />)}</Menu>}
      {menus.labels.anchor && (
        <Menu anchor={menus.labels.anchor} onClose={menus.labels.close} width={230}>
          <div className="menu-header"><span>Labels</span></div>
          {snap.projectLabels.filter(l => !l.isGroup).map(l => { const on = labelIds.includes(l.id); return (
            <button key={l.id} className="menu-item" onClick={e => { e.stopPropagation(); setLabelIds(cur => on ? cur.filter(x => x !== l.id) : [...cur, l.id]); }}>
              <span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span><span className="mi-icon"><span className="label-dot" style={{ background: l.color }} /></span><span className="mi-label">{l.name}</span>
            </button>
          ); })}
          {!snap.projectLabels.length && <div className="menu-empty">No project labels yet.</div>}
        </Menu>
      )}
      {menus.priority.anchor && <Menu anchor={menus.priority.anchor} onClose={menus.priority.close} width={200}>{([0, 1, 2, 3, 4] as Priority[]).map(v => <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={PRIORITY_LABEL[v]} selected={priority === v} right={<span className="kbd">{v}</span>} onClick={() => setPriority(v)} />)}</Menu>}
      {menus.lead.anchor && <Menu anchor={menus.lead.anchor} onClose={menus.lead.close} width={220}>{snap.users.map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={leadId === u.id} onClick={() => setLeadId(u.id)} />)}<MenuSep /><MenuItem label="No lead" selected={!leadId} onClick={() => setLeadId(null)} /></Menu>}
      {menus.members.anchor && <Menu anchor={menus.members.anchor} onClose={menus.members.close} width={220}>{snap.users.map(u => { const on = memberIds.includes(u.id); return <button key={u.id} className="menu-item" onClick={e => { e.stopPropagation(); setMemberIds(on ? memberIds.filter(x => x !== u.id) : [...memberIds, u.id]); }}><span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span><span className="mi-icon"><Avatar user={u} size={16} /></span><span className="mi-label">{u.name}</span></button>; })}</Menu>}
      {menus.team.anchor && <Menu anchor={menus.team.anchor} onClose={menus.team.close} width={200}>{snap.teams.map(t => <MenuItem key={t.id} label={t.name} selected={team === t.id} onClick={() => setTeam(t.id)} />)}</Menu>}
      {menus.start.anchor && <Menu anchor={menus.start.anchor} onClose={menus.start.close} width={250}><CalendarGrid selected={startDate || undefined} onPick={iso => { setStartDate(iso); menus.start.close(); }} /></Menu>}
      {menus.target.anchor && <Menu anchor={menus.target.anchor} onClose={menus.target.close} width={250}><CalendarGrid selected={targetDate || undefined} onPick={iso => { setTargetDate(iso); menus.target.close(); }} /></Menu>}
    </Modal>
  );
}

export function NewProjectPage() { return <ProjectsPage startWithCreate />; }

/* ================= project page ================= */
export function ProjectPage() {
  const { projectId = '', tab: rawTab } = useParams();
  const navigate = useNavigate();
  const snap = useApp(s => s.snap)!;
  const tab = (['overview', 'activity', 'issues'] as const).includes(rawTab as 'overview') ? rawTab as 'overview' | 'activity' | 'issues' : 'overview';
  const [opts, patch, reset] = useViewPrefs<ViewOptions>(`baseline:view:project:${projectId}`, { ...DEFAULT_VIEW_OPTIONS, filters: {} });
  const issuesDisplay = useMenu();
  // closed until you open it (⌘I), as in Linear
  const [details, setDetails] = useState(() => localStorage.getItem('baseline:projectDetails') === '1');
  const toggleDetails = () => setDetails(d => { try { localStorage.setItem('baseline:projectDetails', d ? '0' : '1'); } catch { /* ignore */ } return !d; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleDetails(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const project = snap.projects.find(p => p.id === projectId);
  const issues = useMemo(() => snap.issues.filter(i => i.projectId === projectId), [snap.issues, projectId]);
  if (!project) return <div className="empty-state"><div className="empty-title">Project not found</div></div>;
  const toast = useApp.getState().toast;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        crumbs={[{ label: project.name, icon: <span className="crumb-emoji">{project.icon}</span> }]}
        favoriteRef={{ type: 'project', refId: project.id }}
        more={<>
          <MenuItem icon={<IconLink size={14} />} label="Copy project URL" onClick={async () => { if (await copyText(`${location.origin}/#/projects/${project.id}`)) toast({ title: 'Copied project URL' }); }} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete project" onClick={async () => {
            await api.deleteProject(project.id); await useApp.getState().bootstrap(); navigate('/projects');
            toast({ title: 'Project deleted', line: <>{project.icon} {project.name}</> });
          }} />
        </>}
        right={<><button className="icon-btn" title="Copy link" onClick={async () => { if (await copyText(`${location.origin}/#/projects/${project.id}`)) toast({ title: 'Copied link' }); }}><IconLink size={15} /></button><ProjectBell project={project} /></>}
      />
      <div className="subnav">
        {(['overview', 'activity', 'issues'] as const).map(t => (
          <button key={t} className={`seg ${tab === t ? 'selected' : ''}`} onClick={() => navigate(`/projects/${project.id}${t === 'overview' ? '' : `/${t}`}`)}>
            {t[0].toUpperCase() + t.slice(1)}{t === 'issues' && <span className="seg-count">{issues.length}</span>}
            {tab === t && <RegisterMark group="project-tabs" />}
          </button>
        ))}
        <button className="icon-btn seg-add" title="New view of this project's issues" onClick={() => navigate(`/projects/${project.id}/issues`)}><IconViews size={14} /></button>
        <span style={{ flex: 1 }} />
        {tab === 'issues' && <ListToolbar opts={opts} onDisplay={issuesDisplay.open} />}
        {tab !== 'issues' && <button className={`icon-btn${details ? ' on' : ''}`} title="Project details (⌘I)" onClick={toggleDetails}><IconPanel size={15} /></button>}
      </div>
      {tab === 'issues' ? (
        <IssueListBody issues={issues} opts={opts} patch={patch} reset={reset} teamId={project.teamId ?? undefined} multiTeam
          displayAnchor={issuesDisplay.anchor} closeDisplay={issuesDisplay.close} createDefaults={{ projectId: project.id }}
          emptyTitle="No issues in this project yet" emptyDesc="Create an issue here (C), or move existing ones in with ⇧P." />
      ) : (
        <div className="proj-body">
          <div className="content">
            {tab === 'overview' ? <ProjectOverview project={project} /> : <ProjectActivity project={project} />}
          </div>
          {details && <ProjectDetails project={project} />}
        </div>
      )}
    </div>
  );
}

function ProjectOverview(props: { project: Project }) {
  const snap = useApp(s => s.snap)!;
  const p = props.project;
  const [name, setName] = useState(p.name);
  const [summary, setSummary] = useState(p.summary);
  useEffect(() => { setName(p.name); setSummary(p.summary); }, [p.id, p.name, p.summary]);
  const lead = snap.users.find(u => u.id === p.leadId);
  const team = snap.teams.find(t => t.id === p.teamId);
  const latest = snap.projectUpdates.find(u => u.projectId === p.id);
  return (
    <div className="proj-overview">
      <ProjectMenu kind="icon" project={p} width={252}>{open => <button className="proj-hero-icon" onClick={open} title="Change icon">{p.icon}</button>}</ProjectMenu>
      <input className="proj-hero-name" value={name} onChange={e => setName(e.target.value)} spellCheck={false}
        onBlur={() => name.trim() && name !== p.name && void patchProject(p.id, { name: name.trim() })}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <input className="proj-hero-summary" value={summary} placeholder="Add a short summary…" onChange={e => setSummary(e.target.value)} spellCheck={false}
        onBlur={() => summary !== p.summary && void patchProject(p.id, { summary: summary.trim() })}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />

      <div className="proj-props-row">
        <span className="ppr-label">Properties</span>
        <ProjectMenu kind="status" project={p}>{open => <button className="prop-chip ghost" data-pprop="status" onClick={open}><ProjectStatusBadge project={p} /></button>}</ProjectMenu>
        <ProjectMenu kind="priority" project={p}>{open => <button className="prop-chip ghost" onClick={open}><PriorityIcon priority={p.priority} size={13} />{p.priority ? PRIORITY_LABEL[p.priority] : 'Priority'}</button>}</ProjectMenu>
        <ProjectMenu kind="lead" project={p}>{open => <button className="prop-chip ghost" onClick={open}>{lead ? <Avatar user={lead} size={16} /> : <IconUser size={13} />}{lead ? lead.name : 'Lead'}</button>}</ProjectMenu>
        <ProjectMenu kind="members" project={p}>{open => <button className="prop-chip ghost" onClick={open}>{p.memberIds.length ? <AvatarStack size={16} people={p.memberIds.slice(0, 3).map(id => snap.users.find(u => u.id === id)).filter(Boolean).map(u => ({ name: u!.name, initials: u!.initials, color: u!.color }))} /> : <IconUsers size={13} />}{p.memberIds.length ? '' : 'Members'}</button>}</ProjectMenu>
        <ProjectMenu kind="target" project={p}>{open => <button className="prop-chip ghost" onClick={open}><IconCalendar size={13} />{p.targetDate ? shortDate(p.targetDate.slice(0, 10) + 'T12:00') : 'Target date'}</button>}</ProjectMenu>
        <ProjectMenu kind="team" project={p}>{open => <button className="prop-chip ghost" onClick={open}><IconTeam size={13} />{team?.name ?? 'Team'}</button>}</ProjectMenu>
        {p.startDate && <ProjectMenu kind="start" project={p}>{open => <button className="prop-chip ghost" onClick={open}><IconCalendar size={13} />Start {shortDate(p.startDate!.slice(0, 10) + 'T12:00')}</button>}</ProjectMenu>}
        {snap.projectLabels.filter(l => p.labelIds.includes(l.id)).map(l => (
          <ProjectMenu key={l.id} kind="labels" project={p} width={250}>{open => <button className="prop-chip ghost" data-pprop="labels" onClick={open}><span className="label-dot" style={{ background: l.color }} />{l.name}</button>}</ProjectMenu>
        ))}
        <ProjectInitiatives projectId={p.id} />
        <ProjectMoreProps project={p} />
      </div>
      <Resources projectId={p.id} />

      <UpdateComposer project={p} latest={latest} />
      <UpdateDue project={p} />

      <div className="proj-section-label">Description</div>
      <div className="proj-desc">
        <RichEditor key={p.id} value={p.description} uploadTo={`project:${p.id}`} placeholder="Add description…" onChange={md => md !== p.description && void patchProject(p.id, { description: md })} onBlur={md => md !== p.description && void patchProject(p.id, { description: md })} />
      </div>

      <Milestones project={p} />
    </div>
  );
}

/** the update schedule's next due date, under the update card */
function UpdateDue({ project: p }: { project: Project }) {
  const snap = useApp(s => s.snap)!;
  const cadence = p.updateCadence ?? snap.workspace.features.updateCadence;
  const days = cadence === 'weekly' ? 7 : cadence === 'biweekly' ? 14 : cadence === 'monthly' ? 30 : 0;
  if (!days || p.status === 'completed' || p.status === 'canceled') return null;
  const last = snap.projectUpdates.find(u => u.projectId === p.id)?.createdAt ?? p.createdAt;
  const due = new Date(new Date(last).getTime() + days * 86400000);
  const overdue = due.getTime() < Date.now();
  return <div className={`update-due${overdue ? ' overdue' : ''}`}>{overdue ? `Update overdue since ${shortDate(due.toISOString())}` : `Next update due ${shortDate(due.toISOString())}`} · {UPDATE_CADENCE_LABELS[cadence].toLowerCase()}</div>;
}

/* Linear's "…" at the end of the properties row: Start date, Dependencies, Labels */
function ProjectMoreProps(props: { project: Project }) {
  const menu = useMenu();
  const [sub, setSub] = useState<null | { kind: 'start' | 'labels' | 'deps'; anchor: DOMRect }>(null);
  const p = props.project;
  useEffect(() => {
    // P then L on the project page opens labels, as in Linear
    let armed = false; let t: ReturnType<typeof setTimeout>;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (document.querySelector('.menu:not(.closing), .modal-palette')) return;
      if (armed && k === 'l') { armed = false; e.preventDefault(); e.stopImmediatePropagation(); const r = document.querySelector<HTMLElement>('[data-pprop="more"]')?.getBoundingClientRect(); if (r) setSub({ kind: 'labels', anchor: r }); return; }
      armed = k === 'p' && !e.shiftKey;
      // on a project page P starts a chord (P then L), it doesn't reach the issue shortcuts
      if (armed) { e.preventDefault(); e.stopImmediatePropagation(); }
      if (armed) { clearTimeout(t); t = setTimeout(() => { armed = false; }, 1200); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(t); };
  }, []);
  return (
    <>
      <button className="prop-chip ghost dim" data-pprop="more" title="More properties" onClick={menu.open}><IconMore size={13} /></button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={230}>
          <MenuItem icon={<IconCalendar size={14} />} label="Start date…" onClick={() => setSub({ kind: 'start', anchor: menu.anchor! })} />
          <MenuItem icon={<IconLink size={14} />} label="Dependencies…" onClick={() => setSub({ kind: 'deps', anchor: menu.anchor! })} />
          <MenuItem icon={<IconTag size={14} />} label="Labels…" right={<span className="mi-hint">P then L</span>} onClick={() => setSub({ kind: 'labels', anchor: menu.anchor! })} />
        </Menu>
      )}
      {sub?.kind === 'deps' && <DependencyMenu project={p} anchor={sub.anchor} onClose={() => setSub(null)} />}
      {sub && sub.kind !== 'deps' && <Menu anchor={sub.anchor} onClose={() => setSub(null)} width={250}><ProjectMenuBody kind={sub.kind} project={p} onClose={() => setSub(null)} /></Menu>}
    </>
  );
}

/* the bell: which events on this project reach your inbox, and how often updates are expected */
function ProjectBell(props: { project: Project }) {
  const snap = useApp(s => s.snap)!;
  const menu = useMenu();
  const p = props.project;
  const me = snap.currentUser.id;
  const sub = snap.projectSubscriptions.find(x => x.projectId === p.id && x.userId === me);
  const flags = { issueAdded: !!sub?.issueAdded, issueClosed: !!sub?.issueClosed, comments: !!sub?.comments, updates: !!sub?.updates };
  const set = async (k: keyof typeof flags) => { await api.setProjectSubscription(p.id, { ...flags, [k]: !flags[k] }); await useApp.getState().bootstrap(); };
  const cadence = p.updateCadence ?? snap.workspace.features.updateCadence;
  const cadenceMenu = useMenu();
  const on = Object.values(flags).some(Boolean);
  return (
    <>
      <button className={`icon-btn${on ? ' on' : ''}`} title="Notifications" data-project-bell onClick={menu.open}><IconBell size={15} /></button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={330}>
          <div className="menu-header"><span>Send inbox notifications for {p.icon} {p.name}</span></div>
          {([['issueAdded', 'An issue is added to the project'], ['issueClosed', 'An issue is marked completed or canceled'], ['comments', 'Changes to the project description'], ['updates', 'New project update is posted']] as const).map(([k, l]) => (
            <button key={k} className="menu-item" onClick={e => { e.stopPropagation(); void set(k); }}>
              <span className="mi-label">{l}</span><span className={`mi-check${flags[k] ? ' on' : ''}`} style={{ marginLeft: 'auto' }}>{flags[k] && <IconCheck size={11} />}</span>
            </button>
          ))}
          <MenuSep />
          <div className="bell-schedule">
            <div><div className="bell-h">Update schedule</div><div className="bell-sub">{UPDATE_CADENCE_LABELS[cadence]}{!p.updateCadence && ' (workspace default)'}</div></div>
            <button className="btn secondary sm" onClick={e => { e.stopPropagation(); cadenceMenu.open(e); }}>Change</button>
          </div>
        </Menu>
      )}
      {cadenceMenu.anchor && <Menu anchor={cadenceMenu.anchor} onClose={cadenceMenu.close} width={260}><ProjectMenuBody kind="cadence" project={p} onClose={cadenceMenu.close} /></Menu>}
    </>
  );
}

function UpdateComposer(props: { project: Project; latest?: Snap['projectUpdates'][number] }) {
  const snap = useApp(s => s.snap)!;
  const draft = snap.updateDrafts?.find(d => d.projectId === props.project.id);
  if (draft) return <DraftComposer key={props.project.id} project={props.project} draft={draft} />;
  return <UpdateComposerBody {...props} />;
}

type UpdateDraft = NonNullable<Snap['updateDrafts']>[number];

/** An agent's draft, waiting in the composer: the person edits it, then publishes it as their own update or discards it. */
function DraftComposer(props: { project: Project; draft: UpdateDraft }) {
  const [shown, setShown] = useState(props.draft);
  const [edited, setEdited] = useState(false);
  const newer = props.draft.updatedAt !== shown.updatedAt;
  // an agent redrafting replaces the text only until the person starts editing; after that they choose
  if (newer && !edited) setShown(props.draft);
  const takeNewer = () => { setShown(props.draft); setEdited(false); };
  return <DraftEditor key={shown.updatedAt} project={props.project} draft={shown} newerWaiting={newer && edited} onEdit={() => setEdited(true)} onTakeNewer={takeNewer} />;
}

function DraftEditor(props: { project: Project; draft: UpdateDraft; newerWaiting: boolean; onEdit: () => void; onTakeNewer: () => void }) {
  const snap = useApp(s => s.snap)!;
  const { draft, project } = props;
  const [health, setHealth] = useState<ProjectHealth>(draft.health ?? project.health);
  const [body, setBody] = useState(draft.body);
  const editorRef = useRef<Editor | null>(null);
  const { busy, guard } = useInFlight();
  const author = snap.users.find(u => u.id === draft.authorId);
  const settle = async (write: Promise<unknown>) => {
    try { await write; } catch (e) { useApp.getState().toast({ title: (e as Error).message }); }
    await useApp.getState().bootstrap();
  };
  const publish = guard(async (md: string) => { if (!isBlank(md)) await settle(api.publishUpdateDraft(project.id, { body: md, health })); });
  const discard = guard(() => settle(api.discardUpdateDraft(project.id)));
  return (
    <div className="update-card composing" data-update-draft>
      <div className="update-draft-head">
        Drafted by {author?.id === snap.currentUser.id ? 'you' : author?.name ?? 'an agent'} · {relTime(draft.updatedAt)}
        {props.newerWaiting && <> · <button className="update-draft-newer" data-draft-newer onClick={props.onTakeNewer}>A newer draft is ready. Replace your edits with it</button></>}
      </div>
      <div className="update-health-row">
        {HEALTH.map(([v, l, c]) => <button key={v} className={`health-pick${health === v ? ' on' : ''}`} onClick={() => { setHealth(v); props.onEdit(); }}><span className="health-dot" style={{ background: c }} />{l}</button>)}
      </div>
      <div onInput={props.onEdit}><RichEditor value={draft.body} editorRef={editorRef} uploadTo={`project:${project.id}`} placeholder="How is the project going? What's next?" onChange={setBody} onSubmit={md => void publish(md)} /></div>
      <div className="cbox-foot"><span className="cbox-hint">⌘↵ to publish</span><button className="btn" style={{ height: 26, fontSize: 12 }} disabled={busy} onClick={() => void discard()}>Discard</button><button className="btn primary" style={{ height: 26, fontSize: 12 }} disabled={busy} onClick={() => void publish(editorRef.current ? htmlToMarkdown(editorRef.current.getHTML()) : body)}>Publish update</button></div>
    </div>
  );
}

function UpdateComposerBody(props: { project: Project; latest?: Snap['projectUpdates'][number] }) {
  const snap = useApp(s => s.snap)!;
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<ProjectHealth>(props.project.health);
  const [body, setBody] = useState('');
  // the editor's onChange is debounced — Post reads the editor itself so nothing typed is lost
  const editorRef = useRef<Editor | null>(null);
  const post = async (md: string) => {
    if (isBlank(md)) return;
    await api.addProjectUpdate(props.project.id, md, health);
    await useApp.getState().bootstrap();
    setOpen(false); setBody('');
  };
  if (open) {
    return (
      <div className="update-card composing">
        <div className="update-health-row">
          {HEALTH.map(([v, l, c]) => <button key={v} className={`health-pick${health === v ? ' on' : ''}`} onClick={() => setHealth(v)}><span className="health-dot" style={{ background: c }} />{l}</button>)}
        </div>
        <RichEditor value="" autoFocus editorRef={editorRef} uploadTo={`project:${props.project.id}`} placeholder="How is the project going? What's next?" onChange={setBody} onSubmit={post} onEscape={() => setOpen(false)} />
        <div className="cbox-foot"><span className="cbox-hint">⌘↵ to post</span><button className="btn" style={{ height: 26, fontSize: 12 }} onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={() => void post(editorRef.current ? htmlToMarkdown(editorRef.current.getHTML()) : body)}>Post update</button></div>
      </div>
    );
  }
  if (!props.latest) {
    return <button className="update-card empty" onClick={() => setOpen(true)}><IconEdit size={14} /> Write first project update</button>;
  }
  const u = props.latest;
  const author = snap.users.find(x => x.id === u.userId);
  return (
    <div className="update-card">
      <div className="update-head">
        {u.health && <span className="update-health" style={{ color: healthColor(u.health) }}><span className="health-dot" style={{ background: healthColor(u.health) }} />{healthLabel(u.health)}</span>}
        <Avatar user={author} size={18} /><b>{author?.name}<Via userId={u.viaUserId} /></b><span className="rel-time">{relTime(u.createdAt)}</span>
        <span style={{ flex: 1 }} />
        <button className="btn secondary sm" onClick={() => setOpen(true)}><IconEdit size={12} /> New update</button>
      </div>
      <Markdown text={u.body} />
    </div>
  );
}

function Milestones(props: { project: Project }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const ms = snap.milestones.filter(m => m.projectId === props.project.id).sort((a, b) => a.position - b.position);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    await api.createMilestone({ projectId: props.project.id, name: name.trim() });
    setName(''); setAdding(false);
    await useApp.getState().bootstrap();
  };
  return (
    <div className="milestones">
      <div className="proj-section-label">Milestones</div>
      {ms.map(m => <MilestoneRow key={m.id} milestone={m} project={props.project} onOpen={() => navigate(`/projects/${props.project.id}/issues`)} />)}
      {adding ? (
        <div className="ms-add">
          <IconMilestone size={14} />
          <input className="text-input" autoFocus placeholder="Milestone name" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setAdding(false); }} onBlur={() => { if (!name.trim()) setAdding(false); }} />
        </div>
      ) : (
        <button className="ms-new" onClick={() => setAdding(true)}><IconPlus size={13} /> Milestone</button>
      )}
    </div>
  );
}

function MilestoneRow(props: { milestone: Snap['milestones'][number]; project: Project; onOpen: () => void }) {
  const snap = useApp(s => s.snap)!;
  const m = props.milestone;
  const prog = projectProgress(snap, props.project.id, m.id);
  const menu = useMenu();
  const dateMenu = useMenu();
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="ms-item group" onContextMenu={menu.open}>
      <ProgressRing pct={prog.pct} size={14} />
      {renaming ? (
        <input className="text-input" autoFocus defaultValue={m.name} style={{ height: 24 }}
          onBlur={async e => { setRenaming(false); if (e.target.value.trim() && e.target.value !== m.name) { await api.updateMilestone(m.id, { name: e.target.value.trim() }); await useApp.getState().bootstrap(); } }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false); }} />
      ) : <span className="ms-name" onDoubleClick={() => setRenaming(true)}>{m.name}</span>}
      <span className="ms-meta">{prog.pct}% of {prog.total}</span>
      <button className="ms-date" onClick={dateMenu.open}>{m.targetDate ? shortDate(m.targetDate.slice(0, 10) + 'T12:00') : <span className="dim">Target</span>}</button>
      <button className="icon-btn hover-only" onClick={menu.open}><IconMore size={13} /></button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={200}>
          <MenuItem icon={<IconEdit size={14} />} label="Rename" onClick={() => setRenaming(true)} />
          <MenuItem icon={<IconBox size={14} />} label="View issues" onClick={props.onOpen} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete milestone" onClick={async () => { await api.deleteMilestone(m.id); await useApp.getState().bootstrap(); }} />
        </Menu>
      )}
      {dateMenu.anchor && (
        <Menu anchor={dateMenu.anchor} onClose={dateMenu.close} width={250}>
          <div className="menu-header"><span>Target date</span></div>
          <CalendarGrid selected={m.targetDate?.slice(0, 10)} onPick={async iso => { await api.updateMilestone(m.id, { targetDate: iso }); await useApp.getState().bootstrap(); dateMenu.close(); }} />
        </Menu>
      )}
    </div>
  );
}

function ProjectDetails(props: { project: Project }) {
  const snap = useApp(s => s.snap)!;
  const p = props.project;
  const lead = snap.users.find(u => u.id === p.leadId);
  const team = snap.teams.find(t => t.id === p.teamId);
  const issues = snap.issues.filter(i => i.projectId === p.id);
  const prog = projectProgress(snap, p.id);
  const ms = snap.milestones.filter(m => m.projectId === p.id).sort((a, b) => a.position - b.position);
  const [tab, setTab] = useState<'assignees' | 'labels' | 'cycles'>('assignees');
  const closed = new Set(snap.states.filter(s => s.type === 'completed' || s.type === 'canceled').map(s => s.id));
  const rows = useMemo(() => {
    const m = new Map<string, { label: string; icon: React.ReactNode; total: number; done: number }>();
    const add = (id: string, label: string, icon: React.ReactNode, i: Issue) => { const r = m.get(id) ?? { label, icon, total: 0, done: 0 }; r.total++; if (closed.has(i.stateId)) r.done++; m.set(id, r); };
    for (const i of issues) {
      if (tab === 'assignees') { const u = snap.users.find(x => x.id === i.assigneeId); add(u?.id ?? 'none', u?.name ?? 'No assignee', <Avatar user={u} size={16} />, i); }
      else if (tab === 'labels') { if (!i.labelIds.length) add('none', 'No label', <IconTag size={12} />, i); for (const l of snap.labels.filter(x => i.labelIds.includes(x.id))) add(l.id, l.name, <span className="label-dot" style={{ background: l.color }} />, i); }
      else { const c = snap.cycles.find(x => x.id === i.cycleId); add(c?.id ?? 'none', c ? c.name || `Cycle ${c.number}` : 'No cycle', <IconCycle size={12} />, i); }
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [issues, tab, snap]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = (label: string, kind: ProjKind, value: React.ReactNode) => (
    <ProjectMenu kind={kind} project={p}>{open => <button className="rail-kv" onClick={open}><span className="rail-kv-label">{label}</span><span className="rail-kv-value">{value}</span></button>}</ProjectMenu>
  );
  return (
    <aside className="props-rail proj-details">
      <div className="rail-section">
        <div className="rail-header">Properties</div>
        {row('Status', 'status', <ProjectStatusBadge project={p} />)}
        {row('Priority', 'priority', <><PriorityIcon priority={p.priority} size={13} />{PRIORITY_LABEL[p.priority]}</>)}
        {row('Health', 'health', snap.projectUpdates.some(u => u.projectId === p.id) ? <><span className="health-dot" style={{ background: healthColor(p.health) }} />{healthLabel(p.health)}</> : <span className="dim">No updates</span>)}
        {row('Lead', 'lead', lead ? <><Avatar user={lead} size={16} />{lead.name}</> : <span className="dim">Add lead</span>)}
        {row('Members', 'members', p.memberIds.length ? <><AvatarStack size={16} people={p.memberIds.slice(0, 4).map(id => snap.users.find(u => u.id === id)).filter(Boolean).map(u => ({ name: u!.name, initials: u!.initials, color: u!.color }))} /> {p.memberIds.length}</> : <span className="dim">Add members</span>)}
        {row('Start', 'start', p.startDate ? <><IconCalendar size={13} />{shortDate(p.startDate.slice(0, 10) + 'T12:00')}</> : <span className="dim">Start date</span>)}
        {row('Target', 'target', p.targetDate ? <><IconCalendar size={13} />{shortDate(p.targetDate.slice(0, 10) + 'T12:00')}</> : <span className="dim">Target date</span>)}
        {row('Team', 'team', team ? team.name : <span className="dim">Add team</span>)}
        {row('Labels', 'labels', p.labelIds.length ? <ProjectLabelChips project={p} max={4} /> : <span className="dim">Add labels</span>)}
        {row('Updates', 'cadence', <span className={p.updateCadence ? '' : 'dim'}>{UPDATE_CADENCE_LABELS[p.updateCadence ?? snap.workspace.features.updateCadence]}</span>)}
        <ProjectLocationsRow project={p} />
      </div>
      <ProjectDependencies project={p} />
      {ms.length > 0 && (
        <div className="rail-section">
          <div className="rail-header">Milestones</div>
          {ms.map(m => { const mp = projectProgress(snap, p.id, m.id); return (
            <div key={m.id} className="rail-ms"><ProgressRing pct={mp.pct} size={13} /><span className="rail-ms-name">{m.name}</span><span className="rail-ms-num">{mp.pct}% of {mp.total}</span></div>
          ); })}
        </div>
      )}
      <div className="rail-section">
        <div className="rail-header">Progress</div>
        <div className="pd-stats">
          <div><span className="sw scope" />Scope<b>{prog.total}</b></div>
          <div><span className="sw started" />Started<b>{prog.started}</b></div>
          <div><span className="sw done" />Completed<b>{prog.done}</b></div>
        </div>
        <span className="cy-bar" style={{ width: '100%', margin: '6px 0 10px' }}>
          <span className="cy-done" style={{ width: prog.total ? `${(prog.done / prog.total) * 100}%` : 0 }} />
          <span className="cy-started" style={{ width: prog.total ? `${(prog.started / prog.total) * 100}%` : 0 }} />
        </span>
        <div className="bd-tabs">{(['assignees', 'labels', 'cycles'] as const).map(t => <button key={t} className={`bd-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        {rows.map(([id, r]) => (
          <div key={id} className="bd-row"><span className="bd-icon">{r.icon}</span><span className="bd-label">{r.label}</span><span className="bd-num">{r.total ? Math.round((r.done / r.total) * 100) : 0}% of {r.total}</span></div>
        ))}
        {rows.length === 0 && <div className="bd-empty">No issues yet.</div>}
      </div>
    </aside>
  );
}

/* dependencies: "blocked by" projects must land first; "blocking" ones wait on this */
function ProjectDependencies(props: { project: Project }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const menu = useMenu();
  const p = props.project;
  const blockedBy = snap.projectRelations.filter(r => r.relatedProjectId === p.id);
  const blocking = snap.projectRelations.filter(r => r.projectId === p.id);
  const row = (relId: string, otherId: string) => {
    const o = snap.projects.find(x => x.id === otherId);
    if (!o) return null;
    return (
      <div key={relId} className="prop-line rel-line" onClick={() => navigate(`/projects/${o.id}`)}>
        <ProjectStatusIcon status={o.status} size={13} /><span className="prop-line-label">{o.icon} {o.name}</span>
        {o.targetDate && <span className="prop-line-meta">{shortDate(o.targetDate.slice(0, 10) + 'T12:00')}</span>}
        <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Remove dependency" onClick={async e => { e.stopPropagation(); await api.removeProjectDependency(relId); await useApp.getState().bootstrap(); }}><IconClose size={12} /></button>
      </div>
    );
  };
  return (
    <div className="rail-section">
      <div className="rail-header">Dependencies</div>
      {blockedBy.length > 0 && <div className="rel-kind">Blocked by</div>}
      {blockedBy.map(r => row(r.id, r.projectId))}
      {blocking.length > 0 && <div className="rel-kind">Blocking</div>}
      {blocking.map(r => row(r.id, r.relatedProjectId))}
      <button className="prop-line dim" onClick={menu.open}><IconPlus size={13} /><span className="prop-line-label">Add dependency…</span></button>
      {menu.anchor && <DependencyMenu project={p} anchor={menu.anchor} onClose={menu.close} />}
    </div>
  );
}

function DependencyMenu(props: { project: Project; anchor: DOMRect; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const [mode, setMode] = useState<'blocks' | 'blockedBy'>('blockedBy');
  const [q, setQ] = useState('');
  const p = props.project;
  const linked = new Set([...snap.projectRelations.filter(r => r.relatedProjectId === p.id).map(r => r.projectId), ...snap.projectRelations.filter(r => r.projectId === p.id).map(r => r.relatedProjectId), p.id]);
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={280}>
      <div className="seg-pair" style={{ padding: '4px 6px 6px' }}>
        <button className={`seg${mode === 'blockedBy' ? ' selected' : ''}`} onClick={e => { e.stopPropagation(); setMode('blockedBy'); }}>Blocked by</button>
        <button className={`seg${mode === 'blocks' ? ' selected' : ''}`} onClick={e => { e.stopPropagation(); setMode('blocks'); }}>Blocking</button>
      </div>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects…" /></div>
      {snap.projects.filter(o => !linked.has(o.id) && o.name.toLowerCase().includes(q.toLowerCase())).map(o => (
        <MenuItem key={o.id} icon={<span>{o.icon}</span>} label={o.name} onClick={async () => { await api.addProjectDependency(p.id, mode === 'blocks' ? { blocks: o.id } : { blockedBy: o.id }); await useApp.getState().bootstrap(); }} />
      ))}
    </Menu>
  );
}

function ProjectActivity(props: { project: Project }) {
  const snap = useApp(s => s.snap)!;
  const p = props.project;
  const updates = snap.projectUpdates.filter(u => u.projectId === p.id);
  const acts = snap.activity.filter(a => a.projectId === p.id);
  const items = [
    ...updates.map(u => ({ kind: 'update' as const, at: u.createdAt, u })),
    ...acts.map(a => ({ kind: 'act' as const, at: a.createdAt, a })),
  ].sort((x, y) => y.at.localeCompare(x.at));
  return (
    <div className="proj-overview">
      <UpdateComposer project={p} />
      <div className="proj-section-label">Activity</div>
      {items.map(it => {
        if (it.kind === 'update') {
          const author = snap.users.find(x => x.id === it.u.userId);
          return (
            <div key={it.u.id} className="update-card">
              <div className="update-head">
                {it.u.health && <span className="update-health" style={{ color: healthColor(it.u.health) }}><span className="health-dot" style={{ background: healthColor(it.u.health) }} />{healthLabel(it.u.health)}</span>}
                <Avatar user={author} size={18} /><b>{author?.name}<Via userId={it.u.viaUserId} /></b><span className="rel-time">posted an update · {relTime(it.u.createdAt)}</span>
              </div>
              <Markdown text={it.u.body} />
            </div>
          );
        }
        const a = it.a;
        const who = snap.users.find(u => u.id === a.userId);
        const text = a.type === 'projectCreated' ? 'created the project'
          : a.type === 'projectHealth' ? `set health to ${healthLabel(a.data.to as ProjectHealth)}`
          : a.type === 'projectUpdated' ? `updated ${((a.data.fields as string[]) ?? []).filter(f => f !== 'completedAt').map(f => ({ memberIds: 'members', leadId: 'lead', targetDate: 'target date', startDate: 'start date', teamId: 'team' } as Record<string, string>)[f] ?? f).join(', ')}`
          : 'updated the project';
        return (
          <div key={a.id} className="activity-item">
            <Avatar user={who} size={16} />
            <span className="activity-body"><b>{who?.name ?? 'Someone'}</b><Via userId={a.viaUserId} /> {text} <span className="rel-time">· {relTime(a.createdAt)}</span></span>
          </div>
        );
      })}
      {items.length === 0 && <div className="bd-empty">No activity yet.</div>}
    </div>
  );
}

