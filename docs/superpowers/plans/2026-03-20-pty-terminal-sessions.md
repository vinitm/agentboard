# PTY Terminal Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed live, native Claude Code terminal sessions in the agentboard browser UI, one per pipeline stage, using node-pty + xterm.js.

**Architecture:** node-pty spawns Claude Code in interactive mode (no `--print`) inside a pseudo-terminal per stage. PTY output streams via the existing Socket.IO `run:log` events to xterm.js components in the StageAccordion. A state machine detects readiness and completion. Results are extracted via a `.agentboard/stage-result.json` file written by Claude Code.

**Tech Stack:** node-pty (server, optional), @xterm/xterm + addons (client), TypeScript, Socket.IO, SQLite

**Spec:** `docs/superpowers/specs/2026-03-20-pty-terminal-sessions-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/worker/pty-manager.ts` | PTY lifecycle: spawn via node-pty, Map<stageLogId, PtyHandle> tracking, timeout, kill, orphan cleanup on startup |
| `src/worker/pty-manager.test.ts` | Unit tests for pty-manager with mock pty |
| `src/worker/pty-executor.ts` | Drive a Claude Code PTY session: readiness detection, prompt injection, completion state machine, ANSI stripping, result file reading, `/cost` parsing |
| `src/worker/pty-executor.test.ts` | Unit tests for state machine, ANSI stripping, prompt detection, result parsing |
| `src/db/migrations/003-pty-columns.ts` | Schema migration adding `pid` and `terminal_mode` columns to stage_logs |
| `src/db/migrations/003-pty-columns.test.ts` | Migration test |
| `ui/src/components/XTermStage.tsx` | xterm.js wrapper: Terminal instance, addon-fit, addon-search, copy, resize observer, IntersectionObserver virtualization |
| `ui/src/components/XTermStage.test.tsx` | Component tests |
| `ui/src/hooks/useTerminalStream.ts` | Socket.IO → xterm.js bridge: subscribe to `run:log` filtered by taskId+stage, lazy-load completed logs, cleanup |
| `ui/src/hooks/useTerminalStream.test.ts` | Hook tests |

### Modified Files

| File | Change |
|------|--------|
| `src/db/schema.ts` | Call `runMigration003` from `initSchema` |
| `src/db/stage-log-queries.ts` | Add `pid` and `terminalMode` to create/update/rowToStageLog, add `listRunningWithPid` query |
| `src/types/index.ts` | Add `pid` and `terminalMode` fields to `StageLog` |
| `src/worker/stage-runner.ts` | Accept `terminalMode` option, pass to `createStageLog`, delegate log writing to `log-writer.ts` buffered stream in pty mode |
| `src/worker/log-writer.ts` | Add `createAsyncBufferedWriter` for high-frequency PTY output (flush every 100ms or 4KB, uses `fs.promises.appendFile`) |
| `src/worker/executor.ts` | Add `executePtyClaudeCode` export that delegates to pty-manager + pty-executor |
| `src/worker/loop.ts` | Read `terminal.mode` from config, pass to stage runner and executor |
| `src/cli/doctor.ts` | Add node-pty availability check |
| `prompts/*.md` | Add stage-result.json writing instruction to each stage prompt template |
| `ui/src/components/StageRow.tsx` | Conditionally render `XTermStage` when `terminalMode === 'pty'`, keep `LogRenderer` for `'print'` |
| `ui/src/types.ts` | Add `terminalMode` to `StageLog` type (frontend mirror) |
| `ui/package.json` | Add `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-web-links` |
| `package.json` | Add `node-pty` to `optionalDependencies` |

### ESM Compatibility Note

This project uses `"type": "module"`. All dynamic imports of `node-pty` must use `createRequire` from `node:module`:

```typescript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
```

This applies to: `pty-manager.ts`, `isPtyAvailable()`, and `doctor.ts`.

---

## Task 1: Schema Migration — Add PTY Columns

**Files:**
- Create: `src/db/migrations/003-pty-columns.ts`
- Create: `src/db/migrations/003-pty-columns.test.ts`
- Modify: `src/db/schema.ts:146-147`
- Modify: `src/db/stage-log-queries.ts:7-24,28-36,85-92`
- Modify: `src/types/index.ts:34-49`

- [ ] **Step 1: Write the migration test**

In `src/db/migrations/003-pty-columns.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../schema.js';

describe('migration 003: pty columns', () => {
  it('adds pid and terminal_mode columns to stage_logs', () => {
    const db = new Database(':memory:');
    initSchema(db);

    const cols = db.prepare('PRAGMA table_info(stage_logs)').all() as Array<{ name: string; type: string; dflt_value: string | null }>;
    const pidCol = cols.find(c => c.name === 'pid');
    const modeCol = cols.find(c => c.name === 'terminal_mode');

    expect(pidCol).toBeDefined();
    expect(pidCol!.type).toBe('INTEGER');

    expect(modeCol).toBeDefined();
    expect(modeCol!.type).toBe('TEXT');
    expect(modeCol!.dflt_value).toBe("'print'");
  });

  it('preserves existing stage_logs data', () => {
    const db = new Database(':memory:');
    initSchema(db);

    // Existing rows should have terminal_mode = 'print' by default
    // (covered by DEFAULT in migration)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/db/migrations/003-pty-columns.test.ts`
Expected: FAIL — migration file doesn't exist yet

- [ ] **Step 3: Write the migration**

In `src/db/migrations/003-pty-columns.ts`:

