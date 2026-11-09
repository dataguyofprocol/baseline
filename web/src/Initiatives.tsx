import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import type { Editor } from '@tiptap/react';
import {
  Rocket, Target, Flag, Star, Zap, Leaf, Globe, Shield, Heart, TrendingUp, Compass, Box, Gem, Puzzle, Key, Megaphone, BookOpen,
  Users, Sparkles, Mountain, Lightbulb, DollarSign, Lock, Smartphone, Bot, Code, Layers, Palette, Cloud, Wrench, Trophy, Flame,
  Telescope, Handshake, Building2, GraduationCap, type LucideIcon,
} from 'lucide-react';
import { useApp, shortDate, relTime, copyText } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { Menu, MenuItem, MenuSep, MenuSub, Modal, useMenu, useInFlight, exclusive } from './ui.js';
import { Avatar, CalendarGrid, StateIcon, PriorityIcon, teamDisplayIcon } from './pickers.js';
import { RichEditor, isBlank, htmlToMarkdown } from './RichEditor.js';
import { Markdown } from './Markdown.js';
import { ProjectStatusIcon, projectProgress, namedStatus, ProgressRing, ProjectBoard, ProjectTimeline, groupProjects } from './Projects.js';
import { Resources } from './Docs.js';
import { ReactionChips, REACTION_SET } from './IssueDetail.js';
import { Illustration } from './illustrations.js';
import {
  IconPlus, IconClose, IconTrash, IconCalendar, IconUser, IconInitiative, IconCheck, IconFilter, IconDisplay, IconLink, IconEdit, IconChevronDown,
  IconTag, IconTeam, IconEmoji, IconClock, IconCopyId, IconList, IconBoard, IconTimeline, IconSettings,
} from './icons.js';
import { initiativeKey, PRIORITY_LABELS, UPDATE_CADENCE_LABELS, type DateResolution, type Initiative, type InitiativeStatus, type InitiativeUpdate, type Priority, type ProjectHealth, type Project, type UpdateCadence } from '../../src/core/types.js';
import { UpdateBody } from './UpdateBody.js';

type Snap = NonNullable<ReturnType<typeof useApp.getState>['snap']>;
const refresh = () => useApp.getState().bootstrap();
const toast = (title: string) => useApp.getState().toast({ title });

/* ================= vocabulary ================= */
export const INITIATIVE_STATUS: Array<[InitiativeStatus, string, string]> = [
  ['proposed', 'Proposed', '#95a2b3'], ['planned', 'Planned', '#8a8f98'], ['active', 'Active', '#f2c94c'],
  ['completed', 'Completed', '#5e6ad2'], ['canceled', 'Canceled', '#7d8084'],
];
const STATE_GLYPH: Record<InitiativeStatus, string> = { proposed: 'backlog', planned: 'unstarted', active: 'started', completed: 'completed', canceled: 'canceled' };
const HEALTH: Array<[ProjectHealth, string, string]> = [['onTrack', 'On track', '#4cb782'], ['atRisk', 'At risk', '#f2c94c'], ['offTrack', 'Off track', '#eb5757']];
const healthOf = (h: ProjectHealth | null | undefined) => HEALTH.find(x => x[0] === h);

const SERIES_COLORS = ['#5e6ad2', '#4cb782', '#f2994a', '#8e4ffa', '#3b82f6', '#eb5757'];

export function InitiativeStatusIcon({ status, size = 14 }: { status: InitiativeStatus; size?: number }) {
  const c = INITIATIVE_STATUS.find(x => x[0] === status)?.[2];
  return <span style={{ display: 'inline-flex', color: c }}><StateIcon type={STATE_GLYPH[status] ?? 'unstarted'} color={c} size={size} /></span>;
}

/* ---------- icons: Linear-style glyphs tinted with the initiative's color (emoji still work) ---------- */
const GLYPHS: Record<string, LucideIcon> = {
  rocket: Rocket, target: Target, flag: Flag, star: Star, zap: Zap, leaf: Leaf, globe: Globe, shield: Shield, heart: Heart,
  trending: TrendingUp, compass: Compass, box: Box, gem: Gem, puzzle: Puzzle, key: Key, megaphone: Megaphone, book: BookOpen,
  users: Users, sparkles: Sparkles, mountain: Mountain, bulb: Lightbulb, dollar: DollarSign, lock: Lock, phone: Smartphone,
  bot: Bot, code: Code, layers: Layers, palette: Palette, cloud: Cloud, wrench: Wrench, trophy: Trophy, flame: Flame,
  telescope: Telescope, handshake: Handshake, building: Building2, school: GraduationCap,
};
export const INITIATIVE_COLORS = ['#95a2b3', '#5e6ad2', '#4ea7fc', '#26b5ce', '#4cb782', '#f2c94c', '#f2994a', '#eb5757', '#e255a1', '#9b6ef3'];
const EMOJI = ['🎯', '🚀', '🌱', '💡', '🔥', '⚡', '🧭', '🏆', '🛡️', '💎', '🌍', '📈', '🤖', '📱', '🧩', '🔒', '💬', '❤️'];

/** the initiative glyph (Linear's: an up-pointing arrowhead) */
function InitiativeGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flex: 'none' }}>
      <path d="M8 1.9 13.4 13.6a.5.5 0 0 1-.7.63L8.3 11.9a.6.6 0 0 0-.6 0l-4.4 2.33a.5.5 0 0 1-.7-.63L8 1.9Z" fill={color} />
    </svg>
  );
}

export function InitiativeIcon({ ini, size = 16, tile = false }: { ini: Pick<Initiative, 'icon' | 'color'>; size?: number; tile?: boolean }) {
  const color = ini.color || '#5e6ad2';
  let inner: React.ReactNode;
  if (!ini.icon || ini.icon === 'glyph:initiative') inner = <InitiativeGlyph size={tile ? size * 0.6 : size} color={color} />;
  else if (ini.icon.startsWith('glyph:')) {
    const G = GLYPHS[ini.icon.slice(6)] ?? Target;
    inner = <G size={tile ? size * 0.58 : size} color={color} strokeWidth={tile ? 2 : 2.1} absoluteStrokeWidth={false} />;
  } else inner = <span style={{ fontSize: (tile ? size * 0.56 : size * 0.86), lineHeight: 1 }}>{ini.icon}</span>;
  if (!tile) return <span className="ini-glyph" style={{ width: size, height: size }}>{inner}</span>;
  return <span className="ini-tile" style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>{inner}</span>;
}

function IconPicker({ value, color, onPick }: { value: string; color: string; onPick: (p: { icon?: string; color?: string }) => void }) {
  const [tab, setTab] = useState<'icons' | 'emoji'>(value.startsWith('glyph:') ? 'icons' : 'emoji');
  return (
    <div className="ini-picker" onClick={e => e.stopPropagation()}>
      <div className="ini-picker-tabs">
        {(['icons', 'emoji'] as const).map(t => <button key={t} className={`pill-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{t === 'icons' ? 'Icons' : 'Emoji'}</button>)}
      </div>
      {tab === 'icons' && (
        <div className="ini-swatches">
          {INITIATIVE_COLORS.map(c => <button key={c} className={`ini-swatch${c === color ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => onPick({ color: c })} />)}
        </div>
      )}
      <div className="ini-icon-grid">
        {tab === 'icons'
          ? ['glyph:initiative', ...Object.keys(GLYPHS).map(k => `glyph:${k}`)].map(ic => (
            <button key={ic} className={`ini-icon-pick${value === ic ? ' on' : ''}`} onClick={() => onPick({ icon: ic })}><InitiativeIcon ini={{ icon: ic, color }} size={16} /></button>
          ))
          : EMOJI.map(e => <button key={e} className={`ini-icon-pick emoji${value === e ? ' on' : ''}`} onClick={() => onPick({ icon: e })}>{e}</button>)}
      </div>
    </div>
  );
}

