import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useSelection, copyText, visibleList, type PaletteScope } from './store.js';
import { api } from './api.js';
import { handoffActions, hostedWorkspace } from './CodingTools.js';
import { setIssueProps, archiveIssues, deleteIssues, assignToMe, toggleSubscription, undoLast } from './actions.js';
import { shortcutTargets } from './nav.js';
import type { PropKind } from './propertyMenus.js';
import { Modal } from './ui.js';
import { AnimatePresence } from 'framer-motion';
import { Avatar, CalendarGrid, PriorityIcon, StateIcon } from './pickers.js';
import { scoreItem } from './fuzzy.js';
import { newDoc } from './Docs.js';
import { SETTINGS_NAV } from './Settings.js';
import {
  IconSearch, IconPlus, IconSettings, IconInbox, IconBox, IconViews, IconMyIssues,
  IconCycle, IconTeam, IconMoon, IconSun, IconHandoff, IconSpark, IconPanel, IconCopyId,
  IconArchive, IconBack, IconCalendar, IconCheck, IconClose, IconEstimate, IconTag, IconTrash, IconUser,
  IconDoc, IconFilter, IconStar, IconIssues, IconDrafts, IconTriage, IconInitiative, IconUsers, IconPulse, IconKeyboard,
} from './icons.js';
import { teamScale, type Issue, type Priority } from '../../src/core/types.js';

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
  /** only offered once you type (per-team shortcuts) */
  searchOnly?: boolean;
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
  const points = [...new Set(snap.teams.filter(t => teams.has(t.id)).flatMap(t => teamScale(t).map(v => v.value)))].sort((a, b) => a - b);
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
    );
    // hosted, Claude Code can't be opened from the server yet (the companion comes in Phase 2)
    if (!hostedWorkspace()) extra.push({ id: 'ctx-claude', icon: <IconSpark />, label: 'Open in Claude Code', section, keywords: 'handoff agent terminal', action: () => void h.openInClaude() });
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

