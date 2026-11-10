import { createElement, Fragment } from 'react';
import { useApp } from './store.js';

const KEY = 'baseline:tips';
const AFTER = 3;

let lastInput: 'pointer' | 'key' = 'pointer';
window.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, { capture: true, passive: true });
window.addEventListener('keydown', e => { if (!e.repeat) lastInput = 'key'; }, { capture: true, passive: true });

type Store = Record<string, number | 'shown'>;
const read = (): Store => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store; } catch { return {}; } };
const write = (s: Store) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { } };

export function nudgeShortcut(id: string, keys: string, what: string) {
  if (lastInput !== 'pointer') return;
  const s = read();
  const seen = s[id];
  if (seen === 'shown') return;
  const n = (typeof seen === 'number' ? seen : 0) + 1;
  if (n < AFTER) { write({ ...s, [id]: n }); return; }
  write({ ...s, [id]: 'shown' });
  const caps = keys.split(' ').flatMap((chord, i) => {
    const parts = chord.match(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g) ?? [chord];
    const kbds = parts.map((p, j) => createElement('span', { key: `${i}-${j}`, className: 'kbd' }, p));
    return i === 0 ? kbds : [createElement('span', { key: `t${i}`, className: 'tip-then' }, 'then'), ...kbds];
  });
  setTimeout(() => {
    useApp.getState().toast({
      title: 'Faster with the keyboard',
      line: createElement(Fragment, null, 'Press ', createElement('span', { className: 'tip-keys' }, caps), ` to ${what}.`),
    });
  }, 500);
}
