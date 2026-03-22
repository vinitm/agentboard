# PTY Terminal Sessions in Browser

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Embed live, native Claude Code terminal sessions in the agentboard UI per pipeline stage

## Overview

Replace the current parsed-log display in StageAccordion with live xterm.js terminals backed by node-pty. Each pipeline stage spawns Claude Code in native interactive mode (no `--print`) inside a pseudo-terminal. PTY output streams to the browser via Socket.IO, where xterm.js renders the full terminal experience — statusline, tool confirmations, thinking indicators, colors, and all.

## Goals

- Users see exactly what they'd see in a terminal when watching a pipeline stage
- One terminal per stage, rendered inside the existing StageAccordion
- Read-only — no user input to the terminal
- Full scrollback persists after stage completion
- Backward compatible — print mode remains available as fallback

## Prerequisites

Before implementation begins, validate that these Claude Code CLI flags work correctly in interactive mode (no `--print`):
- `--tools` (tool restrictions per stage)
- `--permission-mode` (bypassPermissions for autonomous pipeline)
- `--model` (opus/haiku selection)

Run a manual test: `claude --tools Read,Glob,Grep --permission-mode bypassPermissions --model claude-sonnet-4-6` in a PTY and confirm the flags are respected. If any flags behave differently in interactive mode, document the differences and adjust the design before proceeding.

## Architecture

### Process Spawning

**Current:** `spawn('claude', ['--print', '--output-format', 'json', ...])` with piped stdio. Prompt written to stdin, stdin closed. Process exits with JSON result.

**New:** `pty.spawn('claude', [...toolFlags, ...permissionFlags], { cwd, name: 'xterm-256color', cols: 120, rows: 30 })`. No `--print`, no `--output-format`. Claude Code starts in native interactive mode, sees a real TTY, shows its full UI.

**Flags:** `--tools`, `--permission-mode`, `--model` — same flags as today, just without `--print` and `--output-format`.

**Driving the session:**

1. PTY spawns — Claude Code loads CLAUDE.md, `.claude/` rules, shows startup output
2. **Readiness detection** — wait for the initial idle `>` prompt before injecting the stage prompt (see Completion & Readiness Detection below)
3. Stage runner writes the prompt to the PTY (like a user typing it, followed by Enter)
4. Claude Code works — shows thinking, tool calls, confirmations, progress
5. Claude Code finishes and returns to the `>` prompt
6. Stage runner detects the idle prompt (see Completion & Readiness Detection below)
7. Stage runner reads the result file (see Result Extraction below), then sends `/exit`
8. Process exits — stage marked complete

**Startup latency:** Claude Code in interactive mode loads CLAUDE.md and `.claude/` rules on startup. This adds ~5-10 seconds per PTY that does not exist in `--print` mode. The timeout budget should account for this overhead.

### Completion & Readiness Detection

This is the most critical mechanism in the design. Claude Code's interactive prompt must be reliably detected to know when the agent is ready for input and when it has finished working.

**State machine approach:**

```
SPAWNING -> READY -> WORKING -> IDLE -> EXTRACTING -> EXITING
```

- `SPAWNING`: PTY just created. Accumulate output, watch for initial prompt.
- `READY`: Initial `>` prompt detected. Safe to write the stage prompt.
- `WORKING`: Prompt written, Claude Code is processing.
- `IDLE`: Claude Code returned to `>` prompt after completing work.
- `EXTRACTING`: Reading result file, sending `/cost`.
- `EXITING`: Sent `/exit`, waiting for process to terminate.

**Prompt detection strategy:**

The `>` prompt is rendered with ANSI escape sequences. Rather than matching a bare `>`, use a multi-signal approach:

1. **Primary signal — PTY output quiescence:** After receiving data containing a `>` character at or near the end of a line (stripping ANSI codes first), start a quiescence timer. If no additional PTY output arrives for 3 seconds, consider the prompt detected.

2. **Secondary signal — ANSI-stripped line matching:** Strip all ANSI escape sequences from the output buffer, then match against the pattern `/^\s*>\s*$/m` (a line containing only `>` with optional whitespace). This catches the prompt even when wrapped in color codes.

