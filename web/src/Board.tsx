import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, PointerSensor, useSensor, useSensors,
  DragOverlay, useDroppable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useApp, shortDate, STATUS_ORDER } from './store.js';
import { api } from './api.js';
import { StateIcon, PriorityIcon, Avatar } from './pickers.js';
import { IconMore, IconPlus } from './icons.js';
import { groupsFor, issuesOfGroup } from './IssueViews.js';
import type { Issue, GroupBy, Priority } from '../../src/core/types.js';

function BoardCard(props: { issue: Issue; dragging?: boolean; columnWidth?: number }) {
  const snap = useApp(s => s.snap)!;
  const setPeek = useApp(s => s.setPeek);
  const navigate = useNavigate();
  const team = snap.teams.find(t => t.id === props.issue.teamId);
  const state = snap.states.find(s => s.id === props.issue.stateId);
  const assignee = snap.users.find(u => u.id === props.issue.assigneeId);
  const labels = snap.labels.filter(l => props.issue.labelIds.includes(l.id));
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: props.issue.id, data: { issue: props.issue } });
  void isDragging;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`board-card ${props.dragging ? 'dragging' : ''}`}
      style={transform && !props.dragging ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 } : props.dragging ? { width: props.columnWidth ?? 440 } : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
        setPeek(props.issue.id);
      }}
      onAuxClick={() => navigate(`/issue/${team?.key}-${props.issue.number}`)}
    >
      <div className="bc-top">
        <span className="bc-key">{team?.key}-{props.issue.number}</span>
        <span style={{ marginLeft: 'auto' }} data-no-drag><Avatar user={assignee} /></span>
      </div>
      <div className="bc-title">
        {state && <StateIcon type={state.type} color={state.color} size={13} />}
        <span>{props.issue.title}</span>
      </div>
      {(props.issue.priority > 0 || labels.length > 0) && (
        <div className="bc-meta">
          {props.issue.priority > 0 && <PriorityIcon priority={props.issue.priority} size={13} />}
          {labels.slice(0, 2).map(l => (
            <span key={l.id} className="label-pill" style={{ background: `color-mix(in srgb, ${l.color} calc(var(--label-bg-alpha) * 100%), transparent)`, color: 'var(--text-secondary)' }}>
              <span className="label-dot" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="bc-footer">Created {shortDate(props.issue.createdAt)}</div>
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
  teamId: string;
  groupBy?: GroupBy;
}) {
  const snap = useApp(s => s.snap)!;
  const groupBy = props.groupBy ?? 'status';
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const statusStates = useMemo(
    () => snap.states.filter(s => s.teamId === props.teamId)
      .sort((a, b) => {
        const ia = STATUS_ORDER.indexOf(a.type as never);
        const ib = STATUS_ORDER.indexOf(b.type as never);
        return ia !== ib ? ia - ib : a.position - b.position;
      }),
    [snap.states, props.teamId],
  );

  const columns = useMemo(() => {
    if (groupBy === 'none') return [];
    if (groupBy === 'status') {
      // merge cross-team states by name like the list does
      const seen = new Map<string, { id: string; label: string; icon: React.ReactNode; fieldId: string }>();
      for (const s of statusStates) {
        if (seen.has(s.name)) continue;
        seen.set(s.name, { id: s.id, label: s.name, icon: <StateIcon type={s.type} color={s.color} size={14} />, fieldId: s.id });
      }
      return [...seen.values()];
    }
    return groupsFor(groupBy, snap, props.teamId).map(g => ({ id: g.id, label: g.label, icon: g.icon, fieldId: g.id === 'none' ? null : g.id }));
  }, [groupBy, snap, props.teamId, statusStates]);

  const byColumn = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const col of columns) m.set(col.id, []);
    for (const i of props.issues) {
      if (groupBy === 'none') continue;
      const match = columns.find(col => issuesOfGroup(groupBy, [i], col.id).length > 0);
      if (match) m.get(match.id)!.push(i);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return m;
  }, [props.issues, columns, groupBy]);

  const emptyStatusColumns = groupBy === 'status'
    ? columns.filter(col => (byColumn.get(col.id) ?? []).length === 0)
    : [];

  const field = FIELD_FOR[groupBy];

  const onDragStart = (e: DragStartEvent) => setActiveIssue((e.active.data.current?.issue as Issue) ?? null);

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveIssue(null);
    const { active, over } = e;
    if (!over) return;
    const issue = active.data.current?.issue as Issue | undefined;
    if (!issue) return;

    // resolve target column: dropped on a column body, a hidden column, or a card
    const overId = String(over.id);
    let targetColId: string | undefined;
    let overIndex = -1;
    if (overId.startsWith('hidden:')) {
      targetColId = overId.slice('hidden:'.length);
      overIndex = (byColumn.get(targetColId) ?? []).length;
    } else {
      for (const col of columns) {
        const cards = byColumn.get(col.id) ?? [];
        if (overId === col.id) { targetColId = col.id; overIndex = cards.length; break; }
        const idx = cards.findIndex(c => c.id === overId);
        if (idx >= 0) { targetColId = col.id; overIndex = idx; break; }
      }
    }
    if (!targetColId) return;

    const targetCards = (byColumn.get(targetColId) ?? []).filter(c => c.id !== issue.id);
    const overCard = targetCards[Math.min(overIndex, targetCards.length - 1)];
    let afterId: string | null = null;
    let beforeId: string | null = null;
    if (overCard && overIndex < targetCards.length) {
      beforeId = overCard.id;
      const prevCard = targetCards[overIndex - 1];
      afterId = prevCard ? prevCard.id : null;
    } else {
      afterId = targetCards.length ? targetCards[targetCards.length - 1].id : null;
    }

    // move field (status / priority / assignee / project / cycle) if the column differs
    if (field) {
      const current = (issue as unknown as Record<string, unknown>)[field];
      const nextValue = groupBy === 'priority' ? Number(targetColId) : (targetColId === 'none' ? null : targetColId);
      if (current !== nextValue) {
        await api.updateIssue(issue.id, { [field]: nextValue });
      }
    }
    if (beforeId !== issue.id && afterId !== issue.id) {
      await api.moveIssue(issue.id, beforeId, afterId);
    }
    await useApp.getState().bootstrap();
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveIssue(null)}>
      <div className="board">
        {columns.map(col => (
          <BoardColumn
            key={col.id}
            id={col.id}
            label={col.label}
            icon={col.icon}
            issues={byColumn.get(col.id) ?? []}
            groupBy={groupBy}
            teamId={props.teamId}
          />
        ))}
        {emptyStatusColumns.length > 0 && (
          <div style={{ flex: 'none', width: 210 }}>
            <button className="board-col-header" style={{ width: '100%' }} onClick={() => setHiddenOpen(o => !o)}>
              <span style={{ fontSize: 10 }}>{hiddenOpen ? '▾' : '▸'}</span> Hidden columns
              <span className="count">{emptyStatusColumns.length}</span>
            </button>
            {hiddenOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {emptyStatusColumns.map(col => <HiddenColumn key={col.id} col={col} />)}
              </div>
            )}
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeIssue && (
          <div style={{ width: 440 }}>
            <BoardCard issue={activeIssue} dragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function HiddenColumn(props: { col: { id: string; label: string; icon: React.ReactNode } }) {
  const { setNodeRef, isOver } = useDroppable({ id: `hidden:${props.col.id}`, data: { hiddenTarget: props.col.id } });
  return (
    <div ref={setNodeRef} className={`board-col-body hidden-col ${isOver ? 'drag-over' : ''}`} style={{ minHeight: 60 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, opacity: 0.75 }}>
        {props.col.icon}
        {props.col.label}
      </div>
    </div>
  );
}

function BoardColumn(props: {
  id: string;
  label: string;
  icon: React.ReactNode;
  issues: Issue[];
  groupBy: GroupBy;
  teamId: string;
}) {
  const openCreate = useApp(s => s.openCreate);
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  return (
    <div className="board-col">
      <div className="board-col-header">
        {props.icon}
        <span>{props.label}</span>
        <span className="count">{props.issues.length}</span>
        <span className="col-actions">
          <button className="icon-btn" data-no-drag><IconMore size={13} /></button>
          {props.groupBy === 'status' && (
            <button className="icon-btn" data-no-drag title="Create issue in this status"
              onClick={() => openCreate({ teamId: props.teamId, stateId: props.id })}>
              <IconPlus size={13} />
            </button>
          )}
        </span>
      </div>
      <SortableContext items={props.issues.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`board-col-body ${isOver ? 'drag-over' : ''}`}>
          {props.issues.map(i => <BoardCard key={i.id} issue={i} />)}
        </div>
      </SortableContext>
    </div>
  );
}
