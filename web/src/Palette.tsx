import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useSelection, copyText } from './store.js';
import { api } from './api.js';
import { Modal } from './ui.js';
import { Avatar, CalendarGrid, ESTIMATE_POINTS, PriorityIcon, StateIcon } from './pickers.js';
import { scoreItem } from './fuzzy.js';
import {
  IconSearch, IconPlus, IconSettings, IconInbox, IconBox, IconViews, IconMyIssues,
  IconCycle, IconTeam, IconMoon, IconSun, IconHome, IconPrompt,
  IconArchive, IconBack, IconCalendar, IconCheck, IconClose, IconEstimate, IconTag, IconTrash, IconUser,
} from './icons.js';
import type { Issue, Priority } from '../../src/core/types.js';

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

function selIds() {
  return useSelection.getState().ids;
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
  await api.bulkIssues({ ids, patch });
  await useApp.getState().bootstrap();
  useApp.getState().setPalette(false);
  useSelection.getState().clear();
  useApp.getState().toast({ title: `${label} applied to ${ids.length} issue${ids.length > 1 ? 's' : ''}` });
}

async function bulkArchive() {
  const ids = selIds();
  if (!ids.length) return;
  for (const id of ids) await api.archiveIssue(id);
  await useApp.getState().bootstrap();
  useApp.getState().setPalette(false);
  useSelection.getState().clear();
  useApp.getState().toast({
    title: `${ids.length} issue${ids.length > 1 ? 's' : ''} archived`,
    actions: [{ label: 'Undo', onClick: async () => { for (const id of ids) await api.unarchiveIssue(id); await useApp.getState().bootstrap(); } }],
  });
}

