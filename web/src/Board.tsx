import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  DragOverlay, useDroppable, closestCorners,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp, STATUS_ORDER, copyText, shortDate, useSelection, useCursor, registerVisibleList, localIsoDate } from './store.js';
import { api } from './api.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { IconPlus, IconMore, IconCopy, IconFocus, IconCycle, IconEstimate, IconCalendar, IconChevronRight, IconCaret, IconMilestone, IconAttach, IconChevronDown } from './icons.js';
import { Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { groupsFor, issuesOfGroup, orderIssues, subIssueProgress, SubIssueProgress, IssueContextMenu, estimateLabel, DEFAULT_DISPLAY, type DisplayProps } from './IssueViews.js';
import { useLanding } from './motion.js';
import { issuePrList, issuePrState, prSummary, PrIcon } from './GitHubUI.js';
import { PropertyMenu, type PropKind } from './propertyMenus.js';
import { pointsOf, type Issue, type GroupBy } from '../../src/core/types.js';

/* card internals, shared by the sortable card and the drag overlay. Linear's layout:
   the key (and parent, for a sub-issue) with the avatar, then status + title, then a row
   of small bordered chips for whatever is set and shown, then when it was created. A chip
   that would only repeat the column's or the row's grouping is left out. With `onProp` the
   property chips are buttons that open the same menu the shortcut or the detail page would
   (the drag overlay leaves it off, so its copy stays inert). */
function CardBody(props: { issue: Issue; groupBy: GroupBy; subgroupBy?: GroupBy | 'none'; display: Partial<DisplayProps>; becameDone?: boolean; onProp?: (kind: PropKind, e: React.MouseEvent) => void }) {
  const snap = useApp(s => s.snap)!;
  const issue = props.issue;
  const d = props.display;
  const team = snap.teams.find(t => t.id === issue.teamId);
  const state = snap.states.find(s => s.id === issue.stateId);
  const assignee = snap.users.find(u => u.id === issue.assigneeId);
  const labels = snap.labels.filter(l => issue.labelIds.includes(l.id));
  const project = snap.projects.find(p => p.id === issue.projectId);
  const milestone = snap.milestones.find(m => m.id === issue.milestoneId);
  const cycle = snap.cycles.find(c => c.id === issue.cycleId);
  const parent = issue.parentId ? snap.issues.find(i => i.id === issue.parentId) : undefined;
  const progress = subIssueProgress(issue.id, snap);
  const closed = state?.type === 'completed' || state?.type === 'canceled';
  const due = issue.dueDate?.slice(0, 10);
  const overdue = !!due && !closed && due < localIsoDate();
  const links = d.links ? snap.attachments.filter(a => a.issueId === issue.id).length : 0;
  const est = estimateLabel(issue, snap);
  const pr = d.prs !== false ? issuePrState(snap, issue.id) : null;
  const grouped = (g: GroupBy) => props.groupBy === g || props.subgroupBy === g;
  const onProp = props.onProp;
  // a press on a chip is a click, never the start of a drag or an open of the issue
  const edit = (kind: PropKind) => onProp ? {
    role: 'button', 'data-edit': kind,
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); onProp(kind, e); },
  } : {};
  const editable = onProp ? ' editable' : '';
  const chips = [
    d.priority && issue.priority > 0 && !grouped('priority') && (
      <span key="p" className={`bc-chip icon${editable}`} {...edit('priority')} title={['', 'Urgent', 'High', 'Medium', 'Low'][issue.priority]}><PriorityIcon priority={issue.priority} size={12} /></span>
    ),
    d.cycle && cycle && !grouped('cycle') && (
      <span key="c" className={`bc-chip${editable}`} {...edit('cycle')} title={cycle.name || `Cycle ${cycle.number}`}><IconCycle size={12} />{cycle.number}</span>
    ),
    d.project && project && !grouped('project') && (
      <span key="j" className={`bc-chip${editable}`} {...edit('project')} title={project.name}><span className="bc-proj">{project.icon}</span><span className="bc-chip-text">{project.name}</span></span>
    ),
    d.milestone && milestone && !grouped('milestone') && (
      <span key="ms" className={`bc-chip${editable}`} {...edit('milestone')} title={milestone.name}><IconMilestone size={12} /><span className="bc-chip-text">{milestone.name}</span></span>
    ),
    pr && <span key="pr" className="bc-chip icon" data-pr-state={pr}><PrIcon state={pr} size={12} title={prSummary(issuePrList(snap, issue.id))} /></span>,
    progress && <span key="s" className="bc-chip"><SubIssueProgress done={progress.done} total={progress.total} size={12} /></span>,
    ...(d.labels && !grouped('label') ? labels.slice(0, 2) : []).map(l => (
      <span key={l.id} className={`bc-chip${editable}`} {...edit('labels')} title={l.name}><span className="label-dot" style={{ background: l.color }} /><span className="bc-chip-text">{l.name}</span></span>
    )),
    d.labels && !grouped('label') && labels.length > 2 && <span key="lm" className={`bc-chip${editable}`} {...edit('labels')} title={labels.slice(2).map(l => l.name).join(', ')}>+{labels.length - 2}</span>,
    d.estimate && est != null && <span key="e" className={`bc-chip${editable}`} {...edit('estimate')} title={`${issue.estimate} points`}><IconEstimate size={12} />{est}</span>,
    d.links && links > 0 && <span key="lk" className="bc-chip" title={`${links} links`}><IconAttach size={12} />{links}</span>,
    d.due && due && (
      <span key="d" className={`bc-chip${editable}${overdue ? ' overdue' : ''}`} {...edit('due')} title={overdue ? `Overdue, was due ${shortDate(due + 'T12:00')}` : `Due ${shortDate(due + 'T12:00')}`}><IconCalendar size={12} />{shortDate(due + 'T12:00')}</span>
    ),
  ].filter(Boolean);
  return (
    <>
      <div className="bc-top">
        {d.id !== false && <span className="bc-key">{team?.key}-{issue.number}</span>}
        {parent && <span className="bc-parent" title={`Sub-issue of ${parent.title}`}><IconChevronRight size={10} /><span className="bc-parent-text">{parent.title}</span></span>}
        <span className="bc-fill" />
        {d.assignee !== false && !grouped('assignee') && (assignee || onProp) && (
          // unassigned cards keep an empty avatar that surfaces on hover, so assigning is one click
          <span className={`bc-avatar${editable}${assignee ? '' : ' unassigned'}`} {...edit('assignee')} title={assignee ? `Assigned to ${assignee.name}` : 'Assign'}>
            <Avatar user={assignee} size={18} />
          </span>
        )}
      </div>
      <div className="bc-head">
        {d.status !== false && state && (
          <span className={`bc-status${editable}`} {...edit('status')} title={onProp ? `Change status (${state.name})` : state.name}>
            <StateIcon type={state.type} color={state.color} size={14} morph={props.becameDone} />
          </span>
        )}
        <span className="bc-title">{issue.title}</span>
      </div>
      {chips.length > 0 && <div className="bc-chips">{chips}</div>}
      {(d.created || d.updated) && (
        <div className="bc-created">{d.created ? `Created ${shortDate(issue.createdAt)}` : `Updated ${shortDate(issue.updatedAt)}`}</div>
      )}
    </>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function BoardCard(props: { issue: Issue; groupBy: GroupBy; subgroupBy: GroupBy | 'none'; display: Partial<DisplayProps>; index: number }) {
  const navigate = useNavigate();
  const menu = useMenu();
  const [prop, setProp] = useState<{ kind: PropKind; anchor: DOMRect } | null>(null);
  const selected = useSelection(s => s.ids.includes(props.issue.id));
  const cursor = useCursor(s => s.index === props.index);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.issue.id, data: { issue: props.issue } });
  const state = useApp(s => s.snap!.states.find(st => st.id === props.issue.stateId));
  // finished work recedes: done dims, canceled also strikes through
  const closedClass = state?.type === 'completed' ? ' is-done' : state?.type === 'canceled' ? ' is-canceled' : '';
  // a card that lands in a new column gets the same enter + flash as a row
  const { justMoved, becameDone } = useLanding(props.issue, state?.type);
  // a completed drag must not land as a click on the (hidden) source card
  const suppressClick = useRef(false);
  useEffect(() => {
    if (isDragging) { suppressClick.current = true; return; }
    if (!suppressClick.current) return;
    const t = setTimeout(() => { suppressClick.current = false; }, 150);
    return () => clearTimeout(t);
  }, [isDragging]);
  const open = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey) { useSelection.getState().toggle(props.issue.id); return; }
    const team = useApp.getState().snap?.teams.find(t => t.id === props.issue.teamId);
    navigate(`/issue/${team?.key}-${props.issue.number}`);
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-issue-row={props.issue.id}
      className={`board-card${closedClass}${isDragging ? ' source-hidden' : ''}${justMoved && !isDragging ? ' just-moved' : ''}${selected ? ' selected' : ''}${cursor ? ' cursor' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={open}
      onMouseMove={() => { if (useCursor.getState().index !== props.index) useCursor.setState({ index: props.index }); }}
      onContextMenu={menu.open}
    >
      <CardBody issue={props.issue} groupBy={props.groupBy} subgroupBy={props.subgroupBy} display={props.display} becameDone={becameDone}
        onProp={(kind, e) => { menu.close(); setProp({ kind, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() }); }} />
      {(menu.anchor || prop) && (
        // the menus portal out, but React still bubbles their events through the card:
        // keep those presses and clicks from starting a drag or opening the issue
        <span className="bc-menus" onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop} onContextMenu={stop}>
          {menu.anchor && <IssueContextMenu anchor={menu.anchor} onClose={menu.close} issue={props.issue} />}
          {prop && <PropertyMenu kind={prop.kind} issues={[props.issue]} anchor={prop.anchor} onClose={() => setProp(null)} />}
        </span>
      )}
    </div>
  );
}

const FIELD_FOR: Partial<Record<GroupBy, string>> = {
  status: 'stateId', priority: 'priority', assignee: 'assigneeId', project: 'projectId', cycle: 'cycleId', milestone: 'milestoneId',
};

interface Column { id: string; label: string; icon: React.ReactNode; stateIds: string[]; stateType?: string }
const ALL_LANE = '__all';

export function Board(props: {
  issues: Issue[];
  /** omit for cross-team boards (My Issues, saved views); columns merge by state name */
  teamId?: string;
  groupBy?: GroupBy;
  /** rows (swimlanes) */
  subgroupBy?: GroupBy | 'none';
  /** 'manual' keeps drag order; any other ordering sorts cards inside columns */
  orderBy?: string;
  orderReversed?: boolean;
  display?: Partial<DisplayProps>;
  showEmpty?: boolean;
  createDefaults?: { projectId?: string | null; cycleId?: string | null };
  /** status boards: focus a column via the status filter (wired by the page) */
  onFocusColumn?: (stateIds: string[]) => void;
}) {
  const snap = useApp(s => s.snap)!;
  const rawGroupBy = props.groupBy ?? 'status';
  const groupBy: GroupBy = rawGroupBy === 'none' ? 'status' : rawGroupBy;
  const subgroupBy = props.subgroupBy && props.subgroupBy !== groupBy ? props.subgroupBy : 'none';
  const display = props.display ?? DEFAULT_DISPLAY;
  const [active, setActive] = useState<{ issue: Issue; width: number } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [lanesCollapsed, setLanesCollapsed] = useState<Record<string, boolean>>({});

  const columns = useMemo<Column[]>(() => {
    if (groupBy === 'status') {
      // merge cross-team states by name like the list does
      const states = snap.states
        .filter(s => !props.teamId || s.teamId === props.teamId)
        .sort((a, b) => {
          const ia = (STATUS_ORDER as readonly string[]).indexOf(a.type);
          const ib = (STATUS_ORDER as readonly string[]).indexOf(b.type);
          return ia !== ib ? ia - ib : a.position - b.position;
        });
      const seen = new Map<string, Column>();
      for (const s of states) {
        const col = seen.get(s.name);
        if (col) { col.stateIds.push(s.id); continue; }
        seen.set(s.name, { id: s.id, label: s.name, icon: <StateIcon type={s.type} color={s.color} size={14} />, stateIds: [s.id], stateType: s.type });
      }
      return [...seen.values()];
    }
    return groupsFor(groupBy, snap, props.teamId).map(g => ({ id: g.id, label: g.label, icon: g.icon, stateIds: [g.id] }));
  }, [groupBy, snap, props.teamId]);

  const lanes = useMemo(() => {
    if (subgroupBy === 'none') return [{ id: ALL_LANE, label: '', icon: null as React.ReactNode }];
    const specs = groupsFor(subgroupBy, snap, props.teamId);
    return specs.filter(sp => props.showEmpty || props.issues.some(i => issuesOfGroup(subgroupBy, [i], sp.id).length));
  }, [subgroupBy, snap, props.teamId, props.issues, props.showEmpty]);

  /** lane → column → cards; an issue lives in exactly one cell (its first matching lane) */
  const cells = useMemo(() => {
    const m = new Map<string, Map<string, Issue[]>>();
    for (const lane of lanes) { const row = new Map<string, Issue[]>(); for (const c of columns) row.set(c.id, []); m.set(lane.id, row); }
    for (const i of props.issues) {
      const col = columns.find(c => issuesOfGroup(groupBy, [i], c.id).length > 0);
      const lane = subgroupBy === 'none' ? lanes[0] : lanes.find(l => issuesOfGroup(subgroupBy, [i], l.id).length > 0);
      if (col && lane) m.get(lane.id)!.get(col.id)!.push(i);
    }
    for (const row of m.values()) for (const [id, arr] of row) row.set(id, props.orderBy && props.orderBy !== 'manual' ? orderIssues(arr, props.orderBy, false, props.orderReversed) : arr.sort((a, b) => a.sortOrder - b.sortOrder));
    return m;
  }, [props.issues, props.orderBy, columns, lanes, groupBy, subgroupBy]);

  const colTotal = (colId: string) => [...cells.values()].reduce((a, row) => a + (row.get(colId)?.length ?? 0), 0);
  const colPoints = (colId: string) => [...cells.values()].reduce((a, row) => a + (row.get(colId) ?? []).reduce((x, i) => x + pointsOf(i, snap.teams), 0), 0);

  // keyboard order: lane by lane, column by column
  const flat = useMemo(() => {
    const out: Issue[] = [];
    for (const lane of lanes) for (const c of columns) out.push(...(cells.get(lane.id)?.get(c.id) ?? []));
    return out;
  }, [cells, lanes, columns]);
  useEffect(() => { registerVisibleList(flat, props.teamId ?? ''); }, [flat, props.teamId]);

  const field = FIELD_FOR[groupBy];
  const laneField = subgroupBy !== 'none' ? FIELD_FOR[subgroupBy] : undefined;

  // Hidden columns move to a side panel (still drop targets), like Linear. Keyed by grouping +
  // label so the choice follows a status name across teams. Unless you've shown or hidden a
  // column yourself, empty columns and Canceled start hidden (unless "show empty columns").
  const [folded, setFolded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('baseline:boardFolded') ?? '{}'); } catch { return {}; }
  });
  const foldKey = (label: string) => `${groupBy}:${label}`;
  const isFolded = (col: Column) =>
    folded[foldKey(col.label)] ?? (col.stateType === 'canceled' || (!props.showEmpty && colTotal(col.id) === 0));
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem('baseline:hiddenColsOpen') !== '0'; } catch { return true; } });
  const togglePanel = () => setPanelOpen(o => { try { localStorage.setItem('baseline:hiddenColsOpen', o ? '0' : '1'); } catch { /* ignore */ } return !o; });
  const shownCols = columns.filter(c => !isFolded(c));
  const hiddenCols = columns.filter(c => isFolded(c));
  const setFold = (label: string, v: boolean) => setFolded(f => {
    const next = { ...f, [foldKey(label)]: v };
    try { localStorage.setItem('baseline:boardFolded', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const onDragStart = (e: DragStartEvent) => {
    const issue = e.active.data.current?.issue as Issue | undefined;
    if (issue) setActive({ issue, width: e.active.rect.current.initial?.width ?? 320 });
  };

  const valueFor = (g: GroupBy, colId: string, colLabel: string, issue: Issue): string | number | null | undefined => {
    if (g === 'status') {
      // on merged status boards, resolve the drop column to the issue's own team state
      return snap.states.find(s => s.teamId === issue.teamId && s.name === colLabel)?.id;
    }
    if (g === 'priority') return Number(colId);
    return colId === 'none' ? null : colId;
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const { active, over } = e;
    if (!over || String(over.id) === String(active.id)) return;
    const issue = active.data.current?.issue as Issue | undefined;
    if (!issue) return;

    const overId = String(over.id);
    let target: { lane: string; col: Column } | undefined;
    let beforeId: string | null = null;
    let afterId: string | null = null;
    outer: for (const lane of lanes) {
      for (const col of columns) {
        const cards = cells.get(lane.id)?.get(col.id) ?? [];
        if (overId === cellId(lane.id, col.id) || (lane.id === ALL_LANE && overId === col.id)) {
          target = { lane: lane.id, col };
          afterId = cards.length ? cards[cards.length - 1].id : null;
          break outer;
        }
        const idx = cards.findIndex(c => c.id === overId);
        if (idx >= 0) {
          target = { lane: lane.id, col };
          beforeId = cards[idx].id;
          afterId = idx > 0 ? cards[idx - 1].id : null;
          break outer;
        }
      }
    }
    if (!target) return;
    const cards = cells.get(target.lane)?.get(target.col.id) ?? [];

    const optimistic: Partial<Issue> = {};
    const patch: Record<string, unknown> = {};
    if (field) {
      const next = valueFor(groupBy, target.col.id, target.col.label, issue);
      if (next === undefined) return; // the column's state doesn't exist in this issue's team
      if ((issue as unknown as Record<string, unknown>)[field] !== next) { (optimistic as Record<string, unknown>)[field] = next; patch[field] = next; }
    }
    if (laneField && target.lane !== ALL_LANE) {
      const lane = lanes.find(l => l.id === target!.lane)!;
      const next = valueFor(subgroupBy as GroupBy, lane.id, lane.label, issue);
      if (next !== undefined && (issue as unknown as Record<string, unknown>)[laneField] !== next) { (optimistic as Record<string, unknown>)[laneField] = next; patch[laneField] = next; }
    }
    const moved = beforeId !== issue.id && afterId !== issue.id;
    if (moved) {
      const lo = cards.find(c => c.id === afterId)?.sortOrder;
      const hi = cards.find(c => c.id === beforeId)?.sortOrder;
      optimistic.sortOrder = lo !== undefined && hi !== undefined ? (lo + hi) / 2
        : hi !== undefined ? hi - 1 : lo !== undefined ? lo + 1 : issue.sortOrder;
    }
    if (!Object.keys(patch).length && !moved) return;
    // move the card now and save after, so the drop never snaps back while the request runs
    useApp.setState(s => s.snap ? { snap: { ...s.snap, issues: s.snap.issues.map(i => i.id === issue.id ? { ...i, ...optimistic } : i) } } : {});
    try {
      if (Object.keys(patch).length) await api.updateIssue(issue.id, patch);
      if (moved) await api.moveIssue(issue.id, beforeId, afterId);
    } finally {
      await useApp.getState().bootstrap();
    }
  };

  const toggleLane = (id: string) => setLanesCollapsed(c => ({ ...c, [id]: !c[id] }));

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className={`board${subgroupBy !== 'none' ? ' with-lanes' : ''}`}>
        <div className="board-grid">
          <div className="board-heads">
            {shownCols.map(col => (
              <ColumnHeader key={col.id} col={col} total={colTotal(col.id)} points={colPoints(col.id)} groupBy={groupBy} teamId={props.teamId}
                issues={[...cells.values()].flatMap(row => row.get(col.id) ?? [])} createDefaults={props.createDefaults}
                onFocus={props.onFocusColumn} onHide={() => setFold(col.label, true)} />
            ))}
          </div>
          {lanes.map(lane => (
            <div key={lane.id} className="board-lane">
              {lane.id !== ALL_LANE && (
                <button className={`lane-head${lanesCollapsed[lane.id] ? ' collapsed' : ''}`} onClick={() => toggleLane(lane.id)}>
                  <IconChevronDown size={12} className="lane-chev" />
                  {lane.icon}
                  <span>{lane.label}</span>
                  <span className="count">{shownCols.reduce((a, c) => a + (cells.get(lane.id)?.get(c.id)?.length ?? 0), 0)}</span>
                </button>
              )}
              {!lanesCollapsed[lane.id] && (
                <div className="board-cells">
                  {shownCols.map(col => (
                    <BoardCell key={col.id} laneId={lane.id} col={col} issues={cells.get(lane.id)?.get(col.id) ?? []} flat={flat}
                      groupBy={groupBy} subgroupBy={subgroupBy} display={display} teamId={props.teamId} createDefaults={props.createDefaults} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {hiddenCols.length > 0 && (
          <div className={`board-hidden${panelOpen ? ' open' : ''}`}>
            <button className="bh-head" onClick={togglePanel} aria-expanded={panelOpen}>
              <IconCaret size={12} className="nav-caret" /> Hidden columns
              {!panelOpen && <span className="count">{hiddenCols.length}</span>}
            </button>
            {panelOpen && hiddenCols.map(col => (
              <HiddenColumn key={col.id} id={col.id} label={col.label} icon={col.icon} count={colTotal(col.id)}
                onShow={() => setFold(col.label, false)} />
            ))}
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={{
        duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        sideEffects: ({ dragOverlay }) => { dragOverlay.node.querySelector('.overlay-card')?.classList.add('dropping'); },
      }}>
        {active && (
          <div className="board-card overlay-card" style={{ width: active.width }}>
            <CardBody issue={active.issue} groupBy={groupBy} subgroupBy={subgroupBy} display={display} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

const cellId = (lane: string, col: string) => lane === ALL_LANE ? col : `cell:${lane}:${col}`;

/** groupings whose column (or row) a new issue can start in */
const CREATE_GROUPS: GroupBy[] = ['status', 'project', 'cycle', 'priority', 'assignee'];
type CreateDefaults = { projectId?: string | null; cycleId?: string | null };

/** the create modal's starting values for an issue made from a column (and row) */
function createOpts(snap: NonNullable<ReturnType<typeof useApp.getState>['snap']>, teamId: string | undefined, base: CreateDefaults | undefined, at: [GroupBy, string][]) {
  const opts: { teamId?: string; stateId?: string } & CreateDefaults = { teamId, ...base };
  for (const [g, id] of at) {
    if (g === 'status') { opts.stateId = id; opts.teamId ??= snap.states.find(s => s.id === id)?.teamId; }
    if (g === 'project') opts.projectId = id === 'none' ? null : id;
    if (g === 'cycle') opts.cycleId = id === 'none' ? null : id;
  }
  return opts;
}

function ColumnHeader(props: {
  col: Column; total: number; points: number; groupBy: GroupBy; teamId?: string; issues: Issue[];
  createDefaults?: { projectId?: string | null; cycleId?: string | null };
  onFocus?: (stateIds: string[]) => void; onHide: () => void;
}) {
  const snap = useApp(s => s.snap)!;
  const openCreate = useApp(s => s.openCreate);
  const toast = useApp(s => s.toast);
  const menu = useMenu();
  const canCreate = CREATE_GROUPS.includes(props.groupBy);
  const addIssue = () => openCreate(createOpts(snap, props.teamId, props.createDefaults, [[props.groupBy, props.col.id]]));
  const estimatesOn = props.teamId ? snap.teams.find(t => t.id === props.teamId)?.estimateScale !== 'none' : true;
  return (
    <div className="board-col-header">
      {props.col.icon}
      <span className="bch-label">{props.col.label}</span>
      <span className="count">{props.total}</span>
      {estimatesOn && props.points > 0 && <span className="gh-points" title={`${props.points} points`}><IconEstimate size={11} />{props.points}</span>}
      <span className="col-actions">
        <button className="icon-btn col-more" data-no-drag title="Column actions" onClick={menu.open}><IconMore size={13} /></button>
        {canCreate && <button className="icon-btn" data-no-drag title="New issue" onClick={addIssue}><IconPlus size={13} /></button>}
      </span>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={210}>
          {canCreate && <MenuItem icon={<IconPlus size={14} />} label="New issue" onClick={addIssue} />}
          {props.groupBy === 'status' && props.onFocus && <MenuItem icon={<IconFocus size={14} />} label="Focus this column" onClick={() => props.onFocus!(props.col.stateIds)} />}
          {(canCreate || props.onFocus) && <MenuSep />}
          <MenuItem label="Hide column" onClick={props.onHide} />
          <MenuItem icon={<IconCopy size={14} />} label="Copy as markdown" onClick={async () => {
            const lines = props.issues.map(i => `- \`${snap.teams.find(x => x.id === i.teamId)?.key}-${i.number}\` ${i.title}`);
            if (await copyText(lines.join('\n'))) toast({ title: `Copied ${lines.length} issue${lines.length === 1 ? '' : 's'}` });
          }} />
        </Menu>
      )}
    </div>
  );
}

