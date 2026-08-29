import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { Modal } from './ui.js';
import { StateIcon } from './pickers.js';
import { scoreItem } from './fuzzy.js';
import {
  IconSearch, IconPlus, IconSettings, IconInbox, IconBox, IconViews, IconMyIssues,
  IconCycle, IconTeam, IconMoon, IconSun, IconHome, IconPrompt,
} from './icons.js';

interface PaletteItem {
  id: string;
  icon?: React.ReactNode;
  label: string;
  section: string;
  hint?: string;
  keywords?: string;
  action: () => void;
}

/** render a label with fuzzy-matched characters highlighted */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const out: React.ReactNode[] = [];
  let run = '';
  let hl = false;
  const flush = (key: number) => {
    if (!run) return;
    out.push(hl ? <span key={key} className="pal-hl">{run}</span> : <span key={key}>{run}</span>);
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const isHl = set.has(i);
    if (isHl !== hl) { flush(out.length); hl = isHl; }
    run += text[i];
  }
  flush(out.length);
  return <>{out}</>;
}

export function CommandPalette() {
  const open = useApp(s => s.paletteOpen);
  const setOpen = useApp(s => s.setPalette);
  const snap = useApp(s => s.snap);
  const openCreate = useApp(s => s.openCreate);
  const setTheme = useApp(s => s.setTheme);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    if (!snap) return [];
    const nav: PaletteItem[] = [
      { id: 'nav-inbox', icon: <IconInbox />, label: 'Go to Inbox', section: 'Navigation', hint: 'G I', action: () => navigate('/inbox') },
      { id: 'nav-my', icon: <IconMyIssues />, label: 'Go to My issues', section: 'Navigation', hint: 'G M', action: () => navigate('/my-issues') },
      { id: 'nav-projects', icon: <IconBox />, label: 'Go to Projects', section: 'Navigation', hint: 'G P', action: () => navigate('/projects') },
      { id: 'nav-views', icon: <IconViews />, label: 'Go to Views', section: 'Navigation', hint: 'G V', action: () => navigate('/views') },
      { id: 'nav-settings', icon: <IconSettings />, label: 'Open Settings', section: 'Navigation', action: () => navigate('/settings/workspace') },
      { id: 'nav-set-appearance', icon: <IconSun size={14} />, label: 'Open Appearance settings', section: 'Navigation', action: () => navigate('/settings/appearance') },
      { id: 'nav-set-teams', icon: <IconTeam size={14} />, label: 'Open Teams settings', section: 'Navigation', action: () => navigate('/settings/teams') },
      { id: 'nav-set-labels', icon: <IconTeam size={14} />, label: 'Open Label settings', section: 'Navigation', action: () => navigate('/settings/labels') },
    ];
    const actions: PaletteItem[] = [
      { id: 'act-create', icon: <IconPlus />, label: 'Create new issue', section: 'Actions', hint: 'C', keywords: 'new issue add', action: () => openCreate() },
      { id: 'act-create-project', icon: <IconBox />, label: 'Create new project', section: 'Actions', keywords: 'new project add', action: () => navigate('/projects/new') },
      { id: 'act-theme', icon: document.documentElement.dataset.theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />, label: `Switch to ${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'} theme`, section: 'Actions', keywords: 'dark light appearance toggle', action: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
      { id: 'act-shortcuts', icon: <span className="kbd">?</span>, label: 'Show keyboard shortcuts', section: 'Actions', keywords: 'hotkeys keys', action: () => useApp.getState().setShortcuts(true) },
    ];

    // "Copy as prompt" for the issue currently in view (peek or issue page)
    const peekId = useApp.getState().peekIssueId;
    const pageKey = /^#\/issue\/(.+?)$/.exec(location.hash ?? '')?.[1];
    let current = peekId ? snap.issues.find(i => i.id === peekId) : undefined;
    if (!current && pageKey) {
      const m = /^(.+)-(\d+)$/.exec(pageKey);
      const t = snap.teams.find(x => x.key.toLowerCase() === (m?.[1] ?? '').toLowerCase());
      current = snap.issues.find(i => i.teamId === t?.id && i.number === Number(m?.[2]));
    }
    if (current) {
      const t = snap.teams.find(x => x.id === current.teamId);
      const ck = `${t?.key}-${current.number}`;
      actions.unshift({
        id: 'act-copy-prompt',
        icon: <IconPrompt />,
        label: `Copy as prompt (${ck})`,
        section: 'Actions',
        keywords: 'handoff agent paste cli branch coding',
        action: async () => {
          const { handoff } = await api.getHandoff(current!.id);
          await navigator.clipboard.writeText(handoff.prompt);
          useApp.getState().toast({ title: `Copied prompt for ${handoff.key}` });
        },
      });
    }
    for (const t of snap.teams) {
      nav.push({ id: `nav-team-${t.id}`, icon: <span className="ws-avatar" style={{ background: t.color, borderRadius: 4, fontSize: 8, width: 15, height: 15 }}>{t.key.slice(0, 1)}</span>, label: `Go to ${t.name}`, section: 'Navigation', keywords: t.key, action: () => navigate(`/team/${t.key}/all`) });
      nav.push({ id: `nav-team-home-${t.id}`, icon: <IconHome size={14} />, label: `Go to ${t.name} home`, section: 'Navigation', keywords: t.key, action: () => navigate(`/team/${t.key}`) });
      if (snap.cycles.some(c => c.teamId === t.id)) {
        nav.push({ id: `nav-team-cycles-${t.id}`, icon: <IconCycle size={14} />, label: `Go to ${t.name} cycles`, section: 'Navigation', keywords: `${t.key} cycles`, action: () => navigate(`/team/${t.key}/cycles`) });
      }
    }
    const issueItems: PaletteItem[] = snap.issues.map(i => {
      const team = snap.teams.find(t => t.id === i.teamId);
      const state = snap.states.find(s => s.id === i.stateId);
      return {
        id: `issue-${i.id}`,
        icon: state ? <StateIcon type={state.type} color={state.color} size={14} /> : undefined,
        label: `${team?.key}-${i.number} ${i.title}`,
        section: 'Issues',
        keywords: `${i.title} ${team?.key}-${i.number}`,
        action: () => navigate(`/issue/${team?.key}-${i.number}`),
      };
    });
    const projectItems: PaletteItem[] = snap.projects.map(p => ({
      id: `proj-${p.id}`,
      icon: <span>{p.icon}</span>,
      label: p.name,
      section: 'Projects',
      keywords: p.name,
      action: () => navigate(`/projects/${p.id}`),
    }));
    const viewItems: PaletteItem[] = snap.views.map(v => ({
      id: `view-${v.id}`,
      icon: <span>{v.icon || '🗂'}</span>,
      label: v.name,
      section: 'Views',
      keywords: v.name,
      action: () => navigate(`/views/${v.id}`),
    }));
    return [...nav, ...actions, ...projectItems, ...viewItems, ...issueItems];
  }, [snap, navigate, openCreate, setTheme, open]);

  const filtered = useMemo<Array<{ item: PaletteItem; match: { indices: number[] } | null }>>(() => {
    if (!q.trim()) {
      const nonIssues = items.filter(i => i.section !== 'Issues');
      const topIssues = items.filter(i => i.section === 'Issues')
        .sort((a, b) => b.label.localeCompare(a.label)).slice(0, 5);
      return [...nonIssues, ...topIssues].map(item => ({ item, match: null }));
    }
    return items
      .map(i => ({ i, s: scoreItem(q.trim(), i) }))
      .filter(({ s }) => s !== null)
      .sort((a, b) => b.s!.score - a.s!.score)
      .slice(0, 24)
      .map(({ i, s }) => ({ item: i, match: s!.match }));
  }, [items, q]);

  useEffect(() => { setIndex(0); }, [q]);
  useEffect(() => { if (open) { setQ(''); setIndex(0); } }, [open]);
  useEffect(() => {
    const el = listRef.current?.querySelector('.menu-item.highlighted');
    el?.scrollIntoView({ block: 'nearest' });
  }, [index, filtered]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const entry = filtered[index];
        if (entry) { setOpen(false); entry.item.action(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, index, setOpen]);

  if (!open) return null;

  let lastSection = '';
  return (
    <Modal onClose={() => setOpen(false)} className="modal modal-palette" dismissOnBackdrop={false}>
      <div className="pal-input-row">
        <IconSearch style={{ color: 'var(--text-secondary)' }} />
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Type a command or search…"
          spellCheck={false}
        />
        <span className="pal-hint"><span className="kbd">↑↓</span> navigate <span className="kbd">↵</span> select <span className="kbd">esc</span> dismiss</span>
      </div>
      <div className="pal-list" ref={listRef}>
        {filtered.map(({ item, match }, i) => {
          const header = item.section !== lastSection ? item.section : null;
          lastSection = item.section;
          return (
            <div key={item.id}>
              {header && <div className="menu-header" style={{ paddingTop: 8 }}><span>{header}</span></div>}
              <button
                className={`menu-item ${i === index ? 'highlighted' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => { setOpen(false); item.action(); }}
              >
                {item.icon && <span className="mi-icon">{item.icon}</span>}
                <span className="mi-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Highlighted text={item.label} indices={match?.indices ?? []} />
                </span>
                {item.hint && <span className="mi-right"><span className="kbd">{item.hint}</span></span>}
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="menu-header"><span>No results for "{q}"</span></div>}
      </div>
    </Modal>
  );
}

/* ---------------- keyboard shortcuts overlay ---------------- */
export function ShortcutsOverlay() {
  const open = useApp(s => s.shortcutsOpen);
  const setOpen = useApp(s => s.setShortcuts);
  if (!open) return null;
  const groups: Array<[string, Array<[string, string]>]> = [
    ['General', [
      ['⌘K', 'Open command palette'],
      ['?', 'Show keyboard shortcuts'],
      ['C', 'Create new issue'],
      ['/ ', 'Filter issues'],
      ['⌘B', 'Toggle sidebar'],
      ['Esc', 'Close / go back'],
    ]],
    ['Issues', [
      ['J / K', 'Move cursor down / up'],
      ['↵', 'Open issue'],
      ['S / P / A / L', 'Status / priority / assignee / labels menu'],
      ['1 – 5', 'Set status (numbered states)'],
      ['⇧U / ⇧H / ⇧M / ⇧L', 'Set priority none/high/medium/low'],
      ['X', 'Select issue (bulk actions)'],
      ['E', 'Archive (undo from toast)'],
      ['⌘⌫', 'Delete (undo from toast)'],
    ]],
    ['Navigation', [
      ['G then I', 'Go to Inbox'],
      ['G then M', 'Go to My issues'],
      ['G then P', 'Go to Projects'],
      ['G then V', 'Go to Views'],
      ['G then A', 'Go to All issues'],
    ]],
  ];
  return (
    <Modal onClose={() => setOpen(false)} className="modal" dismissOnBackdrop={false}>
      <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: '72vh' }}>
        <div style={{ fontSize: 16, fontWeight: 590, marginBottom: 14 }}>Keyboard shortcuts</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {groups.map(([name, rows]) => (
            <div key={name}>
              <div className="menu-header" style={{ padding: '0 0 6px', fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 590 }}>{name}</div>
              {rows.map(([k, d]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', color: 'var(--text-secondary)', gap: 12 }}>
                  <span>{d}</span>
                  <span style={{ display: 'flex', gap: 3, flex: 'none' }}>{k.split(' ').map((x, i) => x === 'then' ? <span key={i} style={{ color: 'var(--text-dim)' }}>then</span> : <span key={i} className="kbd">{x}</span>)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