3. **Guard against false positives:** Do NOT trigger in `WORKING` state if:
   - The `>` appears inside a code block (track backtick parity)
   - Output is still actively arriving (data received within the quiescence window)
   - The line containing `>` is followed by more non-whitespace content

4. **Timeout fallback:** If the quiescence-based approach fails to detect a prompt within the stage timeout, kill the PTY and mark the stage as failed with a retriable error.

**Quiescence timer values:**
- Initial ready detection: 2 seconds (startup is slower)
- Work completion detection: 3 seconds
- These are configurable in the terminal config

**Note on `--permission-mode`:** The pipeline uses `bypassPermissions`, so Claude Code should not ask confirmation questions (e.g., "Allow tool X? (y/n)"). If a different permission mode is used, those confirmation prompts would appear in the terminal output but could break completion detection. The spec assumes `bypassPermissions` for autonomous pipeline stages.

### PTY Lifecycle Management

One PTY per stage execution. The PTY manager owns the lifecycle.

```
Stage starts
  -> pty.spawn('claude', flags, { cwd: worktreePath })
  -> Store PID in stage_logs record
  -> Register PTY in Map<stageLogId, PtyHandle>
  -> Wait for READY state (initial prompt detection)
  -> Write prompt to PTY
  -> Stream output to Socket.IO + log file
  -> Detect IDLE state -> read result file -> send /cost -> send /exit
  -> PTY process exits
  -> Update stage_logs DB record
  -> Remove from Map
```

**Cleanup / failure handling:**

- **Timeout:** Configurable (300s default, 600s for implementation). Includes startup latency. If exceeded, `ptyProcess.kill()` and mark stage failed.
- **Server crash:** On startup, query stage_logs for records with `status='running'` and a `pid` value. Check if each PID is still alive (`process.kill(pid, 0)`). Kill orphans and mark their stages as `failed` with "server restart" reason.
- **Stage retry:** New PTY spawned for each attempt. Previous PTY's scrollback still visible from the log file.

**Resource limits:** One active PTY per task (stages run sequentially within a task). Multiple tasks can run in parallel, so multiple PTYs can exist simultaneously. Configurable `maxConcurrentPtys` cap prevents runaway resource usage.

### Streaming to the Browser

**Server side:**

```
ptyProcess.onData(chunk)
  -> logWriter.append(logPath, chunk)          // buffered async write (see note)
  -> broadcastLog(io, taskId, runId, stage, chunk, timestamp)  // run:log event
```

The `onOutput` callback signature stays the same: `(chunk: string) => void`. The stage runner doesn't care that chunks now contain ANSI escape sequences. Log files will contain raw ANSI codes.

**Note on file writes:** The current `appendFileSync` works for `--print` mode where output arrives in infrequent chunks. PTY mode generates output at much higher frequency (cursor movements, animations, character-by-character typing). Replace synchronous writes with a buffered async writer that flushes every 100ms or on 4KB accumulated, whichever comes first. This prevents I/O from blocking the event loop. The `log-writer.ts` module already exists and can be extended with this buffering.

**Socket.IO broadcasting:** Currently `broadcastLog` in `ws.ts` uses `io.emit()` which broadcasts to ALL connected clients. Clients filter by `taskId`. The `run:log` event payload is `{ taskId, runId, stage, chunk, timestamp }`. With multiple concurrent PTY sessions streaming raw terminal output, this broadcast-to-all model increases bandwidth. As an optimization (not blocking for v1), migrate to room-based broadcasting where clients join a `task:{taskId}` room on the TaskPage and only receive events for that task.

**Client side:** Replace `LogRenderer` inside `StageRow` with a new `XTermStage` component.

```
Socket.IO run:log event arrives (filtered by taskId + stage)
  -> XTermStage receives chunk
  -> terminal.write(chunk)     // xterm.js handles all ANSI rendering
```

**On expand (lazy load):** When a user expands a completed stage, fetch the full log via the existing `GET /api/tasks/:id/stages/:stageLogId/logs` endpoint (already supports range requests). Write the entire log into xterm.js in one shot.

### UI Layout

TaskPage and StageAccordion structure unchanged. StageRow's expanded content changes:

