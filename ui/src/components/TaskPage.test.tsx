import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TaskPage } from './TaskPage';
import type { Task, Run } from '../types';

// Mock socket.io-client to prevent any actual connection attempts
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    connected: false,
    disconnect: vi.fn(),
    io: { on: vi.fn(), off: vi.fn() },
  })),
}));

// Mock socket hook
vi.mock('../hooks/useSocket', () => ({
  useSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    connected: false,
    io: { on: vi.fn(), off: vi.fn() },
  })),
  useConnectionStatus: vi.fn(() => 'connected'),
}));

// Mock api client
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDel = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
    del: (...args: unknown[]) => mockApiDel(...args),
    getStages: vi.fn().mockResolvedValue({ stages: [] }),
    getStageLogContent: vi.fn().mockResolvedValue(''),
  },
}));

const baseTask: Task = {
  id: 99,
  projectId: 'proj-1',
  title: 'Test Task Title',
  description: 'A test task',
  status: 'implementing',
  riskLevel: 'low',
  priority: 0,
  spec: null,
  blockedReason: null,
  blockedAtStage: null,
  claimedAt: null,
  claimedBy: null,
  chatSessionId: null,
  createdAt: '2026-03-19T10:00:00Z',
  updatedAt: '2026-03-19T10:00:00Z',
};

const emptyRuns: Run[] = [];
const emptyEvents: never[] = [];

function setupDefaultMocks(task: Task = baseTask, runs: Run[] = emptyRuns) {
  mockApiGet.mockImplementation((path: string) => {
    if (path.includes('/api/tasks/') && !path.includes('/runs') && !path.includes('/events') && !path.includes('/stages') && !path.includes('/delete-impact') && !path.includes('/chat') && !path.includes('/git-refs') && !path.includes('/costs')) {
      return Promise.resolve(task);
    }
    if (path.includes('/api/runs')) {
      return Promise.resolve(runs);
    }
    if (path.includes('/api/events')) {
      return Promise.resolve(emptyEvents);
    }
    if (path.includes('/stages')) {
      return Promise.resolve({ stages: [] });
    }
    return Promise.resolve([]);
  });
}

function renderTaskPage(taskId = '99') {
  return render(
    <MemoryRouter initialEntries={[`/tasks/${taskId}`]}>
      <Routes>
        <Route path="/tasks/:id" element={<TaskPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TaskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders task title after loading', async () => {
    setupDefaultMocks();
    renderTaskPage();
    await waitFor(() => {
      expect(screen.getByText('Test Task Title')).toBeTruthy();
    });
  });

  it('renders PipelineBar with showLabels (stage label text visible)', async () => {
    setupDefaultMocks();
    renderTaskPage();
    await waitFor(() => {
      // PipelineBar with showLabels renders abbreviated stage labels
      expect(screen.getByText('Spec')).toBeTruthy();
      expect(screen.getByText('Plan')).toBeTruthy();
    });
  });

  it('"Tasks" breadcrumb link present', async () => {
    setupDefaultMocks();
    renderTaskPage();
    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeTruthy();
    });
  });

  it('shows plan review panel when status is needs_plan_review', async () => {
    const planningRun: Run = {
      id: 'run-1',
      taskId: 99,
      stage: 'planning',
      status: 'success',
      attempt: 1,
      tokensUsed: null,
      modelUsed: null,
      input: null,
      output: JSON.stringify({
        planSummary: 'A plan',
        steps: [{ title: 'Step 1', description: 'Do something' }],
        assumptions: [],
        fileHints: [],
      }),
      startedAt: '2026-03-19T10:00:00Z',
      finishedAt: '2026-03-19T10:01:00Z',
    };
    setupDefaultMocks({ ...baseTask, status: 'needs_plan_review' }, [planningRun]);
    renderTaskPage();
    await waitFor(() => {
      // PlanReviewPanel renders approve/reject buttons
      expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy();
    });
  });

  it('shows blocked panel when status is blocked', async () => {
    setupDefaultMocks({
      ...baseTask,
      status: 'blocked',
      blockedReason: 'Need access to the production database',
    });
    renderTaskPage();
    await waitFor(() => {
      // BlockedPanel renders a "Submit Answer" button when task is blocked
      expect(screen.getByRole('button', { name: /submit answer/i })).toBeTruthy();
    });
  });

  it('retry button shown when status is failed', async () => {
    setupDefaultMocks({ ...baseTask, status: 'failed' });
    renderTaskPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    });
  });

  it('no approve/reject action panels when status is implementing', async () => {
    setupDefaultMocks({ ...baseTask, status: 'implementing' });
    renderTaskPage();
    await waitFor(() => {
      expect(screen.getByText('Test Task Title')).toBeTruthy();
    });
    // No plan review or PR review buttons
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve pr/i })).toBeNull();
  });

  it('shows error state when task API call fails', async () => {
    mockApiGet.mockRejectedValue(new Error('Task not found'));
    renderTaskPage();
    await waitFor(() => {
      expect(screen.getByText(/task not found/i)).toBeTruthy();
    });
  });

  it('stages tab section present in DOM', async () => {
    setupDefaultMocks();
    renderTaskPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stages/i })).toBeTruthy();
    });
  });

  it('events tab section present in DOM', async () => {
    setupDefaultMocks();
    renderTaskPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /events/i })).toBeTruthy();
    });
  });
});
