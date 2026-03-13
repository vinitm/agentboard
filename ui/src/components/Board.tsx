import React, { useState } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Column } from './Column';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';
import { TaskForm } from './TaskForm';
import type { Task, TaskStatus, RiskLevel } from '../types';

const MAIN_COLUMNS: TaskStatus[] = [
  'backlog', 'ready', 'planning', 'implementing', 'checks',
  'review_spec', 'review_code', 'needs_human_review', 'done',
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
}

export const Board: React.FC<Props> = ({
  tasks, loading, createTask, updateTask, moveTask, deleteTask, answerTask, retryTask,
  showNewTask, onCloseNewTask,
}) => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null | undefined>(undefined);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Subtask filtering
  const subtasksByParent = new Map<string, Task[]>();
  const topLevelTasks = tasks.filter((t) => {
    if (t.parentTaskId) {
      const existing = subtasksByParent.get(t.parentTaskId) || [];
      existing.push(t);
      subtasksByParent.set(t.parentTaskId, existing);
      return false;
    }
    return true;
  });

  const tasksByStatus = (status: TaskStatus) => topLevelTasks.filter((t) => t.status === status);

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
    return <div className="flex justify-center p-10 text-text-secondary">Loading tasks...</div>;
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="p-4">
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="mb-3 flex items-center gap-2 bg-bg-elevated rounded-lg px-3 py-2 text-[13px]">
            <span className="font-semibold text-accent-blue">{selectedIds.size} selected</span>
            <select
              onChange={(e) => { if (e.target.value) { bulkMove(e.target.value as TaskStatus); e.target.value = ''; } }}
              className="rounded px-2 py-1 text-xs bg-bg-tertiary border border-border-default text-text-primary"
              defaultValue=""
            >
              <option value="" disabled>Move to...</option>
              {MOVABLE_COLUMNS.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
            <button onClick={() => bulkMove('cancelled')} className="px-2.5 py-1 rounded text-xs font-semibold bg-accent-amber text-white">Cancel</button>
            <button onClick={bulkDelete} className="px-2.5 py-1 rounded text-xs font-semibold bg-accent-red text-white">Delete</button>
            <button onClick={() => setSelectedIds(new Set())} className="px-2.5 py-1 rounded text-xs border border-border-default text-text-secondary">Clear</button>
          </div>
        )}

        {/* Main columns */}
        <div className="flex gap-2.5 overflow-x-auto pb-3">
          {MAIN_COLUMNS.map((status) => (
            <Column key={status} status={status} tasks={tasksByStatus(status)} onTaskClick={(t) => setSelectedTaskId(t.id)}
              subtasksByParent={subtasksByParent} onSubtaskClick={(t) => setSelectedTaskId(t.id)}
              selectedIds={selectedIds} onToggleSelect={toggleSelect} />
          ))}
        </div>

        {/* Extra columns */}
        <div className="flex gap-2.5 mt-2.5">
          {EXTRA_COLUMNS.map((status) => {
            const colTasks = tasksByStatus(status);
            if (colTasks.length === 0) return null;
            return (
              <Column key={status} status={status} tasks={colTasks} onTaskClick={(t) => setSelectedTaskId(t.id)}
                subtasksByParent={subtasksByParent} onSubtaskClick={(t) => setSelectedTaskId(t.id)}
                selectedIds={selectedIds} onToggleSelect={toggleSelect} />
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
