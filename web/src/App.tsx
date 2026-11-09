import { Component, useEffect, useRef } from 'react';
import { MotionConfig } from 'framer-motion';
import { HashRouter, Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useApp, useCursor, useSelection, visibleList, copyText } from './store.js';
import { undoLast, setIssueProps, assignToMe, toggleSubscription, toggleFavoriteIssue, archiveIssues, deleteIssues } from './actions.js';
import { sortedStatesOf, type PropKind } from './propertyMenus.js';
import { handoffActions } from './CodingTools.js';
import { noteRoute, neighbour, shortcutTargets, pageIssue, listIssueAtCursor } from './nav.js';
import { PeekPanel } from './IssueDetail.js';
import type { Issue } from '../../src/core/types.js';
import { Sidebar } from './AppShell.js';
import { CreateIssueModal } from './CreateIssueModal.js';
import { CommandPalette, ShortcutsOverlay, recordRecentIssue } from './Palette.js';
import { QuickMenus, SelectionBar } from './IssueViews.js';
import { Toasts, Tooltips } from './ui.js';
import {
  TeamPage, MyIssuesPage, ViewsIndexPage, SavedViewPage, LabelPage, ProfilePage,
} from './Views.js';
import { SettingsLayout } from './Settings.js';
import { TriagePage, ArchivePage, TrashPage, SearchPage } from './TeamPages.js';
import { CycleDetailPage, CyclesPage, CycleAlias } from './Cycles.js';
import { InboxPage } from './Inbox.js';
import { DocumentPage, TeamHomePage } from './Docs.js';
import { TeamsPage, MembersPage, DraftsPage } from './Workspace.js';
import { InitiativesPage, InitiativePage } from './Initiatives.js';
import { ProjectsPage, NewProjectPage, ProjectPage } from './Projects.js';
import { IssuePage } from './IssueDetail.js';
import { Onboarding } from './Onboarding.js';
import { SignIn } from './SignIn.js';
import { Logo } from './Logo.js';
import { reducedMotion } from './motion.js';
import { Illustration } from './illustrations.js';

function keyOfIssue(issue: Issue) {
  return `${useApp.getState().snap?.teams.find(t => t.id === issue.teamId)?.key}-${issue.number}`;
}

