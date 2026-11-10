import { useState } from 'react';
import { useApp, relTime, dateTime } from './store.js';
import { api } from './api.js';
import { PriorityIcon } from './pickers.js';
import { IconPlus, IconTrash, IconSla, IconLoop, IconClose, IconEdit } from './icons.js';
import type { Issue, Loop, LoopAction, LoopTrigger, Priority, WorkflowStateType } from '../../src/core/types.js';
import { ConfirmIconButton, exclusive } from './ui.js';

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
  return <span className={`sla-badge ${st}`} title={`${label} · due ${dateTime(issue.slaBreachesAt!)}`}><IconSla size={12} />{long ? label : st === 'breached' ? 'Breached' : txt}</span>;
}

/* ================= Settings › Issues › SLAs ================= */
export function SlaSettings() {
  const snap = useApp(s => s.snap)!;
  const [name, setName] = useState('');
  const [hours, setHours] = useState('24');
  const [prio, setPrio] = useState<Priority[]>([1]);
  const [teamId, setTeamId] = useState('');
  // the form below doubles as the editor: Edit on a rule loads it here and the button saves instead of adding
  const [editing, setEditing] = useState<string | null>(null);
  const resetForm = () => { setEditing(null); setName(''); setHours('24'); setPrio([1]); setTeamId(''); };
  const create = () => exclusive('sla-create', async () => {
    if (!name.trim()) return;
    if (!(Number(hours) > 0)) { useApp.getState().toast({ title: 'Set how many hours the SLA allows', line: 'It needs to be more than 0.' }); return; }
    const body = { name: name.trim(), hours: Number(hours), priorities: prio, teamId: teamId || null };
    if (editing) await api.updateSlaRule(editing, body); else await api.createSlaRule(body);
    useApp.getState().toast({ title: editing ? 'Rule saved' : 'Rule added', line: body.name });
    resetForm(); await refresh();
  });
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
            <button className="icon-btn hover-only" title="Edit rule" aria-label="Edit rule" onClick={() => { setEditing(r.id); setName(r.name); setHours(String(r.hours)); setPrio(r.priorities); setTeamId(r.teamId ?? ''); }}><IconEdit size={13} /></button>
            <ConfirmIconButton className="icon-btn hover-only" title="Delete rule" onConfirm={async () => { await api.deleteSlaRule(r.id); await refresh(); }}><IconTrash size={13} /></ConfirmIconButton>
          </div>
        ))}
        {!snap.slaRules.length && <div className="set-empty">No SLA rules yet</div>}
        <div className="sla-form">
          <input className="text-input" placeholder="Rule name, e.g. Urgent bugs" value={name} onChange={e => setName(e.target.value)} />
          <div className="sla-prios">{PRIORITIES.map(([p, l]) => <button key={p} className={`prop-chip${prio.includes(p) ? ' set' : ''}`} onClick={() => setPrio(cur => cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p])}><PriorityIcon priority={p} size={12} />{l}</button>)}</div>
          <select className="text-input" aria-label="SLA team" value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">All teams</option>{snap.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <label className="sla-hours">Within <input className="text-input" aria-label="SLA hours" type="number" min={1} value={hours} onChange={e => setHours(e.target.value)} /> hours</label>
          {editing && <button className="btn sm" onClick={resetForm}>Cancel</button>}
          <button className="btn primary sm" disabled={!name.trim()} onClick={create}>{editing ? 'Save rule' : <><IconPlus size={12} /> Add rule</>}</button>
        </div>
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
  // set while the editor holds an existing loop (loops could only be created, run, toggled or deleted)
  const [editingId, setEditingId] = useState<string | null>(null);
  const runs = (id: string) => snap.loopRuns.filter(r => r.loopId === id);
  const newDraft = () => { setEditingId(null); setDraft({ name: '', teamId: '', trigger: { kind: 'issueCreated' }, actions: [{ kind: 'comment', body: 'Thanks, {issue.key} is on our radar.' }] }); };
  return (
    <div className="settings-card">
      <div className="set-head"><h1>Loops</h1><span style={{ flex: 1 }} /><button className="btn primary" onClick={newDraft}>New loop</button></div>
      <div className="field-help" style={{ marginBottom: 14 }}>Workflows that run on a schedule or when issues change: comment, assign, label, move, file an issue, or open the issue in Claude Code. Changes are attributed to the Automation agent.</div>
      {draft && <LoopEditor draft={draft} setDraft={d => { setDraft(d); if (!d) setEditingId(null); }} saveLabel={editingId ? 'Save loop' : 'Create loop'} onSave={() => exclusive('loop-save', async () => {
        const body = { ...draft, teamId: draft.teamId || null };
        if (editingId) await api.updateLoop(editingId, body); else await api.createLoop(body);
        useApp.getState().toast({ title: editingId ? 'Loop saved' : 'Loop created', line: draft.name });
        setDraft(null); setEditingId(null); await refresh();
      })} />}
      <div className="card set-list">
        {snap.loops.map((l: Loop) => (
          <div key={l.id}>
            <div className="set-row group">
              <IconLoop size={14} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', padding: '6px 0' }}><b>{l.name}</b><span className="set-meta" style={{ marginLeft: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{triggerText(l.trigger, snap.labels)} → {l.actions.map(a => ACTIONS.find(x => x[0] === a.kind)?.[1]).join(', ')}{l.teamId ? ` · ${snap.teams.find(t => t.id === l.teamId)?.name}` : ''}</span></span>
              <span className="set-meta">{l.lastRunAt ? `ran ${relTime(l.lastRunAt)}` : 'never ran'}</span>
              <button className="icon-btn hover-only" title="Edit loop" aria-label="Edit loop" onClick={() => { setEditingId(l.id); setDraft({ name: l.name, teamId: l.teamId ?? '', trigger: l.trigger, actions: l.actions }); }}><IconEdit size={13} /></button>
              <button className="btn ghost sm" onClick={() => void exclusive(`loop-run-${l.id}`, async () => { await api.runLoop(l.id); await refresh(); useApp.getState().toast({ title: `Ran ${l.name}` }); })}>Run now</button>
              <button className={`switch${l.enabled ? ' on' : ''}`} role="switch" aria-checked={l.enabled} aria-label={`Enable ${l.name}`} onClick={async () => { await api.updateLoop(l.id, { enabled: !l.enabled }); await refresh(); }}><span /></button>
              <ConfirmIconButton className="icon-btn hover-only" title="Delete loop" onConfirm={async () => { await api.deleteLoop(l.id); await refresh(); }}><IconTrash size={13} /></ConfirmIconButton>
            </div>
            {runs(l.id).slice(0, 3).map(r => <div key={r.id} className={`loop-run${r.ok ? '' : ' fail'}`}>{r.ok ? '✓' : '✗'} {r.detail} <span className="dim">· {relTime(r.createdAt)}</span></div>)}
          </div>
        ))}
        {!snap.loops.length && !draft && <div className="set-empty">No loops yet</div>}
      </div>
    </div>
  );
}

