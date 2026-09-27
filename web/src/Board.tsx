import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  DragOverlay, useDroppable, closestCorners,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp, STATUS_ORDER, copyText } from './store.js';
import { api } from './api.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { IconPlus, IconMore, IconCopy, IconFocus } from './icons.js';
import { Menu, MenuItem, MenuSep, useMenu } from './ui.js';
import { groupsFor, issuesOfGroup, orderIssues } from './IssueViews.js';
import { useLanding } from './motion.js';
import type { Issue, GroupBy, Priority } from '../../src/core/types.js';

/* card internals — shared by the sortable card and the drag overlay */
function CardBody(props: { issue: Issue; groupBy: GroupBy; becameDone?: boolean }) {
  const snap = useApp(s => s.snap)!;
  const team = snap.teams.find(t => t.id === props.issue.teamId);
  const state = snap.states.find(s => s.id === props.issue.stateId);
  const assignee = snap.users.find(u => u.id === props.issue.assigneeId);
  const labels = snap.labels.filter(l => props.issue.labelIds.includes(l.id));
  return (
    <>
      <div className="bc-top">
        <span className="bc-key">{team?.key}-{props.issue.number}</span>
        <span data-no-drag><Avatar user={assignee} /></span>
      </div>
      <div className="bc-title">
        {/* the column already says where it lives — only repeat the state on non-status boards */}
        {props.groupBy !== 'status' && state && <StateIcon type={state.type} color={state.color} size={13} morph={props.becameDone} />}
        <span>{props.issue.title}</span>
      </div>
      {(props.issue.priority > 0 || labels.length > 0) && (
        <div className="bc-meta">
          {props.issue.priority > 0 && <PriorityIcon priority={props.issue.priority} size={13} />}
          {labels.slice(0, 3).map(l => (
            <span key={l.id} className="label-pill" style={{ background: `color-mix(in srgb, ${l.color} calc(var(--label-bg-alpha) * 100%), transparent)`, color: 'var(--text-secondary)' }}>
              <span className="label-dot" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function BoardCard(props: { issue: Issue; groupBy: GroupBy }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.issue.id, data: { issue: props.issue } });
  const state = useApp(s => s.snap!.states.find(st => st.id === props.issue.stateId));
  // a card that lands in a new column gets the same enter + flash as a row
  const { justMoved, becameDone } = useLanding(props.issue, state?.type);
  // a completed drag must not land as a click on the (hidden) source card
  const suppressClick = useRef(false);
  useEffect(() => {
    if (isDragging) { suppressClick.current = true; return; }
    // dnd-kit capture-stops the drag's own trailing click, so the card never gets
    // the chance to consume the flag — release it once the drag has settled
    if (!suppressClick.current) return;
    const t = setTimeout(() => { suppressClick.current = false; }, 150);
    return () => clearTimeout(t);
  }, [isDragging]);
  const open = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    const team = useApp.getState().snap?.teams.find(t => t.id === props.issue.teamId);
    navigate(`/issue/${team?.key}-${props.issue.number}`);
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-issue-row={props.issue.id}
      className={`board-card ${isDragging ? 'source-hidden' : ''} ${justMoved && !isDragging ? 'just-moved' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={open}
      onAuxClick={open}
    >
      <CardBody issue={props.issue} groupBy={props.groupBy} becameDone={becameDone} />
    </div>
  );
}

const FIELD_FOR: Partial<Record<GroupBy, string>> = {
  status: 'stateId',
  priority: 'priority',
  assignee: 'assigneeId',
  project: 'projectId',
  cycle: 'cycleId',
};

export function Board(props: {
  issues: Issue[];
  /** omit for cross-team boards (My Issues, saved views) — columns merge by state name */
  teamId?: string;
  groupBy?: GroupBy;
  /** 'manual' keeps drag order; any other ordering sorts cards inside columns */
  orderBy?: string;
  /** status boards: focus a column via the status filter (wired by the page);
      cross-team columns focus every state merged into them */
  onFocusColumn?: (stateIds: string[]) => void;
}) {
  const snap = useApp(s => s.snap)!;
  const rawGroupBy = props.groupBy ?? 'status';
  const groupBy: GroupBy = rawGroupBy === 'none' ? 'status' : rawGroupBy;
  const [active, setActive] = useState<{ issue: Issue; width: number } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = useMemo(() => {
    if (groupBy === 'status') {
      // merge cross-team states by name like the list does
      const states = snap.states
        .filter(s => !props.teamId || s.teamId === props.teamId)
        .sort((a, b) => {
          const ia = STATUS_ORDER.indexOf(a.type as never);
          const ib = STATUS_ORDER.indexOf(b.type as never);
          return ia !== ib ? ia - ib : a.position - b.position;
        });
      const seen = new Map<string, { id: string; label: string; icon: React.ReactNode; stateIds: string[] }>();
      for (const s of states) {
        const col = seen.get(s.name);
        if (col) { col.stateIds.push(s.id); continue; }
        seen.set(s.name, { id: s.id, label: s.name, icon: <StateIcon type={s.type} color={s.color} size={14} />, stateIds: [s.id] });
      }
      return [...seen.values()];
    }
    return groupsFor(groupBy, snap, props.teamId).map(g => ({ id: g.id, label: g.label, icon: g.icon, stateIds: [g.id] }));
  }, [groupBy, snap, props.teamId]);

  const byColumn = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const col of columns) m.set(col.id, []);
    for (const i of props.issues) {
      const match = columns.find(col => issuesOfGroup(groupBy, [i], col.id).length > 0);
      if (match) m.get(match.id)!.push(i);
    }
    for (const [id, arr] of m) m.set(id, props.orderBy && props.orderBy !== 'manual' ? orderIssues(arr, props.orderBy) : arr.sort((a, b) => a.sortOrder - b.sortOrder));
    return m;
  }, [props.issues, props.orderBy, columns, groupBy]);

  const field = FIELD_FOR[groupBy];

  const onDragStart = (e: DragStartEvent) => {
    const issue = e.active.data.current?.issue as Issue | undefined;
    if (issue) setActive({ issue, width: e.active.rect.current.initial?.width ?? 320 });
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const { active, over } = e;
    if (!over || String(over.id) === String(active.id)) return;
    const issue = active.data.current?.issue as Issue | undefined;
    if (!issue) return;

    const overId = String(over.id);
    let targetCol: { id: string; label: string } | undefined;
    let beforeId: string | null = null;
    let afterId: string | null = null;
    for (const col of columns) {
      const cards = byColumn.get(col.id) ?? [];
      if (overId === col.id) {
        targetCol = col;
        afterId = cards.length ? cards[cards.length - 1].id : null;
        break;
      }
      const idx = cards.findIndex(c => c.id === overId);
      if (idx >= 0) {
        targetCol = col;
        beforeId = cards[idx].id;
        afterId = idx > 0 ? cards[idx - 1].id : null;
        break;
      }
    }
    if (!targetCol) return;

    // no-op detection: same column, same neighbours → nothing to persist
    const sourceColId = columns.find(col => (byColumn.get(col.id) ?? []).some(c => c.id === issue.id))?.id;
    const sameSpot = targetCol.id === sourceColId && beforeId === neighborOf(byColumn, sourceColId, issue.id, -1) && afterId === neighborOf(byColumn, sourceColId, issue.id, +1);

    if (sameSpot) return;

    // Land the card now, persist after: the local snapshot moves it into its new
    // column/slot this frame, so the drop never snaps back to where it came from
    // while the server round-trip runs. The bootstrap below reconciles.
    const optimistic: Partial<Issue> = {};
    let fieldChanged = false;
    if (field) {
      const current = (issue as unknown as Record<string, unknown>)[field];
      // on merged status boards, resolve the drop column to the issue's own team state
      let nextValue: string | number | null = targetCol.id;
      if (groupBy === 'status') {
        const ownState = snap.states.find(s => s.teamId === issue.teamId && s.name === targetCol.label);
        // the column's state doesn't exist in this issue's team — nowhere to move it
        if (!ownState) return;
        nextValue = ownState.id;
      } else if (groupBy === 'priority') {
        nextValue = Number(targetCol.id);
      } else if (targetCol.id === 'none') {
        nextValue = null;
      }
      if (current !== nextValue) {
        (optimistic as Record<string, unknown>)[field] = nextValue;
        fieldChanged = true;
      }
    }
    const moved = beforeId !== issue.id && afterId !== issue.id;
    if (moved) {
      const target = byColumn.get(targetCol.id) ?? [];
      const lo = target.find(c => c.id === afterId)?.sortOrder;
      const hi = target.find(c => c.id === beforeId)?.sortOrder;
      optimistic.sortOrder = lo !== undefined && hi !== undefined ? (lo + hi) / 2
        : hi !== undefined ? hi - 1 : lo !== undefined ? lo + 1 : issue.sortOrder;
    }
    if (!fieldChanged && !moved) return;
    useApp.setState(s => s.snap ? { snap: { ...s.snap, issues: s.snap.issues.map(i => i.id === issue.id ? { ...i, ...optimistic } : i) } } : {});
    try {
      if (fieldChanged) await api.updateIssue(issue.id, { [field!]: optimistic[field as keyof Issue] });
      if (moved) await api.moveIssue(issue.id, beforeId, afterId);
    } finally {
      await useApp.getState().bootstrap();
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="board">
        {columns.map(col => (
          <BoardColumn
            key={col.id}
            id={col.id}
            label={col.label}
            icon={col.icon}
            stateIds={col.stateIds}
            issues={byColumn.get(col.id) ?? []}
            groupBy={groupBy}
            teamId={props.teamId}
            onFocus={props.onFocusColumn}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{
        duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        // the lifted tilt settles flat while the overlay flies to its slot
        sideEffects: ({ dragOverlay }) => { dragOverlay.node.querySelector('.overlay-card')?.classList.add('dropping'); },
      }}>
        {active && (
          <div className="board-card overlay-card" style={{ width: active.width }}>
            <CardBody issue={active.issue} groupBy={groupBy} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function neighborOf(byColumn: Map<string, Issue[]>, colId: string | undefined, issueId: string, delta: -1 | 1): string | null | undefined {
  if (!colId) return undefined;
  const cards = byColumn.get(colId) ?? [];
  const idx = cards.findIndex(c => c.id === issueId);
  if (idx < 0) return undefined;
  const n = cards[idx + delta];
  return n ? n.id : null;
}

function BoardColumn(props: {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** every state merged into this column (all teams on cross-team boards) */
  stateIds: string[];
  issues: Issue[];
  groupBy: GroupBy;
  teamId?: string;
  onFocus?: (stateIds: string[]) => void;
}) {
  const snap = useApp(s => s.snap)!;
  const openCreate = useApp(s => s.openCreate);
  const toast = useApp(s => s.toast);
  const menu = useMenu();
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  // cross-team boards pass no teamId — resolve it from the column's state so
  // the create modal opens on the team the column actually belongs to
  const createTeamId = props.teamId ?? snap.states.find(s => s.id === props.id)?.teamId;
  const addIssue = () => openCreate({ teamId: createTeamId, stateId: props.id });

  return (
    <div className={`board-col ${isOver ? 'drop-active' : ''}`}>
      <div className="board-col-header">
        {props.icon}
        <span className="bch-label">{props.label}</span>
        <span className="count">{props.issues.length}</span>
        <span className="col-actions">
          <button className="icon-btn" data-no-drag title="Column actions" onClick={menu.open}><IconMore size={13} /></button>
          {props.groupBy === 'status' && (
            <button className="icon-btn" data-no-drag title="Create issue in this status" onClick={addIssue}>
              <IconPlus size={13} />
            </button>
          )}
        </span>
      </div>
      <SortableContext items={props.issues.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`board-col-body ${isOver ? 'drag-over' : ''}`}>
          {props.issues.map(i => <BoardCard key={i.id} issue={i} groupBy={props.groupBy} />)}
        </div>
      </SortableContext>
      {menu.anchor && (
        <Menu anchor={menu.anchor} onClose={menu.close} width={210}>
          {props.groupBy === 'status' && (
            <>
              <MenuItem icon={<IconPlus size={14} />} label="Add issue…" onClick={addIssue} />
              {props.onFocus && (
                <MenuItem icon={<IconFocus size={14} />} label="Focus this column" onClick={() => props.onFocus!(props.stateIds)} />
              )}
              <MenuSep />
            </>
          )}
          <MenuItem icon={<IconCopy size={14} />} label="Copy as markdown" onClick={async () => {
            const lines = props.issues.map(i => {
              const t = snap.teams.find(x => x.id === i.teamId);
              return `- \`${t?.key}-${i.number}\` ${i.title}`;
            });
            if (await copyText(lines.join('\n'))) toast({ title: `Copied ${lines.length} issue${lines.length === 1 ? '' : 's'}` });
          }} />
        </Menu>
      )}
    </div>
  );
}
