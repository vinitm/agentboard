# Persistent Chat Sessions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-message history replay with Claude's session persistence (`--session-id` / `--resume`) so the PM chat doesn't re-send the full conversation on every message.

**Architecture:** Each task stores a `chatSessionId` (UUID). First chat message spawns `claude -p --session-id <uuid>`. Subsequent messages spawn `claude -p --resume <uuid>`. Claude handles context persistence on disk. Stream-json output is parsed for SSE streaming to the browser.

**Tech Stack:** TypeScript, Express, Node.js `spawn`, Claude CLI (`--session-id`, `--resume`, `--output-format stream-json`)

**Spec:** `docs/superpowers/specs/2026-03-17-persistent-chat-sessions-design.md`

---

## File Structure

| File | Role |
|------|------|
| `src/types/index.ts` | Add `chatSessionId` to `Task` interface |
| `src/db/schema.ts` | Migration to add `chat_session_id` column |
| `src/db/queries.ts` | Update `rowToTask()` and `UpdateTaskData` |
| `prompts/brainstorming-system.md` | **New** — system prompt for brainstorming (no history, no spec template) |
| `src/server/routes/chat.ts` | Rewrite to use session persistence + stream-json parsing |

Tests:
| File | Tests |
|------|-------|
| `src/db/schema.test.ts` | Migration adds column |
| `src/types/index.test.ts` | `chatSessionId` exists on Task |
| `src/db/chat-queries.test.ts` | `chatSessionId` roundtrips through DB |
| `src/server/routes/chat.test.ts` | **New** — route integration tests |

---

### Task 1: Add `chatSessionId` to Task type

**Files:**
- Modify: `src/types/index.ts:49-65`

- [ ] **Step 1: Add `chatSessionId` to `Task` interface**

In `src/types/index.ts`, add `chatSessionId` to the `Task` interface after `claimedBy`:

```typescript
chatSessionId: string | null;
```

- [ ] **Step 2: Verify existing type tests still pass**

