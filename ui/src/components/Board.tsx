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

const EXTRA_COLUMNS: TaskStatus[] = ['blocked', 'failed'];

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
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null | undefined>(undefined); // undefined = closed, null = new
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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
    const targetColumn = over.id as TaskStatus;
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
        <div style={{ marginBottom: 12 }}>
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
              onTaskClick={setSelectedTask}
            />
          ))}
        </div>

        {/* Extra columns (blocked/failed) */}
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          {EXTRA_COLUMNS.map((status) => {
            const colTasks = tasksByStatus(status);
            if (colTasks.length === 0) return null;
            return (
              <Column
                key={status}
                status={status}
                tasks={colTasks}
                onTaskClick={setSelectedTask}
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
          onClose={() => setSelectedTask(null)}
          onUpdate={updateTask}
          onAnswer={answerTask}
          onRetry={retryTask}
          onDelete={deleteTask}
          onEdit={(t) => {
            setSelectedTask(null);
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
