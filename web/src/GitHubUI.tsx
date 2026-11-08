import { useEffect, useState } from 'react';
import { useApp, relTime, copyText } from './store.js';
import { api } from './api.js';
import { IconPr, IconCommit, IconClose, IconExternal, IconCopy, IconShieldUser } from './icons.js';
import { branchName } from '../../src/core/handoff.js';
import type { PrAutomation, PrEvent, PullRequest, WebhookConfig, WebhookDelivery } from '../../src/core/types.js';

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
            <span className="pr-meta">{p.repo}#{p.number}</span>
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

/* ================= Settings › Integrations › GitHub ================= */
export function GitHubSettings() {
  const snap = useApp(s => s.snap)!;
  const f = snap.workspace.features;
  const hosted = snap.workspace.auth === 'hosted';
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.gitStatus>> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState('');
  const [format, setFormat] = useState(f.branchFormat);
  useEffect(() => { void api.gitStatus().then(setStatus).catch(() => {}); }, [f.githubEnabled]);
  const sync = async () => { setSyncing(true); try { const r = await api.gitSync(); setResult(`${r.prs} pull requests, ${r.commits} new commit links${r.error ? ` — ${r.error}` : ''}`); await refresh(); setStatus(await api.gitStatus()); } finally { setSyncing(false); } };
  const sample = snap.issues[0];
  const sampleKey = sample ? `${snap.teams.find(t => t.id === sample.teamId)?.key}-${sample.number}` : 'ENG-42';
  return (
    <div className="settings-card wide">
      <h1>GitHub</h1>
      <div className="field-help" style={{ marginBottom: 14 }}>Link pull requests and commits to issues and move issues as PRs progress, like Linear's GitHub integration.</div>
      <div className="gh-readonly">
        <IconShieldUser size={16} />
        <div>
          <b>Read-only by design.</b> Baseline never writes to GitHub — no comments, status checks, labels, branches or pushes.{' '}
          {hosted
            ? <>It reads pull requests, reviews, checks, commits and issues from signed webhooks GitHub sends here, which need no token at all.</>
            : <>It reads pull requests, reviews, checks, commits and issues two ways: your <code>gh</code> sign-in, limited in code to read commands,
              and signed webhooks GitHub sends here, which need no token at all.</>}
        </div>
      </div>
      <div className="field-row">
        <div><div className="field-label">Enable GitHub</div><div className="field-help">{hosted ? 'Links pull requests and commits as GitHub’s webhooks report them, and adds an “In Review” state to each team.' : 'Syncs every two minutes and adds an “In Review” state to each team.'}</div></div>
        <button className={`switch${f.githubEnabled ? ' on' : ''}`} role="switch" aria-checked={f.githubEnabled} aria-label="Enable GitHub" onClick={async () => { await api.setFeatures({ githubEnabled: !f.githubEnabled }); await refresh(); }}><span /></button>
      </div>
      {!hosted && <>
        <div className="field-row">
          <div><div className="field-label">GitHub CLI</div><div className="field-help">{!status ? 'Checking…' : !status.ghInstalled ? 'Not found — install it with `brew install gh`, then `gh auth login`.' : status.ghUser ? `Signed in as ${status.ghUser}` : 'Installed, not signed in — run `gh auth login`.'}</div></div>
          <button className="btn secondary sm" disabled={syncing} onClick={sync}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        </div>
        {result && <div className="field-help" style={{ margin: '-6px 0 10px' }}>{result}</div>}
        <div className="settings-h2">Repositories</div>
        <div className="field-help" style={{ marginBottom: 8 }}>Every location (Settings › Coding tools) whose <code>origin</code> is on GitHub. {status?.lastSyncAt ? `Last sync ${relTime(status.lastSyncAt)}.` : ''} {status?.lastError ? `Last error: ${status.lastError}` : ''}</div>
        <div className="card set-list">
          {(status?.repos ?? []).map(r => (
            <div key={r.path} className="set-row"><IconPr size={14} /><span style={{ flex: 1 }}><b>{r.location}</b> <span className="set-meta">{r.path}</span></span><span className={r.repo ? '' : 'dim'}>{r.repo ?? 'not a GitHub repo'}</span></div>
          ))}
          {status && !status.repos.length && <div className="set-empty">No locations yet — add one in Settings › Coding tools.</div>}
        </div>
      </>}
      <WebhookSettings />
      <IssueImportSettings repos={[...new Set((status?.repos ?? []).map(r => r.repo).filter((r): r is string => !!r))]} />
      <div className="settings-h2">Linking</div>
      <div className="field-help">A PR links to an issue when its branch name or title contains the issue ID, or its description uses a magic word: <b>closes, fixes, resolves, completes, implements</b> (moves the issue), <b>ref, part of, contributes to, towards</b> (links without moving), <b>related to</b> (mention only). <code>skip {sampleKey}</code> or <code>ignore {sampleKey}</code> opts out. Commits on the default branch with a closing word count as merged.</div>
      <div className="field-help" style={{ marginTop: 8 }}><b>{sampleKey.split('-')[0]}-NEW</b> in a PR's title or description files a new issue in that team, titled from the PR, started, assigned to the PR's author and linked to the PR.</div>
      <div className="settings-h2">People</div>
      <div className="field-help">A PR whose author matches a member's GitHub username (Settings › Profile, or Members) is theirs: its activity shows under their name, and an unassigned issue it closes is assigned to them. {(() => { const n = snap.users.filter(u => u.kind === 'human' && u.githubUsername).length; return n ? `${n} member${n === 1 ? ' has' : 's have'} a GitHub username.` : 'No member has a GitHub username yet.'; })()}</div>
      <div className="settings-h2">Branch format</div>
      <div className="field-row">
        <div><div className="field-label">Copy git branch (⌘⇧.)</div><div className="field-help">Variables: <code>{'{username}'}</code> <code>{'{issueIdentifier}'}</code> <code>{'{issueTitle}'}</code> — e.g. <code>{branchName(sampleKey, sample?.title ?? 'Fix login redirect', format, snap.currentUser.username || snap.currentUser.name)}</code></div></div>
        <input className="text-input" style={{ width: 300 }} aria-label="Branch format" value={format} onChange={e => setFormat(e.target.value)} onBlur={async () => { if (format !== f.branchFormat) { await api.setFeatures({ branchFormat: format }); await refresh(); } }} />
      </div>
      <div className="field-help" style={{ marginTop: 12 }}>Pull request automations are per team: Settings › your team › Pull request automations.</div>
    </div>
  );
}

