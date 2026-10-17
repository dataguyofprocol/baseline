import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp, shortDate, relTime, useSelection, useCursor, registerVisibleList, visibleList, LIST_GROUP_ORDER } from './store.js';
import { Menu, MenuItem, MenuSep, MenuSub, useMenu } from './ui.js';
import { OpenInClaudeItems, useHandoffActions } from './CodingTools.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { PropertyMenu, PropertyMenuBody, propMenuWidth, PROP_KBD, type PropKind } from './propertyMenus.js';
import { deleteIssues, toggleFavoriteIssue, convertToProject, convertToTemplate, makeRecurring, CADENCE_LABELS } from './actions.js';
import { useLanding } from './motion.js';
import { IconFilter, IconChevronDown, IconChevronRight, IconPlus, IconClose, IconTrash, IconCalendar, IconCycle, IconFocus, IconSpark, IconCopy, IconStar, IconUser, IconUsers, IconTag, IconBox, IconEstimate, IconMilestone, IconBlocked, IconBlocks, IconRelated, IconDuplicate, IconSubIssue, IconClock, IconBell, IconList, IconBoard, IconCheck, IconTextAa, IconTeam, IconEdit, IconAttach, IconDoc, IconRelease, IconSla, IconPr, IconSortDir, IconMore, IconLink, IconBranch, IconHandoff, IconExternal, IconSettings } from './icons.js';
import { slaState, SlaBadge } from './AutomationUI.js';
import { issuePrList, issuePrState, prSummary, PrIcon } from './GitHubUI.js';
import { teamScale, pointsOf, type Issue, type Priority, type ViewFilters, type GroupBy, type OrderBy, type FilterCondition, type FilterGroup } from '../../src/core/types.js';
import { Illustration } from './illustrations.js';

type Snap = NonNullable<ReturnType<typeof useApp.getState>['snap']>;

/* ================= view preferences (persisted per page) ================= */
export interface DisplayProps {
  id: boolean; status: boolean; assignee: boolean; priority: boolean; labels: boolean; project: boolean; due: boolean;
  cycle: boolean; milestone: boolean; estimate: boolean; created: boolean; updated: boolean; links: boolean; creator: boolean;
  /** the linked pull requests' status icon */
  prs: boolean;
}
export type CompletedWindow = 'all' | 'day' | 'week' | 'month' | 'none';
export interface ViewOptions {
  layout: 'list' | 'board';
  groupBy: GroupBy;
  subgroupBy: GroupBy | 'none';
  orderBy: OrderBy;
  showEmpty: boolean;
  display: DisplayProps;
  filters: ViewFilters;
  /** how long finished work stays visible */
  completed: CompletedWindow;
  showSubIssues: boolean;
  showTriage: boolean;
  /** finished issues sort by when they were finished, newest first */
  completedByRecency: boolean;
  /** the ordering's direction flipped (the arrow beside Ordering) */
  orderReversed?: boolean;
}

export const DEFAULT_DISPLAY: DisplayProps = {
  id: true, status: true, assignee: true, priority: true, labels: true, project: true, due: true,
  cycle: false, milestone: false, estimate: false, created: true, updated: false, links: false, creator: false, prs: true,
};
export const DEFAULT_VIEW_OPTIONS: Omit<ViewOptions, 'filters'> = {
  layout: 'list', groupBy: 'status', subgroupBy: 'none', orderBy: 'priority', showEmpty: false,
  display: DEFAULT_DISPLAY, completed: 'all', showSubIssues: true, showTriage: false, completedByRecency: false,
};