```
+-- StageRow (e.g., "implementing") --------------------------+
|  * Running  .  2m 34s  .  12,400 tokens                     |
+--------------------------------------------------------------+
| +-- XTermStage ------------------------------------------- + |
| |                                                          | |
| |  (full xterm.js terminal -- Claude Code's native         | |
| |   UI with statusline, colors, tool calls, etc.)          | |
| |                                                          | |
| +----------------------------------------------------------+ |
|  [Fit to content]  [Search]  [Copy All]                      |
+--------------------------------------------------------------+
```

**Terminal sizing:**

- Default height: 24 rows (standard terminal)
- "Fit to content" toggle: dynamically set terminal rows to `Math.min(scrollbackLength, 80)` to expand the view without creating an excessively tall DOM element. Beyond 80 rows, use internal xterm.js scrolling.
- `addon-fit` handles width — matches the accordion panel width
- Resize observer re-fits on window/panel resize

**Detecting terminal mode in UI:** The `stage_logs` record includes a `terminal_mode` field (`'pty'` or `'print'`). `StageRow` checks this to decide whether to render `XTermStage` (pty) or the existing `LogRenderer` (print). This allows mixed-mode display when some stages ran in print mode and others in pty mode (e.g., after a config change mid-pipeline).

**Resource management:** Stages scrolled off-screen get their xterm instance disposed and re-created on scroll-back (virtualization). Uses an IntersectionObserver to detect visibility.

### Result Extraction

File-based approach — more reliable than parsing conversational PTY output.

**Layer 1 — Result file (primary):**

The stage prompt instructs Claude Code to write a structured result file when done:

```
When you have completed this stage, write your results to .agentboard/stage-result.json with this exact format:
{"passed": true/false, "summary": "one line description of what you did"}
```

After detecting the IDLE state, the pty-executor reads `.agentboard/stage-result.json` from the worktree. This is reliable because:
- Claude Code writes the file as a normal tool call (visible in the terminal)
- The file is in the worktree, not parsed from PTY output
- If the file is missing, fall through to Layer 2

**Layer 2 — /cost command for tokens:**

After reading the result file, send `/cost` to the PTY. Claude Code outputs token usage. Parse the numeric values from the ANSI-stripped output with a regex pattern matching the `/cost` output format.

**Layer 3 — Worktree state (fallback):**

If the result file is missing, infer results from the worktree:
- Implementation stage: `git diff --stat` shows if files were changed
- Checks stage: look for test output files or known pass/fail markers
- Spec review: look for the review output file the prompt asks Claude to write

**Layer 4 — Exit code (baseline):**

After `/exit`, the PTY process exits with a code. 0 = success, non-zero = failure. Always captured as a minimum signal.

### Configuration

```json
// .agentboard/config.json
{
  "terminal": {
    "mode": "pty",
    "maxConcurrentPtys": 4,
    "defaultRows": 30,
    "defaultCols": 120,
    "readyTimeoutMs": 30000,
    "quiescenceMs": 3000
  }
}
```

- `"pty"` mode: Full interactive terminal via node-pty
- `"print"` mode: Current behavior, unchanged. No node-pty dependency needed.
- `readyTimeoutMs`: Max time to wait for initial `>` prompt after spawn (default 30s, accounts for CLAUDE.md loading)
- `quiescenceMs`: How long to wait after last output before declaring prompt detected (default 3s)

### Backward Compatibility

- `executeClaudeCode()` in executor.ts stays unchanged
- New `executePtyClaudeCode()` added alongside it
- Stage runner picks which one based on config
- `node-pty` listed in `optionalDependencies` — if it fails to install, falls back to print mode with a warning from `agentboard doctor`
- Log files now contain ANSI codes in pty mode — harmless for `cat`, rendered properly by `less -R` and xterm.js
- Socket.IO protocol unchanged — `run:log` event payload stays `{ taskId, runId, stage, chunk, timestamp }`

## Schema Changes

**`stage_logs` table — add columns:**

```sql
ALTER TABLE stage_logs ADD COLUMN pid INTEGER;
ALTER TABLE stage_logs ADD COLUMN terminal_mode TEXT NOT NULL DEFAULT 'print';
```

