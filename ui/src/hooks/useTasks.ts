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
        setTasks((prev) => [...prev, task]);
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
      return task;
    },
    [projectId],
  );

  const updateTask = useCallback(
    async (
      id: string,
      data: Partial<Pick<Task, 'title' | 'description' | 'spec' | 'riskLevel' | 'priority' | 'columnPosition'>>,
    ) => {
      return api.put<Task>(`/api/tasks/${id}`, data);
    },
    [],
  );

  const moveTask = useCallback(async (id: string, column: TaskStatus) => {
    return api.post<Task>(`/api/tasks/${id}/move`, { column });
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    return api.del(`/api/tasks/${id}`);
  }, []);

  const answerTask = useCallback(async (id: string, answers: string) => {
    return api.post<Task>(`/api/tasks/${id}/answer`, { answers });
  }, []);

  const retryTask = useCallback(async (id: string) => {
    return api.post<Task>(`/api/tasks/${id}/retry`);
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