/** Linear's "Export issues as CSV": the list on screen (or every issue), downloaded as a file */
function exportCsv(issues: Issue[]) {
  const snap = useApp.getState().snap!;
  const name = (list: Array<{ id: string; name: string }>, id: string | null | undefined) => list.find(x => x.id === id)?.name ?? '';
  const cell = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = [['ID', 'Title', 'Status', 'Priority', 'Assignee', 'Project', 'Cycle', 'Labels', 'Estimate', 'Due date', 'Created', 'Updated', 'Completed']];
  for (const i of issues) {
    const team = snap.teams.find(t => t.id === i.teamId);
    rows.push([`${team?.key}-${i.number}`, i.title, name(snap.states, i.stateId), ['No priority', 'Urgent', 'High', 'Medium', 'Low'][i.priority] ?? '', name(snap.users, i.assigneeId), name(snap.projects, i.projectId),
      snap.cycles.find(c => c.id === i.cycleId)?.number?.toString() ?? '', i.labelIds.map(l => name(snap.labels, l)).join(', '), i.estimate?.toString() ?? '', i.dueDate ?? '', i.createdAt, i.updatedAt, i.completedAt ?? '']);
  }
  const blob = new Blob([rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${snap.workspace.name.toLowerCase().replace(/\W+/g, '-')}-issues.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  useApp.getState().toast({ title: `Exported ${issues.length} issue${issues.length === 1 ? '' : 's'}` });
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
    // the default list follows Linear's: grouped by what you act on, creation first
    const teamKey = /^#\/team\/([^/]+)/.exec(location.hash)?.[1] ?? localStorage.getItem('baseline:issuesTeam') ?? snap.teams[0]?.key ?? '';
    const curTeam = snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase()) ?? snap.teams[0];
    const tk = curTeam?.key ?? '';
    const pick = (scope: PaletteScope) => () => useApp.getState().setPalette(true, scope);
    const teamMark = (t: { color: string; key: string }) => <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 8, width: 15, height: 15 }}>{t.key.slice(0, 1)}</span>;
    const nav: PaletteItem[] = [
      { id: 'act-create', icon: <IconPlus />, label: 'Create new issue…', section: 'Issues', hint: 'C', keywords: 'new issue add', action: () => openCreate({ teamId: curTeam?.id }) },
      { id: 'act-create-full', icon: <IconPlus />, label: 'Create issue in fullscreen…', section: 'Issues', hint: 'V', keywords: 'new issue expanded', action: () => openCreate({ teamId: curTeam?.id, expanded: true }) },
      { id: 'act-create-label', icon: <IconTag size={14} />, label: 'Create new label…', section: 'Issues', keywords: 'label tag add', action: () => navigate('/settings/labels') },
      { id: 'act-create-project', icon: <IconBox />, label: 'Create new project…', section: 'Projects', hint: 'N then P', keywords: 'new project add', action: () => navigate('/projects/new') },
      { id: 'act-create-doc', icon: <IconDoc size={14} />, label: 'Create new document in…', section: 'Documents', hint: 'N then D', keywords: 'new document doc spec', keepOpen: true, action: pick('document-new') },
      { id: 'act-save-view', icon: <IconViews size={14} />, label: 'Create view…', section: 'Views', hint: '⌥V', keywords: 'save filters view create', action: () => {
        const ev = new CustomEvent('baseline:save-view', { cancelable: true });
        window.dispatchEvent(ev);
        if (!ev.defaultPrevented) useApp.getState().toast({ title: 'Nothing to save', line: 'Open an issue or project list to save it as a view' });
      } },
      { id: 'act-create-initiative', icon: <IconInitiative size={14} />, label: 'Create new initiative', section: 'Initiatives', hint: 'N then I', keywords: 'new initiative', action: () => navigate('/initiatives', { state: { create: true } }) },
      ...(curTeam ? [
        { id: 'team-copy-title', icon: <IconCopyId size={14} />, label: 'Copy team title', section: `Team ⋅ ${curTeam.name}`, keywords: 'copy name', action: () => void copyText(curTeam.name).then(ok => ok && useApp.getState().toast({ title: 'Copied team title' })) },
        { id: 'team-copy-link', icon: <IconCopyId size={14} />, label: 'Copy title as link', section: `Team ⋅ ${curTeam.name}`, keywords: 'copy url link', action: () => void copyText(`${location.origin}/#/team/${curTeam.key}/all`).then(ok => ok && useApp.getState().toast({ title: 'Copied link to team' })) },
      ] : []),
      { id: 'nav-search', icon: <IconSearch size={14} />, label: 'Search workspace…', section: 'Filter', hint: '/', keywords: 'find look up', action: () => navigate('/search') },
      { id: 'act-filter', icon: <IconFilter size={14} />, label: 'Add filter…', section: 'Filter', hint: 'F', keywords: 'filter narrow', action: () => setTimeout(() => window.dispatchEvent(new CustomEvent('baseline:focus-filter')), 50) },
      { id: 'act-tpl-issue', icon: <IconDoc size={14} />, label: 'Create new issue template…', section: 'Templates', keywords: 'template', action: () => navigate('/settings/templates') },
      { id: 'act-tpl-doc', icon: <IconDoc size={14} />, label: 'Create new document template…', section: 'Templates', keywords: 'template', action: () => navigate('/settings/documents') },
      { id: 'act-tpl-project', icon: <IconDoc size={14} />, label: 'Create new project template…', section: 'Templates', keywords: 'template', action: () => navigate('/settings/project-templates') },
      { id: 'act-favorite', icon: <IconStar size={14} />, label: 'Favorite page', section: 'Favorite', hint: '⌥F', keywords: 'star favorite pin', action: () => { const b = document.querySelector<HTMLButtonElement>('[data-favorite-star]'); if (b) b.click(); else useApp.getState().toast({ title: 'This page can’t be a favorite' }); } },
      { id: 'pick-issue', icon: <IconIssues size={14} />, label: 'Open issue…', section: 'Navigation', hint: 'O then I', keepOpen: true, action: pick('issue') },
      { id: 'nav-archive', icon: <IconArchive size={14} />, label: 'Open team archive…', section: 'Navigation', hint: 'G then X', keywords: 'archived', action: () => navigate(`/team/${tk}/archive`) },
      { id: 'pick-project', icon: <IconBox size={14} />, label: 'Open project…', section: 'Navigation', hint: 'O then P', keepOpen: true, action: pick('project') },
      { id: 'pick-favorite', icon: <IconStar size={14} />, label: 'Open favorite…', section: 'Navigation', hint: 'O then F', keepOpen: true, action: pick('favorite') },
      { id: 'pick-cycle', icon: <IconCycle size={14} />, label: 'Open cycle…', section: 'Navigation', hint: 'O then C', keepOpen: true, action: pick('cycle') },
      { id: 'pick-label', icon: <IconTag size={14} />, label: 'Open issue label…', section: 'Navigation', hint: 'O then L', keepOpen: true, action: pick('label') },
      { id: 'pick-user', icon: <IconUser size={14} />, label: 'Open user…', section: 'Navigation', hint: 'O then U', keepOpen: true, action: pick('user') },
      { id: 'pick-view', icon: <IconViews size={14} />, label: 'Open view…', section: 'Navigation', hint: 'O then V', keepOpen: true, action: pick('view') },
      { id: 'pick-doc', icon: <IconDoc size={14} />, label: 'Open document…', section: 'Navigation', hint: 'O then D', keepOpen: true, action: pick('document') },
      { id: 'nav-adv-search', icon: <IconSearch size={14} />, label: 'Go to advanced search', section: 'Navigation', hint: '/', keywords: 'search find', action: () => navigate('/search') },
      { id: 'nav-inbox', icon: <IconInbox size={14} />, label: 'Go to inbox', section: 'Navigation', hint: 'G then I', action: () => navigate('/inbox') },
      { id: 'nav-my', icon: <IconMyIssues size={14} />, label: 'Go to my issues', section: 'Navigation', hint: 'G then M', action: () => navigate('/my-issues') },
      { id: 'nav-drafts', icon: <IconDrafts size={14} />, label: 'Go to drafts', section: 'Navigation', hint: 'G then D', action: () => navigate('/drafts') },
      { id: 'nav-active', icon: <IconIssues size={14} />, label: 'Go to active issues', section: 'Navigation', hint: 'G then A', action: () => navigate(`/team/${tk}/active`) },
      ...(curTeam?.triageEnabled ? [{ id: 'nav-triage', icon: <IconTriage size={14} />, label: 'Go to triage issues', section: 'Navigation', hint: 'G then T', action: () => navigate(`/team/${tk}/triage`) }] : []),
      { id: 'nav-backlog', icon: <IconIssues size={14} />, label: 'Go to backlog', section: 'Navigation', hint: 'G then B', action: () => navigate(`/team/${tk}/backlog`) },
      { id: 'nav-all', icon: <IconIssues size={14} />, label: 'Go to all issues', section: 'Navigation', hint: 'G then E', action: () => navigate(`/team/${tk}/all`) },
      { id: 'nav-cycles', icon: <IconCycle size={14} />, label: 'Go to cycles', section: 'Navigation', hint: 'G then C', action: () => navigate(`/team/${tk}/cycles`) },
      { id: 'nav-upcoming', icon: <IconCycle size={14} />, label: 'Go to upcoming cycle', section: 'Navigation', hint: 'G then W', action: () => navigate(`/team/${tk}/cycles/upcoming`) },
      { id: 'nav-current', icon: <IconCycle size={14} />, label: 'Go to current cycle', section: 'Navigation', hint: 'G then V', action: () => navigate(`/team/${tk}/cycles/current`) },
      { id: 'nav-projects', icon: <IconBox size={14} />, label: 'Go to projects', section: 'Navigation', hint: 'G then P', action: () => navigate('/projects') },
      { id: 'nav-initiatives', icon: <IconInitiative size={14} />, label: 'Go to initiatives', section: 'Navigation', hint: 'G then N', keywords: 'strategy goals', action: () => navigate('/initiatives') },
      { id: 'nav-views', icon: <IconViews size={14} />, label: 'Go to views', section: 'Navigation', hint: 'G then U', action: () => navigate('/views') },
      { id: 'nav-teams', icon: <IconTeam size={14} />, label: 'Go to teams', section: 'Navigation', action: () => navigate('/teams') },
      { id: 'nav-members', icon: <IconUsers size={14} />, label: 'Go to members', section: 'Navigation', action: () => navigate('/members') },
      { id: 'nav-pulse', icon: <IconPulse size={14} />, label: 'Go to Pulse', section: 'Navigation', keywords: 'updates feed', action: () => navigate('/pulse') },
      { id: 'nav-trash', icon: <IconTrash size={14} />, label: 'Go to recently deleted issues', section: 'Navigation', keywords: 'trash deleted restore', action: () => navigate('/trash') },
      { id: 'nav-settings', icon: <IconSettings size={14} />, label: 'Go to settings', section: 'Navigation', hint: 'G then S', action: () => navigate('/settings/workspace') },
      { id: 'pick-settings', icon: <IconSettings size={14} />, label: 'Open settings…', section: 'Navigation', hint: 'O then S', keepOpen: true, action: pick('settings') },
      { id: 'act-sidebar', icon: <IconPanel size={14} />, label: 'Collapse navigation sidebar', section: 'Navigation', hint: '[', keywords: 'toggle sidebar', action: () => useApp.getState().toggleSidebar() },
      { id: 'act-layout', icon: <IconViews size={14} />, label: 'Toggle list / board layout', section: 'Display options', hint: '⌘B', keywords: 'board list kanban view', action: () => window.dispatchEvent(new CustomEvent('baseline:toggle-layout')) },
      { id: 'act-copy-url', icon: <IconCopyId size={14} />, label: 'Copy page URL', section: 'Miscellaneous', hint: '⌘⇧C', keywords: 'link', action: () => void copyText(location.href).then(ok => ok && useApp.getState().toast({ title: 'Copied page URL' })) },
      { id: 'act-select-all', icon: <IconCheck size={14} />, label: 'Select all', section: 'Miscellaneous', hint: '⌘A', action: () => useSelection.getState().setMany(visibleList.issues.map(i => i.id)) },
      { id: 'act-undo', icon: <IconBack size={14} />, label: 'Undo last change', section: 'Miscellaneous', hint: '⌘Z', keywords: 'revert back', action: () => void undoLast() },
      { id: 'act-csv', icon: <IconArchive size={14} />, label: 'Export issues as CSV…', section: 'Export', keywords: 'download spreadsheet', action: () => exportCsv(visibleList.issues.length ? visibleList.issues : snap.issues.filter(i => !i.deletedAt)) },
      { id: 'act-theme', icon: document.documentElement.dataset.theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />, label: 'Change interface theme…', section: 'Settings', keywords: 'dark light system appearance', keepOpen: true, action: () => setSub({ title: 'Change interface theme…', build: () => ([['light', 'Light'], ['dark', 'Dark'], ['system', 'System preference']] as const).map(([v, l]) => ({ id: `theme-${v}`, label: l, section: 'Theme', action: () => setTheme(v) })) }) },
      { id: 'act-default-view', icon: <IconSettings size={14} />, label: 'Change default view…', section: 'Settings', keywords: 'home view start page', action: () => navigate('/settings/preferences') },
      { id: 'act-invite', icon: <IconUser size={14} />, label: 'Invite to workspace…', section: 'Settings', keywords: 'member add people', action: () => navigate('/settings/members') },
      { id: 'act-create-team', icon: <IconPlus size={14} />, label: 'Create a team…', section: 'Teams', keywords: 'new team add', action: () => navigate('/settings/new-team') },
      { id: 'act-shortcuts', icon: <IconKeyboard size={14} />, label: 'Open keyboard shortcuts cheat sheet', section: 'Help', hint: '?', keywords: 'hotkeys keys', action: () => useApp.getState().setShortcuts(true) },
    ];
    for (const t of snap.teams) {
      nav.push({ id: `nav-team-${t.id}`, icon: teamMark(t), label: `Go to ${t.name}`, section: 'Teams', keywords: `${t.key} issues`, searchOnly: true, action: () => navigate(`/team/${t.key}/all`) });
      nav.push({ id: `nav-team-home-${t.id}`, icon: teamMark(t), label: `Go to ${t.name} overview`, section: 'Teams', keywords: `${t.key} team home documents members`, searchOnly: true, action: () => navigate(`/team/${t.key}/overview`) });
      nav.push({ id: `nav-team-settings-${t.id}`, icon: <IconSettings size={14} />, label: `Open ${t.name} settings`, section: 'Teams', keywords: `${t.key} workflow triage estimates cycles`, searchOnly: true, action: () => navigate(`/settings/team/${t.key}`) });
    }
    const actions: PaletteItem[] = [];
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
      searchOnly: true,
      action: () => navigate(`/projects/${p.id}`),
    }));
    const viewItems: PaletteItem[] = snap.views.map(v => ({
      id: `view-${v.id}`,
      icon: <span>{v.icon || '🗂'}</span>,
      label: v.name,
      section: 'Views',
      keywords: v.name,
      searchOnly: true,
      action: () => navigate(`/views/${v.id}`),
    }));
    const docItems: PaletteItem[] = snap.docs.map(d => ({
      id: `doc-${d.id}`, icon: <IconDoc size={14} />, label: d.title || 'Untitled document', section: 'Documents', keywords: `${d.title} document doc`, searchOnly: true,
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
      // empty query: Linear's command list (issues, projects and the rest appear as you type)
      return items.filter(i => !i.searchOnly && !i.prefixLen).map(item => ({ item, match: null }));
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
  // O then … (or "Open issue…" in the list): the palette becomes a picker of one kind
  const scope = useApp(s => s.paletteScope);
  useEffect(() => { if (open && scope) { setQ(''); setIndex(0); setSub(scopePage(scope)); } }, [open, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopePage = (sc: PaletteScope): SubPage => {
    const s = useApp.getState().snap!;
    const of = (section: string) => () => items.filter(i => i.section === section && (section !== 'Issues' || i.prefixLen)).map(i => ({ ...i, section: '' }));
    const go = (to: string) => () => navigate(to);
    switch (sc) {
      case 'issue': return { title: 'Open issue…', build: () => {
        // what you looked at last comes first
        const recent = recentIssueKeys(); const all = of('Issues')();
        const rank = (i: PaletteItem) => { const n = recent.indexOf(i.label.slice(0, i.prefixLen)); return n < 0 ? 999 : n; };
        return all.sort((a, b) => rank(a) - rank(b));
      } };
      case 'project': return { title: 'Open project…', build: of('Projects') };
      case 'view': return { title: 'Open view…', build: of('Views') };
      case 'document': return { title: 'Open document…', build: of('Documents') };
      case 'cycle': return { title: 'Open cycle…', build: () => s.cycles.slice().sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map(c => { const t = s.teams.find(x => x.id === c.teamId); return { id: `cyc-${c.id}`, icon: <IconCycle size={14} />, label: `${t?.key ?? ''} ${c.name || `Cycle ${c.number}`}`, section: '', keywords: `${t?.name} cycle ${c.number}`, action: go(`/team/${t?.key}/cycles/${c.id}`) }; }) };
      case 'label': return { title: 'Open issue label…', build: () => s.labels.map(l => ({ id: `lab-${l.id}`, icon: <span className="label-dot" style={{ background: l.color }} />, label: l.name, section: '', keywords: l.name, action: go(`/labels/${l.id}`) })) };
      case 'user': return { title: 'Open user…', build: () => s.users.map(u => ({ id: `usr-${u.id}`, icon: <Avatar user={u} size={16} />, label: u.name, section: '', keywords: `${u.name} ${u.email}`, action: go(`/profiles/${u.id}`) })) };
      case 'favorite': return { title: 'Open favorite…', build: () => s.favorites.map(f => {
        const issue = f.type === 'issue' ? s.issues.find(i => i.id === f.refId) : undefined;
        const label = issue ? `${s.teams.find(t => t.id === issue.teamId)?.key}-${issue.number} ${issue.title}` : f.type === 'project' ? s.projects.find(p => p.id === f.refId)?.name : f.type === 'view' ? s.views.find(v => v.id === f.refId)?.name ?? f.refId : f.type === 'initiative' ? s.initiatives.find(i => i.id === f.refId)?.name : s.cycles.find(c => c.id === f.refId)?.name;
        const to = issue ? `/issue/${s.teams.find(t => t.id === issue.teamId)?.key}-${issue.number}` : f.type === 'project' ? `/projects/${f.refId}` : f.type === 'initiative' ? `/initiatives/${f.refId}` : f.type === 'view' ? `/views/${f.refId}` : '/';
        return { id: `fav-${f.id}`, icon: <IconStar size={14} />, label: label ?? 'Favorite', section: '', action: go(to) };
      }) };
      case 'settings': return { title: 'Open settings…', build: () => SETTINGS_NAV.flatMap(g => g.items.map(([label, key]) => ({ id: `set-${key}`, icon: <IconSettings size={14} />, label, section: g.sec, keywords: `${g.sec} ${label}`, action: go(`/settings/${key}`) }))) };
      case 'document-new': return { title: 'Create new document in…', build: () => [
        ...s.teams.map(t => ({ id: `nd-t-${t.id}`, icon: <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 8, width: 15, height: 15 }}>{t.key.slice(0, 1)}</span>, label: t.name, section: 'Teams', keywords: t.key, action: () => void newDoc({ teamId: t.id }, navigate) })),
        ...s.projects.map(p => ({ id: `nd-p-${p.id}`, icon: <span>{p.icon}</span>, label: p.name, section: 'Projects', keywords: p.name, action: () => void newDoc({ projectId: p.id }, navigate) })),
      ] };
    }
  };
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
    <Modal onClose={() => { if (sub && !scope) setSub(null); else setOpen(false); }} className="modal modal-palette" dismissOnBackdrop={false}>
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
        {scope && <span className="pal-scope-icon">{({ issue: <IconIssues size={14} />, project: <IconBox size={14} />, view: <IconViews size={14} />, document: <IconDoc size={14} />, cycle: <IconCycle size={14} />, label: <IconTag size={14} />, user: <IconUser size={14} />, favorite: <IconStar size={14} />, settings: <IconSettings size={14} />, 'document-new': <IconDoc size={14} /> } as const)[scope]}</span>}
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={sub ? `${sub.title.replace(/…$/, '')}…` : 'Type a command or search…'}
          spellCheck={false}
        />
      </div>
      <div className="pal-list" ref={listRef}>
        {sub && !scope && (
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
                  {item.hint && <span className="pal-keys">{item.hint.split(' ').map((k, n) => k === 'then' ? <span key={n} className="pal-then">then</span> : <span key={n} className="kbd">{k}</span>)}</span>}
                </span>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="pal-empty">No results for “{q}”</div>}
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
    ['⌘ K', 'Open command menu'], ['⌘ ↵', 'Save or submit'], ['↵', 'Send comment'], ['Esc', 'Back'], ['/', 'Open search'],
    ['?', 'Open help menu'], ['⌘ /', 'View keyboard shortcuts'], ['⌘ Z', 'Undo last change'],
  ]],
  ['Navigation', [
    ['[', 'Toggle left sidebar'], ['O then I', 'Open issue'], ['G then I', 'Go to inbox'], ['G then M', 'Go to my issues'], ['G then T', 'Go to triage'],
    ['G then D', 'Go to drafts'], ['G then A', 'Go to active issues'], ['G then B', 'Go to backlog'], ['G then X', 'Open team archive'], ['G then E', 'Go to all issues'],
    ['G then C', 'Go to cycles'], ['G then V', 'Go to current cycle'], ['G then W', 'Go to upcoming cycle'], ['G then P', 'Go to projects'], ['G then S', 'Go to settings'],
    ['O then F', 'Open a favorite'], ['O then P', 'Open a project'], ['O then C', 'Open a cycle'], ['O then U', 'Open a user'], ['O then V', 'Open view'],
    ['O then D', 'Open a document'], ['O then L', 'Open an issue label'], ['O then S', 'Open settings'], ['G then N', 'Go to initiatives'], ['G then U', 'Go to views'],
  ]],
  ['Issues', [
    ['C', 'New issue'], ['V', 'New issue in full screen view'], ['A', 'Assign issue to user'], ['I', 'Assign to me'], ['L', 'Change labels'],
    ['S', 'Change issue status'], ['P', 'Change priority'], ['⇧ E', 'Change estimate'], ['⇧ D', 'Set due date'], ['⇧ R', 'Rename'],
    ['⌥ F', 'Mark as favorite'], ['⇧ H', 'Remind about issue'], ['⌘ ⇧ M', 'Move to another team'], ['⇧ S', 'Subscribe to issue'], ['M then B', 'Mark as blocked'],
    ['M then X', 'Mark as blocking'], ['M then R', 'Reference related issue'], ['M then M', 'Mark as duplicate of another issue'], ['⌃ L', 'Link any URL to issue…'],
    ['⌘ .', 'Copy issue id'], ['⌘ ⇧ .', 'Copy git branch name'], ['⌘ ⇧ ,', 'Copy issue URL'], ["⌘ ⇧ '", 'Copy issue title'], ['⌘ ⌥ C', 'Copy everything as Markdown'],
    ['⌘ ⌥ P', 'Copy as prompt'], ['⌘ ⇧ O', 'Create sub-issue'], ['⇧ C', 'Add to cycle'], ['⇧ P', 'Add to project'], ['⇧ M', 'Add to project milestone'],
    ['⌘ ⇧ P', 'Set parent issue'], ['1 – 9', 'Set nth status'], ['E', 'Archive'], ['⌘ ⌫', 'Delete'], ['@', 'Mention a person or issue'],
  ]],
  ['Projects', [['N then P', 'New project'], ['N then I', 'New initiative'], ['N then D', 'New document']]],
  ['List', [
    ['Space', 'Peek into item'], ['↵', 'Open focused item'], ['X', 'Select item'], ['⌘ A', 'Select all items'], ['Esc', 'Clear selection'],
    ['⌘ B', 'Toggle layout view'], ['⌘ ⇧ C', 'Copy page URL'], ['K', 'Move up'], ['J', 'Move down'], ['⇧ Click', 'Select multiple items in a list'],
    ['F', 'Add filter'], ['⌥ V', 'Save as view'],
  ]],
  ['Inbox', [['U', 'Mark read / unread'], ['⌫', 'Delete notification'], ['H', 'Snooze'], ['⇧ ⌫', 'Delete all read']]],
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
              <span className="sc-keys">{(k === '1 – 9' ? ['1–9'] : k.split(' ')).map((x, i) => x === 'then' ? <span key={i} className="sc-then">then</span> : <span key={i} className="kbd">{x}</span>)}</span>
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
            <span className="sc-title">Keyboard Shortcuts</span>
            <button className="icon-btn" title="Close (Esc)" onClick={() => setOpen(false)}><IconClose size={14} /></button>
          </div>
          <div className="sc-search"><IconSearch size={14} /><input autoFocus placeholder="Search shortcuts" aria-label="Search shortcuts" value={q} onChange={e => setQ(e.target.value)} /></div>
          <div className="sc-body"><ShortcutList filter={q} /></div>
        </Modal>
      )}
    </AnimatePresence>
  );
}
