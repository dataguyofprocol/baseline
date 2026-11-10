import { useState } from 'react';
import { useApp, refresh } from './store.js';
import { api } from './api.js';
import { LineFrame, filled, lineState } from './SignIn.js';
import { markArrival, takeArrival } from './arrival.js';
import { markBridge, clearBridge } from './Onboarding.js';

const keyFromName = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'TEAM';

/** Every issue lives in a team, so a workspace with none asks for one before anything else. The
 *  team's key is the word on the line, and its first issue numbers are marked along it. */
export function TeamGate() {
  const snap = useApp(s => s.snap)!;
  const hosted = snap.workspace.auth === 'hosted';
  const [name, setName] = useState('General');
  const [key, setKey] = useState(keyFromName('General'));
  const [keyTouched, setKeyTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    const n = name.trim(), k = key.trim().toUpperCase();
    if (busy || !n || !k) return;
    setBusy(true); setError('');
    // marked before the write: the server's live update mounts the app as soon as the team exists.
    // The first team goes on to the bridge (its setup steps on the same line); a later one arrives
    // straight in the app, which plays the line climbing into its top bar from this mark
    if (useApp.getState().snap?.teams.length === 0) markBridge(); else markArrival();
    try {
      await api.createTeam({ key: k, name: n });
      // the router mounts after the refresh, so it starts on this address
      window.location.hash = `#/team/${k}/all`;
      await refresh();
    } catch (err) {
      takeArrival(); clearBridge();
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const next = [
    'your coding agent',
    snap.currentUser.admin && 'GitHub',
    hosted && (snap.currentUser.admin || snap.workspace.security.whoCanInvite === 'members') && 'your team',
  ].filter((p): p is string => !!p);
  const nextLine = next.length < 2 ? next.join('') : `${next.slice(0, -1).join(', ')} and ${next[next.length - 1]}`;
  const shown = key || 'KEY';

  return (
    <LineFrame
      word={shown} wordLive ticks={[1, 2, 3].map(n => `${shown}-${n}`)}
      progress={filled(name, key)} state={lineState(busy, error)}
      aside={hosted ? <>Signed in as {snap.currentUser.name}</> : undefined}
      headline="Name your team"
      sub={<>{hosted ? 'A shared tracker for your team and its coding agents.' : 'A local-first tracker for you and your coding agents, on this machine.'} Every issue lives in a team.</>}
      step={`Next: connect ${nextLine}.`}
      foot={<><span>Issues will be <b>{shown}-1</b>, <b>{shown}-2</b> and so on.</span><span>Enter creates the team</span></>}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); void create(); }}>
        {error && <div role="alert" className="auth-alert gate-error">{error}</div>}
        <label className="auth-field gate-name">
          <span className="auth-label">Team name</span>
          <input id="gate-name" className="text-input" autoFocus value={name} placeholder="e.g. Engineering"
            onChange={e => { setName(e.target.value); if (!keyTouched) setKey(keyFromName(e.target.value)); }} />
        </label>
        <label className="auth-field gate-key-field">
          <span className="auth-label">Key</span>
          <input className="text-input mono gate-key" value={key} maxLength={7} aria-label="Team key"
            onChange={e => { setKeyTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} />
        </label>
        <button className="btn primary auth-submit auth-go" disabled={busy || !name.trim() || !key.trim()} type="submit">
          <span>{busy ? `Creating ${shown}…` : 'Create team'}</span>
          {busy
            ? <span className="auth-busy-dot" aria-hidden="true" />
            : <svg className="auth-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
      </form>
    </LineFrame>
  );
}
