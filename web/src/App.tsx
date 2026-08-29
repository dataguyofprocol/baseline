import { useEffect } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useApp, useCursor, useSelection, visibleList } from './store.js';
import { api } from './api.js';
import { Sidebar } from './AppShell.js';
import { CreateIssueModal } from './CreateIssueModal.js';
import { IssuePeek } from './IssueDetail.js';
import { CommandPalette, ShortcutsOverlay } from './Palette.js';
import { QuickMenus, BulkBar } from './IssueViews.js';
import { Toasts } from './ui.js';
import {
  TeamPage, ProjectsPage, NewProjectPage, ProjectPage, InboxPage, MyIssuesPage, ViewsIndexPage, SavedViewPage, CyclesPage,
} from './Views.js';
import { SettingsLayout } from './Settings.js';
import { IssuePage } from './IssueDetail.js';

function KeyboardManager() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout>;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const s = useApp.getState();
      const team = s.snap?.teams[0]?.key ?? '';

      if (typing) return;

      // global shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); s.setPalette(!s.paletteOpen); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); document.querySelector('.sidebar')?.toggleAttribute('hidden'); return; }

      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); s.openCreate(); return; }
      if (e.key === '?') { e.preventDefault(); s.setShortcuts(true); return; }
      if (e.key === '/') { e.preventDefault(); window.dispatchEvent(new CustomEvent('baseline:focus-filter')); return; }
      if (e.key.toLowerCase() === 'g' && !gPending) {
        gPending = true;
        gTimer = setTimeout(() => { gPending = false; }, 1200);
        return;
      }
      if (gPending) {
        clearTimeout(gTimer);
        gPending = false;
        const k = e.key.toLowerCase();
        if (k === 'i') { e.preventDefault(); navigate('/inbox'); return; }
        if (k === 'm') { e.preventDefault(); navigate('/my-issues'); return; }
        if (k === 'p') { e.preventDefault(); navigate('/projects'); return; }
        if (k === 'v') { e.preventDefault(); navigate('/views'); return; }
        if (k === 'a') { e.preventDefault(); navigate(`/team/${team}/all`); return; }
      }

      // issue-list shortcuts (act on the hovered/focused/cursored row)
      const issue = listIssueAtCursor();
      if (issue) {
        if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); useCursor.getState().move(1, visibleList.issues.length); scrollCursorIntoView(); return; }
        if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); useCursor.getState().move(-1, visibleList.issues.length); scrollCursorIntoView(); return; }
        if (e.key === 'x') { e.preventDefault(); useSelection.getState().toggle(issue.id); return; }
        if (e.key === 'Enter') { e.preventDefault(); s.setPeek(issue.id); return; }
        if (e.key === 's') { e.preventDefault(); setQuickMenuFor(issue.id, 'status'); return; }
        if (e.key === 'p') { e.preventDefault(); setQuickMenuFor(issue.id, 'priority'); return; }
        if (e.key === 'a') { e.preventDefault(); setQuickMenuFor(issue.id, 'assignee'); return; }
        if (e.key === 'l') { e.preventDefault(); setQuickMenuFor(issue.id, 'labels'); return; }
        if (e.key === 'e') {
          e.preventDefault();
          void (async () => {
            const t2 = s.snap?.teams.find(t => t.id === issue.teamId);
            const key = `${t2?.key}-${issue.number}`;
            await api.archiveIssue(issue.id);
            await s.bootstrap();
            s.toast({
              title: 'Issue archived', line: <>{key} — {issue.title}</>,
              actions: [{ label: 'Undo', onClick: async () => { await api.unarchiveIssue(issue.id); await useApp.getState().bootstrap(); } }],
            });
          })();
          return;
        }
        if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void (async () => {
            const t2 = s.snap?.teams.find(t => t.id === issue.teamId);
            const key = `${t2?.key}-${issue.number}`;
            await api.deleteIssue(issue.id);
            await s.bootstrap();
            s.toast({
              title: 'Issue deleted', line: <>{key} — {issue.title}</>,
              actions: [{ label: 'Undo', onClick: async () => { await api.restoreIssue(issue.id); await useApp.getState().bootstrap(); } }],
            });
          })();
          return;
        }
        // 1-5: set status via the team's workflow states (Linear-style numbered menu keys)
        if (['1', '2', '3', '4', '5'].includes(e.key)) {
          const states = s.snap!.states.filter(st => st.teamId === issue.teamId)
            .sort((x, y) => x.position - y.position);
          const st = states[Number(e.key) - 1];
          if (st) {
            e.preventDefault();
            void (async () => { await api.updateIssue(issue.id, { stateId: st.id }); await useApp.getState().bootstrap(); })();
          }
          return;
        }
        // shift+1..4: set priority (0=none … 4=low) using u/m/l/h style fallback
        if (e.shiftKey && ['u', 'h', 'm', 'l'].includes(e.key.toLowerCase())) {
          const map: Record<string, number> = { u: 1, h: 2, m: 3, l: 4 };
          e.preventDefault();
          const p = map[e.key.toLowerCase()];
          void (async () => { await api.updateIssue(issue.id, { priority: p }); await useApp.getState().bootstrap(); })();
          return;
        }
        if (e.shiftKey && e.key.toLowerCase() === 'u') {
          e.preventDefault();
          void (async () => { await api.updateIssue(issue.id, { priority: 0 }); await useApp.getState().bootstrap(); })();
          return;
        }
      } else {
        if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); useCursor.getState().move(1, visibleList.issues.length); scrollCursorIntoView(); return; }
        if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); useCursor.getState().move(-1, visibleList.issues.length); scrollCursorIntoView(); return; }
      }

      if (useSelection.getState().ids.length > 0 && e.key === 'Escape') {
        useSelection.getState().clear();
        return;
      }
      if (e.key === 'Escape') {
        if (s.peekIssueId) s.setPeek(null);
        else if (location.pathname !== '/') navigate(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, location]);

  return null;
}

