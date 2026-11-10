import { useEffect, useState } from 'react';
import { useApp, relTime, copyText, shortDate } from './store.js';
import { api } from './api.js';
import { IconPr, IconCommit, IconClose, IconExternal, IconCopy, IconShieldUser } from './icons.js';
import { branchName } from '../../src/core/handoff.js';
import type { GithubAuthor, GithubSummary, GitStatus, PrAutomation, PrEvent, PullRequest, WebhookConfig, WebhookDelivery } from '../../src/core/types.js';
import { ConfirmButton } from './ui.js';

const refresh = () => useApp.getState().bootstrap();
const PR_COLOR: Record<PullRequest['state'], string> = { draft: '#8a8f98', open: '#4cb782', merged: '#a371f7', closed: '#eb5757' };
const EVENTS: Array<[PrEvent, string]> = [['draft', 'Draft PR opened'], ['opened', 'PR opened'], ['review', 'Review requested or activity'], ['ready', 'Ready for merge'], ['merged', 'Merged']];

export function PrIcon({ state, size = 14, title }: { state: PullRequest['state']; size?: number; title?: string }) {
  return <span className="pr-icon" style={{ color: PR_COLOR[state] }} title={title ?? `PR ${state}`}><IconPr size={size} /></span>;
}
/** the hover text for an issue's PR icon: each linked PR, newest first */
export function prSummary(prs: PullRequest[]): string {
  return prs.map(p => `${p.repo}#${p.number} · ${p.state} · ${p.title}`).join('\n');
}
/** the PR state an inbox notification's text describes ("PR #12 merged: …") */
export function prStateOfNotice(body: string): PullRequest['state'] {
  const what = /^PR #\d+ ([a-z ]+):/.exec(body)?.[1] ?? '';
  return what === 'merged' ? 'merged' : what === 'closed' ? 'closed' : 'open';
}

type Snap = NonNullable<ReturnType<typeof useApp.getState>['snap']>;
/** the PRs linked to an issue (unlinked ones left out) */
export function issuePrList(snap: Snap, issueId: string): PullRequest[] {
  return snap.issuePrs.filter(l => l.issueId === issueId && !l.dismissed).map(l => snap.pullRequests.find(p => p.id === l.prId)).filter(Boolean) as PullRequest[];
}
/** the furthest-along PR linked to an issue, for list rows */
export function issuePrState(snap: Snap, issueId: string): PullRequest['state'] | null {
  const prs = issuePrList(snap, issueId);
  if (!prs.length) return null;
  const order: Array<PullRequest['state']> = ['merged', 'open', 'draft', 'closed'];
  return order.find(s => prs.some(p => p.state === s)) ?? null;
}

/* ================= issue page: pull requests and commits ================= */
export function IssuePullRequests({ issueId }: { issueId: string }) {
  const snap = useApp(s => s.snap)!;
  const links = snap.issuePrs.filter(l => l.issueId === issueId && !l.dismissed);
  const commits = snap.issueCommits.filter(c => c.issueId === issueId).map(c => snap.commits.find(x => x.sha === c.sha)).filter(Boolean) as typeof snap.commits;
  if (!links.length && !commits.length) return null;
  return (
    <div className="pr-section" data-pull-requests>
      {links.map(l => {
        const p = snap.pullRequests.find(x => x.id === l.prId);
        if (!p) return null;
        return (
          <div key={p.id} className="pr-row">
            <PrIcon state={p.state} />
            <a href={p.url} target="_blank" rel="noreferrer" className="pr-title">{p.title}</a>
            <span className="pr-meta pr-repo">{p.repo}#{p.number}</span>
            {p.reviewDecision && <span className={`pr-review ${p.reviewDecision}`}>{p.reviewDecision === 'approved' ? 'Approved' : p.reviewDecision === 'changes_requested' ? 'Changes requested' : 'Review requested'}</span>}
            {p.checks && <span className={`pr-checks ${p.checks}`} title={`Checks ${p.checks}`}>{p.checks === 'success' ? '✓' : p.checks === 'failure' ? '✗' : '•'}</span>}
            {l.kind !== 'closing' && <span className="pr-kind">{l.kind === 'ref' ? 'reference' : 'related'}</span>}
            <span className="pr-meta">{p.author} · {relTime(p.updatedAt)}</span>
            <button className="icon-btn hover-only" title="Unlink pull request" onClick={async () => { await api.unlinkPr(issueId, p.id); await refresh(); }}><IconClose size={12} /></button>
          </div>
        );
      })}
      {commits.slice(0, 5).map(c => (
        <div key={c.sha} className="pr-row commit">
          <IconCommit size={14} /><span className="mono pr-sha">{c.sha.slice(0, 7)}</span><span className="pr-title">{c.message.split('\n')[0]}</span><span className="pr-meta">{c.repo} · {c.author} · {relTime(c.committedAt)}</span>
        </div>
      ))}
    </div>
  );
}

