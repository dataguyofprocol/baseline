import { create } from 'zustand';
import { flushSync } from 'react-dom';
import { api, ApiError } from './api.js';
import { revealTheme } from './motion.js';
import { notifyCategory, type Snapshot, type Issue, type GettingStarted } from '../../src/core/types.js';
import type { PropKind } from './propertyMenus.js';

export type PaletteScope = 'issue' | 'project' | 'view' | 'document' | 'cycle' | 'label' | 'user' | 'favorite' | 'settings' | 'document-new';
export interface Toast {
  id: number;
  title: string;
  line?: React.ReactNode;
  link?: { label: string; to: string };
  actions?: Array<{ label: string; onClick: () => void | Promise<void> }>;
  autoClose?: boolean;
  onClose?: () => void;
}

interface AppState {
  snap: Snapshot | null;
  loaded: boolean;
  signedOut: boolean;
  theme: ThemePref;
  resolvedTheme: 'dark' | 'light';
  toasts: Toast[];
  paletteOpen: boolean;
  paletteScope: PaletteScope | null;
  sidebarCollapsed: boolean;
  createModal: { open: boolean; expanded?: boolean; copyFrom?: string; teamId?: string; stateId?: string; projectId?: string | null; parentId?: string | null; cycleId?: string | null; title?: string; related?: CreateRelated };
  shortcutsOpen: boolean;
  quickMenu: { issueIds: string[]; kind: PropKind; anchor: DOMRect } | null;
  peekIssueId: string | null;
  setPeek: (id: string | null) => void;
  bootstrap: () => Promise<void>;
  setTheme: (t: ThemePref) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number, viaAction?: boolean) => void;
  holdToast: (id: number, hold: boolean) => void;
  setPalette: (open: boolean, scope?: PaletteScope | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  openCreate: (opts?: { expanded?: boolean; copyFrom?: string; teamId?: string; stateId?: string; projectId?: string | null; parentId?: string | null; cycleId?: string | null; title?: string; related?: CreateRelated }) => void;
  closeCreate: () => void;
  setShortcuts: (open: boolean) => void;
  setQuickMenu: (m: AppState['quickMenu']) => void;
}

export interface CreateRelated { issueId: string; kind: 'parent' | 'blocks' | 'blocked_by' | 'related' }

export type ThemePref = 'system' | 'dark' | 'light';