function KeyboardManager() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let chord: 'g' | 'm' | 'n' | 'o' | null = null;
    let chordTimer: ReturnType<typeof setTimeout>;
    const startChord = (c: 'g' | 'm' | 'n' | 'o') => { chord = c; clearTimeout(chordTimer); chordTimer = setTimeout(() => { chord = null; }, 1200); };
    const onKey = (e: KeyboardEvent) => {
      if (!e.key || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const s = useApp.getState();
      if (!s.snap) return;
      const k = e.key.toLowerCase();
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;

      // ⌘Z undoes the last change made here (fields keep their own undo)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 'z' && !typing && !s.paletteOpen && !s.createModal.open) {
        e.preventDefault(); void undoLast(); return;
      }

      // everything below is a bare key: skip it while typing or while a modal owns the keyboard
      if (typing || s.paletteOpen || s.createModal.open || s.shortcutsOpen) return;
      if (document.querySelector('.menu:not(.closing)')) return;

      // ⌥V saves the list on screen as a view (issues or projects)
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyV') {
        e.preventDefault();
        const ev = new CustomEvent('baseline:save-view', { cancelable: true });
        window.dispatchEvent(ev);
        if (!ev.defaultPrevented) s.toast({ title: 'Nothing to save', line: 'Open an issue or project list to save it as a view' });
        return;
      }

      const teamKey = /^\/team\/([^/]+)/.exec(location.pathname)?.[1] ?? localStorage.getItem('baseline:issuesTeam') ?? s.snap.teams[0]?.key ?? '';

      // chords: G then … navigates, M then … relates
      if (chord) {
        const c = chord; chord = null; clearTimeout(chordTimer);
        if (c === 'g') {
          const to: Record<string, string> = {
            // Linear's map: A active, E all ("everything"), W upcoming cycle, U views, D drafts
            i: '/inbox', m: '/my-issues', p: '/projects', s: '/settings/workspace', n: '/initiatives', d: '/drafts',
            a: `/team/${teamKey}/active`, e: `/team/${teamKey}/all`, b: `/team/${teamKey}/backlog`,
            t: `/team/${teamKey}/triage`, c: `/team/${teamKey}/cycles`, v: `/team/${teamKey}/cycles/current`, w: `/team/${teamKey}/cycles/upcoming`, u: '/views', x: `/team/${teamKey}/archive`, f: '/search',
          };
          if (to[k]) { e.preventDefault(); navigate(to[k]); }
          return;
        }
        // N then …: create a project / initiative / document / view
        if (c === 'n') {
          const to: Record<string, () => void> = {
            p: () => navigate('/projects/new'),
            i: () => navigate('/initiatives', { state: { create: true } }),
            d: () => s.setPalette(true, 'document-new'),
            v: () => window.dispatchEvent(new CustomEvent('baseline:save-view', { cancelable: true })),
          };
          if (to[k]) { e.preventDefault(); to[k](); }
          return;
        }
        // O then …: open a picker of one kind
        if (c === 'o') {
          const scope = ({ i: 'issue', p: 'project', f: 'favorite', c: 'cycle', l: 'label', u: 'user', v: 'view', d: 'document', s: 'settings' } as const)[k as 'i'];
          if (scope) { e.preventDefault(); s.setPalette(true, scope); }
          return;
        }
        if (c === 'm') {
          const kind = ({ b: 'blocked_by', x: 'blocks', r: 'related', m: 'duplicate' } as Record<string, PropKind>)[k];
          const targets = shortcutTargets();
          if (kind && targets.length) { e.preventDefault(); openQuick(targets, kind); }
          return;
        }
      }
      if (plain && k === 'g' && !e.shiftKey) { startChord('g'); return; }
      if (plain && (k === 'n' || k === 'o') && !e.shiftKey && !pageIssue()) { startChord(k); return; }
      // V: create an issue in the full-screen editor
      if (plain && k === 'v' && !e.shiftKey && !pageIssue() && !useSelection.getState().ids.length) {
        e.preventDefault();
        const team = s.snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
        s.openCreate({ teamId: team?.id, expanded: true });
        return;
      }

      if (plain && k === 'c' && !e.shiftKey) {
        e.preventDefault();
        const team = s.snap.teams.find(t => t.key.toLowerCase() === teamKey.toLowerCase());
        const proj = /^\/projects\/([^/]+)/.exec(location.pathname)?.[1];
        const cyc = /^\/team\/[^/]+\/cycles\/([^/]+)/.exec(location.pathname)?.[1];
        // on the triage page, C files straight into triage
        const triage = /^\/team\/[^/]+\/triage$/.test(location.pathname) ? s.snap.states.find(st => st.teamId === team?.id && st.type === 'triage') : undefined;
        s.openCreate({ teamId: team?.id, ...(proj && proj !== 'new' ? { projectId: proj } : {}), ...(cyc ? { cycleId: cyc } : {}), ...(triage ? { stateId: triage.id } : {}) });
        return;
      }
      // ?: the help menu (shortcuts live behind ⌘/), as in Linear
      if (e.key === '?') { e.preventDefault(); window.dispatchEvent(new CustomEvent('baseline:help-menu')); return; }
      if (plain && (e.key === '/' )) { e.preventDefault(); navigate('/search'); return; }
      if (plain && k === 'f' && !e.shiftKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('baseline:focus-filter')); return; }
      if (plain && e.key === '[') { e.preventDefault(); s.toggleSidebar(); return; }

      // ⌘A selects every row of the list on screen
      if ((e.metaKey || e.ctrlKey) && k === 'a' && !pageIssue() && visibleList.issues.length) {
        e.preventDefault(); useSelection.getState().setMany(visibleList.issues.map(i => i.id)); return;
      }

      const onPage = !!pageIssue();
      // J/K move the list cursor, or on an issue page open the next issue of the list it came from
      if (plain && (k === 'j' || k === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const down = k === 'j' || e.key === 'ArrowDown';
        if (onPage && !s.peekIssueId) {
          const cur = pageIssue()!;
          const nextId = neighbour(cur.id, down ? 1 : -1);
          const next = nextId ? s.snap.issues.find(i => i.id === nextId) : null;
          if (next) { e.preventDefault(); navigate(`/issue/${keyOfIssue(next)}`, { replace: true }); }
          return;
        }
        e.preventDefault();
        useCursor.getState().move(down ? 1 : -1, visibleList.issues.length);
        scrollCursorIntoView();
        if (s.peekIssueId) { const c = listIssueAtCursor(); if (c) s.setPeek(c.id); }
        return;
      }

      if (e.key === 'Escape') {
        if (s.peekIssueId) { s.setPeek(null); return; }
        if (useSelection.getState().ids.length > 0) { useSelection.getState().clear(); return; }
        if (onPage) { navigate(-1); }
        return;
      }

      const targets = shortcutTargets();
      if (!targets.length) return;
      const ids = targets.map(t => t.id);
      const one = targets.length === 1 ? targets[0] : null;

      if (plain && e.key === ' ' && !onPage) {
        e.preventDefault();
        const c = listIssueAtCursor();
        s.setPeek(s.peekIssueId ? null : c?.id ?? null);
        return;
      }
      if (plain && e.key === 'Enter' && !onPage) {
        const c = listIssueAtCursor();
        if (c) { e.preventDefault(); s.setPeek(null); navigate(`/issue/${keyOfIssue(c)}`); }
        return;
      }
      if (plain && !e.shiftKey && k === 'x' && !onPage) { e.preventDefault(); const c = listIssueAtCursor(); if (c) useSelection.getState().toggle(c.id); return; }

      // property menus
      const menuKey: Record<string, PropKind> = e.shiftKey
        ? { d: 'due', e: 'estimate', c: 'cycle', p: 'project', h: 'remind', m: 'milestone' }
        : { s: 'status', p: 'priority', a: 'assignee', l: 'labels' };
      if (!e.metaKey && !e.ctrlKey && !e.altKey && menuKey[k]) { e.preventDefault(); openQuick(targets, menuKey[k]); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'p') { e.preventDefault(); openQuick(targets, 'parent'); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'm' && one) { e.preventDefault(); openQuick(targets, 'team'); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && k === 'o' && one) {
        e.preventDefault(); s.openCreate({ teamId: one.teamId, parentId: one.id, projectId: one.projectId, cycleId: one.cycleId }); return;
      }
      if (plain && !e.shiftKey && k === 'i') { e.preventDefault(); void assignToMe(ids); return; }
      if (plain && !e.shiftKey && k === 'm') { startChord('m'); return; }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && k === 's' && one) { e.preventDefault(); void toggleSubscription(one.id); return; }
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyF' && one) { e.preventDefault(); void toggleFavoriteIssue(one.id); return; }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && k === 'r' && onPage) { e.preventDefault(); window.dispatchEvent(new CustomEvent('baseline:rename-issue')); return; }
      if (plain && !e.shiftKey && k === 'e') { e.preventDefault(); void archiveIssues(ids); if (onPage) navigate(-1); return; }
      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void deleteIssues(ids); if (onPage) navigate(-1); return; }
      // copy chords on list rows (the issue page's toolbar handles its own)
      if ((e.metaKey || e.ctrlKey) && one && !onPage) {
        const h = handoffActions(one);
        if (e.altKey && e.code === 'KeyP') { e.preventDefault(); void h.copyPrompt(); return; }
        if (e.altKey && e.code === 'KeyC') { e.preventDefault(); void h.copyMarkdown(); return; }
        if (e.shiftKey && e.code === 'Period') { e.preventDefault(); void h.copyBranch({ skipStart: e.altKey }); return; }
        if (!e.altKey && e.code === 'Period') { e.preventDefault(); void h.copyId(); return; }
        if (!e.altKey && e.shiftKey && e.code === 'Comma') { e.preventDefault(); void h.copyUrl(); return; }
        if (!e.altKey && e.shiftKey && e.code === 'Quote') { e.preventDefault(); void h.copyTitle(); return; }
      }
      // 1-9: jump straight to the nth status (the status menu's numbers)
      if (plain && /^[1-9]$/.test(e.key) && one) {
        const st = sortedStatesOf(one.teamId).filter(x => x.type !== 'triage')[Number(e.key) - 1];
        if (st) { e.preventDefault(); void setIssueProps(ids, { stateId: st.id }); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, location]);

  // ⌘K / ⌘B, capture phase: they must survive focus inside an input, a TipTap
  // editor, or a modal, where a bubbling listener would never see them.
  useEffect(() => {
    const onChord = (e: KeyboardEvent) => {
      if (!e.key || e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        e.stopPropagation();
        const s = useApp.getState();
        s.setPalette(!s.paletteOpen);
      } else if (e.key === '/') {
        // ⌘/ keyboard shortcuts
        e.preventDefault(); e.stopPropagation();
        const s = useApp.getState(); s.setShortcuts(!s.shortcutsOpen);
      } else if (k === 'c' && e.shiftKey && !document.getSelection()?.toString()) {
        // ⌘⇧C copies the page's URL
        e.preventDefault(); e.stopPropagation();
        void copyText(window.location.href).then(ok => ok && useApp.getState().toast({ title: 'Copied page URL' }));
      } else if (k === 'b' && !e.shiftKey) {
        // Linear: ⌘B flips the current view between list and board
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('baseline:toggle-layout'));
      }
    };
    window.addEventListener('keydown', onChord, true);
    return () => window.removeEventListener('keydown', onChord, true);
  }, []);

  return null;
}

