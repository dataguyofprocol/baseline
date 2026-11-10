import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, refresh, relTime, setGettingStarted, copyText } from './store.js';
import { api } from './api.js';
import { MenuItem } from './ui.js';
import { InviteModal } from './Members.js';
import { reducedMotion } from './motion.js';
import { AgentDemo, GitHubDemo, InviteDemo, IssueDemo } from './SetupDemos.js';
import { IconAgent, IconChevronDown, IconChevronRight, IconClose, IconCopy, IconPlus, IconUsers } from './icons.js';
import type { Snapshot } from '../../src/core/types.js';

const GithubGlyph = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

/* Setup happens inside the app: a panel docked on the team's issues view while
   gettingStarted.onboarding is 'pending', and one help menu item that reopens it. Both read the
   same registry, so there is only ever one checklist. */

type SetupItemId = 'agent' | 'invite' | 'github' | 'issue';
interface SetupCtx { hosted: boolean; admin: boolean; canInvite: boolean }
/** `teamId`: the team whose issues the panel sits on, null on My issues */
type BodyProps = { teamId: string | null };

const SETUP_ITEMS: Array<{ id: SetupItemId; title: string; when(c: SetupCtx): boolean; done(s: Snapshot): boolean; Body: ComponentType<BodyProps> }> = [
  { id: 'agent', title: 'Connect your coding agent', when: () => true, done: s => !!agentConnection(s), Body: AgentBody },
  {
    id: 'invite', title: 'Invite your team', when: c => c.hosted && c.canInvite, Body: InviteBody,
    done: s => !!s.invitesSent || s.users.some(u => u.kind === 'human' && u.status === 'active' && u.id !== s.currentUser.id),
  },
  { id: 'github', title: 'Connect GitHub', when: c => c.admin, done: s => s.workspace.features.githubEnabled, Body: GitHubBody },
  {
    id: 'issue', title: 'Create your first issue', when: () => true, Body: IssueBody,
    done: s => {
      const since = s.workspace.preferences.gettingStarted.since ?? s.workspace.createdAt;
      return s.issues.some(i => i.creatorId === s.currentUser.id && i.createdAt > since && !i.deletedAt);
    },
  },
];

/** each item's colour in the onboarding palette, its row glyph, and the line a closed row shows */
const LOOK: Record<SetupItemId, { hue: string; Glyph: ComponentType<{ size?: number }>; teaser: string }> = {
  agent: { hue: 'var(--ob-indigo)', Glyph: IconAgent, teaser: 'It moves its own issues' },
  invite: { hue: 'var(--ob-apricot)', Glyph: IconUsers, teaser: 'Work next to the people you build with' },
  github: { hue: 'var(--ob-teal)', Glyph: GithubGlyph, teaser: 'Pull requests move issues for you' },
  issue: { hue: 'var(--ob-indigo)', Glyph: IconPlus, teaser: 'Press C anywhere' },
};

function setupItems(s: Snapshot) {
  const ctx: SetupCtx = {
    hosted: s.workspace.auth === 'hosted',
    admin: s.currentUser.admin,
    canInvite: s.currentUser.admin || s.workspace.security.whoCanInvite === 'members',
  };
  return SETUP_ITEMS.filter(i => i.when(ctx)).map(i => ({ ...i, isDone: i.done(s) }));
}

const myTeams = (s: Snapshot) => s.teams.filter(t => t.memberIds.includes(s.currentUser.id));

/** where the panel lives for this person: their first team's issues, or My issues without a team */
export function setupHome(s: Snapshot): string {
  const team = myTeams(s)[0];
  return team ? `/team/${team.key}/all` : '/my-issues';
}

/** When your agent last reached Baseline: a key of yours used over MCP, or (local stdio, which has
 *  no key) anything it wrote as "Agent via you". */
function agentConnection(s: Snapshot): { name: string | null; at: string } | null {
  const me = s.currentUser.id;
  const key = (s.myApiKeys ?? []).filter(k => k.lastUsedAt).sort((a, b) => b.lastUsedAt!.localeCompare(a.lastUsedAt!))[0];
  if (key) return { name: key.name, at: key.lastUsedAt! };
  const wrote = s.activity.find(a => a.viaUserId === me) ?? s.comments.find(c => c.viaUserId === me);
  return wrote ? { name: null, at: wrote.createdAt } : null;
}

/** For the page that hosts the panel: whether it shows and is expanded, so the page can drop its
 *  own empty-state call to action while the panel offers one. */
