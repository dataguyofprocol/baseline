import { useEffect, useLayoutEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { IconClose, IconCheck, IconChevronRight } from './icons.js';
import { reducedMotion } from './motion.js';
import { EmptyState } from './EmptyState.js';

/* ---------------- dropdown menu ---------------- */
export interface MenuCtx {
  close: () => void;
  registerItem: (el: HTMLButtonElement | null) => void;
}
export const MenuContext = createContext<MenuCtx>({ close: () => {}, registerItem: () => {} });

export function Menu(props: {
  anchor: DOMRect;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  /* Close plays a 100ms fade before the owner unmounts us. The chosen item's
     action has already fired by then, so nothing waits on the animation. */
  const close = useCallback(() => {
    setClosing(c => {
      if (!c) {
        if (reducedMotion()) queueMicrotask(() => onCloseRef.current());
        else setTimeout(() => onCloseRef.current(), 100);
      }
      return true;
    });
  }, []);

  // Items are read from the DOM, so filtered lists and raw .menu-item buttons
  // (multi-select pickers) navigate the same way as MenuItem.
  const itemEls = () => [...(ref.current?.querySelectorAll<HTMLElement>('.menu-item') ?? [])];

  useEffect(() => {
    if (closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); return; }
      const els = itemEls();
      // handled keys stop here, because the list behind an open menu must not also
      // move its J/K cursor or open the row under it
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setIndex(i => (i + 1) % Math.max(els.length, 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setIndex(i => (i - 1 + els.length) % Math.max(els.length, 1)); }
      // a digit cap in an item's right slot (priority 0-4, status 1-n) is a real shortcut,
      // even from an empty filter field (a filter with text in it takes the digit as text)
      const target = e.target as HTMLElement | null;
      const inFilter = !!target?.closest?.('.menu-filter');
      const emptyFilter = inFilter && !(target as HTMLInputElement).value;
      if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && (emptyFilter || !target?.closest?.('input, textarea'))) {
        const hit = els.find(el => el.querySelector('.mi-right .kbd')?.textContent === e.key);
        if (hit) { e.preventDefault(); e.stopPropagation(); hit.click(); return; }
      }
      const pick = els[Math.min(index, els.length - 1)];
      if (e.key === 'Enter' && pick && (inFilter || !target?.closest?.('.menu-input'))) {
        e.preventDefault(); e.stopPropagation(); pick.click();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, closing, close]);

  // open on the current value (the ticked row), not the first one: ↵ keeps it, ↑/↓ move from it
  useLayoutEffect(() => {
    const at = itemEls().findIndex(el => el.classList.contains('is-selected'));
    if (at > 0) setIndex(at);
  }, []);

  // the highlight is the single source of truth for both mouse and keyboard
  useLayoutEffect(() => {
    const els = itemEls();
    const i = Math.min(index, els.length - 1);
    els.forEach((el, n) => el.classList.toggle('highlighted', n === i));
    if (i >= 0) els[i]?.scrollIntoView({ block: 'nearest' });
  });

  // moving to another page closes whatever menu was open
  useEffect(() => {
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, [close]);

  // typing in a filter field re-ranks the list: the highlight goes back to the top match
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onInput = () => setIndex(0);
    el.addEventListener('input', onInput);
    return () => el.removeEventListener('input', onInput);
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest?.('.menu-item');
    if (!el) return;
    const i = itemEls().indexOf(el as HTMLElement);
    if (i >= 0 && i !== index) setIndex(i);
  };

  const place = () => {
    const a = props.anchor;
    const w = props.width ?? 224;
    const h = ref.current?.offsetHeight ?? 200;
    let x = a.left;
    let y = a.bottom + 6;
    let flipped = false;
    let maxHeight: number | undefined;
    // a point (right-click): open there, shifted up or left just enough to fit whole
    if (a.width === 0 && a.height === 0) {
      const px = a.left + w > window.innerWidth - 12 ? Math.max(12, a.left - w) : a.left;
      const py = Math.max(12, Math.min(a.top, window.innerHeight - h - 12));
      return { left: px, top: py, width: w, ...(h > window.innerHeight - 24 ? { maxHeight: window.innerHeight - 24 } : {}), '--menu-dy': '-4px', transformOrigin: '0 0' };
    }
    const below = window.innerHeight - 12 - y, above = a.top - 6 - 12;
    // as in Linear: below the trigger when it fits; above when only that fits;
    // otherwise on the roomier side, cut to fit and scrolling (never over the trigger)
    if (h > below) {
      if (h <= above) { y = a.top - h - 6; flipped = true; }
      else if (above > below) { maxHeight = above; y = 12; flipped = true; }
      else maxHeight = below;
    }
    if (x + w > window.innerWidth - 12) x = window.innerWidth - w - 12;
    return { left: x, top: y, width: w, ...(maxHeight ? { maxHeight } : {}), '--menu-dy': flipped ? '4px' : '-4px', transformOrigin: `${Math.max(12, a.left + Math.min(a.width, 40) / 2 - x)}px ${flipped ? '100%' : '0'}` };
  };
  const [pos, setPos] = useState<React.CSSProperties>(place);
  useLayoutEffect(() => { setPos(place()); }, []);

  return createPortal(
    <>
      {!closing && <div className="menu-backdrop" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />}
      <div className={`menu${closing ? ' closing' : ''}`} ref={ref} role="menu" style={pos} onPointerMove={onPointerMove}>
        <MenuContext.Provider value={{ close, registerItem: () => {} }}>
          {props.children}
        </MenuContext.Provider>
      </div>
    </>,
    document.body,
  );
}

export function MenuItem(props: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  right?: React.ReactNode;
  selected?: boolean;
  danger?: boolean;
  /** destructive rows: the first press swaps the label for this consequence and keeps the
   *  menu open; a second press within 3s runs it (the ConfirmButton pattern, inside a menu) */
  confirm?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  sectionHeader?: string;
}) {
  const { close } = useContext(MenuContext);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <>
      {props.sectionHeader && <div className="menu-header"><span>{props.sectionHeader}</span></div>}
      <button
        className={`menu-item${props.danger ? ' danger' : ''}${armed ? ' armed' : ''}${props.selected ? ' is-selected' : ''}`}
        role={props.selected !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={props.selected !== undefined ? props.selected : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (props.confirm && !armed) { setArmed(true); return; }
          props.onClick?.(e); close();
        }}
      >
        {props.icon && <span className="mi-icon">{props.icon}</span>}
        <span className="mi-label">{armed ? props.confirm : props.label}</span>
        <span className="mi-right">
          {!armed && props.right}
          {props.selected && <IconCheck size={13} />}
        </span>
      </button>
    </>
  );
}

