import React, { useState } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Column } from './Column';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';
import { TaskForm } from './TaskForm';
import type { Task, TaskStatus, RiskLevel } from '../types';

const MAIN_COLUMNS: TaskStatus[] = [
  'backlog',
  'ready',
  'planning',
  'implementing',
  'checks',
  'review_spec',
  'review_code',
  'needs_human_review',
  'done',
];

const EXTRA_COLUMNS: TaskStatus[] = ['blocked', 'failed', 'cancelled'];

const MOVABLE_COLUMNS: TaskStatus[] = ['backlog', 'ready', 'cancelled', 'done'];

interface Props {
  tasks: Task[];
  loading: boolean;
  createTask: (data: {
    title: string;
    description?: string;
    spec?: string;
    riskLevel?: RiskLevel;
    priority?: number;
  }) => Promise<Task>;
  updateTask: (id: string, data: Partial<Task>) => Promise<Task>;
  moveTask: (id: string, column: TaskStatus) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  answerTask: (id: string, answers: string) => Promise<Task>;
  retryTask: (id: string) => Promise<Task>;
}

export const Board: React.FC<Props> = ({
  tasks,
  loading,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  answerTask,
  retryTask,
}) => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null | undefined>(undefined); // undefined = closed, null = new
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const tasksByStatus = (status: TaskStatus) =>
    tasks.filter((t) => t.status === status);

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    setActiveTask(task ?? null);
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

  const handleCreateOrEdit = async (data: {
    title: string;
    description: string;
    spec: string;
    riskLevel: RiskLevel;
    priority: number;
  }) => {
    if (editingTask) {
      await updateTask(editingTask.id, data);
    } else {
      await createTask(data);
    }
    setEditingTask(undefined);
  };

  // -- Bulk operations --
  const toggleSelect = (taskId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const bulkMove = async (column: TaskStatus) => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      try {
        await moveTask(id, column);
      } catch (err) {
        console.error(`Bulk move failed for ${id}:`, err);
      }
    }
    setSelectedIds(new Set());
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.size} selected tasks?`)) return;
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      try {
        await deleteTask(id);
      } catch (err) {
        console.error(`Bulk delete failed for ${id}:`, err);
      }
    }
    setSelectedIds(new Set());
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40, color: '#9ca3af' }}>
        Loading tasks...
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setEditingTask(null)}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              background: '#3b82f6',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            + New Task
          </button>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: '#eff6ff',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600, color: '#3b82f6' }}>
                {selectedIds.size} selected
              </span>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    bulkMove(e.target.value as TaskStatus);
                    e.target.value = '';
                  }
                }}
                style={{
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  padding: '4px 8px',
                  fontSize: 12,
                }}
                defaultValue=""
              >
                <option value="" disabled>Move to...</option>
                {MOVABLE_COLUMNS.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              <button
                onClick={() => bulkMove('cancelled')}
                style={{
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 10px',
                  background: '#f59e0b',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                style={{
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 10px',
                  background: '#ef4444',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                style={{
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  padding: '4px 10px',
                  background: '#fff',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Main columns */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 12,
          }}
        >
          {MAIN_COLUMNS.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={tasksByStatus(status)}
              onTaskClick={(t) => setSelectedTaskId(t.id)}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>

        {/* Extra columns (blocked/failed/cancelled) */}
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          {EXTRA_COLUMNS.map((status) => {
            const colTasks = tasksByStatus(status);
            if (colTasks.length === 0) return null;
            return (
              <Column
                key={status}
                status={status}
                tasks={colTasks}
                onTaskClick={(t) => setSelectedTaskId(t.id)}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            );
          })}
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeTask ? (
          <div style={{ transform: 'rotate(3deg)', opacity: 0.9 }}>
            <TaskCard task={activeTask} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>

      {/* Task detail modal */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={updateTask}
          onAnswer={answerTask}
          onRetry={retryTask}
          onDelete={deleteTask}
          onMove={moveTask}
          onEdit={(t) => {
            setSelectedTaskId(null);
            setEditingTask(t);
          }}
        />
      )}

      {/* Task form modal */}
      {editingTask !== undefined && (
        <TaskForm
          initial={editingTask}
          onSubmit={handleCreateOrEdit}
          onCancel={() => setEditingTask(undefined)}
        />
      )}
    </DndContext>
  );
};