/* Navigation settles instead of hard-cutting: the incoming page rises from 40%
   opacity (never from zero, so it can't flash the canvas or feel like a wait).
   Switching tabs inside one page is quieter still, because the sliding register mark
   already shows that change. */
function RouteSettle() {
  const { pathname } = useLocation();
  const prev = useRef(pathname);
  useEffect(() => {
    const from = prev.current;
    prev.current = pathname;
    noteRoute(pathname);
    const opened = /^\/issue\/([^/]+)$/.exec(pathname)?.[1];
    if (opened) recordRecentIssue(decodeURIComponent(opened).toUpperCase());
    if (from === pathname || reducedMotion()) return;
    const host = document.querySelector<HTMLElement>('.page-host');
    if (!host) return;
    const section = (p: string) => p.split('/').slice(0, 3).join('/');
    const sameSection = section(from) === section(pathname);
    host.animate(
      sameSection
        ? [{ opacity: 0.6 }, { opacity: 1 }]
        : [{ opacity: 0.4, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }],
      { duration: sameSection ? 110 : 170, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }, [pathname]);
  return null;
}

/* A render error takes down one page, not the app: the sidebar, palette and
   shortcuts keep working, and navigating anywhere (the boundary is keyed by
   path) gives the next page a clean start. */
class PageBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page-error">
        <div className="page-error-title">This page hit an error</div>
        <div className="page-error-msg">{this.state.error.message}</div>
        <div className="page-error-actions">
          <button className="btn secondary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn secondary" onClick={() => location.reload()}>Reload app</button>
        </div>
      </div>
    );
  }
}

