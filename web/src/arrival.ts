/** The hand-off from a brand screen (sign-in, naming the first team) into the app. The brand screen
 *  plays its exit, marks the arrival and moves on; the app reads the mark once and draws the line
 *  climbing into its top bar (Arrival in App.tsx). Sign-in reloads the page, so the mark is in
 *  sessionStorage; the team screen doesn't, so it also fires an event. */
const KEY = 'bl-arrive';
export const ARRIVE_EVENT = 'bl-arrive';

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function markArrival() {
  try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode: no arrival, nothing else changes */ }
  window.dispatchEvent(new Event(ARRIVE_EVENT));
}

/** true once, right after a brand screen handed over */
export function takeArrival(): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== '1') return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch { return false; }
}