export function useSetupPanel() {
  const shown = useApp(s => s.snap!.workspace.preferences.gettingStarted.onboarding === 'pending');
  const [expanded, setExpanded] = useState(() => !agentConnection(useApp.getState().snap!));
  const [wasShown, setWasShown] = useState(shown);
  // reopened from the help menu: open it fully
  if (shown !== wasShown) { setWasShown(shown); if (shown) setExpanded(true); }
  return { shown, expanded, setExpanded };
}

export function SetupPanel(props: { teamId: string | null; expanded: boolean; setExpanded: (v: boolean) => void }) {
  const snap = useApp(s => s.snap)!;
  const items = setupItems(snap);
  const [open, setOpen] = useState<SetupItemId | null>(() => items.find(i => !i.isDone)?.id ?? null);
  const done = items.filter(i => i.isDone).length;
  const allDone = done === items.length;
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => void setGettingStarted({ onboarding: 'done' }), 2500);
    return () => clearTimeout(t);
  }, [allDone]);
  const justDone = useJustDone(items);

  const gs = snap.workspace.preferences.gettingStarted;
  const teams = myTeams(snap).map(t => t.name);
  const { expanded, setExpanded } = props;
  return (
    <div className="setup-wrap">
      <section className={`setup-panel${expanded ? '' : ' collapsed'}${allDone ? ' all-done' : ''}`} aria-label="Set up Baseline">
        <div className="setup-head">
          <button className="setup-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
            <ProgressRing items={items} size={16} />
            <span className="setup-title">Set up Baseline</span>
            <span className="setup-count"><span key={done} className="setup-count-n">{done}</span> of {items.length} done</span>
          </button>
          <button className="icon-btn" aria-label="Close setup" title="Close. Reopen it from the help menu." onClick={() => void setGettingStarted({ onboarding: 'done' })}>
            <IconClose size={13} />
          </button>
        </div>
        <Reveal open={expanded}>
          {gs.flow === 'join' && (
            <div className="setup-banner">
              You've joined <b>{snap.workspace.name}</b>.{teams.length > 0 && <> Your team is <b>{listNames(teams)}</b>.</>}
            </div>
          )}
          {items.map(({ id, title, isDone, Body }) => (
            <div key={id} className={`setup-item item-${id}${open === id ? ' open' : ''}${isDone ? ' done' : ''}`} style={{ ['--hue' as string]: LOOK[id].hue }}>
              <button className="setup-row" aria-expanded={open === id} onClick={() => setOpen(o => (o === id ? null : id))}>
                <CheckCircle done={isDone} celebrate={justDone.has(id)} Glyph={LOOK[id].Glyph} />
                <span className="setup-label">{title}</span>
                {id === 'agent' && !isDone && <span className="setup-tag">Start here</span>}
                {!isDone && open !== id && <span className="setup-teaser">{LOOK[id].teaser}</span>}
              </button>
              <Reveal open={open === id}>
                <div className="setup-body"><Body teamId={props.teamId} /></div>
              </Reveal>
            </div>
          ))}
          {allDone && <AllSet items={items} />}
        </Reveal>
      </section>
    </div>
  );
}

const listNames = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** items that flipped to done since the panel mounted, for the 700ms after they flip */
function useJustDone(items: Array<{ id: SetupItemId; isDone: boolean }>) {
  const seen = useRef(new Map(items.map(i => [i.id, i.isDone])));
  const [fresh, setFresh] = useState<ReadonlySet<SetupItemId>>(new Set());
  const signature = items.map(i => `${i.id}:${i.isDone ? 1 : 0}`).join(',');
  useEffect(() => {
    const flipped = items.filter(i => i.isDone && seen.current.get(i.id) === false).map(i => i.id);
    for (const i of items) seen.current.set(i.id, i.isDone);
    if (flipped.length === 0) return;
    setFresh(new Set(flipped));
    const t = setTimeout(() => setFresh(new Set()), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return fresh;
}

/** Height and opacity in and out. Children stay mounted through the close, then unmount. */
function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      let inner = 0;
      // two frames: the closed state has to paint once for the transition to have a start
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), reducedMotion() ? 0 : 300);
    return () => clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  return (
    <div className={`reveal${shown ? ' shown' : ''}`} inert={!open || undefined}>
      <div className="reveal-inner">{children}</div>
    </div>
  );
}

