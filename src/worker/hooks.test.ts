import { describe, it, expect, vi } from 'vitest';
import { createHooks, runHook, type HookContext } from './hooks.js';
import { createTestConfig } from '../test/helpers.js';
import type { Task } from '../types/index.js';

function makeContext(): HookContext {
  const task: Task = {
    id: 'task-1',
    projectId: 'proj-1',
    parentTaskId: null,
    title: 'Test Task',
    description: 'A test task',
    status: 'implementing',
    riskLevel: 'low',
    priority: 0,
    columnPosition: 0,
    spec: null,
    blockedReason: null,
    claimedAt: null,
    claimedBy: null,
    chatSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    task,
    stage: 'implementing',
    worktreePath: '/tmp/worktree',
    config: createTestConfig(),
  };
}

describe('createHooks', () => {
  it('returns hooks with all empty arrays', () => {
    const hooks = createHooks();
    expect(hooks.beforeStage).toEqual([]);
    expect(hooks.afterStage).toEqual([]);
    expect(hooks.onError).toEqual([]);
    expect(hooks.onTaskComplete).toEqual([]);
  });
});

describe('runHook', () => {
  it('runs all hooks sequentially in registration order', async () => {
    const hooks = createHooks();
    const order: number[] = [];

    hooks.beforeStage.push(async () => { order.push(1); });
    hooks.beforeStage.push(async () => { order.push(2); });
    hooks.beforeStage.push(async () => { order.push(3); });

    await runHook(hooks, 'beforeStage', makeContext());
    expect(order).toEqual([1, 2, 3]);
  });

  it('handles empty hook list without throwing', async () => {
    const hooks = createHooks();
    await expect(runHook(hooks, 'afterStage', makeContext())).resolves.not.toThrow();
  });

  it('onError hooks fire when registered', async () => {
    const hooks = createHooks();
    const errorSpy = vi.fn();

    hooks.onError.push(async (ctx) => {
      errorSpy(ctx.task.id);
    });

    const ctx = makeContext();
    await runHook(hooks, 'onError', ctx);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith('task-1');
  });
});
