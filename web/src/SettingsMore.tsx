import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { IconPlus, IconTrash, IconSearch } from './icons.js';
import { ProjectStatusIcon, PROJECT_STATUS } from './Projects.js';
import { UPDATE_CADENCE_LABELS, type UpdateCadence, type WorkspaceFeatures } from '../../src/core/types.js';

/* Settings pages Linear keeps under Projects (Labels, Statuses, Updates) and Features
   (Initiatives). */

const COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#3b82f6', '#5e6ad2', '#a78bfa', '#c770f4', '#8a8f98'];
const nextColor = (c: string) => COLORS[(COLORS.indexOf(c) + 1) % COLORS.length];
const refresh = () => useApp.getState().bootstrap();

function Switch(props: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button className={`switch${props.on ? ' on' : ''}`} role="switch" aria-checked={props.on} aria-label={props.label} onClick={() => props.onChange(!props.on)}><span /></button>;
}

async function setFeatures(patch: Partial<WorkspaceFeatures>) { await api.setFeatures(patch); await refresh(); }

/** an inline-renamable name: click to edit, Enter or blur saves */
function EditableName(props: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(props.value);
  if (!editing) return <button className={`set-name ${props.className ?? ''}`} title="Rename" onClick={() => { setV(props.value); setEditing(true); }}>{props.value}</button>;
  const save = () => { setEditing(false); if (v.trim() && v.trim() !== props.value) props.onSave(v.trim()); };
  return <input className="text-input set-name-input" autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />;
}

/* ---------------- project labels ---------------- */
export function ProjectLabelsSettings() {
  const snap = useApp(s => s.snap)!;
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<null | { group: boolean; parentId: string | null }>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[5]);
  const create = async () => {
    if (!name.trim() || !adding) return;
    await api.createProjectLabel({ name: name.trim(), color, isGroup: adding.group, parentId: adding.parentId });
    setName(''); setAdding(null);
    await refresh();
  };
  const count = (id: string) => snap.projects.filter(p => p.labelIds.includes(id)).length;
  const match = (n: string) => n.toLowerCase().includes(q.trim().toLowerCase());
  const loose = snap.projectLabels.filter(l => !l.isGroup && !l.parentId && match(l.name));
  const groups = snap.projectLabels.filter(l => l.isGroup);
  const addRow = (parentId: string | null, group: boolean) => adding && adding.parentId === parentId && adding.group === group && (
    <div className="set-row">
      <button className="label-dot" style={{ background: color, width: 12, height: 12 }} title="Change colour" onClick={() => setColor(nextColor(color))} />
      <input className="text-input" autoFocus placeholder={group ? 'Group name' : 'Label name'} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setAdding(null); }} />
      <button className="btn primary sm" disabled={!name.trim()} onClick={create}>Create</button>
      <button className="btn ghost sm" onClick={() => setAdding(null)}>Cancel</button>
    </div>
  );
  const labelRow = (l: (typeof snap.projectLabels)[number], indent = false) => (
    <div key={l.id} className={`set-row group${indent ? ' indent' : ''}`}>
      <button className="label-dot" style={{ background: l.color, width: 12, height: 12 }} title="Change colour" onClick={async () => { await api.updateProjectLabel(l.id, { color: nextColor(l.color) }); await refresh(); }} />
      <EditableName value={l.name} onSave={async v => { await api.updateProjectLabel(l.id, { name: v }); await refresh(); }} />
      <span className="set-meta">{count(l.id) ? `${count(l.id)} project${count(l.id) === 1 ? '' : 's'}` : ''}</span>
      <button className="icon-btn hover-only" title="Delete label" onClick={async () => { await api.deleteProjectLabel(l.id); await refresh(); }}><IconTrash size={13} /></button>
    </div>
  );
  return (
    <div className="settings-card wide">
      <div className="set-head">
        <h1>Project labels</h1>
        <span style={{ flex: 1 }} />
        <button className="btn secondary" onClick={() => { setAdding({ group: true, parentId: null }); setName(''); }}>New group</button>
        <button className="btn primary" onClick={() => { setAdding({ group: false, parentId: null }); setName(''); }}>New label</button>
      </div>
      <div className="set-filter"><IconSearch size={13} /><input placeholder="Filter by name…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="card set-list">
        {addRow(null, true)}
        {addRow(null, false)}
        {loose.map(l => labelRow(l))}
        {groups.map(g => {
          const kids = snap.projectLabels.filter(l => l.parentId === g.id && (match(l.name) || match(g.name)));
          if (!kids.length && !match(g.name)) return null;
          return (
            <div key={g.id}>
              <div className="set-row group set-group">
                <span className="label-dot" style={{ background: g.color, width: 12, height: 12 }} />
                <EditableName value={g.name} className="strong" onSave={async v => { await api.updateProjectLabel(g.id, { name: v }); await refresh(); }} />
                <span className="set-meta">{kids.length} label{kids.length === 1 ? '' : 's'} · one per project</span>
                <button className="icon-btn hover-only" title="Add label to group" onClick={() => { setAdding({ group: false, parentId: g.id }); setName(''); }}><IconPlus size={13} /></button>
                <button className="icon-btn hover-only" title="Delete group and its labels" onClick={async () => { await api.deleteProjectLabel(g.id); await refresh(); }}><IconTrash size={13} /></button>
              </div>
              {kids.map(l => labelRow(l, true))}
              {addRow(g.id, false)}
            </div>
          );
        })}
        {!snap.projectLabels.length && !adding && <div className="set-empty">No labels found</div>}
      </div>
    </div>
  );
}

