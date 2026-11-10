import { useContext, useEffect, useState } from 'react';
import { nudgeShortcut } from './tips.js';
import { Menu, MenuItem, MenuSep, SubmenuContext } from './ui.js';
import { useApp, STATUS_ORDER, localIsoDate, isoDaysFromToday } from './store.js';
import { api } from './api.js';
import { setIssueProps, toggleLabel, moveIssueToTeam, markDuplicate } from './actions.js';
import { StateIcon, PriorityIcon, Avatar, CalendarGrid, teamDisplayIcon } from './pickers.js';
import { IconUser, IconCycle, IconEstimate, IconClose, IconCheck, IconBox, IconCalendar, IconMilestone, IconPlus, IconClock } from './icons.js';
import { teamScale, type Issue, type Priority } from '../../src/core/types.js';
import { nextLabelColor } from './labelColors.js';

export type PropKind = 'status' | 'priority' | 'assignee' | 'labels' | 'project' | 'milestone' | 'cycle' | 'estimate' | 'due' | 'team' | 'parent'
  | 'blocked_by' | 'blocks' | 'related' | 'duplicate' | 'parent_of' | 'remind';

export const PROP_KBD: Partial<Record<PropKind, string>> = { status: 'S', priority: 'P', assignee: 'A', labels: 'L', project: '⇧P', cycle: '⇧C', estimate: '⇧E', due: '⇧D', team: '⌘⇧M', parent: '⌘⇧P', remind: '⇧H', blocked_by: 'M B', blocks: 'M X', related: 'M R', duplicate: 'M M' };
const WIDTH: Partial<Record<PropKind, number>> = { assignee: 250, labels: 250, project: 260, milestone: 250, cycle: 280, estimate: 220, due: 270, parent: 340, blocked_by: 340, blocks: 340, related: 340, duplicate: 340, parent_of: 340, remind: 300 };

function Shell(props: { placeholder: string; kind: PropKind; query: string; setQuery: (q: string) => void; children: React.ReactNode }) {
  return (
    <>
      <div className="menu-input menu-filter" onClick={e => e.stopPropagation()}>
        <input autoFocus value={props.query} placeholder={props.placeholder} spellCheck={false}
          onChange={e => props.setQuery(e.target.value)} />
        {PROP_KBD[props.kind] && <span className="kbd">{PROP_KBD[props.kind]}</span>}
      </div>
      {props.children}
    </>
  );
}

export function PropertyMenu(props: { kind: PropKind; issues: Issue[]; anchor: DOMRect; onClose: () => void }) {
  return (
    <Menu anchor={props.anchor} onClose={props.onClose} width={WIDTH[props.kind] ?? 240}>
      <PropertyMenuBody kind={props.kind} issues={props.issues} onClose={props.onClose} />
    </Menu>
  );
}
export const propMenuWidth = (k: PropKind) => WIDTH[k] ?? 240;

const match = (q: string, ...texts: string[]) => !q.trim() || texts.some(t => t.toLowerCase().includes(q.trim().toLowerCase()));

export function sortedStatesOf(teamId: string) {
  const snap = useApp.getState().snap!;
  return snap.states.filter(s => s.teamId === teamId).sort((a, b) => {
    const ia = (STATUS_ORDER as readonly string[]).indexOf(a.type);
    const ib = (STATUS_ORDER as readonly string[]).indexOf(b.type);
    return (ia === -1 ? -1 : ia) - (ib === -1 ? -1 : ib) || a.position - b.position;
  });
}

const TIP_WHAT: Partial<Record<PropKind, string>> = { status: 'change status', priority: 'set priority', assignee: 'assign', labels: 'add labels', project: 'set the project', cycle: 'set the cycle', estimate: 'set the estimate', due: 'set a due date', remind: 'set a reminder' };

