import { create } from 'zustand';
import { flushSync } from 'react-dom';
import { api, ApiError } from './api.js';
import { revealTheme } from './motion.js';
import { notifyCategory, type Snapshot, type Issue, type Priority, type GettingStarted } from '../../src/core/types.js';
import type { PropKind } from './propertyMenus.js';

export type PaletteScope = 'issue' | 'project' | 'view' | 'document' | 'cycle' | 'label' | 'user' | 'favorite' | 'settings' | 'document-new';
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
  /** hosted mode: the server answered 401, so show the sign-in screen instead of the app */
  signedOut: boolean;
  theme: ThemePref;
  /** theme with 'system' resolved to the dark/light actually applied */
  resolvedTheme: 'dark' | 'light';
  toasts: Toast[];
  paletteOpen: boolean;
  /** O then …: the palette opens as a picker of one kind (issue, project, view…) */
  paletteScope: PaletteScope | null;
  /** left nav collapsed (⌘B / the nav toggle); persisted across reloads */
  sidebarCollapsed: boolean;
  createModal: { open: boolean; expanded?: boolean; copyFrom?: string; teamId?: string; stateId?: string; projectId?: string | null; parentId?: string | null; cycleId?: string | null; title?: string; related?: CreateRelated };
  shortcutsOpen: boolean;
  /** hovered/focused row quick-action menu, e.g. pressing S or P on a row */
  quickMenu: { issueIds: string[]; kind: PropKind; anchor: DOMRect } | null;
  /** the issue showing in the peek panel (Space on a row) */
  peekIssueId: string | null;
  setPeek: (id: string | null) => void;
  bootstrap: () => Promise<void>;
  setTheme: (t: ThemePref) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setPalette: (open: boolean, scope?: PaletteScope | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  openCreate: (opts?: { expanded?: boolean; copyFrom?: string; teamId?: string; stateId?: string; projectId?: string | null; parentId?: string | null; cycleId?: string | null; title?: string; related?: CreateRelated }) => void;
  closeCreate: () => void;
  setShortcuts: (open: boolean) => void;
  setQuickMenu: (m: AppState['quickMenu']) => void;
}

/** "Create related": the new issue becomes this issue's parent, or blocks / is blocked by it */
export interface CreateRelated { issueId: string; kind: 'parent' | 'blocks' | 'blocked_by' | 'related' }

/** theme preference; 'system' tracks the browser's prefers-color-scheme */
export type ThemePref = 'system' | 'dark' | 'light';

export function resolveTheme(p: ThemePref): 'dark' | 'light' {
  if (p !== 'system') return p;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

let toastSeq = 1;

/** a narrow window hides the nav on its own (the saved preference is left alone) so the page keeps its room */
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
      // a 401 already flipped signedOut (see the listener below); anything else is a real failure
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
    if (t.autoClose !== false) setTimeout(() => get().dismissToast(id), 5200);
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })),
  setPalette: (open, scope = null) => {
    set({ paletteOpen: open, paletteScope: open ? scope : null });
    if (open && get().snap?.workspace.preferences.gettingStarted.usedPalette === false) setGettingStarted({ usedPalette: true });
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

// while the preference is 'system', follow the OS/browser appearance live;
// e.matches is that change's own verdict, so no re-query race
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (useApp.getState().theme !== 'system') return;
  const resolved = e.matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  useApp.setState({ resolvedTheme: resolved });
});

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
/** the list on screen; `route` is the page that registered it, so a list left behind
    (e.g. after opening a project page) can't be acted on by issue shortcuts */
export const visibleList: { issues: Issue[]; teamId: string; route: string } = { issues: [], teamId: '', route: '' };
export function registerVisibleList(issues: Issue[], teamId: string) {
  visibleList.issues = issues;
  visibleList.teamId = teamId;
  visibleList.route = location.hash.split('?')[0];
}

/** a person's name as Preferences › Display names asks for it */
export function nameOf(u: { name: string } | null | undefined, fallback = 'Someone'): string {
  if (!u) return fallback;
  return useApp.getState().snap?.workspace.preferences.displayNames === 'first' ? u.name.split(/\s+/)[0] : u.name;
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

/** first-run progress and the Getting started checklist: applied here at once, saved behind */
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

// Live updates. The server announces a new version whenever anything changes, whether from a
// teammate, an agent writing through the CLI or the workspace's own clock. The tab refetches its
// snapshot and swaps it in only when something it shows has changed. A hidden tab waits until it's seen
// (unless browser notifications are on).
let lastSnapJson = '';
/* Settings › Notifications › Browser: new inbox notifications become browser notifications
   (the kinds you chose), also while the tab is in the background */
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
  } catch { /* the server is restarting; the next announcement retries */ }
  finally {
    fetching = false;
    if (fetchAgain) { fetchAgain = false; void refreshSnapshot(); }
  }
}
function catchUp() {
  // a hidden tab waits, unless it has browser notifications to show
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
// any API call that comes back 401 (an expired or revoked session) drops to the sign-in screen
window.addEventListener('baseline:signed-out', () => { useApp.setState({ signedOut: true }); live?.close(); live = null; });