/* ---------------- initiatives: the switch, the update schedule and initiative labels ---------------- */
export function InitiativesSettings() {
  const snap = useApp(s => s.snap)!;
  const f = snap.workspace.features;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[5]);
  const create = async () => { if (!name.trim()) return; await api.createInitiativeLabel({ name: name.trim(), color }); setName(''); setAdding(false); await refresh(); };
  const count = (id: string) => snap.initiatives.filter(i => i.labelIds.includes(id)).length;
  const overrides = snap.initiatives.filter(i => i.updateCadence).length;
  return (
    <div className="settings-card">
      <h1>Initiatives</h1>
      <div className="field-row">
        <div><div className="field-label">Enable initiatives</div><div className="field-help">Initiatives are larger, strategic efforts made of projects. They get their own status, owner, priority, labels, target date, health and updates, and can nest as sub-initiatives.</div></div>
        <Switch on={f.initiativesEnabled} label="Enable initiatives" onChange={v => void setFeatures({ initiativesEnabled: v })} />
      </div>
      {f.initiativesEnabled && <>
        <Link className="btn secondary sm" to="/initiatives">Open initiatives</Link>
        <div className="settings-h2">Update schedule</div>
        <div className="field-help" style={{ marginBottom: 8 }}>How often initiative owners are expected to post an update. Owners get an inbox reminder when one is due.</div>
        <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{UPDATE_CADENCE_LABELS[f.initiativeUpdateCadence]}</span>
          <select className="text-input" aria-label="Initiative update schedule" value={f.initiativeUpdateCadence} onChange={e => void setFeatures({ initiativeUpdateCadence: e.target.value as UpdateCadence })}>
            {(Object.keys(UPDATE_CADENCE_LABELS) as UpdateCadence[]).map(c => <option key={c} value={c}>{UPDATE_CADENCE_LABELS[c]}</option>)}
          </select>
        </div>
        {overrides > 0 && <div className="field-help" style={{ marginTop: 8 }}>{overrides} initiative{overrides === 1 ? ' has its' : 's have their'} own schedule (the … menu on the initiative page).</div>}
        <div className="settings-h2" style={{ display: 'flex', alignItems: 'center' }}>Labels<span style={{ flex: 1 }} /><button className="btn secondary sm" onClick={() => { setAdding(true); setName(''); }}><IconPlus size={12} /> New label</button></div>
        <div className="field-help" style={{ marginBottom: 8 }}>Labels group initiatives across the list, its filters and the initiative page.</div>
        <div className="card set-list">
          {adding && (
            <div className="set-row">
              <button className="label-dot" style={{ background: color, width: 12, height: 12 }} title="Change colour" onClick={() => setColor(nextColor(color))} />
              <input className="text-input" autoFocus placeholder="Label name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setAdding(false); }} />
              <button className="btn primary sm" disabled={!name.trim()} onClick={create}>Create</button>
              <button className="btn ghost sm" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          )}
          {snap.initiativeLabels.map(l => (
            <div key={l.id} className="set-row group">
              <button className="label-dot" style={{ background: l.color, width: 12, height: 12 }} title="Change colour" onClick={async () => { await api.updateInitiativeLabel(l.id, { color: nextColor(l.color) }); await refresh(); }} />
              <EditableName value={l.name} onSave={async v => { await api.updateInitiativeLabel(l.id, { name: v }); await refresh(); }} />
              <span className="set-meta">{count(l.id) ? `${count(l.id)} initiative${count(l.id) === 1 ? '' : 's'}` : ''}</span>
              <button className="icon-btn hover-only" title="Delete label" onClick={async () => { await api.deleteInitiativeLabel(l.id); await refresh(); }}><IconTrash size={13} /></button>
            </div>
          ))}
          {!snap.initiativeLabels.length && !adding && <div className="set-empty">No initiative labels yet</div>}
        </div>
      </>}
    </div>
  );
}