- `pid`: Process ID of the PTY process. Used for orphan cleanup on server restart. NULL for print mode.
- `terminal_mode`: `'pty'` or `'print'`. Used by the UI to decide which renderer to use.

## New Files

| File | Purpose |
|------|---------|
| `src/worker/pty-manager.ts` | PTY lifecycle: spawn, Map tracking, cleanup, kill, orphan detection |
| `src/worker/pty-executor.ts` | Drive Claude Code sessions: readiness detection, prompt injection, completion state machine, result extraction |
| `ui/src/components/XTermStage.tsx` | xterm.js wrapper component with fit, search, copy, virtualization |
| `ui/src/hooks/useTerminalStream.ts` | Socket.IO -> xterm.js bridge, lazy-load for completed stages |

## Modified Files

| File | Change |
|------|--------|
| `src/worker/executor.ts` | Add mode switch, export `executePtyClaudeCode` |
| `src/worker/stage-runner.ts` | Delegate to pty-executor when in pty mode |
| `src/worker/log-writer.ts` | Add buffered async write mode for high-frequency PTY output |
| `src/db/schema.ts` | Add `pid` and `terminal_mode` columns to `stage_logs` |
| `src/db/stage-log-queries.ts` | Update createStageLog/updateStageLog for new columns, add orphan query |
| `ui/src/components/StageRow.tsx` | Swap LogRenderer for XTermStage when `terminal_mode === 'pty'` |
| `package.json` | Add `node-pty` to optionalDependencies, xterm packages to dependencies |
| `src/cli/doctor.ts` | Check node-pty availability, warn if missing |
| `src/worker/loop.ts` | Pass terminal mode config to stage runner |
| `prompts/*.md` | Add stage-result.json writing instruction to each stage prompt |

## Dependencies

**Server (optionalDependencies):**
- `node-pty` — native pseudo-terminal bindings

**Client (dependencies):**
- `@xterm/xterm` — terminal emulator (DOM renderer, ~200KB; canvas renderer addon not needed for read-only display)
- `@xterm/addon-fit` — auto-resize to container
- `@xterm/addon-search` — Ctrl+F within terminal output
- `@xterm/addon-web-links` — clickable URLs in output

## Risks

| Risk | Mitigation |
|------|-----------|
| Completion detection is heuristic (quiescence-based) | Multi-signal approach: ANSI-stripped regex + quiescence timer + state machine guards against false positives. Timeout fallback kills PTY and retries. |
| node-pty native build fails on some systems | Optional dependency + print mode fallback + `agentboard doctor` check |
| Result file not written by Claude Code | Three-layer fallback (result file -> worktree state -> exit code) |
| CLI flags behave differently without `--print` | Prerequisite validation step before implementation begins |
| Multiple xterm.js instances consume browser memory | Virtualize off-screen terminals via IntersectionObserver, dispose and re-create on scroll |
| High-frequency PTY output blocks event loop | Buffered async log writer (flush every 100ms or 4KB) |
| Startup latency from CLAUDE.md loading (~5-10s) | Configurable readyTimeoutMs (default 30s), accounted in stage timeout budget |
| Broadcast-to-all Socket.IO increases bandwidth | v1 keeps current model (client-side filtering). v2 optimization: room-based broadcasting. |

## Testing Strategy

- **pty-manager.ts:** Unit tests with mock pty (spawn, kill, orphan cleanup, timeout)
- **pty-executor.ts:** Unit tests for state machine transitions, ANSI stripping, prompt detection regex. Integration tests against real Claude Code.
- **Completion detection:** Dedicated test suite with captured PTY output samples (startup sequence, mid-work pauses, code blocks containing `>`, actual completion)
- **XTermStage.tsx:** Component tests with mock Socket.IO (chunk rendering, lazy load, dispose/recreate, mode detection)
- **useTerminalStream.ts:** Hook tests (event filtering by taskId+stage, buffering, cleanup)
- **Schema migration:** Test that new columns have correct defaults, existing stage_logs records get `terminal_mode='print'`
- **E2E:** Run a task in pty mode, verify terminal appears in browser, verify stage completion and result extraction
- **Fallback:** Run with node-pty uninstalled, verify print mode works unchanged
- **Mixed mode:** Run some stages in print mode, some in pty mode, verify UI renders both correctly