/* ================= Settings › Integrations › GitHub =================
   One path first: access (a read-only token, or the gh sign-in on a laptop) → repositories, each
   mapped to a team → what syncing found. Automations sit on the same page. How it stays read-only,
   webhooks and issue import are an "advanced" fold for whoever wants them. */
export function GitHubSettings() {
  const snap = useApp(s => s.snap)!;
  const f = snap.workspace.features;
  const hosted = snap.workspace.auth === 'hosted';
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [summary, setSummary] = useState<GithubSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState('');
  const [format, setFormat] = useState(f.branchFormat);
  const load = async () => { await api.gitStatus().then(setStatus).catch(() => {}); await api.githubSummary().then(setSummary).catch(() => {}); };
  useEffect(() => { void load(); }, [f.githubEnabled]);
  const sync = async () => {
    setSyncing(true);
    try { const r = await api.gitSync(); setResult(r.error ? `Synced with errors: ${r.error}` : ''); await refresh(); await load(); }
    finally { setSyncing(false); }
  };
  const syncButton = <button className="btn secondary sm" disabled={syncing} onClick={sync}>{syncing ? 'Syncing…' : 'Sync now'}</button>;
  // examples use a real key from this workspace, never a made-up team
  const sample = snap.issues.find(i => !i.deletedAt);
  const teamKey = (sample && snap.teams.find(t => t.id === sample.teamId)?.key) ?? snap.teams[0]?.key ?? 'CORE';
  const sampleKey = sample ? `${teamKey}-${sample.number}` : `${teamKey}-42`;
  const canRead = !!status && (status.source === 'token' || (status.source === 'login' && !!status.ghUser));
  return (
    <div className="settings-card" data-github-settings>
      <h1>GitHub</h1>
      <div className="field-help" style={{ marginBottom: 14 }}>Pull requests and commits link to issues by branch name, and issues move as PRs open, get reviewed and merge. Baseline only reads from GitHub.</div>
      {status && status.repos.length > 0 && <GitHubPayoff summary={summary} lastSyncAt={status.lastSyncAt} syncButton={canRead ? syncButton : null} />}
      {result && <div className="field-help" style={{ margin: '-6px 0 10px', color: 'var(--danger)' }}>{result}</div>}
      {status && <GitHubAccess status={status} hosted={hosted} onChange={load} />}
      {status && <GitHubRepos status={status} hosted={hosted} canRead={canRead} onChange={load} onAdded={sync} />}
      <GitHubPeople onChange={load} />
      <div className="settings-h2">Pull request automations</div>
      <PrAutomationPicker />
      <div className="settings-h2">How linking works</div>
      <ul className="gh-rules">
        <li>A branch named like <code>{branchName(sampleKey, sample?.title ?? 'Fix login redirect', f.branchFormat, snap.currentUser.username || snap.currentUser.name)}</code>, <code>feat/{sampleKey.toLowerCase()}</code> or <code>{sampleKey}</code> links its commits and its PR to {sampleKey}. No key needed in commit messages.</li>
        <li>A PR closes {sampleKey} when it merges. In a PR or commit, <b>fixes / closes / resolves {sampleKey}</b> closes it too; <b>refs / part of {sampleKey}</b> only links. A bare <code>{sampleKey}</code> in a commit is a reference, and so is “does not fix {sampleKey}”.</li>
        <li><code>skip {sampleKey}</code> or <code>ignore {sampleKey}</code> opts out. <b>{teamKey}-NEW</b> in a PR's title files a new {teamKey} issue for it, assigned to the PR's author.</li>
      </ul>
      <div className="settings-h2">Branch format</div>
      <div className="field-row">
        <div><div className="field-label">Copy git branch (⌘⇧.)</div><div className="field-help">Variables: <code>{'{username}'}</code> <code>{'{issueIdentifier}'}</code> <code>{'{issueTitle}'}</code>, e.g. <code>{branchName(sampleKey, sample?.title ?? 'Fix login redirect', format, snap.currentUser.username || snap.currentUser.name)}</code></div></div>
        <input className="text-input" style={{ width: 300 }} aria-label="Branch format" value={format} onChange={e => setFormat(e.target.value)} onBlur={async () => { if (format !== f.branchFormat) { await api.setFeatures({ branchFormat: format }); await refresh(); } }} />
      </div>
      <details className="gh-advanced" data-github-advanced>
        <summary>Advanced: how it stays read-only, instant updates (webhooks), issue import</summary>
        <div className="gh-readonly">
          <IconShieldUser size={16} />
          <div>
            <b>Read-only by design.</b> Baseline never writes to GitHub: no comments, status checks, labels, branches or pushes, under any setting.{' '}
            It reads pull requests, reviews, checks, commits and issues with {hosted ? 'a read-only token' : <>your <code>gh</code> sign-in, limited in code to read commands, or a read-only token</>}, which
            GitHub itself refuses to write with, and from signed webhooks GitHub sends here, which need no token at all.
          </div>
        </div>
        <div className="field-row">
          <div><div className="field-label">Sync with GitHub</div><div className="field-help">Turns on by itself when you add a token or a repository. Syncs every two minutes and takes webhooks as they arrive. Turn off to pause both.</div></div>
          <button className={`switch${f.githubEnabled ? ' on' : ''}`} role="switch" aria-checked={f.githubEnabled} aria-label="Sync with GitHub" onClick={async () => { await api.setFeatures({ githubEnabled: !f.githubEnabled }); await refresh(); }}><span /></button>
        </div>
        <WebhookSettings polls={status?.source !== 'none'} />
        <IssueImportSettings repos={(status?.repos ?? []).map(r => r.repo)} />
      </details>
    </div>
  );
}

