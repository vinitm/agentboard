# Superpowers-Inspired Task Workflow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace agentboard's task pipeline with a superpowers-inspired workflow: conversational spec building with streaming, automated spec review, bite-sized TDD subtasks, single-shot implementation with inline fix, per-subtask code quality review, and holistic final review.

**Architecture:** Foundation-first approach — update types and DB schema, then build new stages bottom-up, rewrite the worker loop to use them, and finally update the UI for streaming chat and new stage indicators. Each phase produces working, testable software.

**Tech Stack:** TypeScript, Express, SQLite (better-sqlite3), Socket.IO, React + Tailwind, Claude Code CLI

**Spec:** See `docs/architecture/007-superpowers-workflow.md`

---

## File Structure

### New files
- `src/types/index.ts` — modified (new TaskStatus, Stage, interfaces)
- `src/db/schema.ts` — modified (chat_messages table, migration)
- `src/db/queries.ts` — modified (chat message CRUD)
- `src/worker/stages/spec-review.ts` — NEW stage
- `src/worker/stages/code-quality.ts` — NEW stage (replaces review-panel)
- `src/worker/stages/final-review.ts` — NEW stage
- `src/worker/inline-fix.ts` — NEW (replaces ralph-loop.ts)
- `src/server/routes/chat.ts` — NEW (streaming chat endpoint)
- `prompts/spec-review.md` — NEW prompt template
- `prompts/code-quality.md` — NEW prompt template
- `prompts/final-review.md` — NEW prompt template
- `prompts/plan-review.md` — NEW prompt template
- `prompts/implementer-v2.md` — NEW (structured status output)
- `ui/src/components/ChatPanel.tsx` — NEW (streaming chat for spec building)

### Modified files
- `src/worker/stages/planner.ts` — bite-sized TDD subtasks + auto plan review
- `src/worker/stages/implementer.ts` — structured status, self-review
- `src/worker/loop.ts` — complete rewrite for new pipeline
- `src/worker/model-selector.ts` — simplified (opus everywhere)
- `src/worker/context-builder.ts` — support new plan format
- `src/server/routes/tasks.ts` — new statuses, chat streaming, remove refine-field
- `ui/src/components/TaskForm.tsx` — streaming chat integration
- `ui/src/components/TaskCard.tsx` — new status badges
- `ui/src/components/TaskPage.tsx` — new stage indicators
- `ui/src/components/Board.tsx` — new column statuses
- `ui/src/types.ts` — new types

### Removed files
- `src/worker/ralph-loop.ts` — replaced by inline-fix.ts
- `src/worker/stages/review-panel.ts` — replaced by code-quality.ts
- `prompts/review-architect.md` — folded into code-quality.md
- `prompts/review-qa.md` — folded into code-quality.md
- `prompts/review-security.md` — folded into code-quality.md
- `prompts/implementer-fallback.md` — no longer needed (no ralph loop)

---

## Task 1: Update Types and Interfaces

**Files:**
- Modify: `src/types/index.ts`
- Test: `src/types/index.test.ts` (type-level verification via build)

- [ ] **Step 1: Write type tests that import the new types**

Create `src/types/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type {
  TaskStatus, Stage, ImplementerStatus, ImplementationResult,
  SpecReviewResult, ChatMessage,
} from './index.js';

describe('types', () => {
  it('TaskStatus includes new statuses', () => {
    const statuses: TaskStatus[] = [
      'backlog', 'ready', 'spec_review', 'planning', 'needs_plan_review',
      'implementing', 'checks', 'code_quality', 'final_review',
      'pr_creation', 'needs_human_review', 'done', 'blocked', 'failed', 'cancelled',
    ];
    expect(statuses).toHaveLength(15);
  });

  it('Stage includes new stages', () => {
    const stages: Stage[] = [
      'spec_review', 'planning', 'implementing', 'checks',
      'code_quality', 'final_review', 'pr_creation',
    ];
    expect(stages).toHaveLength(7);
  });

  it('ImplementerStatus has 4 values', () => {
    const statuses: ImplementerStatus[] = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'];
    expect(statuses).toHaveLength(4);
  });

  it('ImplementationResult has structured fields', () => {
    const result: ImplementationResult = {
      status: 'DONE',
      output: 'test output',
    };
    expect(result.status).toBe('DONE');
  });

  it('ChatMessage has required fields', () => {
    const msg: ChatMessage = {
      id: '1', taskId: 't1', role: 'user', content: 'hello', createdAt: 'now',
    };
    expect(msg.role).toBe('user');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/types/index.test.ts`
