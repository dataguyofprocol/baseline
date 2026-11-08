import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, refresh, setGettingStarted, resolveTheme, type ThemePref } from './store.js';
import { api } from './api.js';
import { Avatar } from './pickers.js';
import { Lockup } from './Logo.js';
import { Illustration, type IllustrationName } from './illustrations.js';
import { pickLocations } from './CodingTools.js';
import { IconCheck, IconClose, IconFolder, IconInbox, IconIssues, IconMoon, IconPlus, IconPr, IconSearch, IconTeam } from './icons.js';

const keyFromName = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'TEAM';

/* Linear's first minute: welcome, theme, team, GitHub, sample data, a ⌘K lesson, then the
   first issue. Every step can be skipped (Esc) and continued (Enter); where you are is saved
   in preferences, so a reload picks the flow back up. */
const ALL_STEPS = ['welcome', 'theme', 'team', 'github', 'sample', 'palette'] as const;
// the GitHub step links folders on this machine and reads them with its gh — a hosted server has neither
const HOSTED_STEPS = ALL_STEPS.filter(s => s !== 'github');
const TEAM_STEP = ALL_STEPS.indexOf('team'); // the same in both: team comes before github

/** Enter continues and Esc skips, wherever focus is — except Enter on an ordinary button,
 *  which presses that button. Choice buttons (theme pills, option cards) carry data-choice. */
function useStepKeys(onEnter: (() => void) | null, onEsc: (() => void) | null) {
  const ref = useRef({ onEnter, onEsc });
  ref.current = { onEnter, onEsc };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement;
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if ((t.tagName === 'BUTTON' && !t.dataset.choice) || t.tagName === 'TEXTAREA' || t.tagName === 'A') return;
        if (ref.current.onEnter) { e.preventDefault(); ref.current.onEnter(); }
      } else if (e.key === 'Escape' && ref.current.onEsc) {
        e.preventDefault(); ref.current.onEsc();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Shown while the workspace has no teams, and on a new workspace until the flow ends. */
export function Onboarding() {
  const snap = useApp(s => s.snap)!;
  const gs = snap.workspace.preferences.gettingStarted;
  const hasTeam = snap.teams.length > 0;
  const steps = snap.workspace.auth === 'hosted' ? HOSTED_STEPS : ALL_STEPS;
  // without a team the flow can't get past naming one (a workspace whose teams were all deleted lands there too)
  const [step, setStep] = useState(() => Math.min(gs.step, hasTeam ? steps.length - 1 : TEAM_STEP));
  const go = (n: number) => { setStep(n); void setGettingStarted({ step: n }); };
  const next = () => (step < steps.length - 1 ? go(step + 1) : void finish());
  const back = step > 0 ? () => go(step - 1) : undefined;

  /** the last step is the product itself: the team's issues with a blank issue open, cursor in the title */
  const finish = async () => {
    const s = useApp.getState().snap!;
    const team = s.teams[0];
    if (!team) { go(TEAM_STEP); return; }
    window.location.hash = `#/team/${team.key}/all`;
    useApp.getState().openCreate({ teamId: team.id });
    await setGettingStarted({ onboarding: 'done', step: 0, since: new Date().toISOString() });
  };

  const props: StepProps = { next, back, finish };
  const name = steps[step];
  return (
    <div className="onb">
      <div className="onb-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((s, i) => <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''} />)}
      </div>
      <div className="onb-stage" key={name}>
        {name === 'welcome' && <WelcomeStep {...props} />}
        {name === 'theme' && <ThemeStep {...props} />}
        {name === 'team' && <TeamStep {...props} />}
        {name === 'github' && <GitHubStep {...props} />}
        {name === 'sample' && <SampleStep {...props} />}
        {name === 'palette' && <PaletteStep {...props} />}
      </div>
    </div>
  );
}

interface StepProps { next: () => void; back?: () => void; finish: () => Promise<void> }

/** one step's frame: art, headline, body, and the Back · Skip · Continue footer */
function Frame(props: {
  illo?: IllustrationName; lead?: React.ReactNode; title: React.ReactNode; sub: React.ReactNode; children?: React.ReactNode; wide?: boolean;
  primary: { label: string; onClick: () => void; disabled?: boolean };
  onSkip?: () => void; skipLabel?: string; back?: () => void; error?: string;
}) {
  return (
    <div className={`onb-step${props.wide ? ' wide' : ''}`}>
      {props.lead}
      {props.illo && <div className="onb-illo"><Illustration name={props.illo} /></div>}
      <h1 className="onb-title">{props.title}</h1>
      <div className="onb-sub">{props.sub}</div>
      {props.children && <div className="onb-body">{props.children}</div>}
      {props.error && <div className="onb-error" role="alert">{props.error}</div>}
      <div className="onb-footer">
        {props.back && <button className="onb-link" onClick={props.back}>Back</button>}
        <span style={{ flex: 1 }} />
        {props.onSkip && (
          <button className="onb-link" onClick={props.onSkip}>
            {props.skipLabel ?? 'Skip'} <span className="kbd">Esc</span>
          </button>
        )}
        <button className="btn primary onb-primary" disabled={props.primary.disabled} onClick={props.primary.onClick}>
          {props.primary.label}
          <span className="btn-keys"><span className="kbd">↵</span></span>
        </button>
      </div>
    </div>
  );
}

/* ================= 1 · welcome ================= */
function WelcomeStep({ next }: StepProps) {
  const ws = useApp(s => s.snap!.workspace.name);
  const hosted = useApp(s => s.snap!.workspace.auth === 'hosted');
  useStepKeys(next, next);
  return (
    <Frame
      lead={<div className="onb-lockup"><Lockup size={30} tone="var(--text-primary)" /></div>}
      title={<>Welcome to {ws}</>}
      sub={hosted
        ? 'A shared tracker for your team and its coding agents. A minute of setup and you\'re in — every step can be skipped.'
        : 'A local-first tracker for you and your coding agents. A minute of setup and you\'re in — every step can be skipped.'}
      primary={{ label: 'Get started', onClick: next }}
      onSkip={next}
    >
      <div className="onb-points">
        <div><IconIssues size={15} /><span><b>Issues, projects and cycles</b> — {hosted ? 'shared with everyone you invite.' : 'stored in SQLite on this machine.'}</span></div>
        <div><IconPr size={15} /><span><b>GitHub-aware</b> — pull requests move their issues along.</span></div>
        <div><IconSearch size={15} /><span><b>Keyboard-first</b> — <span className="kbd">⌘</span><span className="kbd">K</span> reaches everything.</span></div>
      </div>
    </Frame>
  );
}

/* ================= 2 · theme ================= */
const THEMES: Array<[ThemePref, string]> = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];

