import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { useApp } from './store.js';
import { ApiError } from './api.js';
import './styles.css';

/* Most click handlers fire `void api.…()` with no catch of their own. Without this, a refused
   save just did nothing and left optimistic UI showing a value that was never stored. Every
   rejection nobody handled lands here: say what happened, then reload the snapshot so the
   screen shows what the server actually has. */
let lastShown = { text: '', at: 0 };
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  if (err instanceof ApiError && err.status === 401) return; // the sign-in screen takes over
  const s = useApp.getState();
  if (!s.snap) return; // still booting: the app shell shows its own error
  const offline = err instanceof TypeError; // fetch() rejects with a TypeError when the server is unreachable
  const line = offline ? 'Baseline isn’t reachable. Check that the server is running, then try again.'
    : err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.';
  // one failure often rejects several chained promises: show it once
  if (line === lastShown.text && Date.now() - lastShown.at < 3000) return;
  lastShown = { text: line, at: Date.now() };
  s.toast({ title: 'That change wasn’t saved', line });
  void s.bootstrap().catch(() => {});
  console.error(err);
});

createRoot(document.getElementById('root')!).render(<App />);
