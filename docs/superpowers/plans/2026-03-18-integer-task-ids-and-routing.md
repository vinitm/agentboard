# Integer Task IDs & Frontend Routing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace UUID task IDs with global auto-incrementing integers and route task views to `/tasks/:id` (full page, no modal).

**Architecture:** Change `tasks.id` from `TEXT PRIMARY KEY` to `INTEGER PRIMARY KEY AUTOINCREMENT` in SQLite. Update all FK columns, types, queries, routes, and UI components. Remove the inline `TaskDetail` modal from the Board — all task views become full-page at `/tasks/:id`.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Express, React Router v7, Socket.IO, @dnd-kit/core, Radix UI

**Spec:** `docs/superpowers/specs/2026-03-18-integer-task-ids-and-routing-design.md`

---

## File Map

### Backend — Modified
- `src/types/index.ts` — Task.id: string→number, parentTaskId: string→number, StageLog.subtaskId: string→number, Run.taskId, etc.
- `src/db/schema.ts` — DDL: tasks.id INTEGER PRIMARY KEY AUTOINCREMENT, all FK columns TEXT→INTEGER
- `src/db/queries.ts` — createTask uses lastInsertRowid, rowToTask casts id as number, all taskId params string→number, remove uuidv4 import for tasks
- `src/db/stage-log-queries.ts` — taskId/subtaskId params string→number (chat queries also live in `src/db/queries.ts`, not a separate file)
- `src/server/routes/tasks.ts` — parseTaskId helper, all req.params.id parsed as int, handleSubtaskTerminal, cleanupTaskWorktree
- `src/server/routes/chat.ts` — inFlightTasks Set<string>→Set<number>, req.params.id parsed
- `src/server/routes/stage-logs.ts` — req.params.id parsed as int
- `src/server/routes/logs.ts` — req.params.taskId and query.taskId parsed as int
- `src/worker/executor.ts` — task.id usage (mechanical, mostly via Task objects)
- `src/worker/stage-runner.ts` — task.id in log paths and stage log creation
- `src/worker/inline-fix.ts` — task.id usage
- `src/worker/log-writer.ts` — task.id in file paths
- `src/worker/git.ts` — task.id in branch names
- `src/worker/recovery.ts` — task.id references
- `src/test/helpers.ts` — createTestDb schema matches new DDL

### Frontend — Modified
- `ui/src/types.ts` — Task.id: string→number, StageLog.subtaskId, PersistedChatMessage.taskId, StageTransitionEvent.taskId
- `ui/src/api/client.ts` — taskId params string→number
- `ui/src/hooks/useTasks.ts` — all id params string→number, Socket.IO event handlers
- `ui/src/components/Board.tsx` — remove TaskDetail modal, TaskCard click navigates to /tasks/:id, dnd-kit casts
- `ui/src/components/TaskCard.tsx` — display #id, onClick navigates
- `ui/src/components/TaskPage.tsx` — parse :id as int, add action panels from TaskDetail
- `ui/src/components/TaskForm.tsx` — taskId state string→number, existingTaskId string→number
- `ui/src/components/SubtaskMiniCard.tsx` — task.id type
- `ui/src/components/Column.tsx` — Map<string, Task[]>→Map<number, Task[]>, Set<string>→Set<number>, taskId callback params
- `ui/src/components/StageAccordion.tsx` — taskId prop string→number, subtask id types
- `ui/src/components/EventsTimeline.tsx` — taskId prop string→number
- `ui/src/components/LogViewer.tsx` — taskId prop string→number (if applicable)
- `ui/src/components/BlockedPanel.tsx` — taskId prop string→number
- `ui/src/components/PRPanel.tsx` — taskId prop string→number (if applicable)
- `ui/src/components/PlanReviewPanel.tsx` — taskId prop string→number (if applicable)

### Frontend — Deleted (functionality moves to TaskPage)
- `ui/src/components/TaskDetail.tsx` — modal removed from Board, all action panels move to TaskPage

