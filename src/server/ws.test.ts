import { describe, it, expect, vi } from 'vitest';
import type { Server } from 'socket.io';
import { broadcast, broadcastLog, broadcastStageTransition } from './ws.js';

describe('broadcast', () => {
  it('emits event to all clients via io.emit', () => {
    const io = { emit: vi.fn() } as unknown as Server;

    broadcast(io, 'task:created', { id: 'abc', title: 'Test Task' });

    expect(io.emit).toHaveBeenCalledTimes(1);
    expect(io.emit).toHaveBeenCalledWith('task:created', { id: 'abc', title: 'Test Task' });
  });

  it('emits any event type with any data', () => {
    const io = { emit: vi.fn() } as unknown as Server;

    broadcast(io, 'custom:event', { foo: 'bar', count: 42 });

    expect(io.emit).toHaveBeenCalledWith('custom:event', { foo: 'bar', count: 42 });
  });

  it('can emit with null/undefined data', () => {
    const io = { emit: vi.fn() } as unknown as Server;

    broadcast(io, 'task:deleted', null);

    expect(io.emit).toHaveBeenCalledWith('task:deleted', null);
  });
});

describe('broadcastLog', () => {
  it('emits run:log event with the provided data', () => {
    const io = { emit: vi.fn() } as unknown as Server;
    const logData = {
      taskId: 123,
      runId: 'run-456',
      chunk: 'some output chunk',
      timestamp: '2024-01-01T00:00:00.000Z',
    };

    broadcastLog(io, logData);

    expect(io.emit).toHaveBeenCalledTimes(1);
    expect(io.emit).toHaveBeenCalledWith('run:log', logData);
  });

  it('always uses run:log as the event name', () => {
    const io = { emit: vi.fn() } as unknown as Server;

    broadcastLog(io, {
      taskId: 1,
      runId: 'r1',
      chunk: 'hello',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    const [eventName] = (io.emit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(eventName).toBe('run:log');
  });

  it('includes optional stage when provided', () => {
    const io = { emit: vi.fn() } as unknown as Server;
    const logData = {
      taskId: 123,
      runId: 'run-456',
      stage: 'implementing',
      chunk: 'implementing feature',
      timestamp: '2024-01-01T00:00:00.000Z',
    };

    broadcastLog(io, logData);

    expect(io.emit).toHaveBeenCalledWith('run:log', logData);
  });

  it('omits stage when not provided', () => {
    const io = { emit: vi.fn() } as unknown as Server;
    const logData = {
      taskId: 123,
      runId: 'run-456',
      chunk: 'some output',
      timestamp: '2024-01-01T00:00:00.000Z',
    };

    broadcastLog(io, logData);

    const [, emittedData] = (io.emit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(emittedData.stage).toBeUndefined();
  });
});

describe('broadcastStageTransition', () => {
  it('emits stage:transition event with the provided data', () => {
    const io = { emit: vi.fn() } as unknown as Server;
    const transitionData = {
      taskId: 123,
      stage: 'implementing' as const,
      status: 'running' as const,
      summary: 'Starting implementation',
    };

    broadcastStageTransition(io, transitionData);

    expect(io.emit).toHaveBeenCalledTimes(1);
    expect(io.emit).toHaveBeenCalledWith('stage:transition', transitionData);
  });

  it('always uses stage:transition as the event name', () => {
    const io = { emit: vi.fn() } as unknown as Server;

    broadcastStageTransition(io, {
      taskId: 1,
      stage: 'planning' as const,
      status: 'running' as const,
    });

    const [eventName] = (io.emit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(eventName).toBe('stage:transition');
  });
});
