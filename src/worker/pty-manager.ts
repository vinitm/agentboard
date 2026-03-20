import { createRequire } from 'node:module';
import type { IPty } from 'node-pty';

const esmRequire = createRequire(import.meta.url);

/** Lazily resolved node-pty module. Cached after first successful load. */
let nodePtyModule: typeof import('node-pty') | undefined;

/**
 * Lazily load node-pty via createRequire (CJS interop for ESM).
 * Throws if node-pty is not installed.
 */
function getPty(): typeof import('node-pty') {
  if (!nodePtyModule) {
    nodePtyModule = esmRequire('node-pty') as typeof import('node-pty');
  }
  return nodePtyModule;
}

/**
 * Returns true if node-pty is installed and loadable.
 */
export function isPtyAvailable(): boolean {
  try {
    getPty();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PtyHandle — wrapper around a single IPty process
// ---------------------------------------------------------------------------

type DataCallback = (data: string) => void;
type ExitCallback = (exitCode: number, signal?: number) => void;

export interface PtyHandle {
  /** The underlying node-pty process. */
  readonly pty: IPty;
  /** OS process id. */
  readonly pid: number;
  /** Stage log id that owns this pty. */
  readonly stageLogId: number;
  /** Timestamp when the pty was spawned. */
  readonly createdAt: Date;

  /**
   * Register a data callback. Any data buffered before this call is flushed
   * immediately, then subsequent data goes directly to the callback.
   */
  onData(cb: DataCallback): void;

  /**
   * Register an exit callback. If the process already exited before this
   * call, the callback fires synchronously with the cached exit info.
   */
  onExit(cb: ExitCallback): void;

  /** Write data to the pty stdin. */
  write(data: string): void;

  /** Send a signal to kill the pty process. */
  kill(signal?: string): void;

  /** Resize the pty terminal. */
  resize(cols: number, rows: number): void;
}

interface BufferedPtyHandle extends PtyHandle {
  /** Internal — marks handle as disposed so callbacks are ignored after kill. */
  _disposed: boolean;
}

function createHandle(pty: IPty, stageLogId: number): BufferedPtyHandle {
  // Early-data buffer: accumulates output until the consumer registers onData.
  let dataBuffer: string[] = [];
  let dataCallback: DataCallback | null = null;
  let exitCallback: ExitCallback | null = null;
  let cachedExit: { exitCode: number; signal?: number } | null = null;

  const handle: BufferedPtyHandle = {
    pty,
    pid: pty.pid,
    stageLogId,
    createdAt: new Date(),
    _disposed: false,

    onData(cb: DataCallback) {
      dataCallback = cb;
      // Flush buffered data
      if (dataBuffer.length > 0) {
        const flushed = dataBuffer.join('');
        dataBuffer = [];
        cb(flushed);
      }
    },

    onExit(cb: ExitCallback) {
      exitCallback = cb;
      // If already exited, fire immediately
      if (cachedExit !== null) {
        cb(cachedExit.exitCode, cachedExit.signal);
      }
    },

    write(data: string) {
      pty.write(data);
    },

    kill(signal?: string) {
      handle._disposed = true;
      pty.kill(signal);
    },

    resize(cols: number, rows: number) {
      pty.resize(cols, rows);
    },
  };

  // Register internal data handler immediately to capture startup output.
  pty.onData((data: string) => {
    if (handle._disposed) return;
    if (dataCallback) {
      dataCallback(data);
    } else {
      dataBuffer.push(data);
    }
  });

  pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    cachedExit = { exitCode, signal };
    if (exitCallback) {
      exitCallback(exitCode, signal);
    }
  });

  return handle;
}

// ---------------------------------------------------------------------------
// PtyManager — lifecycle manager for concurrent pty processes
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  /** Command to run (e.g. 'claude'). */
  command: string;
  /** Arguments for the command. */
  args?: string[];
  /** Working directory. */
  cwd?: string;
  /** Extra environment variables (merged with process.env). */
  env?: Record<string, string>;
  /** Terminal columns. Default 120. */
  cols?: number;
  /** Terminal rows. Default 40. */
  rows?: number;
}

export interface PtyManager {
  /** Spawn a new pty process tied to a stageLogId. */
  spawn(stageLogId: number, options: SpawnOptions): PtyHandle;
  /** Get an existing handle by stageLogId. */
  getHandle(stageLogId: number): PtyHandle | undefined;
  /** Kill a pty by stageLogId. Returns true if found and killed. */
  kill(stageLogId: number): boolean;
  /** Kill all active ptys. */
  killAll(): void;
  /** Number of currently active ptys. */
  activeCount(): number;
  /**
   * Kill any pty whose pid is NOT in the given set of known-good pids.
   * Returns the number of orphans killed.
   */
  killOrphans(knownPids: number[]): number;
}

export interface PtyManagerOptions {
  /** Maximum number of concurrent pty processes. Default 4. */
  maxConcurrentPtys?: number;
}

/**
 * Create a PtyManager instance.
 */
export function createPtyManager(options: PtyManagerOptions = {}): PtyManager {
  const maxConcurrent = options.maxConcurrentPtys ?? 4;
  const handles = new Map<number, BufferedPtyHandle>();

  return {
    spawn(stageLogId: number, spawnOpts: SpawnOptions): PtyHandle {
      if (handles.size >= maxConcurrent) {
        throw new Error(
          `PTY concurrency limit reached (${maxConcurrent}). ` +
          `Cannot spawn pty for stageLogId ${stageLogId}.`
        );
      }

      if (handles.has(stageLogId)) {
        throw new Error(`PTY already exists for stageLogId ${stageLogId}.`);
      }

      const nodePty = getPty();
      const {
        command,
        args = [],
        cwd = process.cwd(),
        env = {},
        cols = 120,
        rows = 40,
      } = spawnOpts;

      const ptyProcess = nodePty.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, FORCE_COLOR: '1', ...env },
      });

      const handle = createHandle(ptyProcess, stageLogId);

      handles.set(stageLogId, handle);

      // Auto-remove from map on exit.
      handle.onExit(() => {
        handles.delete(stageLogId);
      });

      console.log(`[pty-manager] Spawned pty pid=${handle.pid} for stageLogId=${stageLogId}`);
      return handle;
    },

    getHandle(stageLogId: number): PtyHandle | undefined {
      return handles.get(stageLogId);
    },

    kill(stageLogId: number): boolean {
      const handle = handles.get(stageLogId);
      if (!handle) return false;

      console.log(`[pty-manager] Killing pty pid=${handle.pid} for stageLogId=${stageLogId}`);
      handle.kill();
      handles.delete(stageLogId);
      return true;
    },

    killAll(): void {
      for (const [stageLogId, handle] of handles) {
        console.log(`[pty-manager] Killing pty pid=${handle.pid} for stageLogId=${stageLogId}`);
        handle.kill();
      }
      handles.clear();
    },

    activeCount(): number {
      return handles.size;
    },

    killOrphans(knownPids: number[]): number {
      const knownSet = new Set(knownPids);
      let killed = 0;

      for (const [stageLogId, handle] of handles) {
        if (!knownSet.has(handle.pid)) {
          console.log(`[pty-manager] Killing orphan pty pid=${handle.pid} stageLogId=${stageLogId}`);
          handle.kill();
          handles.delete(stageLogId);
          killed++;
        }
      }

      return killed;
    },
  };
}
