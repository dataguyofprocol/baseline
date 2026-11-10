import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, refresh, relTime, setGettingStarted, copyText } from './store.js';
import { api } from './api.js';
import { MenuItem } from './ui.js';
import { InviteModal } from './Members.js';
import { GitHubSetup } from './GitHubSetup.js';
import { StatusDone, StatusStarted, StatusTodo, IconChevronDown, IconChevronRight, IconClose, IconCopy, IconShieldUser } from './icons.js';
import type { Snapshot } from '../../src/core/types.js';
import { takeSetupStep } from './Onboarding.js';

type SetupItemId = 'agent' | 'invite' | 'github' | 'issue';
interface SetupCtx { hosted: boolean; admin: boolean; canInvite: boolean }
type BodyProps = { teamId: string | null; eyebrow: string; onDone: () => void };

const SETUP_ITEMS: Array<{ id: SetupItemId; title: string; minutes: number; when(c: SetupCtx): boolean; done(s: Snapshot): boolean; Body: ComponentType<BodyProps> }> = [
  { id: 'agent', title: 'Connect your coding agent', minutes: 2, when: () => true, done: s => !!agentConnection(s), Body: AgentBody },
  {
    id: 'invite', title: 'Invite your team', minutes: 1, when: c => c.hosted && c.canInvite, Body: InviteBody,
    done: s => !!s.invitesSent || teammates(s).length > 0,
  },
  { id: 'github', title: 'Connect GitHub', minutes: 3, when: () => true, done: s => s.workspace.auth === 'hosted' ? !!s.myGithub : s.workspace.features.githubEnabled, Body: GitHubBody },
  {
    id: 'issue', title: 'Write your first issue', minutes: 0.5, when: () => true, Body: IssueBody,
    done: s => !!firstIssue(s),
  },
];

export function setupItems(s: Snapshot) {
  const ctx: SetupCtx = {
    hosted: s.workspace.auth === 'hosted',
    admin: s.currentUser.admin,
    canInvite: s.workspace.canInvite ?? (s.currentUser.admin || s.workspace.security.whoCanInvite === 'members'),
  };
  return SETUP_ITEMS.filter(i => i.when(ctx)).map(i => ({ ...i, isDone: i.done(s) }));
}

const myTeams = (s: Snapshot) => s.teams.filter(t => t.memberIds.includes(s.currentUser.id));
const teammates = (s: Snapshot) => s.users.filter(u => u.kind === 'human' && u.status === 'active' && u.id !== s.currentUser.id);
const issueKey = (s: Snapshot, i: { teamId: string; number: number }) => `${s.teams.find(t => t.id === i.teamId)?.key ?? 'ISS'}-${i.number}`;

function firstIssue(s: Snapshot) {
  const since = s.workspace.preferences.gettingStarted.since ?? s.workspace.createdAt;
  return s.issues.find(i => i.creatorId === s.currentUser.id && i.createdAt > since && !i.deletedAt) ?? null;
}

export function setupHome(s: Snapshot): string {
  const team = myTeams(s)[0];
  return team ? `/team/${team.key}/all` : '/my-issues';
}

function agentConnection(s: Snapshot): { name: string | null; at: string } | null {
  const me = s.currentUser.id;
  const key = (s.myApiKeys ?? []).filter(k => k.lastUsedAt).sort((a, b) => b.lastUsedAt!.localeCompare(a.lastUsedAt!))[0];
  if (key) return { name: key.name, at: key.lastUsedAt! };
  const wrote = s.activity.find(a => a.viaUserId === me) ?? s.comments.find(c => c.viaUserId === me);
  return wrote ? { name: null, at: wrote.createdAt } : null;
}

export function useSetupPanel() {
  const shown = useApp(s => s.snap!.workspace.preferences.gettingStarted.onboarding === 'pending');
  const [expanded, setExpanded] = useState(true);
  const [wasShown, setWasShown] = useState(shown);
  if (shown !== wasShown) { setWasShown(shown); if (shown) setExpanded(true); }
  return { shown, expanded, setExpanded };
}

function demoKey(snap: Snapshot, teamId: string | null, next = false): string {
  const team = snap.teams.find(t => t.id === teamId) ?? myTeams(snap)[0];
  const key = team?.key ?? 'WEB';
  if (!next) return `${key}-12`;
  const top = snap.issues.filter(i => i.teamId === team?.id).reduce((m, i) => Math.max(m, i.number), 0);
  return `${key}-${top + 1}`;
}

