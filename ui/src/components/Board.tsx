import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Column } from './Column';
import { TaskCard } from './TaskCard';
import { TaskForm } from './TaskForm';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toast';
import type { Task, TaskStatus, RiskLevel, PlanReviewAction } from '../types';
import type { FilterState } from './TopBar';

// Pipeline phases for visual grouping
const QUEUE_COLUMNS: TaskStatus[] = ['backlog', 'ready'];
const PIPELINE_COLUMNS: TaskStatus[] = ['spec_review', 'planning', 'needs_plan_review', 'implementing', 'checks', 'code_quality', 'final_review', 'pr_creation'];
const REVIEW_COLUMNS: TaskStatus[] = ['needs_human_review', 'done'];
const MAIN_COLUMNS: TaskStatus[] = [...QUEUE_COLUMNS, ...PIPELINE_COLUMNS, ...REVIEW_COLUMNS];

const EXTRA_COLUMNS: TaskStatus[] = ['blocked', 'failed', 'cancelled'];
const MOVABLE_COLUMNS: TaskStatus[] = ['backlog', 'ready', 'cancelled', 'done'];

interface Props {
  tasks: Task[];
  loading: boolean;
  projectId: string;
  createTask: (data: { title: string; description?: string; spec?: string; riskLevel?: RiskLevel; priority?: number }) => Promise<Task>;
  updateTask: (id: number, data: Partial<Task>) => Promise<Task>;
  moveTask: (id: number, column: TaskStatus) => Promise<Task>;
  deleteTask: (id: number) => Promise<void>;
  answerTask: (id: number, answers: string) => Promise<Task>;
  retryTask: (id: number) => Promise<Task>;
  reviewPlan: (id: number, action: PlanReviewAction) => Promise<Task>;
  showNewTask?: boolean;
  onOpenNewTask?: () => void;
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
  tasks, loading, projectId, createTask, updateTask, moveTask, deleteTask, answerTask, retryTask, reviewPlan,
  showNewTask, onOpenNewTask, onCloseNewTask, filters,
}) => {
  const navigate = useNavigate();
  const [editingTask, setEditingTask] = useState<Task | null | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [collapsedColumns, setCollapsedColumns] = useState<Set<TaskStatus>>(() => {
    try {
      const saved = localStorage.getItem('agentboard:collapsed-columns');
      return saved ? new Set(JSON.parse(saved) as TaskStatus[]) : new Set();
    } catch { return new Set(); }
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Subtask filtering
  const { topLevelTasks, subtasksByParent } = useMemo(() => {
    const byParent = new Map<number, Task[]>();
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
      try { localStorage.setItem('agentboard:collapsed-columns', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Auto-collapse empty pipeline columns (one-time on mount if no saved state)
  useEffect(() => {
    if (localStorage.getItem('agentboard:collapsed-columns')) return; // respect saved prefs
    const emptyPipeline = PIPELINE_COLUMNS.filter((status) => !filteredTasks.some((t) => t.status === status));
    if (emptyPipeline.length > 0) {
      setCollapsedColumns(new Set(emptyPipeline));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTask((event.active.data.current?.task as Task) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as number;
    const overId = over.id;
    const overIdStr = String(overId);
    const isValidColumn = (MAIN_COLUMNS as string[]).includes(overIdStr) || (EXTRA_COLUMNS as string[]).includes(overIdStr);
    const targetColumn = isValidColumn ? (overIdStr as TaskStatus) : tasks.find((t) => t.id === overId)?.status;
    if (!targetColumn) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === targetColumn) return;
    moveTask(taskId, targetColumn).catch((err) => {
      console.error('Move failed:', err);
      toast(`Cannot move task: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    });
  };

  const handleCreateOrEdit = async (data: { title: string; description: string; spec: string; riskLevel: RiskLevel; priority: number; existingTaskId?: number }) => {
    if (editingTask) {
      // Editing via the edit button — just update
      await updateTask(editingTask.id, data);
    } else if (data.existingTaskId) {
      // Task was already created during chat — update it and move to ready
      const { existingTaskId, ...updateData } = data;
      await updateTask(existingTaskId, updateData);
      await moveTask(existingTaskId, 'ready');
    } else {
      await createTask(data);
    }
    setEditingTask(undefined);
    onCloseNewTask?.();
  };

  const toggleSelect = (taskId: number, event: React.MouseEvent) => {
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
    for (const id of selectedIds) {
      try { await deleteTask(id); } catch (err) { console.error(`Bulk delete failed for ${id}:`, err); }
    }
    setSelectedIds(new Set());
    setConfirmDelete(false);
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
        <EmptyBoard onNewTask={onOpenNewTask} />
        {(editingTask !== undefined || showNewTask) && (
          <TaskForm
            initial={editingTask}
            projectId={projectId}
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
              value=""
              onChange={(e) => { if (e.target.value) { bulkMove(e.target.value as TaskStatus); } }}
              className="rounded-md px-2 py-1 text-xs bg-bg-tertiary border border-border-default text-text-primary"
            >
              <option value="" disabled>Move to...</option>
              {MOVABLE_COLUMNS.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
            <button onClick={() => bulkMove('cancelled')} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-accent-amber text-white hover:bg-amber-600 transition-colors">Cancel</button>
            <button onClick={() => setConfirmDelete(true)} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-accent-red text-white hover:bg-red-600 transition-colors">Delete</button>
            <button onClick={() => setSelectedIds(new Set())} className="px-2.5 py-1 rounded-md text-xs border border-border-default text-text-secondary hover:text-text-primary transition-colors">Clear</button>
          </div>
        )}

        {/* KPI Summary Bar */}
        {!hasActiveFilters && (
          <div className="flex items-center gap-4 mb-3 px-1 text-[11px] text-text-tertiary" role="status" aria-live="polite">
            {(() => {
              const running = filteredTasks.filter(t => t.claimedBy).length;
              const blocked = filteredTasks.filter(t => t.status === 'blocked').length;
              const needsReview = filteredTasks.filter(t => t.status === 'needs_human_review' || t.status === 'needs_plan_review').length;
              const done = filteredTasks.filter(t => t.status === 'done').length;
              return (
                <>
                  {running > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-pulse-dot" />{running} running</span>}
                  {blocked > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />{blocked} blocked</span>}
                  {needsReview > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent-pink" />{needsReview} needs review</span>}
                  {done > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent-green" />{done} done</span>}
                </>
              );
            })()}
          </div>
        )}

        {/* No results from filter */}
        {hasActiveFilters && filteredTasks.length === 0 && (
          <div className="text-center py-12 animate-fade-in">
            <svg className="w-10 h-10 text-text-tertiary mx-auto mb-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-text-secondary">No tasks match your filters</p>
          </div>
        )}

        {/* Main columns with phase grouping */}
        <div className="flex gap-2.5 overflow-x-auto pb-3 board-scroll-container">
          {/* Queue phase */}
          {QUEUE_COLUMNS.map((status) => (
            <Column key={status} status={status} tasks={tasksByStatus(status)} onTaskClick={(t) => navigate(`/tasks/${t.id}`)}
              subtasksByParent={subtasksByParent}
              selectedIds={selectedIds} onToggleSelect={toggleSelect}
              collapsed={collapsedColumns.has(status)} onToggleCollapse={() => toggleColumn(status)} />
          ))}

          {/* Phase separator */}
          <div className="w-px bg-border-default flex-shrink-0 my-2 opacity-50" />

          {/* Autonomous pipeline phase */}
          {PIPELINE_COLUMNS.map((status) => (
            <Column key={status} status={status} tasks={tasksByStatus(status)} onTaskClick={(t) => navigate(`/tasks/${t.id}`)}
              subtasksByParent={subtasksByParent}
              selectedIds={selectedIds} onToggleSelect={toggleSelect}
              collapsed={collapsedColumns.has(status)} onToggleCollapse={() => toggleColumn(status)} />
          ))}

          {/* Phase separator */}
          <div className="w-px bg-border-default flex-shrink-0 my-2 opacity-50" />

          {/* Review + done phase */}
          {REVIEW_COLUMNS.map((status) => (
            <Column key={status} status={status} tasks={tasksByStatus(status)} onTaskClick={(t) => navigate(`/tasks/${t.id}`)}
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
              <Column key={status} status={status} tasks={colTasks} onTaskClick={(t) => navigate(`/tasks/${t.id}`)}
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

      {(editingTask !== undefined || showNewTask) && (
        <TaskForm
          initial={editingTask}
          projectId={projectId}
          onSubmit={handleCreateOrEdit}
          onCancel={() => { setEditingTask(undefined); onCloseNewTask?.(); }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete selected tasks?"
        description={`This will permanently delete ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={bulkDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </DndContext>
  );
};