/* Settings brings its own nav (with "Back to app"), so it takes the sidebar's
   place instead of standing beside it as a second column. */
function ShellSidebar() {
  const { pathname } = useLocation();
  return pathname.startsWith('/settings') ? null : <Sidebar />;
}

function PageHost({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <PageBoundary key={pathname}>{children}</PageBoundary>;
}

/** open a property menu for the targets, anchored at the matching rail property on an
 *  issue page, else at the first target's row, else near the top of the screen */
function openQuick(targets: Issue[], kind: PropKind) {
  const prop = document.querySelector<HTMLElement>(`.peek-panel [data-prop="${kind}"], .issue-page [data-prop="${kind}"]`);
  const row = document.querySelector<HTMLElement>(`[data-issue-row="${targets[0].id}"]`);
  const rect = prop?.getBoundingClientRect() ?? row?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - 120, 120, 0, 0);
  useApp.getState().setQuickMenu({ issueIds: targets.map(t => t.id), kind, anchor: rect });
}

function scrollCursorIntoView() {
  const { index } = useCursor.getState();
  const issue = visibleList.issues[index];
  if (!issue) return;
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-issue-row="${issue.id}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  });
}

/** "/" opens your default home view (Settings › Preferences) */
function InboxRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const s = useApp.getState().snap;
    const home = s?.workspace.preferences.homeView ?? 'inbox';
    const team = localStorage.getItem('baseline:issuesTeam') ?? s?.teams[0]?.key;
    navigate(home === 'my-issues' ? '/my-issues' : home === 'team' && team ? `/team/${team}/all` : '/inbox', { replace: true });
  }, [navigate]);
  return null;
}

/** an address that leads nowhere, as Linear words it */
function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="content"><div className="empty-state">
      <Illustration name="search" />
      <div className="empty-title">Not found</div>
      <div className="empty-desc">We could not find the page you were looking for</div>
      <div className="empty-actions"><button className="btn secondary" onClick={() => navigate('/inbox')}>Go to inbox</button></div>
    </div></div>
  );
}

