import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, setGettingStarted } from './store.js';
import { LineFrame } from './SignIn.js';
import { markArrival, reducedMotion } from './arrival.js';
import { setupItems, setupHome } from './SetupPanel.js';

const BRIDGE = 'bl-bridge';
const TOUR = 'bl-tour';
const SETUP_STEP = 'bl-setup-step';
const TOUR_EVENT = 'baseline:tour';

const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { } },
};
const take = (k: string) => { const v = store.get(k); if (v !== null) store.del(k); return v; };

export const markBridge = () => store.set(BRIDGE, '1');
export const clearBridge = () => store.del(BRIDGE);
export const bridgePending = () => store.get(BRIDGE) === '1';
export const takeSetupStep = () => take(SETUP_STEP);
export const startTour = () => window.dispatchEvent(new Event(TOUR_EVENT));

const WHY: Record<string, string> = {
  agent: 'Point your agent at an issue and it does the bookkeeping: starts it, names the branch, posts progress and hands it back for review.',
  invite: 'Assign, mention and triage together. Everyone connects their own agent, and its work shows under their name.',
  github: 'Open a PR, ask for a review, merge. Each one moves its issue, so the board is never out of date.',
  issue: 'Not a test. The thing you’d do next anyway. Then hand it to your agent and watch it move.',
};
const time = (m: number) => m < 1 ? '30 sec' : `${m} min`;
const COUNT = ['No', 'One', 'Two', 'Three', 'Four'];

export function Bridge({ onDone }: { onDone: () => void }) {
  const snap = useApp(s => s.snap)!;
  const team = snap.teams.find(t => t.memberIds.includes(snap.currentUser.id)) ?? snap.teams[0];
  const items = setupItems(snap);
  const [picked, setPicked] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const minutes = Math.max(1, Math.ceil(items.reduce((m, i) => m + i.minutes, 0)));
  const hosted = snap.workspace.auth === 'hosted';

  const go = (then: () => void) => {
    clearBridge();
    then();
    const finish = () => { markArrival(); onDone(); };
    if (reducedMotion()) return finish();
    setLeaving(true);
    window.setTimeout(finish, 520);
  };
  const current = items[picked];

  return (
    <LineFrame
      word={team?.key ?? 'Baseline'} leaving={leaving} at={items.length ? picked / items.length : 0}
      aside={<button type="button" className="auth-link" onClick={() => go(() => {})}>Skip to the issues</button>}
      headline={`${team?.name ?? 'Your team'} is ready`}
      sub={<>{COUNT[items.length] ?? items.length} small step{items.length === 1 ? '' : 's'} get{items.length === 1 ? 's' : ''} you the rest of the way, about {minutes} minute{minutes === 1 ? '' : 's'} in all. Each one is an issue you can do now, skip, or come back to from the sidebar.</>}
      under={
        <div className="auth-wrap bridge-stops" role="list">
          {items.map((it, i) => (
            <button key={it.id} type="button" role="listitem" className={`bridge-stop${i === picked ? ' on' : ''}`} aria-pressed={i === picked}
              style={{ '--d': `${i * 90}ms` } as React.CSSProperties} onClick={() => setPicked(i)}>
              <span className="bridge-meta">SETUP-{i + 1} · {time(it.minutes)}</span>
              <span className="bridge-title">{it.title}</span>
            </button>
          ))}
        </div>
      }
      foot={<><span>Pick any step on the line to start there</span><span>{hosted ? 'Everything here can be changed later in Settings' : 'Everything here stays on this machine'}</span></>}>
      {current && (
        <div className="bridge-pick">
          <span className="bridge-meta">SETUP-{picked + 1} · {time(current.minutes)}</span>
          <span className="bridge-pick-title">{current.title}</span>
          <span className="bridge-pick-why">{WHY[current.id]}</span>
        </div>
      )}
      <div className="auth-actions">
        <button type="button" className="btn primary auth-submit auth-go" autoFocus
          onClick={() => go(() => { if (current) store.set(SETUP_STEP, current.id); })}>
          <span>{picked === 0 ? 'Start setup' : `Start with ${current?.title.toLowerCase() ?? 'setup'}`}</span>
          <svg className="auth-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="btn auth-secondary" onClick={() => go(() => store.set(TOUR, '1'))}>Show me around first</button>
      </div>
    </LineFrame>
  );
}