/** a short spray of dots around a check that just turned done */
function Burst() {
  if (reducedMotion()) return null;
  return (
    <span className="burst" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ ['--a' as string]: `${i * 36 + (i % 2) * 12}deg`, ['--d' as string]: `${i % 2 ? 11 : 15}px` }} />)}
    </span>
  );
}

function CheckCircle({ done, celebrate, Glyph }: { done: boolean; celebrate: boolean; Glyph: ComponentType<{ size?: number }> }) {
  return (
    <span className="setup-check">
      {done
        ? <svg width="15" height="15" viewBox="0 0 15 15" aria-label="Done"><circle className={celebrate ? 'st-fill' : undefined} cx="7.5" cy="7.5" r="6.5" fill="var(--hue, var(--brand))" /><path className={celebrate ? 'st-check' : undefined} d="m4.8 7.7 1.9 1.9 3.6-4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        : <span className="setup-tile" role="img" aria-label="Not done"><Glyph size={12} /></span>}
      {celebrate && <Burst />}
    </span>
  );
}

function AllSet({ items }: { items: Array<{ id: SetupItemId; isDone: boolean }> }) {
  return (
    <div className="setup-all" role="status">
      <span className="setup-all-ring"><ProgressRing items={items} size={30} /><Burst /></span>
      <span>
        <span className="setup-all-title">All set.</span>
        <span className="setup-all-line">Everything here is done. This panel tucks away in a moment, and the help menu brings it back.</span>
      </span>
    </div>
  );
}

/** the help menu's way back to the panel, with the same progress */
export function SetupMenuItem() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const items = setupItems(snap);
  const done = items.filter(i => i.isDone).length;
  return (
    <MenuItem icon={<ProgressRing items={items} size={14} />} label="Set up Baseline" right={<span className="mi-kbd">{done}/{items.length}</span>}
      onClick={() => { void setGettingStarted({ onboarding: 'pending' }); navigate(setupHome(snap)); }} />
  );
}

