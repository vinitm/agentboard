# Persistent Chat Sessions

**Date:** 2026-03-17
**Status:** Approved

## Problem

The PM chat (spec brainstorming) currently spawns a new `claude --print` process for every message. The full conversation history is replayed into each new process via the prompt template. This wastes tokens, adds latency, and scales poorly as conversations grow.

## Solution

Use Claude Code's built-in session persistence via `--session-id` and `--resume` flags. Each message still spawns a new `claude -p` process, but Claude automatically loads the full conversation context from its session store on disk — no manual history replay needed.

**Key insight from testing:** `--input-format stream-json` does NOT support keeping stdin open for multi-turn. Each `claude -p` call is one turn. Multi-turn works via `--resume <session-id>`, which loads the previous session's context automatically.

## Design

### Architecture

Each task gets one Claude session ID (UUID), stored on the task row. The flow:

1. **First chat message** → generate UUID, spawn `claude -p` with `--session-id <uuid>`, pipe the prompt via stdin
2. **Subsequent messages** → spawn `claude -p` with `--resume <session-id>`, pipe just the new message via stdin
3. Claude's session persistence handles context — no history replay by agentboard

**First message spawn:**
```
claude -p \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --system-prompt "<brainstorming instructions read from file>" \
  --session-id <uuid>
```
Stdin receives: spec state context + PM's first message.

**Subsequent message spawn:**
```
claude -p \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --resume <session-id>
```
Stdin receives: just the PM's message (Claude already has full conversation context from the resumed session, including the system prompt).

**Note:** `--system-prompt-file` is not available in the current CLI. The system prompt file is read in Node.js code and passed via `--system-prompt` flag. The system prompt only needs to be passed on the first message — `--resume` restores it from the session.

### Stream-JSON Output Format (verified by testing)

Each line of stdout is a JSON object. Key event types:

| Type | Subtype | Description | Example |
|------|---------|-------------|---------|
| `system` | `init` | Session init with tools, model, session_id | `{"type":"system","subtype":"init","session_id":"...","model":"..."}` |
| `system` | `hook_*` | Hook events (filter out) | `{"type":"system","subtype":"hook_started",...}` |
| `assistant` | — | Full assistant message | `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` |
| `stream_event` | — | Partial text chunks (with `--include-partial-messages`) | `{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"..."}}}` |
| `result` | `success` | Turn complete. Has full text + cost + session_id | `{"type":"result","subtype":"success","result":"full text","session_id":"...","total_cost_usd":0.05}` |
| `result` | `error_during_execution` | Error. Has `errors` array | `{"type":"result","subtype":"error_during_execution","errors":["No conversation found..."]}` |

**Response complete signal:** The `result` event marks the end of a turn. After this, the process exits.

**Resume failure detection (verified):** When `--resume` is called with a non-existent session ID, the output is a `result` event with `subtype: "error_during_execution"` and `errors: ["No conversation found with session ID: <uuid>"]`. This is used to trigger the fallback path.

**Text assembly:** To stream text to the browser:
1. Forward `stream_event` deltas where `event.delta.type == "text_delta"` as SSE chunks
2. On `result` event, use the `result` field as the full accumulated text
3. Parse the full text for the JSON block (same `parseResponseJson()` logic as today)

### Chat Route Changes (`src/server/routes/chat.ts`)

**New flow per message:**
1. Persist user message to DB
2. Check if task has `chatSessionId` — determines first vs subsequent message
3. Spawn `claude -p` with appropriate flags (`--session-id` for first, `--resume` for subsequent)
4. Pipe the prompt/message to stdin, close stdin
5. Stream `stream_event` text deltas to browser as SSE chunks
6. On `result` event → parse accumulated text for JSON block → persist assistant message + spec/title/description/risk updates → send SSE `done` event
7. On `result` with `error_during_execution` containing "No conversation found" → trigger fallback (see Error Handling)
8. On process error/non-zero exit → send SSE error event

**First message special case:**
- Generate UUID, save as `chatSessionId` on task row
- Read `prompts/brainstorming-system.md` and pass via `--system-prompt`
- Stdin receives: spec state snapshot + PM's message

**Concurrency guard:**
- In-memory `Set<string>` tracks task IDs with in-flight chat requests
- Add task ID at request start, remove in a `finally` block (covers success, error, client disconnect)
- Return 409 if task ID is already in the set

