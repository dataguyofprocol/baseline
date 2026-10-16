import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useSelection } from './store.js';
import { api } from './api.js';
import { handoffActions } from './CodingTools.js';
import { setIssueProps, archiveIssues, deleteIssues, assignToMe, toggleSubscription, undoLast } from './actions.js';
import { shortcutTargets } from './nav.js';
import type { PropKind } from './propertyMenus.js';
import { Modal } from './ui.js';
import { AnimatePresence } from 'framer-motion';
import { Avatar, CalendarGrid, PriorityIcon, StateIcon } from './pickers.js';
import { scoreItem } from './fuzzy.js';
import {
  IconSearch, IconPlus, IconSettings, IconInbox, IconBox, IconViews, IconMyIssues,
  IconCycle, IconTeam, IconMoon, IconSun, IconHandoff, IconSpark, IconPanel, IconCopyId,
  IconArchive, IconBack, IconCalendar, IconCheck, IconClose, IconEstimate, IconTag, IconTrash, IconUser,
  IconDoc,
} from './icons.js';
import { ESTIMATE_SCALES, type Issue, type Priority } from '../../src/core/types.js';

interface PaletteItem {
  id: string;
  icon?: React.ReactNode;
  label: string;
  section: string;
  hint?: string;
  keywords?: string;
  action: () => void;
  /** run without closing the palette (drill-down pages, label toggles) */
  keepOpen?: boolean;
  /** render the label in the danger color */
  danger?: boolean;
  /** check mark on the right — this value is shared by every selected issue */
  checked?: boolean;
  /** leading chars of the label drawn as a mono key ("CORE-12 …") */
  prefixLen?: number;
  /** trailing element, e.g. the issue's assignee */
  trail?: React.ReactNode;
  /** what Enter does, named in the footer ("Open issue") */
  verb?: string;
}

/* issues opened recently, newest first — the palette's empty state leads with them */
const RECENT_KEY = 'baseline:recentIssues';
export function recordRecentIssue(key: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...list.filter(k => k !== key)].slice(0, 8)));
  } catch { /* ignore */ }
}
function recentIssueKeys(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}

/** render a label with fuzzy-matched characters highlighted */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const out: React.ReactNode[] = [];
  let run = '';
  let hl = false;
  const flush = (key: number) => {
    if (!run) return;
    out.push(hl ? <span key={key} className="pal-hl">{run}</span> : <span key={key}>{run}</span>);
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const isHl = set.has(i);
    if (isHl !== hl) { flush(out.length); hl = isHl; }
    run += text[i];
  }
  flush(out.length);
  return <>{out}</>;
}

/* ================= bulk actions =================
   The palette reads the selection store directly, so any surface that fills
   useSelection (row checkboxes, X key) instantly gets the bulk section here.
   Everything is resolved from getState() at call time so sub-page builders
   stay fresh across snapshot refreshes and selection edits. */

interface SubPage { title: string; build: () => PaletteItem[]; calendar?: boolean }

/* The issues the palette acts on: the selection, or — with nothing selected — the issue
   you're on (open page, peek, or the row under the cursor), captured when it opened. */
let ctxIds: string[] = [];
let ctxIsSelection = false;
function selIds() {
  return ctxIds;
}
function captureContext() {
  const sel = useSelection.getState().ids;
  ctxIsSelection = sel.length > 0;
  ctxIds = sel.length ? [...sel] : shortcutTargets().map(i => i.id);
}
function finishBulk() {
  useApp.getState().setPalette(false);
  if (ctxIsSelection) useSelection.getState().clear();
}

function selectedIssues(): Issue[] {
  const snap = useApp.getState().snap!;
  return selIds().map(id => snap.issues.find(i => i.id === id)).filter(Boolean) as Issue[];
}

/** the field's value only when every selected issue agrees on it */
function uniformOn<K extends 'stateId' | 'priority' | 'assigneeId' | 'projectId' | 'cycleId' | 'estimate'>(field: K) {
  const issues = selectedIssues();
  if (!issues.length) return undefined;
  const first = issues[0]![field];
  return issues.every(i => i[field] === first) ? first : undefined;
}

async function applyBulk(patch: Record<string, unknown>, label: string) {
  const ids = selIds();
  if (!ids.length) return;
  await setIssueProps(ids, patch as Parameters<typeof setIssueProps>[1]);
  finishBulk();
  if (ids.length > 1) useApp.getState().toast({ title: `${label} applied to ${ids.length} issues` });
}

async function bulkArchive() {
  const ids = selIds();
  if (!ids.length) return;
  finishBulk();
  await archiveIssues(ids);
}

async function bulkDelete() {
  const ids = selIds();
  if (!ids.length) return;
  finishBulk();
  await deleteIssues(ids);
}

/** labels are replace-semantics server-side, so merge per issue like the CLI does */
async function toggleBulkLabel(labelId: string) {
  const snap = useApp.getState().snap!;
  const ids = selIds();
  const allHave = ids.length > 0 && ids.every(id => snap.issues.find(i => i.id === id)?.labelIds.includes(labelId));
  let changed = 0;
  for (const id of ids) {
    const issue = snap.issues.find(i => i.id === id);
    // already in the target state (has it when removing / lacks it when adding) — skip
    if (!issue || issue.labelIds.includes(labelId) !== allHave) continue;
    const labelIds = allHave ? issue.labelIds.filter(l => l !== labelId) : [...issue.labelIds, labelId];
    await api.updateIssue(id, { labelIds });
    changed++;
  }
  if (!changed) return;
  await useApp.getState().bootstrap();
  const name = snap.labels.find(l => l.id === labelId)?.name ?? 'Label';
  useApp.getState().toast({ title: `${allHave ? 'Removed' : 'Added'} "${name}" ${allHave ? 'from' : 'on'} ${changed} issue${changed > 1 ? 's' : ''}` });
}