/** One arc per item, in that item's colour once it is done. */
function ProgressRing({ items, size }: { items: Array<{ id: SetupItemId; isDone: boolean }>; size: number }) {
  const r = 5.6, gap = items.length > 1 ? 0.5 : 0;
  const per = (2 * Math.PI) / items.length;
  const arc = (i: number) => {
    const a0 = i * per + gap / 2 - Math.PI / 2, a1 = (i + 1) * per - gap / 2 - Math.PI / 2;
    const p = (a: number) => `${(7.5 + r * Math.cos(a)).toFixed(3)} ${(7.5 + r * Math.sin(a)).toFixed(3)}`;
    return items.length === 1 ? `M 7.5 1.9 A ${r} ${r} 0 1 1 7.49 1.9` : `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`;
  };
  return (
    <svg className="progress-ring" width={size} height={size} viewBox="0 0 15 15" aria-hidden="true">
      {items.map((it, i) => (
        <g key={it.id}>
          <path d={arc(i)} fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.8" strokeLinecap="round" />
          <path className={`pr-arc${it.isDone ? ' on' : ''}`} d={arc(i)} fill="none" stroke={LOOK[it.id].hue} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

/* ================= shared body layout: the mock, a headline and three reasons, then the action ================= */
/** `head`'s `<em>` is its key phrase, set in the item's colour */
function Pitch({ demo, head, reasons, children }: { demo: ReactNode; head: ReactNode; reasons: ReactNode[]; children: ReactNode }) {
  return (
    <div className="pitch">
      <div className="pitch-copy">
        <div className="pitch-head">{head}</div>
        <ul className="pitch-reasons">
          {reasons.map((r, i) => <li key={i} style={{ ['--i' as string]: i }}>{r}</li>)}
        </ul>
        <div className="pitch-action">{children}</div>
      </div>
      <div className="pitch-demo">{demo}</div>
    </div>
  );
}

/** a key in this team's format, for the mocks */
function demoKey(snap: Snapshot, teamId: string | null, next = false): string {
  const team = snap.teams.find(t => t.id === teamId) ?? myTeams(snap)[0];
  const key = team?.key ?? 'WEB';
  if (!next) return `${key}-12`;
  const top = snap.issues.filter(i => i.teamId === team?.id).reduce((m, i) => Math.max(m, i.number), 0);
  return `${key}-${top + 1}`;
}

/* ================= agent ================= */
const HARNESSES = [['claude', 'Claude Code'], ['codex', 'Codex'], ['pi', 'pi']] as const;
type Harness = typeof HARNESSES[number][0];

/** How each harness adds a streamable HTTP MCP server with a bearer key. Codex: `http_headers` in
 *  config.toml (learn.chatgpt.com/docs/extend/mcp). pi: `url` + `headers` in ~/.pi/agent/mcp.json
 *  (pi.dev/docs/latest/mcp). */
function connectSnippet(h: Harness, url: string, token: string): { where: string; text: string } {
  if (h === 'claude') return { where: 'Run this in your terminal', text: `claude mcp add --transport http baseline ${url} --header "Authorization: Bearer ${token}"` };
  if (h === 'codex') return { where: 'Add this to ~/.codex/config.toml', text: `[mcp_servers.baseline]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }` };
  return {
    where: 'Add this to ~/.pi/agent/mcp.json, next to any servers already there',
    text: JSON.stringify({ mcpServers: { baseline: { url, headers: { Authorization: `Bearer ${token}` }, exposure: 'direct' } } }, null, 2),
  };
}

// a key's token is shown once, so it outlives the panel being closed or the page changing
let minted: { keyId: string; token: string } | null = null;

function AgentBody({ teamId }: BodyProps) {
  const snap = useApp(s => s.snap)!;
  const [harness, setHarness] = useState<Harness>('claude');
  const [key, setKey] = useState(minted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = HARNESSES.find(([k]) => k === harness)![1];

  const createKey = async () => {
    if (busy || key) return;
    setBusy(true); setError('');
    try {
      const r = await api.createApiKey({ name: label, scopes: null, teamIds: null });
      minted = { keyId: r.key.id, token: r.token };
      setKey(minted);
      await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const mine = key && snap.myApiKeys?.find(k => k.id === key.keyId);
  const connection = mine ? (mine.lastUsedAt ? { name: mine.name, at: mine.lastUsedAt } : null) : agentConnection(snap);
  const justConnected = useJustTrue(!!connection);
  const snippet = key && connectSnippet(harness, `${window.location.origin}/mcp`, key.token);
  const openTypes = new Set(snap.states.filter(st => st.type !== 'completed' && st.type !== 'canceled').map(st => st.id));
  const assigned = snap.issues.find(i => i.assigneeId === snap.currentUser.id && openTypes.has(i.stateId) && !i.deletedAt);
  const assignedKey = assigned && `${snap.teams.find(t => t.id === assigned.teamId)?.key ?? 'ISS'}-${assigned.number}`;
  const joined = snap.workspace.preferences.gettingStarted.flow === 'join';

  return (
    <Pitch
      demo={<AgentDemo issueKey={demoKey(snap, teamId)} me={snap.currentUser} />}
      head={joined ? <><em>Bring your own agent.</em> Its work lands here as yours.</> : <>Hand an issue to your agent and <em>watch it move.</em></>}
      reasons={[
        'It starts the issue: In Progress, assigned to you, with a branch name. At the end it marks it done, in review or stopped.',
        'It keeps one live progress note on the issue, and sends work it discovers to Triage for you to review.',
        'Every change shows as Agent via you and can be undone. It can also draft project updates for a person to publish.',
      ]}
    >
      <div className="setup-help">Works with Claude Code, Codex and pi. Setup is one command, with an API key of its own.</div>
      <div className="setup-pills" role="radiogroup" aria-label="Coding agent">
        {HARNESSES.map(([k, name]) => (
          <button key={k} role="radio" aria-checked={harness === k} className={`pill-tab${harness === k ? ' on' : ''}`} onClick={() => setHarness(k)}>{name}</button>
        ))}
      </div>
      {snippet ? (
        <>
          <div className="setup-help"><span className="field-label">{snippet.where}.</span> The key is shown once, so copy it now.</div>
          <CopyBlock text={snippet.text} />
        </>
      ) : (
        <div><button className="btn primary sm" disabled={busy} onClick={() => void createKey()}>{busy ? 'Creating…' : 'Create a key'}</button></div>
      )}
      {(key || connection) && (
        <div className={`setup-status ${connection ? 'on' : 'wait'}`} aria-live="polite">
          {connection
            ? <span className="setup-linked"><svg width="14" height="14" viewBox="0 0 15 15" aria-hidden="true"><circle className={justConnected ? 'st-fill' : undefined} cx="7.5" cy="7.5" r="6.5" fill="var(--green)" /><path className={justConnected ? 'st-check' : undefined} d="m4.8 7.7 1.9 1.9 3.6-4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>{justConnected && <Burst />}</span>
            : <span className="setup-dot" />}
          {connection
            ? <span>Connected. {connection.name ?? 'Your agent'} reached Baseline {relTime(connection.at)}.</span>
            : <span>Waiting for {mine?.name ?? label} to connect…</span>}
        </div>
      )}
      {assignedKey && <div className="setup-help">Ask it to pick up an issue: <code>Start {assignedKey}</code></div>}
      {error && <div className="setup-error" role="alert">Couldn't create a key: {error}</div>}
    </Pitch>
  );
}

/** true for 900ms after `value` turns from false to true while mounted */
function useJustTrue(value: boolean) {
  const was = useRef(value);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const flipped = value && !was.current;
    was.current = value;
    if (!flipped) return;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), 900);
    return () => clearTimeout(t);
  }, [value]);
  return fresh;
}

function CopyBlock({ text }: { text: string }) {
  const copy = async () => {
    const { toast } = useApp.getState();
    if (await copyText(text)) toast({ title: 'Copied' });
    else toast({ title: 'Clipboard unavailable', line: 'bring the app tab into focus and retry' });
  };
  return (
    <div className="setup-cmd">
      <pre>{text}</pre>
      <button className="btn secondary sm" onClick={() => void copy()}><IconCopy size={13} /> Copy</button>
    </div>
  );
}

/* ================= the rest ================= */
function InviteBody({ teamId }: BodyProps) {
  const snap = useApp(s => s.snap)!;
  const [inviting, setInviting] = useState(false);
  const team = snap.teams.find(t => t.id === teamId) ?? myTeams(snap)[0];
  return (
    <Pitch
      demo={<InviteDemo me={snap.currentUser} team={team?.name ?? 'Your team'} issueKey={demoKey(snap, teamId)} />}
      head={<>Bring in <em>the people you build with.</em></>}
      reasons={[
        'Assign issues, @mention teammates and triage together.',
        'Get notified when an agent finishes.',
        'Each person connects their own agent, and its work is attributed to them.',
      ]}
    >
      <div className="setup-help">Invites work as a copyable link, even without email set up.</div>
      <div><button className="btn secondary sm" onClick={() => setInviting(true)}>Invite people</button></div>
      {inviting && <InviteModal teamIds={teamId ? [teamId] : undefined} onClose={() => setInviting(false)} onDone={refresh} />}
    </Pitch>
  );
}

function GitHubBody({ teamId }: BodyProps) {
  const navigate = useNavigate();
  const snap = useApp(s => s.snap)!;
  const hosted = snap.workspace.auth === 'hosted';
  const issueKey = demoKey(snap, teamId);
  return (
    <Pitch
      demo={<GitHubDemo issueKey={issueKey} />}
      head={<>Pull requests <em>move their issues for you.</em></>}
      reasons={[
        'Open or draft moves the issue to In Progress, review to In Review, merged to Done. Each team sets its own rules.',
        <>PRs and commits show on the issue. Branch names and words like <code>Fixes {issueKey}</code> link the work.</>,
        'Read-only by design. Nothing is written to GitHub, and the token never reaches the browser.',
      ]}
    >
      <div className="setup-help">
        {hosted ? 'Paste a read-only token.' : 'Link your repositories.'} It syncs every 2 minutes, or in real time with webhooks.
      </div>
      <div><button className="btn secondary sm" onClick={() => navigate('/settings/github')}>Open GitHub settings</button></div>
    </Pitch>
  );
}

function IssueBody({ teamId }: BodyProps) {
  const snap = useApp(s => s.snap)!;
  const joined = snap.workspace.preferences.gettingStarted.flow === 'join';
  const nextKey = demoKey(snap, teamId, true);
  return (
    <Pitch
      demo={<IssueDemo issueKey={nextKey} />}
      head={joined ? <>Add an issue, or <em>hand one to your agent.</em></> : <>Write down <em>the first thing to do.</em></>}
      reasons={[
        <>Press <span className="kbd">C</span> anywhere to write one.</>,
        'Or hand it to your agent, which can start it in one prompt.',
        `It gets the team's next key, like ${nextKey}.`,
      ]}
    >
      <div><button className="btn secondary sm" onClick={() => useApp.getState().openCreate(teamId ? { teamId } : {})}>New issue</button></div>
    </Pitch>
  );
}
