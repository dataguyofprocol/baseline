import { useState } from 'react';
import { useApp } from './store.js';
import { api } from './api.js';
import { Avatar } from './pickers.js';
import { Lockup } from './Logo.js';

const keyFromName = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'TEAM';

/** Shown while the workspace has no teams — issues always live in a team, so
 *  the first run is one step: name the team (you and your agents are already members). */
export function Onboarding() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState('General');
  const [key, setKey] = useState(keyFromName('General'));
  const [keyTouched, setKeyTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!name.trim() || !key.trim() || busy) return;
    setBusy(true);
    try {
      await api.createTeam({ key: key.trim().toUpperCase(), name: name.trim() });
      await useApp.getState().bootstrap();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="on-ink" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 400, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'bl-fade-up 320ms var(--ease) both' }}>
          {/* the serif lockup lives here and nowhere in product chrome */}
          <Lockup size={34} />
          <h1 className="brand-headline">Welcome to {snap.workspace.name}</h1>
          <div className="brand-sub">
            One step to get started: create your first team — issues always live inside a team.
          </div>
        </div>
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14, animation: 'bl-fade-up 340ms var(--ease) 100ms both' }}>
          <div>
            <div className="field-label">Team name</div>
            <input className="text-input" style={{ width: '100%', marginTop: 6 }} autoFocus value={name}
              onChange={e => { setName(e.target.value); if (!keyTouched) setKey(keyFromName(e.target.value)); }}
              onKeyDown={e => e.key === 'Enter' && start()} />
          </div>
          <div>
            <div className="field-label">Key</div>
            <div className="field-help">Prefixes every issue — e.g. <b>{key || 'GEN'}-12</b></div>
            <input className="text-input" style={{ width: 120, marginTop: 6 }} value={key}
              onChange={e => { setKeyTouched(true); setKey(e.target.value.toUpperCase()); }} />
          </div>
          <div>
            <div className="field-label">Members</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {snap.users.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar user={u} size={20} />
                  <span style={{ fontSize: 12.5 }}>{u.name}{u.id === snap.currentUser.id ? <span style={{ color: 'var(--text-dim)' }}> (you)</span> : null}</span>
                  {u.admin && <span className="kbd">Admin</span>}
                  {u.kind === 'agent' && <span className="kbd">Agent</span>}
                </div>
              ))}
            </div>
          </div>
          <button className="btn primary" style={{ height: 30 }} disabled={busy || !name.trim() || !key.trim()} onClick={start}>
            {busy ? 'Creating…' : 'Get started'}
          </button>
        </div>
      </div>
    </div>
  );
}