/** the payoff line: what syncing found */
function GitHubPayoff({ summary, lastSyncAt, syncButton }: { summary: GithubSummary | null; lastSyncAt: string | null; syncButton: React.ReactNode }) {
  const s = summary;
  const synced = !!lastSyncAt && !!s;
  return (
    <div className="gh-payoff" data-github-payoff>
      <div className="gh-payoff-stats">
        {synced ? <>
          <span><b>{s.openPrs}</b> open PR{s.openPrs === 1 ? '' : 's'}</span>
          <span><b>{s.linkedPrs}</b> linked to issues</span>
          <span><b>{s.peopleMatched}</b>{s.authors ? ` of ${s.authors}` : ''} {s.peopleMatched === 1 && !s.authors ? 'person' : 'people'} matched</span>
        </> : <span>Not synced yet. Sync to see what Baseline finds.</span>}
      </div>
      <span className="set-meta">{lastSyncAt ? `Synced ${relTime(lastSyncAt)}` : ''}</span>
      {syncButton}
    </div>
  );
}

/* ================= access: a read-only token, or (laptop) the gh sign-in ================= */
const TOKEN_PERMISSIONS = ['Metadata', 'Contents', 'Pull requests', 'Issues', 'Checks'];
export function GitHubAccess({ status, hosted, onChange, bare }: { status: GitStatus; hosted: boolean; onChange: () => Promise<void>; /** without its numbered heading (the setup flow has its own) */ bare?: boolean }) {
  const [token, setToken] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = status.token;
  const save = async () => {
    setBusy(true); setError('');
    try { await api.saveGithubToken(token); setToken(''); setReplacing(false); await refresh(); await onChange(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const days = t?.expiresAt ? (Date.parse(t.expiresAt) - Date.now()) / 86_400_000 : null;
  const ghReady = !hosted && !t && status.source === 'login' && !!status.ghUser;
  return (
    <>
      {!bare && <div className="settings-h2">1. Access</div>}
      {t && !replacing ? (
        <div className="field-row">
          <div>
            <div className="field-label">Read-only token for @{t.login}</div>
            <div className="field-help">
              {t.hint} · {t.expiresAt ? `expires ${shortDate(t.expiresAt)}` : 'no expiry'}
              {days !== null && days < 7 && <span style={{ color: days < 0 ? 'var(--danger)' : '#f2c94c' }}> · {days < 0 ? 'expired, so syncing has stopped: replace it' : 'expires within a week: replace it soon'}</span>}
            </div>
          </div>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn secondary sm" onClick={() => setReplacing(true)}>Replace</button>
            <ConfirmButton className="btn ghost sm" label="Remove" confirmLabel="Stop syncing?" onConfirm={async () => { await api.removeGithubToken(); await onChange(); }} />
          </span>
        </div>
      ) : ghReady && !replacing ? (
        <div className="field-row">
          <div><div className="field-label">Using your GitHub CLI sign-in (@{status.ghUser})</div><div className="field-help">Baseline only lets read commands through to <code>gh</code>. A read-only token is stricter: GitHub itself refuses writes made with it.</div></div>
          <button className="btn ghost sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setReplacing(true)}>Use a token instead</button>
        </div>
      ) : (
        <div className="gh-steps" style={{ marginTop: 0 }}>
          <div className="field-label" style={{ marginBottom: 6 }}>{t ? 'Replace the token' : 'Paste a read-only token'}</div>
          <ol>
            <li>Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">fine-grained token</a> for the repositories Baseline should see.</li>
            <li>Under <b>Repository permissions</b>, set {TOKEN_PERMISSIONS.map((p, i) => <span key={p}>{i ? ', ' : ''}<b>{p}</b></span>)} to <b>Read-only</b>.</li>
          </ol>
          <div className="gh-import">
            <input className="text-input" type="password" autoComplete="off" aria-label="GitHub token" placeholder="github_pat_…" value={token} onChange={e => setToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && token.trim()) void save(); }} />
            <button className="btn primary sm" disabled={busy || !token.trim()} onClick={() => void save()}>{busy ? 'Checking…' : 'Save'}</button>
            {(t || ghReady) && <button className="btn ghost sm" onClick={() => { setReplacing(false); setError(''); }}>Cancel</button>}
          </div>
          <div className="field-help" style={{ marginTop: 6 }}>Baseline checks it with GitHub and refuses a token that can write.{!hosted && !status.ghUser && <> On this machine, <code>gh auth login</code> works too.</>}</div>
          {error && <div className="field-help" style={{ color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
          {hosted && !status.ghInstalled && <div className="field-help" style={{ marginTop: 6 }}>The GitHub CLI (<code>gh</code>) isn't installed on this server, so a token can't be checked or used yet.</div>}
        </div>
      )}
    </>
  );
}

/* ================= the repositories Baseline syncs, each mapped to a team ================= */
export function GitHubRepos({ status, hosted, canRead, onChange, onAdded, bare }: { status: GitStatus; hosted: boolean; canRead: boolean; onChange: () => Promise<void>; onAdded: () => Promise<void>; bare?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const [available, setAvailable] = useState<string[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState('');
  const picked = status.repos.filter(r => r.via === 'picked').map(r => r.repo);
  const tracked = new Set(status.repos.map(r => r.repo.toLowerCase()));
  const choices = (available ?? []).filter(r => !tracked.has(r.toLowerCase()) && r.toLowerCase().includes(filter.trim().toLowerCase()));
  const open = async () => {
    setPicking(true); setError(''); setAvailable(null); setChosen([]); setFilter('');
    try { setAvailable((await api.availableGithubRepos()).repos); } catch (e) { setError((e as Error).message); }
  };
  const save = async (repos: string[], added: boolean) => {
    try { await api.setGithubRepos(repos); setPicking(false); await refresh(); await onChange(); if (added) await onAdded(); } catch (e) { setError((e as Error).message); }
  };
  const setTeam = async (repo: string, teamId: string) => { await api.setGithubRepoTeam(repo, teamId || null); await onChange(); };
  return (
    <>
      {!bare && <div className="settings-h2">2. Repositories</div>}
      <div className="field-help" style={{ marginBottom: 8 }}>
        Pick the repositories to sync and the team each one's work belongs to.{!hosted && <> Locations (Settings › Coding tools) whose <code>origin</code> is on GitHub are synced too.</>}
        {status.lastError ? <span style={{ color: 'var(--danger)' }}> Last error: {status.lastError}</span> : ''}
      </div>
      <div className="card set-list" data-github-repos>
        {status.repos.map(r => (
          <div key={r.repo} className="set-row">
            <IconPr size={14} />
            <span style={{ flex: 1, minWidth: 0 }}><b>{r.repo}</b>{r.location && <span className="set-meta"> location {r.location}</span>}</span>
            <select className="text-input" aria-label={`Team for ${r.repo}`} value={r.teamId ?? ''} onChange={e => void setTeam(r.repo, e.target.value)}>
              <option value="">No team</option>
              {snap.teams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.key})</option>)}
            </select>
            {r.via === 'picked'
              ? <button className="icon-btn" title={`Stop syncing ${r.repo}`} onClick={() => void save(picked.filter(x => x !== r.repo), false)}><IconClose size={12} /></button>
              : <span style={{ width: 24 }} />}
          </div>
        ))}
        {!status.repos.length && !picking && <div className="set-empty">{canRead ? 'No repositories yet.' : 'Add access above first, then pick repositories.'}</div>}
        {canRead && !picking && <div className="set-row"><button className="btn ghost sm" onClick={() => void open()}>Add repositories</button></div>}
        {picking && (
          <div className="gh-picker" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="text-input" autoFocus aria-label="Filter repositories" placeholder="Filter repositories" value={filter} onChange={e => setFilter(e.target.value)} />
            {!available && !error && <div className="field-help">Asking GitHub…</div>}
            {available && (
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {choices.map(r => (
                  <label key={r} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 2px', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={chosen.includes(r)} onChange={e => setChosen(e.target.checked ? [...chosen, r] : chosen.filter(x => x !== r))} />{r}
                  </label>
                ))}
                {!choices.length && <div className="field-help">{available.length ? 'No other repositories match.' : 'This access can’t see any repositories.'}</div>}
              </div>
            )}
            {error && <div className="field-help" style={{ color: 'var(--danger)' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn primary sm" disabled={!chosen.length} onClick={() => void save([...picked, ...chosen], true)}>{chosen.length ? `Add ${chosen.length} and sync` : 'Add'}</button>
              <button className="btn ghost sm" onClick={() => setPicking(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {error && !picking && <div className="field-help" style={{ color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </>
  );
}

/* ================= people: PR authors matched to members ================= */
function GitHubPeople({ onChange }: { onChange: () => Promise<void> }) {
  const snap = useApp(s => s.snap)!;
  const [authors, setAuthors] = useState<GithubAuthor[] | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const load = () => api.githubAuthors().then(r => setAuthors(r.authors)).catch(() => {});
  useEffect(() => { void load(); }, [snap.pullRequests.length]);
  const unmapped = snap.users.filter(u => u.kind === 'human' && !u.githubUsername);
  const open = (authors ?? []).filter(a => !a.userId);
  const match = async (login: string, userId: string) => { await api.updateUser(userId, { githubUsername: login }); await refresh(); await load(); await onChange(); };
  const n = snap.users.filter(u => u.kind === 'human' && u.githubUsername).length;
  return (
    <>
      <div className="settings-h2">People</div>
      <div className="field-help" style={{ marginBottom: open.length && unmapped.length ? 8 : 0 }}>A PR whose author is a member's GitHub username is theirs: its activity shows under their name, and an unassigned issue it closes is assigned to them. {n ? `${n} member${n === 1 ? ' has' : 's have'} a GitHub username.` : 'No member has a GitHub username yet.'}</div>
      {open.length > 0 && unmapped.length > 0 && (
        <div className="card set-list" data-github-people>
          {open.slice(0, 8).map(a => {
            const chosen = pick[a.login] ?? a.suggestedUserId ?? '';
            return (
              <div key={a.login} className="set-row">
                <span style={{ flex: 1, minWidth: 0 }}><b>@{a.login}</b> <span className="set-meta">{a.prs} PR{a.prs === 1 ? '' : 's'}{a.suggestedUserId ? ' · suggested match' : ''}</span></span>
                <select className="text-input" aria-label={`Member for @${a.login}`} value={chosen} onChange={e => setPick({ ...pick, [a.login]: e.target.value })}>
                  <option value="">Not a member</option>
                  {unmapped.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button className="btn secondary sm" disabled={!chosen} onClick={() => void match(a.login, chosen)}>Match</button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** PR automations for one team at a time, on the GitHub page (the team's Workflows page has the same) */
function PrAutomationPicker() {
  const snap = useApp(s => s.snap)!;
  const [teamId, setTeamId] = useState(snap.teams[0]?.id ?? '');
  if (!teamId) return null;
  return (
    <>
      <div className="field-help" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>On by default: PR opened → started, review requested → In Review, merged → Done. Issues only move forward.</span>
        {snap.teams.length > 1 && <select className="text-input" style={{ width: 'auto', height: 28 }} aria-label="Team for automations" value={teamId} onChange={e => setTeamId(e.target.value)}>{snap.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      </div>
      <PrAutomationSettings teamId={teamId} bare />
    </>
  );
}

/* ================= webhooks: real-time, inbound only ================= */
const DELIVERY_COLOR: Record<WebhookDelivery['status'], string> = { processed: '#4cb782', ignored: 'var(--text-dim)', rejected: '#eb5757' };
function WebhookSettings({ polls }: { polls: boolean }) {
  const toast = useApp(s => s.toast);
  const [cfg, setCfg] = useState<WebhookConfig | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const load = async () => { const c = await api.webhookConfig(); setCfg(c); setUrl(c.publicUrl); setDeliveries((await api.webhookDeliveries(15)).deliveries); };
  useEffect(() => { void load().catch(() => {}); const t = setInterval(() => void load().catch(() => {}), 15000); return () => clearInterval(t); }, []);
  if (!cfg) return null;
  const payloadUrl = `${cfg.publicUrl || 'https://<your-tunnel>'}/api/github/webhook`;
  const copy = async (text: string, what: string) => { if (await copyText(text)) toast({ title: `Copied ${what}` }); };
  const saveUrl = async () => { if (url === cfg.publicUrl) return; try { setCfg(await api.setWebhookUrl(url)); setUrlError(''); } catch (e) { setUrlError((e as Error).message); } };
  const state = !cfg.enabled ? 'Off' : !cfg.lastDelivery ? (cfg.fixedUrl ? 'Waiting for GitHub’s ping' : 'Waiting for the first delivery') : `Receiving · last ${relTime(cfg.lastDelivery.receivedAt)}`;
  return (
    <>
      <div className="settings-h2">Real-time updates (webhooks)</div>
      <div className="field-help" style={{ marginBottom: 6 }}>{polls ? 'Without webhooks, Baseline checks GitHub every two minutes. With them,' : 'Without a token, this is how Baseline hears from GitHub:'} GitHub tells Baseline the moment a PR opens, gets a review, passes checks or merges. Deliveries are verified against a secret only you and GitHub know; nothing is sent back.</div>
      <div className="field-row">
        <div><div className="field-label">Status</div><div className="field-help"><span className="gh-dot" style={{ background: !cfg.enabled ? 'var(--text-dim)' : cfg.lastDelivery ? '#4cb782' : '#f2c94c' }} />{state}{cfg.rejected ? ` · ${cfg.rejected} rejected` : ''}</div></div>
        {cfg.enabled
          ? <span style={{ display: 'flex', gap: 6 }}><button className="btn secondary sm" onClick={async () => { setSecret((await api.rotateWebhookSecret()).secret); await load(); }}>Rotate secret</button><button className="btn ghost sm" onClick={async () => { await api.turnOffWebhooks(); setSecret(null); await load(); }}>Turn off</button></span>
          : <button className="btn primary sm" onClick={async () => { setSecret((await api.rotateWebhookSecret()).secret); await load(); }}>Generate secret</button>}
      </div>
      {secret && (
        <div className="gh-secret">
          <div className="field-help">Your webhook secret. Copy it into GitHub now; it won't be shown again.</div>
          <div className="gh-copy-row"><code>{secret}</code><button className="btn secondary sm" onClick={() => void copy(secret, 'secret')}><IconCopy size={13} /> Copy</button></div>
        </div>
      )}
      {!cfg.fixedUrl && (
        <div className="field-row">
          <div><div className="field-label">Public address</div><div className="field-help">Baseline only listens on this machine, so GitHub reaches it through a tunnel, e.g. <code>cloudflared tunnel --url http://localhost:{location.port || 7327}</code>. Only the webhook path is reachable from outside, and only with a valid signature.{urlError && <span style={{ color: 'var(--danger)' }}> {urlError}</span>}</div></div>
          <input className="text-input" style={{ width: 280 }} aria-label="Public address" placeholder="https://baseline.example.com" value={url} onChange={e => setUrl(e.target.value)} onBlur={() => void saveUrl()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>
      )}
      <div className="gh-steps">
        <div className="field-label" style={{ marginBottom: 6 }}>Add it in GitHub</div>
        <ol>
          <li>In your repository or organization: <b>Settings › Webhooks › Add webhook</b>.</li>
          <li>Payload URL <span className="gh-copy-row inline"><code>{payloadUrl}</code>{cfg.publicUrl && <button className="icon-btn" title="Copy payload URL" onClick={() => void copy(payloadUrl, 'payload URL')}><IconCopy size={13} /></button>}</span></li>
          <li>Content type <code>application/json</code>, and the secret above.</li>
          <li>Choose <b>Let me select individual events</b>: {cfg.events.map((e, i) => <span key={e}>{i ? ', ' : ''}<code>{e.replace(/_/g, ' ')}</code></span>)}.</li>
        </ol>
        <div className="field-help">An organization webhook covers every repository in it. GitHub only needs this webhook, with no app, token or OAuth grant.</div>
      </div>
      {deliveries.length > 0 && (
        <>
          <div className="field-label" style={{ margin: '14px 0 6px' }}>Recent deliveries</div>
          <div className="card set-list gh-deliveries">
            {deliveries.map(d => (
              <div key={d.id} className="set-row">
                <span className="gh-dot" style={{ background: DELIVERY_COLOR[d.status] }} title={d.status} />
                <span className="gh-ev"><b>{d.event.replace(/_/g, ' ')}</b>{d.action ? ` · ${d.action}` : ''}</span>
                <span className="set-meta gh-detail">{d.repo ?? ''}{d.detail ? ` — ${d.detail}` : ''}</span>
                <span className="set-meta">{d.status === 'processed' ? '' : `${d.status} · `}{relTime(d.receivedAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ================= GitHub Issues → Baseline (one way) ================= */
function IssueImportSettings({ repos }: { repos: string[] }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const [cfg, setCfg] = useState<WebhookConfig | null>(null);
  const [repo, setRepo] = useState('');
  const [teamId, setTeamId] = useState(snap.teams[0]?.id ?? '');
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void api.webhookConfig().then(setCfg).catch(() => {}); }, []);
  useEffect(() => { if (!repo && repos[0]) setRepo(repos[0]); }, [repos.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    setBusy(true); setError('');
    try { const r = await api.importGithubIssues(repo.trim(), teamId, follow); toast({ title: `Imported ${r.imported} issue${r.imported === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already here` : ''}` }); await refresh(); setCfg(await api.webhookConfig()); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="settings-h2">Import GitHub Issues</div>
      <div className="field-help" style={{ marginBottom: 6 }}>Bring a repository's open issues into a team's triage, one way. Labels match the team's labels by name. With webhooks on, new GitHub issues keep arriving and closing one there completes it here. Nothing in GitHub changes.</div>
      <div className="gh-import">
        <input className="text-input" list="gh-repos" aria-label="Repository" placeholder="owner/repo" value={repo} onChange={e => setRepo(e.target.value)} />
        <datalist id="gh-repos">{repos.map(r => <option key={r} value={r} />)}</datalist>
        <select className="text-input" aria-label="Team" value={teamId} onChange={e => setTeamId(e.target.value)}>{snap.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <label className="gh-follow"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Keep importing new issues</label>
        <button className="btn secondary sm" disabled={busy || !/^[\w.-]+\/[\w.-]+$/.test(repo.trim()) || !teamId} onClick={() => void run()}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
      {error && <div className="field-help" style={{ color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
      {!!cfg?.imports.length && (
        <div className="card set-list" style={{ marginTop: 10 }}>
          {cfg.imports.map(x => (
            <div key={x.repo} className="set-row"><IconPr size={14} /><span style={{ flex: 1 }}><b>{x.repo}</b> <span className="set-meta">→ {snap.teams.find(t => t.id === x.teamId)?.name ?? 'removed team'} · following new issues</span></span>
              <button className="btn ghost sm" onClick={async () => setCfg(await api.followGithubIssues(x.repo, null))}>Stop</button></div>
          ))}
        </div>
      )}
    </>
  );
}

/* ================= team settings: pull request automations ================= */
export function PrAutomationSettings({ teamId, bare }: { teamId: string; /** without its own heading (the GitHub page has one) */ bare?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const [auto, setAuto] = useState<PrAutomation | null>(null);
  useEffect(() => { void api.gitAutomation(teamId).then(setAuto); }, [teamId, snap.states.length]);
  if (!auto) return null;
  const states = snap.states.filter(s => s.teamId === teamId).sort((a, b) => a.position - b.position);
  const save = async (patch: Partial<PrAutomation>) => { const next = { ...auto, ...patch }; setAuto(next); await api.setGitAutomation(teamId, patch); };
  return (
    <div className={bare ? undefined : 'pr-auto'} data-pr-automations>
      {!bare && <>
        <div className="settings-h2">Pull request automations</div>
        <div className="field-help" style={{ marginBottom: 8 }}>Move issues when their linked pull requests change. On by default; issues only move forward, canceled issues are never touched, and with several PRs the issue waits for the last one.{!snap.workspace.features.githubEnabled && ' Add a repository in Settings › Integrations › GitHub to start syncing.'}</div>
      </>}
      <div className="card set-list">
        {EVENTS.map(([ev, label]) => (
          <div key={ev} className="set-row">
            <span style={{ flex: 1 }}>{label}</span>
            <select className="text-input" aria-label={`${label} state`} value={auto[ev] ?? ''} onChange={e => void save({ [ev]: e.target.value || null } as Partial<PrAutomation>)}>
              <option value="">No action</option>
              {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        ))}
        {auto.branchRules.map((r, i) => (
          <div key={i} className="set-row">
            <span>Target branch matches</span>
            <input className="text-input" style={{ width: 160 }} value={r.pattern} onChange={e => void save({ branchRules: auto.branchRules.map((x, n) => n === i ? { ...x, pattern: e.target.value } : x) })} />
            <select className="text-input" value={r.event} onChange={e => void save({ branchRules: auto.branchRules.map((x, n) => n === i ? { ...x, event: e.target.value as PrEvent } : x) })}>{EVENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select className="text-input" value={r.stateId ?? ''} onChange={e => void save({ branchRules: auto.branchRules.map((x, n) => n === i ? { ...x, stateId: e.target.value || null } : x) })}><option value="">No action</option>{states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <button className="icon-btn" title="Remove rule" onClick={() => void save({ branchRules: auto.branchRules.filter((_, n) => n !== i) })}><IconClose size={12} /></button>
          </div>
        ))}
        <div className="set-row"><button className="btn ghost sm" onClick={() => void save({ branchRules: [...auto.branchRules, { pattern: '^staging$', event: 'merged', stateId: null }] })}>Add branch-specific rule</button></div>
      </div>
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="ext-link">{children}<IconExternal size={11} /></a>;
}