const minutesLeft = (items: Array<{ minutes: number; isDone: boolean }>) => Math.max(1, Math.ceil(items.filter(i => !i.isDone).reduce((m, i) => m + i.minutes, 0)));
const listNames = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four'];

export function SetupPanel(props: { teamId: string | null; expanded: boolean; setExpanded: (v: boolean) => void }) {
  const snap = useApp(s => s.snap)!;
  const items = setupItems(snap);
  const firstOpen = items.find(i => !i.isDone)?.id ?? null;
  const [open, setOpen] = useState<SetupItemId | null>(() => {
    const asked = takeSetupStep();
    return asked && items.some(i => i.id === asked) ? asked as SetupItemId : firstOpen;
  });
  const done = items.filter(i => i.isDone).length;
  const allDone = done === items.length;
  const justDone = useJustDone(items);
  const { expanded, setExpanded } = props;

  useEffect(() => {
    if (!justDone.size || !open || !justDone.has(open) || open === 'invite' || open === 'github') return;
    const t = setTimeout(() => setOpen(items.find(i => !i.isDone)?.id ?? null), 1400);
    return () => clearTimeout(t);
  }, [justDone]);
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => void setGettingStarted({ onboarding: 'done' }), 6000);
    return () => clearTimeout(t);
  }, [allDone]);

  const at = open ? items.findIndex(i => i.id === open) : -1;
  const step = (by: number) => {
    const next = items[(Math.max(at, 0) + by + items.length) % items.length];
    setOpen(next ? next.id : null);
  };
  const current = at >= 0 ? items[at] : null;

  return (
    <section className={`ob${expanded ? '' : ' collapsed'}`} aria-label="Getting started">
      {expanded && (allDone ? <Finale teamId={props.teamId} /> : <Welcome items={items} teamId={props.teamId} />)}
      <div className="ob-body">
        <div className="ob-list">
          <div className="ob-group">
            <button className="ob-group-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="var(--brand-text)" strokeWidth="1.4" strokeDasharray="2 2" /></svg>
              <span className="ob-group-title">Getting started</span>
              <span className="ob-group-count"><span key={done} className="ob-tick">{done}</span>/{items.length}</span>
            </button>
            <button className="icon-btn" aria-label="Close getting started" title="Close. Reopen it from the help menu." onClick={() => void setGettingStarted({ onboarding: 'done' })}>
              <IconClose size={13} />
            </button>
          </div>
          {expanded && items.map((it, i) => {
            const selected = open === it.id;
            return (
              <button key={it.id} className={`ob-row${selected ? ' selected' : ''}${it.isDone ? ' done' : ''}`} aria-pressed={selected}
                onClick={() => setOpen(selected ? null : it.id)}>
                <span className="ob-key">SETUP-{i + 1}</span>
                <RowStatus id={it.id} done={it.isDone} morph={justDone.has(it.id)} next={it.id === firstOpen && !selected} />
                <span className="ob-row-title">{it.title}</span>
                {it.isDone && <span className="ob-row-after">{doneLine(snap, it.id)}</span>}
                <span className="ob-row-fill" />
                <span className="ob-est">{it.minutes < 1 ? '30 sec' : `${it.minutes} min`}</span>
              </button>
            );
          })}
        </div>
        {expanded && current && (
          <aside className="ob-detail" aria-label={current.title}>
            <div key={current.id} className="ob-detail-in">
              <current.Body teamId={props.teamId} onDone={() => step(1)}
                eyebrow={`SETUP-${at + 1} · ${current.isDone ? 'done' : current.minutes < 1 ? '30 seconds' : `about ${current.minutes} minute${current.minutes === 1 ? '' : 's'}`}`} />
            </div>
            <div className="ob-detail-foot">
              <button className="btn ghost sm" onClick={() => step(-1)} disabled={at <= 0}>Previous</button>
              <span style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={() => at === items.length - 1 ? setOpen(null) : step(1)}>{at === items.length - 1 ? 'Done for now' : current.isDone ? 'Next' : 'Skip for now'}</button>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

function doneLine(s: Snapshot, id: SetupItemId): string {
  if (id === 'agent') { const c = agentConnection(s); return c ? `· ${c.name ?? 'Your agent'} connected` : ''; }
  if (id === 'invite') { const n = teammates(s).length; return n ? `· ${n} joined` : '· Invites sent'; }
  if (id === 'github') return '· Syncing';
  const f = firstIssue(s);
  return f ? `· ${issueKey(s, f)}` : '';
}

function RowStatus({ id, done, morph, next }: { id: SetupItemId; done: boolean; morph: boolean; next: boolean }) {
  const startedAgent = id === 'agent' && !done && !!minted;
  if (done) return <span className="ob-status done" role="img" aria-label="Done"><StatusDone size={14} morph={morph} /></span>;
  if (startedAgent) return <span className="ob-status" role="img" aria-label="In progress"><StatusStarted size={14} /></span>;
  return <span className={`ob-status${next ? ' next' : ''}`} role="img" aria-label="To do"><StatusTodo size={14} /></span>;
}

function useJustDone(items: Array<{ id: SetupItemId; isDone: boolean }>) {
  const seen = useRef(new Map(items.map(i => [i.id, i.isDone])));
  const [fresh, setFresh] = useState<ReadonlySet<SetupItemId>>(new Set());
  const signature = items.map(i => `${i.id}:${i.isDone ? 1 : 0}`).join(',');
  useEffect(() => {
    const flipped = items.filter(i => i.isDone && seen.current.get(i.id) === false).map(i => i.id);
    for (const i of items) seen.current.set(i.id, i.isDone);
    if (flipped.length === 0) return;
    setFresh(new Set(flipped));
    const t = setTimeout(() => setFresh(new Set()), 1600);
    return () => clearTimeout(t);
  }, [signature]);
  return fresh;
}

function Welcome({ items, teamId }: { items: Array<{ id: SetupItemId; minutes: number; isDone: boolean }>; teamId: string | null }) {
  const snap = useApp(s => s.snap)!;
  const first = snap.currentUser.name.split(' ')[0] || snap.currentUser.name;
  const joined = snap.workspace.preferences.gettingStarted.flow === 'join';
  const teams = myTeams(snap).map(t => t.name);
  const done = items.filter(i => i.isDone).length;
  const github = items.some(i => i.id === 'github') || snap.workspace.features.githubEnabled;
  const count = COUNT_WORDS[items.length] ?? String(items.length);
  return (
    <div className="ob-welcome">
      <div className="ob-welcome-copy">
        <h1>{joined ? `Welcome to ${snap.workspace.name}, ${first}.` : `Welcome to Baseline, ${first}.`}</h1>
        <p>
          {joined && teams.length > 0 && <>You're on {listNames(teams)}. </>}
          Here, issues move on their own. Your agent starts them{github ? ', pull requests carry them forward' : ' and keeps them current'}, and your team sees it as it happens.
          {' '}{count} small step{items.length === 1 ? '' : 's'} get{items.length === 1 ? 's' : ''} you there.
        </p>
      </div>
      <LiveExample issueKey={demoKey(snap, teamId)} github={github} />
      <div className="ob-progress">
        <span className="ob-segs on-line" aria-hidden="true">
          {items.map((it, i) => <i key={it.id} className={i < done ? 'on' : undefined} />)}
          <span className="line-node" style={{ left: `${(done / Math.max(1, items.length)) * 100}%` }} />
        </span>
        <span>{done === 0 ? `About ${minutesLeft(items)} minutes, start to finish` : `${done} of ${items.length} done · about ${minutesLeft(items)} min left`}</span>
      </div>
    </div>
  );
}

function LiveExample({ issueKey: key, github }: { issueKey: string; github: boolean }) {
  const lines = github
    ? ['Waiting in Todo', 'Your agent started it', 'Its pull request is in review', 'Merged. Nobody touched the status.']
    : ['Waiting in Todo', 'Your agent started it', 'It posted a progress note', 'Done. Nobody touched the status.'];
  return (
    <div className="ob-live" role="img" aria-label="Example: an issue that moves by itself">
      <span className="ob-cycle ob-glyph" aria-hidden="true">
        <span className="q1"><StatusTodo size={14} /></span>
        <span className="q2"><StatusStarted size={14} /></span>
        <span className="q3"><StatusStarted size={14} color="var(--green)" /></span>
        <span className="q4"><StatusDone size={14} /></span>
      </span>
      <span className="ob-key">{key}</span>
      <span className="ob-live-title">Fix login redirect</span>
      <span className="ob-cycle ob-live-line" aria-hidden="true">
        {lines.map((l, i) => <span key={l} className={`q${i + 1}`}>{l}</span>)}
      </span>
    </div>
  );
}

function Finale({ teamId }: { teamId: string | null }) {
  const snap = useApp(s => s.snap)!;
  const f = firstIssue(snap);
  return (
    <div className="ob-welcome ob-finale" role="status">
      <span className="ob-finale-check"><StatusDone size={28} morph /></span>
      <div className="ob-welcome-copy">
        <h1>You're set. Baseline takes it from here.</h1>
        <p>Try it now: tell your agent <code>start {f ? issueKey(snap, f) : demoKey(snap, teamId)}</code> and watch this list. This group tucks itself away in a moment.</p>
      </div>
    </div>
  );
}

export function SetupMenuItem() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const items = setupItems(snap);
  const done = items.filter(i => i.isDone).length;
  return (
    <MenuItem icon={<SetupDots items={items} />} label="Getting started" right={<span className="mi-kbd">{done}/{items.length}</span>}
      onClick={() => { void setGettingStarted({ onboarding: 'pending' }); navigate(setupHome(snap)); }} />
  );
}

function SetupDots({ items }: { items: Array<{ id: SetupItemId; isDone: boolean }> }) {
  return <span className="ob-dots" aria-hidden="true">{items.map(it => <i key={it.id} className={it.isDone ? 'on' : undefined} />)}</span>;
}

function StepHead({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <div className="ob-head">
      <span className="ob-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

const HARNESSES = [['claude', 'Claude Code'], ['codex', 'Codex'], ['mcp', 'Any MCP client']] as const;
type Harness = typeof HARNESSES[number][0];

/** How each client adds a streamable HTTP MCP server with a bearer key. Codex: `http_headers` in
 *  config.toml (learn.chatgpt.com/docs/extend/mcp). Any other client: the three values to enter. */
function connectSnippet(h: Exclude<Harness, 'mcp'>, url: string, token: string): { where: string; text: string } {
  if (h === 'claude') return { where: 'Run this in your terminal', text: `claude mcp add --transport http baseline ${url} --header "Authorization: Bearer ${token}"` };
  return { where: 'Add this to ~/.codex/config.toml', text: `[mcp_servers.baseline]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }` };
}

let minted: { keyId: string; token: string } | null = null;

function AgentBody({ eyebrow }: BodyProps) {
  const snap = useApp(s => s.snap)!;
  const [harness, setHarness] = useState<Harness>('claude');
  const [key, setKey] = useState(minted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = harness === 'mcp' ? 'MCP client' : HARNESSES.find(([k]) => k === harness)![1];

  const createKey = async () => {
    if (busy || key) return;
    setBusy(true); setError('');
    try {
      const r = await api.createApiKey({ name: harness === 'mcp' ? 'MCP client' : label, scopes: null, teamIds: null });
      minted = { keyId: r.key.id, token: r.token };
      setKey(minted);
      await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const mine = key && snap.myApiKeys?.find(k => k.id === key.keyId);
  const connection = mine ? (mine.lastUsedAt ? { name: mine.name, at: mine.lastUsedAt } : null) : agentConnection(snap);
  const url = `${window.location.origin}/mcp`;
  const openTypes = new Set(snap.states.filter(st => st.type !== 'completed' && st.type !== 'canceled').map(st => st.id));
  const assigned = snap.issues.find(i => i.assigneeId === snap.currentUser.id && openTypes.has(i.stateId) && !i.deletedAt);
  const joined = snap.workspace.preferences.gettingStarted.flow === 'join';
  const me = snap.currentUser.name.split(' ')[0];

  return (
    <>
      <StepHead eyebrow={eyebrow} title={joined ? 'Bring your own agent' : 'Let your agent pick up the work'}>
        Point it at an issue and it does the bookkeeping: starts it, names the branch, posts progress and hands it back for review. It all shows as yours, and can be undone.
      </StepHead>
      {!key && !connection && <div className="ob-stage" role="img" aria-label="Example: what your agent does on an issue">
        <div className="ob-stage-head"><span className="ob-key">{demoKey(snap, null)}</span>Fix login redirect</div>
        <div className="ob-feed">
          <span className="ob-seq" style={{ ['--d' as string]: '0s' }}>Agent via {me} moved it to <b className="t-started">In Progress</b></span>
          <span className="ob-seq" style={{ ['--d' as string]: '.9s' }}>Branch <code>{(snap.currentUser.username || me).toLowerCase()}/{demoKey(snap, null).toLowerCase()}-fix-login</code></span>
          <span className="ob-seq ob-note" style={{ ['--d' as string]: '1.8s' }}>Found the loop in the auth callback. Adding a test, then the fix.</span>
          <span className="ob-seq" style={{ ['--d' as string]: '2.7s' }}>Moved to <b className="t-review">In Review</b></span>
        </div>
      </div>}
      {!connection && <>
        <div className="ob-seg" role="radiogroup" aria-label="Your agent">
          {HARNESSES.map(([k, name]) => (
            <button key={k} role="radio" aria-checked={harness === k} className={harness === k ? 'on' : undefined} onClick={() => setHarness(k)}>{name}</button>
          ))}
        </div>
        {!key ? (
          <div className="ob-action">
            <button className="btn primary sm" disabled={busy} onClick={() => void createKey()}>{busy ? 'Creating…' : 'Create a key'}</button>
            <span className="ob-aside">Revoke it any time</span>
          </div>
        ) : harness === 'mcp' ? (
          <div className="ob-in">
            <div className="ob-aside">Add Baseline as a remote MCP server in any client that supports one. The key shows once, so copy it now.</div>
            <div className="ob-kv">
              <div><span>Transport</span><code>Streamable HTTP</code></div>
              <div><span>Server URL</span><code>{url}</code><CopyIcon text={url} what="Server URL" /></div>
              <div><span>Header</span><code>Authorization: Bearer {key.token}</code><CopyIcon text={`Authorization: Bearer ${key.token}`} what="Header" /></div>
            </div>
          </div>
        ) : (() => {
          const s = connectSnippet(harness, url, key.token);
          return (
            <div className="ob-in">
              <div className="ob-aside">{s.where}. The key shows once, so copy it now.</div>
              <CopyBlock text={s.text} />
            </div>
          );
        })()}
        {key && <div className="ob-wait" aria-live="polite"><span className="ob-live-dot" />Listening for {mine?.name ?? label}. Run it and we'll notice.</div>}
      </>}
      {connection && (
        <div className="ob-success" aria-live="polite">
          <StatusDone size={16} morph />
          <span>{connection.name ?? 'Your agent'} reached Baseline {relTime(connection.at)}. {assigned ? <>Ask it: <code>start {issueKey(snap, assigned)}</code></> : 'It\'s ready for its first issue.'}</span>
        </div>
      )}
      {error && <div className="ob-error" role="alert">Couldn't create a key: {error}</div>}
    </>
  );
}

function CopyBlock({ text }: { text: string }) {
  return (
    <div className="ob-cmd">
      <pre>{text}</pre>
      <CopyButton text={text} />
    </div>
  );
}

async function copyWithToast(text: string, what: string) {
  const { toast } = useApp.getState();
  if (await copyText(text)) toast({ title: `${what} copied` });
  else toast({ title: 'Clipboard unavailable', line: 'bring the app tab into focus and retry' });
}
function CopyButton({ text }: { text: string }) {
  return <button className="btn secondary sm" onClick={() => void copyWithToast(text, 'Copied')}><IconCopy size={13} /> Copy</button>;
}
function CopyIcon({ text, what }: { text: string; what: string }) {
  return <button className="icon-btn" aria-label={`Copy ${what}`} title={`Copy ${what}`} onClick={() => void copyWithToast(text, what)}><IconCopy size={12} /></button>;
}

function InviteBody({ teamId, eyebrow }: BodyProps) {
  const snap = useApp(s => s.snap)!;
  const [inviting, setInviting] = useState(false);
  const people = teammates(snap);
  const me = snap.currentUser;
  const initials = (n: string) => n.split(/\s+/).map(p => p[0] ?? '').join('').slice(0, 2).toUpperCase();
  return (
    <>
      <StepHead eyebrow={eyebrow} title={people.length ? 'Your people are here' : 'Bring in the people you build with'}>
        Assign, mention and triage together. Everyone connects their own agent, and its work shows under their name.
      </StepHead>
      <div className="ob-stage ob-stage-invite" role="img" aria-label="Example: teammates joining">
        <span className="ob-avs">
          <span className="ob-av" style={{ ['--d' as string]: '0s' }}>{initials(me.name)}</span>
          {people.slice(0, 3).map((u, i) => <span key={u.id} className="ob-av" style={{ ['--d' as string]: `${(i + 1) * 0.25}s` }}>{initials(u.name)}</span>)}
          {people.length < 2 && [0, 1].slice(people.length).map(i => <span key={i} className="ob-av empty" style={{ ['--d' as string]: `${(i + 1) * 0.25}s` }} />)}
        </span>
        <span className="ob-slide">{people[0] ? `${people[0].name.split(' ')[0]} can now pick up ${demoKey(snap, teamId)}` : `A teammate picks up ${demoKey(snap, teamId)} and mentions you`}</span>
      </div>
      {people.length > 0 && (
        <div className="ob-people">
          {people.slice(0, 4).map(u => <div key={u.id}><span>{u.name}</span><span className="ob-aside">Joined</span></div>)}
        </div>
      )}
      <div className="ob-action"><button className={`btn ${people.length ? 'secondary' : 'primary'} sm`} onClick={() => setInviting(true)}>{people.length ? 'Invite more people' : 'Invite people'}</button></div>
      {inviting && <InviteModal teamIds={teamId ? [teamId] : undefined} onClose={() => setInviting(false)} onDone={refresh} />}
    </>
  );
}

function GitHubBody({ eyebrow }: BodyProps) {
  const snap = useApp(s => s.snap)!;
  const [open, setOpen] = useState(false);
  const on = snap.workspace.features.githubEnabled;
  const key = demoKey(snap, null);
  return (
    <>
      <StepHead eyebrow={eyebrow} title="Let pull requests update the status for you">
        Open a PR, ask for a review, merge. Each one moves its issue, so the board is never out of date.
      </StepHead>
      <div className="ob-stage ob-stage-gh" role="img" aria-label="Example: a pull request moving its issue">
        <div className="ob-pr"><span className="ob-key">#214</span><span className="ob-pr-title">Fix login redirect loop</span>
          <span className="ob-cycle3 ob-pr-state" aria-hidden="true"><span className="p1 t-open">Opened</span><span className="p2 t-started">In review</span><span className="p3 t-merged">Merged</span></span>
        </div>
        <span className="ob-wire" aria-hidden="true" />
        <div className="ob-pr ob-pr-issue">
          <span className="ob-cycle3 ob-glyph" aria-hidden="true"><span className="p1"><StatusStarted size={14} /></span><span className="p2"><StatusStarted size={14} color="var(--green)" /></span><span className="p3"><StatusDone size={14} /></span></span>
          <span className="ob-key">{key}</span><span>Fix login redirect</span>
        </div>
      </div>
      <div className="ob-safe">
        <IconShieldUser size={16} />
        <div><b>Read-only, enforced by GitHub</b><span>Baseline refuses a token that can write. It never pushes, comments or changes a label.</span></div>
      </div>
      <div className="ob-action">
        <button className={`btn ${on ? 'secondary' : 'primary'} sm`} onClick={() => setOpen(true)}>{on ? 'Review GitHub setup' : 'Connect GitHub'}</button>
        <span className="ob-aside">Three short steps</span>
      </div>
      {open && <GitHubSetup onClose={() => setOpen(false)} />}
    </>
  );
}

function IssueBody({ teamId, eyebrow }: BodyProps) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const team = snap.teams.find(t => t.id === teamId) ?? myTeams(snap)[0];
  const nextKey = demoKey(snap, team?.id ?? null, true);
  const joined = snap.workspace.preferences.gettingStarted.flow === 'join';
  const made = firstIssue(snap);
  const create = async () => {
    const t = title.trim();
    if (!t || busy) return;
    if (!team) { useApp.getState().openCreate({ title: t }); return; }
    setBusy(true);
    try { await api.createIssue({ teamId: team.id, title: t }); setTitle(''); await refresh(); }
    catch (err) { toast({ title: (err as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <StepHead eyebrow={eyebrow} title="Write down the first real thing">
        {joined ? 'Add the next thing you\'d do anyway, or hand one to your agent.' : 'Not a test. The thing you\'d do next anyway. Then hand it to your agent and watch it move.'}
      </StepHead>
      {made ? (
        <div className="ob-success"><StatusDone size={16} morph /><span><code>{issueKey(snap, made)}</code> {made.title}</span></div>
      ) : <>
        <div className="ob-stage ob-stage-issue" role="img" aria-label="Example: writing an issue">
          <span className="ob-key">{nextKey}</span><span><span className="ob-typed">Add rate limiting to /login</span><span className="ob-caret" /></span>
        </div>
        <form className="ob-inline" onSubmit={e => { e.preventDefault(); void create(); }}>
          <input className="text-input" aria-label="Issue title" placeholder="What's next?" value={title} onChange={e => setTitle(e.target.value)} />
          <button className="btn primary sm" type="submit" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create'}</button>
        </form>
        <div className="ob-aside">It becomes {nextKey}. Anywhere in the app, <span className="kbd">C</span> opens the full editor.</div>
      </>}
    </>
  );
}
