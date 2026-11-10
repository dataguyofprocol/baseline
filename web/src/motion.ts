import { useEffect, useRef, useState } from 'react';

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let lastPress = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
window.addEventListener('pointerdown', (e) => { lastPress = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });

export function revealTheme(apply: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || reducedMotion()) { apply(); return; }
  const { x, y } = lastPress;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const vt = doc.startViewTransition(apply);
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  }).catch(() => { });
}

const lastStateById = new Map<string, string>();

const pendingEnter = new Set<string>();
export function markCreated(id: string) { pendingEnter.add(id); }

type Landing = 'new' | 'moved' | null;

export function useLanding(issue: { id: string; stateId: string }, stateType?: string) {
  const [landing, setLanding] = useState<Landing>(() => {
    if (pendingEnter.delete(issue.id)) return 'new';
    const seen = lastStateById.get(issue.id);
    return seen !== undefined && seen !== issue.stateId ? 'moved' : null;
  });
  useEffect(() => {
    const seen = lastStateById.get(issue.id);
    lastStateById.set(issue.id, issue.stateId);
    if (pendingEnter.delete(issue.id)) setLanding('new');
    else if (seen !== undefined && seen !== issue.stateId) setLanding('moved');
  }, [issue.id, issue.stateId]);
  useEffect(() => {
    if (!landing) return;
    const t = setTimeout(() => setLanding(null), 1200);
    return () => clearTimeout(t);
  }, [landing]);
  return {
    justMoved: landing !== null,
    isNew: landing === 'new',
    becameDone: landing === 'moved' && stateType === 'completed',
  };
}

export function playExit(ids: string[]): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const nodes = ids.flatMap(id => [...document.querySelectorAll(`[data-issue-row="${id}"]`)]);
  if (nodes.length === 0) return Promise.resolve();
  for (const n of nodes) n.classList.add('leaving');
  return new Promise(r => setTimeout(r, 260));
}

export function useEarned(now: boolean): boolean {
  const was = useRef(now);
  const [earned, setEarned] = useState(false);
  useEffect(() => {
    if (now && !was.current) setEarned(true);
    else if (!now) setEarned(false);
    was.current = now;
  }, [now]);
  return earned;
}

const lastFracById = new Map<string, number>();

export function useRingClosed(issueId: string | undefined, frac: number): boolean {
  const [closed, setClosed] = useState(() => {
    const seen = issueId ? lastFracById.get(issueId) : undefined;
    return seen !== undefined && seen < 1 && frac === 1;
  });
  useEffect(() => {
    if (!issueId) return;
    const seen = lastFracById.get(issueId);
    lastFracById.set(issueId, frac);
    if (seen !== undefined && seen < 1 && frac === 1) setClosed(true);
  }, [issueId, frac]);
  useEffect(() => {
    if (!closed) return;
    const t = setTimeout(() => setClosed(false), 1100);
    return () => clearTimeout(t);
  }, [closed]);
  return closed;
}

export function shake(el: Element | null | undefined) {
  if (!el || reducedMotion()) return;
  el.animate(
    { transform: ['translateX(0)', 'translateX(-6px)', 'translateX(5px)', 'translateX(-3px)', 'translateX(1px)', 'translateX(0)'] },
    { duration: 320, easing: 'ease-out' },
  );
}