/* A menu row that opens a flyout beside the menu on hover or click. The flyout
   portals to body (the parent menu scrolls, so it would clip an absolute child)
   and flips to the left when there's no room on the right. Its MenuItems close
   the whole menu through the shared context. */
/** true inside a submenu, whose body mounts when the pointer merely passes over its row */
export const SubmenuContext = createContext(false);

export function MenuSub(props: { icon?: React.ReactNode; label: React.ReactNode; right?: React.ReactNode; width?: number; children: React.ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => { clearTimeout(timer.current); if (btn.current) setRect(btn.current.getBoundingClientRect()); };
  const hideSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setRect(null), 180); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const w = props.width ?? 240;
  const left = rect ? (rect.right + 6 + w > window.innerWidth - 12 ? rect.left - w - 6 : rect.right + 6) : 0;
  return (
    <>
      <button ref={btn} className={`menu-item${rect ? ' sub-open' : ''}`} onPointerEnter={show} onPointerLeave={hideSoon}
        onClick={(e) => { e.stopPropagation(); if (rect) setRect(null); else show(); }}>
        {props.icon && <span className="mi-icon">{props.icon}</span>}
        <span className="mi-label">{props.label}</span>
        <span className="mi-right">{props.right}<IconChevronRight size={12} /></span>
      </button>
      {rect && createPortal(
        <div className="menu submenu" style={{ left, top: Math.min(rect.top - 6, window.innerHeight - 320), width: w }}
          onPointerEnter={show} onPointerLeave={hideSoon}>
          <SubmenuContext.Provider value={true}>{props.children}</SubmenuContext.Provider>
        </div>,
        document.body,
      )}
    </>
  );
}