Expected: FAIL — types don't exist yet

- [ ] **Step 3: Update types in src/types/index.ts**

Replace TaskStatus:
```typescript
export type TaskStatus =
  | 'backlog' | 'ready'
  | 'spec_review'
  | 'planning' | 'needs_plan_review'
  | 'implementing'
  | 'checks'
  | 'code_quality'
  | 'final_review'
  | 'pr_creation'
  | 'needs_human_review'
  | 'done' | 'blocked' | 'failed' | 'cancelled';
```

Replace Stage:
```typescript
export type Stage =
  | 'spec_review'
  | 'planning'
  | 'implementing'
  | 'checks'
  | 'code_quality'
  | 'final_review'
  | 'pr_creation';
```

Add new interfaces:
```typescript
export type ImplementerStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED';

export interface ImplementationResult {
  status: ImplementerStatus;
  output: string;
  concerns?: string[];
  contextNeeded?: string[];
  blockerReason?: string;
}

export interface SpecReviewResult {
  passed: boolean;
  issues: Array<{
    field: 'goal' | 'userScenarios' | 'successCriteria';
    severity: 'critical' | 'warning';
    message: string;
  }>;
  suggestions: string[];
}

export interface ChatMessage {
  id: string;
  taskId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface CodeQualityResult {
  passed: boolean;
  issues: Array<{
    severity: 'critical' | 'important' | 'minor';
    category: 'quality' | 'testing' | 'security' | 'architecture';
    message: string;
    file?: string;
    line?: number;
  }>;
  summary: string;
}

export interface FinalReviewResult {
  passed: boolean;
  specCompliance: {
    criterionMet: Record<string, boolean>;
    missingRequirements: string[];
  };
  integrationIssues: string[];
  summary: string;
}
```

Remove deprecated `'spec'` from TaskStatus. Remove old `ImplementationResult` from `stages/implementer.ts` (will be moved here).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/types/index.test.ts`
Expected: PASS

- [ ] **Step 5: Run full build to check for breakage**

Run: `npm run build`
Expected: Type errors in files still referencing old `'spec'` stage and `'review_panel'` status — that's expected, we'll fix them in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/types/index.test.ts
git commit -m "feat: update types for superpowers workflow — new statuses, stages, interfaces"
```

---

## Task 2: DB Schema — Add chat_messages Table and Migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/queries.ts`
- Test: `src/db/schema.test.ts` (new), `src/db/queries.test.ts` (existing — add chat message tests)

- [ ] **Step 1: Write failing tests for chat message CRUD**

Add to a new file `src/db/chat-queries.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../test/helpers.js';
import {
  createChatMessage, listChatMessagesByTask, deleteChatMessagesByTask,
} from './queries.js';
import { createProject, createTask } from './queries.js';
import type Database from 'better-sqlite3';

describe('chat message queries', () => {
  let db: Database.Database;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, { name: 'test', path: '/tmp/test', configPath: '/tmp/test/.agentboard' });
    const task = createTask(db, { projectId: project.id, title: 'Test task' });
    taskId = task.id;
  });

  it('creates and lists chat messages', () => {
    createChatMessage(db, { taskId, role: 'user', content: 'hello' });
    createChatMessage(db, { taskId, role: 'assistant', content: 'hi back' });
    const messages = listChatMessagesByTask(db, taskId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('deletes all messages for a task', () => {
    createChatMessage(db, { taskId, role: 'user', content: 'hello' });
    deleteChatMessagesByTask(db, taskId);
    expect(listChatMessagesByTask(db, taskId)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/db/chat-queries.test.ts`
Expected: FAIL — functions don't exist yet

- [ ] **Step 3: Add chat_messages table to schema.ts**

Add to the DDL string in `src/db/schema.ts`:
```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_task_id ON chat_messages(task_id);
```

