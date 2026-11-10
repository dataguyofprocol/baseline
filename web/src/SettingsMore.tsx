import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { IconPlus, IconTrash } from './icons.js';
import { UPDATE_CADENCE_LABELS, type UpdateCadence, type WorkspaceFeatures } from '../../src/core/types.js';
import { ConfirmIconButton } from './ui.js';
import { LABEL_COLORS } from './labelColors.js';

/* Settings pages Linear keeps under Projects (Labels, Statuses, Updates) and Features
   (Initiatives). */

const COLORS = LABEL_COLORS;
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
      <div className="set-head"><h1>Initiatives</h1><span style={{ flex: 1 }} />{f.initiativesEnabled && <Link className="btn secondary" to="/initiatives">Open initiatives</Link>}</div>
      <div className="field-row">
        <div><div className="field-label">Enable initiatives</div><div className="field-help">Initiatives are larger, strategic efforts made of projects. They get their own status, owner, priority, labels, target date, health and updates, and can nest as sub-initiatives.</div></div>
        <Switch on={f.initiativesEnabled} label="Enable initiatives" onChange={v => void setFeatures({ initiativesEnabled: v })} />
      </div>
      {f.initiativesEnabled && <>
        <div className="settings-h2">Update schedule</div>
        <div className="field-help" style={{ marginBottom: 8 }}>How often initiative owners are expected to post an update. Owners get an inbox reminder when one is due.</div>
        <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>Default schedule</span>
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
              <ConfirmIconButton className="icon-btn hover-only" title="Delete label" onConfirm={async () => { await api.deleteInitiativeLabel(l.id); await refresh(); }}><IconTrash size={13} /></ConfirmIconButton>
            </div>
          ))}
          {!snap.initiativeLabels.length && !adding && <div className="set-empty">No initiative labels yet</div>}
        </div>
      </>}
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
        <span style={{ flex: 1 }}>Default schedule</span>
        <select className="text-input" aria-label="Update schedule" value={f.updateCadence} onChange={e => void setFeatures({ updateCadence: e.target.value as UpdateCadence })}>
          {(Object.keys(UPDATE_CADENCE_LABELS) as UpdateCadence[]).map(c => <option key={c} value={c}>{UPDATE_CADENCE_LABELS[c]}</option>)}
        </select>
      </div>
      {overrides > 0 && <div className="field-help" style={{ marginTop: 8 }}>{overrides} project{overrides === 1 ? ' has its' : 's have their'} own schedule (the bell on the project page).</div>}
    </div>
  );
}