**What stays the same:**
- SSE response format to the browser (UI does not change)
- DB persistence of all messages (for UI chat history display)
- Spec/title/description/risk parsing from JSON block in Claude's response
- `GET /:id/chat/messages` endpoint

**What is removed:**
- `{chatHistory}` template interpolation
- Loading full chat history to build the prompt
- The `brainstorming.md` template's `{chatHistory}` placeholder

**What is simplified:**
- No session manager / process lifecycle management needed
- No idle timeout, busy flag, or in-memory session map
- Each request is a simple spawn → pipe → stream → parse → done

### Data Model Change

One new column on the `tasks` table:

- `chat_session_id TEXT` — UUID for `--session-id` / `--resume`. Set on first chat message.

Migration: add `migrateChatSessionId()` following the existing `ALTER TABLE` pattern (e.g., `migrateReviewStages`).

Query changes:
- Add `chatSessionId` to `rowToTask()` conversion
- Add `chatSessionId` to `UpdateTaskData` interface so `updateTask()` can set it

No new tables. Existing `chat_messages` table unchanged.

### Prompt Template Split

Current `prompts/brainstorming.md` splits into two parts:

1. **`prompts/brainstorming-system.md`** (new) — the role instructions, response format, completion criteria. Read by the chat route and passed via `--system-prompt` on the first message only.
2. **First message stdin** — current spec state snapshot + PM's message, sent only on the first message (no session ID yet).

On subsequent messages (using `--resume`), the system prompt is restored from the session automatically — no need to re-send it.

The `{chatHistory}` placeholder and `{currentSpec}` template in `brainstorming.md` are removed. The old file can be deleted.

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Process exits non-zero | SSE error event to browser with stderr content. PM can re-send. Session ID preserved. |
| `--resume` fails ("No conversation found") | Detected via `result.subtype === "error_during_execution"` + error message. Fall back: generate new UUID, set `chatSessionId` on task, spawn with `--session-id`, replay chat history from DB as context in first message. Log warning. |
| Server restart | No impact — session IDs in DB, Claude's session data on disk (`~/.claude/`). Next message uses `--resume`. |
| Claude's session data pruned/lost | Same as `--resume` fails — fallback replays from DB. |
| Concurrent messages | 409 response. Concurrency guard uses `Set<taskId>` with try/finally cleanup. |
| Client disconnect mid-stream | `res.on('close')` kills the child process. Concurrency guard cleaned up in finally. |
| `CLAUDECODE` env var | Unset in spawn env (as current code does) to prevent nested Claude detection. |

### Session Data Lifecycle

Claude stores session data at `~/.claude/projects/`. This grows over time. For the initial implementation, cleanup is out of scope — Claude may have its own pruning. If disk usage becomes an issue, a future task can add a cleanup job that removes sessions for completed/archived tasks.

### Files Changed

| File | Change |
|------|--------|
| `src/server/routes/chat.ts` | Rewrite: use `--session-id`/`--resume`, parse `stream-json` events, add concurrency guard |
| `src/db/schema.ts` | Add `chat_session_id` column via migration function |
| `src/db/queries.ts` | Add `chatSessionId` to `rowToTask()`, `UpdateTaskData`, and update SQL builder |
| `src/types/index.ts` | Add `chatSessionId` to `Task` type |
| `prompts/brainstorming-system.md` | **New** — system prompt (role, format, completion criteria) |
| `prompts/brainstorming.md` | Remove `{chatHistory}`, simplify to first-message spec context only, or delete |

### Test Plan

- **DB layer:** Test `chatSessionId` roundtrips (create task → update chatSessionId → read back). Uses `createTestDb()`.
- **Event parser:** Unit test the stream-json line parser — verify it correctly categorizes `system`, `assistant`, `stream_event`, `result` types and extracts text from each.
- **Route integration:** Test with `createTestApp()` + supertest:
  - First message sets `chatSessionId` on task
  - Subsequent message uses `--resume` (mock the spawn to verify args)
  - Concurrent request returns 409
  - `--resume` failure triggers fallback
- **Prompt template:** Verify `brainstorming-system.md` contains valid system prompt content

### What Does NOT Change

- Frontend (`TaskForm.tsx`) — SSE format stays the same
- `chat_messages` table — still used for UI display
- `GET /api/tasks/:id/chat/messages` — unchanged
- Worker pipeline — unaffected, only chat route changes
- No new module needed (no `chat-session.ts`) — the route handler is self-contained