Run: `npm test -- --grep "types"`
Expected: PASS (or no matching tests — that's fine)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add chatSessionId to Task type"
```

---

### Task 2: DB migration for `chat_session_id` column

**Files:**
- Modify: `src/db/schema.ts:118-123`
- Modify: `src/db/schema.test.ts`

- [ ] **Step 1: Write failing test for the migration**

In `src/db/schema.test.ts`, add a test that verifies the `chat_session_id` column exists on the `tasks` table after `initSchema()`:

```typescript
it('tasks table has chat_session_id column', () => {
  const columns = db
    .prepare("PRAGMA table_info('tasks')")
    .all() as Array<{ name: string }>;
  const colNames = columns.map((c) => c.name);
  expect(colNames).toContain('chat_session_id');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/db/schema.test.ts`
Expected: FAIL — `chat_session_id` not in column list

- [ ] **Step 3: Add migration function**

In `src/db/schema.ts`, add after `migrateToSuperpowersWorkflow`:

```typescript
export function migrateChatSessionId(db: Database.Database): void {
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN chat_session_id TEXT');
    console.log('[db] Added chat_session_id column to tasks');
  } catch {
    // Column already exists — ignore
  }
}
```

Call it from `initSchema()`:

```typescript
export function initSchema(db: Database.Database): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(DDL);
  migrateReviewStages(db);
  migrateToSuperpowersWorkflow(db);
  migrateChatSessionId(db);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/schema.test.ts
git commit -m "feat: add chat_session_id column to tasks table"
```

---

### Task 3: Update `rowToTask()` and `UpdateTaskData` in queries

**Files:**
- Modify: `src/db/queries.ts:32-50` (rowToTask)
- Modify: `src/db/queries.ts:240-250` (UpdateTaskData)
- Modify: `src/db/queries.ts:260-268` (updateTask field mapping)
- Modify: `src/db/chat-queries.test.ts`

- [ ] **Step 1: Write failing test for chatSessionId roundtrip**

In `src/db/chat-queries.test.ts`, add:

```typescript
it('persists and retrieves chatSessionId on task', () => {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000';
  updateTask(db, taskId, { chatSessionId: sessionId });
  const updated = getTaskById(db, taskId);
  expect(updated?.chatSessionId).toBe(sessionId);
});

it('chatSessionId defaults to null on new tasks', () => {
  const task = getTaskById(db, taskId);
  expect(task?.chatSessionId).toBeNull();
});
```

Add `updateTask` and `getTaskById` to the imports from `./queries.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/db/chat-queries.test.ts`
Expected: FAIL — `chatSessionId` not in UpdateTaskData / rowToTask

- [ ] **Step 3: Update `rowToTask()`**

In `src/db/queries.ts`, add to `rowToTask()` after `claimedBy`:

```typescript
chatSessionId: (row.chat_session_id as string) ?? null,
```

- [ ] **Step 4: Update `UpdateTaskData`**

Add to the `UpdateTaskData` interface:

```typescript
chatSessionId?: string | null;
```

- [ ] **Step 5: Update `updateTask()` field mapping**

Add to the field mapping block in `updateTask()`:

```typescript
if (data.chatSessionId !== undefined) { fields.push('chat_session_id = ?'); values.push(data.chatSessionId); }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- src/db/chat-queries.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/queries.ts src/db/chat-queries.test.ts
git commit -m "feat: add chatSessionId to rowToTask and UpdateTaskData"
```

---

### Task 4: Create `prompts/brainstorming-system.md`

**Files:**
- Create: `prompts/brainstorming-system.md`
- Modify: `prompts/brainstorming.md` (reference only — verify content to extract)

- [ ] **Step 1: Create the system prompt file**

Create `prompts/brainstorming-system.md` with the role instructions, response format, and completion criteria extracted from `prompts/brainstorming.md`. Remove `{currentSpec}` and `{chatHistory}` — those are no longer needed. The system prompt should be standalone instructions:

```markdown
You are a collaborative spec builder working with a product manager to define a task specification.
You are running inside the project's repository — use the project's CLAUDE.md, AGENTS.md, and codebase context to make your spec and questions highly relevant to this specific project.

## Instructions

1. **Be conversational** — acknowledge what the user said, then build on it.
2. **Ask one clarifying question at a time** — don't overwhelm with multiple questions.
3. **Propose 2-3 approaches with tradeoffs** when there are design decisions to make.
4. **Update spec fields incrementally** — only change fields where the conversation provides new information. Never regress filled fields to empty.
5. **Focus on WHAT and WHY, not HOW** — avoid implementation details, tech stack, or code structure.
6. **User scenarios** should use Given/When/Then format with P1/P2/P3 priority levels.
7. **Success criteria** must be measurable and technology-agnostic.

## Completion Criteria

Set `isComplete` to true ONLY when:
- All 3 spec fields (goal, userScenarios, successCriteria) have substantive content
- No major ambiguities remain
- You have asked at least 2 clarifying questions across the conversation

If the user says "done", "good enough", "proceed", "ship it", or similar — set `isComplete` to true regardless.

## Response Format

At the end of your response, output a JSON block wrapped in triple backticks:

```json
{
  "specUpdates": {
    "goal": "Updated goal text or empty string to leave unchanged",
    "userScenarios": "Updated scenarios or empty string to leave unchanged",
    "successCriteria": "Updated criteria or empty string to leave unchanged"
  },
  "titleUpdate": "short imperative title, or null if no change",
  "descriptionUpdate": "1-2 sentence description, or null if no change",
  "riskLevelUpdate": "low|medium|high, or null if no change",
  "isComplete": false,
  "gaps": ["remaining gap 1", "remaining gap 2"]
}
```

IMPORTANT: Your conversational message goes BEFORE the JSON block. The JSON block must be the last thing in your response.
```

- [ ] **Step 2: Verify file exists and is valid**

Run: `cat prompts/brainstorming-system.md | head -5`
Expected: First 5 lines of the system prompt

- [ ] **Step 3: Commit**

```bash
git add prompts/brainstorming-system.md
git commit -m "feat: add brainstorming system prompt for persistent sessions"
```

---

### Task 5: Rewrite chat route to use session persistence

**Files:**
- Modify: `src/server/routes/chat.ts`

This is the main implementation task. The route changes from "replay full history + spawn fresh process" to "use `--session-id`/`--resume` + parse stream-json".

- [ ] **Step 1: Write the route integration test file**

Create `src/server/routes/chat.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../test/helpers.js';
import {
  createProject, createTask, getTaskById, updateTask,
  createChatMessage, listChatMessagesByTask,
} from '../../db/queries.js';
import type Database from 'better-sqlite3';

describe('chat session persistence (DB layer)', () => {
  let db: Database.Database;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, {
      name: 'test', path: '/tmp/test-chat-route',
      configPath: '/tmp/test-chat-route/.agentboard',
    });
    const task = createTask(db, { projectId: project.id, title: 'Test task' });
    taskId = task.id;
  });

  it('new task has null chatSessionId', () => {
    const task = getTaskById(db, taskId);
    expect(task?.chatSessionId).toBeNull();
  });

  it('chatSessionId roundtrips through updateTask', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    updateTask(db, taskId, { chatSessionId: sessionId });
    const task = getTaskById(db, taskId);
    expect(task?.chatSessionId).toBe(sessionId);
  });

  it('chatSessionId can be set to null', () => {
    updateTask(db, taskId, { chatSessionId: 'some-id' });
    updateTask(db, taskId, { chatSessionId: null });
    const task = getTaskById(db, taskId);
    expect(task?.chatSessionId).toBeNull();
  });
});

