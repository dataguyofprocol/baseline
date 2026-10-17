import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from './store.js';
import { api } from './api.js';
import { ConfirmButton } from './ui.js';
import { IconPlus, IconTrash, IconSearch } from './icons.js';
import { ProjectStatusIcon, PROJECT_STATUS } from './Projects.js';
import { UPDATE_CADENCE_LABELS, type UpdateCadence, type WorkspaceFeatures } from '../../src/core/types.js';

/* Settings pages Linear keeps under Projects (Labels, Statuses, Updates) and Features
   (Documents, Customer requests, Pulse, Emojis). */

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

/* ---------------- documents (templates) ---------------- */
export function DocumentsSettings() {
  const snap = useApp(s => s.snap)!;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', title: '', content: '' });
  const startNew = async () => {
    const { template } = await api.createDocTemplate({ name: 'New template' });
    await refresh();
    setEditing(template.id); setDraft({ name: 'New template', title: '', content: '' });
  };
  return (
    <div className="settings-card">
      <div className="set-head"><h1>Documents</h1></div>
      <div className="settings-h2" style={{ marginTop: 0 }}>Templates</div>
      <div className="field-help" style={{ marginBottom: 8 }}>Offered when you create a document from a project's or team's resources.</div>
      <div className="card set-list">
        {snap.docTemplates.map(t => editing === t.id ? (
          <div key={t.id} className="ptpl-edit">
            <input className="text-input" placeholder="Template name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            <input className="text-input" placeholder="Document title (optional)" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
            <textarea className="text-input" style={{ minHeight: 120 }} placeholder="Content (Markdown)" value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn primary sm" onClick={async () => { await api.updateDocTemplate(t.id, draft); setEditing(null); await refresh(); }}>Save</button>
              <button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={t.id} className="set-row group">
            <span style={{ flex: 1 }}>{t.name}{t.content && <span className="set-meta"> — {t.content.replace(/\s+/g, ' ').slice(0, 60)}</span>}</span>
            <button className="icon-btn hover-only" title="Edit template" onClick={() => { setEditing(t.id); setDraft({ name: t.name, title: t.title, content: t.content }); }}><span style={{ fontSize: 11 }}>✎</span></button>
            <button className="icon-btn hover-only" title="Delete template" onClick={async () => { await api.deleteDocTemplate(t.id); await refresh(); }}><IconTrash size={13} /></button>
          </div>
        ))}
        {!snap.docTemplates.length && <div className="set-empty">No document templates</div>}
        <div className="set-row"><button className="btn secondary sm" onClick={startNew}><IconPlus size={12} /> New template</button></div>
      </div>
    </div>
  );
}

/* ---------------- customer requests ---------------- */
export function CustomerRequestsSettings() {
  const snap = useApp(s => s.snap)!;
  const f = snap.workspace.features;
  return (
    <div className="settings-card">
      <h1>Customer requests</h1>
      <div className="field-help" style={{ marginBottom: 16 }}>Associate customers with projects and issues to align work with real user needs, and track what each customer asked for.</div>
      <div className="field-row">
        <div><div className="field-label">Enable Customer requests</div><div className="field-help">Adds Customers to the sidebar, and customer requests to issues and projects.</div></div>
        <Switch on={f.customerRequestsEnabled} label="Enable customer requests" onChange={v => void setFeatures({ customerRequestsEnabled: v })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Manage customers</div><div className="field-help">{snap.customers.length ? `${snap.customers.length} customer${snap.customers.length === 1 ? '' : 's'}` : 'No customers'}</div></div>
        <Link className="btn secondary sm" to="/customers">Open customers</Link>
      </div>
      <div className="field-row">
        <div><div className="field-label">Default team for customer requests</div><div className="field-help">New issues created from a customer page go to this team's triage (or backlog).</div></div>
        <select className="text-input" value={f.customerDefaultTeamId ?? ''} onChange={e => void setFeatures({ customerDefaultTeamId: e.target.value || null })}>
          <option value="">No default team</option>
          {snap.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <AttrList kind="status" title="Customer statuses" help="Statuses for segmenting customers" items={snap.customerStatuses} />
      <AttrList kind="tier" title="Customer tiers" help="Tiers for segmenting customers" items={snap.customerTiers} />
    </div>
  );
}

function AttrList(props: { kind: 'status' | 'tier'; title: string; help: string; items: Array<{ id: string; name: string; color: string }> }) {
  const [name, setName] = useState('');
  const add = async () => { if (!name.trim()) return; await api.createCustomerAttr(props.kind, { name: name.trim(), color: COLORS[props.items.length % COLORS.length] }); setName(''); await refresh(); };
  return (
    <>
      <div className="settings-h2">{props.title}</div>
      <div className="field-help" style={{ marginBottom: 8 }}>{props.help} — {props.items.length ? `${props.items.length} ${props.kind === 'status' ? 'customer statuses' : 'customer tiers'}` : `no ${props.kind === 'status' ? 'customer statuses' : 'customer tiers'}`}</div>
      <div className="card set-list">
        {props.items.map(x => (
          <div key={x.id} className="set-row group">
            <button className="label-dot" style={{ background: x.color, width: 12, height: 12 }} title="Change colour" onClick={async () => { await api.updateCustomerAttr(props.kind, x.id, { color: nextColor(x.color) }); await refresh(); }} />
            <EditableName value={x.name} onSave={async v => { await api.updateCustomerAttr(props.kind, x.id, { name: v }); await refresh(); }} />
            <span style={{ flex: 1 }} />
            <button className="icon-btn hover-only" title="Delete" onClick={async () => { await api.deleteCustomerAttr(props.kind, x.id); await refresh(); }}><IconTrash size={13} /></button>
          </div>
        ))}
        <div className="set-row">
          <input className="text-input" placeholder={props.kind === 'status' ? 'New status…' : 'New tier…'} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(); }} />
          <button className="btn secondary sm" disabled={!name.trim()} onClick={add}>Add</button>
        </div>
      </div>
    </>
  );
}