async function bulkDelete() {
  const ids = selIds();
  if (!ids.length) return;
  for (const id of ids) await api.deleteIssue(id);
  await useApp.getState().bootstrap();
  useApp.getState().setPalette(false);
  useSelection.getState().clear();
  useApp.getState().toast({
    title: `${ids.length} issue${ids.length > 1 ? 's' : ''} deleted`,
    actions: [{ label: 'Undo', onClick: async () => { for (const id of ids) await api.restoreIssue(id); await useApp.getState().bootstrap(); } }],
  });
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
  return [
    { id: 'bulk-est-none', icon: <IconClose size={13} />, label: 'No estimate', section: 'Estimate', checked: uniform === null, action: () => void applyBulk({ estimate: null }, 'Estimate') },
    ...ESTIMATE_POINTS.filter(p => p > 0).map(pt => ({
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

function bulkRootItems(setSub: (p: SubPage) => void): PaletteItem[] {
  return [
    { id: 'bulk-status', icon: <StateIcon type="unstarted" size={14} />, label: 'Change status…', section: 'Bulk actions', hint: 'S', keywords: 'set state workflow', keepOpen: true, action: () => setSub({ title: 'Change status…', build: buildStatusPage }) },
    { id: 'bulk-priority', icon: <PriorityIcon priority={2} size={14} />, label: 'Change priority…', section: 'Bulk actions', hint: 'P', keywords: 'urgent high medium low', keepOpen: true, action: () => setSub({ title: 'Change priority…', build: buildPriorityPage }) },
    { id: 'bulk-assign', icon: <IconUser size={14} />, label: 'Assign to…', section: 'Bulk actions', hint: 'A', keywords: 'assignee people agent', keepOpen: true, action: () => setSub({ title: 'Assign to…', build: buildAssignPage }) },
    { id: 'bulk-unassign', icon: <IconClose size={13} />, label: 'Un-assign', section: 'Bulk actions', hint: 'I', keywords: 'remove assignee nobody', action: () => void applyBulk({ assigneeId: null }, 'Un-assign') },
    { id: 'bulk-project', icon: <IconBox size={14} />, label: 'Move to project…', section: 'Bulk actions', hint: '⇧P', keywords: 'project move', keepOpen: true, action: () => setSub({ title: 'Move to project…', build: buildProjectPage }) },
    { id: 'bulk-labels', icon: <IconTag size={14} />, label: 'Change or add labels…', section: 'Bulk actions', hint: 'L', keywords: 'labels tags', keepOpen: true, action: () => setSub({ title: 'Change or add labels…', build: buildLabelsPage }) },
    { id: 'bulk-estimate', icon: <IconEstimate size={14} />, label: 'Set estimate…', section: 'Bulk actions', hint: '⇧E', keywords: 'points sizing', keepOpen: true, action: () => setSub({ title: 'Set estimate…', build: buildEstimatePage }) },
    { id: 'bulk-cycle', icon: <IconCycle size={14} />, label: 'Add to cycle…', section: 'Bulk actions', hint: '⇧C', keywords: 'cycle sprint', keepOpen: true, action: () => setSub({ title: 'Add to cycle…', build: buildCyclePage }) },
    { id: 'bulk-due', icon: <IconCalendar size={14} />, label: 'Set due date…', section: 'Bulk actions', keywords: 'due date deadline', keepOpen: true, action: () => setSub({ title: 'Set due date…', build: buildDuePage, calendar: true }) },
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

  const selIssues = useMemo(
    () => selIdList.map(id => snap?.issues.find(i => i.id === id)).filter(Boolean) as Issue[],
    [snap, selIdList],
  );

  const items = useMemo<PaletteItem[]>(() => {
    if (!snap) return [];
    const nav: PaletteItem[] = [
      { id: 'nav-inbox', icon: <IconInbox />, label: 'Go to Inbox', section: 'Navigation', hint: 'G I', action: () => navigate('/inbox') },
      { id: 'nav-my', icon: <IconMyIssues />, label: 'Go to My issues', section: 'Navigation', hint: 'G M', action: () => navigate('/my-issues') },
      { id: 'nav-projects', icon: <IconBox />, label: 'Go to Projects', section: 'Navigation', hint: 'G P', action: () => navigate('/projects') },
      { id: 'nav-views', icon: <IconViews />, label: 'Go to Views', section: 'Navigation', hint: 'G V', action: () => navigate('/views') },
      { id: 'nav-settings', icon: <IconSettings />, label: 'Open Settings', section: 'Navigation', action: () => navigate('/settings/workspace') },
      { id: 'nav-set-appearance', icon: <IconSun size={14} />, label: 'Open Appearance settings', section: 'Navigation', action: () => navigate('/settings/appearance') },
      { id: 'nav-set-teams', icon: <IconTeam size={14} />, label: 'Open Teams settings', section: 'Navigation', action: () => navigate('/settings/teams') },
      { id: 'nav-set-labels', icon: <IconTeam size={14} />, label: 'Open Label settings', section: 'Navigation', action: () => navigate('/settings/labels') },
    ];
    const actions: PaletteItem[] = [
      { id: 'act-create', icon: <IconPlus />, label: 'Create new issue', section: 'Actions', hint: 'C', keywords: 'new issue add', action: () => openCreate() },
      { id: 'act-create-project', icon: <IconBox />, label: 'Create new project', section: 'Actions', keywords: 'new project add', action: () => navigate('/projects/new') },
      { id: 'act-theme', icon: document.documentElement.dataset.theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />, label: `Switch to ${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'} theme`, section: 'Actions', keywords: 'dark light appearance toggle', action: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
      { id: 'act-shortcuts', icon: <span className="kbd">?</span>, label: 'Show keyboard shortcuts', section: 'Actions', keywords: 'hotkeys keys', action: () => useApp.getState().setShortcuts(true) },
    ];

    // "Copy as prompt" for the issue currently in view (peek or issue page)
    const peekId = useApp.getState().peekIssueId;
    const pageKey = /^#\/issue\/(.+?)$/.exec(location.hash ?? '')?.[1];
    let current = peekId ? snap.issues.find(i => i.id === peekId) : undefined;
    if (!current && pageKey) {
      const m = /^(.+)-(\d+)$/.exec(pageKey);
      const t = snap.teams.find(x => x.key.toLowerCase() === (m?.[1] ?? '').toLowerCase());
      current = snap.issues.find(i => i.teamId === t?.id && i.number === Number(m?.[2]));
    }
    if (current) {
      const t = snap.teams.find(x => x.id === current.teamId);
      const ck = `${t?.key}-${current.number}`;
      actions.unshift({
        id: 'act-copy-prompt',
        icon: <IconPrompt />,
        label: `Copy as prompt (${ck})`,
        section: 'Actions',
        keywords: 'handoff agent paste cli branch coding',
        action: async () => {
          const { handoff } = await api.getHandoff(current!.id);
          if (await copyText(handoff.prompt)) useApp.getState().toast({ title: `Copied prompt for ${handoff.key}` });
          else useApp.getState().toast({ title: 'Clipboard unavailable', line: <>{handoff.key} — bring the app tab into focus and retry</> });
        },
      });
    }
    for (const t of snap.teams) {
      nav.push({ id: `nav-team-${t.id}`, icon: <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 8, width: 15, height: 15 }}>{t.key.slice(0, 1)}</span>, label: `Go to ${t.name}`, section: 'Navigation', keywords: t.key, action: () => navigate(`/team/${t.key}/all`) });
      nav.push({ id: `nav-team-home-${t.id}`, icon: <IconHome size={14} />, label: `Go to ${t.name} home`, section: 'Navigation', keywords: t.key, action: () => navigate(`/team/${t.key}`) });
      if (snap.cycles.some(c => c.teamId === t.id)) {
        nav.push({ id: `nav-team-cycles-${t.id}`, icon: <IconCycle size={14} />, label: `Go to ${t.name} cycles`, section: 'Navigation', keywords: `${t.key} cycles`, action: () => navigate(`/team/${t.key}/cycles`) });
      }
    }
    const issueItems: PaletteItem[] = snap.issues.map(i => {
      const team = snap.teams.find(t => t.id === i.teamId);
      const state = snap.states.find(s => s.id === i.stateId);
      return {
        id: `issue-${i.id}`,
        icon: state ? <StateIcon type={state.type} color={state.color} size={14} /> : undefined,
        label: `${team?.key}-${i.number} ${i.title}`,
        section: 'Issues',
        keywords: `${i.title} ${team?.key}-${i.number}`,
        action: () => navigate(`/issue/${team?.key}-${i.number}`),
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
    const bulk: PaletteItem[] = selIssues.length ? bulkRootItems(setSub) : [];
    return [...bulk, ...nav, ...actions, ...projectItems, ...viewItems, ...issueItems];
  }, [snap, navigate, openCreate, setTheme, open, selIssues]);

  // sub-page builders read the stores, so rebuilding on snap/selection keeps
  // checkmarks and label states fresh after a toggle
  const subItems = useMemo(() => (sub ? sub.build() : []), [sub, snap, selIssues]);
  const active = useMemo(() => (sub ? subItems : items), [sub, subItems, items]);

  const filtered = useMemo<Array<{ item: PaletteItem; match: { indices: number[] } | null }>>(() => {
    if (!q.trim()) {
      if (sub) return active.map(item => ({ item, match: null }));
      const nonIssues = items.filter(i => i.section !== 'Issues');
      const topIssues = items.filter(i => i.section === 'Issues')
        .sort((a, b) => b.label.localeCompare(a.label)).slice(0, 5);
      return [...nonIssues, ...topIssues].map(item => ({ item, match: null }));
    }
    return active
      .map(i => ({ i, s: scoreItem(q.trim(), i) }))
      .filter(({ s }) => s !== null)
      .sort((a, b) => b.s!.score - a.s!.score)
      .slice(0, 24)
      .map(({ i, s }) => ({ item: i, match: s!.match }));
  }, [active, items, q, sub]);

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
          ? { p: 'bulk-project', e: 'bulk-estimate', c: 'bulk-cycle' }
          : { s: 'bulk-status', p: 'bulk-priority', a: 'bulk-assign', i: 'bulk-unassign', l: 'bulk-labels', e: 'bulk-estimate', c: 'bulk-cycle' };
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

  if (!open) return null;

  const uniformDue = selIssues.length && selIssues.every(i => i.dueDate?.slice(0, 10) === selIssues[0]!.dueDate?.slice(0, 10))
    ? selIssues[0]!.dueDate?.slice(0, 10) : undefined;

  let lastSection = '';
  return (
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
        <span className="pal-hint"><span className="kbd">↑↓</span> navigate <span className="kbd">↵</span> select <span className="kbd">esc</span> {sub ? 'back' : 'dismiss'}</span>
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
            <div
              key={item.id}
              style={{ animation: 'bl-fade-up 260ms cubic-bezier(0.16, 1, 0.3, 1) both', animationDelay: `${Math.min(i, 10) * 26}ms` }}
            >
              {header && <div className="menu-header" style={{ paddingTop: 8 }}><span>{header}</span></div>}
              <button
                className={`menu-item ${i === index ? 'highlighted' : ''} ${item.danger ? 'danger' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => runItem(item)}
              >
                {item.icon && <span className="mi-icon">{item.icon}</span>}
                <span className="mi-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Highlighted text={item.label} indices={match?.indices ?? []} />
                </span>
                <span className="mi-right">
                  {item.checked && <IconCheck size={13} style={{ color: 'var(--brand)' }} />}
                  {item.hint && <span className="kbd">{item.hint}</span>}
                </span>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="menu-header"><span>No results for "{q}"</span></div>}
      </div>
    </Modal>
  );
}

/* ---------------- keyboard shortcuts overlay ---------------- */
export function ShortcutsOverlay() {
  const open = useApp(s => s.shortcutsOpen);
  const setOpen = useApp(s => s.setShortcuts);
  if (!open) return null;
  const groups: Array<[string, Array<[string, string]>]> = [
    ['General', [
      ['⌘K', 'Open command palette'],
      ['?', 'Show keyboard shortcuts'],
      ['C', 'Create new issue'],
      ['/ ', 'Filter issues'],
      ['Esc', 'Close / go back'],
    ]],
    ['Issues', [
      ['J / K', 'Move cursor down / up'],
      ['↵', 'Open issue'],
      ['S / P / A / L', 'Status / priority / assignee / labels menu'],
      ['1 – 5', 'Set status (numbered states)'],
      ['⇧U / ⇧H / ⇧M / ⇧L', 'Set priority none/high/medium/low'],
      ['X', 'Select issue (bulk actions)'],
      ['⌘K', 'Bulk actions when issues are selected'],
      ['E', 'Archive (undo from toast)'],
      ['⌘⌫', 'Delete (undo from toast)'],
    ]],
    ['Navigation', [
      ['G then I', 'Go to Inbox'],
      ['G then M', 'Go to My issues'],
      ['G then P', 'Go to Projects'],
      ['G then V', 'Go to Views'],
      ['G then A', 'Go to All issues'],
    ]],
  ];
  return (
    <Modal onClose={() => setOpen(false)} className="modal" dismissOnBackdrop={false}>
      <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: '72vh' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Keyboard shortcuts</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {groups.map(([name, rows]) => (
            <div key={name}>
              <div className="menu-header" style={{ padding: '0 0 6px', fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>{name}</div>
              {rows.map(([k, d]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', color: 'var(--text-secondary)', gap: 12 }}>
                  <span>{d}</span>
                  <span style={{ display: 'flex', gap: 3, flex: 'none' }}>{k.split(' ').map((x, i) => x === 'then' ? <span key={i} style={{ color: 'var(--text-dim)' }}>then</span> : <span key={i} className="kbd">{x}</span>)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
