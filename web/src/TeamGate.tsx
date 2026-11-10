import { useState } from 'react';
import { useApp, refresh } from './store.js';
import { api } from './api.js';
import { Lockup } from './Logo.js';

const keyFromName = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'TEAM';

/** Every issue lives in a team, so a workspace with none asks for one before anything else. */
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
    try {
      await api.createTeam({ key: k, name: n });
      // the router mounts after the refresh, so it starts on this address
      window.location.hash = `#/team/${k}/all`;
      await refresh();
    } catch (err) {
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
  const step = (i: number) => ({ ['--i' as string]: i });

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={e => { e.preventDefault(); void create(); }}>
        <div className="gate-in" style={step(0)}><Lockup size={26} tone="var(--text-primary)" /></div>
        <div className="gate-pitch gate-in" style={step(1)}>
          {hosted ? 'A shared tracker for your team and its coding agents.' : 'A local-first tracker for you and your coding agents, on this machine.'}
          <span className="gate-next">Next: connect {nextLine}.</span>
        </div>
        <label className="gate-title gate-in" style={step(2)} htmlFor="gate-name">Name your team</label>
        <div className="gate-fields gate-in" style={step(3)}>
          <input id="gate-name" className="text-input" autoFocus value={name} placeholder="e.g. Engineering"
            onChange={e => { setName(e.target.value); if (!keyTouched) setKey(keyFromName(e.target.value)); }} />
          <input className="text-input mono gate-key" value={key} maxLength={7} aria-label="Team key"
            onChange={e => { setKeyTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} />
        </div>
        <div className="gate-foot gate-in" style={step(4)}>
          <span className="gate-hint">Issues will be <b>{key || 'KEY'}-1</b>, <b>{key || 'KEY'}-2</b> and so on.</span>
          <button className="btn primary sm" disabled={busy || !name.trim() || !key.trim()} type="submit">
            {busy ? 'Creating…' : 'Create team'} <span className="kbd">↵</span>
          </button>
        </div>
        {error && <div className="gate-error" role="alert">{error}</div>}
      </form>
    </div>
  );
}