export function PropertyMenuBody(props: { kind: PropKind; issues: Issue[]; onClose: () => void }) {
  const snap = useApp(s => s.snap)!;
  const [q, setQ] = useState('');
  const inSubmenu = useContext(SubmenuContext);
  useEffect(() => {
    const keys = PROP_KBD[props.kind], what = TIP_WHAT[props.kind];
    if (keys && what && !inSubmenu) nudgeShortcut(`prop:${props.kind}`, keys, what);
  }, []);
  const issues = props.issues.map(i => snap.issues.find(x => x.id === i.id) ?? i);
  if (!issues.length) return null;
  const ids = issues.map(i => i.id);
  const first = issues[0];
  const same = <T,>(get: (i: Issue) => T) => issues.every(i => get(i) === get(first)) ? get(first) : undefined;
  const common = { kind: props.kind, query: q, setQuery: setQ };
  const plural = issues.length > 1 ? ` (${issues.length})` : '';

  switch (props.kind) {
    case 'status': {
      const states = sortedStatesOf(first.teamId);
      const current = same(i => i.stateId);
      const pick = async (stateId: string) => {
        const target = snap.states.find(s => s.id === stateId)!;
        const byTeam = new Map<string, string[]>();
        for (const i of issues) byTeam.set(i.teamId, [...(byTeam.get(i.teamId) ?? []), i.id]);
        for (const [teamId, group] of byTeam) {
          const st = teamId === target.teamId ? target
            : snap.states.find(s => s.teamId === teamId && s.name === target.name) ?? snap.states.find(s => s.teamId === teamId && s.type === target.type);
          if (st) await setIssueProps(group, { stateId: st.id });
        }
      };
      const shown = states.filter(s => match(q, s.name));
      return (
        <Shell {...common} placeholder={`Change status${plural}…`}>
          {shown.map(s => (
            <MenuItem key={s.id} icon={<StateIcon type={s.type} color={s.color} />} label={s.name} selected={current === s.id}
              right={<span className="kbd">{states.indexOf(s) + 1}</span>} onClick={() => pick(s.id)} />
          ))}
          {shown.length === 0 && <Empty />}
        </Shell>
      );
    }
    case 'priority': {
      const current = same(i => i.priority);
      const opts: Array<[Priority, string]> = [[0, 'No priority'], [1, 'Urgent'], [2, 'High'], [3, 'Medium'], [4, 'Low']];
      const shown = opts.filter(([, l]) => match(q, l));
      return (
        <Shell {...common} placeholder={`Set priority to${plural}…`}>
          {shown.map(([v, label]) => (
            <MenuItem key={v} icon={<PriorityIcon priority={v} size={14} />} label={label} selected={current === v}
              right={<span className="kbd">{v}</span>} onClick={() => setIssueProps(ids, { priority: v })} />
          ))}
          {shown.length === 0 && <Empty />}
        </Shell>
      );
    }
    case 'assignee': {
      const current = same(i => i.assigneeId);
      const me = snap.currentUser;
      const humans = snap.users.filter(u => u.kind !== 'agent').sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name)));
      const agents = snap.users.filter(u => u.kind === 'agent');
      const showNone = match(q, 'No assignee', 'unassigned');
      const h = humans.filter(u => match(q, u.name, u.email));
      const a = agents.filter(u => match(q, u.name));
      return (
        <Shell {...common} placeholder={`Assign to${plural}…`}>
          {showNone && <MenuItem icon={<IconUser size={14} />} label="No assignee" selected={current === null} right={<span className="kbd">0</span>} onClick={() => setIssueProps(ids, { assigneeId: null })} />}
          {h.map((u, n) => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={<>{u.name}{u.id === me.id && <span className="mi-hint"> (you)</span>}</>} selected={current === u.id}
              right={!q && n < 9 ? <span className="kbd">{n + 1}</span> : undefined} onClick={() => setIssueProps(ids, { assigneeId: u.id })} />
          ))}
          {a.length > 0 && <><MenuSep /><div className="menu-header"><span>Agents</span></div></>}
          {a.map(u => (
            <MenuItem key={u.id} icon={<Avatar user={u} size={18} />} label={u.name} selected={current === u.id} onClick={() => setIssueProps(ids, { assigneeId: u.id })} />
          ))}
          {!showNone && h.length === 0 && a.length === 0 && <Empty />}
        </Shell>
      );
    }
    case 'labels': {
      const teamLabels = snap.labels.filter(l => l.teamId === first.teamId);
      const shown = teamLabels.filter(l => match(q, l.name));
      const exact = teamLabels.some(l => l.name.toLowerCase() === q.trim().toLowerCase());
      const create = async () => {
        const name = q.trim();
        if (!name) return;
        const { label } = await api.createLabel({ teamId: first.teamId, name, color: nextLabelColor(teamLabels.length) });
        await toggleLabel(ids, label.id);
        setQ('');
      };
      return (
        <Shell {...common} placeholder={`Change labels${plural}…`}>
          {shown.map(l => {
            const on = issues.every(i => i.labelIds.includes(l.id));
            const some = !on && issues.some(i => i.labelIds.includes(l.id));
            return (
              <button key={l.id} className="menu-item" onClick={e => { e.stopPropagation(); void toggleLabel(ids, l.id); }}>
                <span className={`mi-check${on ? ' on' : some ? ' some' : ''}`}>{on && <IconCheck size={11} />}</span>
                <span className="mi-icon"><span className="label-dot" style={{ background: l.color }} /></span>
                <span className="mi-label">{l.name}</span>
              </button>
            );
          })}
          {q.trim() && !exact && (
            <button className="menu-item" onClick={e => { e.stopPropagation(); void create(); }}>
              <span className="mi-icon"><IconPlus size={13} /></span>
              <span className="mi-label">Create new label: “{q.trim()}”</span>
            </button>
          )}
          {!q.trim() && shown.length === 0 && <Empty text="No labels in this team yet" />}
        </Shell>
      );
    }
    case 'project': {
      const current = same(i => i.projectId);
      const projects = snap.projects.filter(p => match(q, p.name));
      return (
        <Shell {...common} placeholder={`Add to project${plural}…`}>
          {match(q, 'No project') && <MenuItem icon={<IconBox size={14} />} label="No project" selected={current === null} onClick={() => setIssueProps(ids, { projectId: null })} />}
          {projects.map(p => (
            <MenuItem key={p.id} icon={<span className="proj-icon" style={{ background: 'var(--bg-hover)' }}>{p.icon}</span>} label={p.name}
              selected={current === p.id} onClick={() => setIssueProps(ids, { projectId: p.id })} />
          ))}
          {projects.length === 0 && !match(q, 'No project') && <Empty />}
        </Shell>
      );
    }
    case 'milestone': {
      const projectId = same(i => i.projectId);
      const current = same(i => i.milestoneId);
      const ms = projectId ? snap.milestones.filter(m => m.projectId === projectId && match(q, m.name)) : [];
      return (
        <Shell {...common} placeholder={`Set milestone${plural}…`}>
          {!projectId ? <Empty text={issues.some(i => i.projectId) ? 'Issues are in different projects' : 'Add the issue to a project first'} /> : (
            <>
              {match(q, 'No milestone') && <MenuItem icon={<IconMilestone size={14} />} label="No milestone" selected={current === null} onClick={() => setIssueProps(ids, { milestoneId: null })} />}
              {ms.map(m => (
                <MenuItem key={m.id} icon={<IconMilestone size={14} />} label={m.name} selected={current === m.id}
                  right={m.targetDate ? <span className="mi-hint">{new Date(m.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : undefined}
                  onClick={() => setIssueProps(ids, { milestoneId: m.id })} />
              ))}
              {snap.milestones.filter(m => m.projectId === projectId).length === 0 && <Empty text="This project has no milestones" />}
            </>
          )}
        </Shell>
      );
    }
    case 'cycle': {
      const current = same(i => i.cycleId);
      const now = new Date().toISOString();
      const cycles = snap.cycles.filter(c => c.teamId === first.teamId && (c.endsAt >= now || c.id === current))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const label = (c: typeof cycles[number]) => {
        const name = c.name || `Cycle ${c.number}`;
        return c.startsAt <= now && c.endsAt >= now ? `${name} (current)` : c.startsAt > now ? name : `${name} (ended)`;
      };
      const shown = cycles.filter(c => match(q, label(c)));
      return (
        <Shell {...common} placeholder={`Add to cycle${plural}…`}>
          {match(q, 'No cycle') && <MenuItem icon={<IconCycle size={14} />} label="No cycle" selected={current === null} onClick={() => setIssueProps(ids, { cycleId: null })} />}
          {shown.map(c => (
            <MenuItem key={c.id} icon={<IconCycle size={14} />} label={label(c)} selected={current === c.id}
              right={<span className="mi-hint">{new Date(c.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(c.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
              onClick={() => setIssueProps(ids, { cycleId: c.id })} />
          ))}
          {cycles.length === 0 && <Empty text="No current or upcoming cycles" />}
        </Shell>
      );
    }
    case 'estimate': {
      const current = same(i => i.estimate);
      const team = snap.teams.find(t => t.id === first.teamId);
      const scale = teamScale(team);
      const shown = scale.filter(s => match(q, s.label, `${s.value} points`));
      return (
        <Shell {...common} placeholder={`Set estimate${plural}…`}>
          {scale.length === 0 ? <Empty text="Estimates are off for this team" /> : (
            <>
              {match(q, 'No estimate') && <MenuItem icon={<IconEstimate size={14} />} label="No estimate" selected={current === null} onClick={() => setIssueProps(ids, { estimate: null })} />}
              {shown.map(s => (
                <MenuItem key={s.value} icon={<span className="est-glyph">{s.label}</span>}
                  label={team?.estimateScale === 'tshirt' ? `${s.label} (${s.value} pts)` : `${s.value} point${s.value === 1 ? '' : 's'}`}
                  selected={current === s.value} onClick={() => setIssueProps(ids, { estimate: s.value })} />
              ))}
            </>
          )}
        </Shell>
      );
    }
    case 'due': {
      const current = same(i => i.dueDate?.slice(0, 10) ?? null);
      const day = (off: number) => isoDaysFromToday(off);
      const endOfWeek = () => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return localIsoDate(d); };
      const quick: Array<[string, string]> = [['Today', day(0)], ['Tomorrow', day(1)], ['End of this week', endOfWeek()], ['In one week', day(7)], ['In two weeks', day(14)], ['In one month', day(30)]];
      const shown = quick.filter(([l]) => match(q, l));
      const typed = parseDateInput(q);
      return (
        <Shell {...common} placeholder={`Set due date${plural}… (e.g. "fri", "dec 3")`}>
          {typed && <MenuItem icon={<IconCalendar size={14} />} label={<>Due {new Date(typed + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</>} onClick={() => setIssueProps(ids, { dueDate: typed })} />}
          {shown.map(([l, iso]) => (
            <MenuItem key={l} icon={<IconCalendar size={14} />} label={l} selected={current === iso}
              right={<span className="mi-hint">{new Date(iso + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
              onClick={() => setIssueProps(ids, { dueDate: iso })} />
          ))}
          {!q && <><MenuSep /><CalendarGrid selected={current ?? undefined} onPick={async iso => { await setIssueProps(ids, { dueDate: iso }); props.onClose(); }} /></>}
          {current && <><MenuSep /><MenuItem icon={<IconClose size={13} />} label="Remove due date" onClick={() => setIssueProps(ids, { dueDate: null })} /></>}
        </Shell>
      );
    }
    case 'team': {
      const teams = snap.teams.filter(t => match(q, t.name, t.key));
      return (
        <Shell {...common} placeholder="Move to team…">
          {teams.map(t => (
            <MenuItem key={t.id} icon={teamDisplayIcon(t)} label={t.name} selected={first.teamId === t.id}
              right={<span className="mi-hint">{t.key}</span>}
              onClick={async () => { for (const id of ids) await moveIssueToTeam(id, t.id, to => { location.hash = `#${to}`; }); }} />
          ))}
        </Shell>
      );
    }
    case 'parent': {
      const below = new Set(ids);
      for (let grew = true; grew;) { grew = false; for (const i of snap.issues) if (i.parentId && below.has(i.parentId) && !below.has(i.id)) { below.add(i.id); grew = true; } }
      const pool = snap.issues.filter(i => !below.has(i.id));
      const keyOf = (i: Issue) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
      const shown = pool.filter(i => match(q, i.title, keyOf(i))).slice(0, 10);
      return (
        <Shell {...common} placeholder="Set parent issue…">
          {first.parentId && match(q, 'Remove parent') && <MenuItem icon={<IconClose size={13} />} label="Remove parent issue" onClick={() => setIssueProps(ids, { parentId: null })} />}
          {shown.map(i => {
            const st = snap.states.find(s => s.id === i.stateId);
            return (
              <MenuItem key={i.id} icon={st ? <StateIcon type={st.type} color={st.color} /> : undefined}
                label={<span><span className="mi-key">{keyOf(i)}</span>{i.title}</span>} selected={first.parentId === i.id}
                onClick={() => setIssueProps(ids, { parentId: i.id })} />
            );
          })}
          {shown.length === 0 && <Empty />}
        </Shell>
      );
    }
    case 'blocked_by': case 'blocks': case 'related': case 'duplicate': case 'parent_of': {
      const kind = props.kind;
      const keyOf = (i: Issue) => `${snap.teams.find(t => t.id === i.teamId)?.key}-${i.number}`;
      const linked = new Set(snap.relations.filter(r => r.issueId === first.id).map(r => r.relatedIssueId));
      const pool = snap.issues.filter(i => !ids.includes(i.id) && !linked.has(i.id) && (kind !== 'parent_of' || !i.parentId));
      const shown = pool.filter(i => match(q, i.title, keyOf(i))).slice(0, 10);
      const title = { blocked_by: 'Mark as blocked by…', blocks: 'Mark as blocking…', related: 'Mark as related to…', duplicate: 'Mark as duplicate of…', parent_of: 'Add sub-issue…' }[kind];
      const pick = async (other: Issue) => {
        for (const id of ids) {
          if (kind === 'duplicate') await markDuplicate(id, other.id);
          else if (kind === 'parent_of') await setIssueProps([other.id], { parentId: id });
          else await api.addRelation(id, other.id, kind);
        }
        await useApp.getState().bootstrap();
      };
      return (
        <Shell {...common} placeholder={title}>
          {shown.map(i => {
            const st = snap.states.find(s => s.id === i.stateId);
            return (
              <MenuItem key={i.id} icon={st ? <StateIcon type={st.type} color={st.color} /> : undefined}
                label={<span><span className="mi-key">{keyOf(i)}</span>{i.title}</span>} onClick={() => pick(i)} />
            );
          })}
          {shown.length === 0 && <Empty />}
        </Shell>
      );
    }
    case 'remind': {
      const at = (h: number, addDays = 0) => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return d; };
      const inHours = (h: number) => new Date(Date.now() + h * 3600000);
      const nextMonday = () => { const d = at(9); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return d; };
      const now = new Date();
      const opts: Array<[string, Date]> = [
        ['An hour from now', inHours(1)], ['In 3 hours', inHours(3)],
        ...(now.getHours() < 17 ? [['This evening', at(18)] as [string, Date]] : []),
        ['Tomorrow', at(9, 1)], ['Next week', nextMonday()], ['A month from now', (() => { const d = at(9); d.setMonth(d.getMonth() + 1); return d; })()],
      ];
      const typed = parseReminder(q);
      const fmt = (d: Date) => d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const remind = async (d: Date) => {
        for (const id of ids) await api.remindIssue(id, d.toISOString());
        await useApp.getState().bootstrap();
        useApp.getState().toast({ title: 'Reminder set', line: <>You'll get an inbox notification {fmt(d)}</> });
      };
      const nowIso = now.toISOString();
      const pending = snap.notifications.filter(n => n.type === 'issueReminder' && n.issueId && ids.includes(n.issueId) && n.snoozedUntil && n.snoozedUntil > nowIso);
      return (
        <Shell {...common} placeholder="Try: 4 pm, 2 days, in 5 weeks…">
          {typed && <MenuItem icon={<IconClock size={14} />} label={<>Remind me {fmt(typed)}</>} onClick={() => remind(typed)} />}
          {opts.filter(([l]) => match(q, l)).map(([l, d]) => (
            <MenuItem key={l} icon={<IconClock size={14} />} label={l} right={<span className="mi-hint">{fmt(d)}</span>} onClick={() => remind(d)} />
          ))}
          {pending.length > 0 && <MenuSep />}
          {pending.map(n => (
            <MenuItem key={n.id} icon={<IconClose size={13} />} label="Cancel reminder" right={<span className="mi-hint">{fmt(new Date(n.snoozedUntil!))}</span>}
              onClick={async () => { await api.deleteNotification(n.id); await useApp.getState().bootstrap(); useApp.getState().toast({ title: 'Reminder canceled' }); }} />
          ))}
        </Shell>
      );
    }
  }
}

export function parseReminder(raw: string): Date | null {
  const s = raw.trim().toLowerCase().replace(/^in /, '');
  if (!s) return null;
  const rel = /^(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?|months?)$/.exec(s);
  if (rel) {
    const n = Number(rel[1]); const u = rel[2]; const d = new Date();
    if (u.startsWith('m') && !u.startsWith('mo')) d.setMinutes(d.getMinutes() + n);
    else if (u.startsWith('h')) d.setHours(d.getHours() + n);
    else if (u.startsWith('d')) d.setDate(d.getDate() + n);
    else if (u.startsWith('w')) d.setDate(d.getDate() + 7 * n);
    else d.setMonth(d.getMonth() + n);
    return d;
  }
  const time = /^(?:(tomorrow|today) ?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (time && (time[4] || time[3] || time[1])) {
    let h = Number(time[2]) % 12 + (time[4] === 'pm' ? 12 : 0);
    if (!time[4] && Number(time[2]) > 12) h = Number(time[2]);
    const d = new Date(); d.setHours(h, Number(time[3] ?? 0), 0, 0);
    if (time[1] === 'tomorrow' || (!time[1] && d < new Date())) d.setDate(d.getDate() + 1);
    return d;
  }
  if (s === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }
  const day = parseDateInput(s);
  if (day) { const d = new Date(day + 'T09:00'); return d; }
  return null;
}

function Empty({ text = 'No results' }: { text?: string }) {
  return <div className="menu-empty">{text}</div>;
}

export function parseDateInput(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const rel = /^in (\d+) (day|days|week|weeks|month|months)$/.exec(s);
  if (rel) {
    const n = Number(rel[1]); const d = new Date(today);
    if (rel[2].startsWith('day')) d.setDate(d.getDate() + n);
    else if (rel[2].startsWith('week')) d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    return iso(d);
  }
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dow = /^(next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(s);
  if (dow) {
    const target = days.indexOf(dow[2]);
    const d = new Date(today);
    let add = (target - d.getDay() + 7) % 7 || 7;
    if (dow[1]) add += add < 7 ? 7 : 0;
    d.setDate(d.getDate() + add);
    return iso(d);
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const md = /^([a-z]{3})[a-z]* (\d{1,2})$/.exec(s) ?? /^(\d{1,2}) ([a-z]{3})[a-z]*$/.exec(s);
  if (md) {
    const [mon, day] = /^\d/.test(md[1]) ? [md[2], md[1]] : [md[1], md[2]];
    const m = months.indexOf(mon);
    if (m >= 0) {
      const d = new Date(today.getFullYear(), m, Number(day), 12);
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      return iso(d);
    }
  }
  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (slash) {
    const d = new Date(today.getFullYear(), Number(slash[1]) - 1, Number(slash[2]), 12);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return iso(d);
  }
  return null;
}
