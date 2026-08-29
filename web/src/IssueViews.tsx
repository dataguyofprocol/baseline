import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, shortDate, relTime, useSelection, useCursor, registerVisibleList, LIST_GROUP_ORDER, copyText } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, useMenu, MenuInput } from './ui.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import {
  IconChevronDown, IconChevronRight, IconPlus, IconFilter, IconClose, IconArchive, IconTrash,
  IconCalendar, IconCycle, IconFocus, IconPrompt,
} from './icons.js';
import type { Issue, Priority, ViewFilters, GroupBy, OrderBy } from '../../src/core/types.js';

/* ================= view preferences (persisted per page) ================= */
export interface DisplayProps { id: boolean; status: boolean; assignee: boolean; priority: boolean; labels: boolean; project: boolean; due: boolean }
export interface ViewOptions {
  layout: 'list' | 'board';
  groupBy: GroupBy;
  subgroupBy: GroupBy | 'none';
  orderBy: OrderBy;
  showEmpty: boolean;
  display: DisplayProps;
  filters: ViewFilters;
}

export const DEFAULT_DISPLAY: DisplayProps = { id: true, status: true, assignee: true, priority: true, labels: true, project: false, due: false };

export function useViewPrefs<T extends object>(key: string, defaults: T): [T, (patch: Partial<T>) => void] {
  const [prefs, setPrefs] = useState<T>(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return defaults; }
  });
  const patch = (p: Partial<T>) => setPrefs(cur => {
    const next = { ...cur, ...p };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  return [prefs, patch];
}

/* ================= filtering ================= */
export function applyFilters(issues: Issue[], f: ViewFilters, states: { id: string; type: string }[]): Issue[] {
  let out = issues;
  if (f.states?.length) out = out.filter(i => f.states!.includes(i.stateId));
  if (f.stateTypes?.length) {
    const ids = states.filter(s => f.stateTypes!.includes(s.type as never)).map(s => s.id);
    out = out.filter(i => ids.includes(i.stateId));
  }
  if (f.priority?.length) out = out.filter(i => f.priority!.includes(i.priority));
  if (f.assigneeIds?.length) out = out.filter(i => i.assigneeId && f.assigneeIds!.includes(i.assigneeId));
  if (f.labelIds?.length) out = out.filter(i => f.labelIds!.some(l => i.labelIds.includes(l)));
  if (f.projectIds?.length) out = out.filter(i => i.projectId && f.projectIds!.includes(i.projectId));
  if (f.query) {
    const q = f.query.toLowerCase();
    out = out.filter(i => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  }
  return out;
}

export function orderIssues(issues: Issue[], orderBy: string): Issue[] {
  const arr = [...issues];
  switch (orderBy) {
    case 'priority': return arr.sort((a, b) => (a.priority === 0 ? 99 : a.priority) - (b.priority === 0 ? 99 : b.priority) || a.sortOrder - b.sortOrder);
    case 'updated': return arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'created': return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'due': return arr.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    case 'title': return arr.sort((a, b) => a.title.localeCompare(b.title));
    default: return arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }
}

export function activeFilterCount(f: ViewFilters): number {
  return (f.states?.length ? 1 : 0) + (f.stateTypes?.length ? 1 : 0) + (f.priority?.length ? 1 : 0)
    + (f.assigneeIds?.length ? 1 : 0) + (f.labelIds?.length ? 1 : 0) + (f.projectIds?.length ? 1 : 0) + (f.query ? 1 : 0);
}

/* ================= grouping ================= */
export interface GroupSpec { id: string; label: string; icon: React.ReactNode; orderIndex: number }

export function groupsFor(groupBy: GroupBy, snap: NonNullable<ReturnType<typeof useApp.getState>['snap']>, teamId?: string): GroupSpec[] {
  const teamStates = snap.states
    .filter(s => !teamId || s.teamId === teamId)
    .slice().sort((a, b) => {
      const ia = LIST_GROUP_ORDER.indexOf(a.type as never);
      const ib = LIST_GROUP_ORDER.indexOf(b.type as never);
      return ia !== ib ? ia - ib : a.position - b.position;
    });
  switch (groupBy) {
    case 'status': {
      const seen = new Map<string, GroupSpec>();
      for (const s of teamStates) {
        if (seen.has(s.name)) continue;
        seen.set(s.name, { id: s.id, label: s.name, icon: <StateIcon type={s.type} color={s.color} size={14} />, orderIndex: LIST_GROUP_ORDER.indexOf(s.type as never) * 100 + s.position });
      }
      return [...seen.values()];
    }
    case 'priority': {
      const list: Array<[Priority, string]> = [[1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low'], [0, 'No priority']];
      return list.map(([p, label]) => ({ id: String(p), label, icon: <PriorityIcon priority={p} size={14} />, orderIndex: p === 0 ? 99 : p }));
    }
    case 'assignee': {
      const specs: GroupSpec[] = snap.users.map(u => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={18} />, orderIndex: 0 }));
      specs.push({ id: 'none', label: 'Unassigned', icon: <Avatar user={null} size={18} />, orderIndex: 1 });
      return specs;
    }
    case 'label': {
      const specs: GroupSpec[] = snap.labels.filter(l => !teamId || l.teamId === teamId)
        .map(l => ({ id: l.id, label: l.name, icon: <span className="label-dot" style={{ background: l.color }} />, orderIndex: 0 }));
      specs.push({ id: 'none', label: 'No label', icon: <IconFilter size={13} />, orderIndex: 1 });
      return specs;
    }
    case 'project': {
      const specs: GroupSpec[] = snap.projects.map(p => ({ id: p.id, label: p.name, icon: <span className="proj-icon" style={{ width: 16, height: 16, fontSize: 10 }}>{p.icon}</span>, orderIndex: 0 }));
      specs.push({ id: 'none', label: 'No project', icon: <IconFilter size={13} />, orderIndex: 1 });
      return specs;
    }
    case 'cycle': {
      const specs: GroupSpec[] = snap.cycles
        .filter(c => !teamId || c.teamId === teamId)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map(c => ({ id: c.id, label: c.name || `Cycle ${c.number}`, icon: <IconCycle size={13} />, orderIndex: 0 }));
      specs.push({ id: 'none', label: 'No cycle', icon: <IconCycle size={13} />, orderIndex: 1 });
      return specs;
    }
    default: return [];
  }
}

export function issuesOfGroup(groupBy: GroupBy, issues: Issue[], groupId: string, teamId?: string): Issue[] {
  const snap = useApp.getState().snap!;
  switch (groupBy) {
    case 'status': {
      const groupState = snap.states.find(s => s.id === groupId);
      return issues.filter(i => {
        if (i.stateId === groupId) return true;
        // cross-team merge: same name + type counts as the same group
        const is = snap.states.find(s => s.id === i.stateId);
        return !!groupState && !!is && groupState.name === is.name && groupState.type === is.type;
      });
    }
    case 'priority': return issues.filter(i => String(i.priority) === groupId);
    case 'assignee': return issues.filter(i => (i.assigneeId ?? 'none') === groupId);
    case 'label': return groupId === 'none' ? issues.filter(i => i.labelIds.length === 0) : issues.filter(i => i.labelIds.includes(groupId));
    case 'project': return issues.filter(i => (i.projectId ?? 'none') === groupId);
    case 'cycle': return issues.filter(i => (i.cycleId ?? 'none') === groupId);
    default:
      void teamId;
      return issues;
  }
}

/* ================= issue row ================= */
export interface RowDisplay { id: boolean; status: boolean; assignee: boolean; priority: boolean; labels: boolean; project: boolean; due: boolean }

export function IssueRow(props: {
  issue: Issue;
  display?: RowDisplay;
  selected?: boolean;
  cursor?: boolean;
  nested?: boolean;
  onOpen?: () => void;
}) {
  const snap = useApp(s => s.snap)!;
  const setPeek = useApp(s => s.setPeek);
  const navigate = useNavigate();
  const issueMenu = useMenu();
  const toggleSelected = useSelection(s => s.toggle);
  const display = props.display ?? { id: true, status: true, assignee: true, priority: true, labels: true, project: false, due: false };
  const team = snap.teams.find(t => t.id === props.issue.teamId);
  const state = snap.states.find(s => s.id === props.issue.stateId);
  const assignee = snap.users.find(u => u.id === props.issue.assigneeId);
  const labels = snap.labels.filter(l => props.issue.labelIds.includes(l.id));
  const project = snap.projects.find(p => p.id === props.issue.projectId);
  const key = `${team?.key ?? 'ISS'}-${props.issue.number}`;

  const open = () => {
    if (props.onOpen) props.onOpen();
    else setPeek(props.issue.id);
  };

  return (
    <div
      data-issue-row={props.issue.id}
      className={`issue-row ${props.selected ? 'selected' : ''} ${props.cursor ? 'cursor' : ''} ${props.nested ? 'nested' : ''}`}
      onClick={open}
      onContextMenu={(e) => issueMenu.open(e)}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); navigate(`/issue/${key}`); } }}
    >
      <input
        type="checkbox" className="row-check" checked={props.selected ?? false}
        onClick={e => e.stopPropagation()}
        onChange={() => toggleSelected(props.issue.id)}
      />
      {display.priority && <PriorityIcon priority={props.issue.priority} size={14} />}
      {display.id && <span className="issue-key">{key}</span>}
      {display.status && state && <StateIcon type={state.type} color={state.color} size={14} />}
      <span className="row-title">{props.issue.title}</span>
      <span className="row-meta">
        {display.due && props.issue.dueDate && (
          <span className={`due-chip ${props.issue.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'overdue' : ''}`}>
            <IconCalendar size={11} /> {shortDate(props.issue.dueDate)}
          </span>
        )}
        {display.project && project && (
          <span className="proj-chip">{project.icon} {project.name}</span>
        )}
        {display.labels && labels.slice(0, 2).map(l => (
          <span key={l.id} className="label-pill" style={{ background: `color-mix(in srgb, ${l.color} calc(var(--label-bg-alpha) * 100%), transparent)`, color: 'var(--text-secondary)' }}>
            <span className="label-dot" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
        {display.assignee && <Avatar user={assignee} />}
        <span className="row-date" title={props.issue.updatedAt}>{relTime(props.issue.updatedAt)}</span>
      </span>
      {issueMenu.anchor && <IssueContextMenu anchor={issueMenu.anchor} onClose={issueMenu.close} issue={props.issue} />}
    </div>
  );
}

/* ---------------- row context menu ---------------- */
export function IssueContextMenu(props: { anchor: DOMRect; onClose: () => void; issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const setPeek = useApp(s => s.setPeek);
  const setQuickMenu = useApp(s => s.setQuickMenu);
  const toast = useApp(s => s.toast);
  const team = snap.teams.find(t => t.id === props.issue.teamId);
  const key = `${team?.key}-${props.issue.number}`;

  const openQuick = (kind: 'status' | 'priority' | 'assignee' | 'labels') => {
    props.onClose();
    setQuickMenu({ issueId: props.issue.id, kind, anchor: props.anchor });
  };

  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={224}>
      <MenuItem label="Change status…" right={<span className="kbd">S</span>} onClick={() => openQuick('status')} />
      <MenuItem label="Change priority…" right={<span className="kbd">P</span>} onClick={() => openQuick('priority')} />
      <MenuItem label="Assign to…" right={<span className="kbd">A</span>} onClick={() => openQuick('assignee')} />
      <MenuItem label="Set labels…" right={<span className="kbd">L</span>} onClick={() => openQuick('labels')} />
      <MenuSep />
      <MenuItem icon={<IconPrompt size={14} />} label="Copy as prompt" onClick={async () => {
        const { handoff } = await api.getHandoff(props.issue.id);
        if (await copyText(handoff.prompt)) toast({ title: `Copied prompt for ${key}`, line: <>branch: <b>{handoff.branchName}</b></> });
        else toast({ title: 'Clipboard unavailable', line: <>{key} — bring the app tab into focus and retry</> });
      }} />
      <MenuItem label="Copy branch name" onClick={async () => {
        const { handoff } = await api.getHandoff(props.issue.id);
        if (await copyText(handoff.branchName)) toast({ title: `Copied branch ${handoff.branchName}` });
        else toast({ title: 'Clipboard unavailable', line: <>branch: <b>{handoff.branchName}</b></> });
      }} />
      <MenuItem
        label="Copy issue ID"
        onClick={async () => { await navigator.clipboard.writeText(key); toast({ title: 'Copied issue ID' }); }}
      />
      <MenuItem label="Open in full page" onClick={() => { setPeek(null); location.hash = `#/issue/${key}`; }} />
      <MenuItem label="Duplicate issue" onClick={async () => {
        const { issue } = await api.createIssue({
          teamId: props.issue.teamId, title: props.issue.title, description: props.issue.description,
          priority: props.issue.priority, assigneeId: props.issue.assigneeId, projectId: props.issue.projectId,
          labelIds: props.issue.labelIds, dueDate: props.issue.dueDate, estimate: props.issue.estimate,
        });
        await useApp.getState().bootstrap();
        toast({ title: 'Issue duplicated', line: <>{team?.key}-{issue.number} — {issue.title}</> });
      }} />
      <MenuSep />
      <MenuItem icon={<IconArchive size={14} />} label="Archive" onClick={async () => {
        await api.archiveIssue(props.issue.id);
        await useApp.getState().bootstrap();
        setPeek(null);
        toast({
          title: 'Issue archived',
          line: <>{key} — {props.issue.title}</>,
          actions: [{ label: 'Undo', onClick: async () => { await api.unarchiveIssue(props.issue.id); await useApp.getState().bootstrap(); } }],
        });
      }} />
      <MenuItem icon={<IconTrash size={14} />} danger label="Delete issue" onClick={async () => {
        await api.deleteIssue(props.issue.id);
        await useApp.getState().bootstrap();
        setPeek(null);
        toast({
          title: 'Issue deleted',
          line: <>{key} — {props.issue.title}</>,
          actions: [{ label: 'Undo', onClick: async () => { await api.restoreIssue(props.issue.id); await useApp.getState().bootstrap(); } }],
        });
      }} />
    </Menu>
  );
}

/* ---------------- quick menus (keyboard S/P/L/A on rows) ---------------- */
export function QuickMenus() {
  const quickMenu = useApp(s => s.quickMenu);
  const setQuickMenu = useApp(s => s.setQuickMenu);
  const snap = useApp(s => s.snap);
  if (!quickMenu || !snap) return null;
  const issue = snap.issues.find(i => i.id === quickMenu.issueId);
  if (!issue) return null;
  const close = () => setQuickMenu(null);
  const anchor = quickMenu.anchor;
  switch (quickMenu.kind) {
    case 'status': return <StatusMenuAnchored issue={issue} anchor={anchor} onClose={close} />;
    case 'priority': return <PriorityMenuAnchored issue={issue} anchor={anchor} onClose={close} />;
    case 'assignee': return <AssigneeMenuAnchored issue={issue} anchor={anchor} onClose={close} />;
    case 'labels': return <LabelsMenuAnchored issue={issue} anchor={anchor} onClose={close} />;
  }
}

function StatusMenuAnchored(props: { issue: Issue; anchor: DOMRect; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const states = snap.states.filter(s => s.teamId === props.issue.teamId);
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={224}>
      <div className="menu-header"><span>Change status…</span><span className="kbd">S</span></div>
      {states.map((s, i) => (
        <MenuItem key={s.id} icon={<StateIcon type={s.type} color={s.color} />} label={s.name} selected={s.id === props.issue.stateId}
          right={<span className="kbd">{i + 1}</span>}
          onClick={async () => { await api.updateIssue(props.issue.id, { stateId: s.id }); await useApp.getState().bootstrap(); }} />
      ))}
    </Menu>
  );
}
function PriorityMenuAnchored(props: { issue: Issue; anchor: DOMRect; onClose: () => void }) {
  const opts: Array<[Priority, string]> = [[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']];
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={224}>
      <div className="menu-header"><span>Set priority to…</span><span className="kbd">P</span></div>
      {opts.map(([v, label], i) => (
        <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={label} selected={props.issue.priority === v}
          right={<span className="kbd">{i}</span>}
          onClick={async () => { await api.updateIssue(props.issue.id, { priority: v }); await useApp.getState().bootstrap(); }} />
      ))}
    </Menu>
  );
}
function AssigneeMenuAnchored(props: { issue: Issue; anchor: DOMRect; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={224}>
      <div className="menu-header"><span>Assign to…</span><span className="kbd">A</span></div>
      {snap.users.map(u => (
        <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} selected={props.issue.assigneeId === u.id}
          onClick={async () => { await api.updateIssue(props.issue.id, { assigneeId: u.id }); await useApp.getState().bootstrap(); }} />
      ))}
      <MenuSep />
      <MenuItem label="No assignee" selected={!props.issue.assigneeId}
        onClick={async () => { await api.updateIssue(props.issue.id, { assigneeId: null }); await useApp.getState().bootstrap(); }} />
    </Menu>
  );
}
function LabelsMenuAnchored(props: { issue: Issue; anchor: DOMRect; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={244}>
      <div className="menu-header"><span>Add labels…</span><span className="kbd">L</span></div>
      {snap.labels.filter(l => l.teamId === props.issue.teamId).map(l => (
        <MenuItem key={l.id} icon={<span className="label-dot" style={{ background: l.color }} />} label={l.name} selected={props.issue.labelIds.includes(l.id)}
          onClick={async () => {
            const labelIds = props.issue.labelIds.includes(l.id) ? props.issue.labelIds.filter(x => x !== l.id) : [...props.issue.labelIds, l.id];
            await api.updateIssue(props.issue.id, { labelIds });
            await useApp.getState().bootstrap();
          }} />
      ))}
    </Menu>
  );
}

/* ---------------- filter pills ---------------- */
export function FilterBar(props: {
  filters: ViewFilters;
  onChange: (f: ViewFilters) => void;
  teamId?: string;
  forceOpenToken?: number;
}) {
  const snap = useApp(s => s.snap)!;
  const addMenu = useMenu();
  const pillRef = useRef<HTMLButtonElement>(null);
  const filters = props.filters;
  const set = (patch: Partial<ViewFilters>) => props.onChange({ ...filters, ...patch });

  useEffect(() => {
    if (props.forceOpenToken && pillRef.current) {
      addMenu.setAnchor(pillRef.current.getBoundingClientRect());
    }
  }, [props.forceOpenToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const pills: Array<{ label: React.ReactNode; clear: () => void }> = [];
  if (filters.query) pills.push({ label: <>“{filters.query}”</>, clear: () => set({ query: undefined }) });
  if (filters.states?.length) {
    const names = filters.states.map(id => snap.states.find(s => s.id === id)?.name ?? id);
    pills.push({ label: <>Status: {names.join(', ')}</>, clear: () => set({ states: undefined }) });
  }
  if (filters.stateTypes?.length) {
    const labels = filters.stateTypes.map(t => ({ backlog: 'Backlog', unstarted: 'Todo', started: 'In Progress', completed: 'Done', canceled: 'Canceled' })[t]);
    pills.push({ label: <>Status type: {labels.join(', ')}</>, clear: () => set({ stateTypes: undefined }) });
  }
  if (filters.priority?.length) {
    const names = filters.priority.slice().sort().map(p => ['', 'Urgent', 'High', 'Medium', 'Low'][p]);
    pills.push({ label: <>Priority: {names.join(', ')}</>, clear: () => set({ priority: undefined }) });
  }
  if (filters.assigneeIds?.length) {
    const names = filters.assigneeIds.map(id => snap.users.find(u => u.id === id)?.name ?? id);
    pills.push({ label: <>Assignee: {names.join(', ')}</>, clear: () => set({ assigneeIds: undefined }) });
  }
  if (filters.labelIds?.length) {
    const names = filters.labelIds.map(id => snap.labels.find(l => l.id === id)?.name ?? id);
    pills.push({ label: <>Label: {names.join(', ')}</>, clear: () => set({ labelIds: undefined }) });
  }
  if (filters.projectIds?.length) {
    const names = filters.projectIds.map(id => snap.projects.find(p => p.id === id)?.name ?? id);
    pills.push({ label: <>Project: {names.join(', ')}</>, clear: () => set({ projectIds: undefined }) });
  }

  const toggleIn = <T,>(arr: T[] | undefined, v: T): T[] => (arr ?? []).includes(v) ? (arr ?? []).filter(x => x !== v) : [...(arr ?? []), v];

  return (
    <>
      <button ref={pillRef} className={`filter-pill ${pills.length ? 'active' : ''}`} onClick={addMenu.open}>
        <IconFilter size={12} /> Filter
      </button>
      {pills.map((p, i) => (
        <span key={i} className="filter-pill active">
          {p.label}
          <button className="pill-x" onClick={p.clear}><IconClose size={10} /></button>
        </span>
      ))}
      {addMenu.anchor && (
        <Menu anchor={addMenu.anchor} onClose={addMenu.close} width={250}>
          <div className="menu-header"><span>Add filter</span></div>
          <div style={{ padding: '2px 8px 8px' }}>
            <MenuInput value={filters.query ?? ''} onChange={v => set({ query: v || undefined })} placeholder="Search titles…" />
          </div>
          <MenuSep />
          <div className="menu-header"><span>Priority</span></div>
          {([[1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']] as Array<[Priority, string]>).map(([p, name]) => (
            <MenuItem key={p} icon={<PriorityIcon priority={p} />} label={name} selected={filters.priority?.includes(p) ?? false}
              onClick={() => set({ priority: toggleIn(filters.priority, p) })} />
          ))}
          <MenuSep />
          <div className="menu-header"><span>Assignee</span></div>
          {snap.users.map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={17} />} label={u.name} selected={filters.assigneeIds?.includes(u.id) ?? false}
              onClick={() => set({ assigneeIds: toggleIn(filters.assigneeIds, u.id) })} />
          ))}
          <MenuSep />
          <div className="menu-header"><span>Label</span></div>
          {snap.labels.filter(l => !props.teamId || l.teamId === props.teamId).map(l => (
            <MenuItem key={l.id} icon={<span className="label-dot" style={{ background: l.color }} />} label={l.name} selected={filters.labelIds?.includes(l.id) ?? false}
              onClick={() => set({ labelIds: toggleIn(filters.labelIds, l.id) })} />
          ))}
          {snap.projects.length > 0 && (
            <>
              <MenuSep />
              <div className="menu-header"><span>Project</span></div>
              {snap.projects.map(p => (
                <MenuItem key={p.id} icon={<span>{p.icon}</span>} label={p.name} selected={filters.projectIds?.includes(p.id) ?? false}
                  onClick={() => set({ projectIds: toggleIn(filters.projectIds, p.id) })} />
              ))}
            </>
          )}
        </Menu>
      )}
    </>
  );
}

/* ---------------- display options menu ---------------- */
export function DisplayOptionsMenu(props: {
  opts: ViewOptions;
  onPatch: (patch: Partial<ViewOptions>) => void;
  onClose: () => void;
  anchor: DOMRect;
  showLayout?: boolean;
}) {
  const { opts, onPatch } = props;
  const groupLabels: Record<GroupBy, string> = { status: 'Status', priority: 'Priority', assignee: 'Assignee', label: 'Label', project: 'Project', cycle: 'Cycle', none: 'No grouping' };
  const orderLabels: Record<string, string> = { priority: 'Priority', updated: 'Last updated', created: 'Created', due: 'Due date', title: 'Title', manual: 'Manual' };
  const propRows: Array<[keyof DisplayProps, string]> = [
    ['id', 'ID'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['labels', 'Labels'], ['project', 'Project'], ['due', 'Due date'],
  ];
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={256}>
      {props.showLayout !== false && (
        <>
          <div style={{ display: 'flex', gap: 6, padding: '4px 6px 8px' }}>
            <button className={`seg ${opts.layout === 'list' ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => onPatch({ layout: 'list' })}>☰ List</button>
            <button className={`seg ${opts.layout === 'board' ? 'selected' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => onPatch({ layout: 'board' })}>▦ Board</button>
          </div>
          <MenuSep />
        </>
      )}
      <div className="menu-header"><span>Grouping</span></div>
      {(['status', 'priority', 'assignee', 'label', 'project', 'cycle', 'none'] as GroupBy[]).map(g => (
        <MenuItem key={g} label={groupLabels[g]} selected={opts.groupBy === g} onClick={() => onPatch({ groupBy: g })} />
      ))}
      {opts.groupBy !== 'none' && (
        <>
          <div className="menu-header" style={{ paddingTop: 6 }}><span>Sub-grouping</span></div>
          <MenuItem label="None" selected={opts.subgroupBy === 'none'} onClick={() => onPatch({ subgroupBy: 'none' })} />
          {(['priority', 'assignee'] as GroupBy[]).filter(g => g !== opts.groupBy).map(g => (
            <MenuItem key={g} label={groupLabels[g]} selected={opts.subgroupBy === g} onClick={() => onPatch({ subgroupBy: g })} />
          ))}
        </>
      )}
      <MenuSep />
      <div className="menu-header"><span>Ordering</span></div>
      {(['priority', 'updated', 'created', 'due', 'title', 'manual'] as OrderBy[]).map(o => (
        <MenuItem key={o} label={orderLabels[o]} selected={opts.orderBy === o} onClick={() => onPatch({ orderBy: o })} />
      ))}
      <MenuSep />
      <MenuItem label="Show empty groups" selected={opts.showEmpty} onClick={() => onPatch({ showEmpty: !opts.showEmpty })} />
      <MenuSep />
      <div className="menu-header"><span>Display properties</span></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 8px 8px' }}>
        {propRows.map(([prop, label]) => (
          <button
            key={prop}
            className={`prop-chip boxed ${opts.display[prop] ? 'on' : ''}`}
            style={{ height: 22, fontSize: 11.5, opacity: opts.display[prop] ? 1 : 0.55 }}
            onClick={() => onPatch({ display: { ...opts.display, [prop]: !opts.display[prop] } })}
          >{label}</button>
        ))}
      </div>
    </Menu>
  );
}

/* ---------------- bulk action bar ---------------- */
export function BulkBar() {
  const snap = useApp(s => s.snap)!;
  const ids = useSelection(s => s.ids);
  const clear = useSelection(s => s.clear);
  const toast = useApp(s => s.toast);
  const statusMenu = useMenu();
  const prioMenu = useMenu();
  const assigneeMenu = useMenu();
  if (ids.length === 0) return null;
  const issues = ids.map(id => snap.issues.find(i => i.id === id)).filter(Boolean) as Issue[];
  const applyPatch = async (patch: Record<string, unknown>, label: string) => {
    await api.bulkIssues({ ids, patch });
    await useApp.getState().bootstrap();
    toast({ title: `${label} applied to ${ids.length} issue${ids.length > 1 ? 's' : ''}` });
    clear();
  };
  const teamStates = issues.length ? snap.states.filter(s => s.teamId === issues[0]!.teamId) : [];
  const del = async () => {
    for (const id of ids) await api.deleteIssue(id);
    await useApp.getState().bootstrap();
    toast({
      title: `${ids.length} issue${ids.length > 1 ? 's' : ''} deleted`,
      actions: [{ label: 'Undo', onClick: async () => { for (const id of ids) await api.restoreIssue(id); await useApp.getState().bootstrap(); } }],
    });
    clear();
  };
  return (
    <div className="bulk-bar">
      <span className="bulk-count">{ids.length} selected</span>
      <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={statusMenu.open}>Status</button>
      <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={prioMenu.open}>Priority</button>
      <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={assigneeMenu.open}>Assignee</button>
      <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={async () => {
        for (const id of ids) await api.archiveIssue(id);
        await useApp.getState().bootstrap();
        toast({
          title: `${ids.length} issue${ids.length > 1 ? 's' : ''} archived`,
          actions: [{ label: 'Undo', onClick: async () => { for (const id of ids) await api.unarchiveIssue(id); await useApp.getState().bootstrap(); } }],
        });
        clear();
      }}>Archive</button>
      <button className="btn" style={{ height: 26, fontSize: 12, color: '#eb5757' }} onClick={del}>Delete</button>
      <button className="icon-btn" title="Clear selection (Esc)" onClick={clear}><IconClose size={13} /></button>

      {statusMenu.anchor && (
        <Menu anchor={statusMenu.anchor} onClose={statusMenu.close} width={210}>
          {teamStates.map(s => (
            <MenuItem key={s.id} icon={<StateIcon type={s.type} color={s.color} />} label={s.name}
              onClick={() => applyPatch({ stateId: s.id }, 'Status')} />
          ))}
        </Menu>
      )}
      {prioMenu.anchor && (
        <Menu anchor={prioMenu.anchor} onClose={prioMenu.close} width={210}>
          {([[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']] as Array<[Priority, string]>).map(([v, label]) => (
            <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={label} onClick={() => applyPatch({ priority: v }, 'Priority')} />
          ))}
        </Menu>
      )}
      {assigneeMenu.anchor && (
        <Menu anchor={assigneeMenu.anchor} onClose={assigneeMenu.close} width={210}>
          {snap.users.map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} onClick={() => applyPatch({ assigneeId: u.id }, 'Assignee')} />
          ))}
          <MenuSep />
          <MenuItem label="No assignee" onClick={() => applyPatch({ assigneeId: null }, 'Assignee')} />
        </Menu>
      )}
    </div>
  );
}