/* ---------- target dates with Linear's resolutions: Nov 30 · May 2026 · Q2 2026 · H2 2026 · 2026 ---------- */
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function formatTarget(date: string | null, res: DateResolution | null | undefined): string {
  if (!date) return '';
  const d = new Date(date.slice(0, 10) + 'T12:00');
  const y = d.getFullYear(); const m = d.getMonth();
  switch (res) {
    case 'year': return `${y}`;
    case 'half': return `H${m < 6 ? 1 : 2} ${y}`;
    case 'quarter': return `Q${Math.floor(m / 3) + 1} ${y}`;
    case 'month': return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    default: return d.getFullYear() === new Date().getFullYear() ? shortDate(d.toISOString()) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
function periodOptions(res: Exclude<DateResolution, 'day'>): Array<{ label: string; iso: string }> {
  const now = new Date(); const y0 = now.getFullYear(); const out: Array<{ label: string; iso: string }> = [];
  for (const y of [y0, y0 + 1]) {
    if (res === 'year') out.push({ label: `${y}`, iso: isoDay(new Date(y, 12, 0)) });
    if (res === 'half') for (const h of [1, 2]) out.push({ label: `H${h} ${y}`, iso: isoDay(new Date(y, h * 6, 0)) });
    if (res === 'quarter') for (const q of [1, 2, 3, 4]) out.push({ label: `Q${q} ${y}`, iso: isoDay(new Date(y, q * 3, 0)) });
    if (res === 'month') for (let m = 0; m < 12; m++) out.push({ label: new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), iso: isoDay(new Date(y, m + 1, 0)) });
  }
  // periods already over aren't useful targets
  return out.filter(o => o.iso >= isoDay(now)).slice(0, res === 'month' ? 14 : 8);
}
function TargetMenuBody({ ini, onSet }: { ini: Initiative; onSet: (iso: string | null, res: DateResolution | null) => void }) {
  const [res, setRes] = useState<DateResolution>(ini.targetResolution ?? 'day');
  return (
    <>
      <div className="ini-res-tabs" onClick={e => e.stopPropagation()}>
        {(['day', 'month', 'quarter', 'half', 'year'] as const).map(r => <button key={r} className={`pill-tab${res === r ? ' on' : ''}`} onClick={() => setRes(r)}>{r[0].toUpperCase() + r.slice(1)}</button>)}
      </div>
      {res === 'day'
        ? <CalendarGrid selected={ini.targetResolution ? undefined : ini.targetDate?.slice(0, 10)} onPick={iso => onSet(iso, null)} />
        : periodOptions(res).map(o => <MenuItem key={o.iso} label={o.label} selected={ini.targetResolution === res && ini.targetDate?.slice(0, 10) === o.iso} onClick={() => onSet(o.iso, res)} />)}
      {ini.targetDate && <><MenuSep /><MenuItem icon={<IconClose size={13} />} label="Clear target date" onClick={() => onSet(null, null)} /></>}
    </>
  );
}

/* ---------- roll-ups ---------- */
export function descendants(snap: Snap, id: string, seen = new Set<string>()): Initiative[] {
  const out: Initiative[] = [];
  for (const k of snap.initiatives.filter(i => i.parentId === id)) {
    if (seen.has(k.id)) continue;
    seen.add(k.id); out.push(k, ...descendants(snap, k.id, seen));
  }
  return out;
}
/** an initiative's projects, including every sub-initiative's */
export function rollupProjects(snap: Snap, ini: Initiative): Project[] {
  const ids = new Set(ini.projectIds);
  for (const d of descendants(snap, ini.id)) d.projectIds.forEach(p => ids.add(p));
  return snap.projects.filter(p => ids.has(p.id));
}
/** an initiative's progress: issues done across its projects (and its sub-initiatives' projects) */
export function initiativeProgress(snap: Snap, ini: Initiative): { pct: number; total: number; done: number; projects: number } {
  let done = 0; let total = 0;
  const projects = rollupProjects(snap, ini);
  for (const p of projects) { const pr = projectProgress(snap, p.id); done += pr.done; total += pr.total; }
  return { pct: total ? Math.round((done / total) * 100) : 0, total, done, projects: projects.length };
}
const ageShort = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h`;
  if (d < 14) return `${Math.round(d)}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${Math.round(d / 365)}y`;
};
const projectHealthKey = (snap: Snap, p: Project): ProjectHealth | 'none' => snap.projectUpdates.some(u => u.projectId === p.id) ? p.health : 'none';
/** issues completed across the roll-up in the last 7 days */
function recentlyCompleted(snap: Snap, projects: Project[]): number {
  const ids = new Set(projects.map(p => p.id)); const since = Date.now() - 7 * 86400000;
  return snap.issues.filter(i => i.projectId && ids.has(i.projectId) && i.completedAt && new Date(i.completedAt).getTime() > since).length;
}

/* ---------- small glyphs ---------- */
export function HealthIcon({ health, size = 14 }: { health: ProjectHealth | null | undefined; size?: number }) {
  const h = healthOf(health);
  if (!h) return <svg width={size} height={size} viewBox="0 0 14 14" style={{ flex: 'none' }}><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--text-dim)" strokeWidth="1.2" /></svg>;
  const d = health === 'offTrack' ? 'M3.6 5.2 5.9 7.6 7.6 6.2 10.4 9' : health === 'atRisk' ? 'M3.6 8.6 5.9 6.6 7.6 8 10.4 5.6' : 'M3.6 9 5.9 6.4 7.6 7.8 10.4 5';
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flex: 'none' }}>
      <circle cx="7" cy="7" r="7" fill={h[2]} opacity="0.2" />
      <path d={d} fill="none" stroke={h[2]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ProjectsGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flex: 'none' }}>
      <path d="M7 1.2 12.1 4.1v5.8L7 12.8 1.9 9.9V4.1L7 1.2Z" stroke="var(--brand)" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="m4.9 7.1 1.5 1.5 2.8-3" stroke="var(--brand)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ActivityGlyph({ level }: { level: 0 | 1 | 2 | 3 }) {
  if (!level) return <span className="ini-dash">—</span>;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flex: 'none' }}>
      {[0, 1, 2].map(i => <path key={i} d={`M3 ${11 - i * 3.4} 7 ${7.6 - i * 3.4} 11 ${11 - i * 3.4}`} stroke="#4cb782" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity={i < level ? 1 : 0.22} />)}
    </svg>
  );
}

/* ================= list ================= */
type Col = 'id' | 'priority' | 'labels' | 'team' | 'owner' | 'target' | 'health' | 'projects' | 'active' | 'activity' | 'status' | 'progress';
const COLS: Array<[Col, string, string]> = [
  ['id', 'ID', '44px'], ['priority', 'Priority', '52px'], ['labels', 'Labels', '128px'], ['team', 'Team', '100px'],
  ['owner', 'Owner', '56px'], ['target', 'Target', '84px'], ['health', 'Health', '138px'], ['projects', 'Projects', '76px'],
  ['active', 'Active projects', '128px'], ['activity', 'Activity', '58px'], ['status', 'Status', '104px'], ['progress', 'Progress', '104px'],
];
interface IniPrefs { health: string[]; owners: string[]; statuses: string[]; priorities: number[]; labels: string[]; order: 'manual' | 'name' | 'priority' | 'target' | 'created'; subs: boolean; summaries: boolean; cols: Record<Col, boolean>; collapsed: string[] }
const DEFAULT_PREFS: IniPrefs = {
  health: [], owners: [], statuses: [], priorities: [], labels: [], order: 'manual', subs: true, summaries: true, collapsed: [],
  cols: { id: true, priority: true, labels: true, team: false, owner: true, target: true, health: true, projects: true, active: true, activity: true, status: false, progress: false },
};
const CLEAR_FILTERS: Partial<IniPrefs> = { health: [], owners: [], statuses: [], priorities: [], labels: [] };
/** urgent first, no priority last (as Linear sorts priority) */
const priorityRank = (p: Priority) => (p === 0 ? 5 : p);

/* ---------- priority, labels, lead team ---------- */
export function InitiativeLabelChips({ ini, max = 2 }: { ini: Pick<Initiative, 'labelIds'>; max?: number }) {
  const snap = useApp(s => s.snap)!;
  const labels = snap.initiativeLabels.filter(l => ini.labelIds.includes(l.id));
  if (!labels.length) return null;
  return <span className="plabel-chips">{labels.slice(0, max).map(l => <span key={l.id} className="plabel-chip"><span className="label-dot" style={{ background: l.color }} />{l.name}</span>)}{labels.length > max && <span className="plabel-chip">+{labels.length - max}</span>}</span>;
}
function PriorityMenuItems({ value, onPick }: { value: Priority; onPick: (p: Priority) => void }) {
  return <>{([0, 1, 2, 3, 4] as Priority[]).map((v, n) => <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={PRIORITY_LABELS[v]} selected={value === v} right={<span className="kbd">{n}</span>} onClick={() => onPick(v)} />)}</>;
}
/** toggle labels on an initiative; type a name that doesn't exist to create it */
function LabelMenuBody({ ini, onChange }: { ini: Pick<Initiative, 'labelIds'>; onChange: (labelIds: string[]) => void }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list = snap.initiativeLabels.filter(l => l.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = snap.initiativeLabels.some(l => l.name.toLowerCase() === q.trim().toLowerCase());
  const toggle = (id: string) => onChange(ini.labelIds.includes(id) ? ini.labelIds.filter(x => x !== id) : [...ini.labelIds, id]);
  return (
    <>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}><input autoFocus placeholder="Add labels…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {list.map(l => { const on = ini.labelIds.includes(l.id); return (
        <button key={l.id} className="menu-item" onClick={e => { e.stopPropagation(); toggle(l.id); }}>
          <span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span><span className="mi-icon"><span className="label-dot" style={{ background: l.color }} /></span><span className="mi-label">{l.name}</span>
        </button>
      ); })}
      {q.trim() && !exact && <MenuItem icon={<IconPlus size={13} />} label={`Create label “${q.trim()}”`} onClick={async () => {
        await api.createInitiativeLabel({ name: q.trim(), color: INITIATIVE_COLORS[1 + (snap.initiativeLabels.length % (INITIATIVE_COLORS.length - 1))] });
        await refresh(); const made = useApp.getState().snap?.initiativeLabels.find(l => l.name === q.trim()); if (made) onChange([...ini.labelIds, made.id]);
      }} />}
      {!snap.initiativeLabels.length && !q && <div className="menu-empty">No initiative labels yet. Type to create one.</div>}
      <MenuSep />
      <MenuItem icon={<IconSettings size={13} />} label="Manage labels" onClick={() => navigate('/settings/initiatives')} />
    </>
  );
}
function TeamMenuItems({ value, onPick }: { value: string | null; onPick: (teamId: string | null) => void }) {
  const snap = useApp(s => s.snap)!;
  return <>{snap.teams.map(t => <MenuItem key={t.id} icon={teamDisplayIcon(t)} label={t.name} selected={value === t.id} onClick={() => onPick(t.id)} />)}<MenuSep /><MenuItem label="No lead team" selected={!value} onClick={() => onPick(null)} /></>;
}

export function InitiativesPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const { tab = 'active' } = useParams();
  const location = useLocation();
  // N then I lands here with the create dialog open
  const [creating, setCreating] = useState(() => !!(location.state as { create?: boolean } | null)?.create);
  useEffect(() => { if ((location.state as { create?: boolean } | null)?.create) setCreating(true); }, [location.state]);
  const [prefs, setPrefs] = useState<IniPrefs>(() => {
    try { const p = JSON.parse(localStorage.getItem('baseline:iniPrefs') ?? '{}'); return { ...DEFAULT_PREFS, ...p, cols: { ...DEFAULT_PREFS.cols, ...(p.cols ?? {}) }, statuses: p.statuses ?? [], priorities: p.priorities ?? [], labels: p.labels ?? [], collapsed: p.collapsed ?? [] }; } catch { return DEFAULT_PREFS; }
  });
  const patchPrefs = (p: Partial<IniPrefs>) => setPrefs(cur => { const n = { ...cur, ...p }; try { localStorage.setItem('baseline:iniPrefs', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const filterMenu = useMenu(); const displayMenu = useMenu();
  const order = (a: Initiative, b: Initiative) => prefs.order === 'name' ? a.name.localeCompare(b.name) : prefs.order === 'priority' ? priorityRank(a.priority) - priorityRank(b.priority) || a.position - b.position : prefs.order === 'target' ? (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') : prefs.order === 'created' ? b.createdAt.localeCompare(a.createdAt) : a.position - b.position;
  const matches = (i: Initiative) => (tab === 'all' || i.status === tab)
    && (!prefs.statuses.length || prefs.statuses.includes(i.status))
    && (!prefs.health.length || prefs.health.includes(i.health ?? 'none')) && (!prefs.owners.length || prefs.owners.includes(i.ownerId ?? 'none'))
    && (!prefs.priorities.length || prefs.priorities.includes(i.priority))
    && (!prefs.labels.length || prefs.labels.some(l => l === 'none' ? !i.labelIds.length : i.labelIds.includes(l)));
  // nested: a root shows when it, or anything under it, matches; children render as a tree beneath it
  const roots = snap.initiatives.filter(i => !prefs.subs || !i.parentId || !snap.initiatives.some(p => p.id === i.parentId))
    .filter(i => matches(i) || (prefs.subs && descendants(snap, i.id).some(matches))).sort(order);
  const toggle = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const filtered = prefs.health.length + prefs.owners.length + prefs.statuses.length + prefs.priorities.length + prefs.labels.length;
  const cols = COLS.filter(([k]) => prefs.cols[k]);
  const grid = `minmax(200px, 1fr) ${cols.map(c => c[2]).join(' ')}`;
  const counts = { active: snap.initiatives.filter(i => i.status === 'active').length, planned: snap.initiatives.filter(i => i.status === 'planned').length, all: snap.initiatives.length };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Initiatives' }]} right={snap.initiatives.length ? <button className="btn secondary" onClick={() => setCreating(true)} title="New initiative · N then I"><IconPlus size={13} /> New initiative</button> : undefined} />
      <div className="subnav pill-tabs">
        {([['active', 'Active', <StateIcon key="a" type="started" color="currentColor" size={13} />], ['planned', 'Planned', <StateIcon key="p" type="unstarted" color="currentColor" size={13} />], ['all', 'All initiatives', null]] as const).map(([k, l, ic]) => (
          <button key={k} className={`pill-tab${tab === k ? ' on' : ''}`} onClick={() => navigate(`/initiatives/view/${k}`)}>{ic}{l}{snap.initiatives.length > 0 && <span className="pill-count">{counts[k]}</span>}</button>
        ))}
        {/* filter and display as icon buttons at the end of the tab row, like Issues, Projects and Views */}
        {snap.initiatives.length > 0 && <>
          <span style={{ flex: 1 }} />
          {filtered > 0 && <button className="btn ghost sm dim" onClick={() => patchPrefs(CLEAR_FILTERS)}>Clear filters</button>}
          <button className={`icon-btn${filtered ? ' on' : ''}`} title={filtered ? `Filter (${filtered} active)` : 'Filter'} aria-label="Filter" onClick={filterMenu.open}><IconFilter size={15} /></button>
          <button className="icon-btn" title="Display options" aria-label="Display options" onClick={displayMenu.open}><IconDisplay size={15} /></button>
        </>}
      </div>
      {filterMenu.anchor && (
        <Menu anchor={filterMenu.anchor} onClose={filterMenu.close} width={230}>
          <MenuSub icon={<StateIcon type="started" color="var(--text-secondary)" size={13} />} label="Status" right={prefs.statuses.length ? <span className="dim">{prefs.statuses.length}</span> : undefined}>
            {INITIATIVE_STATUS.map(([k, l]) => <MenuItem key={k} icon={<InitiativeStatusIcon status={k} />} label={l} selected={prefs.statuses.includes(k)} onClick={() => patchPrefs({ statuses: toggle(prefs.statuses, k) })} />)}
          </MenuSub>
          <MenuSub icon={<PriorityIcon priority={2} size={13} />} label="Priority" right={prefs.priorities.length ? <span className="dim">{prefs.priorities.length}</span> : undefined}>
            {([1, 2, 3, 4, 0] as Priority[]).map(v => <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={PRIORITY_LABELS[v]} selected={prefs.priorities.includes(v)} onClick={() => patchPrefs({ priorities: toggle(prefs.priorities, v) })} />)}
          </MenuSub>
          <MenuSub icon={<IconTag size={13} />} label="Labels" right={prefs.labels.length ? <span className="dim">{prefs.labels.length}</span> : undefined}>
            {snap.initiativeLabels.map(l => <MenuItem key={l.id} icon={<span className="label-dot" style={{ background: l.color }} />} label={l.name} selected={prefs.labels.includes(l.id)} onClick={() => patchPrefs({ labels: toggle(prefs.labels, l.id) })} />)}
            <MenuItem label="No labels" selected={prefs.labels.includes('none')} onClick={() => patchPrefs({ labels: toggle(prefs.labels, 'none') })} />
          </MenuSub>
          <MenuSub icon={<HealthIcon health="onTrack" size={13} />} label="Health" right={prefs.health.length ? <span className="dim">{prefs.health.length}</span> : undefined}>
            {[...HEALTH.map(h => [h[0], h[1]] as [string, string]), ['none', 'No updates'] as [string, string]].map(([k, l]) => <MenuItem key={k} icon={<HealthIcon health={k as ProjectHealth} />} label={l} selected={prefs.health.includes(k)} onClick={() => patchPrefs({ health: toggle(prefs.health, k) })} />)}
          </MenuSub>
          <MenuSub icon={<IconUser size={13} />} label="Owner" right={prefs.owners.length ? <span className="dim">{prefs.owners.length}</span> : undefined}>
            {snap.users.filter(u => snap.initiatives.some(i => i.ownerId === u.id)).map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={prefs.owners.includes(u.id)} onClick={() => patchPrefs({ owners: toggle(prefs.owners, u.id) })} />)}
            <MenuItem label="No owner" selected={prefs.owners.includes('none')} onClick={() => patchPrefs({ owners: toggle(prefs.owners, 'none') })} />
          </MenuSub>
        </Menu>
      )}
      {displayMenu.anchor && (
        <Menu anchor={displayMenu.anchor} onClose={displayMenu.close} width={300}>
          <div className="dopts" onClick={e => e.stopPropagation()}>
            <div className="dopts-row"><span>Ordering</span>
              <select className="text-input" style={{ width: 130, minWidth: 0 }} aria-label="Initiative ordering" value={prefs.order} onChange={e => patchPrefs({ order: e.target.value as IniPrefs['order'] })}>
                <option value="manual">Manual</option><option value="name">Name</option><option value="priority">Priority</option><option value="target">Target date</option><option value="created">Created</option>
              </select></div>
            <div className="dopts-row"><span>Nest sub-initiatives</span><button className={`switch${prefs.subs ? ' on' : ''}`} role="switch" aria-checked={prefs.subs} onClick={() => patchPrefs({ subs: !prefs.subs })}><span /></button></div>
            <div className="dopts-row"><span>Show summaries</span><button className={`switch${prefs.summaries ? ' on' : ''}`} role="switch" aria-checked={prefs.summaries} onClick={() => patchPrefs({ summaries: !prefs.summaries })}><span /></button></div>
            <div className="dopts-head">Display properties</div>
            <div className="dopts-props">
              {COLS.map(([k, l]) => <button key={k} className={`dprop${prefs.cols[k] ? ' on' : ''}`} onClick={() => patchPrefs({ cols: { ...prefs.cols, [k]: !prefs.cols[k] } })}>{l}</button>)}
            </div>
          </div>
        </Menu>
      )}
      <div className="content">
        {!snap.initiatives.length ? (
          <div className="empty-state">
            <Illustration name="initiatives" />
            <div className="empty-title">Initiatives</div>
            <div className="empty-desc">Initiatives are larger, strategic product efforts that set the direction of your company. They are comprised of all projects that align with the goals of the initiative and allow you to monitor their progress at scale.</div>
            <div className="empty-actions"><button className="btn primary" onClick={() => setCreating(true)}>Create new initiative <span className="btn-keys"><span className="kbd">N</span>then<span className="kbd">I</span></span></button></div>
          </div>
        ) : (
          <div className="ini-table" style={{ ['--ini-grid' as string]: grid }}>
            <div className="ini-head"><span>Name</span>{cols.map(([k, l]) => <span key={k}>{l}</span>)}</div>
            {roots.map((r, n) => (
              <InitiativeRows key={r.id} ini={r} depth={0} prefs={prefs} cols={cols.map(c => c[0])} matches={matches}
                guides={[]} last={n === roots.length - 1} onToggle={id => patchPrefs({ collapsed: toggle(prefs.collapsed, id) })} />
            ))}
            {!roots.length && (
              <div className="ini-none">
                <Illustration name="initiatives" small />
                <div>No {tab === 'all' ? '' : `${tab} `}initiatives{filtered ? ' match these filters' : ''}</div>
                {filtered > 0 ? <button className="btn secondary sm" onClick={() => patchPrefs(CLEAR_FILTERS)}>Clear filters</button>
                  : <button className="btn secondary sm" onClick={() => setCreating(true)}><IconPlus size={12} /> New initiative</button>}
              </div>
            )}
          </div>
        )}
      </div>
      <AnimatePresence>{creating && <NewInitiativeModal key="ni" onClose={() => setCreating(false)} initialStatus={tab === 'active' ? 'active' : 'planned'} onCreated={id => navigate(`/initiatives/${id}`)} />}</AnimatePresence>
    </div>
  );
}

/** one initiative row plus (when nested and expanded) its sub-initiatives, with Linear's tree guides */
function InitiativeRows(props: { ini: Initiative; depth: number; prefs: IniPrefs; cols: Col[]; matches: (i: Initiative) => boolean; guides: boolean[]; last: boolean; onToggle: (id: string) => void }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const { ini, depth, prefs } = props;
  const ctx = useMenu(); const healthPop = useMenu(); const activePop = useMenu();
  const kids = prefs.subs ? snap.initiatives.filter(i => i.parentId === ini.id).sort((a, b) => a.position - b.position)
    .filter(k => props.matches(k) || descendants(snap, k.id).some(props.matches) || props.matches(ini)) : [];
  const collapsed = prefs.collapsed.includes(ini.id);
  const owner = snap.users.find(u => u.id === ini.ownerId);
  const projects = rollupProjects(snap, ini);
  const prog = initiativeProgress(snap, ini);
  const latest = snap.initiativeUpdates.find(u => u.initiativeId === ini.id);
  const live = projects.filter(p => p.status === 'started');
  const buckets = (['onTrack', 'atRisk', 'offTrack', 'none'] as const).map(k => [k, live.filter(p => projectHealthKey(snap, p) === k)] as const).filter(([, l]) => l.length);
  const recent = recentlyCompleted(snap, projects);
  const level = (recent === 0 ? 0 : recent < 3 ? 1 : recent < 6 ? 2 : 3) as 0 | 1 | 2 | 3;
  const summary = prefs.summaries ? ini.summary || '' : '';
  const iconY = summary ? 18 : 22;
  const x = (d: number) => 12 + d * 24 + 8; // icon centre at a depth
  const st = INITIATIVE_STATUS.find(s => s[0] === ini.status)!;
  const team = snap.teams.find(t => t.id === ini.teamId);
  const cell = (c: Col): React.ReactNode => {
    switch (c) {
      case 'id': return <span className="ini-key">{initiativeKey(ini)}</span>;
      case 'priority': return <span title={PRIORITY_LABELS[ini.priority]} style={{ display: 'inline-flex' }}><PriorityIcon priority={ini.priority} size={14} /></span>;
      case 'labels': return <InitiativeLabelChips ini={ini} />;
      case 'team': return team ? <span className="ini-team">{teamDisplayIcon(team)}<span className="wt-clip">{team.name}</span></span> : <span className="ini-dash">—</span>;
      case 'owner': return owner ? <Avatar user={owner} size={18} /> : <span className="ini-dash">—</span>;
      case 'target': return ini.targetDate ? <span className="ini-target">{formatTarget(ini.targetDate, ini.targetResolution)}</span> : <span className="ini-dash">—</span>;
      case 'health': return latest
        ? <button className="ini-health" style={{ color: healthOf(ini.health)?.[2] }} onClick={e => { e.stopPropagation(); healthPop.open(e); }}><HealthIcon health={ini.health} />{healthOf(ini.health)?.[1] ?? 'Update'}<span className="ini-age">· {ageShort(latest.createdAt)}</span></button>
        : <span className="ini-health none"><HealthIcon health={null} />No updates</span>;
      case 'projects': return <span className="ini-projects" title={`${projects.filter(p => p.status === 'completed').length} of ${projects.length} projects completed`}><ProjectsGlyph />{projects.length ? `${projects.filter(p => p.status === 'completed').length} / ${projects.filter(p => p.status !== 'canceled').length}` : '0'}</span>;
      case 'active': return buckets.length
        ? <button className="ini-active" onClick={e => { e.stopPropagation(); activePop.open(e); }}>{buckets.map(([k, l]) => <span key={k} className="ini-active-n"><span className="health-dot" style={{ background: k === 'none' ? 'var(--text-dim)' : healthOf(k)?.[2] }} />{l.length}</span>)}</button>
        : <span />;
      case 'activity': return <span title={recent ? `${recent} issue${recent === 1 ? '' : 's'} completed in the last 7 days` : 'No issues completed in the last 7 days'}><ActivityGlyph level={level} /></span>;
      case 'status': return <span className="ini-status"><InitiativeStatusIcon status={ini.status} size={13} />{st[1]}</span>;
      case 'progress': return <span className="ini-prog"><ProgressRing pct={prog.pct} size={14} /><span className="mono">{prog.pct}%</span></span>;
    }
  };
  return (
    <>
      <div className={`ini-row${summary ? ' has-summary' : ''}`} onClick={() => navigate(`/initiatives/${ini.id}`)} onContextMenu={ctx.open}>
        {/* tree guides: ancestors' continuations, our elbow, and the stem down to our children */}
        {props.guides.map((g, k) => g ? <span key={k} className="ini-guide" style={{ left: x(k) }} /> : null)}
        {depth > 0 && (props.last ? <span className="ini-elbow" style={{ left: x(depth - 1), height: iconY }} /> : <><span className="ini-guide" style={{ left: x(depth - 1) }} /><span className="ini-elbow" style={{ left: x(depth - 1), height: iconY }} /></>)}
        {kids.length > 0 && !collapsed && <span className="ini-guide" style={{ left: x(depth), top: iconY + 10 }} />}
        <span className="ini-name" style={{ paddingLeft: depth * 24 }}>
          <InitiativeIcon ini={ini} size={16} />
          <span className="ini-name-text">
            <span className="ini-title">
              <span className="ini-title-label">{ini.name}</span>
              {kids.length > 0 && <button className={`ini-caret${collapsed ? ' closed' : ''}`} title={collapsed ? 'Show sub-initiatives' : 'Hide sub-initiatives'} onClick={e => { e.stopPropagation(); props.onToggle(ini.id); }}><IconChevronDown size={11} /></button>}
            </span>
            {summary && <span className="ini-summary">{summary}</span>}
          </span>
        </span>
        {props.cols.map(c => <span key={c} className={`ini-cell ini-c-${c}`}>{cell(c)}</span>)}
      </div>
      {!collapsed && kids.map((k, n) => (
        <InitiativeRows key={k.id} {...props} ini={k} depth={depth + 1} guides={[...props.guides, ...(depth > 0 ? [!props.last] : [])]} last={n === kids.length - 1} />
      ))}
      {ctx.anchor && <InitiativeContextMenu ini={ini} anchor={ctx.anchor} onClose={ctx.close} />}
      {healthPop.anchor && latest && (
        <Menu anchor={healthPop.anchor} onClose={healthPop.close} width={420}>
          <UpdatePopover ini={ini} />
        </Menu>
      )}
      {activePop.anchor && (
        <Menu anchor={activePop.anchor} onClose={activePop.close} width={340}>
          <div className="menu-header"><span>Active projects</span></div>
          {buckets.flatMap(([k, l]) => l.map(p => {
            const u = snap.projectUpdates.find(x => x.projectId === p.id);
            return <MenuItem key={p.id} icon={<span className="mi-emoji">{p.icon}</span>} label={p.name}
              right={<span className="ini-pop-health"><HealthIcon health={k === 'none' ? null : k} size={12} />{u ? ageShort(u.createdAt) : 'No updates'}</span>}
              onClick={() => navigate(`/projects/${p.id}`)} />;
          }))}
        </Menu>
      )}
    </>
  );
}

function UpdatePopover({ ini }: { ini: Initiative }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const updates = snap.initiativeUpdates.filter(u => u.initiativeId === ini.id);
  const [i, setI] = useState(0);
  const u = updates[i];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowDown' || e.key === 'ArrowRight') setI(n => Math.min(updates.length - 1, n + 1)); if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') setI(n => Math.max(0, n - 1)); };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [updates.length]);
  if (!u) return null;
  const a = snap.users.find(x => x.id === u.userId); const h = healthOf(u.health);
  return (
    <div className="upd-pop" onClick={e => e.stopPropagation()}>
      <div className="upd-pop-head"><InitiativeIcon ini={ini} size={15} /><b>{ini.name}</b><span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => navigate(`/initiatives/${ini.id}/updates`, { state: { compose: true } })}><IconEdit size={12} /> Write update</button></div>
      <div className="upd-pop-meta">{h && <span style={{ color: h[2], display: 'inline-flex', alignItems: 'center', gap: 5 }}><HealthIcon health={u.health} />{h[1]}</span>}<span className="dim">· {ageShort(u.createdAt)}</span><span style={{ flex: 1 }} /><Avatar user={a} size={16} /><span className="dim">{a?.name}</span></div>
      <div className="upd-pop-body"><Markdown text={u.body} /></div>
      {updates.length > 1 && <div className="upd-pop-foot"><span className="kbd">↑</span><span className="kbd">↓</span> {i + 1} of {updates.length} updates</div>}
    </div>
  );
}

function InitiativeContextMenu({ ini, anchor, onClose }: { ini: Initiative; anchor: DOMRect; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const patch = async (b: Record<string, unknown>) => { await api.updateInitiative(ini.id, b); await refresh(); };
  return (
    <Menu anchor={anchor} onClose={onClose} width={230}>
      <MenuItem icon={<IconInitiative size={14} />} label="Open initiative" onClick={() => navigate(`/initiatives/${ini.id}`)} />
      <MenuSep />
      <MenuSub icon={<InitiativeStatusIcon status={ini.status} size={13} />} label="Status">
        {INITIATIVE_STATUS.map(([v, l]) => <MenuItem key={v} icon={<InitiativeStatusIcon status={v} />} label={l} selected={ini.status === v} onClick={() => void patch({ status: v })} />)}
      </MenuSub>
      <MenuSub icon={<PriorityIcon priority={ini.priority} size={13} />} label="Priority"><PriorityMenuItems value={ini.priority} onPick={v => void patch({ priority: v })} /></MenuSub>
      <MenuSub icon={<IconUser size={13} />} label="Owner">
        {snap.users.filter(u => u.kind !== 'agent').map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={ini.ownerId === u.id} onClick={() => void patch({ ownerId: u.id })} />)}
      </MenuSub>
      <MenuSub icon={<IconTag size={13} />} label="Labels" width={240}><LabelMenuBody ini={ini} onChange={labelIds => void patch({ labelIds })} /></MenuSub>
      <MenuSub icon={<IconTeam size={13} />} label="Lead team"><TeamMenuItems value={ini.teamId} onPick={teamId => void patch({ teamId })} /></MenuSub>
      <MenuItem icon={<IconEdit size={14} />} label="Write update" onClick={() => navigate(`/initiatives/${ini.id}/updates`, { state: { compose: true } })} />
      <MenuItem icon={<IconLink size={14} />} label="Copy link" right={<span className="kbd">⌘⇧,</span>} onClick={async () => { if (await copyText(`${location.origin}/#/initiatives/${ini.id}`)) toast('Copied initiative link'); }} />
      <MenuItem icon={<IconCopyId size={14} />} label="Copy ID" onClick={async () => { if (await copyText(initiativeKey(ini))) toast(`Copied ${initiativeKey(ini)}`); }} />
      <MenuSep />
      <MenuItem icon={<IconTrash size={14} />} danger label="Delete initiative" confirm="Delete initiative?" onClick={async () => { await api.deleteInitiative(ini.id); await refresh(); toast(`Deleted ${ini.name}`); }} />
    </Menu>
  );
}