Add migration function to rename `review_panel` → `code_quality` in existing data:
```typescript
export function migrateToSuperpowersWorkflow(db: Database.Database): void {
  // Rename review_panel status to code_quality
  db.prepare(`UPDATE tasks SET status = 'code_quality' WHERE status = 'review_panel'`).run();
  db.prepare(`UPDATE runs SET stage = 'code_quality' WHERE stage = 'review_panel'`).run();
  // Remove deprecated 'spec' status
  db.prepare(`UPDATE tasks SET status = 'backlog' WHERE status = 'spec'`).run();
  db.prepare(`UPDATE runs SET stage = 'spec_review' WHERE stage = 'spec'`).run();
}
```

Call from `initSchema`.

- [ ] **Step 4: Add chat message query functions to queries.ts**

```typescript
// ── Chat Messages ─────────────────────────────────────────────────────

function rowToChatMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    role: row.role as 'user' | 'assistant',
    content: row.content as string,
    createdAt: row.created_at as string,
  };
}

export interface CreateChatMessageData {
  taskId: string;
  role: 'user' | 'assistant';
  content: string;
}

export function createChatMessage(
  db: Database.Database,
  data: CreateChatMessageData
): ChatMessage {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_messages (id, task_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, data.taskId, data.role, data.content, now);
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as Record<string, unknown>;
  return rowToChatMessage(row);
}

export function listChatMessagesByTask(
  db: Database.Database,
  taskId: string
): ChatMessage[] {
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as Record<string, unknown>[];
  return rows.map(rowToChatMessage);
}

export function deleteChatMessagesByTask(
  db: Database.Database,
  taskId: string
): void {
  db.prepare('DELETE FROM chat_messages WHERE task_id = ?').run(taskId);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/db/chat-queries.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/queries.ts src/db/chat-queries.test.ts
git commit -m "feat: add chat_messages table and CRUD queries"
```

---

## Task 3: Streaming Chat Endpoint for Spec Building

**Files:**
- Create: `src/server/routes/chat.ts`
- Test: `src/server/routes/chat.test.ts`
- Modify: `src/server/routes/tasks.ts` (remove old /chat endpoint, update AGENT_CONTROLLED_COLUMNS)

- [ ] **Step 1: Write failing test for streaming chat route**

Create `src/server/routes/chat.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../test/helpers.js';
import { createTestApp } from '../../test/helpers.js';
import { createProject, createTask, listChatMessagesByTask } from '../../db/queries.js';
import type Database from 'better-sqlite3';

describe('POST /api/tasks/:id/chat/stream', () => {
  let db: Database.Database;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, { name: 'test', path: '/tmp/test', configPath: '/tmp/test/.agentboard' });
    const task = createTask(db, { projectId: project.id, title: 'Test task' });
    taskId = task.id;
  });

  it('rejects empty message', async () => {
    const { app } = createTestApp(db);
    const res = await app.post(`/api/tasks/${taskId}/chat/stream`).send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('rejects non-existent task', async () => {
    const { app } = createTestApp(db);
    const res = await app.post('/api/tasks/nonexistent/chat/stream').send({ message: 'hello' });
    expect(res.status).toBe(404);
  });

  it('persists user message to chat_messages', async () => {
    const { app } = createTestApp(db);
    // This will fail because claude isn't available in test, but the message should be persisted
    await app.post(`/api/tasks/${taskId}/chat/stream`).send({ message: 'hello' }).catch(() => {});
    const messages = listChatMessagesByTask(db, taskId);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/routes/chat.test.ts`
Expected: FAIL — route doesn't exist yet

- [ ] **Step 3: Implement streaming chat route**

Create `src/server/routes/chat.ts`:

The endpoint:
1. Receives `{ message: string }` from PM
2. Persists user message to `chat_messages` table
3. Loads full chat history for context
4. Spawns `claude --print` with superpowers brainstorming prompt
5. Streams stdout chunks via SSE (Server-Sent Events) to the client
6. When complete, persists assistant message to `chat_messages`
7. Parses structured JSON from the response to update spec fields
8. Emits `task:chat` Socket.IO event with each chunk for real-time UI

