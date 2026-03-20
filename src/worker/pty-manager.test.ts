import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Mock node-pty via the createRequire path.
// Since the module uses `createRequire(import.meta.url)('node-pty')`,
// we mock the actual 'node-pty' module which vitest resolves for us.
// ---------------------------------------------------------------------------

interface MockPty {
  pid: number;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
}

let mockSpawnFn: ReturnType<typeof vi.fn>;
let lastMockPty: MockPty;
let pidCounter = 1000;

function createMockPty(): MockPty {
  pidCounter++;
  const pty: MockPty = {
    pid: pidCounter,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
  };
  lastMockPty = pty;
  return pty;
}

// We need to mock createRequire so that esmRequire('node-pty') returns our mock.
// Stable proxy object whose `spawn` always delegates to the current mockSpawnFn.
// This avoids issues with node-pty module caching inside getPty().
const nodePtyProxy = {
  get spawn() {
    return mockSpawnFn;
  },
};

vi.mock('node:module', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:module')>();
  return {
    ...original,
    createRequire: (...args: Parameters<typeof original.createRequire>) => {
      const realRequire = original.createRequire(...args);
      return (id: string) => {
        if (id === 'node-pty') {
          return nodePtyProxy;
        }
        return realRequire(id);
      };
    },
  };
});

import { createPtyManager, isPtyAvailable } from './pty-manager.js';
import type { PtyManager, PtyHandle } from './pty-manager.js';

beforeEach(() => {
  vi.clearAllMocks();
  pidCounter = 1000;
  mockSpawnFn = vi.fn(() => createMockPty());
});

describe('isPtyAvailable', () => {
  it('returns true when node-pty loads successfully', () => {
    expect(isPtyAvailable()).toBe(true);
  });
});