export function MenuSep() { return <div className="menu-sep" />; }

export function MenuInput(props: { value: string; onChange: (value: string) => void; placeholder?: string; onEnter?: () => void }) {
  return (
    <div className="menu-input" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); props.onEnter?.(); } }}
      />
    </div>
  );
}

/* ---------------- useMenu hook ---------------- */
export function useMenu() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // a right-click opens at the pointer, like Linear's context menus
    if (e.type === 'contextmenu' && 'clientX' in e) setAnchor(new DOMRect(e.clientX, e.clientY, 0, 0));
    else setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, setAnchor, open, close, isOpen: anchor !== null };
}

/* ---------------- register mark ----------------
   The 2px brand line under the active tab / nav item. Every mark sharing a
   `group` is one element as far as layout is concerned, so switching tabs
   slides it across (and resizes it to the new label) instead of blinking. */
export function RegisterMark({ group }: { group: string }) {
  return (
    <motion.span
      layoutId={group} className="register-mark" aria-hidden
      transition={{ type: 'spring', stiffness: 560, damping: 44, mass: 0.7 }}
    />
  );
}

/** A short spray of dots from the centre of its (relative) parent: for a moment that was earned,
    such as a ring closing or a list emptying, never for an ordinary save. */
export function Burst({ count = 10, reach = 15 }: { count?: number; reach?: number }) {
  if (reducedMotion()) return null;
  const step = 360 / count;
  return (
    <span className="burst" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <i key={i} style={{ ['--a' as string]: `${i * step + (i % 2) * (step / 3)}deg`, ['--d' as string]: `${i % 2 ? reach * 0.72 : reach}px` }} />)}
    </span>
  );
}

/* ---------------- modal ----------------
   Enter: opacity + 8px rise + 0.982 scale over 220ms on the global ease.
   Exit: 140ms, no scale (motion spec: "Design polish and refinement").
   The exit only plays when the caller renders the modal inside <AnimatePresence>
   (`<AnimatePresence>{open && <Modal …/>}</AnimatePresence>`), because an unmounted
   component can't animate itself out. */
