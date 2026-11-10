import { useEffect, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, refresh, relTime, setGettingStarted, copyText } from './store.js';
import { api } from './api.js';
import { MenuItem } from './ui.js';
import { InviteModal } from './Members.js';
import { IconChevronDown, IconChevronRight, IconClose, IconCopy } from './icons.js';
import type { Snapshot } from '../../src/core/types.js';

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

  const gs = snap.workspace.preferences.gettingStarted;
  const teams = myTeams(snap).map(t => t.name);
  const { expanded, setExpanded } = props;
  return (
    <div className="setup-wrap">
      <section className={`setup-panel${expanded ? '' : ' collapsed'}`} aria-label="Set up Baseline">
        <div className="setup-head">
          <button className="setup-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
            <span className="setup-title">Set up Baseline</span>
            <span className="setup-count">· {done} of {items.length}</span>
          </button>
          <button className="icon-btn" aria-label="Close setup" title="Close. Reopen it from the help menu." onClick={() => void setGettingStarted({ onboarding: 'done' })}>
            <IconClose size={13} />
          </button>
        </div>
        {expanded && (
          <>
            {gs.flow === 'join' && (
              <div className="setup-banner">
                You've joined <b>{snap.workspace.name}</b>.{teams.length > 0 && <> Your team is <b>{listNames(teams)}</b>.</>}
              </div>
            )}
            {items.map(({ id, title, isDone, Body }) => (
              <div key={id} className={`setup-item${open === id ? ' open' : ''}${isDone ? ' done' : ''}`}>
                <button className="setup-row" aria-expanded={open === id} onClick={() => setOpen(o => (o === id ? null : id))}>
                  <CheckCircle done={isDone} />
                  <span className="setup-label">{title}</span>
                </button>
                {open === id && <div className="setup-body"><Body teamId={props.teamId} /></div>}
              </div>
            ))}
            {allDone && <div className="setup-all">All set.</div>}
          </>
        )}
      </section>
    </div>
  );
}

const listNames = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

function CheckCircle({ done }: { done: boolean }) {
  return done
    ? <svg width="15" height="15" viewBox="0 0 15 15" aria-label="Done"><circle cx="7.5" cy="7.5" r="6.5" fill="var(--brand)" /><path d="m4.8 7.7 1.9 1.9 3.6-4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg width="15" height="15" viewBox="0 0 15 15" aria-label="Not done"><circle cx="7.5" cy="7.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 1.8" /></svg>;
}

/** the help menu's way back to the panel, with the same progress */
export function SetupMenuItem() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const items = setupItems(snap);
  const done = items.filter(i => i.isDone).length;
  return (
    <MenuItem icon={<ProgressRing done={done} total={items.length} />} label="Set up Baseline" right={<span className="mi-kbd">{done}/{items.length}</span>}
      onClick={() => { void setGettingStarted({ onboarding: 'pending' }); navigate(setupHome(snap)); }} />
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 5.5; const c = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r={r} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
      <circle cx="7.5" cy="7.5" r={r} fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round"
        strokeDasharray={`${(c * done) / total} ${c}`} transform="rotate(-90 7.5 7.5)" />
    </svg>
  );
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

function AgentBody() {
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
  const snippet = key && connectSnippet(harness, `${window.location.origin}/mcp`, key.token);
  const openTypes = new Set(snap.states.filter(st => st.type !== 'completed' && st.type !== 'canceled').map(st => st.id));
  const assigned = snap.issues.find(i => i.assigneeId === snap.currentUser.id && openTypes.has(i.stateId) && !i.deletedAt);
  const assignedKey = assigned && `${snap.teams.find(t => t.id === assigned.teamId)?.key ?? 'ISS'}-${assigned.number}`;

  return (
    <>
      <div className="setup-help">Your agent reads and updates issues here over MCP, with an API key of its own. Its changes show as yours, via the agent.</div>
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
        <div><button className="btn secondary sm" disabled={busy} onClick={() => void createKey()}>{busy ? 'Creating…' : 'Create a key'}</button></div>
      )}
      {(key || connection) && (
        <div className={`setup-status ${connection ? 'on' : 'wait'}`} aria-live="polite">
          <span className="setup-dot" />
          {connection
            ? <span>Connected. {connection.name ?? 'Your agent'} reached Baseline {relTime(connection.at)}.</span>
            : <span>Waiting for {mine?.name ?? label} to connect…</span>}
        </div>
      )}
      {assignedKey && <div className="setup-help">Ask it to pick up an issue: <code>Start {assignedKey}</code></div>}
      {error && <div className="setup-error" role="alert">Couldn't create a key: {error}</div>}
    </>
  );
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
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <div className="setup-help">Teammates join by email and connect their own agents.</div>
      <div><button className="btn secondary sm" onClick={() => setInviting(true)}>Invite people</button></div>
      {inviting && <InviteModal teamIds={teamId ? [teamId] : undefined} onClose={() => setInviting(false)} onDone={refresh} />}
    </>
  );
}

function GitHubBody() {
  const navigate = useNavigate();
  const hosted = useApp(s => s.snap!.workspace.auth === 'hosted');
  return (
    <>
      <div className="setup-help">{hosted ? 'Paste a read-only GitHub token so pull requests move their issues.' : 'Link your repositories so pull requests move their issues.'}</div>
      <div><button className="btn secondary sm" onClick={() => navigate('/settings/github')}>Open GitHub settings</button></div>
    </>
  );
}

function IssueBody({ teamId }: BodyProps) {
  return (
    <>
      <div className="setup-help">Press <span className="kbd">C</span> anywhere.</div>
      <div><button className="btn secondary sm" onClick={() => useApp.getState().openCreate(teamId ? { teamId } : {})}>New issue</button></div>
    </>
  );
}
