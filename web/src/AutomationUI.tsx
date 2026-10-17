import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, relTime } from './store.js';
import { api } from './api.js';
import { TopBar } from './AppShell.js';
import { PriorityIcon } from './pickers.js';
import { IconPlus, IconTrash, IconSla, IconAsk, IconLoop, IconClose } from './icons.js';
import type { AskField, Issue, Loop, LoopAction, LoopTrigger, Priority, WorkflowStateType } from '../../src/core/types.js';
import { Illustration } from './illustrations.js';

const refresh = () => useApp.getState().bootstrap();
const PRIORITIES: Array<[Priority, string]> = [[1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low'], [0, 'No priority']];
const fmtHours = (h: number) => h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`;

/* ================= SLA badge (rows, cards, issue rail) ================= */
export function slaState(i: Pick<Issue, 'slaBreachesAt'>): 'breached' | 'risk' | 'ok' | null {
  if (!i.slaBreachesAt) return null;
  const left = new Date(i.slaBreachesAt).getTime() - Date.now();
  return left <= 0 ? 'breached' : left < 24 * 3600_000 ? 'risk' : 'ok';
}
export function SlaBadge({ issue, long = false }: { issue: Pick<Issue, 'slaBreachesAt'>; long?: boolean }) {
  const st = slaState(issue);
  if (!st) return null;
  const left = new Date(issue.slaBreachesAt!).getTime() - Date.now();
  const abs = Math.abs(left); const h = Math.round(abs / 3600_000); const txt = h >= 48 ? `${Math.round(h / 24)}d` : `${h}h`;
  const label = st === 'breached' ? `SLA breached ${txt} ago` : `SLA ${txt} left`;
  return <span className={`sla-badge ${st}`} title={`${label} · due ${new Date(issue.slaBreachesAt!).toLocaleString()}`}><IconSla size={12} />{long ? label : st === 'breached' ? 'Breached' : txt}</span>;
}

/* ================= Settings › Issues › SLAs ================= */
export function SlaSettings() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState('');
  const [hours, setHours] = useState('24');
  const [prio, setPrio] = useState<Priority[]>([1]);
  const [teamId, setTeamId] = useState('');
  const create = async () => {
    if (!name.trim() || !(Number(hours) > 0)) return;
    await api.createSlaRule({ name: name.trim(), hours: Number(hours), priorities: prio, teamId: teamId || null });
    setName(''); await refresh();
  };
  const count = (ruleId: string) => snap.issues.filter(i => i.slaRuleId === ruleId).length;
  const breached = snap.issues.filter(i => slaState(i) === 'breached').length;
  return (
    <div className="settings-card">
      <h1>SLAs</h1>
      <div className="field-help" style={{ marginBottom: 14 }}>Service-level agreements give matching issues a deadline. The clock starts when an issue first matches a rule, and closing the issue stops it. {breached ? `${breached} issue${breached === 1 ? ' is' : 's are'} breached right now.` : ''}</div>
      <div className="settings-h2" style={{ marginTop: 0 }}>Automation rules</div>
      <div className="card set-list">
        {snap.slaRules.map(r => (
          <div key={r.id} className="set-row group">
            <IconSla size={14} />
            <span style={{ flex: 1 }}><b>{r.name}</b><span className="set-meta" style={{ marginLeft: 8 }}>{r.priorities.length ? r.priorities.map(p => PRIORITIES.find(x => x[0] === p)?.[1]).join(', ') : 'Any priority'}{r.labelIds.length ? ` · ${r.labelIds.map(l => snap.labels.find(x => x.id === l)?.name).join(', ')}` : ''} · {r.teamId ? snap.teams.find(t => t.id === r.teamId)?.name : 'All teams'} · within {fmtHours(r.hours)}</span></span>
            <span className="set-meta">{count(r.id)} active</span>
            <button className={`switch${r.enabled ? ' on' : ''}`} role="switch" aria-checked={r.enabled} aria-label={`Enable ${r.name}`} onClick={async () => { await api.updateSlaRule(r.id, { enabled: !r.enabled }); await refresh(); }}><span /></button>
            <button className="icon-btn hover-only" title="Delete rule" onClick={async () => { await api.deleteSlaRule(r.id); await refresh(); }}><IconTrash size={13} /></button>
          </div>
        ))}
        {!snap.slaRules.length && <div className="set-empty">No SLA rules yet</div>}
        <div className="sla-form">
          <input className="text-input" placeholder="Rule name, e.g. Urgent bugs" value={name} onChange={e => setName(e.target.value)} />
          <div className="sla-prios">{PRIORITIES.map(([p, l]) => <button key={p} className={`prop-chip${prio.includes(p) ? ' set' : ''}`} onClick={() => setPrio(cur => cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p])}><PriorityIcon priority={p} size={12} />{l}</button>)}</div>
          <select className="text-input" aria-label="SLA team" value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">All teams</option>{snap.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <label className="sla-hours">Within <input className="text-input" aria-label="SLA hours" type="number" min={1} value={hours} onChange={e => setHours(e.target.value)} /> hours</label>
          <button className="btn primary sm" disabled={!name.trim()} onClick={create}><IconPlus size={12} /> Add rule</button>
        </div>
      </div>
    </div>
  );
}

/* ================= Asks ================= */
export function AsksSettings() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const create = async () => { if (!name.trim()) return; const { form } = await api.createAskForm({ name: name.trim(), teamId: snap.teams[0].id }); setName(''); await refresh(); setEditing(form.id); };
  return (
    <div className="settings-card wide">
      <h1>Asks</h1>
      <div className="field-help" style={{ marginBottom: 14 }}>Let anyone file bug reports, feature requests and more through structured forms. Each submission lands in the team's triage.</div>
      <div className="card set-list">
        {snap.askForms.map(f => editing === f.id ? <AskEditor key={f.id} formId={f.id} onDone={() => setEditing(null)} /> : (
          <div key={f.id} className="set-row group">
            <IconAsk size={14} />
            <span style={{ flex: 1 }}><b>{f.name}</b><span className="set-meta" style={{ marginLeft: 8 }}>{snap.teams.find(t => t.id === f.teamId)?.name} · {f.fields.length} fields · {snap.issues.filter(i => i.askFormId === f.id).length} submissions</span></span>
            <button className="btn ghost sm" onClick={() => navigate(`/asks/${f.id}`)}>Open form</button>
            <button className="icon-btn hover-only" title="Edit form" onClick={() => setEditing(f.id)}><span style={{ fontSize: 11 }}>✎</span></button>
            <button className="icon-btn hover-only" title="Delete form" onClick={async () => { await api.deleteAskForm(f.id); await refresh(); }}><IconTrash size={13} /></button>
          </div>
        ))}
        {!snap.askForms.length && <div className="set-empty">No Ask forms yet</div>}
        <div className="set-row"><input className="text-input" placeholder="New form, e.g. Bug report" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create(); }} /><button className="btn primary sm" disabled={!name.trim()} onClick={create}>Create</button></div>
      </div>
    </div>
  );
}

function AskEditor({ formId, onDone }: { formId: string; onDone: () => void }) {
  const snap = useApp(s => s.snap)!;
  const f = snap.askForms.find(x => x.id === formId)!;
  const [d, setD] = useState({ name: f.name, description: f.description, teamId: f.teamId, priority: f.priority, fields: f.fields });
  const setField = (i: number, p: Partial<AskField>) => setD(cur => ({ ...cur, fields: cur.fields.map((x, n) => n === i ? { ...x, ...p } : x) }));
  return (
    <div className="ptpl-edit">
      <input className="text-input" placeholder="Form name" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} />
      <input className="text-input" placeholder="Description shown on the form" value={d.description} onChange={e => setD({ ...d, description: e.target.value })} />
      <div style={{ display: 'flex', gap: 6 }}>
        <select className="text-input" aria-label="Ask team" value={d.teamId} onChange={e => setD({ ...d, teamId: e.target.value })}>{snap.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select className="text-input" aria-label="Ask priority" value={d.priority} onChange={e => setD({ ...d, priority: Number(e.target.value) as Priority })}>{PRIORITIES.map(([p, l]) => <option key={p} value={p}>{l}</option>)}</select>
      </div>
      <div className="set-meta" style={{ margin: '4px 0 0' }}>Fields</div>
      {d.fields.map((x, i) => (
        <div key={x.id} className="ask-field-row">
          <input className="text-input" value={x.label} onChange={e => setField(i, { label: e.target.value })} />
          <select className="text-input" value={x.type} onChange={e => setField(i, { type: e.target.value as AskField['type'] })}><option value="text">Short text</option><option value="textarea">Long text</option><option value="select">Choice</option></select>
          {x.type === 'select' && <input className="text-input" placeholder="Options, comma separated" value={x.options.join(', ')} onChange={e => setField(i, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })} />}
          <label className="ask-req"><input type="checkbox" checked={x.required} onChange={e => setField(i, { required: e.target.checked })} /> Required</label>
          <button className="icon-btn" title="Remove field" onClick={() => setD(cur => ({ ...cur, fields: cur.fields.filter((_, n) => n !== i) }))}><IconClose size={12} /></button>
        </div>
      ))}
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setD(cur => ({ ...cur, fields: [...cur.fields, { id: `f_${Date.now().toString(36)}`, label: 'New field', type: 'text', options: [], required: false }] }))}><IconPlus size={12} /> Add field</button>
      <div style={{ display: 'flex', gap: 6 }}><button className="btn primary sm" onClick={async () => { await api.updateAskForm(formId, d); await refresh(); onDone(); }}>Save</button><button className="btn ghost sm" onClick={onDone}>Cancel</button></div>
    </div>
  );
}

/** the Asks page: every form, and what's been filed through them */
export function AsksPage() {
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const filed = snap.issues.filter(i => i.askFormId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const key = (i: Issue) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Asks', icon: <IconAsk size={14} /> }]} right={<button className="btn secondary" onClick={() => navigate('/settings/asks')}>Manage forms</button>} />
      <div className="content">
        {!snap.askForms.length ? (
          <div className="empty-state"><Illustration name="asks" /><div className="empty-title">Asks</div><div className="empty-desc">Create intake forms in Settings › Asks; submissions land in the team's triage.</div><div className="empty-actions"><button className="btn primary" onClick={() => navigate('/settings/asks')}>Create a form</button></div></div>
        ) : (
          <div className="asks-page">
            <div className="ask-cards">{snap.askForms.filter(f => f.enabled).map(f => (
              <button key={f.id} className="ask-card" onClick={() => navigate(`/asks/${f.id}`)}><IconAsk size={16} /><b>{f.name}</b><span className="dim">{f.description || `Files into ${snap.teams.find(t => t.id === f.teamId)?.name}`}</span></button>
            ))}</div>
            <div className="proj-section-label">Recent submissions <span className="dim">{filed.length}</span></div>
            {filed.slice(0, 50).map(i => (
              <div key={i.id} className="issue-row static-row" onClick={() => navigate(`/issue/${key(i)}`)}>
                <span className="mono dim">{key(i)}</span><span className="row-title-wrap"><span className="row-title">{i.title}</span><span className="row-parent">{snap.askForms.find(f => f.id === i.askFormId)?.name}</span></span>
                <span className="row-meta"><span className="row-date">{relTime(i.createdAt)}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AskFormPage() {
  const { formId = '' } = useParams();
  const snap = useApp(s => s.snap)!;
  const navigate = useNavigate();
  const f = snap.askForms.find(x => x.id === formId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState<Issue | null>(null);
  if (!f) return <div className="empty-state"><div className="empty-title">Form not found</div></div>;
  const submit = async () => {
    try { const { issue } = await api.submitAsk(f.id, values); setDone(issue); setValues({}); setError(''); await refresh(); }
    catch (e) { setError((e as Error).message); }
  };
  const key = (i: Issue) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar crumbs={[{ label: 'Asks', to: '/asks', muted: true }, { label: f.name }]} />
      <div className="content">
        <form className="ask-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <h1>{f.name}</h1>
          {f.description && <p className="field-help">{f.description}</p>}
          {f.fields.map(x => (
            <label key={x.id} className="ask-q">
              <span>{x.label}{x.required && <span className="ask-star"> *</span>}</span>
              {x.type === 'textarea' ? <textarea className="text-input" value={values[x.id] ?? ''} onChange={e => setValues(v => ({ ...v, [x.id]: e.target.value }))} />
                : x.type === 'select' ? <select className="text-input" value={values[x.id] ?? ''} onChange={e => setValues(v => ({ ...v, [x.id]: e.target.value }))}><option value="">Choose…</option>{x.options.map(o => <option key={o}>{o}</option>)}</select>
                : <input className="text-input" value={values[x.id] ?? ''} onChange={e => setValues(v => ({ ...v, [x.id]: e.target.value }))} />}
            </label>
          ))}
          {error && <div className="ask-error">{error}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn primary" type="submit">Submit</button>
            {done && <span className="ask-done">Filed as <a href={`#/issue/${key(done)}`} onClick={e => { e.preventDefault(); navigate(`/issue/${key(done)}`); }}>{key(done)}</a> in {snap.teams.find(t => t.id === done.teamId)?.name} triage</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

/* ================= Settings › Loops ================= */
const TRIGGERS: Array<[LoopTrigger['kind'], string]> = [['issueCreated', 'An issue is created'], ['labelAdded', 'A label is added'], ['statusChanged', 'Status changes to'], ['schedule', 'On a schedule']];
const STATE_TYPES: Array<[WorkflowStateType, string]> = [['backlog', 'Backlog'], ['unstarted', 'Todo'], ['started', 'In Progress'], ['completed', 'Done'], ['canceled', 'Canceled']];
const ACTIONS: Array<[LoopAction['kind'], string]> = [['comment', 'Post a comment'], ['assign', 'Assign to'], ['label', 'Add label'], ['status', 'Move to'], ['createIssue', 'Create an issue'], ['claudeCode', 'Open in Claude Code']];

export function triggerText(t: LoopTrigger, labels: Array<{ id: string; name: string }>): string {
  if (t.kind === 'schedule') return `Every ${t.cadence === 'hourly' ? 'hour' : t.cadence === 'daily' ? 'day' : 'week'}`;
  if (t.kind === 'labelAdded') return `When “${labels.find(l => l.id === t.labelId)?.name ?? 'label'}” is added`;
  if (t.kind === 'statusChanged') return `When moved to ${STATE_TYPES.find(x => x[0] === t.stateType)?.[1]}`;
  return 'When an issue is created';
}

export function LoopsSettings() {
  const snap = useApp(s => s.snap)!;
  const [draft, setDraft] = useState<{ name: string; teamId: string; trigger: LoopTrigger; actions: LoopAction[] } | null>(null);
  const runs = (id: string) => snap.loopRuns.filter(r => r.loopId === id);
  const newDraft = () => setDraft({ name: '', teamId: '', trigger: { kind: 'issueCreated' }, actions: [{ kind: 'comment', body: 'Thanks — {issue.key} is on our radar.' }] });
  return (
    <div className="settings-card wide">
      <div className="set-head"><h1>Loops</h1><span style={{ flex: 1 }} /><button className="btn primary" onClick={newDraft}>New loop</button></div>
      <div className="field-help" style={{ marginBottom: 14 }}>Workflows that run on a schedule or when issues change: comment, assign, label, move, file an issue, or open the issue in Claude Code. Changes are attributed to the Automation agent.</div>
      {draft && <LoopEditor draft={draft} setDraft={setDraft} onSave={async () => { await api.createLoop({ ...draft, teamId: draft.teamId || null }); setDraft(null); await refresh(); }} />}
      <div className="card set-list">
        {snap.loops.map((l: Loop) => (
          <div key={l.id}>
            <div className="set-row group">
              <IconLoop size={14} />
              <span style={{ flex: 1 }}><b>{l.name}</b><span className="set-meta" style={{ marginLeft: 8 }}>{triggerText(l.trigger, snap.labels)} → {l.actions.map(a => ACTIONS.find(x => x[0] === a.kind)?.[1]).join(', ')}{l.teamId ? ` · ${snap.teams.find(t => t.id === l.teamId)?.name}` : ''}</span></span>
              <span className="set-meta">{l.lastRunAt ? `ran ${relTime(l.lastRunAt)}` : 'never ran'}</span>
              <button className="btn ghost sm" onClick={async () => { await api.runLoop(l.id); await refresh(); }}>Run now</button>
              <button className={`switch${l.enabled ? ' on' : ''}`} role="switch" aria-checked={l.enabled} aria-label={`Enable ${l.name}`} onClick={async () => { await api.updateLoop(l.id, { enabled: !l.enabled }); await refresh(); }}><span /></button>
              <button className="icon-btn hover-only" title="Delete loop" onClick={async () => { await api.deleteLoop(l.id); await refresh(); }}><IconTrash size={13} /></button>
            </div>
            {runs(l.id).slice(0, 3).map(r => <div key={r.id} className={`loop-run${r.ok ? '' : ' fail'}`}>{r.ok ? '✓' : '✗'} {r.detail} <span className="dim">· {relTime(r.createdAt)}</span></div>)}
          </div>
        ))}
        {!snap.loops.length && !draft && <div className="set-empty">No loops yet</div>}
      </div>
    </div>
  );
}

function LoopEditor({ draft, setDraft, onSave }: { draft: { name: string; teamId: string; trigger: LoopTrigger; actions: LoopAction[] }; setDraft: (d: typeof draft | null) => void; onSave: () => void }) {
  const snap = useApp(s => s.snap)!;
  const t = draft.trigger;
  const setTrigger = (kind: LoopTrigger['kind']) => setDraft({ ...draft, trigger: kind === 'schedule' ? { kind, cadence: 'weekly' } : kind === 'labelAdded' ? { kind, labelId: snap.labels[0]?.id ?? '' } : kind === 'statusChanged' ? { kind, stateType: 'completed' } : { kind } });
  const setAction = (i: number, a: LoopAction) => setDraft({ ...draft, actions: draft.actions.map((x, n) => n === i ? a : x) });
  const blank = (kind: LoopAction['kind']): LoopAction => kind === 'assign' ? { kind, userId: snap.users[0].id } : kind === 'comment' ? { kind, body: '' } : kind === 'label' ? { kind, labelId: snap.labels[0]?.id ?? '' } : kind === 'status' ? { kind, stateType: 'started' } : kind === 'createIssue' ? { kind, title: 'Weekly review {date}', description: '' } : { kind };
  return (
    <div className="card loop-editor">
      <input className="text-input" autoFocus placeholder="Loop name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
      <div className="loop-line"><span>When</span>
        <select className="text-input" aria-label="Loop trigger" value={t.kind} onChange={e => setTrigger(e.target.value as LoopTrigger['kind'])}>{TRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {t.kind === 'labelAdded' && <select className="text-input" value={t.labelId} onChange={e => setDraft({ ...draft, trigger: { kind: 'labelAdded', labelId: e.target.value } })}>{snap.labels.map(l => <option key={l.id} value={l.id}>{snap.teams.find(x => x.id === l.teamId)?.key} · {l.name}</option>)}</select>}
        {t.kind === 'statusChanged' && <select className="text-input" value={t.stateType} onChange={e => setDraft({ ...draft, trigger: { kind: 'statusChanged', stateType: e.target.value as WorkflowStateType } })}>{STATE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        {t.kind === 'schedule' && <select className="text-input" value={t.cadence} onChange={e => setDraft({ ...draft, trigger: { kind: 'schedule', cadence: e.target.value as 'hourly' | 'daily' | 'weekly' } })}><option value="hourly">Every hour</option><option value="daily">Every day</option><option value="weekly">Every week</option></select>}
        <span>in</span>
        <select className="text-input" aria-label="Loop team" value={draft.teamId} onChange={e => setDraft({ ...draft, teamId: e.target.value })}><option value="">All teams</option>{snap.teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      </div>
      {draft.actions.map((a, i) => (
        <div key={i} className="loop-line"><span>{i ? 'and' : 'Then'}</span>
          <select className="text-input" aria-label="Loop action" value={a.kind} onChange={e => setAction(i, blank(e.target.value as LoopAction['kind']))}>{ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {a.kind === 'comment' && <input className="text-input grow" aria-label="Comment text" placeholder="Comment — {issue.key} and {issue.title} fill in" value={a.body} onChange={e => setAction(i, { kind: 'comment', body: e.target.value })} />}
          {a.kind === 'assign' && <select className="text-input" value={a.userId} onChange={e => setAction(i, { kind: 'assign', userId: e.target.value })}>{snap.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
          {a.kind === 'label' && <select className="text-input" value={a.labelId} onChange={e => setAction(i, { kind: 'label', labelId: e.target.value })}>{snap.labels.map(l => <option key={l.id} value={l.id}>{snap.teams.find(x => x.id === l.teamId)?.key} · {l.name}</option>)}</select>}
          {a.kind === 'status' && <select className="text-input" value={a.stateType} onChange={e => setAction(i, { kind: 'status', stateType: e.target.value as WorkflowStateType })}>{STATE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
          {a.kind === 'createIssue' && <input className="text-input grow" placeholder="Title — {date} fills in" value={a.title} onChange={e => setAction(i, { ...a, title: e.target.value })} />}
          {a.kind === 'claudeCode' && <span className="set-meta">opens an interactive session in the issue's location</span>}
          <button className="icon-btn" title="Remove action" onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, n) => n !== i) })}><IconClose size={12} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn ghost sm" onClick={() => setDraft({ ...draft, actions: [...draft.actions, blank('comment')] })}><IconPlus size={12} /> Add action</button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button>
        <button className="btn primary sm" disabled={!draft.name.trim() || !draft.actions.length} onClick={onSave}>Create loop</button>
      </div>
    </div>
  );
}