function LoopEditor({ draft, setDraft, onSave, saveLabel = 'Create loop' }: { saveLabel?: string; draft: { name: string; teamId: string; trigger: LoopTrigger; actions: LoopAction[] }; setDraft: (d: typeof draft | null) => void; onSave: () => void }) {
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
          {a.kind === 'comment' && <input className="text-input grow" aria-label="Comment text" placeholder="Comment, with {issue.key} and {issue.title} filled in" value={a.body} onChange={e => setAction(i, { kind: 'comment', body: e.target.value })} />}
          {a.kind === 'assign' && <select className="text-input" value={a.userId} onChange={e => setAction(i, { kind: 'assign', userId: e.target.value })}>{snap.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
          {a.kind === 'label' && <select className="text-input" value={a.labelId} onChange={e => setAction(i, { kind: 'label', labelId: e.target.value })}>{snap.labels.map(l => <option key={l.id} value={l.id}>{snap.teams.find(x => x.id === l.teamId)?.key} · {l.name}</option>)}</select>}
          {a.kind === 'status' && <select className="text-input" value={a.stateType} onChange={e => setAction(i, { kind: 'status', stateType: e.target.value as WorkflowStateType })}>{STATE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
          {a.kind === 'createIssue' && <input className="text-input grow" placeholder="Title, with {date} filled in" value={a.title} onChange={e => setAction(i, { ...a, title: e.target.value })} />}
          {a.kind === 'claudeCode' && <span className="set-meta">{snap.workspace.auth === 'hosted'
            ? 'skipped on a shared server, since it opens Claude Code on a computer'
            : 'opens an interactive session in the issue\'s location'}</span>}
          <button className="icon-btn" title="Remove action" onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, n) => n !== i) })}><IconClose size={12} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn ghost sm" onClick={() => setDraft({ ...draft, actions: [...draft.actions, blank('comment')] })}><IconPlus size={12} /> Add action</button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button>
        <button className="btn primary sm" disabled={!draft.name.trim() || !draft.actions.length} onClick={onSave}>{saveLabel}</button>
      </div>
    </div>
  );
}
