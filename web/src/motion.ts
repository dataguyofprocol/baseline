import { useEffect, useState } from 'react';

/** the global rule collapses every duration; direct DOM animation has to ask */
export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Last stateId each issue was last rendered with. Module-level so it survives
   the row being remounted into a different group by the reflow — comparing
   against previous props alone would miss exactly the case we animate. */
const lastStateById = new Map<string, string>();

/* Issues created this session that have not yet played their enter animation.
   Filled by api.createIssue, so every creation path (C, palette, modal,
   duplicate, sub-issue) lands the same way. */
const pendingEnter = new Set<string>();
export function markCreated(id: string) { pendingEnter.add(id); }

type Landing = 'new' | 'moved' | null;

/** One landing per change: the row enters (340ms) and flashes brand at 220ms.
    `becameDone` additionally morphs the status icon — fill then check draw. */
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

/** Plays the exit on rows/cards that are about to disappear, then resolves.
    The nodes are animated in place because the next snapshot unmounts them —
    React would drop the element before any exit transition could run. */
export function playExit(ids: string[]): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const nodes = ids.flatMap(id => [...document.querySelectorAll(`[data-issue-row="${id}"]`)]);
  if (nodes.length === 0) return Promise.resolve();
  for (const n of nodes) n.classList.add('leaving');
  return new Promise(r => setTimeout(r, 260));
}