function buildStatusPage(): PaletteItem[] {
  const snap = useApp.getState().snap!;
  const issues = selectedIssues();
  const teamIds = [...new Set(issues.map(i => i.teamId))];
  const uniform = uniformOn('stateId');
  const out: PaletteItem[] = [];
  for (const tid of teamIds) {
    const team = snap.teams.find(t => t.id === tid);
    for (const st of snap.states.filter(s => s.teamId === tid).sort((a, b) => a.position - b.position)) {
      out.push({
        id: `bulk-state-${st.id}`,
        icon: <StateIcon type={st.type} color={st.color} size={14} />,
        label: st.name,
        section: teamIds.length > 1 ? (team?.name ?? 'Team') : 'Workflow states',
        checked: uniform === st.id,
        keywords: st.name,
        action: () => void applyBulk({ stateId: st.id }, 'Status'),
      });
    }
  }
  return out;
}

const PRIORITIES: Array<[Priority, string]> = [[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']];

function buildPriorityPage(): PaletteItem[] {
  const uniform = uniformOn('priority');
  return PRIORITIES.map(([p, name]) => ({
    id: `bulk-prio-${p}`,
    icon: <PriorityIcon priority={p} size={14} />,
    label: name,
    section: 'Priority',
    checked: uniform === p,
    keywords: name,
    action: () => void applyBulk({ priority: p }, 'Priority'),
  }));
}

function buildAssignPage(): PaletteItem[] {
  const snap = useApp.getState().snap!;
  const uniform = uniformOn('assigneeId');
  const people = snap.users.filter(u => u.kind !== 'agent');
  const agents = snap.users.filter(u => u.kind === 'agent');
  const item = (u: (typeof snap.users)[number]): PaletteItem => ({
    id: `bulk-assign-${u.id}`,
    icon: <Avatar user={u} size={18} />,
    label: u.name,
    section: u.kind === 'agent' ? 'Agents' : 'People',
    checked: uniform === u.id,
    keywords: u.name,
    action: () => void applyBulk({ assigneeId: u.id }, 'Assignee'),
  });
  return [
    ...people.map(item),
    ...agents.map(item),
    { id: 'bulk-no-assignee', icon: <IconUser size={14} />, label: 'No assignee', section: 'People', checked: uniform === null, action: () => void applyBulk({ assigneeId: null }, 'Un-assign') },
  ];
}

function buildProjectPage(): PaletteItem[] {
  const snap = useApp.getState().snap!;
  const uniform = uniformOn('projectId');
  return [
    ...snap.projects.map(p => ({
      id: `bulk-proj-${p.id}`,
      icon: <span>{p.icon}</span>,
      label: p.name,
      section: 'Projects',
      checked: uniform === p.id,
      keywords: p.name,
      action: () => void applyBulk({ projectId: p.id }, 'Project'),
    })),
    { id: 'bulk-no-project', icon: <IconBox size={14} />, label: 'No project', section: 'Projects', checked: uniform === null, action: () => void applyBulk({ projectId: null }, 'Project') },
  ];
}

function buildLabelsPage(): PaletteItem[] {
  const snap = useApp.getState().snap!;
  const ids = selIds();
  return snap.labels.map(l => {
    const allHave = ids.length > 0 && ids.every(id => snap.issues.find(i => i.id === id)?.labelIds.includes(l.id));
    return {
      id: `bulk-label-${l.id}`,
      icon: <span className="label-dot" style={{ background: l.color }} />,
      label: l.name,
      section: 'Labels',
      checked: allHave,
      keywords: l.name,
      keepOpen: true,
      action: () => void toggleBulkLabel(l.id),
    };
  });
}

function buildEstimatePage(): PaletteItem[] {
  const uniform = uniformOn('estimate');
  // the scale each selected issue's team uses (Settings › team › Estimates)
  const snap = useApp.getState().snap!;
  const teams = new Set(selectedIssues().map(i => i.teamId));
  const points = [...new Set(snap.teams.filter(t => teams.has(t.id)).flatMap(t => ESTIMATE_SCALES[t.estimateScale].map(v => v.value)))].sort((a, b) => a - b);
  return [
    { id: 'bulk-est-none', icon: <IconClose size={13} />, label: 'No estimate', section: 'Estimate', checked: uniform === null, action: () => void applyBulk({ estimate: null }, 'Estimate') },
    ...points.filter(p => p > 0).map(pt => ({
      id: `bulk-est-${pt}`,
      icon: <span style={{ fontSize: 12, fontWeight: 600, width: 16, textAlign: 'center' }}>{pt}</span>,
      label: `point${pt > 1 ? 's' : ''}`,
      section: 'Estimate',
      checked: uniform === pt,
      keywords: `estimate ${pt} points`,
      action: () => void applyBulk({ estimate: pt }, 'Estimate'),
    })),
  ];
}

function buildCyclePage(): PaletteItem[] {
  const snap = useApp.getState().snap!;
  const issues = selectedIssues();
  const teamIds = [...new Set(issues.map(i => i.teamId))];
  const uniform = uniformOn('cycleId');
  const out: PaletteItem[] = [
    { id: 'bulk-no-cycle', icon: <IconCycle size={14} />, label: 'No cycle', section: 'Cycle', checked: uniform === null, action: () => void applyBulk({ cycleId: null }, 'Cycle') },
  ];
  for (const tid of teamIds) {
    const team = snap.teams.find(t => t.id === tid);
    for (const c of snap.cycles.filter(cy => cy.teamId === tid)) {
      out.push({
        id: `bulk-cycle-${c.id}`,
        icon: <IconCycle size={14} />,
        label: c.name || `Cycle ${c.number}`,
        section: teamIds.length > 1 ? (team?.name ?? 'Team') : 'Cycle',
        checked: uniform === c.id,
        keywords: c.name,
        action: () => void applyBulk({ cycleId: c.id }, 'Cycle'),
      });
    }
  }
  return out;
}

function buildDuePage(): PaletteItem[] {
  return [
    { id: 'bulk-due-today', icon: <IconCalendar size={14} />, label: 'Today', section: 'Due date', action: () => void applyBulk({ dueDate: new Date().toISOString().slice(0, 10) }, 'Due date') },
    { id: 'bulk-due-tomorrow', icon: <IconCalendar size={14} />, label: 'Tomorrow', section: 'Due date', action: () => void applyBulk({ dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }, 'Due date') },
    { id: 'bulk-due-week', icon: <IconCalendar size={14} />, label: 'Next week', section: 'Due date', action: () => void applyBulk({ dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }, 'Due date') },
    { id: 'bulk-due-clear', icon: <IconClose size={13} />, label: 'Clear due date', section: 'Due date', action: () => void applyBulk({ dueDate: null }, 'Due date') },
  ];
}

/** close the palette and open one of the issue property menus (filterable) in its place */
function quick(kind: PropKind) {
  const ids = selIds();
  useApp.getState().setPalette(false);
  setTimeout(() => useApp.getState().setQuickMenu({ issueIds: ids, kind, anchor: new DOMRect(window.innerWidth / 2 - 160, window.innerHeight * 0.18, 0, 0) }), 60);
}

function bulkRootItems(setSub: (p: SubPage) => void): PaletteItem[] {
  const snap = useApp.getState().snap!;
  const ids = selIds();
  const one = ids.length === 1 ? snap.issues.find(i => i.id === ids[0]) : undefined;
  const section = ctxIsSelection ? `${ids.length} selected` : one ? `${snap.teams.find(t => t.id === one.teamId)?.key}-${one.number}` : 'Issue';
  const subscribed = one ? snap.subscriptions.some(x => x.issueId === one.id && x.userId === snap.currentUser.id) : false;
  const extra: PaletteItem[] = [
    { id: 'ctx-assign-me', icon: <IconUser size={14} />, label: 'Assign to me', section, hint: 'I', keywords: 'self mine take', action: () => { void assignToMe(ids); finishBulk(); } },
    { id: 'ctx-parent', icon: <IconBox size={14} />, label: 'Set parent issue…', section, hint: '⌘⇧P', keywords: 'sub-issue parent', action: () => quick('parent') },
    { id: 'ctx-blocked', icon: <IconBox size={14} />, label: 'Mark as blocked by…', section, hint: 'M B', keywords: 'relation blocked dependency', action: () => quick('blocked_by') },
    { id: 'ctx-blocks', icon: <IconBox size={14} />, label: 'Mark as blocking…', section, hint: 'M X', keywords: 'relation blocks dependency', action: () => quick('blocks') },
    { id: 'ctx-related', icon: <IconBox size={14} />, label: 'Mark as related to…', section, hint: 'M R', keywords: 'relation related link', action: () => quick('related') },
    { id: 'ctx-duplicate', icon: <IconBox size={14} />, label: 'Mark as duplicate of…', section, hint: 'M M', keywords: 'relation duplicate dupe', action: () => quick('duplicate') },
    { id: 'ctx-remind', icon: <IconCalendar size={14} />, label: 'Remind me…', section, hint: '⇧H', keywords: 'snooze reminder later', action: () => quick('remind') },
    ...(snap.milestones.length ? [{ id: 'ctx-milestone', icon: <IconBox size={14} />, label: 'Set milestone…', section, hint: '⇧M', keywords: 'milestone project', action: () => quick('milestone') }] : []),
  ];
  if (one) {
    const h = handoffActions(one);
    extra.push(
      { id: 'ctx-subscribe', icon: <IconInbox size={14} />, label: subscribed ? 'Unsubscribe' : 'Subscribe', section, hint: '⇧S', keywords: 'notifications follow watch', action: () => { void toggleSubscription(one.id); finishBulk(); } },
      { id: 'ctx-team', icon: <IconTeam size={14} />, label: 'Move to team…', section, hint: '⌘⇧M', keywords: 'team transfer', action: () => quick('team') },
      { id: 'ctx-copy-id', icon: <IconCopyIdLocal />, label: 'Copy issue ID', section, hint: '⌘.', keywords: 'copy key', action: () => void h.copyId() },
      { id: 'ctx-copy-url', icon: <IconCopyIdLocal />, label: 'Copy issue URL', section, hint: '⌘⇧,', keywords: 'copy link', action: () => void h.copyUrl() },
      { id: 'ctx-copy-title', icon: <IconCopyIdLocal />, label: 'Copy issue title', section, hint: "⌘⇧'", keywords: 'copy name', action: () => void h.copyTitle() },
      { id: 'ctx-copy-branch', icon: <IconCopyIdLocal />, label: 'Copy git branch name', section, hint: '⌘⇧.', keywords: 'copy git branch', action: () => void h.copyBranch() },
      { id: 'ctx-copy-md', icon: <IconCopyIdLocal />, label: 'Copy issue as Markdown', section, hint: '⌘⌥C', keywords: 'copy markdown', action: () => void h.copyMarkdown() },
      { id: 'ctx-copy-prompt', icon: <IconHandoff />, label: 'Copy as prompt', section, hint: '⌘⌥P', keywords: 'handoff agent prompt', action: () => void h.copyPrompt() },
      { id: 'ctx-claude', icon: <IconSpark />, label: 'Open in Claude Code', section, keywords: 'handoff agent terminal', action: () => void h.openInClaude() },
    );
  }
  const base = bulkRootItemsBase(setSub).map(i => ({ ...i, section }));
  return [...base.slice(0, -2), ...extra, ...base.slice(-2)];
}

function IconCopyIdLocal() { return <IconCopyId size={14} />; }

function bulkRootItemsBase(setSub: (p: SubPage) => void): PaletteItem[] {
  return [
    { id: 'bulk-status', icon: <StateIcon type="unstarted" size={14} />, label: 'Change status…', section: 'Bulk actions', hint: 'S', keywords: 'set state workflow', keepOpen: true, action: () => setSub({ title: 'Change status…', build: buildStatusPage }) },
    { id: 'bulk-priority', icon: <PriorityIcon priority={2} size={14} />, label: 'Change priority…', section: 'Bulk actions', hint: 'P', keywords: 'urgent high medium low', keepOpen: true, action: () => setSub({ title: 'Change priority…', build: buildPriorityPage }) },
    { id: 'bulk-assign', icon: <IconUser size={14} />, label: 'Assign to…', section: 'Bulk actions', hint: 'A', keywords: 'assignee people agent', keepOpen: true, action: () => setSub({ title: 'Assign to…', build: buildAssignPage }) },
    { id: 'bulk-unassign', icon: <IconClose size={13} />, label: 'Un-assign', section: 'Bulk actions', keywords: 'remove assignee nobody', action: () => void applyBulk({ assigneeId: null }, 'Un-assign') },
    { id: 'bulk-project', icon: <IconBox size={14} />, label: 'Move to project…', section: 'Bulk actions', hint: '⇧P', keywords: 'project move', keepOpen: true, action: () => setSub({ title: 'Move to project…', build: buildProjectPage }) },
    { id: 'bulk-labels', icon: <IconTag size={14} />, label: 'Change or add labels…', section: 'Bulk actions', hint: 'L', keywords: 'labels tags', keepOpen: true, action: () => setSub({ title: 'Change or add labels…', build: buildLabelsPage }) },
    { id: 'bulk-estimate', icon: <IconEstimate size={14} />, label: 'Set estimate…', section: 'Bulk actions', hint: '⇧E', keywords: 'points sizing', keepOpen: true, action: () => setSub({ title: 'Set estimate…', build: buildEstimatePage }) },
    { id: 'bulk-cycle', icon: <IconCycle size={14} />, label: 'Add to cycle…', section: 'Bulk actions', hint: '⇧C', keywords: 'cycle sprint', keepOpen: true, action: () => setSub({ title: 'Add to cycle…', build: buildCyclePage }) },
    { id: 'bulk-due', icon: <IconCalendar size={14} />, label: 'Set due date…', section: 'Bulk actions', hint: '⇧D', keywords: 'due date deadline', keepOpen: true, action: () => setSub({ title: 'Set due date…', build: buildDuePage, calendar: true }) },
    { id: 'bulk-archive', icon: <IconArchive size={14} />, label: 'Archive', section: 'Bulk actions', keywords: 'archive close', action: () => void bulkArchive() },
    { id: 'bulk-delete', icon: <IconTrash size={14} />, label: 'Delete', section: 'Bulk actions', danger: true, keywords: 'delete remove trash', action: () => void bulkDelete() },
  ];
}

export function CommandPalette() {
  const open = useApp(s => s.paletteOpen);
  const setOpen = useApp(s => s.setPalette);
  const snap = useApp(s => s.snap);
  const openCreate = useApp(s => s.openCreate);
  const setTheme = useApp(s => s.setTheme);
  const selIdList = useSelection(s => s.ids);
  const toggleSel = useSelection(s => s.toggle);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const [sub, setSub] = useState<SubPage | null>(null);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);

  const [ctx, setCtx] = useState<string[]>([]);
  useEffect(() => { if (open) { captureContext(); setCtx(ctxIds); } }, [open, selIdList]);
  const selIssues = useMemo(
    () => ctx.map(id => snap?.issues.find(i => i.id === id)).filter(Boolean) as Issue[],
    [snap, ctx],
  );

  const items = useMemo<PaletteItem[]>(() => {
    if (!snap) return [];
    const nav: PaletteItem[] = [
      { id: 'nav-inbox', icon: <IconInbox />, label: 'Go to Inbox', section: 'Navigation', hint: 'G I', action: () => navigate('/inbox') },
      { id: 'nav-my', icon: <IconMyIssues />, label: 'Go to My issues', section: 'Navigation', hint: 'G M', action: () => navigate('/my-issues') },
      { id: 'nav-projects', icon: <IconBox />, label: 'Go to Projects', section: 'Navigation', hint: 'G P', action: () => navigate('/projects') },
      { id: 'nav-views', icon: <IconViews />, label: 'Go to Views', section: 'Navigation', hint: 'G W', action: () => navigate('/views') },
      { id: 'nav-search', icon: <IconSearch size={14} />, label: 'Search issues', section: 'Navigation', hint: '/', keywords: 'find look up', action: () => navigate('/search') },
      { id: 'nav-trash', icon: <IconTrash size={14} />, label: 'Go to Trash', section: 'Navigation', keywords: 'deleted restore', action: () => navigate('/trash') },
      { id: 'nav-set-prefs', icon: <IconSettings size={14} />, label: 'Open Preferences', section: 'Navigation', keywords: 'settings theme home week', action: () => navigate('/settings/preferences') },
      { id: 'nav-set-profile', icon: <IconUser size={14} />, label: 'Open Profile settings', section: 'Navigation', keywords: 'name avatar email', action: () => navigate('/settings/profile') },
      { id: 'nav-set-notif', icon: <IconInbox size={14} />, label: 'Open Notification settings', section: 'Navigation', keywords: 'inbox alerts', action: () => navigate('/settings/notifications') },
      { id: 'nav-settings', icon: <IconSettings />, label: 'Open Settings', section: 'Navigation', action: () => navigate('/settings/workspace') },
      { id: 'nav-set-appearance', icon: <IconSun size={14} />, label: 'Open Appearance settings', section: 'Navigation', action: () => navigate('/settings/appearance') },
      { id: 'nav-set-teams', icon: <IconTeam size={14} />, label: 'Open Teams settings', section: 'Navigation', action: () => navigate('/settings/teams') },
      { id: 'nav-set-labels', icon: <IconTeam size={14} />, label: 'Open Label settings', section: 'Navigation', action: () => navigate('/settings/labels') },
    ];
    const actions: PaletteItem[] = [
      { id: 'act-create', icon: <IconPlus />, label: 'Create new issue', section: 'Actions', hint: 'C', keywords: 'new issue add', action: () => openCreate() },
      { id: 'act-create-project', icon: <IconBox />, label: 'Create new project', section: 'Actions', keywords: 'new project add', action: () => navigate('/projects/new') },
      { id: 'act-theme', icon: document.documentElement.dataset.theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />, label: `Switch to ${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'} theme`, section: 'Actions', keywords: 'dark light system appearance toggle', action: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
      { id: 'act-theme-system', icon: <IconPanel size={14} />, label: 'Use system theme', section: 'Actions', keywords: 'system appearance auto browser os', action: () => setTheme('system') },
      { id: 'act-shortcuts', icon: <span className="kbd">?</span>, label: 'Show keyboard shortcuts', section: 'Actions', keywords: 'hotkeys keys', action: () => useApp.getState().setShortcuts(true) },
      { id: 'act-undo', icon: <IconBack size={14} />, label: 'Undo last change', section: 'Actions', hint: '⌘Z', keywords: 'revert back', action: () => void undoLast() },
      { id: 'act-sidebar', icon: <IconPanel size={14} />, label: 'Toggle sidebar', section: 'Actions', hint: '[', keywords: 'navigation collapse', action: () => useApp.getState().toggleSidebar() },
      { id: 'act-layout', icon: <IconViews size={14} />, label: 'Toggle list / board layout', section: 'Actions', hint: '⌘B', keywords: 'board list kanban view', action: () => window.dispatchEvent(new CustomEvent('baseline:toggle-layout')) },
      { id: 'act-save-view', icon: <IconViews size={14} />, label: 'Save as view', section: 'Actions', hint: '⌥V', keywords: 'save filters view create', action: () => {
        const ev = new CustomEvent('baseline:save-view', { cancelable: true });
        window.dispatchEvent(ev);
        if (!ev.defaultPrevented) useApp.getState().toast({ title: 'Nothing to save', line: 'Open an issue or project list to save it as a view' });
      } },
      { id: 'act-create-team', icon: <IconPlus />, label: 'Create new team', section: 'Actions', keywords: 'new team add workspace', action: () => navigate('/settings/new-team') },
      { id: 'nav-initiatives', icon: <IconBox size={14} />, label: 'Go to initiatives', section: 'Navigation', hint: 'G then N', keywords: 'initiatives strategy goals', action: () => navigate('/initiatives') },
      { id: 'nav-releases', icon: <IconBox size={14} />, label: 'Go to releases', section: 'Navigation', keywords: 'releases versions ship', action: () => navigate('/releases') },
      { id: 'nav-asks', icon: <IconBox size={14} />, label: 'Go to asks', section: 'Navigation', keywords: 'asks intake forms requests', action: () => navigate('/asks') },
      { id: 'nav-pulse', icon: <IconBox size={14} />, label: 'Go to Pulse', section: 'Navigation', keywords: 'pulse updates feed', action: () => navigate('/pulse') },
    ];

    for (const t of snap.teams) {
      nav.push({ id: `nav-team-home-${t.id}`, icon: <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 8, width: 15, height: 15 }}>{t.key.slice(0, 1)}</span>, label: `Go to ${t.name} overview`, section: 'Navigation', keywords: `${t.key} team home documents members`, action: () => navigate(`/team/${t.key}/overview`) });
      nav.push({ id: `nav-team-${t.id}`, icon: <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 8, width: 15, height: 15 }}>{t.key.slice(0, 1)}</span>, label: `Go to ${t.name}`, section: 'Navigation', keywords: t.key, action: () => navigate(`/team/${t.key}/all`) });
      if (snap.cycles.some(c => c.teamId === t.id) || t.autoCycles) {
        nav.push({ id: `nav-team-cycles-${t.id}`, icon: <IconCycle size={14} />, label: `Go to ${t.name} cycles`, section: 'Navigation', keywords: `${t.key} cycles`, action: () => navigate(`/team/${t.key}/cycles`) });
        const now = new Date().toISOString();
        const cur = snap.cycles.find(c => c.teamId === t.id && c.startsAt <= now && c.endsAt >= now);
        if (cur) nav.push({ id: `nav-team-curcycle-${t.id}`, icon: <IconCycle size={14} />, label: `Go to ${t.name} current cycle`, section: 'Navigation', keywords: `${t.key} active sprint`, action: () => navigate(`/team/${t.key}/cycles/${cur.id}`) });
      }
      if (t.triageEnabled) nav.push({ id: `nav-team-triage-${t.id}`, icon: <IconInbox size={14} />, label: `Go to ${t.name} triage`, section: 'Navigation', keywords: `${t.key} triage review`, action: () => navigate(`/team/${t.key}/triage`) });
      nav.push({ id: `nav-team-archive-${t.id}`, icon: <IconArchive size={14} />, label: `Go to ${t.name} archive`, section: 'Navigation', keywords: `${t.key} archived`, action: () => navigate(`/team/${t.key}/archive`) });
      nav.push({ id: `nav-team-settings-${t.id}`, icon: <IconSettings size={14} />, label: `Open ${t.name} settings`, section: 'Navigation', keywords: `${t.key} workflow triage estimates cycles`, action: () => navigate(`/settings/team/${t.key}`) });
    }
    const issueItems: PaletteItem[] = snap.issues.filter(i => !i.deletedAt).map(i => {
      const team = snap.teams.find(t => t.id === i.teamId);
      const state = snap.states.find(s => s.id === i.stateId);
      const key = `${team?.key}-${i.number}`;
      const assignee = snap.users.find(u => u.id === i.assigneeId);
      return {
        id: `issue-${i.id}`,
        icon: state ? <StateIcon type={state.type} color={state.color} size={14} /> : undefined,
        label: `${key} ${i.title}`,
        prefixLen: key.length,
        trail: assignee ? <Avatar user={assignee} size={16} /> : undefined,
        verb: 'Open issue',
        section: 'Issues',
        keywords: `${i.title} ${key}`,
        action: () => navigate(`/issue/${key}`),
      };
    });
    const projectItems: PaletteItem[] = snap.projects.map(p => ({
      id: `proj-${p.id}`,
      icon: <span>{p.icon}</span>,
      label: p.name,
      section: 'Projects',
      keywords: p.name,
      action: () => navigate(`/projects/${p.id}`),
    }));
    const viewItems: PaletteItem[] = snap.views.map(v => ({
      id: `view-${v.id}`,
      icon: <span>{v.icon || '🗂'}</span>,
      label: v.name,
      section: 'Views',
      keywords: v.name,
      action: () => navigate(`/views/${v.id}`),
    }));
    const docItems: PaletteItem[] = snap.docs.map(d => ({
      id: `doc-${d.id}`, icon: <IconDoc size={14} />, label: d.title || 'Untitled document', section: 'Documents', keywords: `${d.title} document doc`,
      action: () => navigate(`/docs/${d.id}`),
    }));
    const bulk: PaletteItem[] = selIssues.length ? bulkRootItems(setSub) : [];
    return [...bulk, ...nav, ...actions, ...projectItems, ...viewItems, ...docItems, ...issueItems];
  }, [snap, navigate, openCreate, setTheme, open, selIssues]);

  // sub-page builders read the stores, so rebuilding on snap/selection keeps
  // checkmarks and label states fresh after a toggle
  const subItems = useMemo(() => (sub ? sub.build() : []), [sub, snap, selIssues]);
  const active = useMemo(() => (sub ? subItems : items), [sub, subItems, items]);

  const filtered = useMemo<Array<{ item: PaletteItem; match: { indices: number[] } | null }>>(() => {
    if (!q.trim()) {
      if (sub) return active.map(item => ({ item, match: null }));
      // empty query: what you were just looking at comes first, then commands
      const byKey = new Map(items.filter(i => i.section === 'Issues').map(i => [i.label.slice(0, i.prefixLen), i]));
      const recent = recentIssueKeys().map(k => byKey.get(k)).filter(Boolean)
        .slice(0, 5).map(i => ({ ...i!, section: 'Recent' }));
      const nonIssues = items.filter(i => i.section !== 'Issues');
      return [...recent, ...nonIssues].map(item => ({ item, match: null }));
    }
    const hits = active
      .map(i => ({ i, s: scoreItem(q.trim(), i) }))
      .filter(({ s }) => s !== null)
      .sort((a, b) => b.s!.score - a.s!.score)
      .slice(0, 24)
      .map(({ i, s }) => ({ item: i, match: s!.match }));
    if (sub) return hits;
    // whatever you typed can always become an issue — last, unless nothing matched
    const title = q.trim();
    return [...hits, { item: {
      id: 'act-create-from-query', icon: <IconPlus size={14} />, label: `Create issue “${title}”`,
      section: 'Create', verb: 'Create issue', action: () => openCreate({ title }),
    }, match: null }];
  }, [active, items, q, sub, openCreate]);

  const runItem = (item: PaletteItem) => {
    if (item.keepOpen) item.action();
    else { setOpen(false); item.action(); }
  };

  useEffect(() => { setIndex(0); }, [q, sub]);
  useEffect(() => { if (open) { setQ(''); setIndex(0); setSub(null); } }, [open]);
  useEffect(() => { if (!selIssues.length) setSub(null); }, [selIssues.length]);
  useEffect(() => {
    const el = listRef.current?.querySelector('.menu-item.highlighted');
    el?.scrollIntoView({ block: 'nearest' });
  }, [index, filtered]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const entry = filtered[index];
        if (entry) runItem(entry.item);
        return;
      }
      // Linear-style single-key jumps into the bulk pickers while the query is empty
      if (!q && !sub && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && selIssues.length > 0) {
        const jump: Record<string, string> = e.shiftKey
          ? { p: 'bulk-project', e: 'bulk-estimate', c: 'bulk-cycle', h: 'ctx-remind', s: 'ctx-subscribe', m: 'ctx-milestone' }
          : { s: 'bulk-status', p: 'bulk-priority', a: 'bulk-assign', i: 'ctx-assign-me', l: 'bulk-labels' };
        const id = jump[e.key.toLowerCase()];
        if (id) {
          e.preventDefault();
          const target = items.find(i => i.id === id);
          if (target) runItem(target);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, index, setOpen, q, sub, items, selIssues.length]);


  const uniformDue = selIssues.length && selIssues.every(i => i.dueDate?.slice(0, 10) === selIssues[0]!.dueDate?.slice(0, 10))
    ? selIssues[0]!.dueDate?.slice(0, 10) : undefined;

  let lastSection = '';
  return (
    <AnimatePresence>
      {open && (
    <Modal onClose={() => { if (sub) setSub(null); else setOpen(false); }} className="modal modal-palette" dismissOnBackdrop={false}>
      {selIssues.length > 0 && (
        <div className="pal-scope">
          {selIssues.slice(0, 5).map(issue => {
            const team = snap?.teams.find(t => t.id === issue.teamId);
            return (
              <span key={issue.id} className="pal-scope-chip">
                <span className="chip-label">{team?.key}-{issue.number} · {issue.title}</span>
                <button className="chip-x" title="Remove from selection" onClick={() => toggleSel(issue.id)}><IconClose size={10} /></button>
              </span>
            );
          })}
          {selIssues.length > 5 && <span className="pal-scope-chip">+{selIssues.length - 5}</span>}
        </div>
      )}
      <div className="pal-input-row">
        <IconSearch style={{ color: 'var(--text-secondary)' }} />
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Type a command or search…"
          spellCheck={false}
        />
      </div>
      <div className="pal-list" ref={listRef}>
        {sub && (
          <button className="menu-item pal-back" onClick={() => setSub(null)}>
            <span className="mi-icon"><IconBack size={13} /></span>
            <span className="mi-label">{sub.title}</span>
          </button>
        )}
        {sub?.calendar && <CalendarGrid selected={uniformDue} onPick={iso => void applyBulk({ dueDate: iso }, 'Due date')} />}
        {filtered.map(({ item, match }, i) => {
          const header = item.section !== lastSection ? item.section : null;
          lastSection = item.section;
          return (
            <div key={item.id}>
              {header && <div className="menu-header" style={{ paddingTop: 8 }}><span>{header}</span></div>}
              <button
                className={`menu-item ${i === index ? 'highlighted' : ''} ${item.danger ? 'danger' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => runItem(item)}
              >
                {item.icon && <span className="mi-icon">{item.icon}</span>}
                <span className="mi-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.prefixLen ? (
                    <>
                      <span className="pal-key">
                        <Highlighted text={item.label.slice(0, item.prefixLen)} indices={(match?.indices ?? []).filter(n => n < item.prefixLen!)} />
                      </span>
                      <Highlighted text={item.label.slice(item.prefixLen + 1)} indices={(match?.indices ?? []).filter(n => n > item.prefixLen!).map(n => n - item.prefixLen! - 1)} />
                    </>
                  ) : <Highlighted text={item.label} indices={match?.indices ?? []} />}
                </span>
                <span className="mi-right">
                  {item.trail}
                  {item.checked && <IconCheck size={13} style={{ color: 'var(--brand)' }} />}
                  {item.hint && <span className="kbd">{item.hint}</span>}
                </span>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="pal-empty">No results for “{q}”</div>}
      </div>
      {/* the footer names what Enter will do for the highlighted row */}
      <div className="pal-foot">
        <span className="pal-foot-scope">{sub ? sub.title : selIssues.length ? `${selIssues.length} selected` : 'Baseline'}</span>
        <span className="pal-foot-keys">
          <span className="kbd">↑</span><span className="kbd">↓</span>
          <span className="pal-foot-verb">{(() => {
            const it = filtered[index]?.item;
            if (!it) return 'Select';
            return it.verb ?? (it.keepOpen ? 'Choose' : it.section === 'Navigation' ? 'Go' : it.section === 'Projects' ? 'Open project' : it.section === 'Views' ? 'Open view' : 'Run');
          })()}</span>
          <span className="kbd">↵</span>
          <span className="pal-foot-verb">{sub ? 'Back' : 'Close'}</span>
          <span className="kbd">esc</span>
        </span>
      </div>
    </Modal>
      )}
    </AnimatePresence>
  );
}

/* ---------------- keyboard shortcuts overlay ---------------- */
/** every shortcut, grouped as Linear's cheatsheet groups them — the overlay and Settings both read this */
export const SHORTCUT_GROUPS: Array<[string, Array<[string, string]>]> = [
  ['General', [
    ['⌘K', 'Open command palette'], ['C', 'Create new issue'], ['/', 'Search'], ['F', 'Filter'], ['?', 'Keyboard shortcuts'],
    ['⌘Z', 'Undo last change'], ['[', 'Toggle sidebar'], ['⌘B', 'Toggle list / board'], ['⌥V', 'Save as view'], ['Esc', 'Close · back'],
  ]],
  ['Navigation', [
    ['G then I', 'Inbox'], ['G then M', 'My issues'], ['G then A', 'All issues'], ['G then E', 'Active issues'], ['G then B', 'Backlog'],
    ['G then T', 'Triage'], ['G then C', 'Cycles'], ['G then V', 'Current cycle'], ['G then N', 'Initiatives'], ['G then P', 'Projects'], ['G then W', 'Views'], ['G then X', 'Archive'], ['G then F', 'Search'], ['G then S', 'Settings'],
  ]],
  ['Lists', [
    ['J / K', 'Move down / up'], ['↵', 'Open issue'], ['Space', 'Peek issue'], ['X', 'Select'], ['⇧ Click', 'Select range'], ['⌘A', 'Select all'],
  ]],
  ['Issue properties', [
    ['S', 'Status'], ['P', 'Priority'], ['A', 'Assignee'], ['I', 'Assign to me'], ['L', 'Labels'], ['⇧P', 'Project'], ['⇧M', 'Milestone'],
    ['⇧C', 'Cycle'], ['⇧E', 'Estimate'], ['⇧D', 'Due date'], ['1 – 9', 'Set nth status'],
  ]],
  ['Issue actions', [
    ['⇧S', 'Subscribe / unsubscribe'], ['⇧H', 'Remind me'], ['⌥F', 'Favorite'], ['⇧R', 'Rename (issue page)'], ['⌃L', 'Add link (issue page)'],
    ['⌘⇧P', 'Set parent'], ['⌘⇧O', 'New sub-issue'], ['⌘⇧M', 'Move to team'], ['M then B', 'Blocked by…'], ['M then X', 'Blocking…'],
    ['M then R', 'Related to…'], ['M then M', 'Duplicate of…'], ['E', 'Archive'], ['⌘⌫', 'Delete'],
  ]],
  ['Copy', [
    ['⌘.', 'Copy ID'], ['⌘⇧,', 'Copy URL'], ["⌘⇧'", 'Copy title'], ['⌘⇧.', 'Copy git branch'], ['⌘⌥C', 'Copy as Markdown'], ['⌘⌥P', 'Copy as prompt'],
  ]],
  ['Issue page', [['J / K', 'Next / previous issue'], ['⌘↵', 'Post comment · save'], ['@', 'Mention a person or issue'], ['/', 'Insert block (in the editor)']]],
  ['Inbox', [['U', 'Mark read / unread'], ['⌫', 'Delete notification'], ['H', 'Snooze'], ['⇧⌫', 'Delete all read']]],
  ['Triage', [['1', 'Accept'], ['2', 'Mark as duplicate'], ['3', 'Decline'], ['H', 'Snooze']]],
];

export function ShortcutList(props: { filter?: string }) {
  const q = (props.filter ?? '').trim().toLowerCase();
  const groups = SHORTCUT_GROUPS.map(([g, rows]) => [g, rows.filter(([k, d]) => !q || d.toLowerCase().includes(q) || k.toLowerCase().includes(q) || g.toLowerCase().includes(q))] as const).filter(([, rows]) => rows.length);
  return (
    <div className="shortcut-groups">
      {groups.map(([name, rows]) => (
        <div key={name} className="sc-group">
          <div className="sc-group-name">{name}</div>
          {rows.map(([k, d]) => (
            <div key={k + d} className="sc-row">
              <span>{d}</span>
              <span className="sc-keys">{k.split(' ').map((x, i) => x === 'then' ? <span key={i} className="sc-then">then</span> : x === '/' && k.includes(' / ') ? <span key={i} className="sc-then">/</span> : <span key={i} className="kbd">{x}</span>)}</span>
            </div>
          ))}
        </div>
      ))}
      {!groups.length && <div className="bd-empty">No shortcut matches “{props.filter}”.</div>}
    </div>
  );
}

export function ShortcutsOverlay() {
  const open = useApp(s => s.shortcutsOpen);
  const setOpen = useApp(s => s.setShortcuts);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <Modal onClose={() => setOpen(false)} className="modal shortcuts-modal">
          <div className="sc-head">
            <span className="sc-title">Keyboard shortcuts</span>
            <input className="text-input" autoFocus placeholder="Search shortcuts…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="sc-body"><ShortcutList filter={q} /></div>
        </Modal>
      )}
    </AnimatePresence>
  );
}
