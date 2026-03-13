import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useSocket } from './useSocket';
import type { Task, TaskStatus, RiskLevel } from '../types';

export function useTasks(projectId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const socket = useSocket();

  // Fetch tasks on mount / projectId change
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .get<Task[]>(`/api/tasks?projectId=${projectId}`)
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  // Listen for WebSocket events
  useEffect(() => {
    if (!socket) return;

    const onCreated = (task: Task) => {
      if (task.projectId === projectId) {
        setTasks((prev) =>
          prev.some((t) => t.id === task.id) ? prev : [...prev, task],
        );
      }
    };

    const onUpdated = (task: Task) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    };

    const onMoved = (task: Task) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    };

    const onDeleted = ({ id }: { id: string }) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    };

    socket.on('task:created', onCreated);
    socket.on('task:updated', onUpdated);
    socket.on('task:moved', onMoved);
    socket.on('task:deleted', onDeleted);

    return () => {
      socket.off('task:created', onCreated);
      socket.off('task:updated', onUpdated);
      socket.off('task:moved', onMoved);
      socket.off('task:deleted', onDeleted);
    };
  }, [socket, projectId]);

  const createTask = useCallback(
    async (data: {
      title: string;
      description?: string;
      spec?: string;
      riskLevel?: RiskLevel;
      priority?: number;
    }) => {
      const task = await api.post<Task>('/api/tasks', { ...data, projectId });
      setTasks((prev) =>
        prev.some((t) => t.id === task.id) ? prev : [...prev, task],
      );
      return task;
    },
    [projectId],
  );

  const updateTask = useCallback(
    async (
      id: string,
      data: Partial<Pick<Task, 'title' | 'description' | 'spec' | 'riskLevel' | 'priority' | 'columnPosition'>>,
    ) => {
      const updated = await api.put<Task>(`/api/tasks/${id}`, data);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [],
  );

  const moveTask = useCallback(async (id: string, column: TaskStatus) => {
    const moved = await api.post<Task>(`/api/tasks/${id}/move`, { column });
    setTasks((prev) => prev.map((t) => (t.id === id ? moved : t)));
    return moved;
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await api.del(`/api/tasks/${id}`);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const answerTask = useCallback(async (id: string, answers: string) => {
    const answered = await api.post<Task>(`/api/tasks/${id}/answer`, { answers });
    setTasks((prev) => prev.map((t) => (t.id === id ? answered : t)));
    return answered;
  }, []);

  const retryTask = useCallback(async (id: string) => {
    const retried = await api.post<Task>(`/api/tasks/${id}/retry`);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...retried, status: retried.status ?? 'ready' } : t)));
    return retried;
  }, []);

  return {
    tasks,
    loading,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    answerTask,
    retryTask,
  };
}