export function App() {
  const loaded = useApp(s => s.loaded);
  const signedOut = useApp(s => s.signedOut);
  const bootstrap = useApp(s => s.bootstrap);
  const resolvedTheme = useApp(s => s.resolvedTheme);
  // a new workspace (or one with no teams left) runs the first-run flow before any route
  const onboarding = useApp(s => !!s.snap && (!s.snap.teams.length || s.snap.workspace.preferences.gettingStarted.onboarding === 'pending'));

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    void bootstrap();
  }, []); // eslint-disable-line
  // Preferences › Font size and Use pointer cursors apply to the whole app
  const fontSize = useApp(s => s.snap?.workspace.preferences.fontSize ?? 'default');
  const pointer = useApp(s => !!s.snap?.workspace.preferences.pointerCursors);
  const underline = useApp(s => !!s.snap?.workspace.preferences.underlineLinks);
  useEffect(() => { document.documentElement.dataset.fontSize = fontSize; document.documentElement.classList.toggle('pointer-cursors', pointer); document.documentElement.classList.toggle('underline-links', underline); }, [fontSize, pointer, underline]);

  if (signedOut) return <SignIn />;

  if (!loaded) {
    // Boot: the app appears as an object here, so it shows the tile in the large cut at 28,
    // above a 2px paper rule that animates during the wait. The tile's own register line,
    // hairline and node never animate; only the rule beneath it does.
    return (
      <div className="boot">
        <Logo size={28} />
        <div className="boot-rule"><span /></div>
      </div>
    );
  }

  if (onboarding) {
    return <Onboarding />;
  }

  return (
    <MotionConfig reducedMotion="user">
    <HashRouter>
      <KeyboardManager />
      <RouteSettle />
      <div className="app">
        <ShellSidebar />
        <div className="main">
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div className="page-host">
              <PageHost>
              <Routes>
                <Route path="/" element={<InboxRedirect />} />
                <Route path="/inbox" element={<InboxPage />} />
                <Route path="/my-issues" element={<MyIssuesPage />} />
                <Route path="/my-issues/:tab" element={<MyIssuesPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/new" element={<NewProjectPage />} />
                <Route path="/projects/:projectId" element={<ProjectPage />} />
                <Route path="/projects/:projectId/:tab" element={<ProjectPage />} />
                <Route path="/team/:teamKey/projects" element={<ProjectsPage />} />
                <Route path="/team/:teamKey/views" element={<ViewsIndexPage />} />
                <Route path="/team/:teamKey/views/projects" element={<ViewsIndexPage kind="projects" />} />
                <Route path="/views" element={<ViewsIndexPage />} />
                <Route path="/views/projects" element={<ViewsIndexPage kind="projects" />} />
                <Route path="/views/:viewId" element={<SavedViewPage />} />
                <Route path="/docs/:docId" element={<DocumentPage />} />
                <Route path="/initiatives" element={<InitiativesPage />} />
                <Route path="/initiatives/view/:tab" element={<InitiativesPage />} />
                <Route path="/initiatives/:initiativeId" element={<InitiativePage />} />
                <Route path="/initiatives/:initiativeId/:tab" element={<InitiativePage />} />
                <Route path="/teams" element={<TeamsPage />} />
                <Route path="/members" element={<MembersPage />} />
                <Route path="/drafts" element={<DraftsPage />} />
                <Route path="/labels/:labelId" element={<LabelPage />} />
                <Route path="/profiles/:userId" element={<ProfilePage />} />
                <Route path="/profiles/:userId/:tab" element={<ProfilePage />} />
                <Route path="/team/:teamKey/overview" element={<TeamHomePage />} />
                <Route path="/team/:teamKey/overview/:tab" element={<TeamHomePage />} />
                <Route path="/team/:teamKey" element={<TeamPage />} />
                <Route path="/team/:teamKey/:filter" element={<TeamPage />} />
                <Route path="/team/:teamKey/cycles" element={<CyclesPage />} />
                <Route path="/team/:teamKey/cycles/current" element={<CycleAlias which="current" />} />
                <Route path="/team/:teamKey/cycles/upcoming" element={<CycleAlias which="upcoming" />} />
                <Route path="/team/:teamKey/cycles/:cycleId" element={<CycleDetailPage />} />
                <Route path="/team/:teamKey/triage" element={<TriagePage />} />
                <Route path="/team/:teamKey/archive" element={<ArchivePage />} />
                <Route path="/trash" element={<TrashPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/issue/:issueKey" element={<IssuePageRoute />} />
                <Route path="/settings/team/:teamKey" element={<SettingsLayout />} />
                <Route path="/settings/team/:teamKey/:page" element={<SettingsLayout />} />
                <Route path="/settings/:section/:sub" element={<SettingsLayout />} />
                <Route path="/settings/:section" element={<SettingsLayout />} />
                <Route path="/settings" element={<SettingsLayout />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
              </PageHost>
            </div>
          </div>
        </div>
      </div>
      <CreateIssueModal />
      <CommandPalette />
      <QuickMenus />
      <PeekPanel />
      <SelectionBar />
      <ShortcutsOverlay />
      <Toasts />
      <Tooltips />
    </HashRouter>
    </MotionConfig>
  );
}

function IssuePageRoute() {
  const { issueKey = '' } = useParams();
  return <IssuePage issueKey={issueKey} />;
}