Key implementation details:
- Use `res.writeHead(200, { 'Content-Type': 'text/event-stream' })` for SSE
- Each chunk: `data: ${JSON.stringify({ type: 'chunk', content: chunkText })}\n\n`
- Final message: `data: ${JSON.stringify({ type: 'done', specUpdates, titleUpdate, ... })}\n\n`
- Also emit Socket.IO `task:chat` events for other connected clients
- Brainstorming prompt loaded from `prompts/brainstorming.md`

- [ ] **Step 4: Create brainstorming prompt template**

Create `prompts/brainstorming.md` — adapted from superpowers brainstorming skill, but for the agentboard context:
- Explores project context
- Asks one question at a time
- Proposes 2-3 approaches with recommendation
- Updates spec fields incrementally
- Returns structured JSON at the end

- [ ] **Step 5: Update AGENT_CONTROLLED_COLUMNS in tasks.ts**

Replace:
```typescript
const AGENT_CONTROLLED_COLUMNS: TaskStatus[] = [
  'spec_review', 'planning', 'needs_plan_review', 'implementing',
  'checks', 'code_quality', 'final_review', 'pr_creation',
];
```

- [ ] **Step 6: Run tests**

Run: `npm test -- src/server/routes/chat.test.ts`
Expected: PASS (at least for validation tests)

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/chat.ts src/server/routes/chat.test.ts prompts/brainstorming.md src/server/routes/tasks.ts
git commit -m "feat: add streaming chat endpoint for conversational spec building"
```

---

## Task 4: Spec Review Stage

**Files:**
- Create: `src/worker/stages/spec-review.ts`
- Create: `src/worker/stages/spec-review.test.ts`
- Create: `prompts/spec-review.md`

- [ ] **Step 1: Write failing test**

Create `src/worker/stages/spec-review.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../test/helpers.js';
import { createProject, createTask } from '../../db/queries.js';
import type Database from 'better-sqlite3';