function BoardCell(props: {
  laneId: string; col: Column; issues: Issue[]; flat: Issue[]; groupBy: GroupBy; subgroupBy: GroupBy | 'none';
  display: Partial<DisplayProps>; teamId?: string; createDefaults?: { projectId?: string | null; cycleId?: string | null };
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId(props.laneId, props.col.id) });
  const snap = useApp(s => s.snap)!;
  const openCreate = useApp(s => s.openCreate);
  const canCreate = CREATE_GROUPS.includes(props.groupBy);
  // a card made here starts in this column and, on a board with rows, in this row too
  const addIssue = () => openCreate(createOpts(snap, props.teamId, props.createDefaults, [
    [props.groupBy, props.col.id],
    ...(props.subgroupBy !== 'none' && props.laneId !== ALL_LANE ? [[props.subgroupBy, props.laneId] as [GroupBy, string]] : []),
  ]));
  return (
    <div className={`board-col${isOver ? ' drop-active' : ''}`}>
      <SortableContext items={props.issues.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="board-col-body">
          {props.issues.map(i => <BoardCard key={i.id} issue={i} groupBy={props.groupBy} subgroupBy={props.subgroupBy} display={props.display} index={props.flat.indexOf(i)} />)}
          {props.issues.length === 0 && props.laneId === ALL_LANE && <div className="lane-empty"><span>No issues</span></div>}
          {canCreate && <button className="lane-add trailing" onClick={addIssue}><IconPlus size={12} /> New issue</button>}
        </div>
      </SortableContext>
    </div>
  );
}

/* a row in the Hidden columns panel: shows its count, takes drops, and a click brings the column back */
function HiddenColumn(props: { id: string; label: string; icon: React.ReactNode; count: number; onShow: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  return (
    <button ref={setNodeRef} className={`bh-row${isOver ? ' drop-active' : ''}`} onClick={props.onShow} title={`Show ${props.label}`}>
      {props.icon}
      <span className="bh-label">{props.label}</span>
      <span className="count">{props.count}</span>
    </button>
  );
}