function listIssueAtCursor() {
  const { index } = useCursor.getState();
  if (index < 0 || index >= visibleList.issues.length) return null;
  return visibleList.issues[index] ?? null;
}

function setQuickMenuFor(issueId: string, kind: 'status' | 'priority' | 'assignee' | 'labels') {
  // anchor the menu near the first visible row element for the issue
  const el = document.querySelector(`[data-issue-row="${issueId}"]`) as HTMLElement | null;
  const rect = el?.getBoundingClientRect() ?? new DOMRect(200, 140, 0, 0);
  useApp.getState().setQuickMenu({ issueId, kind, anchor: rect });
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

function InboxRedirect() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/inbox', { replace: true }); }, [navigate]);
  return null;
}

export function App() {
  const loaded = useApp(s => s.loaded);
  const bootstrap = useApp(s => s.bootstrap);
  const theme = useApp(s => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    void bootstrap();
  }, []); // eslint-disable-line

  if (!loaded) {
    return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>Loading workspace…</div>;
  }

  return (
    <HashRouter>
      <KeyboardManager />
      <div className="app">
        <Sidebar />
        <div className="main">
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div className="page-host">
              <Routes>
                <Route path="/" element={<InboxRedirect />} />
                <Route path="/inbox" element={<InboxPage />} />
                <Route path="/my-issues" element={<MyIssuesPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/new" element={<NewProjectPage />} />
                <Route path="/projects/:projectId" element={<ProjectPage />} />
                <Route path="/views" element={<ViewsIndexPage />} />
                <Route path="/views/:viewId" element={<SavedViewPage />} />
                <Route path="/team/:teamKey" element={<TeamPage />} />
                <Route path="/team/:teamKey/:filter" element={<TeamPage />} />
                <Route path="/team/:teamKey/cycles" element={<CyclesPage />} />
                <Route path="/issue/:issueKey" element={<IssuePageRoute />} />
                <Route path="/settings/:section" element={<SettingsLayout />} />
                <Route path="/settings" element={<SettingsLayout />} />
              </Routes>
            </div>
            <IssuePeek />
          </div>
        </div>
      </div>
      <CreateIssueModal />
      <CommandPalette />
      <QuickMenus />
      <BulkBar />
      <ShortcutsOverlay />
      <Toasts />
    </HashRouter>
  );
}

function IssuePageRoute() {
  const { issueKey = '' } = useParams();
  return <IssuePage issueKey={issueKey} />;
}