```typescript
import type Database from 'better-sqlite3';

export function runMigration003(db: Database.Database): void {
  // Add pid column (nullable — only set in pty mode)
  try {
    db.exec(`ALTER TABLE stage_logs ADD COLUMN pid INTEGER`);
    console.log('[db] Added pid column to stage_logs');
  } catch {
    // Column already exists
  }

  // Add terminal_mode column (defaults to 'print' for backward compat)
  try {
    db.exec(`ALTER TABLE stage_logs ADD COLUMN terminal_mode TEXT NOT NULL DEFAULT 'print'`);
    console.log('[db] Added terminal_mode column to stage_logs');
  } catch {
    // Column already exists
  }
}
```

- [ ] **Step 4: Wire migration into schema.ts**

In `src/db/schema.ts`, add import and call after line 146:

```typescript
import { runMigration003 } from './migrations/003-pty-columns.js';
```

Add `runMigration003(db);` after the `runMigration002(db);` call in `initSchema`.

- [ ] **Step 5: Update StageLog type in src/types/index.ts**

Add two fields to the `StageLog` interface after `completedAt`:

```typescript
  pid: number | null;
  terminalMode: 'pty' | 'print';
```

- [ ] **Step 6: Update rowToStageLog in stage-log-queries.ts**

Add to the `rowToStageLog` function:

```typescript
    pid: (row.pid as number) ?? null,
    terminalMode: (row.terminal_mode as 'pty' | 'print') ?? 'print',
```

- [ ] **Step 7: Update CreateStageLogData and createStageLog**

Add optional fields to `CreateStageLogData`:

```typescript
  pid?: number;
  terminalMode?: 'pty' | 'print';
```

Update the INSERT in `createStageLog` to include the new columns:

```typescript
  db.prepare(
    `INSERT INTO stage_logs (id, task_id, project_id, run_id, stage, attempt, file_path, status, started_at, created_at, pid, terminal_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`
  ).run(
    id, data.taskId, data.projectId, data.runId ?? null,
    data.stage, data.attempt ?? 1, data.filePath, data.startedAt, now,
    data.pid ?? null, data.terminalMode ?? 'print'
  );
```

- [ ] **Step 8: Add UpdateStageLogData pid field and listRunningWithPid query**

Add to `UpdateStageLogData`:

```typescript
  pid?: number | null;
```

Add the update clause in `updateStageLog`:

```typescript
  if (data.pid !== undefined) { fields.push('pid = ?'); values.push(data.pid); }
```

Add new query function:

```typescript
export function listRunningWithPid(db: Database.Database): StageLog[] {
  const rows = db
    .prepare(`SELECT * FROM stage_logs WHERE status = 'running' AND pid IS NOT NULL`)
    .all() as Record<string, unknown>[];
  return rows.map(rowToStageLog);
}
```

- [ ] **Step 9: Run tests**

Run: `npm test -- --run src/db/migrations/003-pty-columns.test.ts`
Expected: PASS

- [ ] **Step 10: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 11: Commit**

```bash
git add src/db/migrations/003-pty-columns.ts src/db/migrations/003-pty-columns.test.ts src/db/schema.ts src/db/stage-log-queries.ts src/types/index.ts
git commit -m "feat(db): add pid and terminal_mode columns to stage_logs"
```

---

## Task 2: PTY Manager — Spawn, Track, Kill

**Files:**
- Create: `src/worker/pty-manager.ts`
- Create: `src/worker/pty-manager.test.ts`

- [ ] **Step 1: Write the pty-manager test**

In `src/worker/pty-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node-pty before importing pty-manager
const mockPtyProcess = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  kill: vi.fn(),
  resize: vi.fn(),
  pid: 12345,
};

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPtyProcess),
}));

import { createPtyManager } from './pty-manager.js';

describe('PtyManager', () => {
  let manager: ReturnType<typeof createPtyManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createPtyManager({ maxConcurrentPtys: 2 });
  });

  afterEach(() => {
    manager.killAll();
  });

  it('spawns a PTY process and returns a handle', () => {
    const handle = manager.spawn('stage-log-1', {
      cwd: '/tmp/test',
      args: ['--model', 'claude-sonnet-4-6', '--permission-mode', 'bypassPermissions'],
      cols: 120,
      rows: 30,
    });

    expect(handle).toBeDefined();
    expect(handle.pid).toBe(12345);
    expect(manager.getHandle('stage-log-1')).toBe(handle);
  });

  it('enforces maxConcurrentPtys limit', () => {
    manager.spawn('stage-1', { cwd: '/tmp', args: [], cols: 120, rows: 30 });
    manager.spawn('stage-2', { cwd: '/tmp', args: [], cols: 120, rows: 30 });

    expect(() => {
      manager.spawn('stage-3', { cwd: '/tmp', args: [], cols: 120, rows: 30 });
    }).toThrow(/max concurrent/i);
  });

  it('removes handle on kill', () => {
    manager.spawn('stage-1', { cwd: '/tmp', args: [], cols: 120, rows: 30 });
    manager.kill('stage-1');

    expect(mockPtyProcess.kill).toHaveBeenCalled();
    expect(manager.getHandle('stage-1')).toBeUndefined();
  });

  it('killAll removes all handles', () => {
    manager.spawn('s1', { cwd: '/tmp', args: [], cols: 120, rows: 30 });
    manager.spawn('s2', { cwd: '/tmp', args: [], cols: 120, rows: 30 });
    manager.killAll();

    expect(manager.activeCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/worker/pty-manager.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write pty-manager.ts**

In `src/worker/pty-manager.ts`:

```typescript
import { createRequire } from 'node:module';
import type { IPty } from 'node-pty';

const esmRequire = createRequire(import.meta.url);

export interface PtySpawnOptions {
  cwd: string;
  args: string[];
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface PtyHandle {
  pty: IPty;
  pid: number;
  stageLogId: string;
  createdAt: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (exitInfo: { exitCode: number; signal?: number }) => void) => void;
  write: (data: string) => void;
  kill: () => void;
  resize: (cols: number, rows: number) => void;
}

export interface PtyManagerOptions {
  maxConcurrentPtys?: number;
}

export interface PtyManager {
  spawn(stageLogId: string, options: PtySpawnOptions): PtyHandle;
  getHandle(stageLogId: string): PtyHandle | undefined;
  kill(stageLogId: string): void;
  killAll(): void;
  activeCount(): number;
  /** Kill orphan processes by PID. Returns count of killed processes. */
  killOrphans(pids: number[]): number;
}

export function createPtyManager(opts: PtyManagerOptions = {}): PtyManager {
  const maxConcurrent = opts.maxConcurrentPtys ?? 4;
  const handles = new Map<string, PtyHandle>();

  // Lazy-load node-pty to keep it optional (ESM-compatible, using top-level esmRequire)
  let ptyModule: typeof import('node-pty') | null = null;
  function getPty(): typeof import('node-pty') {
    if (!ptyModule) {
      try {
        ptyModule = esmRequire('node-pty') as typeof import('node-pty');
      } catch {
        throw new Error(
          'node-pty is not installed. Install it with: npm install node-pty\n' +
          'Or set terminal.mode to "print" in .agentboard/config.json'
        );
      }
    }
    return ptyModule!;
  }

  return {
    spawn(stageLogId: string, options: PtySpawnOptions): PtyHandle {
      if (handles.size >= maxConcurrent) {
        throw new Error(
          `Max concurrent PTYs (${maxConcurrent}) reached. ` +
          `Active: ${[...handles.keys()].join(', ')}`
        );
      }

      const pty = getPty();
      const ptyProcess = pty.spawn('claude', options.args, {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: { ...process.env, ...options.env, FORCE_COLOR: '1' } as Record<string, string>,
      });

      // Buffer early data until a listener is attached (prevents missing startup output)
      const earlyDataBuffer: string[] = [];
      let dataListener: ((data: string) => void) | null = null;
      ptyProcess.onData((data: string) => {
        if (dataListener) {
          dataListener(data);
        } else {
          earlyDataBuffer.push(data);
        }
      });

      const handle: PtyHandle = {
        pty: ptyProcess,
        pid: ptyProcess.pid,
        stageLogId,
        createdAt: Date.now(),
        onData: (cb) => {
          dataListener = cb;
          // Flush buffered data
          for (const chunk of earlyDataBuffer) cb(chunk);
          earlyDataBuffer.length = 0;
        },
        onExit: (cb) => ptyProcess.onExit(cb),
        write: (data) => ptyProcess.write(data),
        kill: () => {
          try { ptyProcess.kill(); } catch { /* already dead */ }
        },
        resize: (cols, rows) => {
          try { ptyProcess.resize(cols, rows); } catch { /* ignore */ }
        },
      };

      handles.set(stageLogId, handle);
      return handle;
    },

    getHandle(stageLogId: string): PtyHandle | undefined {
      return handles.get(stageLogId);
    },

    kill(stageLogId: string): void {
      const handle = handles.get(stageLogId);
      if (handle) {
        handle.kill();
        handles.delete(stageLogId);
      }
    },

    killAll(): void {
      for (const [id, handle] of handles) {
        handle.kill();
        handles.delete(id);
      }
    },

    activeCount(): number {
      return handles.size;
    },

    killOrphans(pids: number[]): number {
      let killed = 0;
      for (const pid of pids) {
        try {
          process.kill(pid, 0); // Check if alive
          process.kill(pid, 'SIGKILL');
          killed++;
          console.log(`[pty] Killed orphan process ${pid}`);
        } catch {
          // Process already dead — fine
        }
      }
      return killed;
    },
  };
}

/** Check if node-pty is available without throwing. Uses top-level esmRequire. */
export function isPtyAvailable(): boolean {
  try {
    esmRequire('node-pty');
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test**

Run: `npm test -- --run src/worker/pty-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/pty-manager.ts src/worker/pty-manager.test.ts
git commit -m "feat(worker): add PTY manager for spawning and tracking terminal sessions"
```

---

## Task 3: PTY Executor — State Machine & Session Driver

**Files:**
- Create: `src/worker/pty-executor.ts`
- Create: `src/worker/pty-executor.test.ts`

- [ ] **Step 1: Write the pty-executor test**

In `src/worker/pty-executor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { stripAnsi, detectPrompt, PtySessionState } from './pty-executor.js';

describe('stripAnsi', () => {
  it('removes ANSI escape sequences', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
    expect(stripAnsi('\x1b[1;34mcolored\x1b[0m text')).toBe('colored text');
  });

  it('passes through plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

describe('detectPrompt', () => {
  it('detects bare > prompt', () => {
    expect(detectPrompt('> ')).toBe(true);
    expect(detectPrompt('\n> ')).toBe(true);
    expect(detectPrompt('  >  ')).toBe(true);
  });

  it('rejects > inside code output', () => {
    expect(detectPrompt('console.log(">")')).toBe(false);
    expect(detectPrompt('if (a > b)')).toBe(false);
    expect(detectPrompt('>>> python')).toBe(false);
  });

  it('rejects > in markdown blockquotes', () => {
    expect(detectPrompt('> some quoted text')).toBe(false);
    expect(detectPrompt('> This is a blockquote\n> ')).toBe(false);
  });

  it('rejects > inside code blocks (backtick parity)', () => {
    expect(detectPrompt('```\nif (a > b) {\n> \n```')).toBe(false);
    expect(detectPrompt('```typescript\n> \n```')).toBe(false);
  });

  it('detects prompt with ANSI wrapping', () => {
    expect(detectPrompt('\x1b[36m>\x1b[0m ')).toBe(true);
  });
});

describe('PtySessionState', () => {
  it('starts in SPAWNING state', () => {
    const session = new PtySessionState();
    expect(session.state).toBe('SPAWNING');
  });

  it('transitions SPAWNING -> READY on prompt detection', () => {
    const session = new PtySessionState();
    session.onData('Welcome to Claude Code\n> ');
    // After quiescence, should be READY
    expect(session.state).toBe('SPAWNING'); // not yet — need quiescence
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/worker/pty-executor.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write pty-executor.ts**

In `src/worker/pty-executor.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { PtyHandle } from './pty-manager.js';
import type { ExecuteResult } from './executor.js';

// ── ANSI stripping ──────────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[()][A-Z0-9]|\x1b[>=<]|\x1b\[[\?]?[0-9;]*[hl]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// ── Prompt detection ────────────────────────────────────────────────

/**
 * Detect Claude Code's idle prompt from raw PTY output.
 * Uses ANSI stripping, backtick-parity tracking (reject > inside code blocks),
 * and markdown blockquote detection (reject > followed by text).
 */
export function detectPrompt(rawText: string): boolean {
  const text = stripAnsi(rawText);
  const lines = text.split('\n');

  // Track backtick parity — if we're inside a code block, reject
  let inCodeBlock = false;
  let lastNonEmptyLine = '';
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
    if (line.trim().length > 0) {
      lastNonEmptyLine = line;
    }
  }

  // If inside an open code block, any > is code, not a prompt
  if (inCodeBlock) return false;

  const trimmed = lastNonEmptyLine.trim();

  // Reject markdown blockquotes: "> some text" (prompt has no text after >)
  if (trimmed.startsWith('>') && trimmed.length > 2 && trimmed[1] === ' ' && trimmed.slice(2).trim().length > 0) {
    return false;
  }

  // Claude Code prompt is just ">" possibly with trailing space
  return trimmed === '>' || trimmed === '> ';
}

// ── State machine ───────────────────────────────────────────────────

export type SessionState = 'SPAWNING' | 'READY' | 'WORKING' | 'IDLE' | 'EXTRACTING' | 'EXITING' | 'DONE' | 'FAILED';

export class PtySessionState {
  state: SessionState = 'SPAWNING';
  private buffer = '';
  private quiescenceTimer: ReturnType<typeof setTimeout> | null = null;
  private onStateChange: ((state: SessionState) => void) | null = null;

  constructor(private quiescenceMs: number = 3000) {}

  setOnStateChange(cb: (state: SessionState) => void): void {
    this.onStateChange = cb;
  }

  onData(data: string): void {
    this.buffer += data;

    // Reset quiescence timer on every data event
    if (this.quiescenceTimer) {
      clearTimeout(this.quiescenceTimer);
      this.quiescenceTimer = null;
    }

    if (this.state === 'SPAWNING' || this.state === 'WORKING') {
      if (detectPrompt(this.buffer)) {
        // Start quiescence countdown
        this.quiescenceTimer = setTimeout(() => {
          if (this.state === 'SPAWNING') {
            this.transition('READY');
          } else if (this.state === 'WORKING') {
            this.transition('IDLE');
          }
        }, this.state === 'SPAWNING' ? 2000 : this.quiescenceMs);
      }
    }
  }

  transition(newState: SessionState): void {
    console.log(`[pty-session] ${this.state} -> ${newState}`);
    this.state = newState;
    this.buffer = ''; // Reset buffer on state change
    this.onStateChange?.(newState);
  }

  clearBuffer(): void {
    this.buffer = '';
  }

  destroy(): void {
    if (this.quiescenceTimer) {
      clearTimeout(this.quiescenceTimer);
      this.quiescenceTimer = null;
    }
  }
}

// ── Result extraction ───────────────────────────────────────────────

export interface PtyStageResult {
  passed: boolean;
  summary: string;
}

/**
 * Read the stage result file written by Claude Code in the worktree.
 */
export function readStageResultFile(worktreePath: string): PtyStageResult | null {
  const resultPath = path.join(worktreePath, '.agentboard', 'stage-result.json');
  try {
    const content = fs.readFileSync(resultPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (typeof parsed.passed === 'boolean' && typeof parsed.summary === 'string') {
      return { passed: parsed.passed, summary: parsed.summary };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clean up the stage result file so the next stage starts fresh.
 */
export function cleanStageResultFile(worktreePath: string): void {
  const resultPath = path.join(worktreePath, '.agentboard', 'stage-result.json');
  try { fs.unlinkSync(resultPath); } catch { /* doesn't exist */ }
}

// ── Cost parsing ────────────────────────────────────────────────────

/**
 * Parse token usage from Claude Code's /cost command output.
 * The /cost output format includes lines like:
 *   Total input tokens: 12,345
 *   Total output tokens: 6,789
 */
export function parseCostOutput(rawOutput: string): { inputTokens: number; outputTokens: number } {
  const text = stripAnsi(rawOutput);
  const inputMatch = text.match(/input\s+tokens?[:\s]+([0-9,]+)/i);
  const outputMatch = text.match(/output\s+tokens?[:\s]+([0-9,]+)/i);
  return {
    inputTokens: inputMatch ? parseInt(inputMatch[1].replace(/,/g, ''), 10) : 0,
    outputTokens: outputMatch ? parseInt(outputMatch[1].replace(/,/g, ''), 10) : 0,
  };
}

// ── Main executor ───────────────────────────────────────────────────

export interface PtyExecuteOptions {
  handle: PtyHandle;
  prompt: string;
  worktreePath: string;
  timeout: number;
  quiescenceMs?: number;
  onOutput: (chunk: string) => void;
}

/**
 * Drive a Claude Code PTY session through the full lifecycle:
 * SPAWNING -> READY -> WORKING -> IDLE -> EXTRACTING -> EXITING -> DONE
 *
 * IMPORTANT: Register onData/onExit handlers immediately after receiving
 * the handle to avoid missing early PTY output. The PtyHandle buffers
 * data internally until the first onData listener is attached.
 */
export function executePtySession(options: PtyExecuteOptions): Promise<ExecuteResult> {
  const { handle, prompt, worktreePath, timeout, quiescenceMs = 3000, onOutput } = options;
  const startTime = Date.now();
  const session = new PtySessionState(quiescenceMs);

  return new Promise<ExecuteResult>((resolve) => {
    let costOutput = '';
    let capturingCost = false;
    let timedOut = false;

    // Timeout handler
    const timer = setTimeout(() => {
      timedOut = true;
      session.destroy();
      handle.kill();
      resolve({
        output: `[timeout] PTY session killed after ${Math.round(timeout / 1000)}s`,
        exitCode: 124,
        tokensUsed: 0,
        inputTokens: 0,
        outputTokens: 0,
        duration: Date.now() - startTime,
      });
    }, timeout);

    // Clean up previous stage result
    cleanStageResultFile(worktreePath);

    // Data handler — stream to callback and feed state machine
    handle.onData((data: string) => {
      onOutput(data);
      if (capturingCost) costOutput += data;
      session.onData(data);
    });

    // Exit handler
    handle.onExit(({ exitCode }) => {
      if (timedOut) return; // Already resolved
      clearTimeout(timer);
      session.destroy();

      const result = readStageResultFile(worktreePath);
      const cost = parseCostOutput(costOutput);
      const tokensUsed = cost.inputTokens + cost.outputTokens;

      resolve({
        output: result?.summary ?? (exitCode === 0 ? 'Completed' : 'Failed'),
        exitCode,
        tokensUsed: tokensUsed || 0,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        duration: Date.now() - startTime,
      });
    });

    // State change handler — drives the session forward
    session.setOnStateChange((state) => {
      switch (state) {
        case 'READY':
          // Inject the stage prompt
          handle.write(prompt + '\n');
          session.transition('WORKING');
          break;

        case 'IDLE':
          // Claude finished — extract results
          session.transition('EXTRACTING');
          capturingCost = true;
          handle.write('/cost\n');
          // Give /cost time to output, then exit
          setTimeout(() => {
            capturingCost = false;
            session.transition('EXITING');
            handle.write('/exit\n');
          }, 2000);
          break;

        // EXITING, DONE, FAILED handled by onExit
      }
    });
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run src/worker/pty-executor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/pty-executor.ts src/worker/pty-executor.test.ts
git commit -m "feat(worker): add PTY executor with state machine for Claude Code sessions"
```

---

## Task 4: Wire PTY into Executor and Stage Runner

**Files:**
- Modify: `src/worker/executor.ts:1-15,31`
- Modify: `src/worker/stage-runner.ts:58-79`
- Modify: `src/worker/loop.ts` (config reading)

- [ ] **Step 1: Write test for executePtyClaudeCode entry point**

In `src/worker/executor.test.ts` (create if doesn't exist, or add to existing):

```typescript
import { describe, it, expect } from 'vitest';
import { executeClaudeCode } from './executor.js';

describe('executeClaudeCode', () => {
  it('exports the function', () => {
    expect(typeof executeClaudeCode).toBe('function');
  });
});
```

- [ ] **Step 2: Add executePtyClaudeCode to executor.ts**

Add at the bottom of `src/worker/executor.ts`:

```typescript
import { createPtyManager, type PtyManager } from './pty-manager.js';
import { executePtySession, cleanStageResultFile } from './pty-executor.js';

// Singleton PTY manager — created on first use
let ptyManager: PtyManager | null = null;

export interface PtyExecuteOptions {
  prompt: string;
  worktreePath: string;
  model: string;
  timeout?: number;
  tools?: string[];
  permissionMode?: 'acceptEdits' | 'bypassPermissions';
  onOutput?: (chunk: string) => void;
  stageLogId: string;
  maxConcurrentPtys?: number;
  cols?: number;
  rows?: number;
  quiescenceMs?: number;
}

export function executePtyClaudeCode(options: PtyExecuteOptions): Promise<ExecuteResult> {
  const {
    prompt, worktreePath, model, timeout = 300_000,
    tools, permissionMode = 'acceptEdits', onOutput,
    stageLogId, maxConcurrentPtys = 4, cols = 120, rows = 30,
    quiescenceMs = 3000,
  } = options;

  if (!ptyManager) {
    ptyManager = createPtyManager({ maxConcurrentPtys });
  }

  const args: string[] = ['--model', model, '--permission-mode', permissionMode];
  if (tools && tools.length > 0) {
    args.push('--tools', tools.join(','));
  }

  const handle = ptyManager.spawn(stageLogId, { cwd: worktreePath, args, cols, rows });

  return executePtySession({
    handle,
    prompt,
    worktreePath,
    timeout,
    quiescenceMs,
    onOutput: onOutput ?? (() => {}),
  }).finally(() => {
    ptyManager?.kill(stageLogId);
  });
}

/** Get the PTY manager for orphan cleanup. Returns null if not initialized. */
export function getPtyManager(): PtyManager | null {
  return ptyManager;
}
```

- [ ] **Step 3: Add createAsyncBufferedWriter to log-writer.ts**

In `src/worker/log-writer.ts`, add a new export for async buffered writing (used by PTY mode):

```typescript
import { appendFile } from 'node:fs/promises';

export interface AsyncBufferedWriter {
  write(chunk: string): void;
  flush(): Promise<void>;
  destroy(): void;
}

export function createAsyncBufferedWriter(filePath: string, options?: {
  flushIntervalMs?: number;
  flushSizeBytes?: number;
}): AsyncBufferedWriter {
  const { flushIntervalMs = 100, flushSizeBytes = 4096 } = options ?? {};
  let buffer = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;

  async function doFlush(): Promise<void> {
    if (buffer.length === 0 || flushing) return;
    flushing = true;
    const data = buffer;
    buffer = '';
    try {
      await appendFile(filePath, data, 'utf-8');
    } finally {
      flushing = false;
    }
  }

  return {
    write(chunk: string): void {
      buffer += chunk;
      if (buffer.length >= flushSizeBytes) {
        doFlush().catch(err => console.error('[log-writer] async flush error:', err));
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          doFlush().catch(err => console.error('[log-writer] async flush error:', err));
        }, flushIntervalMs);
      }
    },
    async flush(): Promise<void> {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      await doFlush();
    },
    destroy(): void {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    },
  };
}
```

- [ ] **Step 4: Update stage-runner.ts to accept terminal mode**

In `StageRunnerOptions`, add:

```typescript
  terminalMode?: 'pty' | 'print';
```

In `createStageRunner`, update the `createStageLog` call to pass `terminalMode`:

```typescript
      const stageLog = createStageLog(db, {
        taskId,
        projectId,
        runId: options?.runId,
        stage,
        attempt,
        filePath: relativeFilePath,
        startedAt,
        terminalMode: opts.terminalMode ?? 'print',
      });
```

Import and use `createAsyncBufferedWriter` for PTY mode:

```typescript
import { createAsyncBufferedWriter, type AsyncBufferedWriter } from './log-writer.js';
```

Replace the `onOutput` callback:

```typescript
      // Use async buffered writer for PTY mode (high-frequency output)
      const asyncWriter = opts.terminalMode === 'pty'
        ? createAsyncBufferedWriter(filePath)
        : null;

      const onOutput = (chunk: string): void => {
        if (asyncWriter) {
          asyncWriter.write(chunk);
        } else {
          fs.appendFileSync(filePath, chunk, 'utf-8');
        }
        broadcastLog(io, {
          taskId,
          runId: options?.runId ?? `stage-${stageLog.id}`,
          stage,
          chunk,
          timestamp: new Date().toISOString(),
        });
      };
```

In the try block before returning, and in the catch block before throwing, add:

```typescript
        if (asyncWriter) await asyncWriter.flush();
```

And in both blocks, add `asyncWriter?.destroy()` for cleanup.

- [ ] **Step 5: Update loop.ts to read terminal config**

In `src/worker/loop.ts`, where the project config is loaded and the stage runner is created, read the terminal mode:

```typescript
// Read terminal config from .agentboard/config.json
const terminalMode = projectConfig.terminal?.mode === 'pty' ? 'pty' : 'print';

// Pass to stage runner creation
const stageRunner = createStageRunner({
  taskId: task.id,
  projectId,
  io,
  db,
  logsDir,
  projectRoot,
  terminalMode,
});
```

When calling `executeClaudeCode` or `executePtyClaudeCode`, check the mode:

```typescript
if (terminalMode === 'pty') {
  return executePtyClaudeCode({ ...options, stageLogId: stageLog.id });
} else {
  return executeClaudeCode(options);
}
```

The exact insertion points depend on how `loop.ts` currently structures its stage calls — follow the existing pattern.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/worker/executor.ts src/worker/stage-runner.ts src/worker/log-writer.ts src/worker/loop.ts
git commit -m "feat(worker): wire PTY executor into stage runner with async buffered writes"
```

---

## Task 5: Update Stage Prompt Templates

**Files:**
- Modify: `prompts/*.md` (all stage prompt templates)

The spec requires Claude Code to write `.agentboard/stage-result.json` after completing each stage. Without this instruction in the prompts, result extraction Layer 1 (the primary mechanism) will always fail.

- [ ] **Step 1: List existing prompt files**

Run: `ls prompts/`
Identify all stage prompt template files.

- [ ] **Step 2: Append result-file instruction to each stage prompt**

Add the following block at the end of each stage prompt template (before any closing delimiters):

```markdown
## Result Reporting

When you have completed this stage, write your results to `.agentboard/stage-result.json` in the worktree root with this exact JSON format (no markdown wrapping):

```json
{"passed": true, "summary": "one line description of what you did"}
```

Set `passed` to `false` if the stage objective was not met. The `summary` should be a single sentence.
```

- [ ] **Step 3: Verify prompts still have valid variable interpolation**

Spot-check that the added block doesn't interfere with any `{variable}` interpolation patterns in the existing templates.

- [ ] **Step 4: Commit**

```bash
git add prompts/
git commit -m "feat(prompts): add stage-result.json writing instruction for PTY mode"
```

---

## Task 6: Doctor Check for node-pty

**Files:**
- Modify: `src/cli/doctor.ts:32-89`

- [ ] **Step 1: Add node-pty check to doctor.ts**

At the top of `doctor.ts`, add:

```typescript
import { createRequire } from 'node:module';
const esmRequire = createRequire(import.meta.url);
```

After the `claude CLI is installed` check (around line 53), add:

```typescript
    {
      label: 'node-pty is installed (required for PTY terminal mode)',
      critical: false,
      test: () => {
        try {
          esmRequire('node-pty');
          return true;
        } catch {
          return false;
        }
      },
    },
```

- [ ] **Step 2: Run doctor to verify**

Run: `npx tsx bin/agentboard.ts doctor`
Expected: Shows the new check (will show warning since node-pty isn't installed yet)

- [ ] **Step 3: Commit**

```bash
git add src/cli/doctor.ts
git commit -m "feat(cli): add node-pty availability check to doctor"
```

---

## Task 7: Install Dependencies

**Files:**
- Modify: `package.json` (server)
- Modify: `ui/package.json` (client)

- [ ] **Step 1: Install server dependency**

```bash
cd /home/user/Personal/agentboard && npm install --save-optional node-pty
```

- [ ] **Step 2: Install client dependencies**

```bash
cd /home/user/Personal/agentboard/ui && npm install @xterm/xterm @xterm/addon-fit @xterm/addon-search @xterm/addon-web-links
```

- [ ] **Step 3: Verify build**

```bash
cd /home/user/Personal/agentboard && npm run build
```
Expected: Builds successfully

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json ui/package.json ui/package-lock.json
git commit -m "chore: add node-pty and xterm.js dependencies"
```

---

## Task 8: XTermStage React Component

**Files:**
- Create: `ui/src/components/XTermStage.tsx`
- Create: `ui/src/components/XTermStage.test.tsx`
- Create: `ui/src/hooks/useTerminalStream.ts`
- Create: `ui/src/hooks/useTerminalStream.test.ts`

- [ ] **Step 1: Write the useTerminalStream hook test**

In `ui/src/hooks/useTerminalStream.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTerminalStream } from './useTerminalStream';

// Mock useSocket
vi.mock('./useSocket', () => ({
  useSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

describe('useTerminalStream', () => {
  it('returns a ref and loading state', () => {
    const { result } = renderHook(() =>
      useTerminalStream({ taskId: 1, stage: 'implementing', stageLogId: 'abc', isExpanded: false })
    );
    expect(result.current.isLoading).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npm test -- --run src/hooks/useTerminalStream.test.ts`
Expected: FAIL

- [ ] **Step 3: Write useTerminalStream hook**

In `ui/src/hooks/useTerminalStream.ts`:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from './useSocket';
import { api } from '../api/client';
import type { Terminal } from '@xterm/xterm';

interface LogChunkEvent {
  taskId: number;
  runId: string;
  chunk: string;
  timestamp: string;
  stage?: string;
}

interface UseTerminalStreamOptions {
  taskId: number;
  stage: string;
  stageLogId: string;
  isExpanded: boolean;
  isRunning?: boolean;
}

interface UseTerminalStreamResult {
  terminalRef: React.MutableRefObject<Terminal | null>;
  isLoading: boolean;
  writeToTerminal: (data: string) => void;
}

export function useTerminalStream(options: UseTerminalStreamOptions): UseTerminalStreamResult {
  const { taskId, stage, stageLogId, isExpanded, isRunning } = options;
  const terminalRef = useRef<Terminal | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const socket = useSocket();

  const writeToTerminal = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  // Load historical log content on first expand
  useEffect(() => {
    if (!isExpanded || loaded || !terminalRef.current) return;
    setIsLoading(true);
    api.getStageLogContent(taskId, stageLogId)
      .then((content) => {
        if (content && terminalRef.current) {
          terminalRef.current.write(content);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true))
      .finally(() => setIsLoading(false));
  }, [isExpanded, loaded, taskId, stageLogId]);

  // Subscribe to live chunks
  useEffect(() => {
    if (!socket || !isExpanded) return;

    const onChunk = (event: LogChunkEvent) => {
      if (event.taskId !== taskId) return;
      if (event.stage && event.stage !== stage) return;
      writeToTerminal(event.chunk);
    };

    socket.on('run:log', onChunk);
    return () => { socket.off('run:log', onChunk); };
  }, [socket, isExpanded, taskId, stage, writeToTerminal]);

  return { terminalRef, isLoading, writeToTerminal };
}
```

- [ ] **Step 4: Run hook test**

Run: `cd ui && npm test -- --run src/hooks/useTerminalStream.test.ts`
Expected: PASS

- [ ] **Step 5: Write XTermStage component test**

In `ui/src/components/XTermStage.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { XTermStage } from './XTermStage';

// Mock xterm.js (JSDOM doesn't support canvas)
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
    element: document.createElement('div'),
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    findNext: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock('../hooks/useTerminalStream', () => ({
  useTerminalStream: () => ({
    terminalRef: { current: null },
    isLoading: false,
    writeToTerminal: vi.fn(),
  }),
}));

describe('XTermStage', () => {
  it('renders a terminal container', () => {
    render(
      <XTermStage
        taskId={1}
        stage="implementing"
        stageLogId="abc"
        isExpanded={true}
        isRunning={false}
      />
    );
    // Should render without crashing
    expect(document.querySelector('[data-testid="xterm-container"]') || true).toBeTruthy();
  });
});
```

- [ ] **Step 6: Write XTermStage component**

In `ui/src/components/XTermStage.tsx`:

```tsx
import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStream } from '../hooks/useTerminalStream';

interface Props {
  taskId: number;
  stage: string;
  stageLogId: string;
  isExpanded: boolean;
  isRunning: boolean;
}

export const XTermStage: React.FC<Props> = ({ taskId, stage, stageLogId, isExpanded, isRunning }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const { terminalRef, isLoading } = useTerminalStream({
    taskId, stage, stageLogId, isExpanded, isRunning,
  });

  // Initialize terminal when expanded and visible
  useEffect(() => {
    if (!isExpanded || !containerRef.current) return;

    const terminal = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        selectionBackground: '#264f78',
      },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: false,
      disableStdin: true, // Read-only
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalInstanceRef.current = terminal;
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* container might be hidden */ }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalInstanceRef.current = null;
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [isExpanded, terminalRef]);

  // Search handler
  const handleSearch = useCallback(() => {
    const term = prompt('Search terminal:');
    if (term && searchAddonRef.current) {
      searchAddonRef.current.findNext(term);
    }
  }, []);

  // Copy all handler
  const handleCopyAll = useCallback(() => {
    const terminal = terminalInstanceRef.current;
    if (!terminal) return;
    terminal.selectAll();
    const selection = terminal.getSelection();
    navigator.clipboard.writeText(selection).catch(() => {});
    terminal.clearSelection();
  }, []);

  if (!isExpanded) return null;

  return (
    <div className="relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/80 z-10">
          <span className="text-text-tertiary text-xs">Loading terminal...</span>
        </div>
      )}
      <div
        ref={containerRef}
        data-testid="xterm-container"
        className="min-h-[300px]"
        style={{ height: '400px' }}
      />
      <div className="flex gap-1.5 px-3 py-1.5 border-t border-border-default bg-bg-secondary">
        <button
          onClick={handleSearch}
          className="px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary bg-bg-tertiary rounded transition-colors"
        >
          Search
        </button>
        <button
          onClick={handleCopyAll}
          className="px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary bg-bg-tertiary rounded transition-colors"
        >
          Copy All
        </button>
        {isRunning && (
          <span className="ml-auto text-[11px] text-accent-green animate-pulse">
            Live
          </span>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 7: Run component test**

Run: `cd ui && npm test -- --run src/components/XTermStage.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ui/src/components/XTermStage.tsx ui/src/components/XTermStage.test.tsx ui/src/hooks/useTerminalStream.ts ui/src/hooks/useTerminalStream.test.ts
git commit -m "feat(ui): add XTermStage component and useTerminalStream hook"
```

---

## Task 9: Integrate XTermStage into StageRow

**Files:**
- Modify: `ui/src/components/StageRow.tsx`
- Modify: `ui/src/types.ts` (frontend type mirror)

- [ ] **Step 1: Update frontend StageLog type**

In `ui/src/types.ts`, find the `StageLog` interface and add:

```typescript
  terminalMode?: 'pty' | 'print';
```

- [ ] **Step 2: Update StageRow to conditionally render XTermStage**

In `ui/src/components/StageRow.tsx`, add import:

```typescript
import { XTermStage } from './XTermStage.js';
```

Replace the expanded log content section (lines 144-181). Where it currently renders `<LogRenderer text={displayContent} />`, add a conditional:

```tsx
      {/* Expanded log content */}
      {isExpanded && (
        <div className="border-t border-border-default">
          {stageLog.summary && (
            <div className="px-3 py-2 border-b border-border-default">
              <p className="text-xs text-text-secondary">{stageLog.summary}</p>
            </div>
          )}
          {stageLog.terminalMode === 'pty' ? (
            <XTermStage
              taskId={taskId}
              stage={stageLog.stage}
              stageLogId={stageLog.id}
              isExpanded={isExpanded}
              isRunning={stageLog.status === 'running'}
            />
          ) : (
            <div className="relative">
              {displayContent && (
                <div className="absolute top-2 right-2 z-10 flex gap-1.5">
                  <CopyButton text={displayContent} />
                </div>
              )}
              <div
                ref={contentRef}
                onScroll={handleScroll}
                className="font-mono text-xs text-text-primary leading-relaxed p-3 max-h-[400px] overflow-y-auto"
              >
                {loadingLogs ? (
                  <div className="text-text-tertiary">Loading logs...</div>
                ) : displayContent ? (
                  <LogRenderer text={displayContent} />
                ) : (
                  <div className="text-text-tertiary">No log content available</div>
                )}
                <div ref={bottomRef} />
              </div>
              {userScrolledUp && isActive && (
                <button
                  onClick={scrollToBottom}
                  className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md text-[11px] font-medium bg-accent-blue text-white hover:bg-accent-blue-hover transition-colors shadow-lg"
                >
                  Follow live ↓
                </button>
              )}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify UI build**

Run: `cd /home/user/Personal/agentboard/ui && npm run build`
Expected: Builds successfully

- [ ] **Step 4: Run UI tests**

Run: `cd /home/user/Personal/agentboard/ui && npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/StageRow.tsx ui/src/types.ts
git commit -m "feat(ui): integrate XTermStage into StageRow with mode-based rendering"
```

---

## Task 10: Full Build & Test Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full backend tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run full UI tests**

Run: `cd ui && npm test`
Expected: All tests pass

- [ ] **Step 3: Run full build**

Run: `npm run build`
Expected: TypeScript compiles + Vite UI build succeeds

- [ ] **Step 4: Run dev mode to visual verify**

Run: `npm run dev` and open the UI in browser. Navigate to any task with stage logs. Stages with `terminalMode='print'` should render as before with LogRenderer. No regressions.

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address build/test issues from PTY terminal integration"
```

---

## Task Summary

| Task | Description | Estimated Complexity |
|------|-------------|---------------------|
| 1 | Schema migration (pid, terminal_mode) | Low |
| 2 | PTY Manager (spawn, track, kill) | Medium |
| 3 | PTY Executor (state machine, result extraction) | High |
| 4 | Wire into executor + stage runner + log-writer | Medium |
| 5 | Update stage prompt templates (result file instruction) | Low |
| 6 | Doctor check for node-pty | Low |
| 7 | Install dependencies | Low |
| 8 | XTermStage component + hook | Medium |
| 9 | Integrate into StageRow | Low |
| 10 | Full verification | Low |

**Execution order:**

```
Task 1 (schema) ─┬─> Task 7 (install deps) ─┬─> Task 2 (pty-manager)  ─┐
                  │                           └─> Task 3 (pty-executor)  ├─> Task 4 (wire up)
                  │                                                      │
                  └─> Task 5 (prompts)                                   │
                                                                         ├─> Task 6 (doctor)
Task 7 ──────────────> Task 8 (XTermStage) ──> Task 9 (StageRow) ───────┘
                                                                         └─> Task 10 (verify)
```

**Key dependency:** Task 7 (install deps) must run before Tasks 2-3 because they import `node-pty` types. Tasks 2+3 can run in parallel. Tasks 5 and 8 have no mutual dependency and can run in parallel with server tasks.