describe('parseResponseJson (unit)', () => {
  // These tests will import parseResponseJson once it's exported or
  // tested indirectly through the route. For now, test the logic inline.

  it('extracts spec updates from JSON block in text', () => {
    const text = 'Some response text\n\n```json\n{"specUpdates":{"goal":"Build X"},"isComplete":false}\n```';
    // Inline test of the regex + parse logic
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(fenceMatch).not.toBeNull();
    const parsed = JSON.parse(fenceMatch![1].trim());
    expect(parsed.specUpdates.goal).toBe('Build X');
    expect(parsed.isComplete).toBe(false);
  });

  it('returns defaults when no JSON block present', () => {
    const text = 'Just a plain response with no JSON';
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    expect(fenceMatch).toBeNull();
  });
});

describe('handleStreamEvent (unit)', () => {
  it('skips system events', () => {
    // System events should not affect state
    const state = { fullText: '', resumeFailed: false, resumeError: '' };
    const event = { type: 'system', subtype: 'hook_started' };
    // handleStreamEvent would return early — verify state unchanged
    expect(state.fullText).toBe('');
    expect(state.resumeFailed).toBe(false);
  });

  it('detects resume failure from result event', () => {
    const state = { fullText: '', resumeFailed: false, resumeError: '' };
    // Simulates what handleStreamEvent does for error_during_execution
    const event = {
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['No conversation found with session ID: abc123'],
    };
    const errors = event.errors as string[];
    const isResumeFail = errors.some((e) => e.includes('No conversation found'));
    expect(isResumeFail).toBe(true);
  });

  it('extracts fullText from successful result event', () => {
    const event = {
      type: 'result',
      subtype: 'success',
      result: 'Hello! How can I help?\n\n```json\n{"specUpdates":{},"isComplete":false}\n```',
    };
    const resultText = event.result as string;
    expect(resultText).toContain('Hello!');
    expect(resultText).toContain('specUpdates');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `npm test -- src/server/routes/chat.test.ts`
Expected: PASS (these are baseline tests)

- [ ] **Step 3: Rewrite `src/server/routes/chat.ts`**

Replace the entire file with the new implementation. Key changes:

1. Read `prompts/brainstorming-system.md` as the system prompt (cached at module load)
2. On POST, check `task.chatSessionId`:
   - **null** → first message: generate UUID, save to task, spawn with `--session-id <uuid>` + `--system-prompt`
   - **present** → subsequent message: spawn with `--resume <session-id>`
3. Pipe the message to stdin, close stdin
4. Parse stdout line-by-line as JSON:
   - `type === 'stream_event'` with `event.delta.type === 'text_delta'` → send SSE chunk
   - `type === 'result'` → parse `result` field for JSON block, persist, send SSE done
   - `type === 'result'` with `subtype === 'error_during_execution'` and "No conversation found" → fallback
5. Concurrency guard: `Set<string>` with try/finally cleanup
6. Fallback on resume failure: generate new UUID, build context from DB history, spawn fresh

```typescript
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { RiskLevel } from '../../types/index.js';
import * as queries from '../../db/queries.js';
import { broadcast } from '../ws.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.resolve(currentDir, '..', '..', '..', '..', 'prompts');

// Load system prompt once at module init
const systemPrompt = fs.readFileSync(
  path.join(promptsDir, 'brainstorming-system.md'),
  'utf-8'
);

// Concurrency guard: one in-flight chat request per task
const inFlightTasks = new Set<string>();

interface SSEChunkEvent {
  type: 'chunk';
  content: string;
}

interface SSEDoneEvent {
  type: 'done';
  message: string;
  specUpdates: Record<string, string>;
  titleUpdate: string | null;
  descriptionUpdate: string | null;
  riskLevelUpdate: RiskLevel | null;
  isComplete: boolean;
}

type SSEEvent = SSEChunkEvent | SSEDoneEvent;

function sendSSE(res: import('express').Response, event: SSEEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createChatRoutes(db: Database.Database, io: Server): Router {
  const router = Router();

  // GET /api/tasks/:id/chat/messages — retrieve persisted chat history
  router.get('/:id/chat/messages', (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const messages = queries.listChatMessagesByTask(db, task.id);
    res.json(messages);
  });

  // POST /api/tasks/:id/chat/stream — SSE streaming chat endpoint
  router.post('/:id/chat/stream', (req, res) => {
    const task = queries.getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const { message } = req.body as { message?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required and must be non-empty' });
      return;
    }

    // Concurrency guard
    if (inFlightTasks.has(task.id)) {
      res.status(409).json({ error: 'A chat request is already in progress for this task' });
      return;
    }
    inFlightTasks.add(task.id);

    // Persist user message
    queries.createChatMessage(db, {
      taskId: task.id,
      role: 'user',
      content: message.trim(),
    });

    // Look up project for cwd
    const project = queries.getProjectById(db, task.projectId);
    const projectPath = project?.path;

    // Determine first vs subsequent message
    const isFirstMessage = !task.chatSessionId;
    const sessionId = task.chatSessionId ?? uuidv4();

    // Save session ID on first message
    if (isFirstMessage) {
      queries.updateTask(db, task.id, { chatSessionId: sessionId });
    }

    // Build spawn args
    const args = buildSpawnArgs(isFirstMessage, sessionId);

    // Build stdin content
    const stdinContent = buildStdinContent(isFirstMessage, task, message.trim());

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Spawn claude process
    const spawnOpts = {
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
      cwd: projectPath ?? undefined,
    };

    console.log(`[http] /api/tasks/${task.id}/chat/stream spawning claude (${isFirstMessage ? 'new session' : 'resume'}: ${sessionId})`);
    const child = spawn('claude', args, spawnOpts);

    // Write prompt via stdin then close
    child.stdin.write(stdinContent);
    child.stdin.end();

    const streamState: StreamState = { fullText: '', resumeFailed: false, resumeError: '' };
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
    }, 120_000);

    // Parse stream-json stdout line by line
    let lineBuffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          handleStreamEvent(event, res, io, task.id, streamState);
        } catch {
          // Skip malformed JSON lines
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Handle client disconnect
    res.on('close', () => {
      clearTimeout(timer);
      child.kill();
      inFlightTasks.delete(task.id);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      inFlightTasks.delete(task.id);

      // Process any remaining buffered line
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer) as Record<string, unknown>;
          handleStreamEvent(event, res, io, task.id, streamState);
        } catch {
          // ignore
        }
      }

      // Handle resume failure — fallback to fresh session with history replay
      if (streamState.resumeFailed) {
        console.log(`[http] /api/tasks/${task.id}/chat/stream resume failed: ${streamState.resumeError}, falling back to fresh session`);
        spawnFallbackSession(db, io, task, message.trim(), projectPath, res);
        return;
      }

      if (code !== 0 && !streamState.fullText) {
        console.log(`[http] /api/tasks/${task.id}/chat/stream failed: code=${code} stderr=${stderr}`);
        sendSSE(res, {
          type: 'done',
          message: `AI chat failed: ${stderr || 'unknown error'}`,
          specUpdates: {},
          titleUpdate: null,
          descriptionUpdate: null,
          riskLevelUpdate: null,
          isComplete: false,
        });
        res.end();
        return;
      }

      // Parse the full response text for the JSON block
      const parsed = parseResponseJson(streamState.fullText);
      const messageText = extractMessageText(streamState.fullText, parsed.message);

      // Persist assistant message
      queries.createChatMessage(db, {
        taskId: task.id,
        role: 'assistant',
        content: messageText,
      });

      // Persist spec & meta updates
      const taskUpdate: Parameters<typeof queries.updateTask>[2] = {};
      if (Object.keys(parsed.specUpdates).length > 0) {
        const existingSpec = parseSpecJson(task.spec);
        for (const [key, val] of Object.entries(parsed.specUpdates)) {
          if (typeof val === 'string' && (val.trim().length > 0 || !existingSpec[key]?.trim())) {
            existingSpec[key] = val;
          }
        }
        taskUpdate.spec = JSON.stringify(existingSpec);
      }
      if (parsed.titleUpdate) taskUpdate.title = parsed.titleUpdate;
      if (parsed.descriptionUpdate) taskUpdate.description = parsed.descriptionUpdate;
      if (parsed.riskLevelUpdate) taskUpdate.riskLevel = parsed.riskLevelUpdate;

      if (Object.keys(taskUpdate).length > 0) {
        queries.updateTask(db, task.id, taskUpdate);
      }

      // Send final SSE event
      sendSSE(res, {
        type: 'done',
        message: messageText,
        specUpdates: parsed.specUpdates,
        titleUpdate: parsed.titleUpdate,
        descriptionUpdate: parsed.descriptionUpdate,
        riskLevelUpdate: parsed.riskLevelUpdate,
        isComplete: parsed.isComplete,
      });

      res.end();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      inFlightTasks.delete(task.id);
      console.log(`[http] /api/tasks/${task.id}/chat/stream spawn error: ${err.message}`);
      sendSSE(res, {
        type: 'done',
        message: `Failed to spawn claude: ${err.message}`,
        specUpdates: {},
        titleUpdate: null,
        descriptionUpdate: null,
        riskLevelUpdate: null,
        isComplete: false,
      });
      res.end();
    });
  });

  return router;
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildSpawnArgs(isFirstMessage: boolean, sessionId: string): string[] {
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (isFirstMessage) {
    args.push('--system-prompt', systemPrompt);
    args.push('--session-id', sessionId);
  } else {
    args.push('--resume', sessionId);
  }

  return args;
}

function buildStdinContent(
  isFirstMessage: boolean,
  task: { title: string; description: string; spec: string | null },
  message: string
): string {
  if (isFirstMessage) {
    const specContext = [
      '## Current Spec State',
      `Title: ${task.title || '(empty)'}`,
      `Description: ${task.description || '(empty)'}`,
      `Goal: ${getSpecField(task.spec, 'goal')}`,
      `User Scenarios: ${getSpecField(task.spec, 'userScenarios')}`,
      `Success Criteria: ${getSpecField(task.spec, 'successCriteria')}`,
      '',
      '## PM Message',
      message,
    ].join('\n');
    return specContext;
  }
  return message;
}

/** Tracks whether the result event indicated a resume failure */
interface StreamState {
  fullText: string;
  resumeFailed: boolean;
  resumeError: string;
}

function handleStreamEvent(
  event: Record<string, unknown>,
  res: import('express').Response,
  io: Server,
  taskId: string,
  state: StreamState
): void {
  const eventType = event.type as string;

  if (eventType === 'system') return; // Skip system/hook events

  if (eventType === 'stream_event') {
    // Extract text delta from partial message — stream to browser
    const innerEvent = event.event as Record<string, unknown> | undefined;
    const delta = innerEvent?.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      sendSSE(res, { type: 'chunk', content: delta.text });
      broadcast(io, 'task:chat', { taskId, chunk: delta.text });
      // Don't accumulate — result event has authoritative text
    }
    return;
  }

  // Skip assistant event — it duplicates stream_event content.
  // The result event's `result` field is the authoritative full text.
  if (eventType === 'assistant') return;

  if (eventType === 'result') {
    const subtype = event.subtype as string;

    // Check for resume failure
    if (subtype === 'error_during_execution') {
      const errors = event.errors as string[] | undefined;
      const isResumeFail = errors?.some((e) => e.includes('No conversation found'));
      if (isResumeFail) {
        state.resumeFailed = true;
        state.resumeError = errors?.join('; ') ?? 'Resume failed';
      }
      return;
    }

    // Use result field as authoritative full text (replaces any partial accumulation)
    const resultText = event.result as string | undefined;
    if (typeof resultText === 'string') {
      state.fullText = resultText;
    }
    return;
  }
}

function getSpecField(spec: string | null, field: string): string {
  if (!spec) return '(empty)';
  try {
    const parsed = JSON.parse(spec) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === 'string' && value.trim() ? value : '(empty)';
  } catch {
    return '(empty)';
  }
}

interface ParsedResponse {
  message: string;
  specUpdates: Record<string, string>;
  titleUpdate: string | null;
  descriptionUpdate: string | null;
  riskLevelUpdate: RiskLevel | null;
  isComplete: boolean;
}

function parseResponseJson(fullOutput: string): ParsedResponse {
  const defaults: ParsedResponse = {
    message: '',
    specUpdates: {},
    titleUpdate: null,
    descriptionUpdate: null,
    riskLevelUpdate: null,
    isComplete: false,
  };

  const fenceMatch = fullOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!fenceMatch) return defaults;

  try {
    const parsed = JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;

    const specUpdates: Record<string, string> = {};
    if (parsed.specUpdates && typeof parsed.specUpdates === 'object') {
      for (const [key, val] of Object.entries(parsed.specUpdates as Record<string, unknown>)) {
        if (typeof val === 'string') {
          specUpdates[key] = val;
        }
      }
    }

    const validRiskLevels: RiskLevel[] = ['low', 'medium', 'high'];
    const riskLevelRaw = typeof parsed.riskLevelUpdate === 'string' ? parsed.riskLevelUpdate : null;
    const riskLevel = riskLevelRaw && validRiskLevels.includes(riskLevelRaw as RiskLevel)
      ? (riskLevelRaw as RiskLevel)
      : null;

    return {
      message: typeof parsed.message === 'string' ? parsed.message : '',
      specUpdates,
      titleUpdate: typeof parsed.titleUpdate === 'string' ? parsed.titleUpdate : null,
      descriptionUpdate: typeof parsed.descriptionUpdate === 'string' ? parsed.descriptionUpdate : null,
      riskLevelUpdate: riskLevel,
      isComplete: !!parsed.isComplete,
    };
  } catch {
    return defaults;
  }
}

function parseSpecJson(spec: string | null): Record<string, string> {
  if (!spec) return {};
  try {
    return JSON.parse(spec) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Fallback: when --resume fails ("No conversation found"), generate a new session
 * and replay chat history from DB as context in the first message.
 */
function spawnFallbackSession(
  db: Database.Database,
  io: Server,
  task: { id: string; projectId: string; title: string; description: string; spec: string | null },
  currentMessage: string,
  projectPath: string | undefined,
  res: import('express').Response
): void {
  const newSessionId = uuidv4();
  queries.updateTask(db, task.id, { chatSessionId: newSessionId });

  // Build context from DB history
  const chatHistory = queries.listChatMessagesByTask(db, task.id);
  // Exclude the current user message (already at the end) from history
  const historyMessages = chatHistory.slice(0, -1);
  const historyText = historyMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const specContext = [
    '## Current Spec State',
    `Title: ${task.title || '(empty)'}`,
    `Description: ${task.description || '(empty)'}`,
    `Goal: ${getSpecField(task.spec, 'goal')}`,
    `User Scenarios: ${getSpecField(task.spec, 'userScenarios')}`,
    `Success Criteria: ${getSpecField(task.spec, 'successCriteria')}`,
  ].join('\n');

  const stdinContent = historyText
    ? `${specContext}\n\n## Previous Conversation\n\n${historyText}\n\n## New Message\n\n${currentMessage}`
    : `${specContext}\n\n## PM Message\n\n${currentMessage}`;

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt', systemPrompt,
    '--session-id', newSessionId,
  ];

  console.log(`[http] /api/tasks/${task.id}/chat/stream fallback: new session ${newSessionId}`);

  const fallbackState: StreamState = { fullText: '', resumeFailed: false, resumeError: '' };

  const child = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDECODE: undefined },
    cwd: projectPath ?? undefined,
  });

  child.stdin.write(stdinContent);
  child.stdin.end();

  const fallbackTimer = setTimeout(() => { child.kill(); }, 120_000);

  let fallbackLineBuffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    fallbackLineBuffer += chunk.toString();
    const lines = fallbackLineBuffer.split('\n');
    fallbackLineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        handleStreamEvent(event, res, io, task.id, fallbackState);
      } catch { /* skip */ }
    }
  });

  child.on('close', () => {
    clearTimeout(fallbackTimer);
    // Process remaining buffer
    if (fallbackLineBuffer.trim()) {
      try {
        const event = JSON.parse(fallbackLineBuffer) as Record<string, unknown>;
        handleStreamEvent(event, res, io, task.id, fallbackState);
      } catch { /* ignore */ }
    }

    const parsed = parseResponseJson(fallbackState.fullText);
    const messageText = extractMessageText(fallbackState.fullText, parsed.message);

    queries.createChatMessage(db, { taskId: task.id, role: 'assistant', content: messageText });

    const taskUpdate: Parameters<typeof queries.updateTask>[2] = {};
    if (Object.keys(parsed.specUpdates).length > 0) {
      const existingSpec = parseSpecJson(task.spec);
      for (const [key, val] of Object.entries(parsed.specUpdates)) {
        if (typeof val === 'string' && (val.trim().length > 0 || !existingSpec[key]?.trim())) {
          existingSpec[key] = val;
        }
      }
      taskUpdate.spec = JSON.stringify(existingSpec);
    }
    if (parsed.titleUpdate) taskUpdate.title = parsed.titleUpdate;
    if (parsed.descriptionUpdate) taskUpdate.description = parsed.descriptionUpdate;
    if (parsed.riskLevelUpdate) taskUpdate.riskLevel = parsed.riskLevelUpdate;
    if (Object.keys(taskUpdate).length > 0) queries.updateTask(db, task.id, taskUpdate);

    sendSSE(res, {
      type: 'done',
      message: messageText,
      specUpdates: parsed.specUpdates,
      titleUpdate: parsed.titleUpdate,
      descriptionUpdate: parsed.descriptionUpdate,
      riskLevelUpdate: parsed.riskLevelUpdate,
      isComplete: parsed.isComplete,
    });
    res.end();
  });

  child.on('error', (err) => {
    clearTimeout(fallbackTimer);
    sendSSE(res, {
      type: 'done',
      message: `Fallback session failed: ${err.message}`,
      specUpdates: {},
      titleUpdate: null,
      descriptionUpdate: null,
      riskLevelUpdate: null,
      isComplete: false,
    });
    res.end();
  });
}

