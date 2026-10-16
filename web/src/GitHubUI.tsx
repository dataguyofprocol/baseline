import { useEffect, useState } from 'react';
import { useApp, relTime } from './store.js';
import { api } from './api.js';
import { IconPr, IconCommit, IconClose, IconExternal } from './icons.js';
import { branchName } from '../../src/core/handoff.js';
import type { PrAutomation, PrEvent, PullRequest } from '../../src/core/types.js';

const refresh = () => useApp.getState().bootstrap();
const PR_COLOR: Record<PullRequest['state'], string> = { draft: '#8a8f98', open: '#4cb782', merged: '#a371f7', closed: '#eb5757' };
const EVENTS: Array<[PrEvent, string]> = [['draft', 'Draft PR opened'], ['opened', 'PR opened'], ['review', 'Review requested or activity'], ['ready', 'Ready for merge'], ['merged', 'Merged']];

export function PrIcon({ state, size = 14 }: { state: PullRequest['state']; size?: number }) {
  return <span className="pr-icon" style={{ color: PR_COLOR[state] }} title={`PR ${state}`}><IconPr size={size} /></span>;
}

/** the furthest-along PR linked to an issue, for list rows */
export function issuePrState(snap: NonNullable<ReturnType<typeof useApp.getState>['snap']>, issueId: string): PullRequest['state'] | null {
  const prs = snap.issuePrs.filter(l => l.issueId === issueId && !l.dismissed).map(l => snap.pullRequests.find(p => p.id === l.prId)).filter(Boolean) as PullRequest[];
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
      <div className="field-help" style={{ marginBottom: 16 }}>Link pull requests and commits to issues and move issues as PRs progress, like Linear's GitHub integration. Baseline reads your locations' repos with the GitHub CLI (<code>gh</code>) and <code>git log</code>; nothing is written to GitHub.</div>
      <div className="field-row">
        <div><div className="field-label">Enable GitHub</div><div className="field-help">Syncs every two minutes and adds an “In Review” state to each team.</div></div>
        <button className={`switch${f.githubEnabled ? ' on' : ''}`} role="switch" aria-checked={f.githubEnabled} aria-label="Enable GitHub" onClick={async () => { await api.setFeatures({ githubEnabled: !f.githubEnabled }); await refresh(); }}><span /></button>
      </div>
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
      <div className="settings-h2">Linking</div>
      <div className="field-help">A PR links to an issue when its branch name or title contains the issue ID, or its description uses a magic word: <b>closes, fixes, resolves, completes, implements</b> (moves the issue), <b>ref, part of, contributes to, towards</b> (links without moving), <b>related to</b> (mention only). <code>skip {sampleKey}</code> or <code>ignore {sampleKey}</code> opts out. Commits on the default branch with a closing word count as merged.</div>
      <div className="settings-h2">Branch format</div>
      <div className="field-row">
        <div><div className="field-label">Copy git branch (⌘⇧.)</div><div className="field-help">Variables: <code>{'{username}'}</code> <code>{'{issueIdentifier}'}</code> <code>{'{issueTitle}'}</code> — e.g. <code>{branchName(sampleKey, sample?.title ?? 'Fix login redirect', format, snap.currentUser.username || snap.currentUser.name)}</code></div></div>
        <input className="text-input" style={{ width: 300 }} aria-label="Branch format" value={format} onChange={e => setFormat(e.target.value)} onBlur={async () => { if (format !== f.branchFormat) { await api.setFeatures({ branchFormat: format }); await refresh(); } }} />
      </div>
      <div className="field-help" style={{ marginTop: 12 }}>Pull request automations are per team: Settings › your team › Pull request automations.</div>
    </div>
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
