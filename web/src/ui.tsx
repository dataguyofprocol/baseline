import { useEffect, useLayoutEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useApp } from './store.js';
import { IconClose, IconCheck } from './icons.js';
import { reducedMotion } from './motion.js';

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
      // handled keys stop here — the list behind an open menu must not also
      // move its J/K cursor or open the row under it
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setIndex(i => (i + 1) % Math.max(els.length, 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setIndex(i => (i - 1 + els.length) % Math.max(els.length, 1)); }
      const pick = els[Math.min(index, els.length - 1)];
      if (e.key === 'Enter' && pick && !(e.target as HTMLElement)?.closest?.('.menu-input')) {
        e.preventDefault(); e.stopPropagation(); pick.click();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, closing, close]);

  // the highlight is the single source of truth for both mouse and keyboard
  useLayoutEffect(() => {
    const els = itemEls();
    const i = Math.min(index, els.length - 1);
    els.forEach((el, n) => el.classList.toggle('highlighted', n === i));
    if (i >= 0) els[i]?.scrollIntoView({ block: 'nearest' });
  });

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
    if (y + h > window.innerHeight - 12) { y = Math.max(12, a.top - h - 6); flipped = true; }
    if (x + w > window.innerWidth - 12) x = window.innerWidth - w - 12;
    return { left: x, top: y, width: w, '--menu-dy': flipped ? '4px' : '-4px', transformOrigin: `${Math.max(12, a.left + Math.min(a.width, 40) / 2 - x)}px ${flipped ? '100%' : '0'}` };
  };
  const [pos, setPos] = useState<React.CSSProperties>(place);
  useLayoutEffect(() => { setPos(place()); /* eslint-disable-line */ }, []);

  return createPortal(
    <>
      {!closing && <div className="menu-backdrop" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />}
      <div className={`menu${closing ? ' closing' : ''}`} ref={ref} style={pos} onPointerMove={onPointerMove}>
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
  onClick?: (e: React.MouseEvent) => void;
  sectionHeader?: string;
}) {
  const { close } = useContext(MenuContext);
  return (
    <>
      {props.sectionHeader && <div className="menu-header"><span>{props.sectionHeader}</span></div>}
      <button
        className="menu-item"
        style={props.danger ? { color: '#eb5757' } : undefined}
        onClick={(e) => { e.stopPropagation(); props.onClick?.(e); close(); }}
      >
        {props.icon && <span className="mi-icon">{props.icon}</span>}
        <span className="mi-label">{props.label}</span>
        <span className="mi-right">
          {props.right}
          {props.selected && <IconCheck size={13} />}
        </span>
      </button>
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
    setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
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

/* ---------------- modal ----------------
   Enter: opacity + 8px rise + 0.982 scale over 220ms on the global ease.
   Exit: 140ms, no scale (motion spec: "Design polish and refinement").
   The exit only plays when the caller renders the modal inside <AnimatePresence>
   (`<AnimatePresence>{open && <Modal …/>}</AnimatePresence>`) — an unmounted
   component can't animate itself out. */
export function Modal(props: { onClose: () => void; children: React.ReactNode; className?: string; dismissOnBackdrop?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); props.onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props]);
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
   ends — same clock as the store's undo timer). Three at most; the older two
   recede to 72% and drop their line. Undo is the surface's paper button. */
export function Toasts() {
  const toasts = useApp(s => s.toasts);
  const dismiss = useApp(s => s.dismissToast);
  const shown = toasts.slice(-3);
  return createPortal(
    <div className="toasts">
      <AnimatePresence>
        {shown.map((t, i) => (
          <motion.div key={t.id} className={`toast ${i < shown.length - 1 ? 'stacked' : ''}`} layout
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
                onClick={async () => { await a.onClick(); dismiss(t.id); }}>{a.label}</button>
            ))}
            <button className="icon-btn" onClick={() => dismiss(t.id)}><IconClose size={13} /></button>
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
   "(⌘K)"-style hint renders as key caps — every tooltip teaches its shortcut.
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