interface Stop { target: string; title: string; body: string }
const STOPS: Stop[] = [
  { target: '.ob-list', title: 'Setup, in any order', body: 'Each step is here as a row. Do them now, skip any of them, and they stay until they’re done. The help menu brings the group back if you close it.' },
  { target: '.ob-detail', title: 'Each step explains itself', body: 'Pick a step and this side says what it does, with the one thing to click. Skip for now moves to the next.' },
  { target: '.subnav', title: 'Your team’s issues', body: 'Active is what’s moving, Backlog is what’s waiting, All issues is everything. Filters and display options are on the right.' },
  { target: '.sidebar .nav-personal', title: 'Yours, across every team', body: 'My work is what needs you today. Inbox gets assignments, mentions and agents handing work back. My issues is everything assigned to you.' },
  { target: '.ws-new', title: 'Write an issue from anywhere', body: 'This button, or press C on any page. ⌘K finds anything else, and ? opens help, where this tour lives.' },
];

const CARD_W = 340, GAP = 14, PAD = 6;

export function Tour() {
  const navigate = useNavigate();
  const snap = useApp(s => s.snap);
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [at, setAt] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const begin = useCallback((delay: number) => {
    window.setTimeout(() => {
      const here = STOPS.filter(s => document.querySelector(s.target));
      if (here.length) { setStops(here); setAt(0); }
    }, delay);
  }, []);

  useEffect(() => { if (take(TOUR) === '1') begin(1100); }, [begin]);
  useEffect(() => {
    const on = () => {
      if (!snap) return;
      void setGettingStarted({ onboarding: 'pending' });
      navigate(setupHome(snap));
      begin(500);
    };
    window.addEventListener(TOUR_EVENT, on);
    return () => window.removeEventListener(TOUR_EVENT, on);
  }, [snap, navigate, begin]);

  const stop = stops?.[at];
  const measure = useCallback(() => {
    const el = stop && document.querySelector(stop.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [stop]);
  useLayoutEffect(() => {
    if (!stop) return;
    document.querySelector(stop.target)?.scrollIntoView({ block: 'nearest' });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stop, measure]);

  const close = useCallback(() => { setStops(null); setRect(null); }, []);
  const next = () => stops && (at === stops.length - 1 ? close() : setAt(at + 1));
  const back = () => setAt(Math.max(0, at - 1));
  useEffect(() => {
    if (!stops) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  if (!stops || !stop || !rect) return null;
  const n = stops.length;
  const spot = { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };
  const vw = window.innerWidth, vh = window.innerHeight, cardH = 210;
  let left = spot.left, top = spot.top + spot.height + GAP;
  if (top + cardH > vh) top = spot.top - cardH - GAP;
  if (top < 8) { top = Math.min(Math.max(8, spot.top), vh - cardH - 8); left = spot.left + spot.width + GAP; if (left + CARD_W > vw - 8) left = spot.left - CARD_W - GAP; }
  left = Math.min(Math.max(8, left), vw - CARD_W - 8);
  const pct = n > 1 ? (at / (n - 1)) * 100 : 100;

  return (
    <div className="tour" aria-live="polite">
      <div className="tour-catch" onClick={e => e.stopPropagation()} />
      <div className="tour-spot" style={spot} />
      <div className="tour-card" role="dialog" aria-label={`Tour, ${at + 1} of ${n}: ${stop.title}`} style={{ left, top, width: CARD_W }}>
        <div className="tour-progress">
          <div className="tour-line" aria-hidden="true">
            <span className="tour-fill" style={{ width: `${pct}%` }} />
            {stops.map((_, i) => <span key={i} className="tour-tick" style={{ left: `${n > 1 ? (i / (n - 1)) * 100 : 0}%` }} />)}
            <span className="tour-node" style={{ left: `${pct}%` }} />
          </div>
          <span className="tour-count">{at + 1} of {n}</span>
        </div>
        <div key={at} className="tour-body">
          <div className="tour-title">{stop.title}</div>
          <div className="tour-text">{stop.body}</div>
        </div>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={close}>Skip tour</button>
          <span style={{ flex: 1 }} />
          {at > 0 && <button type="button" className="btn secondary sm" onClick={back}>Back</button>}
          <button type="button" className="btn primary sm" autoFocus onClick={next}>{at === n - 1 ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
