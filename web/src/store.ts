import { create } from 'zustand';
import { api } from './api.js';
import type { Snapshot, Issue, Priority } from '../../src/core/types.js';

export interface Toast {
  id: number;
  title: string;
  line?: React.ReactNode;
  link?: { label: string; to: string };
  actions?: Array<{ label: string; onClick: () => void | Promise<void> }>;
  autoClose?: boolean;
}

interface AppState {
  snap: Snapshot | null;
  loaded: boolean;
  theme: 'dark' | 'light';
  toasts: Toast[];
  paletteOpen: boolean;
  /** left nav collapsed (⌘B / the nav toggle); persisted across reloads */
  sidebarCollapsed: boolean;
  createModal: { open: boolean; teamId?: string; stateId?: string; projectId?: string | null; parentId?: string | null; cycleId?: string | null; title?: string };
  shortcutsOpen: boolean;
  /** hovered/focused row quick-action menu, e.g. pressing S or P on a row */
  quickMenu: { issueId: string; kind: 'status' | 'priority' | 'assignee' | 'labels'; anchor: DOMRect } | null;
  bootstrap: () => Promise<void>;
  setTheme: (t: 'dark' | 'light') => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setPalette: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  openCreate: (opts?: { teamId?: string; stateId?: string; projectId?: string | null; parentId?: string | null; cycleId?: string | null; title?: string }) => void;
  closeCreate: () => void;
  setShortcuts: (open: boolean) => void;
  setQuickMenu: (m: AppState['quickMenu']) => void;
}

let toastSeq = 1;

export const useApp = create<AppState>((set, get) => ({
  snap: null,
  loaded: false,
  theme: (localStorage.getItem('baseline:theme') as 'dark' | 'light') ?? 'dark',
  toasts: [],
  paletteOpen: false,
  sidebarCollapsed: localStorage.getItem('baseline:sidebarCollapsed') === '1',
  createModal: { open: false },
  shortcutsOpen: false,
  quickMenu: null,

  bootstrap: async () => {
    const snap = await api.bootstrap();
    set({ snap, loaded: true });
  },

  setTheme: (t) => {
    localStorage.setItem('baseline:theme', t);
    document.documentElement.dataset.theme = t;
    set({ theme: t });
  },

  toast: (t) => {
    const id = toastSeq++;
    set(s => ({ toasts: [...s.toasts, { ...t, id }] }));
    if (t.autoClose !== false) setTimeout(() => get().dismissToast(id), 5200);
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })),
  setPalette: (open) => set({ paletteOpen: open }),
  setSidebarCollapsed: (collapsed) => {
    localStorage.setItem('baseline:sidebarCollapsed', collapsed ? '1' : '0');
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  openCreate: (opts = {}) => set({ createModal: { open: true, ...opts } }),
  closeCreate: () => set({ createModal: { open: false } }),
  setShortcuts: (open) => set({ shortcutsOpen: open }),
  setQuickMenu: (m) => set({ quickMenu: m }),
}));

/* ---------- selection (X key / checkboxes) ---------- */
interface SelectionState {
  ids: string[];
  toggle: (id: string) => void;
  setMany: (ids: string[]) => void;
  clear: () => void;
}
export const useSelection = create<SelectionState>((set) => ({
  ids: [],
  toggle: (id) => set(s => ({ ids: s.ids.includes(id) ? s.ids.filter(x => x !== id) : [...s.ids, id] })),
  setMany: (ids) => set({ ids }),
  clear: () => set({ ids: [] }),
}));

/* ---------- list cursor (J/K navigation) ---------- */
interface CursorState {
  index: number;
  move: (delta: number, max: number) => void;
  reset: () => void;
}
export const useCursor = create<CursorState>((set) => ({
  index: -1,
  move: (delta, max) => set(s => ({ index: Math.max(0, Math.min(max - 1, s.index < 0 ? (delta > 0 ? 0 : max - 1) : s.index + delta)) })),
  reset: () => set({ index: -1 }),
}));

/** the mounted list registers its visible issues so global keys act on them */
export const visibleList: { issues: Issue[]; teamId: string } = { issues: [], teamId: '' };
export function registerVisibleList(issues: Issue[], teamId: string) {
  visibleList.issues = issues;
  visibleList.teamId = teamId;
}

/* ---------- derived helpers ---------- */
export function useHelpers() {
  const snap = useApp(s => s.snap)!;
  return {
    stateById: (id: string) => snap.states.find(s => s.id === id),
    statesOf: (teamId: string) => snap.states.filter(s => s.teamId === teamId),
    teamById: (id: string) => snap.teams.find(t => t.id === id),
    teamByKey: (key: string) => snap.teams.find(t => t.key.toLowerCase() === key.toLowerCase()),
    userById: (id: string | null) => (id ? snap.users.find(u => u.id === id) : undefined),
    labelById: (id: string) => snap.labels.find(l => l.id === id),
    projectById: (id: string | null) => (id ? snap.projects.find(p => p.id === id) : undefined),
    cycleById: (id: string | null) => (id ? snap.cycles.find(c => c.id === id) : undefined),
    issueById: (id: string) => snap.issues.find(i => i.id === id),
    keyOf: (issue: Issue) => `${snap.teams.find(t => t.id === issue.teamId)?.key ?? 'ISS'}-${issue.number}`,
    priorityName: (p: Priority) => (['No priority', 'Urgent', 'High', 'Medium', 'Low'] as const)[p],
  };
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const STATUS_ORDER = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const;
/** list view groups started work first, then todo, then backlog (matches reference) */
export const LIST_GROUP_ORDER = ['started', 'unstarted', 'backlog', 'completed', 'canceled'] as const;

/** clipboard write that degrades to a legacy fallback and reports failure instead of throwing */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export async function refresh() {
  await useApp.getState().bootstrap();
}