/* ---------------- project statuses ---------------- */
export function ProjectStatusesSettings() {
  const snap = useApp(s => s.snap)!;
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const toast = useApp(s => s.toast);
  return (
    <div className="settings-card">
      <h1>Project statuses</h1>
      <div className="field-help" style={{ marginBottom: 14 }}>Project statuses define the workflow that projects go through from start to completion.</div>
      <div className="card set-list">
        {PROJECT_STATUS.map(([type, label]) => {
          const list = snap.projectStatuses.filter(st => st.type === type).sort((a, b) => a.position - b.position);
          return (
            <div key={type}>
              <div className="set-cat"><span>{label}</span><button className="icon-btn" title={`Add a ${label.toLowerCase()} status`} onClick={() => { setAdding(type); setName(''); }}><IconPlus size={13} /></button></div>
              {list.map(st => {
                const n = snap.projects.filter(p => p.statusId === st.id).length;
                return (
                  <div key={st.id} className="set-row group">
                    <button className="set-icon" title="Change colour" onClick={async () => { await api.updateProjectStatus(st.id, { color: nextColor(st.color) }); await refresh(); }}><ProjectStatusIcon status={type} color={st.color} /></button>
                    <EditableName value={st.name} onSave={async v => { await api.updateProjectStatus(st.id, { name: v }); await refresh(); }} />
                    <span className="set-meta">{n ? `${n} project${n === 1 ? '' : 's'}` : ''}</span>
                    <button className="icon-btn hover-only" title={list.length > 1 ? 'Delete status' : 'Each category keeps one status'} disabled={list.length < 2}
                      onClick={async () => { try { await api.deleteProjectStatus(st.id); await refresh(); toast({ title: `Status “${st.name}” deleted`, line: n ? `${n} project${n === 1 ? '' : 's'} moved to ${list.find(x => x.id !== st.id)?.name}` : undefined }); } catch (e) { toast({ title: 'Can’t delete', line: String((e as Error).message) }); } }}>
                      <IconTrash size={13} />
                    </button>
                  </div>
                );
              })}
              {adding === type && (
                <div className="set-row">
                  <ProjectStatusIcon status={type} />
                  <input className="text-input" autoFocus placeholder="Status name" value={name} onChange={e => setName(e.target.value)}
                    onKeyDown={async e => { if (e.key === 'Enter' && name.trim()) { await api.createProjectStatus({ type, name: name.trim(), color: PROJECT_STATUS.find(x => x[0] === type)?.[2] }); setAdding(null); await refresh(); } if (e.key === 'Escape') setAdding(null); }} />
                  <button className="btn ghost sm" onClick={() => setAdding(null)}>Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- project updates ---------------- */
export function ProjectUpdatesSettings() {
  const snap = useApp(s => s.snap)!;
  const f = snap.workspace.features;
  const overrides = snap.projects.filter(p => p.updateCadence).length;
  return (
    <div className="settings-card">
      <h1>Project updates</h1>
      <div className="field-help" style={{ marginBottom: 18 }}>Short status reports about the progress and health of your projects. Project members post updates, and subscribers receive them in their inbox.</div>
      <div className="settings-h2" style={{ marginTop: 0 }}>Update schedule</div>
      <div className="field-help" style={{ marginBottom: 8 }}>How often updates are expected on projects. Project leads get an inbox reminder when one is due.</div>
      <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1 }}>{UPDATE_CADENCE_LABELS[f.updateCadence]}</span>
        <select className="text-input" aria-label="Update schedule" value={f.updateCadence} onChange={e => void setFeatures({ updateCadence: e.target.value as UpdateCadence })}>
          {(Object.keys(UPDATE_CADENCE_LABELS) as UpdateCadence[]).map(c => <option key={c} value={c}>{UPDATE_CADENCE_LABELS[c]}</option>)}
        </select>
      </div>
      {overrides > 0 && <div className="field-help" style={{ marginTop: 8 }}>{overrides} project{overrides === 1 ? ' has its' : 's have their'} own schedule (the bell on the project page).</div>}
    </div>
  );
}
