import type { StageLog } from '../types';

const BASE_URL = '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    const message = err.error || res.statusText;
    if (onApiError && res.status >= 500) {
      onApiError(message, res.status);
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

type ApiErrorHandler = (error: string, status: number) => void;
let onApiError: ApiErrorHandler | null = null;

export function setApiErrorHandler(handler: ApiErrorHandler) {
  onApiError = handler;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>('GET', path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('POST', path, body);
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PUT', path, body);
  },
  del(path: string): Promise<void> {
    return request<void>('DELETE', path);
  },
  getStages(taskId: number) {
    return request<{ stages: StageLog[] }>('GET', `/api/tasks/${taskId}/stages`);
  },
  getStageLogContent(taskId: number, stageLogId: string): Promise<string> {
    return fetch(`/api/tasks/${taskId}/stages/${stageLogId}/logs`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch log content');
        return res.text();
      });
  },
};