function extractMessageText(fullOutput: string, parsedMessage: string): string {
  const fenceStart = fullOutput.indexOf('```json');
  const altFenceStart = fullOutput.indexOf('```\n{');
  const cutPoint = fenceStart >= 0 ? fenceStart : altFenceStart;

  if (cutPoint > 0) {
    const textBefore = fullOutput.substring(0, cutPoint).trim();
    if (textBefore.length > 0) return textBefore;
  }

  if (parsedMessage) return parsedMessage;
  return fullOutput.trim();
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/chat.ts src/server/routes/chat.test.ts
git commit -m "feat: rewrite chat route to use claude session persistence"
```

---

### Task 6: Delete old brainstorming template

**Files:**
- Delete: `prompts/brainstorming.md`

- [ ] **Step 1: Verify no other code references brainstorming.md**

Run: `grep -r "brainstorming.md" src/ --include="*.ts" | grep -v brainstorming-system`
Expected: No results (the old chat.ts was the only consumer, now rewritten)

If there ARE references, do NOT delete — update them to use `brainstorming-system.md` instead.

- [ ] **Step 2: Delete the file (only if no references found)**

```bash
rm prompts/brainstorming.md
```

- [ ] **Step 3: Commit**

```bash
git add -A prompts/
git commit -m "chore: remove old brainstorming template (replaced by brainstorming-system.md)"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All PASS

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean compile with no errors

- [ ] **Step 3: Manual smoke test (if server available)**

1. Start the server: `npm run dev`
2. Open a task in backlog
3. Send a chat message
4. Verify: response streams back, spec fields update, session persists across messages
5. Send a second message — verify it doesn't replay history (faster response, lower token count in logs)

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