describe('spec-review stage', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('exports runSpecReview function', async () => {
    const { runSpecReview } = await import('./spec-review.js');
    expect(typeof runSpecReview).toBe('function');
  });

  it('fails when spec fields are empty', async () => {
    const { runSpecReview } = await import('./spec-review.js');
    const project = createProject(db, { name: 'test', path: '/tmp/test', configPath: '/tmp/test/.agentboard' });
    const task = createTask(db, {
      projectId: project.id,
      title: 'Test',
      spec: JSON.stringify({ goal: '', userScenarios: '', successCriteria: '' }),
    });

    const result = await runSpecReview(db, task);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/worker/stages/spec-review.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement spec-review stage**

Create `src/worker/stages/spec-review.ts`:
- Parse task.spec JSON
- Check completeness (all 3 fields non-empty)
- Check testability (acceptance criteria should be verifiable)
- Check scope (not too broad)
- Use Claude to check for ambiguity and contradictions
- Return `SpecReviewResult`

- [ ] **Step 4: Create prompt template**

Create `prompts/spec-review.md`

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/worker/stages/spec-review.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/worker/stages/spec-review.ts src/worker/stages/spec-review.test.ts prompts/spec-review.md
git commit -m "feat: add spec-review stage — automated spec quality gate"
```

---

## Task 5: Code Quality Stage (Replaces Review Panel)

**Files:**
- Create: `src/worker/stages/code-quality.ts`
- Create: `src/worker/stages/code-quality.test.ts`
- Create: `prompts/code-quality.md`

- [ ] **Step 1: Write failing test**

Create `src/worker/stages/code-quality.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('code-quality stage', () => {
  it('exports runCodeQuality function', async () => {
    const { runCodeQuality } = await import('./code-quality.js');
    expect(typeof runCodeQuality).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/worker/stages/code-quality.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement code-quality stage**

Create `src/worker/stages/code-quality.ts`:
- Single reviewer (replaces 3 parallel reviewers)
- Reviews git diff for the subtask
- Checks: code quality, test quality, security, architecture
- Issues rated: Critical / Important / Minor
- Returns `CodeQualityResult`
- Uses `executeClaudeCode` with `prompts/code-quality.md`

- [ ] **Step 4: Create prompt template**

Create `prompts/code-quality.md` — combines architect + QA + security review roles into one focused review.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/worker/stages/code-quality.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/worker/stages/code-quality.ts src/worker/stages/code-quality.test.ts prompts/code-quality.md
git commit -m "feat: add code-quality stage — single reviewer replacing 3-reviewer panel"
```

---

## Task 6: Final Review Stage

**Files:**
- Create: `src/worker/stages/final-review.ts`
- Create: `src/worker/stages/final-review.test.ts`
- Create: `prompts/final-review.md`

- [ ] **Step 1: Write failing test**

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement final-review stage**

Create `src/worker/stages/final-review.ts`:
- Holistic review of all changes across all subtasks
- Cross-file consistency check
- Integration issue detection
- Spec compliance: checks ALL acceptance criteria from original spec
- Returns `FinalReviewResult`

- [ ] **Step 4: Create prompt template `prompts/final-review.md`**

- [ ] **Step 5: Run test to verify it passes**

- [ ] **Step 6: Commit**

```bash
git add src/worker/stages/final-review.ts src/worker/stages/final-review.test.ts prompts/final-review.md
git commit -m "feat: add final-review stage — holistic cross-subtask review with spec compliance"
```

---

## Task 7: Modified Implementer — Structured Status and Self-Review

**Files:**
- Modify: `src/worker/stages/implementer.ts`
- Create: `prompts/implementer-v2.md`

- [ ] **Step 1: Write failing test for structured status**

Add to existing implementer tests or create `src/worker/stages/implementer-v2.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { ImplementationResult } from '../../types/index.js';

describe('implementer v2', () => {
  it('ImplementationResult supports all statuses', () => {
    const results: ImplementationResult[] = [
      { status: 'DONE', output: 'ok' },
      { status: 'DONE_WITH_CONCERNS', output: 'ok', concerns: ['file growing large'] },
      { status: 'NEEDS_CONTEXT', output: '', contextNeeded: ['what DB schema to use?'] },
      { status: 'BLOCKED', output: '', blockerReason: 'conflicting requirements' },
    ];
    expect(results).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Update implementer.ts**

Key changes:
- Return `ImplementationResult` (from types/index.ts) instead of `{ success: boolean; output: string }`
- Parse structured JSON output from Claude (status, concerns, contextNeeded, blockerReason)
- Include self-review instruction in prompt
- Remove `useFallbackPrompt` parameter (no more ralph loop)

- [ ] **Step 4: Create `prompts/implementer-v2.md`**

New prompt that instructs Claude to:
- Follow TDD steps from the subtask plan
- Self-review before reporting done
- Return structured JSON with status field
- Report NEEDS_CONTEXT or BLOCKED instead of guessing

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS (may need to update other tests referencing old ImplementationResult)

- [ ] **Step 6: Commit**

```bash
git add src/worker/stages/implementer.ts prompts/implementer-v2.md
git commit -m "feat: implementer with structured status reporting and self-review"
```

---

## Task 8: Inline Fix (Replaces Ralph Loop)

**Files:**
- Create: `src/worker/inline-fix.ts`
- Create: `src/worker/inline-fix.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';

describe('inline-fix', () => {
  it('exports runInlineFix function', async () => {
    const { runInlineFix } = await import('./inline-fix.js');
    expect(typeof runInlineFix).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement inline-fix.ts**

```typescript
interface InlineFixOptions {
  db: Database.Database;
  task: Task;
  worktreePath: string;
  config: AgentboardConfig;
  failedChecks: CheckResult[];
  onOutput?: (chunk: string) => void;
}

interface InlineFixResult {
  fixed: boolean;
  output: string;
}
```

Logic:
1. Receives failed check results
2. Spawns fresh Claude session with failure context
3. Claude fixes the specific issues (not re-implementing)
4. Re-runs checks
5. Returns { fixed: true/false }

One attempt only. If it fails again → escalate.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/worker/inline-fix.ts src/worker/inline-fix.test.ts
git commit -m "feat: add inline-fix — single-shot fix for check failures (replaces ralph loop)"
```

---

## Task 9: Modified Planner — Bite-Sized TDD Subtasks + Auto Plan Review

**Files:**
- Modify: `src/worker/stages/planner.ts`
- Create: `prompts/planner-v2.md`
- Create: `prompts/plan-review.md`

- [ ] **Step 1: Write failing test for new plan format**

Test that planner output includes TDD steps, file paths, and code snippets in subtasks.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Update planner.ts**

Key changes:
- Use new prompt template (`prompts/planner-v2.md`) that instructs Claude to:
  - Break into bite-sized subtasks (planner decides granularity)
  - Each subtask has TDD steps with exact file paths and code
  - Include fileMap[] showing which files are created/modified
- Add auto plan review: after planning, run plan-review prompt to validate
  - Every subtask has test + verify steps
  - No missing dependencies
  - Scope matches spec
  - Max 3 auto-review retries

- [ ] **Step 4: Create prompt templates**

`prompts/planner-v2.md` and `prompts/plan-review.md`

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add src/worker/stages/planner.ts prompts/planner-v2.md prompts/plan-review.md
git commit -m "feat: planner produces bite-sized TDD subtasks with auto plan review"
```

---

## Task 10: Worker Loop Rewrite

**Files:**
- Modify: `src/worker/loop.ts`
- Modify: `src/worker/model-selector.ts`

This is the biggest task. The worker loop needs to implement the new pipeline:

```
ready → spec_review → planning → needs_plan_review → implementing
  [per-subtask: implement → checks → (inline fix) → code_quality]
  → final_review → pr_creation → auto-merge gate → done
```

- [ ] **Step 1: Write failing test for new pipeline flow**

Add to `src/worker/stages/autonomous-pipeline.test.ts` (existing file):
- Test that spec_review runs after claiming a ready task
- Test that code_quality runs per subtask (not review_panel)
- Test that final_review runs after all subtasks complete

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Simplify model-selector.ts**

```typescript
export function selectModel(
  _stage: Stage,
  _riskLevel: RiskLevel,
  _config: AgentboardConfig
): string {
  return 'opus';
}
```

- [ ] **Step 4: Rewrite processTask() in loop.ts**

New flow:
1. Claim task, create worktree
2. If no approved plan: run spec_review → planning → pause at needs_plan_review
3. If approved plan: create subtasks, process them serially
4. Per subtask: implement → checks → (inline fix if fail) → code_quality → done
5. After all subtasks: final_review → pr_creation → auto-merge gate

Replace `runImplementationLoop` and `runReviewAndPR` with new functions:
- `processSubtaskV2()` — implement + checks + inline fix + code quality
- `runFinalReviewAndPR()` — final review + PR creation + auto-merge

Remove all references to `runRalphLoop` and `runReviewPanel`.

- [ ] **Step 5: Handle implementer structured status in processSubtaskV2**

```
DONE / DONE_WITH_CONCERNS → proceed to checks
NEEDS_CONTEXT → provide context, re-dispatch
BLOCKED → task → blocked, notify human
```

- [ ] **Step 6: Handle code quality review loop in processSubtaskV2**

```
pass → subtask done
critical/important issues → re-dispatch implementer to fix → re-review
max 2 cycles → escalate to human
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS (all tests)

Run: `npm run build`
Expected: Clean build

- [ ] **Step 8: Commit**

```bash
git add src/worker/loop.ts src/worker/model-selector.ts
git commit -m "feat: rewrite worker loop for superpowers pipeline — no ralph loop, per-subtask review"
```

---

## Task 11: UI — Streaming Chat Panel

**Files:**
- Modify: `ui/src/components/TaskForm.tsx`
- Modify: `ui/src/types.ts` (if separate UI types exist)

- [ ] **Step 1: Update TaskForm to use SSE streaming**

Replace the current `api.post('/api/tasks/chat')` call with an EventSource or fetch-based SSE consumer:
- PM types message → POST to `/api/tasks/:id/chat/stream`
- Response streams chunks via SSE
- Each chunk appended to assistant message bubble in real-time
- When stream completes, spec fields updated from final `done` event

Key changes:
- Replace `loading` dots indicator with streaming text
- Show AI "typing" as chunks arrive
- Spec preview panel updates live as spec fields are extracted

- [ ] **Step 2: Update task form to persist chat via task ID**

When creating a new task, first create the task (POST /api/tasks with just title), then use the returned task ID for chat streaming. This ensures chat messages are persisted per-task.

- [ ] **Step 3: Run UI build**

Run: `npm run build:ui`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/TaskForm.tsx
git commit -m "feat: streaming chat in TaskForm — real-time AI output for spec building"
```

---

## Task 12: UI — New Status Badges and Board Columns

**Files:**
- Modify: `ui/src/components/Board.tsx`
- Modify: `ui/src/components/TaskCard.tsx`
- Modify: `ui/src/components/TaskPage.tsx`
- Modify: `ui/src/components/TaskDetail.tsx`

- [ ] **Step 1: Update Board.tsx columns**

Add new columns for `spec_review`, `code_quality`, `final_review`, `pr_creation`.
Remove `review_panel` column.

- [ ] **Step 2: Update TaskCard.tsx status badges**

Add badges for new statuses with appropriate colors:
- `spec_review` — blue
- `code_quality` — purple
- `final_review` — teal
- `pr_creation` — green

- [ ] **Step 3: Update TaskPage.tsx pipeline progress**

Update the stage progress indicator to show the new pipeline stages.

- [ ] **Step 4: Run UI build**

Run: `npm run build:ui`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/Board.tsx ui/src/components/TaskCard.tsx ui/src/components/TaskPage.tsx ui/src/components/TaskDetail.tsx
git commit -m "feat: UI updates for new pipeline statuses and columns"
```

---

## Task 13: Cleanup — Remove Old Code

**Files:**
- Delete: `src/worker/ralph-loop.ts`
- Delete: `src/worker/stages/review-panel.ts`
- Delete: `src/worker/stages/review-panel.test.ts`
- Delete: `prompts/review-architect.md`
- Delete: `prompts/review-qa.md`
- Delete: `prompts/review-security.md`
- Delete: `prompts/implementer-fallback.md`
- Delete: `prompts/spec-generator.md` (replaced by chat-based spec building)
- Delete: `src/worker/stages/spec-generator.ts`
- Modify: `src/server/routes/tasks.ts` — remove `/refine-field` endpoint, remove old `/chat` endpoint

- [ ] **Step 1: Delete old files**

```bash
rm src/worker/ralph-loop.ts
rm src/worker/stages/review-panel.ts
rm src/worker/stages/review-panel.test.ts
rm prompts/review-architect.md
rm prompts/review-qa.md
rm prompts/review-security.md
rm prompts/implementer-fallback.md
rm prompts/spec-generator.md
rm src/worker/stages/spec-generator.ts
```

- [ ] **Step 2: Remove old endpoints from tasks.ts**

Remove `POST /api/tasks/refine-field` endpoint.
Remove old `POST /api/tasks/chat` endpoint (replaced by `/api/tasks/:id/chat/stream`).

- [ ] **Step 3: Verify build and tests**

Run: `npm run build && npm test`
Expected: Clean build, all tests pass

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove ralph loop, review panel, and old spec endpoints"
```

---

## Task 14: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture/agent-orchestration.md`

- [ ] **Step 1: Update CLAUDE.md**

Update pipeline description, stage list, and conventions to reflect new workflow.

- [ ] **Step 2: Update agent-orchestration.md**

Replace pipeline diagrams and stage descriptions.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/architecture/agent-orchestration.md
git commit -m "docs: update documentation for superpowers workflow"
```

---

## Execution Order & Dependencies

```
Task 1 (types) ─────────┐
Task 2 (DB schema) ─────┼──→ Task 3 (streaming chat)
                         │
                         ├──→ Task 4 (spec-review stage)
                         ├──→ Task 5 (code-quality stage)
                         ├──→ Task 6 (final-review stage)
                         ├──→ Task 7 (implementer v2)
                         ├──→ Task 8 (inline-fix)
                         ├──→ Task 9 (planner v2)
                         │
Tasks 3-9 ───────────────┼──→ Task 10 (worker loop rewrite)
                         │
Task 10 ─────────────────┼──→ Task 11 (UI streaming)
                         ├──→ Task 12 (UI statuses)
                         ├──→ Task 13 (cleanup)
                         └──→ Task 14 (docs)
```

Tasks 4-9 are independent of each other and can be executed in parallel.
Tasks 11-14 are independent of each other and can be executed in parallel.