/* ================= webhooks: real-time, inbound only ================= */
const DELIVERY_COLOR: Record<WebhookDelivery['status'], string> = { processed: '#4cb782', ignored: 'var(--text-dim)', rejected: '#eb5757' };
function WebhookSettings() {
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
      <div className="field-help" style={{ marginBottom: 6 }}>{cfg.fixedUrl ? 'This is how Baseline hears from GitHub:' : 'Without webhooks, Baseline checks GitHub every two minutes. With them,'} GitHub tells Baseline the moment a PR opens, gets a review, passes checks or merges. Deliveries are verified against a secret only you and GitHub know; nothing is sent back.</div>
      <div className="field-row">
        <div><div className="field-label">Status</div><div className="field-help"><span className="gh-dot" style={{ background: !cfg.enabled ? 'var(--text-dim)' : cfg.lastDelivery ? '#4cb782' : '#f2c94c' }} />{state}{cfg.rejected ? ` · ${cfg.rejected} rejected` : ''}</div></div>
        {cfg.enabled
          ? <span style={{ display: 'flex', gap: 6 }}><button className="btn secondary sm" onClick={async () => { setSecret((await api.rotateWebhookSecret()).secret); await load(); }}>Rotate secret</button><button className="btn ghost sm" onClick={async () => { await api.turnOffWebhooks(); setSecret(null); await load(); }}>Turn off</button></span>
          : <button className="btn primary sm" onClick={async () => { setSecret((await api.rotateWebhookSecret()).secret); await load(); }}>Generate secret</button>}
      </div>
      {secret && (
        <div className="gh-secret">
          <div className="field-help">Your webhook secret — copy it into GitHub now; it won't be shown again.</div>
          <div className="gh-copy-row"><code>{secret}</code><button className="btn secondary sm" onClick={() => void copy(secret, 'secret')}><IconCopy size={13} /> Copy</button></div>
        </div>
      )}
      {!cfg.fixedUrl && (
        <div className="field-row">
          <div><div className="field-label">Public address</div><div className="field-help">Baseline only listens on this machine, so GitHub reaches it through a tunnel, e.g. <code>cloudflared tunnel --url http://localhost:{location.port || 7327}</code>. Only the webhook path is reachable from outside, and only with a valid signature.{urlError && <span style={{ color: '#eb5757' }}> {urlError}</span>}</div></div>
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
        <div className="field-help">An organization webhook covers every repository in it. GitHub only needs this webhook — no app, token or OAuth grant.</div>
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
      {error && <div className="field-help" style={{ color: '#eb5757', marginTop: 6 }}>{error}</div>}
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
export function PrAutomationSettings({ teamId }: { teamId: string }) {
  const snap = useApp(s => s.snap)!;
  const [auto, setAuto] = useState<PrAutomation | null>(null);
  useEffect(() => { void api.gitAutomation(teamId).then(setAuto); }, [teamId, snap.states.length]);
  if (!auto) return null;
  const states = snap.states.filter(s => s.teamId === teamId).sort((a, b) => a.position - b.position);
  const save = async (patch: Partial<PrAutomation>) => { const next = { ...auto, ...patch }; setAuto(next); await api.setGitAutomation(teamId, patch); };
  return (
    <div className="pr-auto">
      <div className="settings-h2">Pull request automations</div>
      <div className="field-help" style={{ marginBottom: 8 }}>Move issues when their linked pull requests change. Issues only move forward, canceled issues are never touched, and with several PRs the issue waits for the last one.{!snap.workspace.features.githubEnabled && ' Turn on Settings › Integrations › GitHub to start syncing.'}</div>
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
