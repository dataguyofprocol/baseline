import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, relTime, copyText } from './store.js';
import { api } from './api.js';
import { ConfirmButton } from './ui.js';
import { Avatar } from './pickers.js';
import { IconBack, IconCopy } from './icons.js';
import { API_KEY_SCOPES, type ApiKey, type ApiKeyScope } from '../../src/core/types.js';

const refresh = () => useApp.getState().bootstrap();

function scopeText(k: ApiKey, teamName: (id: string) => string): string {
  const perms = k.scopes ? k.scopes.map(s => API_KEY_SCOPES.find(([x]) => x === s)?.[1]).join(', ') : 'Full access';
  return k.teamIds ? `${perms} · ${k.teamIds.map(teamName).join(', ')}` : perms;
}

function KeyRow({ k, owner, onRevoke }: { k: ApiKey; owner?: boolean; onRevoke: () => void }) {
  const snap = useApp(s => s.snap)!;
  const user = snap.users.find(u => u.id === k.userId);
  const [name, setName] = useState(k.name);
  return (
    <div className="set-row group" data-api-key={k.id}>
      {owner && user && <Avatar user={user} size={18} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {owner ? <div className="field-label">{k.name}</div>
          : <input className="inline-edit field-label" aria-label="Key name" value={name} onChange={e => setName(e.target.value)} onBlur={async () => { if (name.trim() && name !== k.name) await api.renameApiKey(k.id, name); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
        <div className="set-meta">
          <span className="mono">bl_api_…{k.hint}</span> · {scopeText(k, id => snap.teams.find(t => t.id === id)?.name ?? 'deleted team')}
          {owner && user ? ` · ${user.name}` : ''} · Created {relTime(k.createdAt)} · {k.lastUsedAt ? `Last used ${relTime(k.lastUsedAt)}` : 'Never used'}
        </div>
      </div>
      <ConfirmButton className="btn ghost sm" label="Revoke" confirmLabel="Revoke?" onConfirm={onRevoke} />
    </div>
  );
}

/* ================= Settings › Security & access ================= */
export function SecuritySettings() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const load = () => void api.apiKeys().then(r => setKeys(r.keys));
  useEffect(load, []);
  const me = snap.currentUser;
  const blocked = snap.workspace.features.apiKeyCreation === 'admins' && !me.admin;
  return (
    <div className="settings-card">
      <h1>Security &amp; access</h1>
      <div className="settings-h2">Sessions</div>
      <div className="field-help" style={{ marginBottom: 8 }}>Devices using this workspace</div>
      <div className="card set-list">
        <div className="set-row"><div style={{ flex: 1 }}><div className="field-label">This computer</div><div className="set-meta"><span style={{ color: '#4cb782' }}>● Current session</span> · {location.host}</div></div></div>
        {snap.workspace.lanHost && <div className="set-row"><div style={{ flex: 1 }}><div className="field-label">Other devices on your network</div><div className="set-meta">Open at {snap.workspace.lanHost} (BASELINE_HOST){snap.workspace.features.apiKeyRequiredRemote ? ' · API key required' : ''}</div></div></div>}
      </div>
      <div className="settings-h2">Personal API keys</div>
      <div className="field-help" style={{ marginBottom: 8 }}>Use Baseline’s REST API to build your own integrations. Send the key as <code>Authorization: Bearer &lt;key&gt;</code>.</div>
      <div className="card set-list" data-api-keys>
        {(keys ?? []).map(k => <KeyRow key={k.id} k={k} onRevoke={async () => { await api.revokeApiKey(k.id); load(); }} />)}
        <div className="set-row">
          <span className="dim" style={{ flex: 1 }}>{keys && !keys.length ? 'No API keys created' : blocked ? 'Only admins can create API keys' : ''}</span>
          <button className="btn ghost sm" disabled={blocked} onClick={() => navigate('/settings/security/new-api-key')}>New API key</button>
        </div>
      </div>
    </div>
  );
}

/* ================= Settings › Security & access › Create API key ================= */
export function NewApiKey() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [limitScopes, setLimitScopes] = useState(false);
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [limitTeams, setLimitTeams] = useState(false);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<{ key: ApiKey; token: string } | null>(null);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const valid = name.trim() && (!limitScopes || scopes.length) && (!limitTeams || teamIds.length);
  const create = async () => {
    if (!valid) return;
    try { setCreated(await api.createApiKey({ name: name.trim(), scopes: limitScopes ? scopes : null, teamIds: limitTeams ? teamIds : null })); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  };
  const back = <Link to="/settings/security" className="settings-crumb"><IconBack size={13} /> Security settings</Link>;
  if (created) return (
    <div className="settings-card">
      {back}
      <h1>API key created</h1>
      <div className="field-help" style={{ marginBottom: 16 }}>Copy your key now — you won’t be able to see it again.</div>
      <div className="card api-key-reveal">
        <div className="field-label" style={{ marginBottom: 8 }}>{created.key.name}</div>
        <div className="api-key-token">
          <code data-api-token>{created.token}</code>
          <button className="btn secondary sm" onClick={async () => { if (await copyText(created.token)) useApp.getState().toast({ title: 'Copied API key' }); }}><IconCopy size={13} /> Copy</button>
        </div>
        <div className="field-help" style={{ marginTop: 10 }}>Try it: <code>curl -H "Authorization: Bearer {created.token.slice(0, 11)}…" {location.origin}/api/bootstrap</code></div>
        <div className="form-actions"><button className="btn primary" onClick={() => navigate('/settings/security')}>Done</button></div>
      </div>
    </div>
  );
  return (
    <div className="settings-card">
      {back}
      <h1>Create API key</h1>
      <div className="field-help" style={{ marginBottom: 16 }}>When using the API key all actions are attributed to you as an individual</div>
      <div className="card api-key-form">
        <label className="field-label" htmlFor="api-key-name">Key name</label>
        <input id="api-key-name" className="text-input" autoFocus placeholder="A descriptive name for this API key…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
        <div className="field-label" style={{ marginTop: 18 }}>Permissions</div>
        <div className="field-help">Only enable the minimum permissions required for your use case</div>
        <label className="radio-row"><input type="radio" name="perm" checked={!limitScopes} onChange={() => setLimitScopes(false)} /> Full access</label>
        <label className="radio-row"><input type="radio" name="perm" checked={limitScopes} onChange={() => setLimitScopes(true)} /> Only select permissions…</label>
        {limitScopes && <div className="check-grid">
          {API_KEY_SCOPES.map(([k, label, help]) => (
            <label key={k} className="check-row"><input type="checkbox" checked={scopes.includes(k)} onChange={() => setScopes(toggle(scopes, k))} /><span className="check-label">{label}</span><span className="field-help">{help}</span></label>
          ))}
        </div>}
        <div className="field-label" style={{ marginTop: 18 }}>Team access</div>
        <div className="field-help">Set limits around which teams can be accessed via this API key</div>
        <label className="radio-row"><input type="radio" name="teams" checked={!limitTeams} onChange={() => setLimitTeams(false)} /> All teams you have access to</label>
        <label className="radio-row"><input type="radio" name="teams" checked={limitTeams} onChange={() => setLimitTeams(true)} /> Only select teams…</label>
        {limitTeams && <div className="check-grid">
          {snap.teams.map(t => (
            <label key={t.id} className="check-row"><input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => setTeamIds(toggle(teamIds, t.id))} /><span className="check-label">{t.name}</span><span className="field-help">{t.key}</span></label>
          ))}
        </div>}
        {err && <div className="field-help" style={{ color: 'var(--danger, #e5484d)', marginTop: 10 }}>{err}</div>}
        <div className="form-actions">
          <button className="btn secondary" onClick={() => navigate('/settings/security')}>Cancel</button>
          <button className="btn primary" disabled={!valid} onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}

/* ================= Settings › Administration › API ================= */
export function ApiAdminSettings() {
  const snap = useApp(s => s.snap)!;
  const f = snap.workspace.features;
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [err, setErr] = useState('');
  const load = () => void api.apiKeys(true).then(r => setKeys(r.keys)).catch(e => setErr((e as Error).message));
  useEffect(load, []);
  return (
    <div className="settings-card">
      <h1>API</h1>
      <div className="field-help" style={{ marginBottom: 16 }}>Baseline’s REST API (<code>{location.origin}/api</code>) is what the app and the <code>baseline</code> CLI’s server mode use. Scripts and integrations call it with a personal API key.</div>
      <div className="settings-h2">API keys</div>
      <div className="field-help" style={{ marginBottom: 8 }}>Control whether workspace members can create personal API keys. View your own keys in <Link to="/settings/security">Security &amp; access</Link> settings.</div>
      <div className="card set-list">
        <div className="set-row">
          <div style={{ flex: 1 }}><div className="field-label">API key creation</div><div className="field-help">Choose which members can create personal API keys</div></div>
          <select className="text-input" aria-label="API key creation" value={f.apiKeyCreation} onChange={async e => { await api.setFeatures({ apiKeyCreation: e.target.value }); await refresh(); }}>
            <option value="all">All members</option>
            <option value="admins">Only admins</option>
          </select>
        </div>
        <div className="set-row">
          <div style={{ flex: 1 }}><div className="field-label">Require a key from other devices</div><div className="field-help">{snap.workspace.lanHost ? `Baseline is open to your network at ${snap.workspace.lanHost}. When on, requests from other devices need an API key — including the web app opened on them.` : 'Baseline only answers this machine right now. If you set BASELINE_HOST to open it to your network, this makes other devices send an API key.'}</div></div>
          <button className={`switch${f.apiKeyRequiredRemote ? ' on' : ''}`} role="switch" aria-checked={f.apiKeyRequiredRemote} aria-label="Require a key from other devices" onClick={async () => { await api.setFeatures({ apiKeyRequiredRemote: !f.apiKeyRequiredRemote }); await refresh(); }}><span /></button>
        </div>
      </div>
      <div className="settings-h2">Issued keys</div>
      <div className="field-help" style={{ marginBottom: 8 }}>View and manage API keys created by workspace members</div>
      <div className="card set-list" data-issued-keys>
        {(keys ?? []).map(k => <KeyRow key={k.id} k={k} owner onRevoke={async () => { await api.revokeApiKey(k.id); load(); }} />)}
        {keys && !keys.length && <div className="set-empty">No API keys</div>}
        {err && <div className="set-empty">{err}</div>}
      </div>
    </div>
  );
}