function ThemeStep({ next, back }: StepProps) {
  const theme = useApp(s => s.theme);
  const setTheme = useApp(s => s.setTheme);
  useStepKeys(next, next);
  // ← / → walk the choices, and the whole page repaints as they change
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = THEMES.findIndex(([t]) => t === useApp.getState().theme);
      const n = (i + (e.key === 'ArrowRight' ? 1 : THEMES.length - 1)) % THEMES.length;
      e.preventDefault();
      useApp.getState().setTheme(THEMES[n][0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Frame
      wide
      title="Choose your style"
      sub="Light, dark, or follow your system. You can change it any time from the sidebar or Settings."
      primary={{ label: 'Continue', onClick: next }}
      onSkip={next}
      back={back}
    >
      <ThemeMock pref={theme} />
      <div className="onb-pills" role="radiogroup" aria-label="Theme">
        {THEMES.map(([t, label]) => (
          <button key={t} data-choice="1" role="radio" aria-checked={theme === t} className={`pill-tab${theme === t ? ' on' : ''}`} onClick={() => setTheme(t)}>
            {t === 'dark' ? <IconMoon size={13} /> : t === 'light' ? <SunGlyph /> : <SystemGlyph />}{label}
          </button>
        ))}
        <span className="onb-hint"><span className="kbd">←</span><span className="kbd">→</span></span>
      </div>
    </Frame>
  );
}

const SunGlyph = () => <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="7.5" cy="7.5" r="2.6" /><path d="M7.5 1.5v1.4M7.5 12.1v1.4M1.5 7.5h1.4M12.1 7.5h1.4M3.3 3.3l1 1M10.7 10.7l1 1M3.3 11.7l1-1M10.7 4.3l1-1" /></svg>;
const SystemGlyph = () => <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><rect x="1.8" y="2.6" width="11.4" height="7.8" rx="1.6" /><path d="M5.5 12.8h4M7.5 10.4v2.4" strokeLinecap="round" /><path d="M7.5 2.6v7.8" /></svg>;

/* the app in miniature, painted with each theme's own tokens (the live page can only wear one) */
const MOCK = {
  dark: { ground: '#09090a', page: '#121213', line: 'rgba(255,255,255,0.08)', text: '#f7f8f8', soft: '#8a8f98', dim: '#3a3b3f', active: '#232325' },
  light: { ground: '#f3f3f4', page: '#ffffff', line: 'rgba(9,9,10,0.10)', text: '#17181a', soft: '#6b6f76', dim: '#d5d6d9', active: '#e4e5e8' },
};
const MOCK_ROWS: Array<[string, number, string]> = [['#f2c94c', 128, 'started'], ['#e2e2e2', 96, 'todo'], ['#e2e2e2', 144, 'todo'], ['#5e6ad2', 110, 'done'], ['#95a2b3', 84, 'backlog']];

function MockApp({ mode }: { mode: 'dark' | 'light' }) {
  const c = MOCK[mode];
  return (
    <g>
      <rect width="400" height="220" fill={c.ground} />
      {/* sidebar */}
      <rect x="14" y="16" width="12" height="12" rx="3" fill="#5e6ad2" />
      <rect x="32" y="19" width="46" height="6" rx="3" fill={c.text} opacity="0.85" />
      {[0, 1, 2, 3].map(i => <rect key={i} x="12" y={44 + i * 20} width="86" height="14" rx="4" fill={i === 1 ? c.active : 'transparent'} />)}
      {[0, 1, 2, 3].map(i => <rect key={i} x="20" y={49 + i * 20} width={[38, 52, 30, 44][i]} height="4" rx="2" fill={i === 1 ? c.text : c.soft} opacity={i === 1 ? 0.9 : 0.7} />)}
      <rect x="20" y="138" width="34" height="4" rx="2" fill={c.soft} opacity="0.5" />
      {[0, 1].map(i => <rect key={i} x="20" y={154 + i * 18} width={[48, 40][i]} height="4" rx="2" fill={c.soft} opacity="0.7" />)}
      {/* the page panel */}
      <rect x="108" y="8" width="284" height="204" rx="8" fill={c.page} stroke={c.line} />
      <rect x="122" y="22" width="54" height="6" rx="3" fill={c.text} opacity="0.9" />
      {[0, 1, 2].map(i => <rect key={i} x={122 + i * 40} y="40" width="34" height="12" rx="6" fill={i === 0 ? c.active : 'transparent'} stroke={i === 0 ? 'none' : c.line} />)}
      <line x1="108" y1="62" x2="392" y2="62" stroke={c.line} />
      {MOCK_ROWS.map(([color, w, kind], i) => (
        <g key={i} transform={`translate(0 ${74 + i * 26})`}>
          <rect x="122" y="2" width="22" height="4" rx="2" fill={c.soft} opacity="0.6" />
          {kind === 'done'
            ? <circle cx="156" cy="4" r="4.5" fill={color} />
            : <circle cx="156" cy="4" r="4" fill="none" stroke={color} strokeWidth="1.4" strokeDasharray={kind === 'backlog' ? '2 1.6' : undefined} />}
          {kind === 'started' && <path d="M156 4 L156 0 A4 4 0 0 1 160 4 Z" fill={color} />}
          <rect x="168" y="1.5" width={w} height="5" rx="2.5" fill={c.text} opacity="0.8" />
          <circle cx="374" cy="4" r="5" fill={['#c770f4', '#4cb782', '#f2994a', '#5e6ad2', '#eb5757'][i]} opacity="0.9" />
          {i < MOCK_ROWS.length - 1 && <line x1="114" y1="17" x2="386" y2="17" stroke={c.line} />}
        </g>
      ))}
    </g>
  );
}

function ThemeMock({ pref }: { pref: ThemePref }) {
  const resolved = resolveTheme(pref);
  return (
    <div className="onb-preview" aria-label={`Preview: ${pref === 'system' ? `system (${resolved} right now)` : pref}`}>
      <svg viewBox="0 0 400 220" width="100%" role="img">
        <defs><clipPath id="onb-half"><path d="M0 0 H232 L168 220 H0 Z" /></clipPath></defs>
        {pref === 'system'
          ? <><MockApp mode="dark" /><g clipPath="url(#onb-half)"><MockApp mode="light" /></g></>
          : <MockApp mode={pref} />}
      </svg>
      {pref === 'system' && <div className="onb-preview-note">Following your system — {resolved} right now</div>}
    </div>
  );
}

/* ================= 3 · team ================= */
function TeamStep({ next, back }: StepProps) {
  const snap = useApp(s => s.snap)!;
  // coming back to this step edits the team you made rather than adding another
  const existing = snap.teams[0];
  const [name, setName] = useState(existing?.name ?? 'General');
  const [key, setKey] = useState(existing?.key ?? keyFromName('General'));
  const [keyTouched, setKeyTouched] = useState(!!existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (n: string, k: string) => {
    if (busy) return;
    k = k.trim().toUpperCase(); n = n.trim();
    if (!n || !k) { setError('A team needs a name and a key.'); return; }
    if (snap.teams.some(t => t.key === k && t.id !== existing?.id)) { setError(`The key ${k} is taken — pick another.`); return; }
    setBusy(true); setError('');
    try {
      if (!existing) await api.createTeam({ key: k, name: n });
      else if (existing.name !== n || existing.key !== k) await api.updateTeam(existing.id, { name: n, key: k });
      await refresh();
      next();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const submit = () => void save(name, key);
  // skipping still leaves a team behind — issues always live in one
  const skip = () => (existing ? next() : void save('General', keyFromName('General')));
  useStepKeys(submit, skip);

  return (
    <Frame
      illo="customers"
      title="Create your team"
      sub={<>Issues always live inside a team. Its key prefixes every issue — <b>{key || 'GEN'}-1</b>, <b>{key || 'GEN'}-2</b>…</>}
      primary={{ label: busy ? 'Saving…' : existing ? 'Continue' : 'Create team', onClick: submit, disabled: busy || !name.trim() || !key.trim() }}
      onSkip={skip}
      skipLabel={existing ? 'Skip' : 'Use “General”'}
      back={back}
      error={error}
    >
      <div className="onb-fields">
        <label className="onb-field" style={{ flex: 1 }}>
          <span className="field-label">Team name</span>
          <input className="text-input" autoFocus value={name} placeholder="e.g. Engineering"
            onChange={e => { setName(e.target.value); if (!keyTouched) setKey(keyFromName(e.target.value)); }} />
        </label>
        <label className="onb-field" style={{ width: 110 }}>
          <span className="field-label">Key</span>
          <input className="text-input mono" value={key} maxLength={7}
            onChange={e => { setKeyTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} />
        </label>
      </div>
      <div className="onb-members">
        <span className="field-label">Members</span>
        {snap.users.map(u => (
          <div key={u.id} className="onb-member">
            <Avatar user={u} size={20} />
            <span>{u.name}{u.id === snap.currentUser.id && <span className="dim"> (you)</span>}</span>
            {u.kind === 'agent' && <span className="kbd">Agent</span>}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ================= 4 · GitHub ================= */
type GitStatus = Awaited<ReturnType<typeof api.gitStatus>>;

function GitHubStep({ next, back }: StepProps) {
  const snap = useApp(s => s.snap)!;
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.gitStatus().then(setStatus).catch(() => setStatus({ source: 'login', token: null, ghInstalled: false, ghUser: null, repos: [], lastSyncAt: null, lastError: null }));
  useEffect(() => { void load(); }, []);

  const ready = !!status?.ghUser;
  const connected = snap.workspace.features.githubEnabled;
  const repoOf = (p: string) => status?.repos.find(r => r.path === p)?.repo;

  const addPath = async () => {
    const p = path.trim();
    if (!p) return;
    setError('');
    const r = await api.createLocation(p);
    if (r.error !== undefined) { setError(r.error); return; }
    setPath('');
    await refresh(); await load();
  };
  const choose = async () => {
    setError('');
    const added = await pickLocations('Choose the repositories to link', true);
    if (added.length) { await refresh(); await load(); }
  };
  const remove = async (id: string) => { await api.deleteLocation(id); await refresh(); await load(); };
  const connect = async () => {
    if (busy) return;
    if (!ready || connected) { next(); return; }
    setBusy(true);
    try { await api.setFeatures({ githubEnabled: true }); await refresh(); next(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };
  // Enter in the path box adds the path; anywhere else it connects and moves on
  useStepKeys(() => { if (document.activeElement?.getAttribute('data-path') && path.trim()) void addPath(); else void connect(); }, next);

  const gh = !status ? { tone: 'wait', text: 'Checking the GitHub CLI…' }
    : !status.ghInstalled ? { tone: 'off', text: <>GitHub CLI not found — install it with <code>brew install gh</code>, then run <code>gh auth login</code>.</> }
    : !status.ghUser ? { tone: 'off', text: <>GitHub CLI installed, not signed in — run <code>gh auth login</code>.</> }
    : { tone: 'on', text: <>Signed in to GitHub as <b>{status.ghUser}</b></> };

  return (
    <Frame
      wide
      illo="activity"
      title="Connect GitHub"
      sub="Baseline reads pull requests and commits with the GitHub CLI and links them to issues by key. Nothing is written to GitHub."
      primary={{ label: connected ? 'Continue' : ready ? (busy ? 'Connecting…' : 'Connect GitHub') : 'Continue', onClick: () => void connect(), disabled: busy }}
      onSkip={next}
      back={back}
      error={error}
    >
      <div className={`onb-status ${gh.tone}`}>
        <span className="onb-dot" />
        <span style={{ flex: 1 }}>{gh.text}</span>
        {status && !ready && <button className="btn secondary sm" onClick={() => { setStatus(null); void load(); }}>Check again</button>}
        {connected && <span className="onb-ok"><IconCheck size={13} /> Connected</span>}
      </div>
      <div className="onb-section">
        <span className="field-label">Repositories</span>
        <span className="field-help">The folders on this machine Baseline syncs — any whose <code>origin</code> is on GitHub.</span>
      </div>
      <div className="onb-repos">
        {snap.locations.map(l => (
          <div key={l.id} className="onb-repo">
            <IconFolder size={14} />
            <span className="onb-repo-name">{l.name}<span className="dim mono"> {l.path}</span></span>
            <span className={`onb-repo-tag${repoOf(l.path) ? '' : ' dim'}`}>{status ? repoOf(l.path) ?? 'not a GitHub repo' : '…'}</span>
            <button className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => void remove(l.id)}><IconClose size={12} /></button>
          </div>
        ))}
        <div className="onb-repo add">
          <IconPlus size={14} />
          <input className="onb-path mono" data-path="1" value={path} onChange={e => setPath(e.target.value)} placeholder="Paste a repository path, e.g. ~/code/my-app" aria-label="Repository path" />
          {path.trim() ? <button className="btn sm" onClick={() => void addPath()}>Add</button> : <button className="btn secondary sm" onClick={() => void choose()}>Choose folders…</button>}
        </div>
      </div>
    </Frame>
  );
}

/* ================= 5 · sample data ================= */
function SampleStep({ next, back }: StepProps) {
  const [choice, setChoice] = useState<'sample' | 'empty'>('sample');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (busy) return;
    if (choice === 'empty') { next(); return; }
    setBusy(true);
    // the server loads it once per workspace, so coming back to this step can't double it
    try { await api.loadSampleData(); await refresh(); next(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };
  useStepKeys(() => void go(), next);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); setChoice(c => (c === 'sample' ? 'empty' : 'sample'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const option = (k: 'sample' | 'empty', illo: IllustrationName, title: string, desc: string) => (
    <button data-choice="1" role="radio" aria-checked={choice === k} className={`onb-option${choice === k ? ' on' : ''}`} onClick={() => setChoice(k)} onDoubleClick={() => void go()}>
      <Illustration name={illo} small />
      <span className="onb-option-title">{title}{choice === k && <IconCheck size={13} />}</span>
      <span className="onb-option-desc">{desc}</span>
    </button>
  );
  return (
    <Frame
      wide
      title="Start with sample data?"
      sub="A demo workspace is the quickest way to see how everything fits. It sits beside your team, so you can delete it later."
      primary={{ label: busy ? 'Loading sample data…' : choice === 'sample' ? 'Load sample data' : 'Start empty', onClick: () => void go(), disabled: busy }}
      onSkip={next}
      back={back}
      error={error}
    >
      <div className="onb-options" role="radiogroup" aria-label="Sample data">
        {option('sample', 'projects', 'Load sample data', 'Two demo teams with projects, cycles, initiatives, an inbox and a pull request to explore.')}
        {option('empty', 'drafts', 'Start empty', 'Just your team. Your first issue is one step away.')}
      </div>
    </Frame>
  );
}

/* ================= 6 · the ⌘K lesson ================= */
const LESSON_COMMANDS: Array<{ id: string; label: string; icon: React.ReactNode; hint?: string }> = [
  { id: 'issue', label: 'Create new issue', icon: <IconPlus size={14} />, hint: 'C' },
  { id: 'inbox', label: 'Go to inbox', icon: <IconInbox size={14} />, hint: 'G I' },
  { id: 'team', label: 'Go to your team’s issues', icon: <IconTeam size={14} />, hint: 'G T' },
  { id: 'theme', label: 'Switch theme', icon: <IconMoon size={14} /> },
  { id: 'search', label: 'Search issues', icon: <IconSearch size={14} />, hint: '/' },
];

function PaletteStep({ back, finish }: StepProps) {
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const items = LESSON_COMMANDS.filter(c => c.label.toLowerCase().includes(q.trim().toLowerCase()));
  const show = () => { setOpen(true); setUsed(true); setQ(''); setIndex(0); void setGettingStarted({ usedPalette: true }); };
  const close = () => setOpen(false);
  const run = (id: string | undefined) => {
    if (id === 'issue') { void finish(); return; }
    if (id === 'theme') { const s = useApp.getState(); s.setTheme(s.resolvedTheme === 'dark' ? 'light' : 'dark'); }
    close();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (open) close(); else show(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // with the palette up, Enter and Esc belong to it
  useStepKeys(open ? null : () => used && void finish(), open ? null : () => void finish());

  return (
    <Frame
      illo="search"
      title={used ? 'That’s the command menu' : <>Press <span className="kbd onb-kbd">⌘</span> <span className="kbd onb-kbd">K</span></>}
      sub={used
        ? 'It works on every page: create, jump, change any property of the issues you’ve selected. Pick “Create new issue” there, or continue, to write your first issue.'
        : 'Everything in Baseline is a few keystrokes away. Open the command menu once to continue.'}
      primary={{ label: 'Create your first issue', onClick: () => void finish(), disabled: !used }}
      onSkip={() => void finish()}
      back={back}
    >
      {!used && <button className="onb-try" onClick={show}><IconSearch size={14} /> Type a command or search… <span className="onb-try-keys"><span className="kbd">⌘</span><span className="kbd">K</span></span></button>}
      {/* portalled: the step's entrance animation would otherwise trap the fixed scrim */}
      {open && createPortal(
        <div className="onb-palette-scrim" onMouseDown={close}>
          <div className="onb-palette" role="dialog" aria-label="Command menu" onMouseDown={e => e.stopPropagation()}>
            <input autoFocus className="onb-palette-input" placeholder="Type a command or search…" value={q}
              onChange={e => { setQ(e.target.value); setIndex(0); }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, items.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); run(items[index]?.id); }
                else if (e.key === 'Escape') { e.preventDefault(); close(); }
              }} />
            <div className="onb-palette-list">
              {items.map((c, i) => (
                <button key={c.id} className={`onb-palette-item${i === index ? ' on' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => run(c.id)}>
                  {c.icon}<span style={{ flex: 1 }}>{c.label}</span>{c.hint && <span className="onb-palette-hint">{c.hint.split(' ').map(k => <span key={k} className="kbd">{k}</span>)}</span>}
                </button>
              ))}
              {!items.length && <div className="onb-palette-empty">No commands match</div>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </Frame>
  );
}