export function Modal(props: { onClose: () => void; children: React.ReactNode; className?: string; dismissOnBackdrop?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); props.onClose(); return; }
      // Tab stays inside the dialog instead of wandering into the page behind it
      if (e.key === 'Tab' && boxRef.current && !document.querySelector('.menu:not(.closing)')) {
        const f = [...boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!boxRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props]);
  // give focus back to whatever opened the dialog once it closes
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => { if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); };
  }, []);
  return createPortal(
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      // a fading overlay must not swallow the click that follows the close
      exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: 0.14, ease: 'easeOut' } }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      onMouseDown={(e) => { if (props.dismissOnBackdrop !== false && e.target === e.currentTarget) props.onClose(); }}
    >
      <motion.div
        ref={boxRef} role="dialog" aria-modal="true"
        className={props.className ?? 'modal modal-create'}
        initial={{ opacity: 0, y: 8, scale: 0.982 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, transition: { duration: 0.14, ease: 'easeOut' } }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        {props.children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/* ---------------- toasts ----------------
   Enter 260ms rise on the global ease; exit 220ms. The auto-close window is
   drawn as a depleting register line on the bottom edge (5200ms linear, square
   ends, on the same clock as the store's undo timer). Three at most; the older two
   recede to 72% and drop their line. Undo is the toast's paper button. */
export function Toasts() {
  const toasts = useApp(s => s.toasts);
  const dismiss = useApp(s => s.dismissToast);
  const hold = useApp(s => s.holdToast);
  const shown = toasts.slice(-3);
  return createPortal(
    <div className="toasts">
      <AnimatePresence>
        {shown.map((t, i) => (
          <motion.div key={t.id} className={`toast ${i < shown.length - 1 ? 'stacked' : ''}`} layout role="status"
            onMouseEnter={() => hold(t.id, true)} onMouseLeave={() => hold(t.id, false)}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.22, ease: 'easeOut' } }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="toast-title">{t.title}</div>
              {t.line && <div className="toast-line">{t.line}</div>}
              {t.link && <Link className="toast-link" to={t.link.to}>{t.link.label}</Link>}
            </div>
            {t.actions?.map(a => (
              <button key={a.label} className="btn primary" style={{ height: 26, fontSize: 12 }}
                onClick={async () => { await a.onClick(); dismiss(t.id, true); }}>{a.label}</button>
            ))}
            <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => dismiss(t.id)}><IconClose size={13} /></button>
            {t.autoClose !== false && (
              <div className="toast-line-track"><div className="toast-line-fill" /></div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

/* ---------------- tooltips ----------------
   One layer for the whole app. Any element's `title` is adopted on first hover
   (moved to data-tip so the slow native tooltip never shows), and a trailing
   "(⌘K)"-style hint renders as key caps, so every tooltip shows its shortcut.
   First show waits 450ms; while one was just visible the next shows at once.
   A tip that only repeats fully visible text (a nav label) is skipped. */
type Tip = { text: string; keys: string[]; rect: DOMRect };

function parseTip(raw: string): { text: string; keys: string[] } {
  const m = /^(.*\S)\s+\(([^()]{1,12})\)$/.exec(raw);
  if (!m || !/^(⌘|⇧|⌥|⌃|Ctrl|Esc|Enter|[A-Z0-9?/↵⌫]\b|[A-Z] then)/.test(m[2])) return { text: raw, keys: [] };
  const hint = m[2];
  const keys = hint.includes(' ') ? hint.split(' ') : (hint.match(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g) ?? [hint]);
  return { text: m[1], keys };
}

function tipTarget(node: EventTarget | null): HTMLElement | null {
  const el = (node as HTMLElement | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
  if (!el) return null;
  const t = el.getAttribute('title');
  if (t) {
    el.removeAttribute('title');
    el.dataset.tip = t;
    if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', t);
  }
  return el.dataset.tip ? el : null;
}

function redundant(el: HTMLElement, tip: string) {
  // the tip only repeats what's on screen (a nav label, maybe beside its count)
  if (!el.textContent?.includes(tip.trim())) return false;
  const clipped = [el, ...el.querySelectorAll<HTMLElement>('*')].some(n => n.scrollWidth > n.clientWidth + 1);
  return !clipped;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    let warmUntil = 0;
    const hide = () => {
      clearTimeout(timer);
      if (current) warmUntil = Date.now() + 300;
      current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = tipTarget(e.target);
      if (el === current) return;
      clearTimeout(timer);
      if (!el) { if (current) hide(); return; }
      const raw = el.dataset.tip!;
      if (redundant(el, raw)) { if (current) hide(); return; }
      const wasShowing = current !== null;
      current = el;
      setTip(null);
      const show = () => { if (current === el && el.isConnected) setTip({ ...parseTip(raw), rect: el.getBoundingClientRect() }); };
      if (wasShowing || Date.now() < warmUntil) show();
      else timer = setTimeout(show, 450);
    };
    const onOut = (e: PointerEvent) => {
      if (current && !current.contains(e.relatedTarget as Node | null)) hide();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) { setPos(null); return; }
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight, r = tip.rect;
    const below = r.bottom + 6 + h < window.innerHeight - 8;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    setPos({ left, top: below ? r.bottom + 6 : r.top - h - 6, below });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={ref} role="tooltip"
      className={`tooltip${pos ? ' shown' : ''}${pos && !pos.below ? ' above' : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <span>{tip.text}</span>
      {tip.keys.map((k, i) => k === 'then'
        ? <span key={i} className="tooltip-then">then</span>
        : <span key={i} className="kbd">{k}</span>)}
    </div>,
    document.body,
  );
}

/* ---------------- confirm button ----------------
   Destructive actions take two presses: the first arms it (the label turns
   into the consequence, in danger red), the second within 3s runs it. Leaving
   it alone disarms it. A one-line decision does not need a modal. */
/** One submit at a time. `guard(fn)` wraps a create/save handler so a second call
 *  while the first is still in flight (double-click, Enter then click, ⌘↵ firing from
 *  both the editor and the modal) is dropped instead of creating a duplicate. The ref
 *  catches calls in the same tick, before `busy` has re-rendered the button disabled. */
/** the useInFlight guard for handlers that aren't in a hook-friendly spot: calls sharing a key
 *  while one is still running are dropped (a double-click, Enter then click) */
const runningKeys = new Set<string>();
export async function exclusive(key: string, fn: () => Promise<unknown>): Promise<void> {
  if (runningKeys.has(key)) return;
  runningKeys.add(key);
  try { await fn(); } finally { runningKeys.delete(key); }
}

export function useInFlight() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const guard = <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) => async (...args: A): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await fn(...args); } finally { inFlight.current = false; setBusy(false); }
  };
  return { busy, guard };
}

/** the icon-sized ConfirmButton for hover trash/× buttons: the first press turns the icon into a
 *  short red "Delete?" and a second press within 3s runs it */
export function ConfirmIconButton(props: {
  title: string;
  confirmLabel?: string;
  onConfirm: (e: React.MouseEvent) => void | Promise<void>;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${props.className ?? 'icon-btn hover-only'}${armed ? ' armed' : ''}`}
      style={props.style} disabled={props.disabled}
      title={armed ? 'Click again to confirm' : props.title} aria-label={props.title}
      onClick={async (e) => {
        e.stopPropagation();
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        await props.onConfirm(e);
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? <span className="confirm-text">{props.confirmLabel ?? 'Delete?'}</span> : props.children}
    </button>
  );
}

export function ConfirmButton(props: {
  label: React.ReactNode;
  confirmLabel: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${props.className ?? 'btn'}${armed ? ' armed' : ''}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        await props.onConfirm();
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? props.confirmLabel : props.label}
    </button>
  );
}

/** hosted, how teams and the workspace are set up is admins' to change (TEAM_PLAN.md › Who changes what) */
export function useCanConfigure(): boolean {
  return useApp(s => !s.snap || s.snap.workspace.auth !== 'hosted' || s.snap.currentUser.admin);
}
export const ADMIN_NOTE = 'Only admins can change this.';
/** the same controls, disabled under a note naming whom to ask, for someone who can't change them */
export function AdminLock(props: { children: React.ReactNode; note?: string; teamId?: string; what?: string; level?: 'lead' | 'member' }) {
  const can = useCanConfigure();
  const lead = useCanLead(props.teamId ?? null);
  const member = useOnTeam(props.teamId ?? null);
  if (props.teamId ? (props.level === 'member' ? member : lead) : can) return <>{props.children}</>;
  return <>
    <AskLine teamId={props.teamId} what={props.what ?? document.title} note={props.note} />
    <fieldset disabled className="admin-locked">{props.children}</fieldset>
  </>;
}

/** a team's setup is its lead's (CORE_FLOW.md › Roles): its leads, an admin, or anyone on a laptop */
export function useCanLead(teamId: string | null): boolean {
  return useApp(s => !s.snap || s.snap.workspace.auth !== 'hosted' || s.snap.currentUser.admin
    || (!!teamId && !!s.snap.teams.find(t => t.id === teamId)?.leadIds.includes(s.snap.currentUser.id)));
}
/** labels and templates are any of a team's members' */
export function useOnTeam(teamId: string | null): boolean {
  return useApp(s => !s.snap || s.snap.workspace.auth !== 'hosted' || s.snap.currentUser.admin
    || (!!teamId && !!s.snap.teams.find(t => t.id === teamId)?.memberIds.includes(s.snap.currentUser.id)));
}
/** whom to ask about a team's setup (its leads, else the admins) or the workspace's (the admins), never yourself */
export function useAskable(teamId?: string | null): Array<{ id: string; name: string }> {
  const snap = useApp(s => s.snap);
  if (!snap) return [];
  const people = snap.users.filter(u => u.kind === 'human' && u.status !== 'suspended' && u.id !== snap.currentUser.id);
  const team = teamId ? snap.teams.find(t => t.id === teamId) : undefined;
  const leads = team ? people.filter(u => team.leadIds.includes(u.id)) : [];
  return (leads.length ? leads : people.filter(u => u.admin)).map(u => ({ id: u.id, name: u.name }));
}
const firstName = (name: string) => name.split(' ')[0] ?? name;
/** "Ask Parth": one click puts the request in that person's inbox, linking back to this page */
export function AskButton(props: { to: { id: string; name: string }; what: string }) {
  const [sent, setSent] = useState(false);
  const ask = async () => {
    try {
      await api.askAccess({ to: props.to.id, what: props.what, path: location.hash.replace(/^#/, '') || '/' });
      setSent(true);
      useApp.getState().toast({ title: `Asked ${firstName(props.to.name)}`, line: 'It\'s in their inbox, with a link to this page.' });
    } catch (e) { useApp.getState().toast({ title: 'Couldn\'t ask', line: (e as Error).message }); }
  };
  return <button type="button" className="btn ghost sm ask-btn" disabled={sent} onClick={() => void ask()}>{sent ? `Asked ${firstName(props.to.name)}` : `Ask ${firstName(props.to.name)}`}</button>;
}
/** the line every remaining refusal shows: who decides, and a one-click ask to each of them (at most two) */
export function AskLine(props: { teamId?: string | null; what: string; note?: string }) {
  const askable = useAskable(props.teamId);
  const team = useApp(s => props.teamId ? s.snap?.teams.find(t => t.id === props.teamId) : undefined);
  const who = team ? (team.leadIds.length ? `${team.name}'s lead` : `${team.name} has no lead yet, so admins`) : 'admins';
  const note = props.note ?? (team && !team.leadIds.length ? `${who} set this up.` : `Only ${who} can change this.`);
  return (
    <div className="field-help admin-note ask-line">
      <span>{note}</span>
      {askable.slice(0, 2).map(u => <AskButton key={u.id} to={u} what={props.what} />)}
    </div>
  );
}

/** the muted "via Parth" after an agent's name on what it wrote for someone; nothing for a person's own writes */
export function Via({ userId }: { userId: string | null }) {
  const name = useApp(s => userId ? s.snap?.users.find(u => u.id === userId)?.name : undefined);
  return name ? <span className="via"> via {name}</span> : null;
}

/** one "not found" treatment for every entity page: what's missing, why, and a way back */
export function NotFound(props: { what: string; detail?: string; back: { label: string; to: string } }) {
  return (
    <div className="content">
      <EmptyState kind="missing" word="Not found" illo="search" title={`${props.what} not found`} desc={props.detail ?? 'It may have been deleted, or the link is wrong.'}
        actions={<Link className="btn secondary" to={props.back.to}>{props.back.label}</Link>} />
    </div>
  );
}