/* ================= grouped list ================= */
type RenderItem =
  | { kind: 'header'; spec: GroupSpec; count: number }
  | { kind: 'subheader'; groupId: string; spec: GroupSpec; count: number; parent: string }
  | { kind: 'row'; issue: Issue; nested: boolean };

export function GroupedList(props: {
  issues: Issue[];
  teamId?: string;
  opts: ViewOptions;
  emptyTitle?: string;
  emptyDesc?: string;
  hideGroups?: string[];   // state ids excluded up-front (Active/Backlog tabs)
  emptyHideCreate?: boolean;
  onFocusStatus?: (stateId: string) => void;
}) {
  const snap = useApp(s => s.snap)!;
  const openCreate = useApp(s => s.openCreate);
  const cursorIndex = useCursor(s => s.index);
  const selection = useSelection(s => s.ids);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('baseline:collapsedGroups') ?? '{}'); } catch { return {}; }
  });

  const pool = useMemo(() => {
    let out = props.issues;
    if (props.hideGroups?.length) out = out.filter(i => !props.hideGroups!.includes(i.stateId));
    return applyFilters(out, props.opts.filters, snap.states);
  }, [props.issues, props.opts.filters, props.hideGroups, snap.states]);

  const { render, flat } = useMemo(() => {
    const ordered = orderIssues(pool, props.opts.orderBy);
    const renderItems: RenderItem[] = [];
    const flatIssues: Issue[] = [];
    if (props.opts.groupBy === 'none') {
      for (const i of ordered) { renderItems.push({ kind: 'row', issue: i, nested: false }); flatIssues.push(i); }
      return { render: renderItems, flat: flatIssues };
    }
    const specs = groupsFor(props.opts.groupBy, snap, props.teamId);
    let groups = specs.map(spec => ({ spec, issues: issuesOfGroup(props.opts.groupBy, ordered, spec.id, props.teamId) }));
    if (!props.opts.showEmpty) groups = groups.filter(g => g.issues.length > 0);
    for (const g of groups) {
      renderItems.push({ kind: 'header', spec: g.spec, count: g.issues.length });
      if (collapsed[g.spec.id]) continue;
      if (props.opts.subgroupBy !== 'none') {
        const subSpecs = groupsFor(props.opts.subgroupBy as GroupBy, snap, props.teamId).filter(ss => ss.id !== g.spec.id);
        const subGroups = subSpecs
          .map(ss => ({ spec: ss, issues: issuesOfGroup(props.opts.subgroupBy as GroupBy, g.issues, ss.id) }))
          .filter(sg => sg.issues.length > 0);
        for (const sg of subGroups) {
          renderItems.push({ kind: 'subheader', groupId: `${g.spec.id}:${sg.spec.id}`, spec: sg.spec, count: sg.issues.length, parent: g.spec.id });
          for (const i of sg.issues) { renderItems.push({ kind: 'row', issue: i, nested: true }); flatIssues.push(i); }
        }
        const leftover = g.issues.length - subGroups.reduce((a, sg) => a + sg.issues.length, 0);
        if (leftover > 0) for (const i of g.issues) {
          const covered = subGroups.some(sg => sg.issues.includes(i));
          if (!covered) { renderItems.push({ kind: 'row', issue: i, nested: true }); flatIssues.push(i); }
        }
      } else {
        for (const i of g.issues) { renderItems.push({ kind: 'row', issue: i, nested: false }); flatIssues.push(i); }
      }
    }
    return { render: renderItems, flat: flatIssues };
  }, [pool, props.opts, props.teamId, snap, collapsed]);

  useEffect(() => { registerVisibleList(flat, props.teamId ?? ''); }, [flat, props.teamId]);

  if (pool.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icons">
          {snap.states
            .filter(s => (!props.teamId || s.teamId === props.teamId) && ['backlog', 'unstarted', 'started', 'completed'].includes(s.type))
            .slice(0, 4)
            .map(s => <span key={s.id} style={{ display: 'flex', color: 'var(--text-secondary)' }}><StateIcon type={s.type} size={32} /></span>)}
        </div>
        <div className="empty-title">{props.emptyTitle ?? 'All issues'}</div>
        <div className="empty-desc">{props.emptyDesc ?? 'All issues is the place where you can see all your team\u2019s work in one view. Once you have created issues for this team, they will show up here.'}</div>
        <div className="empty-actions">
          {!props.emptyHideCreate && props.teamId && (
            <button className="btn primary" onClick={() => openCreate({ teamId: props.teamId })}>Create new issue <span className="btn-kbd kbd">C</span></button>
          )}
        </div>
      </div>
    );
  }

  const toggleCollapse = (id: string) => setCollapsed(c => {
    const next = { ...c, [id]: !c[id] };
    try { localStorage.setItem('baseline:collapsedGroups', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  return (
    <div style={{ paddingBottom: 40 }}>
      {render.map((item, idx) => {
        if (item.kind === 'header') {
          return (
            <div key={`h-${item.spec.id}`} className="group-header" onClick={() => toggleCollapse(item.spec.id)}>
              <button className="gh-chevron" onClick={e => { e.stopPropagation(); toggleCollapse(item.spec.id); }}>
                {collapsed[item.spec.id] ? <IconChevronRight size={13} /> : <IconChevronDown size={13} />}
              </button>
              {item.spec.icon}
              <span>{item.spec.label}</span>
              <span className="count">{item.count}</span>
              <span className="group-actions" onClick={e => e.stopPropagation()}>
                {props.teamId && props.opts.groupBy === 'status' && (
                  <>
                    <button className="icon-btn" title="Focus this status" onClick={() => props.onFocusStatus?.(item.spec.id)}>
                      <IconFocus size={13} />
                    </button>
                    <button className="icon-btn" title="Create issue in this status"
                      onClick={() => openCreate({ teamId: props.teamId, stateId: item.spec.id })}>
                      <IconPlus size={14} />
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        }
        if (item.kind === 'subheader') {
          return (
            <div key={`sh-${item.groupId}`} className="group-subheader">
              {item.spec.icon}
              <span>{item.spec.label}</span>
              <span className="count">{item.count}</span>
            </div>
          );
        }
        const flatIndex = flat.indexOf(item.issue);
        return (
          <IssueRow
            key={`r-${idx}-${item.issue.id}`}
            issue={item.issue}
            display={props.opts.display}
            selected={selection.includes(item.issue.id)}
            cursor={flatIndex === cursorIndex}
            nested={item.nested}
          />
        );
      })}
    </div>
  );
}

/* helper used by pages to render rows outside a group (project issues tab) */
export function FlatIssueList(props: { issues: Issue[]; teamId?: string; display?: RowDisplay }) {
  const cursorIndex = useCursor(s => s.index);
  const selection = useSelection(s => s.ids);
  const flat = props.issues;
  useEffect(() => { registerVisibleList(flat, props.teamId ?? ''); }, [flat, props.teamId]);
  return (
    <div>
      {flat.map((i, idx) => (
        <IssueRow key={i.id} issue={i} display={props.display} cursor={idx === cursorIndex} selected={selection.includes(i.id)} />
      ))}
    </div>
  );
}
