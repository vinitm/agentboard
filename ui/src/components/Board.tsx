import React, { useState, useMemo } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Column } from './Column';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';
import { TaskForm } from './TaskForm';
import type { Task, TaskStatus, RiskLevel } from '../types';
import type { FilterState } from './TopBar';

const MAIN_COLUMNS: TaskStatus[] = [
  'backlog', 'ready', 'spec', 'planning', 'implementing', 'checks',
  'review_panel', 'needs_human_review', 'done',
];

const EXTRA_COLUMNS: TaskStatus[] = ['blocked', 'failed', 'cancelled'];
const MOVABLE_COLUMNS: TaskStatus[] = ['backlog', 'ready', 'cancelled', 'done'];

interface Props {
  tasks: Task[];
  loading: boolean;
  createTask: (data: { title: string; description?: string; spec?: string; riskLevel?: RiskLevel; priority?: number }) => Promise<Task>;
  updateTask: (id: string, data: Partial<Task>) => Promise<Task>;
  moveTask: (id: string, column: TaskStatus) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  answerTask: (id: string, answers: string) => Promise<Task>;
  retryTask: (id: string) => Promise<Task>;
  showNewTask?: boolean;
  onCloseNewTask?: () => void;
  filters?: FilterState;
}

function applyFilters(tasks: Task[], filters: FilterState | undefined): Task[] {
  if (!filters) return tasks;
  let result = tasks;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter((t) => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
  }
  if (filters.status) {
    result = result.filter((t) => t.status === filters.status);
  }
  if (filters.risk) {
    result = result.filter((t) => t.riskLevel === filters.risk);
  }
  if (filters.running === 'running') {
    result = result.filter((t) => t.claimedBy);
  } else if (filters.running === 'idle') {
    result = result.filter((t) => !t.claimedBy);
  }
  return result;
}

// Skeleton card for loading state
const SkeletonCard: React.FC = () => (
  <div className="bg-bg-secondary rounded-lg p-3 mb-2 border border-border-default">
    <div className="skeleton h-4 w-3/4 mb-2" />
    <div className="skeleton h-3 w-1/2 mb-2" />
    <div className="flex gap-2">
      <div className="skeleton h-2 w-8 rounded-full" />
      <div className="skeleton h-2 w-12 rounded-full" />
    </div>
  </div>
);

const SkeletonColumn: React.FC = () => (
  <div className="w-72 flex-shrink-0 rounded-lg p-2.5 bg-bg-tertiary">
    <div className="flex items-center justify-between mb-2.5 px-1">
      <div className="skeleton h-3 w-16" />
      <div className="skeleton h-4 w-6 rounded-full" />
    </div>
    <SkeletonCard />
    <SkeletonCard />
  </div>
);

// Empty board state
const EmptyBoard: React.FC<{ onNewTask?: () => void }> = ({ onNewTask }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
    <div className="w-16 h-16 rounded-2xl bg-bg-tertiary border border-border-default flex items-center justify-center mb-4">
      <svg className="w-8 h-8 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 4a1 1 0 011-1h3a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm5 0a1 1 0 011-1h3a1 1 0 011 1v12a1 1 0 01-1 1H9a1 1 0 01-1-1V4zm6-1a1 1 0 00-1 1v12a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3z" />
      </svg>
    </div>
    <h3 className="text-base font-semibold text-text-primary mb-1">No tasks yet</h3>
    <p className="text-sm text-text-secondary mb-4 max-w-sm">
      Create your first task to start the autonomous pipeline.
    </p>
    {onNewTask && (
      <button
        onClick={onNewTask}
        className="px-4 py-2 text-sm font-semibold bg-accent-blue text-white rounded-lg hover:bg-blue-600 transition-colors"
      >
        Create Task
      </button>
    )}
    <kbd className="mt-3 text-[11px] text-text-tertiary bg-bg-tertiary px-2 py-1 rounded border border-border-default font-mono">
      Press N to create a task
    </kbd>
  </div>
);