/* ================= create ================= */
function NewInitiativeModal(props: { onClose: () => void; onCreated?: (id: string) => void; parentId?: string; initialStatus?: InitiativeStatus }) {
  const snap = useApp(s => s.snap)!;
  const { busy, guard } = useInFlight();
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('glyph:initiative');
  const [color, setColor] = useState(() => INITIATIVE_COLORS[1 + Math.floor(Math.random() * (INITIATIVE_COLORS.length - 1))]);
  const [status, setStatus] = useState<InitiativeStatus>(props.initialStatus ?? 'planned');
  const [ownerId, setOwnerId] = useState<string | null>(snap.currentUser?.id ?? null);
  const [priority, setPriority] = useState<Priority>(0);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const iconMenu = useMenu(); const statusMenu = useMenu(); const ownerMenu = useMenu(); const prioMenu = useMenu(); const labelMenu = useMenu(); const teamMenu = useMenu();
  const owner = snap.users.find(u => u.id === ownerId);
  const team = snap.teams.find(t => t.id === teamId);
  const create = guard(async () => {
    if (!name.trim()) return;
    const { initiative } = await api.createInitiative({ name: name.trim(), summary, description, icon, color, ownerId, parentId: props.parentId ?? null, status, priority, labelIds, teamId });
    await refresh(); props.onClose(); props.onCreated?.(initiative.id);
  });
  const parent = snap.initiatives.find(i => i.id === props.parentId);
  return (
    <Modal onClose={props.onClose} className="modal modal-create np-modal ini-modal">
      {/* same scaffold as New project (cm-header, np-*, cm-pills, cm-footer) so the two read as one family */}
      <div className="cm-root" onKeyDown={e => {
        if ((e.target as HTMLElement).closest?.('.menu')) return;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void create(); }
      }}>
        <div className="cm-header">
          <span className="cm-team"><IconInitiative size={13} />{parent ? parent.name : 'Initiatives'}</span>
          <span className="crumb-sep">›</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{parent ? 'New sub-initiative' : 'New initiative'}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button className="icon-btn" title="Close" aria-label="Close" onClick={props.onClose}><IconClose size={14} /></button>
          </span>
        </div>
        <div className="np-head">
          <button className="np-icon" onClick={iconMenu.open} title="Choose icon"><InitiativeIcon ini={{ icon, color }} size={20} /></button>
        </div>
        <input className="np-name" autoFocus placeholder="Initiative name" value={name} spellCheck={false} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void create(); } }} />
        <input className="np-summary" placeholder="Add a short summary…" value={summary} spellCheck={false} onChange={e => setSummary(e.target.value)} />
        <div className="cm-pills">
          <button className="prop-chip" onClick={statusMenu.open}><InitiativeStatusIcon status={status} size={13} />{INITIATIVE_STATUS.find(s => s[0] === status)?.[1]}</button>
          <button className="prop-chip" onClick={prioMenu.open}><PriorityIcon priority={priority} size={13} />{priority ? PRIORITY_LABELS[priority] : 'Priority'}</button>
          <button className="prop-chip" onClick={ownerMenu.open}>{owner ? <><Avatar user={owner} size={16} />{owner.name.split(' ')[0]}</> : <><IconUser size={13} />Owner</>}</button>
          <button className="prop-chip" onClick={teamMenu.open}>{team ? <>{teamDisplayIcon(team)}{team.name}</> : <><IconTeam size={13} />Lead team</>}</button>
          <button className="prop-chip" onClick={labelMenu.open}>{labelIds.length ? <InitiativeLabelChips ini={{ labelIds }} /> : <><IconTag size={13} />Labels</>}</button>
        </div>
        <div className="np-desc">
          <textarea placeholder="Write a description, a goal or a plan…" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div className="cm-footer">
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={props.onClose}>Cancel</button>
            <button className="btn primary" disabled={!name.trim() || busy} onClick={() => void create()}>Create initiative <span className="btn-kbd kbd">⌘↵</span></button>
          </div>
        </div>
      </div>
      {iconMenu.anchor && <Menu anchor={iconMenu.anchor} onClose={iconMenu.close} width={292}><IconPicker value={icon} color={color} onPick={p => { if (p.icon) setIcon(p.icon); if (p.color) setColor(p.color); }} /></Menu>}
      {statusMenu.anchor && <Menu anchor={statusMenu.anchor} onClose={statusMenu.close} width={200}>{INITIATIVE_STATUS.map(([v, l]) => <MenuItem key={v} icon={<InitiativeStatusIcon status={v} />} label={l} selected={status === v} onClick={() => setStatus(v)} />)}</Menu>}
      {prioMenu.anchor && <Menu anchor={prioMenu.anchor} onClose={prioMenu.close} width={200}><PriorityMenuItems value={priority} onPick={setPriority} /></Menu>}
      {teamMenu.anchor && <Menu anchor={teamMenu.anchor} onClose={teamMenu.close} width={220}><TeamMenuItems value={teamId} onPick={setTeamId} /></Menu>}
      {labelMenu.anchor && <Menu anchor={labelMenu.anchor} onClose={labelMenu.close} width={240}><LabelMenuBody ini={{ labelIds }} onChange={setLabelIds} /></Menu>}
      {ownerMenu.anchor && <Menu anchor={ownerMenu.anchor} onClose={ownerMenu.close} width={220}>{snap.users.filter(u => u.kind !== 'agent').map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={ownerId === u.id} onClick={() => setOwnerId(u.id)} />)}<MenuSep /><MenuItem label="No owner" onClick={() => setOwnerId(null)} /></Menu>}
    </Modal>
  );
}

