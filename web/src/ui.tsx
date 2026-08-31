import { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useApp } from './store.js';
import { IconClose, IconCheck } from './icons.js';

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
  const [items, setItems] = useState<HTMLButtonElement[]>([]);
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); props.onClose(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, items.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && index >= 0) { e.preventDefault(); items[index]?.click(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [items, index, props]);

  useEffect(() => {
    if (items.length > 0) setIndex(0);
  }, [items]);

  const place = () => {
    const a = props.anchor;
    const w = props.width ?? 224;
    const h = ref.current?.offsetHeight ?? 200;
    let x = a.left;
    let y = a.bottom + 6;
    if (y + h > window.innerHeight - 12) y = Math.max(12, a.top - h - 6);
    if (x + w > window.innerWidth - 12) x = window.innerWidth - w - 12;
    return { left: x, top: y, width: w };
  };
  const [pos, setPos] = useState(place);
  useEffect(() => { setPos(place()); /* eslint-disable-line */ }, []);

  return createPortal(
    <>
      <div className="menu-backdrop" onMouseDown={props.onClose} onContextMenu={(e) => { e.preventDefault(); props.onClose(); }} />
      <div className="menu" ref={ref} style={pos}>
        <MenuContext.Provider value={{
          close: props.onClose,
          registerItem: (el) => { if (el) setItems(prev => prev.includes(el) ? prev : [...prev, el]); },
        }}>
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
  const { close, registerItem } = useContext(MenuContext);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { registerItem(ref.current); /* eslint-disable-line */ }, []);
  return (
    <>
      {props.sectionHeader && <div className="menu-header"><span>{props.sectionHeader}</span></div>}
      <button
        ref={ref}
        className="menu-item"
        style={props.danger ? { color: '#eb5757' } : undefined}
        onMouseEnter={() => { ref.current?.focus(); }}
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

/* ---------------- modal ----------------
   Enter: opacity + 8px rise + 0.982 scale over 220ms on the global ease.
   Exit: 140ms, no scale (motion spec: "Design polish and refinement"). */
export function Modal(props: { onClose: () => void; children: React.ReactNode; className?: string; dismissOnBackdrop?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); props.onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props]);
  return createPortal(
    <AnimatePresence>
      <motion.div
        className="overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        onMouseDown={(e) => { if (props.dismissOnBackdrop !== false && e.target === e.currentTarget) props.onClose(); }}
      >
        <motion.div
          className={props.className ?? 'modal modal-create'}
          initial={{ opacity: 0, y: 8, scale: 0.982 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14, ease: 'easeOut' } }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {props.children}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
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