export const Board: React.FC<Props> = ({
  tasks, loading, createTask, updateTask, moveTask, deleteTask, answerTask, retryTask,
  showNewTask, onCloseNewTask, filters,
}) => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedColumns, setCollapsedColumns] = useState<Set<TaskStatus>>(new Set());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Subtask filtering
  const { topLevelTasks, subtasksByParent } = useMemo(() => {
    const byParent = new Map<string, Task[]>();
    const topLevel = tasks.filter((t) => {
      if (t.parentTaskId) {
        const existing = byParent.get(t.parentTaskId) || [];
        existing.push(t);
        byParent.set(t.parentTaskId, existing);
        return false;
      }
      return true;
    });
    return { topLevelTasks: topLevel, subtasksByParent: byParent };
  }, [tasks]);

  // Apply filters
  const filteredTasks = useMemo(() => applyFilters(topLevelTasks, filters), [topLevelTasks, filters]);
  const hasActiveFilters = filters?.search || filters?.status || filters?.risk || filters?.running;

  const tasksByStatus = (status: TaskStatus) => filteredTasks.filter((t) => t.status === status);

  const toggleColumn = (status: TaskStatus) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTask((event.active.data.current?.task as Task) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const overId = over.id as string;
    const isValidColumn = (MAIN_COLUMNS as string[]).includes(overId) || (EXTRA_COLUMNS as string[]).includes(overId);
    const targetColumn = isValidColumn ? (overId as TaskStatus) : tasks.find((t) => t.id === overId)?.status;
    if (!targetColumn) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetColumn) return;
    moveTask(taskId, targetColumn).catch((err) => {
      console.error('Move failed:', err);
      alert(`Cannot move task: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });
  };

  const handleCreateOrEdit = async (data: { title: string; description: string; spec: string; riskLevel: RiskLevel; priority: number }) => {
    if (editingTask) {
      await updateTask(editingTask.id, data);
    } else {
      await createTask(data);
    }
    setEditingTask(undefined);
    onCloseNewTask?.();
  };

  const toggleSelect = (taskId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const bulkMove = async (column: TaskStatus) => {
    for (const id of selectedIds) {
      try { await moveTask(id, column); } catch (err) { console.error(`Bulk move failed for ${id}:`, err); }
    }
    setSelectedIds(new Set());
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} selected tasks?`)) return;
    for (const id of selectedIds) {
      try { await deleteTask(id); } catch (err) { console.error(`Bulk delete failed for ${id}:`, err); }
    }
    setSelectedIds(new Set());
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="flex gap-2.5 overflow-x-auto pb-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonColumn key={i} />)}
        </div>
      </div>
    );
  }

  const isEmpty = topLevelTasks.length === 0;
  if (isEmpty) {
    return (
      <>
        <EmptyBoard onNewTask={onCloseNewTask ? () => onCloseNewTask() : undefined} />
        {(editingTask !== undefined || showNewTask) && (
          <TaskForm
            initial={editingTask}
            onSubmit={handleCreateOrEdit}
            onCancel={() => { setEditingTask(undefined); onCloseNewTask?.(); }}
          />
        )}
      </>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="p-4">
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="mb-3 flex items-center gap-2 bg-bg-elevated rounded-lg px-3 py-2 text-[13px] border border-border-default animate-fade-in">
            <span className="font-semibold text-accent-blue">{selectedIds.size} selected</span>
            <select
              onChange={(e) => { if (e.target.value) { bulkMove(e.target.value as TaskStatus); e.target.value = ''; } }}
              className="rounded-md px-2 py-1 text-xs bg-bg-tertiary border border-border-default text-text-primary"
              defaultValue=""
            >
              <option value="" disabled>Move to...</option>
              {MOVABLE_COLUMNS.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
            <button onClick={() => bulkMove('cancelled')} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors">Cancel</button>
            <button onClick={bulkDelete} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors">Delete</button>
            <button onClick={() => setSelectedIds(new Set())} className="px-2.5 py-1 rounded-md text-xs border border-border-default text-text-secondary hover:text-text-primary transition-colors">Clear</button>
          </div>
        )}

        {/* No results from filter */}
        {hasActiveFilters && filteredTasks.length === 0 && (
          <div className="text-center py-12 animate-fade-in">
            <svg className="w-10 h-10 text-text-tertiary mx-auto mb-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-text-secondary">No tasks match your filters</p>
          </div>
        )}

        {/* Main columns */}
        <div className="flex gap-2.5 overflow-x-auto pb-3">
          {MAIN_COLUMNS.map((status) => (
            <Column key={status} status={status} tasks={tasksByStatus(status)} onTaskClick={(t) => setSelectedTaskId(t.id)}
              subtasksByParent={subtasksByParent}
              selectedIds={selectedIds} onToggleSelect={toggleSelect}
              collapsed={collapsedColumns.has(status)} onToggleCollapse={() => toggleColumn(status)} />
          ))}
        </div>

        {/* Extra columns */}
        <div className="flex gap-2.5 mt-2.5">
          {EXTRA_COLUMNS.map((status) => {
            const colTasks = tasksByStatus(status);
            if (colTasks.length === 0) return null;
            return (
              <Column key={status} status={status} tasks={colTasks} onTaskClick={(t) => setSelectedTaskId(t.id)}
                subtasksByParent={subtasksByParent}
                selectedIds={selectedIds} onToggleSelect={toggleSelect}
                collapsed={collapsedColumns.has(status)} onToggleCollapse={() => toggleColumn(status)} />
            );
          })}
        </div>
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="rotate-[3deg] opacity-90">
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>

      {selectedTask && (
        <TaskDetail task={selectedTask} onClose={() => setSelectedTaskId(null)} onUpdate={updateTask}
          onAnswer={answerTask} onRetry={retryTask} onDelete={deleteTask} onMove={moveTask}
          onEdit={(t) => { setSelectedTaskId(null); setEditingTask(t); }} />
      )}

      {(editingTask !== undefined || showNewTask) && (
        <TaskForm
          initial={editingTask}
          onSubmit={handleCreateOrEdit}
          onCancel={() => { setEditingTask(undefined); onCloseNewTask?.(); }}
        />
      )}
    </DndContext>
  );
};