/* ---------------- pulse ---------------- */
export function PulseSettings() {
  const snap = useApp(s => s.snap)!;
  const f = snap.workspace.features;
  return (
    <div className="settings-card">
      <h1>Pulse</h1>
      <div className="field-help" style={{ marginBottom: 16 }}>Pulse puts every project update into one feed. You can also get a summary in your inbox each morning or week.</div>
      <div className="field-row">
        <div><div className="field-label">Enable Pulse</div><div className="field-help">Workspace-wide feed of updates, in the sidebar under Workspace.</div></div>
        <Switch on={f.pulseEnabled} label="Enable Pulse" onChange={v => void setFeatures({ pulseEnabled: v })} />
      </div>
      <div className="field-row">
        <div><div className="field-label">Summary notifications</div><div className="field-help">A summary of new updates lands in your inbox on this schedule.</div></div>
        <select className="text-input" aria-label="Pulse summary schedule" disabled={!f.pulseEnabled} value={f.pulseSchedule} onChange={e => void setFeatures({ pulseSchedule: e.target.value as WorkspaceFeatures['pulseSchedule'] })}>
          <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="never">Never</option>
        </select>
      </div>
    </div>
  );
}

/* ---------------- emojis ---------------- */
export function EmojisSettings() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const upload = async () => {
    if (!file || !name.trim()) return;
    try { await api.uploadEmoji(name.trim(), file); setName(''); setFile(null); setErr(''); await refresh(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="settings-card">
      <h1>Emojis</h1>
      <div className="field-help" style={{ marginBottom: 14 }}>Custom emojis work in reactions and as <code>:name:</code> in descriptions and comments.</div>
      <div className="card set-list">
        <div className="set-row">
          <button className="btn secondary sm" onClick={() => input.current?.click()}>{file ? file.name : 'Choose image…'}</button>
          <input ref={input} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '')); } e.target.value = ''; }} />
          <input className="text-input" placeholder="name" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') void upload(); }} />
          <button className="btn primary sm" disabled={!file || !name.trim()} onClick={upload}>Upload</button>
        </div>
        {err && <div className="set-empty" style={{ color: 'var(--danger, #e5484d)' }}>{err}</div>}
        {snap.emojis.map(e => (
          <div key={e.id} className="set-row group">
            <img src={e.url} alt={e.name} width={20} height={20} style={{ objectFit: 'contain' }} />
            <code style={{ flex: 1 }}>:{e.name}:</code>
            <ConfirmButton className="btn ghost sm" label="Delete" confirmLabel="Delete?" onConfirm={async () => { await api.deleteEmoji(e.id); await refresh(); }} />
          </div>
        ))}
        {!snap.emojis.length && <div className="set-empty">No emojis</div>}
      </div>
    </div>
  );
}