describe('PtyManager', () => {
  let manager: PtyManager;

  beforeEach(() => {
    manager = createPtyManager({ maxConcurrentPtys: 3 });
  });

  describe('spawn', () => {
    it('returns a handle with the correct pid and stageLogId', () => {
      const handle = manager.spawn(42, { command: 'claude', args: ['--print'] });
      expect(handle.pid).toBe(1001);
      expect(handle.stageLogId).toBe(42);
      expect(handle.createdAt).toBeInstanceOf(Date);
    });

    it('passes correct options to node-pty spawn', () => {
      manager.spawn(1, {
        command: 'claude',
        args: ['--print'],
        cwd: '/tmp/work',
        env: { MY_VAR: 'hello' },
        cols: 200,
        rows: 50,
      });

      expect(mockSpawnFn).toHaveBeenCalledWith(
        'claude',
        ['--print'],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 200,
          rows: 50,
          cwd: '/tmp/work',
          env: expect.objectContaining({
            FORCE_COLOR: '1',
            MY_VAR: 'hello',
          }),
        }),
      );
    });

    it('sets FORCE_COLOR=1 on all spawned processes', () => {
      manager.spawn(1, { command: 'claude' });

      const callEnv = mockSpawnFn.mock.calls[0][2].env;
      expect(callEnv.FORCE_COLOR).toBe('1');
    });

    it('uses xterm-256color as terminal name', () => {
      manager.spawn(1, { command: 'claude' });

      expect(mockSpawnFn.mock.calls[0][2].name).toBe('xterm-256color');
    });

    it('throws when concurrency limit is reached', () => {
      manager.spawn(1, { command: 'claude' });
      manager.spawn(2, { command: 'claude' });
      manager.spawn(3, { command: 'claude' });

      expect(() => manager.spawn(4, { command: 'claude' }))
        .toThrowError(/concurrency limit reached/i);
    });

    it('throws when stageLogId already has an active pty', () => {
      manager.spawn(1, { command: 'claude' });

      expect(() => manager.spawn(1, { command: 'claude' }))
        .toThrowError(/already exists/i);
    });

    it('increments activeCount on spawn', () => {
      expect(manager.activeCount()).toBe(0);
      manager.spawn(1, { command: 'claude' });
      expect(manager.activeCount()).toBe(1);
      manager.spawn(2, { command: 'claude' });
      expect(manager.activeCount()).toBe(2);
    });
  });

  describe('early data buffering', () => {
    it('buffers data emitted before onData is registered, then flushes', () => {
      const handle = manager.spawn(1, { command: 'claude' });

      // Simulate data arriving before consumer registers callback.
      // The internal onData handler was registered via lastMockPty.onData.
      const internalHandler = lastMockPty.onData.mock.calls[0][0] as (data: string) => void;
      internalHandler('early-line-1\n');
      internalHandler('early-line-2\n');

      // Now consumer registers.
      const received: string[] = [];
      handle.onData((data) => received.push(data));

      // Buffered data should have been flushed.
      expect(received).toEqual(['early-line-1\nearly-line-2\n']);

      // Subsequent data goes directly.
      internalHandler('late-line\n');
      expect(received).toEqual(['early-line-1\nearly-line-2\n', 'late-line\n']);
    });
  });

  describe('onExit', () => {
    it('fires exit callback when pty exits', () => {
      const handle = manager.spawn(1, { command: 'claude' });
      const exitHandler = lastMockPty.onExit.mock.calls[0][0] as (e: { exitCode: number; signal?: number }) => void;

      const exits: Array<{ code: number; signal?: number }> = [];
      handle.onExit((code, signal) => exits.push({ code, signal }));

      exitHandler({ exitCode: 0 });
      expect(exits).toEqual([{ code: 0, signal: undefined }]);
    });

    it('fires immediately if process already exited before registration', () => {
      const handle = manager.spawn(1, { command: 'claude' });
      const exitHandler = lastMockPty.onExit.mock.calls[0][0] as (e: { exitCode: number; signal?: number }) => void;

      // Process exits before onExit is registered.
      exitHandler({ exitCode: 1, signal: 15 });

      const exits: Array<{ code: number; signal?: number }> = [];
      handle.onExit((code, signal) => exits.push({ code, signal }));

      expect(exits).toEqual([{ code: 1, signal: 15 }]);
    });
  });

  describe('write / kill / resize', () => {
    it('write delegates to pty.write', () => {
      const handle = manager.spawn(1, { command: 'claude' });
      handle.write('hello\n');
      expect(lastMockPty.write).toHaveBeenCalledWith('hello\n');
    });

    it('kill delegates to pty.kill', () => {
      const handle = manager.spawn(1, { command: 'claude' });
      handle.kill('SIGTERM');
      expect(lastMockPty.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('resize delegates to pty.resize', () => {
      const handle = manager.spawn(1, { command: 'claude' });
      handle.resize(200, 50);
      expect(lastMockPty.resize).toHaveBeenCalledWith(200, 50);
    });
  });

  describe('getHandle', () => {
    it('returns the handle for an active stageLogId', () => {
      const handle = manager.spawn(1, { command: 'claude' });
      expect(manager.getHandle(1)).toBe(handle);
    });

    it('returns undefined for unknown stageLogId', () => {
      expect(manager.getHandle(999)).toBeUndefined();
    });
  });

  describe('kill', () => {
    it('kills a pty and removes it from tracking', () => {
      manager.spawn(1, { command: 'claude' });
      expect(manager.activeCount()).toBe(1);

      const killed = manager.kill(1);
      expect(killed).toBe(true);
      expect(manager.activeCount()).toBe(0);
      expect(manager.getHandle(1)).toBeUndefined();
    });

    it('returns false for unknown stageLogId', () => {
      expect(manager.kill(999)).toBe(false);
    });
  });

  describe('killAll', () => {
    it('kills all active ptys and clears tracking', () => {
      manager.spawn(1, { command: 'claude' });
      manager.spawn(2, { command: 'claude' });
      manager.spawn(3, { command: 'claude' });
      expect(manager.activeCount()).toBe(3);

      manager.killAll();
      expect(manager.activeCount()).toBe(0);
    });
  });

  describe('killOrphans', () => {
    it('kills ptys whose pid is not in the known set', () => {
      const h1 = manager.spawn(1, { command: 'claude' });
      const h2 = manager.spawn(2, { command: 'claude' });
      const h3 = manager.spawn(3, { command: 'claude' });

      // Keep only h2's pid as "known"
      const killed = manager.killOrphans([h2.pid]);
      expect(killed).toBe(2);
      expect(manager.activeCount()).toBe(1);
      expect(manager.getHandle(2)).toBe(h2);
    });

    it('returns 0 when all pids are known', () => {
      const h1 = manager.spawn(1, { command: 'claude' });
      expect(manager.killOrphans([h1.pid])).toBe(0);
      expect(manager.activeCount()).toBe(1);
    });
  });

  describe('auto-remove on exit', () => {
    it('removes handle from tracking when pty exits', () => {
      manager.spawn(1, { command: 'claude' });
      expect(manager.activeCount()).toBe(1);

      // Trigger exit via the internal onExit handler.
      const exitHandler = lastMockPty.onExit.mock.calls[0][0] as (e: { exitCode: number; signal?: number }) => void;
      exitHandler({ exitCode: 0 });

      expect(manager.activeCount()).toBe(0);
      expect(manager.getHandle(1)).toBeUndefined();
    });

    it('allows spawning new pty for same stageLogId after exit', () => {
      manager.spawn(1, { command: 'claude' });
      const exitHandler = lastMockPty.onExit.mock.calls[0][0] as (e: { exitCode: number; signal?: number }) => void;
      exitHandler({ exitCode: 0 });

      // Should not throw — slot is freed.
      const handle2 = manager.spawn(1, { command: 'claude' });
      expect(handle2.stageLogId).toBe(1);
      expect(manager.activeCount()).toBe(1);
    });
  });
});
