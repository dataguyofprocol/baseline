import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, refresh, relTime } from './store.js';
import { api } from './api.js';
import { Modal } from './ui.js';
import { GitHubAccess, GitHubRepos } from './GitHubUI.js';
import { IconClose, IconGithub, IconShieldUser } from './icons.js';
import type { GitStatus, GithubSummary } from '../../src/core/types.js';

/* Connecting GitHub from setup, without leaving for Settings: access, then repositories, then what
   the first sync found. It reuses the settings page's access and repository pieces, so the gh sign-in,
   token expiry and missing-CLI cases behave the same in both places. */

const STEPS = ['Access', 'Repositories', 'Done'] as const;
const DOCS_TOKEN = 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token';
const DOCS_ORG_POLICY = 'https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization';

export function GitHubSetup({ onClose }: { onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const hosted = snap.workspace.auth === 'hosted';
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [summary, setSummary] = useState<GithubSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [guide, setGuide] = useState(false);
  const load = async () => {
    await api.gitStatus().then(setStatus).catch(() => {});
    await api.githubSummary().then(setSummary).catch(() => {});
  };
  useEffect(() => { void load(); }, []);
  const canRead = !!status && (status.source === 'token' || (status.source === 'login' && !!status.ghUser));
  const sync = async () => {
    setSyncing(true);
    try { await api.gitSync(); await refresh(); await load(); } catch { /* the done step shows lastError */ } finally { setSyncing(false); }
  };
  const next = async () => {
    if (step === 1) { setStep(2); await sync(); return; }
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  };
  const canNext = step === 0 ? canRead : step === 1 ? !!status?.repos.length : true;

  return (
    <Modal onClose={onClose} className="modal ghs-modal">
      <div className="ghs" data-github-setup>
        <header className="ghs-head">
          <span className="ghs-mark"><IconGithub size={18} /></span>
          <div className="ghs-title">
            <h2>Never update a status by hand again</h2>
            <p>Your pull requests keep issues honest: started when one opens, in review when you ask, done when it merges.</p>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><IconClose size={14} /></button>
        </header>
        <nav className="ghs-steps" aria-label="GitHub setup steps">
          {STEPS.map((label, i) => (
            <button key={label} aria-current={i === step ? 'step' : undefined} className={i === step ? 'on' : i < step ? 'past' : undefined}
              disabled={i > step && !(i === 1 && canRead)} onClick={() => setStep(i)}>
              <span className="ghs-n">0{i + 1}</span>{label}
            </button>
          ))}
        </nav>

        <div className="ghs-body" key={step}>
          {step === 0 && <>
            <div className="ghs-safe">
              <IconShieldUser size={20} />
              <div>
                <b>Read-only. Enforced by GitHub, not by a promise.</b>
                <span>Baseline checks every token and refuses one that can write.</span>
              </div>
              <ul>
                <li><b>Can't push code.</b> Contents is read-only.</li>
                <li><b>Can't comment or label.</b> Issues and pull requests are read-only.</li>
                <li><b>Can't merge or rerun checks.</b> GitHub rejects the call.</li>
                <li><b>Never in a browser.</b> The token stays on the server.</li>
              </ul>
            </div>
            <div className="ghs-card">
              {status ? <GitHubAccess status={status} hosted={hosted} onChange={load} bare /> : <div className="field-help">Checking GitHub access…</div>}
              {status?.token && <div className="ghs-ok">Connected as <b>@{status.token.login}</b>{status.token.expiresAt ? ` · expires ${new Date(status.token.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>}
              <button className="ghs-guide-toggle" aria-expanded={guide} onClick={() => setGuide(g => !g)}>{guide ? 'Hide the steps' : 'Show me the steps'}</button>
              {guide && (
                <div className="ghs-guide">
                  <ol>
                    <li>Open GitHub's form: Settings › Developer settings › Fine-grained tokens › Generate new token. The <a href={DOCS_TOKEN} target="_blank" rel="noreferrer">docs walk through it ↗</a>.</li>
                    <li>Name it <code>Baseline</code> and set expiry to 90 days.</li>
                    <li>Set Resource owner to your organization. Tokens under your personal account can't select the team's repos. If your org must approve tokens, <a href={DOCS_ORG_POLICY} target="_blank" rel="noreferrer">an owner signs off first ↗</a>.</li>
                    <li>Under Repository access, choose <b>Only select repositories</b>, then pick the ones your team ships from.</li>
                    <li>Under Repository permissions, set Metadata, Contents, Pull requests, Issues and Checks to <b>Read-only</b>.</li>
                    <li>Generate it, copy it and paste it in the field above. GitHub shows it once, then never again.</li>
                  </ol>
                </div>
              )}
            </div>
          </>}

          {step === 1 && <>
            <div className="ghs-lede">
              <h3>Where does your team ship from?</h3>
              <p>Pick the repositories to sync and the team each one belongs to. A PR in a repository moves that team's issues.</p>
            </div>
            <div className="ghs-card">
              {status && <GitHubRepos status={status} hosted={hosted} canRead={canRead} onChange={load} onAdded={async () => {}} bare />}
            </div>
          </>}

          {step === 2 && (
            <div className="ghs-done">
              <div className="ghs-done-head">
                {syncing ? <span className="ghs-spin" aria-hidden="true" /> : <span className="ghs-check" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.5" fill="var(--green)" /><path d="M4.3 7.2l1.8 1.8 3.6-3.9" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
                <div>
                  <h3>{syncing ? 'Reading your pull requests…' : summary && summary.linkedPrs > 0 ? `It's already working. ${summary.linkedPrs} pull request${summary.linkedPrs === 1 ? ' is' : 's are'} linked to issues.` : 'Connected. Issues move with their next pull request.'}</h3>
                  <p>{syncing ? 'The first sync takes a few seconds.' : status?.lastError ? `Last sync had an error: ${status.lastError}` : `Synced ${status?.lastSyncAt ? relTime(status.lastSyncAt) : 'just now'}. After this it checks every 2 minutes.`}</p>
                </div>
              </div>
              {summary && !syncing && (
                <div className="ghs-stats">
                  <div><b>{summary.repos}</b><span>repositories</span></div>
                  <div><b>{summary.openPrs}</b><span>open pull requests</span></div>
                  <div><b>{summary.linkedPrs}</b><span>linked to issues</span></div>
                </div>
              )}
              <div className="ghs-more">
                <div><b>Instant updates</b><span>A webhook makes it the same second instead of every 2 minutes.</span></div>
                <div><b>Who's who</b><span>Match pull request authors to people, so their work shows under their name.</span></div>
                <button className="btn secondary sm" onClick={() => { onClose(); navigate('/settings/github'); }}>Open GitHub settings</button>
              </div>
            </div>
          )}
        </div>

        <footer className="ghs-foot">
          <button className="btn ghost sm" disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>Back</button>
          <span style={{ flex: 1 }} />
          {step < STEPS.length - 1
            ? <button className="btn primary sm" disabled={!canNext} onClick={() => void next()}>{step === 1 ? 'Sync and finish' : 'Continue'}</button>
            : <button className="btn primary sm" onClick={onClose}>Back to setup</button>}
        </footer>
      </div>
    </Modal>
  );
}
