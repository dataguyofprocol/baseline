import { useRef, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { IconBack, IconPlus, IconClose, IconTrash } from './icons.js';
import type { WorkflowStateType, Priority } from '../../src/core/types.js';

const NAV: Array<{ sec: string; items: Array<[string, string]> }> = [
  { sec: 'Workspace settings', items: [['Workspace', 'workspace'], ['Teams', 'teams'], ['Members', 'members'], ['Labels', 'labels'], ['Appearance', 'appearance'], ['Import & export', 'data'], ['Keyboard shortcuts', 'shortcuts']] },
];

const STATE_TYPES: Array<[WorkflowStateType, string]> = [
  ['backlog', 'Backlog'], ['unstarted', 'Todo'], ['started', 'Started'], ['completed', 'Completed'], ['canceled', 'Canceled'],
];
const STATE_COLORS = ['#95a2b3', '#8a8f98', '#f2c94c', '#5e6ad2', '#7d8084', '#4cb782', '#eb5757', '#f2994a', '#c770f4', '#3b82f6'];
const LABEL_COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#3b82f6', '#5e6ad2', '#a78bfa', '#c770f4', '#8a8f98'];

export function SettingsLayout() {
  const { section = 'workspace' } = useParams();
  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        <Link to="/" className="back"><IconBack size={14} /> Back to app</Link>
        {NAV.map(g => (
          <div key={g.sec}>
            <div className="sec">{g.sec}</div>
            {g.items.map(([label, key]) => (
              <NavLink key={key} to={`/settings/${key}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ height: 30 }}>
                <span className="nav-label">{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-content">
        {section === 'workspace' && <WorkspaceSettings />}
        {section === 'teams' && <TeamsSettings />}
        {section === 'members' && <MembersSettings />}
        {section === 'labels' && <LabelsSettings />}
        {section === 'appearance' && <AppearanceSettings />}
        {section === 'data' && <DataSettings />}
        {section === 'shortcuts' && <ShortcutSettings />}
      </div>
    </div>
  );
}

function WorkspaceSettings() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState(snap.workspace.name);
  const save = async () => { await api.updateWorkspace({ name }); await useApp.getState().bootstrap(); };
  return (
    <div className="settings-card">
      <h1>Workspace</h1>
      <div className="field-row">
        <div><div className="field-label">Name</div><div className="field-help">Shown in the sidebar and page titles.</div></div>
        <input className="text-input" value={name} onChange={e => setName(e.target.value)} onBlur={save} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Members</div><div className="field-help">{snap.users.length} member(s) in this local workspace.</div></div>
        <span style={{ color: 'var(--text-secondary)' }}>{snap.users.map(u => u.name).join(', ')}</span>
      </div>
      <div className="field-row">
        <div><div className="field-label">MCP server</div><div className="field-help">Run <code>baseline mcp</code> to expose this workspace to coding agents.</div></div>
        <code style={{ fontSize: 12, color: 'var(--text-secondary)' }}>baseline mcp</code>
      </div>
    </div>
  );
}

/* ---------------- teams: rename + workflow states CRUD + cycles ---------------- */
function TeamsSettings() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const create = async () => {
    if (!name.trim() || !key.trim()) return;
    await api.createTeam({ key, name });
    setName(''); setKey('');
    await useApp.getState().bootstrap();
  };
  return (
    <div className="settings-card">
      <h1>Teams</h1>
      {snap.teams.map(t => <TeamEditor key={t.id} teamId={t.id} />)}
      <div className="field-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div><div className="field-label">Create team</div><div className="field-help">Default workflow states are added automatically.</div></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="text-input" style={{ minWidth: 60, width: 60 }} placeholder="KEY" value={key} onChange={e => setKey(e.target.value)} />
          <input className="text-input" placeholder="Team name" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}

function TeamEditor(props: { teamId: string }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const moreMenu = useMenu();
  const team = snap.teams.find(t => t.id === props.teamId)!;
  const states = snap.states.filter(s => s.teamId === team.id).sort((a, b) => a.position - b.position);
  const cycles = snap.cycles.filter(c => c.teamId === team.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const [addingState, setAddingState] = useState(false);
  const [stName, setStName] = useState('');
  const [stType, setStType] = useState<WorkflowStateType>('unstarted');
  const [stColor, setStColor] = useState(STATE_COLORS[1]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(team.name);
  const [addingCycle, setAddingCycle] = useState(false);
  const [cyName, setCyName] = useState('');
  const [cyStart, setCyStart] = useState('');
  const [cyEnd, setCyEnd] = useState('');

  const patchTeam = async (patch: Record<string, unknown>) => {
    await api.updateTeam(team.id, patch);
    await useApp.getState().bootstrap();
  };
  const addState = async () => {
    if (!stName.trim()) return;
    await api.createState({ teamId: team.id, name: stName.trim(), type: stType, color: stColor });
    setStName(''); setAddingState(false);
    await useApp.getState().bootstrap();
  };
  const moveState = async (stateId: string, dir: -1 | 1) => {
    const idx = states.findIndex(s => s.id === stateId);
    const other = states[idx + dir];
    if (!other) return;
    await api.updateState(stateId, { position: other.position });
    await api.updateState(other.id, { position: states[idx].position });
    await useApp.getState().bootstrap();
  };

  const nextCycleNumber = cycles.length ? Math.max(...cycles.map(c => c.number)) + 1 : 1;
  const createCycle = async () => {
    if (!cyStart || !cyEnd) return;
    await api.createCycle({ teamId: team.id, number: nextCycleNumber, name: cyName.trim() || `Cycle ${nextCycleNumber}`, startsAt: new Date(cyStart).toISOString(), endsAt: new Date(cyEnd + 'T23:59:59').toISOString() });
    setCyName(''); setCyStart(''); setCyEnd(''); setAddingCycle(false);
    await useApp.getState().bootstrap();
    toast({ title: 'Cycle created' });
  };

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="ws-avatar" style={{ background: team.color, borderRadius: 4 }}>{team.key.slice(0, 2)}</span>
        {editingName ? (
          <input className="text-input" style={{ height: 26, width: 180 }} autoFocus value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={async () => { await patchTeam({ name: nameDraft || team.name }); setEditingName(false); }}
            onKeyDown={async e => { if (e.key === 'Enter') { await patchTeam({ name: nameDraft || team.name }); setEditingName(false); } }} />
        ) : (
          <b style={{ cursor: 'text' }} onClick={() => { setNameDraft(team.name); setEditingName(true); }}>{team.name}</b>
        )}
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{team.key}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="More team actions" onClick={moreMenu.open}><IconClose size={0} /><span style={{ fontSize: 13 }}>…</span></button>
      </div>
      {moreMenu.anchor && (
        <Menu anchor={moreMenu.anchor} onClose={moreMenu.close}>
          <div className="menu-header"><span>{team.key}</span></div>
          <MenuItem label="Cycle key" onClick={() => {
            const k = prompt('Team key', team.key);
            if (k && k.trim()) void patchTeam({ key: k.trim().toUpperCase() });
          }} />
          <MenuSep />
          <MenuItem icon={<IconTrash size={14} />} danger label="Delete team (deletes its issues)"
            onClick={async () => {
              await api.deleteTeam(team.id);
              await useApp.getState().bootstrap();
              toast({ title: `${team.name} deleted` });
            }} />
        </Menu>
      )}

      <div className="card" style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Workflow states</span>
          <span style={{ flex: 1 }} />
          <button className="prop-chip" style={{ color: 'var(--text-dim)', height: 22, fontSize: 11.5 }} onClick={() => setAddingState(a => !a)}>＋ Add state</button>
        </div>
        {addingState && (
          <div style={{ display: 'flex', gap: 6, padding: '4px 0', alignItems: 'center' }}>
            <span className="label-dot" style={{ background: stColor }} />
            <input className="text-input" style={{ height: 26 }} autoFocus placeholder="State name" value={stName}
              onChange={e => setStName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addState(); if (e.key === 'Escape') setAddingState(false); }} />
            <select className="text-input" style={{ height: 26, width: 110 }} value={stType} onChange={e => setStType(e.target.value as WorkflowStateType)}>
              {STATE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 3 }}>
              {STATE_COLORS.map(c => (
                <button key={c} className={`label-dot ${stColor === c ? 'sel' : ''}`} style={{ background: c, width: 14, height: 14, cursor: 'pointer', outline: stColor === c ? '2px solid var(--brand)' : 'none' }} onClick={() => setStColor(c)} />
              ))}
            </div>
            <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={addState}>Add</button>
          </div>
        )}
        {states.map((s, i) => (
          <StateRow key={s.id} stateId={s.id} onMove={dir => moveState(s.id, dir)} canUp={i > 0} canDown={i < states.length - 1} />
        ))}
      </div>

      <div className="card" style={{ padding: '8px 10px', marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cycles</span>
          <span style={{ flex: 1 }} />
          <button className="prop-chip" style={{ color: 'var(--text-dim)', height: 22, fontSize: 11.5 }} onClick={() => setAddingCycle(a => !a)}>＋ Add cycle</button>
        </div>
        {addingCycle && (
          <div style={{ display: 'flex', gap: 6, padding: '4px 0', alignItems: 'center' }}>
            <input className="text-input" style={{ height: 26 }} autoFocus placeholder={`Cycle ${nextCycleNumber} name`} value={cyName} onChange={e => setCyName(e.target.value)} />
            <input type="date" className="text-input" style={{ height: 26, width: 130 }} value={cyStart} onChange={e => setCyStart(e.target.value)} />
            <input type="date" className="text-input" style={{ height: 26, width: 130 }} value={cyEnd} onChange={e => setCyEnd(e.target.value)} />
            <button className="btn primary" style={{ height: 26, fontSize: 12 }} onClick={createCycle}>Add</button>
          </div>
        )}
        {cycles.map(c => (
          <div key={c.id} className="prop-row group">
            <span style={{ color: 'var(--text-secondary)', fontSize: 12, width: 16 }}>#{c.number}</span>
            <span style={{ flex: 1 }}>{c.name}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{new Date(c.startsAt).toLocaleDateString()} → {new Date(c.endsAt).toLocaleDateString()}</span>
            <button className="icon-btn hover-only" title="Delete cycle" onClick={async () => { await api.deleteCycle(c.id); await useApp.getState().bootstrap(); }}>
              <IconTrash size={13} />
            </button>
          </div>
        ))}
        {cycles.length === 0 && !addingCycle && <div style={{ color: 'var(--text-dim)', padding: '4px 0', fontSize: 12 }}>No cycles yet.</div>}
      </div>
    </div>
  );
}

function StateRow(props: { stateId: string; onMove: (dir: -1 | 1) => void; canUp: boolean; canDown: boolean }) {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const menu = useMenu();
  const st = snap.states.find(s => s.id === props.stateId)!;
  const issueCount = snap.issues.filter(i => i.stateId === st.id).length;
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(st.name);

  const patch = async (p: Record<string, unknown>) => {
    await api.updateState(st.id, p);
    await useApp.getState().bootstrap();
  };

  return (
    <div className="prop-row group">
      <button title="Change color" onClick={menu.open}>
        <StateIcon type={st.type} color={st.color} size={14} />
      </button>
      {editing ? (
        <input className="text-input" style={{ height: 24, width: 140 }} autoFocus value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          onBlur={async () => { await patch({ name: nameDraft || st.name }); setEditing(false); }}
          onKeyDown={async e => { if (e.key === 'Enter') { await patch({ name: nameDraft || st.name }); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
      ) : (
        <span style={{ flex: 1, cursor: 'text' }} onClick={() => { setNameDraft(st.name); setEditing(true); }}>{st.name}</span>
      )}
      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{issueCount || ''}</span>
      <button className="prop-chip boxed" style={{ height: 20, fontSize: 10.5, textTransform: 'capitalize' }} onClick={menu.open}>{st.type}</button>
      <span style={{ display: 'flex' }} className="hover-only">
        <button className="icon-btn" style={{ width: 20, height: 20 }} disabled={!props.canUp} onClick={() => props.onMove(-1)} title="Move up">↑</button>
        <button className="icon-btn" style={{ width: 20, height: 20 }} disabled={!props.canDown} onClick={() => props.onMove(1)} title="Move down">↓</button>
      </span>
      <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Delete state"
        onClick={async () => {
          await api.deleteState(st.id);
          await useApp.getState().bootstrap();
          toast({ title: `State “${st.name}” deleted`, line: issueCount ? `Its ${issueCount} issues moved to Backlog.` : undefined });
        }}>
        <IconTrash size={13} />
      </button>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={210}>
          <div className="menu-header"><span>State type</span></div>
          {STATE_TYPES.map(([v, l]) => (
            <MenuItem key={v} icon={<StateIcon type={v} color={st.color} size={13} />} label={l} selected={st.type === v} onClick={() => { void patch({ type: v }); menu.close(); }} />
          ))}
          <MenuSep />
          <div className="menu-header"><span>Color</span></div>
          <div style={{ display: 'flex', gap: 5, padding: '2px 10px 10px', flexWrap: 'wrap' }}>
            {STATE_COLORS.map(c => (
              <button key={c} className={`label-dot ${st.color === c ? 'sel' : ''}`} style={{ background: c, width: 16, height: 16, outline: st.color === c ? '2px solid var(--brand)' : 'none' }}
                onClick={() => { void patch({ color: c }); menu.close(); }} />
            ))}
          </div>
        </Menu>
      )}
    </div>
  );
}

/* ---------------- members ---------------- */
function MembersSettings() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const [name, setName] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    await api.createUser({ name: name.trim() });
    setName('');
    await useApp.getState().bootstrap();
    toast({ title: 'Member added' });
  };
  return (
    <div className="settings-card">
      <h1>Members</h1>
      <div className="card" style={{ padding: '4px 10px', marginBottom: 14 }}>
        {snap.users.map(u => (
          <div key={u.id} className="prop-row">
            <Avatar user={u} size={22} />
            <span style={{ flex: 1 }}>{u.name}{u.id === snap.currentUser.id ? <span style={{ color: 'var(--text-dim)' }}> (you)</span> : null}</span>
            {u.admin && <span className="kbd">Admin</span>}
            {u.id !== snap.currentUser.id && (
              <button className="btn" style={{ height: 24, fontSize: 12 }} onClick={async () => {
                await api.updateWorkspace({ currentUserId: u.id });
                await useApp.getState().bootstrap();
                toast({ title: `Switched current user to ${u.name}` });
              }}>Set as me</button>
            )}
          </div>
        ))}
      </div>
      <div className="field-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div><div className="field-label">Add member</div><div className="field-help">Local members let you assign issues and simulate collaboration.</div></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="text-input" placeholder="Full name" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()} />
          <button className="btn primary" onClick={create}>Add</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- labels CRUD ---------------- */
function LabelsSettings() {
  const snap = useApp(s => s.snap)!;
  const toast = useApp(s => s.toast);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [teamId, setTeamId] = useState(snap.teams[0]?.id ?? '');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#8a8f98');
  const create = async () => {
    if (!name.trim() || !teamId) return;
    await api.createLabel({ teamId, name: name.trim(), color });
    setName('');
    await useApp.getState().bootstrap();
  };
  return (
    <div className="settings-card">
      <h1>Labels</h1>
      {snap.teams.map(t => (
        <div key={t.id} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{t.name}</div>
          <div className="card" style={{ padding: '6px 10px' }}>
            {snap.labels.filter(l => l.teamId === t.id).map(l => (
              <div key={l.id} className="prop-row group">
                {editing === l.id ? (
                  <>
                    <span className="label-dot" style={{ background: editColor }} />
                    <input className="text-input" style={{ height: 24, width: 140 }} autoFocus value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onBlur={async () => { await api.updateLabel(l.id, { name: editName || l.name, color: editColor }); await useApp.getState().bootstrap(); setEditing(null); }}
                      onKeyDown={async e => {
                        if (e.key === 'Enter') { await api.updateLabel(l.id, { name: editName || l.name, color: editColor }); await useApp.getState().bootstrap(); setEditing(null); }
                        if (e.key === 'Escape') setEditing(null);
                      }} />
                    <div style={{ display: 'flex', gap: 3 }}>
                      {LABEL_COLORS.map(c => (
                        <button key={c} className="label-dot" style={{ background: c, width: 14, height: 14, outline: editColor === c ? '2px solid var(--brand)' : 'none' }} onClick={() => setEditColor(c)} />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <button className="label-dot" style={{ background: l.color }} title="Click to edit" onClick={() => { setEditing(l.id); setEditName(l.name); setEditColor(l.color); }} />
                    <span style={{ flex: 1 }}>{l.name}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                      {snap.issues.filter(i => i.labelIds.includes(l.id)).length || ''}
                    </span>
                    <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Edit label" onClick={() => { setEditing(l.id); setEditName(l.name); setEditColor(l.color); }}>
                      <IconPlus size={0} /><span style={{ fontSize: 11 }}>✎</span>
                    </button>
                    <button className="icon-btn hover-only" style={{ width: 20, height: 20 }} title="Delete label"
                      onClick={async () => {
                        await api.deleteLabel(l.id);
                        await useApp.getState().bootstrap();
                        toast({ title: `Label “${l.name}” deleted` });
                      }}>
                      <IconTrash size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
            {snap.labels.filter(l => l.teamId === t.id).length === 0 && <div style={{ color: 'var(--text-dim)', padding: '4px 0' }}>No labels</div>}
          </div>
        </div>
      ))}
      <div className="field-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div><div className="field-label">Create label</div></div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select className="text-input" value={teamId} onChange={e => setTeamId(e.target.value)}>
            {snap.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 3 }}>
            {LABEL_COLORS.map(c => (
              <button key={c} className="label-dot" style={{ background: c, width: 14, height: 14, outline: color === c ? '2px solid var(--brand)' : 'none' }} onClick={() => setColor(c)} />
            ))}
          </div>
          <input className="text-input" placeholder="Label name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
          <button className="btn primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const theme = useApp(s => s.theme);
  const setTheme = useApp(s => s.setTheme);
  return (
    <div className="settings-card">
      <h1>Appearance</h1>
      <div className="field-row">
        <div><div className="field-label">Theme</div><div className="field-help">Dark is the default; light follows the reference look.</div></div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['dark', 'light'] as const).map(t => (
            <button key={t} className={`seg ${theme === t ? 'selected' : ''}`} style={{ textTransform: 'capitalize' }} onClick={() => setTheme(t)}>{t}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DataSettings() {
  const toast = useApp(s => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const importFile = async (file: File) => {
    const json = await file.text();
    try {
      await api.importWorkspace(json);
      await useApp.getState().bootstrap();
      toast({ title: 'Workspace imported' });
    } catch (err) {
      toast({ title: 'Import failed', line: String(err) });
    }
  };
  return (
    <div className="settings-card">
      <h1>Import & export</h1>
      <div className="field-row">
        <div><div className="field-label">Export workspace</div><div className="field-help">Download the full workspace as JSON.</div></div>
        <a className="btn" href="/api/export" download>Export JSON</a>
      </div>
      <div className="field-row">
        <div><div className="field-label">Import workspace</div><div className="field-help">Restore from an exported JSON file. Replaces all current data.</div></div>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Reset sample workspace</div><div className="field-help">Wipes everything and reseeds the demo data.</div></div>
        <button className="btn" onClick={async () => { await api.reseed(); await useApp.getState().bootstrap(); toast({ title: 'Workspace reset' }); }}>Reset</button>
      </div>
    </div>
  );
}

function ShortcutSettings() {
  return (
    <div className="settings-card">
      <h1>Keyboard shortcuts</h1>
      <div style={{ color: 'var(--text-secondary)' }}>Press <span className="kbd">?</span> anywhere in the app to see the overlay.</div>
    </div>
  );
}

/* keep imports referenced */
export { Menu, MenuItem, useMenu, PriorityIcon, IconPlus, IconBack, IconClose };
export type { WorkflowStateType, Priority };