/* ================= initiative page ================= */
export function InitiativePage() {
  const { initiativeId = '', tab: rawTab } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const routeState = useLocation().state as { compose?: boolean } | null;
  const tab = rawTab === 'projects' || rawTab === 'updates' ? rawTab : 'overview';
  // /initiatives/I-12 works as well as the id
  const ini = snap.initiatives.find(i => i.id === initiativeId) ?? (/^i-\d+$/i.test(initiativeId) ? snap.initiatives.find(i => i.number === Number(initiativeId.slice(2))) : undefined);
  useEffect(() => {
    if (!ini) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ',') { e.preventDefault(); void copyText(`${location.origin}/#/initiatives/${ini.id}`).then(ok => ok && toast('Copied initiative link')); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [ini?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ini) return <div className="empty-state"><Illustration name="initiatives" small /><div className="empty-title">Initiative not found</div><div className="empty-desc">It may have been deleted.</div><div className="empty-actions"><button className="btn secondary" onClick={() => navigate('/initiatives')}>Back to initiatives</button></div></div>;
  const chain: Initiative[] = [];
  for (let p = snap.initiatives.find(i => i.id === ini.parentId); p && !chain.includes(p); p = snap.initiatives.find(i => i.id === p!.parentId)) chain.unshift(p);
  const projects = rollupProjects(snap, ini);
  const updates = snap.initiativeUpdates.filter(u => u.initiativeId === ini.id);
  const link = `${location.origin}/#/initiatives/${ini.id}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Initiatives', to: '/initiatives', muted: true }, ...chain.map(p => ({ label: p.name, to: `/initiatives/${p.id}`, muted: true, icon: <InitiativeIcon ini={p} size={14} /> })), { label: ini.name, icon: <InitiativeIcon ini={ini} size={14} /> }]}
        favoriteRef={{ type: 'initiative', refId: ini.id }}
        right={<button className="icon-btn" title="Copy link · ⌘⇧," onClick={async () => { if (await copyText(link)) toast('Copied initiative link'); }}><IconLink size={15} /></button>}
        more={<>
          <MenuItem icon={<IconLink size={14} />} label="Copy link" onClick={async () => { if (await copyText(link)) toast('Copied initiative link'); }} />
          <MenuItem icon={<IconCopyId size={14} />} label="Copy ID" right={<span className="dim">{initiativeKey(ini)}</span>} onClick={async () => { if (await copyText(initiativeKey(ini))) toast(`Copied ${initiativeKey(ini)}`); }} />
          <MenuSub icon={<IconClock size={14} />} label="Update reminders" width={260}>
            <MenuItem label={`Workspace default (${UPDATE_CADENCE_LABELS[snap.workspace.features.initiativeUpdateCadence].toLowerCase()})`} selected={!ini.updateCadence} onClick={async () => { await api.updateInitiative(ini.id, { updateCadence: null }); await refresh(); }} />
            {(Object.keys(UPDATE_CADENCE_LABELS) as UpdateCadence[]).map(c => <MenuItem key={c} label={UPDATE_CADENCE_LABELS[c]} selected={ini.updateCadence === c} onClick={async () => { await api.updateInitiative(ini.id, { updateCadence: c }); await refresh(); }} />)}
          </MenuSub>
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete initiative" confirm="Delete initiative?" onClick={async () => { await api.deleteInitiative(ini.id); await refresh(); navigate('/initiatives'); toast(`Deleted ${ini.name}`); }} />
        </>} />
      <div className="subnav pill-tabs">
        {(['overview', 'projects', 'updates'] as const).map(t => (
          <button key={t} className={`pill-tab${tab === t ? ' on' : ''}`} onClick={() => navigate(`/initiatives/${ini.id}${t === 'overview' ? '' : `/${t}`}`)}>
            {t[0].toUpperCase() + t.slice(1)}{t === 'projects' && <span className="pill-count">{projects.length}</span>}{t === 'updates' && updates.length > 0 && <span className="pill-count">{updates.length}</span>}
          </button>
        ))}
      </div>
      <div className="content">
        {tab === 'overview' && <InitiativeOverview ini={ini} />}
        {tab === 'projects' && <div className="ini-page wide"><InitiativeProjects ini={ini} full /></div>}
        {tab === 'updates' && <InitiativeUpdatesTab ini={ini} compose={!!routeState?.compose} />}
      </div>
    </div>
  );
}

function usePatch(ini: Initiative) { return async (b: Record<string, unknown>) => { await api.updateInitiative(ini.id, b); await refresh(); }; }

function InitiativeOverview({ ini }: { ini: Initiative }) {
  const snap = useApp(s => s.snap)!;
  const patch = usePatch(ini);
  const [name, setName] = useState(ini.name);
  const [summary, setSummary] = useState(ini.summary);
  useEffect(() => { setName(ini.name); setSummary(ini.summary); }, [ini.id, ini.name, ini.summary]);
  const menu = useMenu();
  const [kind, setKind] = useState<'icon' | 'status' | 'priority' | 'owner' | 'team' | 'labels' | 'target' | 'parent' | null>(null);
  const open = (k: typeof kind) => (e: React.MouseEvent) => { setKind(k); menu.open(e); };
  const owner = snap.users.find(u => u.id === ini.ownerId);
  const parent = snap.initiatives.find(i => i.id === ini.parentId);
  const team = snap.teams.find(t => t.id === ini.teamId);
  const prog = initiativeProgress(snap, ini);
  const latest = snap.initiativeUpdates.find(u => u.initiativeId === ini.id);
  const below = new Set(descendants(snap, ini.id).map(d => d.id));
  const st = INITIATIVE_STATUS.find(s => s[0] === ini.status)!;
  return (
    <div className="ini-page">
      <button className="ini-hero-icon" onClick={open('icon')} title="Change icon"><InitiativeIcon ini={ini} size={40} tile /></button>
      <input className="proj-hero-name" value={name} onChange={e => setName(e.target.value)} spellCheck={false}
        onBlur={() => name.trim() && name !== ini.name && void patch({ name: name.trim() })} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <input className="proj-hero-summary" value={summary} placeholder="Add a short summary…" onChange={e => setSummary(e.target.value)} spellCheck={false}
        onBlur={() => summary !== ini.summary && void patch({ summary: summary.trim() })} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />

      <div className="proj-props-row">
        <span className="ppr-label">Properties</span>
        <button className="prop-chip ghost ini-key-chip" title="Copy ID" onClick={async () => { if (await copyText(initiativeKey(ini))) toast(`Copied ${initiativeKey(ini)}`); }}>{initiativeKey(ini)}</button>
        <button className="prop-chip ghost" data-iprop="status" onClick={open('status')}><InitiativeStatusIcon status={ini.status} size={13} />{st[1]}</button>
        <button className={`prop-chip ghost${ini.priority ? '' : ' dim'}`} data-iprop="priority" onClick={open('priority')}><PriorityIcon priority={ini.priority} size={13} />{ini.priority ? PRIORITY_LABELS[ini.priority] : 'Priority'}</button>
        <button className="prop-chip ghost" onClick={open('owner')}>{owner ? <><Avatar user={owner} size={16} />{owner.name}</> : <><IconUser size={13} />Owner</>}</button>
        <button className={`prop-chip ghost${team ? '' : ' dim'}`} data-iprop="team" onClick={open('team')}>{team ? <>{teamDisplayIcon(team)}{team.name}</> : <><IconTeam size={13} />Lead team</>}</button>
        <button className="prop-chip ghost" onClick={open('target')}><IconCalendar size={13} />{ini.targetDate ? formatTarget(ini.targetDate, ini.targetResolution) : 'Target date'}</button>
        <button className={`prop-chip ghost${parent ? '' : ' dim'}`} onClick={open('parent')}>{parent ? <><InitiativeIcon ini={parent} size={13} />{parent.name}</> : <><IconInitiative size={13} />Parent initiative</>}</button>
        <button className={`prop-chip ghost${ini.labelIds.length ? '' : ' dim'}`} data-iprop="labels" onClick={open('labels')}>{ini.labelIds.length ? <InitiativeLabelChips ini={ini} max={4} /> : <><IconTag size={13} />Labels</>}</button>
      </div>
      <div className="proj-props-row">
        <span className="ppr-label">Progress</span>
        <span className="prop-chip ghost static"><ProgressRing pct={prog.pct} size={13} />{prog.pct}%<span className="dim">· {prog.done} of {prog.total} issues</span></span>
        <span className="prop-chip ghost static"><ProjectsGlyph size={13} />{prog.projects} project{prog.projects === 1 ? '' : 's'}</span>
      </div>

      <Resources initiativeId={ini.id} />

      <InitiativeUpdateCard ini={ini} latest={latest} />
      <InitiativeUpdateDue ini={ini} />

      <div className="proj-section-label">Description</div>
      <div className="proj-desc"><RichEditor key={ini.id} value={ini.description} uploadTo={`initiative:${ini.id}`} placeholder="Add a description: the goal, why it matters, how you'll know it worked…" onBlur={md => md !== ini.description && void patch({ description: md })} /></div>

      <InitiativeGraph ini={ini} />
      <InitiativeProjects ini={ini} />

      {menu.anchor && kind && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={kind === 'target' ? 300 : kind === 'icon' ? 292 : kind === 'priority' ? 200 : 240}>
          {kind === 'priority' && <PriorityMenuItems value={ini.priority} onPick={v => void patch({ priority: v })} />}
          {kind === 'team' && <TeamMenuItems value={ini.teamId} onPick={teamId => void patch({ teamId })} />}
          {kind === 'labels' && <LabelMenuBody ini={ini} onChange={labelIds => void patch({ labelIds })} />}
          {kind === 'icon' && <IconPicker value={ini.icon} color={ini.color} onPick={p => void patch(p)} />}
          {kind === 'status' && INITIATIVE_STATUS.map(([v, l], n) => <MenuItem key={v} icon={<InitiativeStatusIcon status={v} />} label={l} selected={ini.status === v} right={<span className="kbd">{n + 1}</span>} onClick={() => void patch({ status: v })} />)}
          {kind === 'owner' && <>{snap.users.filter(u => u.kind !== 'agent').map(u => <MenuItem key={u.id} icon={<Avatar user={u} size={16} />} label={u.name} selected={ini.ownerId === u.id} onClick={() => void patch({ ownerId: u.id })} />)}<MenuSep /><MenuItem label="No owner" onClick={() => void patch({ ownerId: null })} /></>}
          {kind === 'target' && <TargetMenuBody ini={ini} onSet={async (iso, res) => { await patch({ targetDate: iso, targetResolution: res }); menu.close(); }} />}
          {kind === 'parent' && <>{snap.initiatives.filter(i => i.id !== ini.id && !below.has(i.id)).map(i => <MenuItem key={i.id} icon={<InitiativeIcon ini={i} size={14} />} label={i.name} selected={ini.parentId === i.id} onClick={() => void patch({ parentId: i.id })} />)}<MenuSep /><MenuItem label="No parent" onClick={() => void patch({ parentId: null })} /></>}
        </Menu>
      )}
    </div>
  );
}

function UpdateComposer({ ini, onDone }: { ini: Initiative; onDone: () => void }) {
  const [health, setHealth] = useState<ProjectHealth>(ini.health ?? 'onTrack');
  const editorRef = useRef<Editor | null>(null);
  const [body, setBody] = useState('');
  const post = (md: string) => exclusive(`ini-update-${ini.id}`, async () => { if (isBlank(md)) return; await api.addInitiativeUpdate(ini.id, md, health); await refresh(); onDone(); toast('Update posted'); });
  return (
    <div className="update-card composing">
      <div className="update-health-row">{HEALTH.map(([v, l, c]) => <button key={v} className={`health-pick${health === v ? ' on' : ''}`} style={health === v ? { color: c } : undefined} onClick={() => setHealth(v)}><HealthIcon health={v} size={13} />{l}</button>)}</div>
      <RichEditor value="" autoFocus editorRef={editorRef} uploadTo={`initiative:${ini.id}`} placeholder="How is the initiative going? What changed, what's at risk, what's next?" onChange={setBody} onSubmit={post} onEscape={onDone} />
      <div className="cbox-foot"><span className="cbox-hint">⌘↵ to post</span><button className="btn sm" onClick={onDone}>Cancel</button><button className="btn primary sm" onClick={() => void post(editorRef.current ? htmlToMarkdown(editorRef.current.getHTML()) : body)}>Post update</button></div>
    </div>
  );
}

/** the update schedule's next due date, under the update card (mirrors a project's) */
function InitiativeUpdateDue({ ini }: { ini: Initiative }) {
  const snap = useApp(s => s.snap)!;
  const cadence = ini.updateCadence ?? snap.workspace.features.initiativeUpdateCadence;
  const days = cadence === 'weekly' ? 7 : cadence === 'biweekly' ? 14 : cadence === 'monthly' ? 30 : 0;
  if (!days || ini.status === 'completed' || ini.status === 'canceled') return null;
  const last = snap.initiativeUpdates.find(u => u.initiativeId === ini.id)?.createdAt ?? ini.createdAt;
  const due = new Date(new Date(last).getTime() + days * 86400000);
  const overdue = due.getTime() < Date.now();
  const owner = snap.users.find(u => u.id === ini.ownerId);
  return <div className={`update-due${overdue ? ' overdue' : ''}`}>{overdue ? `Update overdue since ${shortDate(due.toISOString())}` : `Next update due ${shortDate(due.toISOString())}`} · {UPDATE_CADENCE_LABELS[cadence].toLowerCase()}{owner ? ` · ${owner.id === snap.currentUser.id ? 'you get' : `${owner.name} gets`} a reminder` : ''}</div>;
}

/** reactions on an initiative update, with the add-reaction button */
function UpdateReactions({ update }: { update: InitiativeUpdate }) {
  const menu = useMenu();
  const toggle = async (emoji: string) => { await api.toggleInitiativeUpdateReaction(update.id, emoji); await refresh(); };
  return (
    <>
      <ReactionChips reactions={update.reactions} onToggle={e => void toggle(e)}>
        <button className="reaction-chip add" title="Add reaction" onClick={menu.open}><IconEmoji size={13} /></button>
      </ReactionChips>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={196}>
          <div className="reaction-grid">
            {REACTION_SET.map(emoji => (
              <button key={emoji} className="reaction-pick" title={emoji} onClick={async () => { await toggle(emoji); menu.close(); }}>{emoji}</button>
            ))}
          </div>
        </Menu>
      )}
    </>
  );
}

function InitiativeUpdateCard({ ini, latest }: { ini: Initiative; latest?: Snap['initiativeUpdates'][number] }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);
  if (composing) return <UpdateComposer ini={ini} onDone={() => setComposing(false)} />;
  if (!latest) return <button className="update-card empty" onClick={() => setComposing(true)}><IconEdit size={14} /> Write the first initiative update</button>;
  const a = snap.users.find(x => x.id === latest.userId); const h = healthOf(latest.health);
  return (
    <div className="update-card">
      <div className="update-head">
        <span className="ini-label-sm">Latest update</span>
        {h && <span className="update-health" style={{ color: h[2] }}><HealthIcon health={latest.health} size={13} />{h[1]}</span>}
        <Avatar user={a} size={18} /><b>{a?.name}</b><span className="rel-time">{relTime(latest.createdAt)}</span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => navigate(`/initiatives/${ini.id}/updates`)}>All updates</button>
        <button className="btn secondary sm" onClick={() => setComposing(true)}><IconEdit size={12} /> New update</button>
      </div>
      <UpdateBody kind="initiative" id={latest.id} userId={latest.userId} body={latest.body} />
      <UpdateReactions update={latest} />
    </div>
  );
}

/* ---------- projects, grouped by the initiative they belong to ---------- */
function InitiativeProjects({ ini, full = false }: { ini: Initiative; full?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const menu = useMenu();
  const [q, setQ] = useState('');
  const [sub, setSub] = useState(false);
  // the Projects tab lays its projects out as Linear does: a list, a board by status, or a timeline
  const [layout, setLayout] = useState<'list' | 'board' | 'timeline'>(() => { try { return (localStorage.getItem('baseline:iniProjectsLayout') as 'board') || 'list'; } catch { return 'list'; } });
  const pickLayout = (l: typeof layout) => { setLayout(l); try { localStorage.setItem('baseline:iniProjectsLayout', l); } catch { /* ignore */ } };
  const shown = full ? layout : 'list';
  const groups: Array<[Initiative, Project[]]> = [ini, ...descendants(snap, ini.id)].map(i => [i, snap.projects.filter(p => i.projectIds.includes(p.id))]);
  const kids = snap.initiatives.filter(i => i.parentId === ini.id);
  const row = (p: Project, owner: Initiative) => {
    const pp = projectProgress(snap, p.id); const st = namedStatus(p, snap); const lead = snap.users.find(u => u.id === p.leadId);
    const hk = projectHealthKey(snap, p);
    return (
      <div key={`${owner.id}:${p.id}`} className="ini-proj" onClick={() => navigate(`/projects/${p.id}`)}>
        <span className="ini-proj-name"><span className="ini-proj-icon">{p.icon}</span><span className="wt-clip">{p.name}</span></span>
        <span className="ini-health sm" style={{ color: hk === 'none' ? undefined : healthOf(hk)?.[2] }}><HealthIcon health={hk === 'none' ? null : hk} size={13} />{hk === 'none' ? <span className="dim">No updates</span> : healthOf(hk)?.[1]}</span>
        {full && <span className="ini-cell">{lead ? <Avatar user={lead} size={18} /> : <span className="ini-dash">—</span>}</span>}
        <span className="ini-target">{p.targetDate ? shortDate(p.targetDate.slice(0, 10) + 'T12:00') : <span className="ini-dash">—</span>}</span>
        <span className="ini-prog"><ProgressRing pct={pp.pct} size={14} /><span className="mono">{pp.pct}%</span></span>
        <span className="ini-status"><ProjectStatusIcon status={p.status} color={st.color} size={13} />{st.name}</span>
        {owner.id === ini.id
          ? <button className="icon-btn hover-only" title="Remove from initiative" onClick={async e => { e.stopPropagation(); await api.removeInitiativeProject(ini.id, p.id); await refresh(); }}><IconClose size={12} /></button>
          : <span />}
      </div>
    );
  };
  return (
    <div className={`ini-projects-sec${full ? ' full' : ''}`}>
      <div className="proj-section-label">Projects <span className="dim">{groups.reduce((n, [, l]) => n + l.length, 0)}</span>
        {full && (
          <span className="pill-tabs ini-layouts">
            {([['list', 'List', <IconList key="l" size={13} />], ['board', 'Board', <IconBoard key="b" size={13} />], ['timeline', 'Timeline', <IconTimeline key="t" size={13} />]] as const).map(([k, l, ic]) => (
              <button key={k} className={`pill-tab${layout === k ? ' on' : ''}`} onClick={() => pickLayout(k)}>{ic}{l}</button>
            ))}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={e => { setQ(''); menu.open(e); }}><IconPlus size={12} /> Add project</button>
        <button className="btn ghost sm" onClick={() => setSub(true)}><IconPlus size={12} /> Sub-initiative</button>
      </div>
      {shown === 'board' && <div className="ini-proj-board"><ProjectBoard groups={groupProjects(rollupProjects(snap, ini), 'status', snap)} groupBy="status" /></div>}
      {shown === 'timeline' && <div className="ini-proj-timeline">{rollupProjects(snap, ini).length ? <ProjectTimeline projects={rollupProjects(snap, ini)} /> : <button className="ini-proj-empty" onClick={e => { setQ(''); menu.open(e); }}><IconPlus size={13} /> Add the projects that move this initiative forward</button>}</div>}
      {shown === 'list' && <div className={`ini-proj-table${full ? ' full' : ''}`}>
        {groups.map(([g, list]) => (g.id !== ini.id && !list.length) ? null : (
          <div key={g.id}>
            {g.id !== ini.id && <button className="ini-proj-group" onClick={() => navigate(`/initiatives/${g.id}`)}><InitiativeIcon ini={g} size={14} />{g.name}<span className="dim">{list.length}</span></button>}
            {list.map(p => row(p, g))}
            {g.id === ini.id && !list.length && <button className="ini-proj-empty" onClick={e => { setQ(''); menu.open(e); }}><IconPlus size={13} /> Add the projects that move this initiative forward</button>}
          </div>
        ))}
      </div>}
      {kids.length > 0 && !full && (
        <>
          <div className="proj-section-label">Sub-initiatives <span className="dim">{kids.length}</span></div>
          <div className="ini-sub-list">
            {kids.map(k => { const kp = initiativeProgress(snap, k); return (
              <button key={k.id} className="ini-sub" onClick={() => navigate(`/initiatives/${k.id}`)}>
                <InitiativeIcon ini={k} size={16} /><span className="ini-sub-name">{k.name}</span>{k.summary && <span className="dim wt-clip">{k.summary}</span>}<span style={{ flex: 1 }} />
                <span className="ini-health sm" style={{ color: healthOf(k.health)?.[2] }}><HealthIcon health={k.health} size={13} />{healthOf(k.health)?.[1] ?? <span className="dim">No updates</span>}</span>
                <span className="ini-prog"><ProgressRing pct={kp.pct} size={14} /><span className="mono">{kp.pct}%</span></span>
              </button>
            ); })}
          </div>
        </>
      )}
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={300}>
          <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}><input autoFocus placeholder="Add project…" value={q} onChange={e => setQ(e.target.value)} /></div>
          {snap.projects.filter(p => !ini.projectIds.includes(p.id) && p.name.toLowerCase().includes(q.toLowerCase())).map(p => (
            <MenuItem key={p.id} icon={<span className="mi-emoji">{p.icon}</span>} label={p.name} right={<ProjectStatusIcon status={p.status} color={namedStatus(p, snap).color} size={12} />} onClick={async () => { await api.addInitiativeProject(ini.id, p.id); await refresh(); }} />
          ))}
        </Menu>
      )}
      <AnimatePresence>{sub && <NewInitiativeModal key="sub" parentId={ini.id} onClose={() => setSub(false)} />}</AnimatePresence>
    </div>
  );
}

/* ---------- the initiative graph: weekly completed issues per project, stacked ---------- */
function InitiativeGraph({ ini }: { ini: Initiative }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);
  const projects = rollupProjects(snap, ini);
  const WEEKS = 16; const W = 680; const H = 150;
  const data = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7);
    const series = projects.map(p => {
      const v = new Array(WEEKS).fill(0) as number[];
      for (const i of snap.issues) {
        if (i.projectId !== p.id || !i.completedAt) continue;
        const w = Math.floor((new Date(i.completedAt).getTime() - start.getTime()) / (7 * 86400000));
        if (w >= 0 && w < WEEKS) v[w]++;
      }
      // a rate, not a tally: smooth each week with its neighbours (twice) so sparse weeks read as one curve
      let r = v;
      for (let pass = 0; pass < 2; pass++) r = r.map((n, w) => (r[w - 1] ?? n) * 0.25 + n * 0.5 + (r[w + 1] ?? n) * 0.25);
      return { p, v: r, total: v.reduce((a, b) => a + b, 0) };
    }).filter(s => s.total > 0).sort((a, b) => b.total - a.total);
    return { start, series };
  }, [snap.issues, projects.map(p => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!projects.length) return null;
  const { series, start } = data;
  const stackTop = new Array(WEEKS).fill(0) as number[];
  const layers = series.map(s => { const y0 = [...stackTop]; s.v.forEach((n, w) => { stackTop[w] += n; }); return { ...s, y0, y1: [...stackTop] }; });
  const max = Math.max(1, ...stackTop);
  const X = (w: number) => (w / (WEEKS - 1)) * W;
  const Y = (n: number) => H - (n / max) * (H - 8);
  const curve = (ys: number[], rev = false) => {
    const pts = ys.map((n, w) => [X(w), Y(n)] as const); if (rev) pts.reverse();
    return pts.map(([x, y], k) => { if (!k) return `${rev ? 'L' : 'M'}${x},${y}`; const [px, py] = pts[k - 1]; const mx = (px + x) / 2; return `C${mx},${py} ${mx},${y} ${x},${y}`; }).join(' ');
  };
  // projects without distinct colours of their own still need distinct swatches, or every legend dot reads the same
  const ownColors = layers.every(l => l.p.color) && new Set(layers.map(l => l.p.color)).size === layers.length;
  const colorOf = (l: (typeof layers)[number]) => (ownColors ? l.p.color : null) || SERIES_COLORS[layers.indexOf(l) % SERIES_COLORS.length];
  const hov = layers.find(l => l.p.id === hover);
  const end = new Date(start.getTime() + (WEEKS - 1) * 7 * 86400000);
  return (
    <div className="ini-graph">
      <div className="proj-section-label">Progress <span className="dim">completed issues per week, by project</span></div>
      {!series.length ? <div className="ini-graph-empty">No issues completed in these projects over the last {WEEKS} weeks.</div> : (
        <div className="ini-graph-box" onMouseLeave={() => setHover(null)}>
          {hov && (
            <div className="ini-graph-tip">
              <span>{hov.p.icon}</span><b>{hov.p.name}</b><span className="dim">{hov.total} completed</span>
            </div>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
            {layers.map(l => {
              const on = hover === l.p.id; const c = colorOf(l);
              return <path key={l.p.id} d={`${curve(l.y1)} ${curve(l.y0, true)} Z`} fill={on ? c : 'var(--text-primary)'} fillOpacity={on ? 0.42 : hover ? 0.03 : 0.06}
                stroke={on ? c : 'var(--text-secondary)'} strokeOpacity={on ? 0.9 : 0.45} strokeWidth="1" vectorEffect="non-scaling-stroke"
                onMouseEnter={() => setHover(l.p.id)} onClick={() => navigate(`/projects/${l.p.id}`)} style={{ cursor: 'pointer', transition: 'fill-opacity 160ms var(--ease)' }} />;
            })}
          </svg>
          <div className="ini-graph-axis"><span>{shortDate(start.toISOString())}</span><span>{shortDate(end.toISOString())}</span></div>
          <div className="ini-graph-legend">
            {layers.map(l => <button key={l.p.id} className={`ini-legend${hover === l.p.id ? ' on' : ''}`} onMouseEnter={() => setHover(l.p.id)} onClick={() => navigate(`/projects/${l.p.id}`)}><span className="health-dot" style={{ background: colorOf(l) }} />{l.p.name}<span className="dim">{l.total}</span></button>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- updates tab: the initiative's updates, optionally with its projects' ---------- */
function InitiativeUpdatesTab({ ini, compose }: { ini: Initiative; compose: boolean }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [composing, setComposing] = useState(compose);
  const [withProjects, setWithProjects] = useState(() => localStorage.getItem('baseline:iniUpdatesProjects') !== '0');
  const projects = rollupProjects(snap, ini);
  const items = [
    ...snap.initiativeUpdates.filter(u => u.initiativeId === ini.id).map(u => ({ key: u.id, at: u.createdAt, userId: u.userId, body: u.body, health: u.health, project: null as Project | null, update: u as InitiativeUpdate | null })),
    ...(withProjects ? snap.projectUpdates.filter(u => projects.some(p => p.id === u.projectId)).map(u => ({ key: u.id, at: u.createdAt, userId: u.userId, body: u.body, health: u.health, project: projects.find(p => p.id === u.projectId)!, update: null })) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="ini-page">
      <div className="ini-upd-bar">
        {!composing && <button className="btn secondary sm" onClick={() => setComposing(true)}><IconEdit size={12} /> Write update</button>}
        <span style={{ flex: 1 }} />
        <label className="ini-upd-toggle"><span>Include project updates</span>
          <button className={`switch${withProjects ? ' on' : ''}`} role="switch" aria-checked={withProjects} onClick={() => setWithProjects(v => { try { localStorage.setItem('baseline:iniUpdatesProjects', v ? '0' : '1'); } catch { /* ignore */ } return !v; })}><span /></button>
        </label>
      </div>
      {composing && <UpdateComposer ini={ini} onDone={() => setComposing(false)} />}
      {!composing && <InitiativeUpdateDue ini={ini} />}
      {!items.length && !composing && (
        <div className="ini-none tall"><Illustration name="updates" small /><div>No updates yet</div><div className="dim">Updates keep everyone aligned on how the initiative is going.</div></div>
      )}
      <div className="ini-timeline">
        {items.map(u => { const a = snap.users.find(x => x.id === u.userId); const h = healthOf(u.health); return (
          <article key={u.key} className="ini-upd">
            <header>
              {u.project ? <button className="ini-upd-src" onClick={() => navigate(`/projects/${u.project!.id}`)}><span>{u.project.icon}</span>{u.project.name}</button> : <span className="ini-upd-src static"><InitiativeIcon ini={ini} size={13} />{ini.name}</span>}
              {h && <span className="update-health" style={{ color: h[2] }}><HealthIcon health={u.health} size={13} />{h[1]}</span>}
              <span style={{ flex: 1 }} /><Avatar user={a} size={16} /><span className="dim">{a?.name} · {relTime(u.at)}</span>
            </header>
            <UpdateBody kind={u.project ? 'project' : 'initiative'} id={u.key} userId={u.userId} body={u.body} className="ini-upd-body" />
            {u.update && <UpdateReactions update={u.update} />}
          </article>
        ); })}
      </div>
    </div>
  );
}

/* ================= a project's initiatives (project properties row) ================= */
export function ProjectInitiatives({ projectId }: { projectId: string }) {
  const snap = useApp(s => s.snap)!;
  const menu = useMenu();
  if (!snap.workspace.features.initiativesEnabled) return null;
  const mine = snap.initiatives.filter(i => i.projectIds.includes(projectId));
  return (
    <>
      <button className="prop-chip ghost" data-pprop="initiatives" onClick={menu.open}>{mine[0] ? <InitiativeIcon ini={mine[0]} size={13} /> : <IconInitiative size={13} />}{mine.length ? mine.map(i => i.name).join(', ') : 'Initiatives'}</button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={240}>
          <div className="menu-header"><span>Initiatives</span></div>
          {snap.initiatives.map(i => { const on = i.projectIds.includes(projectId); return (
            <button key={i.id} className="menu-item" onClick={async e => { e.stopPropagation(); if (on) await api.removeInitiativeProject(i.id, projectId); else await api.addInitiativeProject(i.id, projectId); await refresh(); }}>
              <span className={`mi-check${on ? ' on' : ''}`}>{on && <IconCheck size={11} />}</span><span className="mi-icon"><InitiativeIcon ini={i} size={14} /></span><span className="mi-label">{i.name}</span>
            </button>
          ); })}
          {!snap.initiatives.length && <div className="menu-empty">No initiatives yet.</div>}
        </Menu>
      )}
    </>
  );
}