### Tests — Modified (all need integer IDs)
- `src/db/queries.test.ts`, `src/db/schema.test.ts`, `src/db/chat-queries.test.ts`, `src/db/stage-log-queries.test.ts`
- `src/server/routes/tasks.test.ts`, `src/server/routes/chat.test.ts`, `src/server/routes/stage-logs.test.ts`, `src/server/routes/events.test.ts`, `src/server/routes/runs.test.ts`, `src/server/routes/artifacts.test.ts`
- `src/server/ws.test.ts`
- `src/worker/executor.test.ts`, `src/worker/stage-runner.test.ts`, `src/worker/inline-fix.test.ts`, `src/worker/git.test.ts`, `src/worker/auto-merge.test.ts`, `src/worker/recovery.test.ts`
- `src/worker/stages/*.test.ts`

---

## Task 1: Update Backend Types

**Files:**
- Modify: `src/types/index.ts:82-99` (Task interface)
- Modify: `src/types/index.ts:34-50` (StageLog interface)
- Modify: `src/types/index.ts:101-113` (Run interface)
- Modify: `src/types/index.ts:52-55` (StageTransitionEvent)

- [ ] **Step 1: Update Task interface**

In `src/types/index.ts`, change the Task interface:

```typescript
export interface Task {
  id: number;                    // was string
  projectId: string;
  parentTaskId: number | null;   // was string | null
  // ... rest unchanged
}
```

- [ ] **Step 2: Update StageLog interface**

```typescript
export interface StageLog {
  id: string;
  taskId: number;              // was string
  projectId: string;
  runId: string | null;
  stage: StageLogStage;
  subtaskId: number | null;    // was string | null
  // ... rest unchanged
}
```

- [ ] **Step 3: Update Run interface**

```typescript
export interface Run {
  id: string;
  taskId: number;              // was string
  // ... rest unchanged
}
```

- [ ] **Step 4: Update StageTransitionEvent**

```typescript
export interface StageTransitionEvent {
  taskId: number;              // was string
  stage: StageLogStage;
  subtaskId?: number;          // was string
  // ... rest unchanged
}
```

- [ ] **Step 5: Update any other types referencing task IDs**

Grep for `taskId: string` and `parentTaskId: string` in `src/types/index.ts`. Update:
- `ChatMessage.taskId` → `number`
- `Event.taskId` → `number`
- `GitRef.taskId` → `number`
- `TaskLog.taskId` → `number`
- Any other references

- [ ] **Step 6: Build check**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: Many type errors downstream (queries, routes, etc.) — this is correct. We'll fix them in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: change task ID types from string to number"
```

---

## Task 2: Update DB Schema

**Files:**
- Modify: `src/db/schema.ts:3-138` (DDL constant)

- [ ] **Step 1: Update tasks table DDL**

Change line 14 from:
```sql
id TEXT PRIMARY KEY,
```
to:
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
```

Change line 16 from:
```sql
parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
```
to:
```sql
parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
```

- [ ] **Step 2: Update runs table FK**

Line 33: `task_id TEXT NOT NULL` → `task_id INTEGER NOT NULL`

- [ ] **Step 3: Update git_refs table FK**

Line 56: `task_id TEXT NOT NULL` → `task_id INTEGER NOT NULL`

- [ ] **Step 4: Update events table FK**

Line 65: `task_id TEXT NOT NULL` → `task_id INTEGER NOT NULL`

- [ ] **Step 5: Update task_logs table FK**

Line 74: `task_id TEXT NOT NULL` → `task_id INTEGER NOT NULL`

- [ ] **Step 6: Update stage_logs table**

Line 98: `task_id TEXT NOT NULL` → `task_id INTEGER NOT NULL`
Line 102: `subtask_id TEXT` → `subtask_id INTEGER`

- [ ] **Step 7: Update chat_messages table FK**