export function useViewPrefs<T extends object>(key: string, defaults: T): [T, (patch: Partial<T>) => void, () => void] {
  const read = (): T => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
      const d = defaults as T & { display?: object };
      // nested display props merge too, so properties added later get their defaults
      return { ...defaults, ...stored, ...(d.display ? { display: { ...d.display, ...(stored.display ?? {}) } } : {}) };
    } catch { return defaults; }
  };
  const [prefs, setPrefs] = useState<T>(read);
  const patch = (p: Partial<T>) => setPrefs(cur => {
    const next = { ...cur, ...p };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const reset = () => { try { localStorage.removeItem(key); } catch { /* ignore */ } setPrefs(defaults); };
  return [prefs, patch, reset];
}

/* ================= filtering ================= */
const DAY = 86400000;
const WINDOW_MS: Record<string, number> = { day: DAY, week: 7 * DAY, month: 30 * DAY, quarter: 91 * DAY };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDaysIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** does one filter field hold an issue? (before the field's "is not" is applied) */
function testField(key: keyof ViewFilters, i: Issue, f: ViewFilters, snap: Snap): boolean {
  const state = snap.states.find(s => s.id === i.stateId);
  const closed = state?.type === 'completed' || state?.type === 'canceled';
  const me = snap.currentUser.id;
  const resolveUser = (ids: string[]) => ids.map(x => x === 'me' ? me : x);
  switch (key) {
    case 'states': {
      // a status filter matches by name, so "In Progress" covers every team's In Progress
      const names = new Set(f.states!.map(id => snap.states.find(s => s.id === id)?.name).filter(Boolean));
      return !!state && names.has(state.name);
    }
    case 'stateTypes': return !!state && f.stateTypes!.includes(state.type);
    case 'priority': return f.priority!.includes(i.priority);
    case 'assigneeIds': return resolveUser(f.assigneeIds!).includes(i.assigneeId ?? 'none');
    case 'creatorIds': return resolveUser(f.creatorIds!).includes(i.creatorId ?? 'none');
    case 'labelIds': return f.labelIds!.some(l => l === 'none' ? i.labelIds.length === 0 : i.labelIds.includes(l));
    case 'projectIds': return f.projectIds!.includes(i.projectId ?? 'none');
    case 'milestoneIds': return f.milestoneIds!.includes(i.milestoneId ?? 'none');
    case 'releaseIds': return f.releaseIds!.includes(i.releaseId ?? 'none');
    case 'sla': return f.sla!.includes(slaState(i) ?? 'none');
    case 'prs': { const st = issuePrState(snap, i.id); return f.prs!.some(v => v === 'none' ? !st : st === v); }
    case 'cycleIds': {
      const now = new Date().toISOString();
      return f.cycleIds!.some(c => {
        if (c === 'none') return !i.cycleId;
        if (c === 'current') { const cy = snap.cycles.find(x => x.id === i.cycleId); return !!cy && cy.startsAt <= now && cy.endsAt >= now; }
        if (c === 'upcoming') { const cy = snap.cycles.find(x => x.id === i.cycleId); return !!cy && cy.startsAt > now; }
        return i.cycleId === c;
      });
    }
    case 'estimates': return f.estimates!.includes(i.estimate ?? -1);
    case 'due': {
      const due = i.dueDate?.slice(0, 10);
      const t = todayIso();
      return f.due!.some(d => {
        if (d === 'none') return !due;
        if (!due) return false;
        if (d === 'any') return true;
        if (d === 'overdue') return due < t && !closed;
        if (d === 'today') return due === t;
        if (d === 'week') return due >= t && due <= addDaysIso(7);
        if (d === 'month') return due >= t && due <= addDaysIso(30);
        return false;
      });
    }
    case 'created': return Date.now() - new Date(i.createdAt).getTime() <= WINDOW_MS[f.created!];
    case 'updated': return Date.now() - new Date(i.updatedAt).getTime() <= WINDOW_MS[f.updated!];
    case 'hierarchy': return f.hierarchy!.some(h => {
      const hasKids = snap.issues.some(x => x.parentId === i.id);
      if (h === 'parent') return hasKids;
      if (h === 'subissue') return !!i.parentId;
      return !hasKids && !i.parentId;
    });
    case 'relations': return f.relations!.some(r => snap.relations.some(rel => rel.issueId === i.id && rel.type === (r === 'blocked' ? 'blocked_by' : r === 'blocking' ? 'blocks' : r)));
    case 'subscriberIds': {
      const ids = resolveUser(f.subscriberIds!);
      return snap.subscriptions.some(x => x.issueId === i.id && ids.includes(x.userId));
    }
    case 'links': {
      const has = snap.attachments.some(a => a.issueId === i.id);
      return f.links!.some(v => v === 'any' ? has : !has);
    }
    case 'query': {
      const q = f.query!.toLowerCase();
      const key = `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`.toLowerCase();
      return i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || key === q;
    }
    default: return true;
  }
}

const FILTER_KEYS: Array<keyof ViewFilters> = ['states', 'stateTypes', 'priority', 'assigneeIds', 'creatorIds', 'labelIds', 'projectIds', 'milestoneIds', 'releaseIds', 'sla', 'prs', 'cycleIds', 'estimates', 'due', 'created', 'updated', 'hierarchy', 'relations', 'subscriberIds', 'links', 'query'];
const isSet = (f: ViewFilters, k: keyof ViewFilters) => { const v = f[k]; return Array.isArray(v) ? v.length > 0 : !!v; };

export function applyFilters(issues: Issue[], f: ViewFilters, _states?: unknown): Issue[] {
  void _states;
  const snap = useApp.getState().snap;
  if (!snap) return issues;
  const keys = FILTER_KEYS.filter(k => isSet(f, k));
  const adv = f.advanced && countConditions(f.advanced) > 0 ? f.advanced : null;
  if (!keys.length && !adv) return issues;
  const not = new Set(f.not ?? []);
  return issues.filter(i => keys.every(k => testField(k, i, f, snap) !== not.has(k)) && (!adv || evalGroup(adv, i, snap)));
}

const isGroup = (x: FilterCondition | FilterGroup): x is FilterGroup => 'items' in x;
export function countConditions(g: FilterGroup): number {
  return g.items.reduce((n, x) => n + (isGroup(x) ? countConditions(x) : x.values.length ? 1 : 0), 0);
}
/** an advanced group: its conditions (and nested groups) joined by and / or; empty parts are ignored */
function evalGroup(g: FilterGroup, i: Issue, snap: Snap): boolean {
  const parts = g.items.filter(x => isGroup(x) ? countConditions(x) > 0 : x.values.length > 0);
  if (!parts.length) return true;
  const test = (x: FilterCondition | FilterGroup) => {
    if (isGroup(x)) return evalGroup(x, i, snap);
    const probe = withValues({}, x.field as FieldKey, x.values);
    return testField(x.field as keyof ViewFilters, i, probe, snap) !== !!x.not;
  };
  return g.op === 'and' ? parts.every(test) : parts.some(test);
}

/** the display options that hide issues: finished-work window, sub-issues, triage */
export function applyDisplay(issues: Issue[], opts: Pick<ViewOptions, 'completed' | 'showSubIssues' | 'showTriage'>): Issue[] {
  const snap = useApp.getState().snap;
  if (!snap) return issues;
  const typeOf = new Map(snap.states.map(s => [s.id, s.type]));
  const win = opts.completed ?? 'all';
  return issues.filter(i => {
    const t = typeOf.get(i.stateId);
    if (opts.showSubIssues === false && i.parentId) return false;
    if (!opts.showTriage && t === 'triage') return false;
    if ((t === 'completed' || t === 'canceled') && win !== 'all') {
      if (win === 'none') return false;
      const at = i.completedAt ?? i.canceledAt ?? i.updatedAt;
      return Date.now() - new Date(at).getTime() <= WINDOW_MS[win];
    }
    return true;
  });
}

export function orderIssues(issues: Issue[], orderBy: string, completedByRecency = false, reversed = false): Issue[] {
  const arr = [...issues];
  const snap = useApp.getState().snap;
  const stateRank = (i: Issue) => {
    const s = snap?.states.find(x => x.id === i.stateId);
    return s ? (LIST_GROUP_ORDER as readonly string[]).indexOf(s.type) * 1000 + s.position : 0;
  };
  const sorted = (() => {
    switch (orderBy) {
      case 'priority': return arr.sort((a, b) => (a.priority === 0 ? 99 : a.priority) - (b.priority === 0 ? 99 : b.priority) || a.sortOrder - b.sortOrder);
      case 'updated': return arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      case 'created': return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      case 'due': return arr.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
      case 'title': return arr.sort((a, b) => a.title.localeCompare(b.title));
      case 'status': return arr.sort((a, b) => stateRank(a) - stateRank(b) || a.sortOrder - b.sortOrder);
      case 'estimate': return arr.sort((a, b) => (b.estimate ?? -1) - (a.estimate ?? -1));
      default: return arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }
  })();
  if (reversed && orderBy !== 'manual') sorted.reverse();
  if (!completedByRecency) return sorted;
  const closedAt = (i: Issue) => i.completedAt ?? i.canceledAt;
  const open = sorted.filter(i => !closedAt(i));
  const closed = sorted.filter(i => closedAt(i)).sort((a, b) => closedAt(b)!.localeCompare(closedAt(a)!));
  return [...open, ...closed];
}

export function activeFilterCount(f: ViewFilters): number {
  return FILTER_KEYS.filter(k => isSet(f, k)).length + (f.advanced && countConditions(f.advanced) ? 1 : 0);
}

/* ================= grouping ================= */
export interface GroupSpec { id: string; label: string; icon: React.ReactNode; orderIndex: number }

export function groupsFor(groupBy: GroupBy, snap: Snap, teamId?: string): GroupSpec[] {
  const teamStates = snap.states
    .filter(s => !teamId || s.teamId === teamId)
    .slice().sort((a, b) => {
      const ia = (LIST_GROUP_ORDER as readonly string[]).indexOf(a.type);
      const ib = (LIST_GROUP_ORDER as readonly string[]).indexOf(b.type);
      return ia !== ib ? ia - ib : a.position - b.position;
    });
  switch (groupBy) {
    case 'status': {
      const seen = new Map<string, GroupSpec>();
      for (const s of teamStates) {
        if (seen.has(s.name)) continue;
        seen.set(s.name, { id: s.id, label: s.name, icon: <StateIcon type={s.type} color={s.color} size={14} />, orderIndex: (LIST_GROUP_ORDER as readonly string[]).indexOf(s.type) * 100 + s.position });
      }
      return [...seen.values()];
    }
    case 'priority': {
      const list: Array<[Priority, string]> = [[1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low'], [0, 'No priority']];
      return list.map(([p, label]) => ({ id: String(p), label, icon: <PriorityIcon priority={p} size={14} />, orderIndex: p === 0 ? 99 : p }));
    }
    case 'assignee': {
      const me = snap.currentUser.id;
      const users = [...snap.users].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
      const specs: GroupSpec[] = users.map(u => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={18} />, orderIndex: 0 }));
      specs.push({ id: 'none', label: 'No assignee', icon: <Avatar user={null} size={18} />, orderIndex: 1 });
      return specs;
    }
    case 'label': {
      const specs: GroupSpec[] = snap.labels.filter(l => !teamId || l.teamId === teamId)
        .map(l => ({ id: l.id, label: l.name, icon: <span className="label-dot" style={{ background: l.color }} />, orderIndex: 0 }));
      specs.push({ id: 'none', label: 'No label', icon: <IconTag size={13} />, orderIndex: 1 });
      return specs;
    }
    case 'project': {
      const specs: GroupSpec[] = snap.projects.map(p => ({ id: p.id, label: p.name, icon: <span className="proj-icon" style={{ width: 16, height: 16, fontSize: 10 }}>{p.icon}</span>, orderIndex: 0 }));
      specs.push({ id: 'none', label: 'No project', icon: <IconBox size={13} />, orderIndex: 1 });
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
    case 'milestone': {
      const specs: GroupSpec[] = snap.milestones.map(m => {
        const p = snap.projects.find(x => x.id === m.projectId);
        return { id: m.id, label: p && !teamId ? m.name : m.name, icon: <IconMilestone size={13} />, orderIndex: m.position };
      });
      specs.push({ id: 'none', label: 'No milestone', icon: <IconMilestone size={13} />, orderIndex: 9999 });
      return specs;
    }
    case 'team': {
      return snap.teams.map(t => ({ id: t.id, label: t.name, icon: <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 9, width: 16, height: 16 }}>{t.key[0]}</span>, orderIndex: t.position }));
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
    case 'milestone': return issues.filter(i => (i.milestoneId ?? 'none') === groupId);
    case 'team': return issues.filter(i => i.teamId === groupId);
    default:
      void teamId;
      return issues;
  }
}

let lastCheckedId: string | null = null;
/** shift-click a checkbox: extend the selection across the visible list from the last clicked row */
function shiftSelectRange(id: string) {
  const list = visibleList.issues.map(i => i.id);
  // extend from the last row you selected — by click or with X — like Linear
  const sel = useSelection.getState().ids;
  const anchor = lastCheckedId && sel.includes(lastCheckedId) ? lastCheckedId : sel[sel.length - 1];
  const from = anchor ? list.indexOf(anchor) : -1;
  const to = list.indexOf(id);
  lastCheckedId = id;
  if (from === -1 || to === -1 || from === to) {
    useSelection.getState().toggle(id);
    return;
  }
  const [a, b] = from < to ? [from, to] : [to, from];
  useSelection.getState().setMany([...new Set([...useSelection.getState().ids, ...list.slice(a, b + 1)])]);
}

/* ================= sub-issues ================= */
/* one pass per snapshot builds every parent's tally — rows and cards then just look theirs up.
   Keyed on the issues array, which every snapshot swap (bootstrap, optimistic move) replaces. */
const progressIndex = new WeakMap<Snap['issues'], Map<string, { done: number; total: number }>>();
function progressFor(snap: Snap): Map<string, { done: number; total: number }> {
  let idx = progressIndex.get(snap.issues);
  if (idx) return idx;
  idx = new Map();
  const closedState = new Set(snap.states.filter(s => s.type === 'completed' || s.type === 'canceled').map(s => s.id));
  for (const i of snap.issues) {
    if (!i.parentId || i.archivedAt || i.deletedAt) continue;
    const t = idx.get(i.parentId) ?? { done: 0, total: 0 };
    t.total++;
    if (closedState.has(i.stateId)) t.done++;
    idx.set(i.parentId, t);
  }
  progressIndex.set(snap.issues, idx);
  return idx;
}

/** closed / total over an issue's live sub-issues (null when it has none) */
export function subIssueProgress(issueId: string, snap: Snap): { done: number; total: number } | null {
  return progressFor(snap).get(issueId) ?? null;
}

/** a ring that fills with closed sub-issues, beside the count — the parent's row and page both show it */
export function SubIssueProgress(props: { done: number; total: number; size?: number }) {
  const size = props.size ?? 13;
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  const frac = props.total ? props.done / props.total : 0;
  return (
    <span className={`sub-progress${frac === 1 ? ' complete' : ''}`} title={`${props.done} of ${props.total} sub-issues done`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.5" strokeDasharray={frac === 0 ? '1.6 1.6' : undefined} />
        {frac > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--status-completed)" strokeWidth="1.5"
          strokeDasharray={`${c * frac} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      {props.done}/{props.total}
    </span>
  );
}

/** keep a group's order, but slot each sub-issue straight under its parent when both are in the group */
export function nestSubIssues(list: Issue[]): Array<{ issue: Issue; depth: number }> {
  const ids = new Set(list.map(i => i.id));
  const kids = new Map<string, Issue[]>();
  for (const i of list) if (i.parentId && ids.has(i.parentId)) kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i]);
  const out: Array<{ issue: Issue; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (i: Issue, depth: number) => {
    if (seen.has(i.id)) return;
    seen.add(i.id);
    out.push({ issue: i, depth });
    for (const k of kids.get(i.id) ?? []) visit(k, Math.min(depth + 1, 3));
  };
  for (const i of list) if (!(i.parentId && ids.has(i.parentId))) visit(i, 0);
  for (const i of list) visit(i, 0); // a parent cycle in bad data still renders every row once
  return out;
}

/** "Sep 29", or "2h ago" inside a week */
function dateShort(iso: string) {
  return Date.now() - new Date(iso).getTime() < 7 * DAY ? relTime(iso) : shortDate(iso);
}

export function estimateLabel(issue: Issue, snap: Snap): string | null {
  if (issue.estimate == null) return null;
  const team = snap.teams.find(t => t.id === issue.teamId);
  if (team?.estimateScale === 'tshirt') return teamScale(team).find(s => s.value === issue.estimate)?.label ?? String(issue.estimate);
  return String(issue.estimate);
}

/* ================= issue row ================= */
export type RowDisplay = Partial<DisplayProps>;

export function IssueRow(props: {
  issue: Issue;
  display?: RowDisplay;
  selected?: boolean;
  cursor?: boolean;
  nested?: boolean;
  /** 1+ = rendered under its parent's row, so the parent breadcrumb is redundant */
  depth?: number;
  onOpen?: () => void;
  /** pointer over the row moves the keyboard cursor here, like Linear */
  onHover?: () => void;
}) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const issueMenu = useMenu();
  const toggleSelected = useSelection(s => s.toggle);
  const checksOn = useSelection(s => s.ids.length > 0);
  const display: RowDisplay = props.display ?? DEFAULT_DISPLAY;
  const issue = props.issue;
  const team = snap.teams.find(t => t.id === issue.teamId);
  const state = snap.states.find(s => s.id === issue.stateId);
  const assignee = snap.users.find(u => u.id === issue.assigneeId);
  const creator = snap.users.find(u => u.id === issue.creatorId);
  const labels = snap.labels.filter(l => issue.labelIds.includes(l.id));
  const project = snap.projects.find(p => p.id === issue.projectId);
  const milestone = snap.milestones.find(m => m.id === issue.milestoneId);
  const cycle = snap.cycles.find(c => c.id === issue.cycleId);
  const key = `${team?.key ?? 'ISS'}-${issue.number}`;
  const parent = issue.parentId ? snap.issues.find(i => i.id === issue.parentId) : undefined;
  const parentKey = parent ? `${snap.teams.find(t => t.id === parent.teamId)?.key}-${parent.number}` : '';
  const progress = subIssueProgress(issue.id, snap);
  const depth = props.depth ?? 0;
  const closed = state?.type === 'completed' || state?.type === 'canceled';
  const blocked = !closed && snap.relations.some(r => r.issueId === issue.id && r.type === 'blocked_by'
    && !['completed', 'canceled'].includes(snap.states.find(s => s.id === snap.issues.find(x => x.id === r.relatedIssueId)?.stateId)?.type ?? 'completed'));
  const links = display.links ? snap.attachments.filter(a => a.issueId === issue.id).length : 0;
  const est = display.estimate ? estimateLabel(issue, snap) : null;
  const due = issue.dueDate?.slice(0, 10);
  const overdue = !!due && !closed && due < todayIso();

  // optimistic landing: a status change or a fresh create lands the row with
  // the enter + flash, and a move into completed morphs the status icon
  const { justMoved, becameDone } = useLanding(issue, state?.type);

  const open = () => {
    if (props.onOpen) props.onOpen();
    else navigate(`/issue/${key}`);
  };

  return (
    <div
      data-issue-row={issue.id}
      className={`issue-row ${props.selected ? 'selected' : ''} ${props.cursor ? 'cursor' : ''} ${props.nested ? 'nested' : ''} ${depth ? 'child' : ''} ${justMoved ? 'just-moved' : ''} ${checksOn ? 'checks-on' : ''}`}
      style={depth ? { '--depth': depth } as React.CSSProperties : undefined}
      onClick={(e) => {
        // ⌘/ctrl-click and shift-click select instead of opening, like Linear
        if (e.metaKey || e.ctrlKey) { lastCheckedId = issue.id; toggleSelected(issue.id); return; }
        if (e.shiftKey) { shiftSelectRange(issue.id); return; }
        open();
      }}
      onMouseMove={props.onHover}
      onContextMenu={(e) => issueMenu.open(e)}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); navigate(`/issue/${key}`); } }}
    >
      <input
        type="checkbox" className="row-check" checked={props.selected ?? false}
        onClick={e => e.stopPropagation()}
        onChange={(e) => {
          if ((e.nativeEvent as MouseEvent).shiftKey) shiftSelectRange(issue.id);
          else { lastCheckedId = issue.id; toggleSelected(issue.id); }
        }}
      />
      {display.priority && <PriorityIcon priority={issue.priority} size={14} />}
      {display.id && <span className="issue-key">{key}</span>}
      {blocked && <span className="row-blocked" title="Blocked by another issue"><IconBlocked size={13} /></span>}
      {display.status && state && <StateIcon type={state.type} color={state.color} size={14} morph={becameDone} />}
      <span className="row-title-wrap">
        <span className="row-title">{issue.title}</span>
        {progress && <SubIssueProgress done={progress.done} total={progress.total} />}
        {parent && depth === 0 && (
          <span className="row-parent" title={`Sub-issue of ${parentKey} ${parent.title}`}>
            <IconChevronRight size={10} />{parent.title}
          </span>
        )}
      </span>
      <span className="row-meta">
        {display.labels && labels.slice(0, 3).map(l => (
          <span key={l.id} className="label-pill" style={{ background: `color-mix(in srgb, ${l.color} calc(var(--label-bg-alpha) * 100%), transparent)`, color: 'var(--text-secondary)' }}>
            <span className="label-dot" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
        {display.labels && labels.length > 3 && <span className="label-pill more" title={labels.slice(3).map(l => l.name).join(', ')}>+{labels.length - 3}</span>}
        {display.project && project && <span className="proj-chip" title={project.name}>{project.icon} <span className="chip-text">{project.name}</span></span>}
        {display.milestone && milestone && <span className="proj-chip" title={milestone.name}><IconMilestone size={11} /> <span className="chip-text">{milestone.name}</span></span>}
        {display.cycle && cycle && <span className="proj-chip" title={cycle.name || `Cycle ${cycle.number}`}><IconCycle size={11} /> {cycle.number}</span>}
        {est && <span className="proj-chip" title={`${issue.estimate} points`}><IconEstimate size={11} /> {est}</span>}
        {display.links && links > 0 && <span className="proj-chip" title={`${links} link${links === 1 ? '' : 's'}`}><IconAttach size={11} /> {links}</span>}
        {display.prs !== false && (() => { const pr = issuePrState(snap, issue.id); return pr ? <PrIcon state={pr} size={13} title={prSummary(issuePrList(snap, issue.id))} /> : null; })()}
        {issue.slaBreachesAt && !closed && <SlaBadge issue={issue} />}
        {display.due && due && (
          <span className={`due-chip ${overdue ? 'overdue' : ''}`} title={overdue ? `Overdue — due ${shortDate(due)}` : `Due ${shortDate(due)}`}>
            <IconCalendar size={11} /> {shortDate(due + 'T12:00')}
          </span>
        )}
        {display.creator && creator && <span className="row-creator" title={`Created by ${creator.name}`}><Avatar user={creator} size={16} /></span>}
        {display.assignee && <Avatar user={assignee} />}
        {display.created && <span className="row-date" title={`Created ${new Date(issue.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}>{dateShort(issue.createdAt)}</span>}
        {display.updated && <span className="row-date" title={`Updated ${new Date(issue.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}>{dateShort(issue.updatedAt)}</span>}
      </span>
      {issueMenu.anchor && <IssueContextMenu anchor={issueMenu.anchor} onClose={issueMenu.close} issue={issue} />}
    </div>
  );
}

/* ---------------- row context menu ----------------
   Linear's menu: properties as flyouts (each the same filterable menu the
   shortcut opens), then create-related / mark-as / copy / open-in, favorite,
   remind, delete. Right-clicking a selected row acts on the whole selection. */
/** open an issue's page, then act there (rename, add link) once it has rendered */
function openOnPage(issue: Issue, then: () => void) {
  const snap = useApp.getState().snap!;
  location.hash = `#/issue/${snap.teams.find(t => t.id === issue.teamId)?.key}-${issue.number}`;
  setTimeout(then, 450);
}

export function IssueContextMenu(props: { anchor: DOMRect; onClose: () => void; issue: Issue }) {
  const snap = useApp(s => s.snap)!;
  const openCreate = useApp(s => s.openCreate);
  const selection = useSelection(s => s.ids);
  const targets = selection.includes(props.issue.id)
    ? snap.issues.filter(i => selection.includes(i.id))
    : [props.issue];
  const many = targets.length > 1;
  const handoff = useHandoffActions(props.issue);
  const faved = snap.favorites.some(f => f.type === 'issue' && f.refId === props.issue.id);

  const prop = (kind: PropKind, label: string, icon: React.ReactNode) => (
    <MenuSub key={kind} icon={icon} label={label} right={PROP_KBD[kind] ? <span className="mi-kbd">{PROP_KBD[kind]}</span> : undefined} width={propMenuWidth(kind)}>
      <PropertyMenuBody kind={kind} issues={targets} onClose={props.onClose} />
    </MenuSub>
  );

  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={236}>
      {many && <div className="menu-header"><span>{targets.length} issues selected</span></div>}
      {prop('status', 'Status', <StateIcon type="started" size={14} />)}
      {prop('priority', 'Priority', <PriorityIcon priority={2} size={14} />)}
      {prop('assignee', 'Assignee', <IconUser size={14} />)}
      {prop('due', 'Due date', <IconCalendar size={14} />)}
      {prop('labels', 'Labels', <IconTag size={14} />)}
      {prop('project', 'Project', <IconBox size={14} />)}
      {prop('estimate', 'Estimate', <IconEstimate size={14} />)}
      {prop('cycle', 'Cycle', <IconCycle size={14} />)}
      <MenuSub icon={<IconMore size={14} />} label="More properties" width={220}>
        {targets.every(t => t.projectId && t.projectId === targets[0].projectId) && prop('milestone', 'Milestone', <IconMilestone size={14} />)}
        {!many && <MenuItem icon={<IconLink size={14} />} label="Add link…" right={<span className="mi-kbd">⌃L</span>} onClick={() => openOnPage(props.issue, () => document.querySelector<HTMLElement>('.issue-page [data-add-link]')?.click())} />}
        {!many && <MenuItem icon={<IconEdit size={14} />} label="Rename…" right={<span className="mi-kbd">⇧R</span>} onClick={() => openOnPage(props.issue, () => window.dispatchEvent(new CustomEvent('baseline:rename-issue')))} />}
      </MenuSub>
      <MenuSep />
      {!many && (
        <MenuSub icon={<IconPlus size={14} />} label="Create related" width={220}>
          <MenuItem icon={<IconPlus size={14} />} label="Issue…" onClick={() => openCreate({ teamId: props.issue.teamId, projectId: props.issue.projectId })} />
          <MenuItem icon={<IconSubIssue size={14} />} label="Sub-issue…" right={<span className="mi-kbd">⌘⇧O</span>} onClick={() => openCreate({ teamId: props.issue.teamId, parentId: props.issue.id, projectId: props.issue.projectId, cycleId: props.issue.cycleId })} />
          <MenuItem icon={<IconSubIssue size={14} />} label="Parent issue…" onClick={() => openCreate({ teamId: props.issue.teamId, projectId: props.issue.projectId, related: { issueId: props.issue.id, kind: 'parent' } })} />
          <MenuItem icon={<IconBlocked size={14} />} label="Blocked issue…" onClick={() => openCreate({ teamId: props.issue.teamId, projectId: props.issue.projectId, related: { issueId: props.issue.id, kind: 'blocked_by' } })} />
          <MenuItem icon={<IconBlocks size={14} />} label="Blocking issue…" onClick={() => openCreate({ teamId: props.issue.teamId, projectId: props.issue.projectId, related: { issueId: props.issue.id, kind: 'blocks' } })} />
        </MenuSub>
      )}
      <MenuSub icon={<IconRelated size={14} />} label="Mark as" width={240}>
        {!many && <MenuSub icon={<IconSubIssue size={14} />} label="Parent of…" width={propMenuWidth('parent_of')}><PropertyMenuBody kind="parent_of" issues={targets} onClose={props.onClose} /></MenuSub>}
        <MenuSub icon={<IconSubIssue size={14} />} label="Sub-issue of…" right={<span className="mi-kbd">⌘⇧P</span>} width={propMenuWidth('parent')}><PropertyMenuBody kind="parent" issues={targets} onClose={props.onClose} /></MenuSub>
        <MenuSub icon={<IconRelated size={14} />} label="Related to…" right={<span className="mi-kbd">M R</span>} width={propMenuWidth('related')}><PropertyMenuBody kind="related" issues={targets} onClose={props.onClose} /></MenuSub>
        <MenuSub icon={<IconBlocked size={14} />} label="Blocked by…" right={<span className="mi-kbd">M B</span>} width={propMenuWidth('blocked_by')}><PropertyMenuBody kind="blocked_by" issues={targets} onClose={props.onClose} /></MenuSub>
        <MenuSub icon={<IconBlocks size={14} />} label="Blocking…" right={<span className="mi-kbd">M X</span>} width={propMenuWidth('blocks')}><PropertyMenuBody kind="blocks" issues={targets} onClose={props.onClose} /></MenuSub>
        <MenuSub icon={<IconDuplicate size={14} />} label="Duplicate of…" right={<span className="mi-kbd">M M</span>} width={propMenuWidth('duplicate')}><PropertyMenuBody kind="duplicate" issues={targets} onClose={props.onClose} /></MenuSub>
      </MenuSub>
      <MenuSep />
      {!many && (
        <MenuSub icon={<IconCopy size={14} />} label="Copy" width={300}>
          <MenuItem icon={<IconCopy size={14} />} label="Copy ID" right={<span className="mi-kbd">⌘.</span>} onClick={() => void handoff.copyId()} />
          <MenuItem icon={<IconLink size={14} />} label="Copy URL" right={<span className="mi-kbd">⌘⇧,</span>} onClick={() => void handoff.copyUrl()} />
          <MenuItem icon={<IconTextAa size={14} />} label="Copy title" right={<span className="mi-kbd">⌘⇧'</span>} onClick={() => void handoff.copyTitle()} />
          <MenuItem icon={<IconLink size={14} />} label="Copy title as link" onClick={() => void handoff.copyTitleLink()} />
          <MenuItem icon={<IconDoc size={14} />} label="Copy issue as Markdown" onClick={() => void handoff.copyMarkdown()} />
          <MenuItem icon={<IconDoc size={14} />} label="Copy everything as Markdown" right={<span className="mi-kbd">⌘⌥C</span>} onClick={() => void handoff.copyEverything()} />
          <MenuItem icon={<IconBranch size={14} />} label="Copy git branch name" right={<span className="mi-kbd">⌘⇧.</span>} onClick={e => void handoff.copyBranch({ skipStart: e.altKey })} />
          <MenuItem icon={<IconHandoff size={14} />} label="Copy as prompt" right={<span className="mi-kbd">⌘⌥P</span>} onClick={e => void handoff.copyPrompt({ skipStart: e.altKey })} />
        </MenuSub>
      )}
      {!many && <MenuSub icon={<IconBox size={14} />} label="Convert to" width={220}>
          <MenuItem icon={<IconBox size={14} />} label="Project…" onClick={() => void convertToProject(props.issue.id, to => { location.hash = `#${to}`; })} />
          <MenuItem icon={<IconDoc size={14} />} label="Template…" onClick={() => void convertToTemplate(props.issue.id)} />
          <MenuSub icon={<IconCycle size={14} />} label="Recurring issue…" width={200}>
            {(Object.keys(CADENCE_LABELS) as Array<keyof typeof CADENCE_LABELS>).map(c => <MenuItem key={c} label={CADENCE_LABELS[c]} onClick={() => void makeRecurring(props.issue.id, c)} />)}
          </MenuSub>
        </MenuSub>}
      {!many && <MenuItem icon={<IconDuplicate size={14} />} label="Make a copy…" onClick={() => openCreate({ teamId: props.issue.teamId, copyFrom: props.issue.id })} />}
      {!many && (
        <MenuSub icon={<IconTeam size={14} />} label="Move" width={220}>
          <MenuItem icon={<IconTeam size={14} />} label="Move to team…" right={<span className="mi-kbd">⌘⇧M</span>} onClick={() => useApp.getState().setQuickMenu({ issueIds: [props.issue.id], kind: 'team', anchor: props.anchor })} />
        </MenuSub>
      )}
      {!many && (
        <MenuSub icon={<IconExternal size={14} />} label="Open in" width={240}>
          <MenuSub icon={<IconSpark size={14} />} label="Open in Claude Code">
            <OpenInClaudeItems issue={props.issue} actions={handoff} />
          </MenuSub>
          <MenuItem icon={<IconSettings size={14} />} label="Configure coding tools…" onClick={() => { location.hash = '#/settings/handoff'; }} />
        </MenuSub>
      )}
      <MenuSep />
      {!many && <MenuItem icon={<IconStar size={14} filled={faved} />} label={faved ? 'Unfavorite' : 'Favorite'} right={<span className="mi-kbd">⌥F</span>} onClick={() => void toggleFavoriteIssue(props.issue.id)} />}
      <MenuSub icon={<IconClock size={14} />} label="Remind me" right={<span className="mi-kbd">⇧H</span>} width={propMenuWidth('remind')}>
        <PropertyMenuBody kind="remind" issues={targets} onClose={props.onClose} />
      </MenuSub>
      <MenuSep />
      <MenuItem icon={<IconTrash size={14} />} label={many ? `Delete ${targets.length} issues` : 'Delete'} right={<span className="mi-kbd">⌘⌫</span>} onClick={() => void deleteIssues(targets.map(t => t.id))} />
    </Menu>
  );
}

/* ---------------- quick menus (keyboard S/P/A/L/⇧D… on rows and the open issue) ---------------- */
export function QuickMenus() {
  const quickMenu = useApp(s => s.quickMenu);
  const setQuickMenu = useApp(s => s.setQuickMenu);
  const snap = useApp(s => s.snap);
  if (!quickMenu || !snap) return null;
  const issues = snap.issues.filter(i => quickMenu.issueIds.includes(i.id));
  if (!issues.length) return null;
  return <PropertyMenu kind={quickMenu.kind} issues={issues} anchor={quickMenu.anchor} onClose={() => setQuickMenu(null)} />;
}

/* ================= filters ================= */
type FieldKey = 'states' | 'assigneeIds' | 'creatorIds' | 'priority' | 'labelIds' | 'projectIds' | 'milestoneIds' | 'releaseIds' | 'sla' | 'prs' | 'cycleIds' | 'estimates' | 'due' | 'created' | 'updated' | 'hierarchy' | 'relations' | 'subscriberIds' | 'links' | 'query';
interface FieldValue { id: string; label: string; icon?: React.ReactNode }
interface FieldDef { key: FieldKey; label: string; plural: string; icon: React.ReactNode; single?: boolean }

const FIELDS: FieldDef[] = [
  { key: 'states', label: 'Status', plural: 'statuses', icon: <StateIcon type="backlog" size={14} /> },
  { key: 'assigneeIds', label: 'Assignee', plural: 'assignees', icon: <IconUser size={14} /> },
  { key: 'creatorIds', label: 'Creator', plural: 'creators', icon: <IconUsers size={14} /> },
  { key: 'priority', label: 'Priority', plural: 'priorities', icon: <PriorityIcon priority={2} size={14} /> },
  { key: 'estimates', label: 'Estimate', plural: 'estimates', icon: <IconEstimate size={14} /> },
  { key: 'labelIds', label: 'Labels', plural: 'labels', icon: <IconTag size={14} /> },
  { key: 'relations', label: 'Relations', plural: 'relations', icon: <IconRelated size={14} /> },
  { key: 'hierarchy', label: 'Sub-issues', plural: 'kinds', icon: <IconSubIssue size={14} /> },
  { key: 'due', label: 'Due date', plural: 'ranges', icon: <IconCalendar size={14} /> },
  { key: 'created', label: 'Created date', plural: 'ranges', icon: <IconClock size={14} />, single: true },
  { key: 'updated', label: 'Updated date', plural: 'ranges', icon: <IconEdit size={14} />, single: true },
  { key: 'projectIds', label: 'Project', plural: 'projects', icon: <IconBox size={14} /> },
  { key: 'milestoneIds', label: 'Milestone', plural: 'milestones', icon: <IconMilestone size={14} /> },
  { key: 'cycleIds', label: 'Cycle', plural: 'cycles', icon: <IconCycle size={14} /> },
  { key: 'releaseIds', label: 'Release', plural: 'releases', icon: <IconRelease size={14} /> },
  { key: 'sla', label: 'SLA status', plural: 'statuses', icon: <IconSla size={14} /> },
  { key: 'prs', label: 'Pull requests', plural: 'states', icon: <IconPr size={14} /> },
  { key: 'subscriberIds', label: 'Subscribers', plural: 'people', icon: <IconBell size={14} /> },
  { key: 'links', label: 'Links', plural: 'kinds', icon: <IconAttach size={14} /> },
  { key: 'query', label: 'Content', plural: 'texts', icon: <IconTextAa size={14} /> },
];

const DATE_FIELDS: FieldKey[] = ['due', 'created', 'updated'];
const FIELD_GROUPS: FieldKey[][] = [
  ['states', 'assigneeIds', 'creatorIds', 'priority', 'estimates', 'labelIds', 'relations', 'hierarchy'],
  ['projectIds', 'milestoneIds', 'cycleIds', 'releaseIds'],
  ['subscriberIds', 'sla', 'prs', 'links', 'query'],
];

function fieldValues(key: FieldKey, snap: Snap, teamId?: string): FieldValue[] {
  const me = snap.currentUser;
  switch (key) {
    case 'states': {
      const seen = new Map<string, FieldValue>();
      const states = snap.states.filter(s => !teamId || s.teamId === teamId).sort((a, b) =>
        (['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'].indexOf(a.type) - ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'].indexOf(b.type)) || a.position - b.position);
      for (const s of states) if (!seen.has(s.name)) seen.set(s.name, { id: s.id, label: s.name, icon: <StateIcon type={s.type} color={s.color} size={14} /> });
      return [...seen.values()];
    }
    case 'assigneeIds': return [
      { id: 'none', label: 'No assignee', icon: <Avatar user={null} size={16} /> },
      { id: 'me', label: 'Current user', icon: <Avatar user={me} size={16} /> },
      ...snap.users.filter(u => u.id !== me.id).map(u => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={16} /> })),
    ];
    case 'creatorIds': return [
      { id: 'me', label: 'Current user', icon: <Avatar user={me} size={16} /> },
      ...snap.users.filter(u => u.id !== me.id).map(u => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={16} /> })),
    ];
    case 'priority': return ([[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']] as Array<[Priority, string]>)
      .map(([p, l]) => ({ id: String(p), label: l, icon: <PriorityIcon priority={p} size={14} /> }));
    case 'labelIds': return [
      { id: 'none', label: 'No labels', icon: <IconTag size={13} /> },
      ...snap.labels.filter(l => !teamId || l.teamId === teamId).map(l => ({ id: l.id, label: l.name, icon: <span className="label-dot" style={{ background: l.color }} /> })),
    ];
    case 'projectIds': return [
      { id: 'none', label: 'No project', icon: <IconBox size={13} /> },
      ...snap.projects.map(p => ({ id: p.id, label: p.name, icon: <span>{p.icon}</span> })),
    ];
    case 'milestoneIds': return [
      { id: 'none', label: 'No milestone', icon: <IconMilestone size={13} /> },
      ...snap.milestones.map(m => ({ id: m.id, label: `${m.name}`, icon: <span className="mi-hint-icon">{snap.projects.find(p => p.id === m.projectId)?.icon}</span> })),
    ];
    case 'cycleIds': return [
      { id: 'current', label: 'Current cycle', icon: <IconCycle size={13} /> },
      { id: 'upcoming', label: 'Upcoming cycles', icon: <IconCycle size={13} /> },
      { id: 'none', label: 'No cycle', icon: <IconCycle size={13} /> },
      ...snap.cycles.filter(c => !teamId || c.teamId === teamId).sort((a, b) => b.startsAt.localeCompare(a.startsAt))
        .map(c => ({ id: c.id, label: `${c.name || `Cycle ${c.number}`}${teamId ? '' : ` · ${snap.teams.find(t => t.id === c.teamId)?.key}`}`, icon: <IconCycle size={13} /> })),
    ];
    case 'estimates': {
      const vals = new Set<number>();
      for (const t of snap.teams.filter(t2 => !teamId || t2.id === teamId)) for (const v of teamScale(t)) vals.add(v.value);
      return [{ id: '-1', label: 'No estimate', icon: <IconEstimate size={13} /> }, ...[...vals].sort((a, b) => a - b).map(v => ({ id: String(v), label: `${v} point${v === 1 ? '' : 's'}`, icon: <IconEstimate size={13} /> }))];
    }
    case 'due': return [
      { id: 'overdue', label: 'Overdue' }, { id: 'today', label: 'Due today' }, { id: 'week', label: 'Due within a week' },
      { id: 'month', label: 'Due within a month' }, { id: 'any', label: 'Has a due date' }, { id: 'none', label: 'No due date' },
    ].map(v => ({ ...v, icon: <IconCalendar size={13} /> }));
    case 'created': case 'updated': return [
      { id: 'day', label: 'Past day' }, { id: 'week', label: 'Past week' }, { id: 'month', label: 'Past month' }, { id: 'quarter', label: 'Past 3 months' },
    ].map(v => ({ ...v, icon: <IconClock size={13} /> }));
    case 'hierarchy': return [
      { id: 'parent', label: 'Has sub-issues' }, { id: 'subissue', label: 'Is a sub-issue' }, { id: 'standalone', label: 'Neither' },
    ].map(v => ({ ...v, icon: <IconSubIssue size={13} /> }));
    case 'relations': return [
      { id: 'blocked', label: 'Blocked', icon: <IconBlocked size={13} /> }, { id: 'blocking', label: 'Blocking', icon: <IconBlocks size={13} /> },
      { id: 'related', label: 'Has related issues', icon: <IconRelated size={13} /> }, { id: 'duplicate', label: 'Is a duplicate', icon: <IconDuplicate size={13} /> },
    ];
    case 'subscriberIds': return [
      { id: 'me', label: 'Current user', icon: <Avatar user={me} size={16} /> },
      ...snap.users.filter(u => u.id !== me.id).map(u => ({ id: u.id, label: u.name, icon: <Avatar user={u} size={16} /> })),
    ];
    case 'links': return [{ id: 'any', label: 'Has links or files', icon: <IconAttach size={13} /> }, { id: 'none', label: 'No links', icon: <IconAttach size={13} /> }];
    case 'releaseIds': return [{ id: 'none', label: 'No release', icon: <IconRelease size={13} /> }, ...snap.releases.map(r => ({ id: r.id, label: r.name, icon: <IconRelease size={13} /> }))];
    case 'sla': return [{ id: 'breached', label: 'Breached' }, { id: 'risk', label: 'Breaching within a day' }, { id: 'ok', label: 'Within SLA' }, { id: 'none', label: 'No SLA' }].map(v => ({ ...v, icon: <IconSla size={13} /> }));
    case 'prs': return [{ id: 'open', label: 'Open PR' }, { id: 'draft', label: 'Draft PR' }, { id: 'merged', label: 'Merged PR' }, { id: 'none', label: 'No pull requests' }].map(v => ({ ...v, icon: <IconPr size={13} /> }));
    case 'query': return [];
  }
}

/** current values of a field as string ids (numbers and single values normalised) */
function valuesOf(f: ViewFilters, key: FieldKey): string[] {
  const v = f[key];
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}
function withValues(f: ViewFilters, key: FieldKey, vals: string[]): ViewFilters {
  const next: ViewFilters = { ...f };
  const field = FIELDS.find(x => x.key === key)!;
  if (!vals.length) {
    delete (next as Record<string, unknown>)[key];
    next.not = (next.not ?? []).filter(k => k !== key);
    if (!next.not.length) delete next.not;
    return next;
  }
  if (key === 'priority' || key === 'estimates') (next as Record<string, unknown>)[key] = vals.map(Number);
  else if (field.single || key === 'query') (next as Record<string, unknown>)[key] = vals[vals.length - 1];
  else (next as Record<string, unknown>)[key] = vals;
  return next;
}

/* The filter popover: a field list with a search box (typing finds values across
   every field), and per field a values page with checkboxes and issue counts. */
function FilterMenu(props: { anchor: DOMRect; onClose: () => void; filters: ViewFilters; onChange: (f: ViewFilters) => void; teamId?: string; startField?: FieldKey; pool?: Issue[]; onAdvanced?: () => void; onGroup?: () => void }) {
  const snap = useApp(s => s.snap)!;
  const [field, setField] = useState<FieldKey | null>(props.startField ?? null);
  const [dates, setDates] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => setQ(''), [field]);
  const toggle = (key: FieldKey, id: string) => {
    const def = FIELDS.find(x => x.key === key)!;
    const cur = valuesOf(props.filters, key);
    const next = def.single ? (cur.includes(id) ? [] : [id]) : cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    props.onChange(withValues(props.filters, key, next));
  };
  const countFor = (key: FieldKey, id: string) => {
    if (!props.pool) return null;
    const probe = withValues({}, key, [id]);
    return applyFilters(props.pool, probe).length;
  };
  const match = (t: string) => t.toLowerCase().includes(q.trim().toLowerCase());

  if (field) {
    const def = FIELDS.find(x => x.key === field)!;
    if (field === 'query') {
      return (
        <Menu anchor={props.anchor} onClose={props.onClose} width={280}>
          <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
            <input autoFocus defaultValue={props.filters.query ?? ''} placeholder="Title, description or ID contains…" spellCheck={false}
              onKeyDown={e => {
                if (e.key === 'Enter') { props.onChange(withValues(props.filters, 'query', (e.target as HTMLInputElement).value.trim() ? [(e.target as HTMLInputElement).value.trim()] : [])); props.onClose(); }
              }} />
            <span className="kbd">↵</span>
          </div>
        </Menu>
      );
    }
    const values = fieldValues(field, snap, props.teamId).filter(v => match(v.label));
    const cur = valuesOf(props.filters, field);
    return (
      <Menu anchor={props.anchor} onClose={props.onClose} width={260}>
        <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
          {!props.startField && <button className="mi-back" title="Back" onClick={() => setField(null)}><IconChevronRight size={12} style={{ transform: 'rotate(180deg)' }} /></button>}
          <input autoFocus value={q} placeholder={`${def.label}…`} spellCheck={false} onChange={e => setQ(e.target.value)} />
        </div>
        {values.map(v => {
          const on = cur.includes(v.id);
          const n = countFor(field, v.id);
          return (
            <button key={v.id} className="menu-item" onClick={e => { e.stopPropagation(); toggle(field, v.id); if (def.single) props.onClose(); }}>
              <span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span>
              {v.icon && <span className="mi-icon">{v.icon}</span>}
              <span className="mi-label">{v.label}</span>
              {n != null && n > 0 && <span className="mi-right"><span className="mi-hint">{n} issue{n === 1 ? '' : 's'}</span></span>}
            </button>
          );
        })}
        {values.length === 0 && <div className="menu-empty">No results</div>}
      </Menu>
    );
  }

  // field list, or cross-field value search while typing
  const hits = q.trim() ? FIELDS.flatMap(fd => fieldValues(fd.key, snap, props.teamId).filter(v => match(v.label)).map(v => ({ fd, v }))).slice(0, 14) : [];
  const fieldRow = (fd: FieldDef) => (
    <button key={fd.key} className="menu-item" onClick={e => { e.stopPropagation(); setField(fd.key); }}>
      <span className="mi-icon">{fd.icon}</span>
      <span className="mi-label">{fd.label}</span>
      <span className="mi-right">{isSet(props.filters, fd.key) && <span className="mi-dot" />}<IconChevronRight size={12} /></span>
    </button>
  );
  // Linear's order and grouping: issue fields with the dates folded into "Dates", then planning, then the rest
  if (dates && !q.trim()) return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={220}>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
        <button className="mi-back" title="Back" onClick={() => setDates(false)}><IconChevronRight size={12} style={{ transform: 'rotate(180deg)' }} /></button>
        <input autoFocus value="" readOnly placeholder="Dates…" />
      </div>
      {FIELDS.filter(fd => DATE_FIELDS.includes(fd.key)).map(fieldRow)}
    </Menu>
  );
  const groups: FieldKey[][] = q.trim() ? [FIELDS.filter(fd => match(fd.label)).map(fd => fd.key)] : FIELD_GROUPS;
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={220}>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
        <input autoFocus value={q} placeholder="Add filter…" spellCheck={false} onChange={e => setQ(e.target.value)} />
        <span className="kbd">F</span>
      </div>
      {props.onAdvanced && !q.trim() && <><MenuItem icon={<IconFilter size={14} />} label="Advanced filter" onClick={props.onAdvanced} /><MenuSep /></>}
      {props.onGroup && !q.trim() && <><MenuItem icon={<span className="grp-glyph">( )</span>} label="Add filter group" onClick={props.onGroup} /><MenuSep /></>}
      {groups.map((g, gi) => (
        <div key={gi} style={{ display: 'contents' }}>
          {gi > 0 && <MenuSep />}
          {g.map(k => FIELDS.find(fd => fd.key === k)!).map(fieldRow)}
          {gi === 0 && !q.trim() && (
            <button className="menu-item" onClick={e => { e.stopPropagation(); setDates(true); }}>
              <span className="mi-icon"><IconCalendar size={14} /></span>
              <span className="mi-label">Dates</span>
              <span className="mi-right">{DATE_FIELDS.some(k => isSet(props.filters, k)) && <span className="mi-dot" />}<IconChevronRight size={12} /></span>
            </button>
          )}
        </div>
      ))}
      {hits.length > 0 && <MenuSep />}
      {hits.map(({ fd, v }) => (
        <MenuItem key={`${fd.key}:${v.id}`} icon={v.icon ?? fd.icon} label={<><span className="mi-hint-pre">{fd.label}</span>{v.label}</>}
          selected={valuesOf(props.filters, fd.key).includes(v.id)} onClick={() => toggle(fd.key, v.id)} />
      ))}
      {q.trim() && (
        <MenuItem icon={<IconTextAa size={14} />} label={<><span className="mi-hint-pre">Content</span>contains “{q.trim()}”</>}
          onClick={() => props.onChange(withValues(props.filters, 'query', [q.trim()]))} />
      )}
    </Menu>
  );
}

/* Filter pills: field · operator · values · ×, each part its own button — the
   operator flips "is" / "is not", the values reopen that field's picker. */
export function FilterBar(props: {
  filters: ViewFilters;
  onChange: (f: ViewFilters) => void;
  teamId?: string;
  /** issues before filtering, for the per-value counts */
  pool?: Issue[];
  onSave?: () => void;
}) {
  const snap = useApp(s => s.snap)!;
  const [menu, setMenu] = useState<{ anchor: DOMRect; field?: FieldKey } | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const filters = props.filters;

  useEffect(() => {
    const onOpen = (e: Event) => {
      const rect = (e as CustomEvent).detail as DOMRect | undefined;
      const fallback = document.querySelector<HTMLElement>('[data-filter-trigger]')?.getBoundingClientRect() ?? plusRef.current?.getBoundingClientRect();
      const anchor = rect ?? fallback;
      if (anchor) setMenu({ anchor });
    };
    window.addEventListener('baseline:focus-filter', onOpen);
    return () => window.removeEventListener('baseline:focus-filter', onOpen);
  }, []);

  const active = FIELDS.filter(fd => isSet(filters, fd.key));
  const [advAnchor, setAdvAnchor] = useState<DOMRect | null>(null);
  const advCount = filters.advanced ? countConditions(filters.advanced) : 0;
  const openAdvanced = (rect?: DOMRect) => {
    if (!filters.advanced) props.onChange({ ...filters, advanced: { op: 'and', items: [] } });
    setMenu(null);
    setTimeout(() => setAdvAnchor(rect ?? document.querySelector<HTMLElement>('.fpill.adv')?.getBoundingClientRect() ?? document.querySelector<HTMLElement>('[data-filter-trigger]')?.getBoundingClientRect() ?? null), 30);
  };
  const advPanel = advAnchor && filters.advanced && (
    <AdvancedFilterPanel anchor={advAnchor} group={filters.advanced} teamId={props.teamId} pool={props.pool}
      onChange={g => props.onChange({ ...filters, advanced: g })} onClose={() => { setAdvAnchor(null); if (filters.advanced && !countConditions(filters.advanced)) { const n = { ...filters }; delete n.advanced; props.onChange(n); } }} />
  );
  const not = new Set(filters.not ?? []);
  const label = (fd: FieldDef) => {
    if (fd.key === 'query') return `“${filters.query}”`;
    const vals = valuesOf(filters, fd.key);
    const all = fieldValues(fd.key, snap, props.teamId);
    if (vals.length > 2) return `${vals.length} ${fd.plural}`;
    return vals.map(v => all.find(x => x.id === v)?.label ?? snap.states.find(s => s.id === v)?.name ?? v).join(', ');
  };
  const firstIcon = (fd: FieldDef) => {
    const vals = valuesOf(filters, fd.key);
    if (vals.length !== 1) return null;
    return fieldValues(fd.key, snap, props.teamId).find(x => x.id === vals[0])?.icon ?? null;
  };
  const op = (fd: FieldDef) => {
    const n = valuesOf(filters, fd.key).length;
    if (fd.key === 'query') return not.has('query') ? 'does not contain' : 'contains';
    if (fd.key === 'labelIds') return not.has(fd.key) ? 'include none of' : n > 1 ? 'include any of' : 'includes';
    if (fd.key === 'created' || fd.key === 'updated') return not.has(fd.key) ? 'is before' : 'is within';
    return not.has(fd.key) ? (n > 1 ? 'is none of' : 'is not') : (n > 1 ? 'is any of' : 'is');
  };
  const flip = (key: FieldKey) => {
    const n = new Set(filters.not ?? []);
    if (n.has(key)) n.delete(key); else n.add(key);
    props.onChange({ ...filters, not: n.size ? [...n] : undefined });
  };

  if (!active.length && !filters.advanced) {
    return <>
      {menu && <FilterMenu anchor={menu.anchor} startField={menu.field} onClose={() => setMenu(null)} filters={filters} onChange={props.onChange} teamId={props.teamId} pool={props.pool} onAdvanced={() => openAdvanced()} />}
      {advPanel}
    </>;
  }

  return (
    <>
      {active.map(fd => (
        <span key={fd.key} className="fpill">
          <span className="fp-part fp-field">{fd.icon}{fd.label}</span>
          <button className="fp-part fp-op" onClick={() => flip(fd.key)} title="Change operator">{op(fd)}</button>
          <button className="fp-part fp-vals" onClick={e => setMenu({ anchor: e.currentTarget.getBoundingClientRect(), field: fd.key })}>
            {firstIcon(fd)}<span className="fp-vals-text">{label(fd)}</span>
          </button>
          <button className="fp-part fp-x" title="Remove filter" onClick={() => props.onChange(withValues(filters, fd.key, []))}><IconClose size={11} /></button>
        </span>
      ))}
      {filters.advanced && (
        <span className="fpill adv">
          <button className="fp-part fp-vals" onClick={e => setAdvAnchor(e.currentTarget.getBoundingClientRect())}><IconFilter size={12} />Advanced filter{advCount ? <span className="fp-adv-n">{advCount} condition{advCount === 1 ? '' : 's'} · {filters.advanced.op === 'and' ? 'all' : 'any'}</span> : null}</button>
          <button className="fp-part fp-x" title="Remove advanced filter" onClick={() => { const n = { ...filters }; delete n.advanced; props.onChange(n); setAdvAnchor(null); }}><IconClose size={11} /></button>
        </span>
      )}
      <button ref={plusRef} className="icon-btn fp-add" title="Add filter (F)" onClick={e => setMenu({ anchor: e.currentTarget.getBoundingClientRect() })}><IconPlus size={13} /></button>
      <span style={{ flex: 1 }} />
      <button className="btn ghost fp-clear" onClick={() => props.onChange({})}>Clear</button>
      {props.onSave && <button className="btn secondary fp-save" onClick={props.onSave}>Save</button>}
      {menu && <FilterMenu anchor={menu.anchor} startField={menu.field} onClose={() => setMenu(null)} filters={filters} onChange={props.onChange} teamId={props.teamId} pool={props.pool} onAdvanced={filters.advanced ? undefined : () => openAdvanced()} />}
      {advPanel}
    </>
  );
}

/* ---------------- advanced filter ----------------
   Linear's builder: rows of conditions joined by "and" / "or" (click the word to flip it
   for the whole group), with nested groups in brackets. Each condition is a field, an
   operator and values — picked with the same menus as the plain pills. */
function AdvancedFilterPanel(props: { anchor: DOMRect; group: FilterGroup; onChange: (g: FilterGroup) => void; onClose: () => void; teamId?: string; pool?: Issue[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.menu:not(.closing)')) { e.stopPropagation(); props.onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props]);
  const left = Math.min(props.anchor.left, window.innerWidth - 560);
  return createPortal(
    <>
      <div className="adv-backdrop" onMouseDown={props.onClose} />
      <div className="adv-panel" ref={ref} style={{ left, top: props.anchor.bottom + 6 }}>
        <AdvGroup group={props.group} onChange={props.onChange} teamId={props.teamId} pool={props.pool} depth={0} />
      </div>
    </>,
    document.body,
  );
}

function AdvGroup(props: { group: FilterGroup; onChange: (g: FilterGroup) => void; onRemove?: () => void; teamId?: string; pool?: Issue[]; depth: number }) {
  const snap = useApp(s => s.snap)!;
  const g = props.group;
  const [picker, setPicker] = useState<{ anchor: DOMRect; index: number | null; field?: FieldKey } | null>(null);
  const setItem = (i: number, item: FilterCondition | FilterGroup | null) => {
    const items = [...g.items];
    if (item === null) items.splice(i, 1); else items[i] = item;
    props.onChange({ ...g, items });
  };
  const flip = () => props.onChange({ ...g, op: g.op === 'and' ? 'or' : 'and' });
  const label = (c: FilterCondition) => {
    const fd = FIELDS.find(f => f.key === c.field);
    if (c.field === 'query') return `“${c.values[0] ?? ''}”`;
    const all = fieldValues(c.field as FieldKey, snap, props.teamId);
    if (c.values.length > 2) return `${c.values.length} ${fd?.plural ?? 'values'}`;
    return c.values.map(v => all.find(x => x.id === v)?.label ?? v).join(', ') || 'any value';
  };
  // the picker edits one condition (index) or adds one (null); it speaks ViewFilters, so translate
  const pickerFilters: ViewFilters = picker && picker.index !== null ? withValues({}, (g.items[picker.index] as FilterCondition).field as FieldKey, (g.items[picker.index] as FilterCondition).values) : {};
  const onPick = (f: ViewFilters) => {
    if (!picker) return;
    const key = FIELDS.find(fd => isSet(f, fd.key))?.key;
    if (picker.index !== null) {
      const cur = g.items[picker.index] as FilterCondition;
      setItem(picker.index, { ...cur, values: valuesOf(f, cur.field as FieldKey) });
    } else if (key) {
      props.onChange({ ...g, items: [...g.items, { field: key, values: valuesOf(f, key) }] });
      setPicker(p => p ? { ...p, index: g.items.length, field: key } : p);
    }
  };
  return (
    <div className={`adv-group${props.depth ? ' nested' : ''}`}>
      {g.items.map((item, i) => (
        <div key={i} className="adv-row">
          <span className="adv-join">
            {i === 0 ? 'Where' : i === 1 ? <button className="adv-op" onClick={flip} title="Switch between and / or">{g.op}</button> : <span className="adv-op-static">{g.op}</span>}
          </span>
          {isGroup(item) ? (
            <AdvGroup group={item} onChange={n => setItem(i, n)} onRemove={() => setItem(i, null)} teamId={props.teamId} pool={props.pool} depth={props.depth + 1} />
          ) : (
            <span className="fpill">
              <span className="fp-part fp-field">{FIELDS.find(f => f.key === item.field)?.icon}{FIELDS.find(f => f.key === item.field)?.label ?? item.field}</span>
              <button className="fp-part fp-op" onClick={() => setItem(i, { ...item, not: !item.not })}>{item.field === 'query' ? (item.not ? 'does not contain' : 'contains') : item.not ? (item.values.length > 1 ? 'is none of' : 'is not') : (item.values.length > 1 ? 'is any of' : 'is')}</button>
              <button className="fp-part fp-vals" onClick={e => setPicker({ anchor: e.currentTarget.getBoundingClientRect(), index: i, field: item.field as FieldKey })}><span className="fp-vals-text">{label(item)}</span></button>
              <button className="fp-part fp-x" onClick={() => setItem(i, null)}><IconClose size={11} /></button>
            </span>
          )}
        </div>
      ))}
      <div className="adv-actions">
        <button className="btn ghost sm" onClick={e => setPicker({ anchor: e.currentTarget.getBoundingClientRect(), index: null })}><IconPlus size={12} /> Filter</button>
        {props.onRemove && <button className="btn ghost sm" onClick={props.onRemove}>Remove group</button>}
      </div>
      {picker && (
        <FilterMenu anchor={picker.anchor} startField={picker.field} filters={pickerFilters} onChange={onPick} teamId={props.teamId} pool={props.pool}
          onClose={() => setPicker(null)}
          onGroup={picker.index === null && props.depth < 2 ? () => { props.onChange({ ...g, items: [...g.items, { op: g.op === 'and' ? 'or' : 'and', items: [] }] }); setPicker(null); } : undefined} />
      )}
    </div>
  );
}

/* ---------------- display options ---------------- */
const GROUP_LABELS: Record<string, string> = { status: 'Status', priority: 'Priority', assignee: 'Assignee', label: 'Label', project: 'Project', cycle: 'Cycle', milestone: 'Milestone', team: 'Team', none: 'No grouping' };
const ORDER_LABELS: Record<string, string> = { manual: 'Manual', title: 'Title', status: 'Status', priority: 'Priority', estimate: 'Estimate', updated: 'Last updated', created: 'Created', due: 'Due date' };
const COMPLETED_LABELS: Record<CompletedWindow, string> = { all: 'All', day: 'Past day', week: 'Past week', month: 'Past month', none: 'None' };

/** a compact dropdown inside the display popover (the popover stays open) */
function InlineSelect<T extends string>(props: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const current = props.options.find(o => o[0] === props.value)?.[1] ?? props.value;
  return (
    <>
      <button className="dd-btn" onClick={e => { e.stopPropagation(); setRect(e.currentTarget.getBoundingClientRect()); }}>
        <span>{current}</span><IconChevronDown size={11} />
      </button>
      {rect && createPortal(
        <>
          <div className="menu-backdrop dd-backdrop" onMouseDown={e => { e.stopPropagation(); setRect(null); }} />
          <div className="menu submenu dd-list" style={{ left: Math.min(rect.left, window.innerWidth - 200), top: Math.min(rect.bottom + 4, window.innerHeight - 40 - props.options.length * 30), width: Math.max(rect.width, 170) }}>
            {props.options.map(([v, l]) => (
              <button key={v} className={`menu-item${v === props.value ? ' highlighted' : ''}`} onClick={e => { e.stopPropagation(); props.onChange(v); setRect(null); }}>
                <span className="mi-label">{l}</span>
                <span className="mi-right">{v === props.value && <IconCheck size={13} />}</span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function Toggle(props: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch${props.on ? ' on' : ''}`} role="switch" aria-checked={props.on} onClick={e => { e.stopPropagation(); props.onChange(!props.on); }}><span /></button>;
}

export function DisplayOptionsMenu(props: {
  opts: ViewOptions;
  onPatch: (patch: Partial<ViewOptions>) => void;
  onClose: () => void;
  anchor: DOMRect;
  showLayout?: boolean;
  /** offer team grouping (cross-team views) */
  multiTeam?: boolean;
  onReset?: () => void;
}) {
  const { opts, onPatch } = props;
  const groupKeys: GroupBy[] = ['status', 'assignee', 'project', 'priority', 'cycle', 'label', 'milestone', ...(props.multiTeam ? ['team' as GroupBy] : [])];
  const groups: Array<[GroupBy, string]> = [...groupKeys.map(g => [g, GROUP_LABELS[g]] as [GroupBy, string]), ['none', 'No grouping']];
  const board = opts.layout === 'board';
  const propRows: Array<[keyof DisplayProps, string]> = [
    ['id', 'ID'], ['status', 'Status'], ['assignee', 'Assignee'], ['creator', 'Creator'], ['priority', 'Priority'], ['project', 'Project'],
    ['due', 'Due date'], ['milestone', 'Milestone'], ['cycle', 'Cycle'], ['estimate', 'Estimate'], ['labels', 'Labels'], ['links', 'Links'],
    ['prs', 'Pull requests'], ['created', 'Created'], ['updated', 'Updated'],
  ];
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={300}>
      <div className="dopts">
        {props.showLayout !== false && (
          <div className="dopts-layout">
            <button className={`dopts-lay${!board ? ' on' : ''}`} onClick={() => onPatch({ layout: 'list' })}><IconList size={14} /> List</button>
            <button className={`dopts-lay${board ? ' on' : ''}`} onClick={() => onPatch({ layout: 'board' })}><IconBoard size={14} /> Board</button>
          </div>
        )}
        <div className="dopts-row"><span>{board ? 'Columns' : 'Grouping'}</span>
          <InlineSelect value={opts.groupBy} options={board ? groups.filter(g => g[0] !== 'none') : groups} onChange={v => onPatch({ groupBy: v })} /></div>
        <div className="dopts-row"><span>{board ? 'Rows' : 'Sub-grouping'}</span>
          <InlineSelect value={opts.subgroupBy} options={[['none', 'No grouping'], ...groups.filter(g => g[0] !== 'none' && g[0] !== opts.groupBy)] as Array<[GroupBy | 'none', string]>} onChange={v => onPatch({ subgroupBy: v })} /></div>
        <div className="dopts-row"><span>Ordering</span>
          {opts.orderBy !== 'manual' && <button className={`icon-btn dopts-dir${opts.orderReversed ? ' on' : ''}`} title={opts.orderReversed ? 'Ascending' : 'Descending'} onClick={() => onPatch({ orderReversed: !opts.orderReversed })}><IconSortDir size={14} style={{ transform: opts.orderReversed ? 'scaleY(-1)' : undefined }} /></button>}
          <InlineSelect value={opts.orderBy} options={Object.entries(ORDER_LABELS) as Array<[OrderBy, string]>} onChange={v => onPatch({ orderBy: v })} /></div>
        <div className="dopts-row"><span>Order completed by recency</span><Toggle on={!!opts.completedByRecency} onChange={v => onPatch({ completedByRecency: v })} /></div>
        <div className="dopts-sep" />
        <div className="dopts-row"><span>Completed issues</span>
          <InlineSelect value={opts.completed ?? 'all'} options={Object.entries(COMPLETED_LABELS) as Array<[CompletedWindow, string]>} onChange={v => onPatch({ completed: v })} /></div>
        <div className="dopts-row"><span>Show sub-issues</span><Toggle on={opts.showSubIssues !== false} onChange={v => onPatch({ showSubIssues: v })} /></div>
        <div className="dopts-row"><span>Show triage issues</span><Toggle on={!!opts.showTriage} onChange={v => onPatch({ showTriage: v })} /></div>
        <div className="dopts-sep" />
        <div className="dopts-head">{board ? 'Board options' : 'List options'}</div>
        <div className="dopts-row"><span>{board ? 'Show empty columns' : 'Show empty groups'}</span><Toggle on={opts.showEmpty} onChange={v => onPatch({ showEmpty: v })} /></div>
        <div className="dopts-head">Display properties</div>
        <div className="dopts-props">
          {propRows.map(([prop, label]) => (
            <button key={prop} className={`dprop${opts.display[prop] ? ' on' : ''}`}
              onClick={() => onPatch({ display: { ...opts.display, [prop]: !opts.display[prop] } })}>{label}</button>
          ))}
        </div>
        {props.onReset && (
          <>
            <div className="dopts-sep" />
            <div className="dopts-foot"><button className="btn ghost" onClick={props.onReset}>Reset</button></div>
          </>
        )}
      </div>
    </Menu>
  );
}

/* ---------------- selection pill ----------------
   Linear-style floating pill: count, Actions (opens the command palette, which
   picks up the selection as bulk context), clear. */
export function SelectionBar() {
  const ids = useSelection(s => s.ids);
  const clear = useSelection(s => s.clear);
  const setPalette = useApp(s => s.setPalette);
  const setQuickMenu = useApp(s => s.setQuickMenu);
  const quick = (kind: PropKind) => (e: React.MouseEvent) => setQuickMenu({ issueIds: ids, kind, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() });
  return (
    <AnimatePresence>
      {ids.length > 0 && (
        <motion.div
          key="bulk" className="bulk-bar"
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.16, ease: 'easeIn' } }}
          transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="bulk-count">
            <span className="bulk-num" key={ids.length}>{ids.length}</span> selected
          </span>
          <button className="icon-btn" title="Clear selection (Esc)" onClick={clear}><IconClose size={13} /></button>
          <span className="bulk-sep" />
          <button className="bulk-act" title="Status (S)" onClick={quick('status')}><StateIcon type="started" size={13} /></button>
          <button className="bulk-act" title="Priority (P)" onClick={quick('priority')}><PriorityIcon priority={2} size={13} /></button>
          <button className="bulk-act" title="Assignee (A)" onClick={quick('assignee')}><IconUser size={13} /></button>
          <button className="bulk-act" title="Labels (L)" onClick={quick('labels')}><IconTag size={13} /></button>
          <button className="bulk-act" title="Project (⇧P)" onClick={quick('project')}><IconBox size={13} /></button>
          <button className="bulk-act" title="Cycle (⇧C)" onClick={quick('cycle')}><IconCycle size={13} /></button>
          <button className="bulk-actions-btn" onClick={() => setPalette(true)}>
            <span className="kbd">⌘K</span> Actions
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ================= grouped list ================= */
type RenderItem =
  | { kind: 'header'; spec: GroupSpec; count: number; points: number }
  | { kind: 'subheader'; groupId: string; spec: GroupSpec; count: number; parent: string }
  | { kind: 'row'; issue: Issue; nested: boolean; depth?: number };

export function GroupedList(props: {
  issues: Issue[];
  teamId?: string;
  opts: ViewOptions;
  emptyTitle?: string;
  emptyDesc?: string;
  hideGroups?: string[];   // state ids excluded up-front (Active/Backlog tabs)
  emptyHideCreate?: boolean;
  onFocusStatus?: (stateId: string) => void;
  /** clears the page's filters (the "hidden by filters" footer offers it) */
  onClearFilters?: () => void;
  /** project/cycle pages pass create defaults so "+" on a group lands the issue there */
  createDefaults?: { projectId?: string | null; cycleId?: string | null };
}) {
  const snap = useApp(s => s.snap)!;
  const openCreate = useApp(s => s.openCreate);
  const cursorIndex = useCursor(s => s.index);
  const selection = useSelection(s => s.ids);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('baseline:collapsedGroups') ?? '{}'); } catch { return {}; }
  });

  const shown = useMemo(() => {
    let out = props.issues;
    if (props.hideGroups?.length) out = out.filter(i => !props.hideGroups!.includes(i.stateId));
    return applyDisplay(out, props.opts);
  }, [props.issues, props.hideGroups, props.opts, snap.states]); // eslint-disable-line react-hooks/exhaustive-deps
  const pool = useMemo(() => applyFilters(shown, props.opts.filters), [shown, props.opts.filters, snap]); // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenByFilters = shown.length - pool.length;
  const estimatesOn = props.teamId ? snap.teams.find(t => t.id === props.teamId)?.estimateScale !== 'none' : true;

  const { render, flat } = useMemo(() => {
    const ordered = orderIssues(pool, props.opts.orderBy, props.opts.completedByRecency, props.opts.orderReversed);
    const renderItems: RenderItem[] = [];
    const flatIssues: Issue[] = [];
    if (props.opts.groupBy === 'none') {
      for (const { issue: i, depth } of props.opts.orderBy === 'manual' ? ordered.map(issue => ({ issue, depth: 0 })) : nestSubIssues(ordered)) {
        renderItems.push({ kind: 'row', issue: i, nested: false, depth }); flatIssues.push(i);
      }
      return { render: renderItems, flat: flatIssues };
    }
    const specs = groupsFor(props.opts.groupBy, snap, props.teamId);
    let groups = specs.map(spec => ({ spec, issues: issuesOfGroup(props.opts.groupBy, ordered, spec.id, props.teamId) }));
    if (!props.opts.showEmpty) groups = groups.filter(g => g.issues.length > 0);
    else if (props.opts.groupBy === 'milestone') groups = groups.filter(g => g.issues.length > 0 || props.issues.some(i => i.projectId === snap.milestones.find(m => m.id === g.spec.id)?.projectId));
    for (const g of groups) {
      renderItems.push({ kind: 'header', spec: g.spec, count: g.issues.length, points: g.issues.reduce((a, i) => a + pointsOf(i, snap.teams), 0) });
      if (collapsed[g.spec.id]) continue;
      if (props.opts.subgroupBy !== 'none') {
        const subSpecs = groupsFor(props.opts.subgroupBy as GroupBy, snap, props.teamId).filter(ss => ss.id !== g.spec.id);
        const subGroups = subSpecs
          .map(ss => ({ spec: ss, issues: issuesOfGroup(props.opts.subgroupBy as GroupBy, g.issues, ss.id) }))
          .filter(sg => sg.issues.length > 0);
        const covered = new Set<string>();
        for (const sg of subGroups) {
          renderItems.push({ kind: 'subheader', groupId: `${g.spec.id}:${sg.spec.id}`, spec: sg.spec, count: sg.issues.length, parent: g.spec.id });
          for (const i of sg.issues) {
            // a multi-label issue appears under each label, but navigates once
            renderItems.push({ kind: 'row', issue: i, nested: true });
            if (!covered.has(i.id)) { flatIssues.push(i); covered.add(i.id); }
          }
        }
        for (const i of g.issues) if (!covered.has(i.id)) { renderItems.push({ kind: 'row', issue: i, nested: true }); flatIssues.push(i); }
      } else if (props.opts.orderBy === 'manual') {
        // manual order is the user's own arrangement — don't regroup it under parents
        for (const i of g.issues) { renderItems.push({ kind: 'row', issue: i, nested: false }); flatIssues.push(i); }
      } else {
        for (const { issue: i, depth } of nestSubIssues(g.issues)) { renderItems.push({ kind: 'row', issue: i, nested: false, depth }); if (!flatIssues.includes(i)) flatIssues.push(i); }
      }
    }
    return { render: renderItems, flat: flatIssues };
  }, [pool, props.opts, props.teamId, props.issues, snap, collapsed]);

  useEffect(() => { registerVisibleList(flat, props.teamId ?? ''); }, [flat, props.teamId]);

  // expanding a group cascades its rows in (collapse stays instant: getting
  // rows out of the way should never wait on an animation)
  const justExpanded = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const id = justExpanded.current;
    justExpanded.current = null;
    if (!id || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const header = listRef.current?.querySelector(`[data-group-header="${CSS.escape(id)}"]`);
    let el = header?.nextElementSibling as HTMLElement | null;
    for (let n = 0; el && !el.classList.contains('group-header'); n++, el = el.nextElementSibling as HTMLElement | null) {
      el.animate(
        [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
        { duration: 200, delay: Math.min(n, 10) * 14, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
      );
    }
  }, [collapsed]);

  const hiddenFooter = hiddenByFilters > 0 && (
    <div className="hidden-by-filters">
      <b>{hiddenByFilters} issue{hiddenByFilters === 1 ? '' : 's'}</b> hidden by filters
      {props.onClearFilters && <button className="btn ghost" onClick={props.onClearFilters}>Clear filters <IconClose size={11} /></button>}
    </div>
  );

  if (pool.length === 0) {
    return (
      <>
        <div className="empty-state">
          {/* line-art illustration, as on Linear's empty views */}
          <Illustration name="issues" />
          <div className="empty-title">{hiddenByFilters ? 'No matching issues' : props.emptyTitle ?? 'All issues'}</div>
          <div className="empty-desc">{hiddenByFilters ? 'No issues match the current filters.' : props.emptyDesc ?? 'All issues is the place where you can see all your team’s work in one view. Once you have created issues for this team, they will show up here.'}</div>
          <div className="empty-actions">
            {hiddenByFilters > 0 && props.onClearFilters && <button className="btn secondary" onClick={props.onClearFilters}>Clear filters</button>}
            {!hiddenByFilters && !props.emptyHideCreate && props.teamId && (
              <button className="btn primary" onClick={() => openCreate({ teamId: props.teamId, ...props.createDefaults })}>Create new issue <span className="btn-kbd kbd">C</span></button>
            )}
          </div>
        </div>
      </>
    );
  }

  const toggleCollapse = (id: string) => setCollapsed(c => {
    if (c[id]) justExpanded.current = id;
    const next = { ...c, [id]: !c[id] };
    try { localStorage.setItem('baseline:collapsedGroups', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const createIn = (spec: GroupSpec) => {
    const g = props.opts.groupBy;
    const base = { teamId: props.teamId, ...props.createDefaults };
    if (g === 'status') {
      // cross-team lists: the group's state belongs to some team — open the modal there
      const st = snap.states.find(s => s.id === spec.id);
      openCreate({ ...base, teamId: props.teamId ?? st?.teamId, stateId: spec.id });
    } else if (g === 'project') openCreate({ ...base, projectId: spec.id === 'none' ? null : spec.id });
    else if (g === 'cycle') openCreate({ ...base, cycleId: spec.id === 'none' ? null : spec.id });
    else if (g === 'team') openCreate({ ...base, teamId: spec.id });
    else openCreate(base);
  };

  return (
    <div style={{ paddingBottom: 40 }} ref={listRef}>
      {render.map((item, idx) => {
        if (item.kind === 'header') {
          return (
            <div key={`h-${item.spec.id}`} className="group-header" data-group-header={item.spec.id} onClick={() => toggleCollapse(item.spec.id)}>
              <button
                className={`gh-chevron${collapsed[item.spec.id] ? ' collapsed' : ''}`}
                aria-expanded={!collapsed[item.spec.id]}
                onClick={e => { e.stopPropagation(); toggleCollapse(item.spec.id); }}
              >
                <IconChevronDown size={13} />
              </button>
              {item.spec.icon}
              <span>{item.spec.label}</span>
              <span className="count">{item.count}</span>
              {estimatesOn && item.points > 0 && <span className="gh-points" title={`${item.points} points`}><IconEstimate size={11} />{item.points}</span>}
              {/* the label + count cut this rule; it runs to the right edge */}
              <span className="gh-rule" />
              <span className="group-actions" onClick={e => e.stopPropagation()}>
                {props.teamId && props.opts.groupBy === 'status' && props.onFocusStatus && (
                  <button className="icon-btn" title="Focus this status" onClick={() => props.onFocusStatus?.(item.spec.id)}>
                    <IconFocus size={13} />
                  </button>
                )}
                {['status', 'project', 'cycle', 'team'].includes(props.opts.groupBy) && (
                  <button className="icon-btn" title="Create issue in this group" onClick={() => createIn(item.spec)}>
                    <IconPlus size={14} />
                  </button>
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
              <span className="gh-rule" />
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
            depth={item.depth}
            onHover={() => { if (useCursor.getState().index !== flatIndex) useCursor.setState({ index: flatIndex }); }}
          />
        );
      })}
      {hiddenFooter}
    </div>
  );
}

/* helper used by pages to render rows outside a group */
export function FlatIssueList(props: { issues: Issue[]; teamId?: string; display?: RowDisplay }) {
  const cursorIndex = useCursor(s => s.index);
  const selection = useSelection(s => s.ids);
  const flat = props.issues;
  useEffect(() => { registerVisibleList(flat, props.teamId ?? ''); }, [flat, props.teamId]);
  return (
    <div>
      {flat.map((i, idx) => (
        <IssueRow key={i.id} issue={i} display={props.display} cursor={idx === cursorIndex} selected={selection.includes(i.id)}
          onHover={() => { if (useCursor.getState().index !== idx) useCursor.setState({ index: idx }); }} />
      ))}
    </div>
  );
}

