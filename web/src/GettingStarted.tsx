import { useNavigate } from 'react-router-dom';
import { useApp, setGettingStarted } from './store.js';
import { MenuItem, MenuSep, MenuSub } from './ui.js';

/* The help menu's Getting started checklist: the four things that make Baseline click. Issues
   and projects count when you made them after the first-run flow ended (the sample data
   doesn't tick them); GitHub is the integration switch; ⌘K is the first time the palette opened. */
export function useGettingStarted() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const gs = snap.workspace.preferences.gettingStarted;
  const since = gs.since ?? snap.workspace.createdAt;
  const me = snap.currentUser.id;
  const items = [
    { id: 'issue', label: 'Create your first issue', done: snap.issues.some(i => i.creatorId === me && i.createdAt > since), run: () => useApp.getState().openCreate() },
    { id: 'project', label: 'Create a project', done: snap.projects.some(p => p.createdAt > since), run: () => navigate('/projects/new') },
    { id: 'github', label: 'Connect GitHub', done: snap.workspace.features.githubEnabled, run: () => navigate('/settings/github') },
    { id: 'palette', label: 'Open the command menu', hint: '⌘K', done: gs.usedPalette, run: () => useApp.getState().setPalette(true) },
  ];
  return { items, done: items.filter(i => i.done).length, dismissed: !!gs.dismissed };
}

/** a ring that fills as the checklist does */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 5.5; const c = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r={r} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
      <circle cx="7.5" cy="7.5" r={r} fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round"
        strokeDasharray={`${(c * done) / total} ${c}`} transform="rotate(-90 7.5 7.5)" />
    </svg>
  );
}

function CheckCircle({ done }: { done: boolean }) {
  return done
    ? <svg width="14" height="14" viewBox="0 0 15 15" aria-label="Done"><circle cx="7.5" cy="7.5" r="6" fill="var(--brand)" /><path d="m4.8 7.7 1.9 1.9 3.6-4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg width="14" height="14" viewBox="0 0 15 15" aria-label="Not done"><circle cx="7.5" cy="7.5" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 1.8" /></svg>;
}

export function GettingStartedMenu() {
  const { items, done, dismissed } = useGettingStarted();
  if (dismissed) return null;
  return (
    <>
      <MenuSub icon={<ProgressRing done={done} total={items.length} />} label="Getting started" right={<span className="mi-kbd">{done}/{items.length}</span>} width={250}>
        <div className="menu-header"><span>{done === items.length ? 'All done — nice work' : `${done} of ${items.length} done`}</span></div>
        {items.map(i => (
          <MenuItem key={i.id} icon={<CheckCircle done={i.done} />} label={<span className={i.done ? 'gs-done' : undefined}>{i.label}</span>}
            right={i.hint && <span className="mi-kbd">{i.hint}</span>} onClick={i.run} />
        ))}
        <MenuSep />
        <MenuItem label={<span className="gs-hide">Hide checklist</span>} onClick={() => void setGettingStarted({ dismissed: true })} />
      </MenuSub>
      <MenuSep />
    </>
  );
}