export function resolveTheme(p: ThemePref): 'dark' | 'light' {
  if (p !== 'system') return p;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

let toastSeq = 1;
const TOAST_MS = 5200;
const toastClocks = new Map<number, { left: number; since: number; timer: ReturnType<typeof setTimeout> | null }>();

const narrowNav = window.matchMedia('(max-width: 760px)');
const savedCollapsed = () => localStorage.getItem('baseline:sidebarCollapsed') === '1';

const storedTheme = localStorage.getItem('baseline:theme');
const initialTheme: ThemePref = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';

export const useApp = create<AppState>((set, get) => ({
  snap: null,
  loaded: false,
  signedOut: false,
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme),
  toasts: [],
  paletteOpen: false,
  paletteScope: null,
  sidebarCollapsed: narrowNav.matches || savedCollapsed(),
  createModal: { open: false },
  shortcutsOpen: false,
  quickMenu: null,
  peekIssueId: null,
  setPeek: (id) => set({ peekIssueId: id }),

  bootstrap: async () => {
    try {
      const snap = await api.bootstrap();
      set({ snap, loaded: true, signedOut: false });
      connectLive();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
  },

  setTheme: (t) => {
    localStorage.setItem('baseline:theme', t);
    const resolved = resolveTheme(t);
    const apply = () => {
      document.documentElement.dataset.theme = resolved;
      set({ theme: t, resolvedTheme: resolved });
    };
    if (resolved === document.documentElement.dataset.theme) apply();
    else revealTheme(() => flushSync(apply));
  },

  toast: (t) => {
    const id = toastSeq++;
    set(s => ({ toasts: [...s.toasts, { ...t, id }] }));
    if (t.autoClose !== false) toastClocks.set(id, { left: TOAST_MS, since: Date.now(), timer: setTimeout(() => get().dismissToast(id), TOAST_MS) });
  },
  dismissToast: (id, viaAction) => {
    const t = get().toasts.find(x => x.id === id);
    const clock = toastClocks.get(id);
    if (clock?.timer) clearTimeout(clock.timer);
    toastClocks.delete(id);
    set(s => ({ toasts: s.toasts.filter(x => x.id !== id) }));
    if (t && !viaAction) t.onClose?.();
  },
  holdToast: (id, hold) => {
    const c = toastClocks.get(id);
    if (!c) return;
    if (hold && c.timer) { clearTimeout(c.timer); c.left -= Date.now() - c.since; c.timer = null; }
    if (!hold && !c.timer) { c.since = Date.now(); c.timer = setTimeout(() => get().dismissToast(id), Math.max(1200, c.left)); }
  },
  setPalette: (open, scope = null) => {
    set({ paletteOpen: open, paletteScope: open ? scope : null });
  },
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

narrowNav.addEventListener('change', (e) => { useApp.setState({ sidebarCollapsed: e.matches || savedCollapsed() }); });

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (useApp.getState().theme !== 'system') return;
  const resolved = e.matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  useApp.setState({ resolvedTheme: resolved });
});

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

export const visibleList: { issues: Issue[]; teamId: string; route: string } = { issues: [], teamId: '', route: '' };
export function registerVisibleList(issues: Issue[], teamId: string) {
  visibleList.issues = issues;
  visibleList.teamId = teamId;
  visibleList.route = location.hash.split('?')[0];
}

export function nameOf(u: { name: string } | null | undefined, fallback = 'Someone'): string {
  if (!u) return fallback;
  return useApp.getState().snap?.workspace.preferences.displayNames === 'first' ? u.name.split(/\s+/)[0] : u.name;
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

/** a calendar date (YYYY-MM-DD) in the viewer's own timezone. toISOString() is UTC, which
 *  names the wrong day in the evening west of UTC and the early morning east of it. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function isoDaysFromToday(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d);
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
export function dateTime(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
}

export const STATUS_ORDER = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const;
export const LIST_GROUP_ORDER = ['started', 'unstarted', 'backlog', 'completed', 'canceled'] as const;

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

export function setGettingStarted(patch: Partial<GettingStarted>): Promise<unknown> {
  const s = useApp.getState().snap;
  if (s) {
    const prefs = s.workspace.preferences;
    useApp.setState({ snap: { ...s, workspace: { ...s.workspace, preferences: { ...prefs, gettingStarted: { ...prefs.gettingStarted, ...patch } } } } });
  }
  return api.updatePreferences({ gettingStarted: patch }).catch(() => {});
}

export async function refresh() {
  await useApp.getState().bootstrap();
}

let lastSnapJson = '';
let seenNotifications: Set<string> | null = null;
function pushBrowser(snap: Snapshot) {
  const ids = new Set(snap.notifications.map(n => n.id));
  const before = seenNotifications;
  seenNotifications = ids;
  const push = snap.workspace.preferences.push;
  if (!before || !push?.browser || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const n of snap.notifications) {
    if (before.has(n.id) || n.readAt || (n.snoozedUntil && n.snoozedUntil > new Date().toISOString())) continue;
    const cat = notifyCategory(n.type, n.body);
    if (!cat || !push.types[cat]) continue;
    const issue = n.issueId ? snap.issues.find(i => i.id === n.issueId) : undefined;
    const key = issue ? `${snap.teams.find(t => t.id === issue.teamId)?.key}-${issue.number}` : '';
    const actor = snap.users.find(u => u.id === n.actorId)?.name;
    const note = new Notification(issue ? `${key} ${issue.title}` : 'Baseline', { body: [actor, n.body].filter(Boolean).join(': ').slice(0, 200), tag: n.id });
    note.onclick = () => { window.focus(); location.hash = issue ? `#/issue/${key}` : '#/inbox'; note.close(); };
  }
}

let fetching = false;
let fetchAgain = false;
let announced: number | null = null;
let applied: number | null = null;
async function refreshSnapshot() {
  if (!useApp.getState().loaded || useApp.getState().signedOut) return;
  if (fetching) { fetchAgain = true; return; }
  fetching = true;
  try {
    const snap = await api.bootstrap();
    pushBrowser(snap);
    const json = JSON.stringify(snap);
    if (json !== lastSnapJson) useApp.setState({ snap });
    lastSnapJson = json;
  } catch { }
  finally {
    fetching = false;
    if (fetchAgain) { fetchAgain = false; void refreshSnapshot(); }
  }
}
function catchUp() {
  const background = document.visibilityState !== 'visible';
  if ((background && !useApp.getState().snap?.workspace.preferences.push?.browser) || announced === applied) return;
  applied = announced;
  void refreshSnapshot();
}
let live: EventSource | null = null;
function connectLive() {
  if (live) return;
  live = new EventSource('/api/events');
  live.addEventListener('version', e => { announced = (JSON.parse((e as MessageEvent).data) as { v: number }).v; catchUp(); });
  live.onerror = () => {
    // a dropped connection reconnects by itself; a refused one (CLOSED, e.g. the session ended)
    // doesn't: ask the API, which shows the sign-in screen on 401, and try again in a while
    if (live?.readyState !== EventSource.CLOSED) return;
    live = null;
    void api.bootstrap().catch(() => {});
    setTimeout(() => { if (!useApp.getState().signedOut) connectLive(); }, 5000);
  };
}
document.addEventListener('visibilitychange', catchUp);
window.addEventListener('baseline:signed-out', () => { useApp.setState({ signedOut: true }); live?.close(); live = null; });