Line 120: `task_id TEXT NOT NULL` → `task_id INTEGER NOT NULL`

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: update DB schema to use INTEGER task IDs"
```

---

## Task 3: Update DB Queries

**Files:**
- Modify: `src/db/queries.ts:1-2` (imports), `32-50` (rowToTask), `171-208` (CreateTaskData + createTask), `210-218` (getTaskById), and all functions taking taskId

- [ ] **Step 1: Update rowToTask conversion**

In `src/db/queries.ts`, change `rowToTask`:
```typescript
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as number,                                    // was string
    projectId: row.project_id as string,
    parentTaskId: (row.parent_task_id as number) ?? null,    // was string
    // ... rest unchanged
  };
}
```

- [ ] **Step 2: Update rowToRun conversion**

Change `taskId: row.task_id as string` → `taskId: row.task_id as number` in `rowToRun`.

- [ ] **Step 3: Update rowToGitRef conversion**

Change `taskId: row.task_id as string` → `taskId: row.task_id as number` in `rowToGitRef`.

- [ ] **Step 4: Update rowToEvent conversion**

Change `taskId: row.task_id as string` → `taskId: row.task_id as number` in `rowToEvent`.

- [ ] **Step 5: Update CreateTaskData interface**

```typescript
export interface CreateTaskData {
  projectId: string;
  title: string;
  description?: string;
  parentTaskId?: number | null;    // was string | null
  status?: TaskStatus;
  riskLevel?: RiskLevel;
  priority?: number;
  columnPosition?: number;
  spec?: string | null;
}
```

- [ ] **Step 6: Update createTask — use lastInsertRowid**

```typescript
export function createTask(
  db: Database.Database,
  data: CreateTaskData
): Task {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO tasks (project_id, parent_task_id, title, description, status,
       risk_level, priority, column_position, spec, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.projectId,
    data.parentTaskId ?? null,
    data.title,
    data.description ?? '',
    data.status ?? 'backlog',
    data.riskLevel ?? 'low',
    data.priority ?? 0,
    data.columnPosition ?? 0,
    data.spec ?? null,
    now,
    now
  );
  return getTaskById(db, Number(result.lastInsertRowid))!;
}
```

Remove `const id = uuidv4();` and the `id` column from the INSERT. Remove `uuidv4` from the import if no other function uses it (check first — other entities like projects, runs still use it).

- [ ] **Step 7: Update getTaskById signature**

```typescript
export function getTaskById(
  db: Database.Database,
  id: number                    // was string
): Task | undefined {
```

- [ ] **Step 8: Update UpdateTaskData**

```typescript
export interface UpdateTaskData {
  // ...existing fields...
  parentTaskId?: number | null;    // was string | null
  // ...rest unchanged...
}
```

- [ ] **Step 9: Update updateTask signature**

```typescript
export function updateTask(
  db: Database.Database,
  id: number,                   // was string
  data: UpdateTaskData
): Task | undefined {
```

- [ ] **Step 10: Update all Create*Data interfaces**

Change `taskId: string` → `taskId: number` in all data interfaces:
- `CreateRunData.taskId: number`
- `CreateGitRefData.taskId: number`
- `CreateEventData.taskId: number`
- `CreateTaskLogData.taskId: number`
- `CreateChatMessageData.taskId: number`

- [ ] **Step 11: Update all remaining query functions**

Change `taskId: string` → `taskId: number` and `id: string` → `id: number` for task-related functions:
- `getSubtasksByParentId(db, parentTaskId: number)`
- `getNextBacklogSubtask(db, parentTaskId: number)`
- `deleteTask(db, id: number)`
- `moveToColumn(db, id: number, ...)`
- `claimTask(db, id: number, ...)`
- `unclaimTask(db, id: number)`
- `listRunsByTask(db, taskId: number)`
- `getLatestRunByTaskAndStage(db, taskId: number, stage)`
- `listGitRefsByTask(db, taskId: number)`
- `listEventsByTask(db, taskId: number)`
- `getTaskLogByTaskId(db, taskId: number)`
- `listChatMessagesByTask(db, taskId: number)`
- `deleteChatMessagesByTask(db, taskId: number)`

- [ ] **Step 12: Update rowToStageLog, rowToTaskLog, rowToChatMessage if they exist**

Grep for `rowToStageLog`, `rowToTaskLog`, `rowToChatMessage` in queries files. Update `taskId` and `subtaskId` casts from `as string` to `as number`.

- [ ] **Step 13: Build check**

Run: `npx tsc --noEmit 2>&1 | head -80`
Expected: Fewer errors now. Remaining errors should be in route handlers and worker code.

- [ ] **Step 14: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat: update queries to use integer task IDs and lastInsertRowid"
```

---

## Task 4: Update Stage Log Queries

**Files:**
- Modify: `src/db/stage-log-queries.ts` — taskId/subtaskId params

Note: Chat queries live in `src/db/queries.ts` (already updated in Task 3), not in a separate file.

- [ ] **Step 1: Update stage-log-queries.ts**

Change all function signatures with `taskId: string` → `taskId: number` and `subtaskId: string` → `subtaskId: number`. Update row conversion for `task_id` and `subtask_id` casts.

- [ ] **Step 2: Build check**

Run: `npx tsc --noEmit 2>&1 | head -50`

- [ ] **Step 3: Commit**

```bash
git add src/db/stage-log-queries.ts
git commit -m "feat: update stage-log queries for integer task IDs"
```

---

## Task 5: Update Test Helpers and Fix DB Tests

**Files:**
- Modify: `src/test/helpers.ts` — schema already uses initSchema(), so should auto-update
- Modify: `src/db/queries.test.ts`, `src/db/schema.test.ts`, `src/db/stage-log-queries.test.ts`
- Modify: `src/db/chat-queries.test.ts` (if it exists — chat queries may be tested in queries.test.ts)

- [ ] **Step 1: Verify test helpers work**

`createTestDb()` calls `initSchema(db)` which uses the updated DDL. No changes needed to helpers.ts unless it hardcodes task IDs.

Run: `npx vitest run src/db/queries.test.ts 2>&1 | tail -30`

- [ ] **Step 2: Fix queries.test.ts**

Replace any hardcoded UUID task IDs (e.g. `'test-task-id'`) with integer expectations. Since `createTask` now auto-generates IDs, tests should use the returned task's `.id` (which will be a number) instead of constructing IDs.

Grep for patterns like `id: 'some-string'` or `taskId: 'some-string'` in test files and replace with the returned task object's ID.

- [ ] **Step 3: Fix schema.test.ts**

Update any direct SQL inserts that use string task IDs. Remove explicit `id` values from task INSERT statements (let autoincrement handle it).

- [ ] **Step 4: Fix chat-queries.test.ts**

Same pattern: use returned task IDs instead of hardcoded strings.

- [ ] **Step 5: Fix stage-log-queries.test.ts**

Same pattern. Also update `subtaskId` from string to number.

- [ ] **Step 6: Run all DB tests**

Run: `npx vitest run src/db/ 2>&1 | tail -30`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/test/helpers.ts src/db/*.test.ts
git commit -m "test: update DB tests for integer task IDs"
```

---

## Task 6: Update Server Routes — Task Routes

**Files:**
- Modify: `src/server/routes/tasks.ts`

- [ ] **Step 1: Add parseTaskId helper at top of file**

```typescript
function parseTaskId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error(`Invalid task ID: ${raw}`), { status: 400 });
  }
  return id;
}
```

- [ ] **Step 2: Add error handling middleware or use try/catch in each handler**

In each route handler that uses `req.params.id`, wrap the parseTaskId call. If the existing pattern uses inline try/catch, follow that. If not, add a small middleware. Example for GET /:id:

```typescript
router.get('/:id', (req, res) => {
  let id: number;
  try { id = parseTaskId(req.params.id); }
  catch { return res.status(400).json({ error: 'Invalid task ID' }); }
  const task = getTaskById(db, id);
  // ...
});
```

Apply to all route handlers: GET /:id, PUT /:id, DELETE /:id, POST /:id/move, POST /:id/answer, POST /:id/review-plan, POST /:id/retry.

- [ ] **Step 3: Update handleSubtaskTerminal**

The function at line ~28 has an inline type: `function handleSubtaskTerminal(task: { parentTaskId: string | null; status: TaskStatus })`. Change `parentTaskId: string | null` to `parentTaskId: number | null`.

- [ ] **Step 4: Update cleanupTaskWorktree**

Change `taskId: string` → `taskId: number` in the function signature.

- [ ] **Step 5: Update Socket.IO emissions**

Ensure all `io.emit('task:updated', ...)` and `io.emit('task:deleted', ...)` calls emit integer IDs. Check that `req.params.id` is parsed before being emitted.

- [ ] **Step 6: Update POST /api/tasks (create)**

The response now returns a task with integer ID. No explicit change needed if the route uses `createTask()` and returns its result — the function already returns the correct type.

- [ ] **Step 7: Build check**

Run: `npx tsc --noEmit 2>&1 | grep "routes/tasks" | head -20`

- [ ] **Step 8: Commit**

```bash
git add src/server/routes/tasks.ts
git commit -m "feat: update task routes to parse integer IDs"
```

---

## Task 7: Update Server Routes — Chat, Stage Logs, Logs

**Files:**
- Modify: `src/server/routes/chat.ts`
- Modify: `src/server/routes/stage-logs.ts`
- Modify: `src/server/routes/logs.ts`

- [ ] **Step 1: Update chat.ts**

- Change `inFlightTasks` from `Set<string>` to `Set<number>`
- Parse `req.params.id` as integer in GET /:id/chat/messages and POST /:id/chat/stream
- Use the same `parseTaskId` pattern (either import it or duplicate the small helper)

- [ ] **Step 2: Update stage-logs.ts**

- Parse `req.params.id` as integer in GET / (list stage logs) and GET /:stageLogId/logs
- The `id` param is the task ID; `stageLogId` remains a string (stage logs keep UUID IDs)
- **Critical:** Line ~33 has `stageLog.taskId !== id` — after the type change, `stageLog.taskId` is a number. Ensure `id` is parsed to number BEFORE this comparison, otherwise `===` will fail (number vs string)

- [ ] **Step 3: Update logs.ts**

- Parse `req.params.taskId` and `req.query.taskId` as integer where they refer to task IDs
- GET /:taskId/metadata and GET /:taskId/download: parse params
- GET / with query.taskId: parse from query string

- [ ] **Step 4: Run route tests**

Run: `npx vitest run src/server/routes/ 2>&1 | tail -30`
Expected: Failures from hardcoded string IDs in tests (fixed next).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/chat.ts src/server/routes/stage-logs.ts src/server/routes/logs.ts
git commit -m "feat: update chat, stage-log, and log routes for integer task IDs"
```

---

## Task 8: Fix Server Route Tests

**Files:**
- Modify: `src/server/routes/tasks.test.ts`, `chat.test.ts`, `stage-logs.test.ts`, `events.test.ts`, `runs.test.ts`, `artifacts.test.ts`
- Modify: `src/server/ws.test.ts`

- [ ] **Step 1: Fix tasks.test.ts**

- Remove any hardcoded string task IDs
- Use `createTask()` return values for IDs
- Update assertions to expect `number` type for task.id
- Update URL paths: use the integer ID from created tasks

- [ ] **Step 2: Fix chat.test.ts**

Same pattern.

- [ ] **Step 3: Fix stage-logs.test.ts**

Same pattern. Update subtaskId assertions to expect number.

- [ ] **Step 4: Fix events.test.ts and runs.test.ts**

Update any task ID references to use integers from created tasks.

- [ ] **Step 5: Fix ws.test.ts**

Update Socket.IO event assertions for integer IDs.

- [ ] **Step 6: Run all server tests**

Run: `npx vitest run src/server/ 2>&1 | tail -30`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/**/*.test.ts
git commit -m "test: update server route tests for integer task IDs"
```

---

## Task 9: Update Worker Files

**Files:**
- Modify: `src/worker/executor.ts`, `stage-runner.ts`, `inline-fix.ts`, `log-writer.ts`, `git.ts`, `recovery.ts`, `auto-merge.ts`

- [ ] **Step 1: Update executor.ts**

The executor fetches tasks from DB and passes Task objects to stages. Since Task.id is now a number, most code works automatically. Check for:
- Any `task.id` string interpolation in log messages (works fine with numbers)
- Any explicit `string` type annotations on task ID variables

- [ ] **Step 2: Update stage-runner.ts**

- Log paths use `task.id` — numbers interpolate fine in template strings
- Stage log creation passes `task.id` — now a number, matching the DB column
- Check `subtaskId` parameter types

- [ ] **Step 3: Update inline-fix.ts**

Same mechanical updates — `task.id` references should just work with the type change.

- [ ] **Step 4: Update log-writer.ts**

File paths like `.agentboard/logs/${taskId}/` — numbers work in template strings. Update any `taskId: string` parameter types to `number`.

- [ ] **Step 5: Update git.ts**

Branch names like `agentboard/${task.id}-slug` — works with numbers. Update parameter types.

- [ ] **Step 6: Update recovery.ts**

Task ID references from DB queries — should work with type change. Update parameter types.

- [ ] **Step 7: Update auto-merge.ts**

Same mechanical type updates.

- [ ] **Step 8: Build check**

Run: `npx tsc --noEmit 2>&1 | grep "worker/" | head -20`

- [ ] **Step 9: Commit**

```bash
git add src/worker/*.ts
git commit -m "feat: update worker files for integer task IDs"
```

---

## Task 10: Fix Worker Tests

**Files:**
- Modify: `src/worker/executor.test.ts`, `stage-runner.test.ts`, `inline-fix.test.ts`, `git.test.ts`, `auto-merge.test.ts`, `recovery.test.ts`, `src/worker/stages/*.test.ts`

- [ ] **Step 1: Fix worker test files**

Grep for hardcoded string task IDs across all worker test files:
```bash
grep -rn "'test-task\|'task-\|taskId: '" src/worker/*.test.ts src/worker/stages/*.test.ts
```

Replace string IDs with numbers. For mock Task objects, use `id: 1` instead of `id: 'test-task-id'`. For `parentTaskId`, use `null` or a number.

- [ ] **Step 2: Run all worker tests**

Run: `npx vitest run src/worker/ 2>&1 | tail -30`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/worker/**/*.test.ts
git commit -m "test: update worker tests for integer task IDs"
```

---

## Task 11: Full Backend Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: Clean — no errors.

- [ ] **Step 2: Run all backend tests**

Run: `npm test 2>&1 | tail -50`
Expected: All pass.

- [ ] **Step 3: Fix any remaining failures**

If tests fail, fix them. Common issues:
- Missed `string` → `number` conversion in a test mock
- A query function signature not yet updated
- A row conversion still casting as string

- [ ] **Step 4: Commit if fixes were needed**

```bash
git add -A
git commit -m "fix: resolve remaining integer task ID type issues"
```

---

## Task 12: Update Frontend Types

**Files:**
- Modify: `ui/src/types.ts`

- [ ] **Step 1: Update Task interface**

```typescript
export interface Task {
  id: number;                    // was string
  projectId: string;
  parentTaskId: number | null;   // was string | null
  // ... rest unchanged
}
```

- [ ] **Step 2: Update StageLog interface**

```typescript
export interface StageLog {
  id: string;
  taskId: number;              // was string
  // ...
  subtaskId: number | null;    // was string | null
  // ...
}
```

- [ ] **Step 3: Update StageTransitionEvent**

```typescript
export interface StageTransitionEvent {
  taskId: number;              // was string
  stage: StageLogStage;
  subtaskId?: number;          // was string
  // ...
}
```

- [ ] **Step 4: Update Run interface**

```typescript
export interface Run {
  id: string;
  taskId: number;              // was string
  // ...
}
```

- [ ] **Step 5: Update PersistedChatMessage**

```typescript
export interface PersistedChatMessage {
  id: string;
  taskId: number;              // was string
  // ...
}
```

- [ ] **Step 6: Commit**

```bash
git add ui/src/types.ts
git commit -m "feat: update frontend types for integer task IDs"
```

---

## Task 13: Update Frontend API Client and Hooks

**Files:**
- Modify: `ui/src/api/client.ts`
- Modify: `ui/src/hooks/useTasks.ts`

- [ ] **Step 1: Update api/client.ts**

Change any function parameters typed as `id: string` to `id: number` for task-related methods. The URL interpolation (`/api/tasks/${id}`) works the same with numbers.

Also update `getStages(taskId)` and `getStageLogContent(taskId, stageLogId)` — taskId becomes number, stageLogId stays string.

- [ ] **Step 2: Update useTasks.ts**

Change all callback signatures:
- `updateTask(id: number, data)` — was string
- `moveTask(id: number, column)` — was string
- `answerTask(id: number, answers)` — was string
- `retryTask(id: number)` — was string
- `deleteTask(id: number)` — was string
- `reviewPlan(id: number, action)` — was string

Update Socket.IO event handlers — `task:updated`, `task:created`, `task:deleted` now carry integer IDs. Update the filter comparisons (`t.id !== id`) — these work the same with numbers.

- [ ] **Step 3: Build check**

Run: `cd ui && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add ui/src/api/client.ts ui/src/hooks/useTasks.ts
git commit -m "feat: update frontend API client and hooks for integer task IDs"
```

---

## Task 14: Update Board — Remove Modal, Add Navigation

**Files:**
- Modify: `ui/src/components/Board.tsx`
- Modify: `ui/src/components/TaskCard.tsx`
- Modify: `ui/src/components/Column.tsx`

- [ ] **Step 1: Update Board.tsx — remove TaskDetail modal and update Props**

1. Remove the `selectedTaskId` state and `selectedTask` derived value
2. Remove the `TaskDetail` dialog/modal JSX at the bottom of the component
3. Remove `TaskDetail` import and related imports (Dialog from Radix)
4. Remove the `onClose`, `setSelectedTaskId(null)` handlers
5. Update the Board Props interface: all callback signatures using `id: string` → `id: number` (e.g. `updateTask`, `moveTask`, `deleteTask`, `answerTask`, `retryTask`, `reviewPlan`)
6. Update `selectedIds` from `Set<string>` to `Set<number>` and `subtasksByParent` from `Map<string, Task[]>` to `Map<number, Task[]>`

- [ ] **Step 2: Update Board.tsx — TaskCard click navigates**

Change the `onTaskClick` callback to navigate instead of setting state:

```typescript
import { useNavigate } from 'react-router-dom';
// ...
const navigate = useNavigate();
// ...
onTaskClick={(task) => navigate(`/tasks/${task.id}`)}
```

- [ ] **Step 3: Update Board.tsx — dnd-kit casts**

Line ~154: Change `const taskId = active.id as string` → `const taskId = active.id as number`
Line ~155: For `over.id`, it may be a column name (string) or a task ID (number). Update the logic:

```typescript
const overId = over.id;
const isValidColumn = VALID_COLUMNS.has(overId as TaskStatus);
const targetColumn = isValidColumn
  ? (overId as TaskStatus)
  : tasks.find((t) => t.id === overId)?.status;
```

The `===` comparison works because dnd-kit preserves the original type.

- [ ] **Step 4: Update TaskCard.tsx — display #ID**

Add the task ID display to the card title area:

```tsx
<span className="text-xs text-gray-400 font-mono">#{task.id}</span>
```

- [ ] **Step 5: Update TaskCard.tsx — onClick prop type**

If the `onClick` prop is typed as `(task: Task) => void`, no change needed (Task.id is already number from the type update).

- [ ] **Step 6: Update Column.tsx**

Update these specific types:
- `subtasksByParent?: Map<string, Task[]>` → `Map<number, Task[]>`
- `selectedIds?: Set<string>` → `Set<number>`
- `onToggleSelect?: (taskId: string, event: React.MouseEvent) => void` → `taskId: number`
- Any other string task ID annotations → number

- [ ] **Step 7: Build check**

Run: `cd ui && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 8: Commit**

```bash
git add ui/src/components/Board.tsx ui/src/components/TaskCard.tsx ui/src/components/Column.tsx
git commit -m "feat: remove task modal from board, navigate to /tasks/:id"
```

---

## Task 15: Update TaskPage — Add Action Panels

**Files:**
- Modify: `ui/src/components/TaskPage.tsx`
- Potentially modify: `ui/src/components/SubtaskMiniCard.tsx`, `ui/src/components/TaskForm.tsx`

- [ ] **Step 1: Parse :id as integer in TaskPage**

```typescript
const { id } = useParams<{ id: string }>();
const taskId = Number(id);
```

Use `taskId` (number) for all API calls.

- [ ] **Step 2: Add action buttons to TaskPage**

Import and add the action panels that were in TaskDetail:
- `BlockedPanel` — shown when task.status === 'blocked'
- `PRPanel` — shown when task has a PR
- `PlanReviewPanel` — shown when task.status === 'needs_plan_review'
- Delete button, Retry button, Edit button, Move-to-column controls

Reference `TaskDetail.tsx` lines 260-302 for the exact panel rendering logic and copy the relevant JSX sections into TaskPage's layout.

- [ ] **Step 3: Wire up action callbacks**

TaskPage needs the same callbacks as TaskDetail used:
- `onUpdate`, `onAnswer`, `onRetry`, `onDelete`, `onMove`, `onReviewPlan`

Either import `useTasks` hook in TaskPage, or fetch/mutate directly via `api` client. The simplest approach: use `api` client directly since TaskPage is a standalone page.

- [ ] **Step 4: Update SubtaskMiniCard.tsx**

Ensure `task.id` is used as number in the navigation link. The existing `navigate(`/tasks/${task.id}`)` works with numbers.

- [ ] **Step 5: Update TaskForm.tsx**

- Change `taskId` local state from `useState<string | null>` to `useState<number | null>` (line ~61)
- Change `existingTaskId` in the `onSubmit` callback from `string | undefined` to `number | undefined`
- Update any `parentTaskId` references from string to number

- [ ] **Step 6: Update StageAccordion.tsx, EventsTimeline.tsx, BlockedPanel.tsx**

Update `taskId` prop types from `string` to `number` in:
- `StageAccordion` — also update subtask `id` types in any props
- `EventsTimeline` — taskId prop
- `BlockedPanel` — taskId prop
- `PRPanel` and `PlanReviewPanel` — if they accept taskId props

- [ ] **Step 7: Build check**

Run: `cd ui && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add ui/src/components/TaskPage.tsx ui/src/components/SubtaskMiniCard.tsx ui/src/components/TaskForm.tsx ui/src/components/StageAccordion.tsx ui/src/components/EventsTimeline.tsx ui/src/components/BlockedPanel.tsx ui/src/components/PRPanel.tsx ui/src/components/PlanReviewPanel.tsx
git commit -m "feat: add action panels to TaskPage, update remaining UI components"
```

---

## Task 16: Full Build and Test Verification

- [ ] **Step 1: Backend build**

Run: `npm run build:server`
Expected: Clean.

- [ ] **Step 2: Frontend build**

Run: `npm run build:ui`
Expected: Clean.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 4: Fix any remaining issues**

Iterate on any build or test failures.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete integer task IDs and frontend routing migration"
```

---

## Task 17: Cleanup

- [ ] **Step 1: Delete TaskDetail.tsx**

The Board no longer imports `TaskDetail` and `TaskPage` has all its functionality. Delete the file:
```bash
git rm ui/src/components/TaskDetail.tsx
```

- [ ] **Step 2: Remove unused imports**

Grep for unused imports across modified files. Remove any dead `uuid` imports in queries.ts (if no other entity uses uuidv4 in that file).

- [ ] **Step 3: Final build + test**

Run: `npm run build && npm test`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove TaskDetail modal, clean up unused imports"
```
