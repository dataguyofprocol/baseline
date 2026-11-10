const KEY = 'bl-arrive';
export const ARRIVE_EVENT = 'bl-arrive';

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function markArrival() {
  try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode: no arrival, nothing else changes */ }
  window.dispatchEvent(new Event(ARRIVE_EVENT));
}

export function takeArrival(): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== '1') return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch { return false; }
}
