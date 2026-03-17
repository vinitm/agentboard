# ADR-006: Claude Code as Child Process Executor

## Status
Accepted

## Context
Need to invoke an AI coding agent to do the actual work in each pipeline stage. The agent must operate in the task's worktree with permission to edit files. Need real-time output streaming for the UI.

## Decision
Spawn Claude Code as a child process via `spawn('claude', ['--print', '--model', model, '--permission-mode', 'acceptEdits'], { cwd: worktreePath })` in `src/worker/executor.ts`.

- `--print` puts Claude Code in non-interactive mode
- `--permission-mode acceptEdits` allows the agent to write files without user prompting
- Prompt is written to `stdin`; `stdout`/`stderr` are streamed chunk-by-chunk
- `spawn` (not `execFile`) is used so output can be streamed to the `onOutput` callback, which broadcasts live logs to the UI via Socket.IO
- Configurable timeout (default 300s) kills the process if it hangs
- Token usage is parsed from output with regex; falls back to `output.length / 4` as estimate

For the full executor interface and streaming architecture, see [Agent Orchestration → Claude Code Executor](agent-orchestration.md#claude-code-executor).

## Consequences

### Positive
- Claude Code handles all file editing, git operations, and tool use
- Streaming gives real-time UI feedback
- Process isolation — a hung agent can be killed cleanly

### Negative
- Tight coupling to Claude Code CLI interface — changes to CLI flags or output format break all stages

### Risks
- `acceptEdits` permission mode gives the agent broad write access within the worktree
- 300s timeout may be too short for complex implementation tasks
- Token usage parsing via regex is fragile — output format changes could break cost tracking

See also: [Worker Gotchas](../gotchas/worker.md)
