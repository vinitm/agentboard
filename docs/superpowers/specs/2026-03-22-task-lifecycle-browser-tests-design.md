# Task Lifecycle Browser Tests — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Scope:** Exhaustive browser tests covering full task lifecycle from creation to deletion, testing all UI components along the flow.

## Overview

Two browser test files exercising the complete agentboard task lifecycle using the task title "Add player skill description field for team-making context". Tests cover layout, navigation, task creation dialog, task cards, task detail page (all tabs + sidebar), filtering/search, task operations, real-time WebSocket updates, responsive behavior, error states, keyboard navigation, and action panels.

## Test Files

| File | Runner | Purpose |
|------|--------|---------|
| `browser-tests/task-lifecycle.spec.ts` | Lightpanda (CDP) | Fast functional DOM assertions, `toBeAttached()`, no screenshots |
| `browser-tests/task-lifecycle.visual.spec.ts` | Chromium | Full rendering, `toBeVisible()`, visual regression screenshots |

Both files share the same logical structure. The functional file runs ~11x faster for CI; the visual file catches rendering/layout regressions. Some tests are Chromium-only (responsive layout, WebSocket real-time) due to Lightpanda limitations — marked with `[visual-only]`.

**Relationship to existing tests:** These tests complement but do not replace existing browser tests. Existing tests cover targeted scenarios; these provide end-to-end lifecycle coverage with the specific task "Add player skill description field for team-making context".

## Shared API Helpers

Defined at top of each file (matches existing test patterns in `grid-workflow.visual.spec.ts`):

```typescript
getProjectId(): Promise<string>           // First project from GET /api/projects
createTask(projectId, overrides)          // POST /api/tasks — with spec → status 'ready'
createTaskMinimal(projectId, title)       // POST /api/tasks — no spec → status 'backlog'
cancelTask(taskId)                        // POST /api/tasks/:id/cancel
deleteTask(taskId)                        // DELETE /api/tasks/:id
getTask(taskId)                           // GET /api/tasks/:id
updateTask(taskId, fields)                // PUT /api/tasks/:id (title, description, risk, priority, spec)
```

**Note:** No `moveTask` helper — there is no `POST /api/tasks/:id/move` backend route. Status transitions are achieved via:
- Creating with/without spec (→ `ready` / `backlog`)
- `cancelTask` (→ `cancelled`)
- The PUT route updates fields but NOT status

All tests track created task IDs and clean up in `afterAll`.

## Test Task Data

```typescript
const TASK_TITLE = 'Add player skill description field for team-making context';
const TASK_DESCRIPTION = 'Players need a free-text skill description field visible during team drafts';
const TASK_SPEC = JSON.stringify({
  goal: 'Add a skill description field to player profiles so captains have context when drafting teams',
  userScenarios: 'P1: Given a player profile, When editing, Then a skill description textarea is available\nP2: Given a team draft view, When viewing a player, Then their skill description is visible',
  successCriteria: 'Skill description field persists across sessions, displays in draft view, max 500 chars',
});
```

## Test Groups

### 1. Layout & Navigation (5 tests)

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Page loads correctly | Response 200 or title contains "Agentboard" |
| 2 | Sidebar renders all elements | Logo text "Agentboard", nav items (Board, Activity, Learnings, Costs, Design System, Settings), project list under "Projects" text (div, not heading element), connection status indicator dot, collapse toggle button |
| 3 | TopBar renders all elements | Title text, task count badge, search input with placeholder "Search tasks...", `⌘K` hint (Mac symbol, not Ctrl+K), Filter button, "New Task" button |
| 4 | Sidebar collapse/expand | Click collapse → "Agentboard" text disappears, nav labels hidden; click expand → labels return |
| 5 | Nav links navigate correctly | Click Activity → `/activity`; click Board link or logo → `/`; verify URL changes |

### 2. Task Creation Dialog (10 tests)

| # | Test | Key assertions |
|---|------|---------------|
| 1 | New Task button opens dialog | `[role="dialog"]` appears, title "New Task" in header |
| 2 | Chatting phase renders correctly | Welcome message "Describe what you want to build" present, textarea with placeholder "Describe what you need built...", spec preview panel with "Spec Preview" heading, "0/3 filled" counter |
| 3 | Send button disabled when empty | Send button has `disabled` attribute when textarea is empty |
| 4 | Skip to quick create link present | Text "Skip to quick create" present when only welcome message exists (messages.length <= 1) |
| 5 | Skip transitions to confirming phase | Click skip → textarea gone, spec field cards visible (Goal, User Scenarios, Success Criteria), each showing "Not filled" |
| 6 | Confirming phase shows all controls | Title "Untitled Task", risk badge "Low risk", Cancel button, "Keep Editing" button, "Create Task" button in footer |
| 7 | Title validation | Click "Create Task" with no title → error text "Title is required" appears |
| 8 | Spec field validation | (Can't easily set title without chat — this tests the error message format) → error lists missing fields "Goal, User Scenarios, Success Criteria" |
| 9 | Keep Editing returns to chat | Click "Keep Editing" → textarea reappears, spec preview panel visible |
| 10 | Cancel closes dialog | Click Cancel → dialog gone, `#main-content` present |

### 3. Task Card Rendering (7 tests)

Create task via API with spec (→ `ready` status), then verify card display on grid.

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Task appears in Queued section | `section[aria-label="Queued"]` contains card with `#id` text (ready is in Queued group) |
| 2 | Card shows title and description | Title text matches TASK_TITLE, description text present |
| 3 | Card shows status badge | StatusBadge with "ready" text (task created with spec → ready status) |
| 4 | Card shows risk level | Risk dot element present, risk label text ("low") |
| 5 | Card shows PipelineBar | Pipeline bar element present within card |
| 6 | Card has correct ARIA | `role="button"`, `aria-label` contains task ID, title, risk level, "ready" |
| 7 | Priority badge renders | Create task with priority 5 → "P5" text visible on card |

### 4. Task Detail Page (10 tests)

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Card click navigates to detail | URL is `/tasks/:id` |
| 2 | Header renders correctly | Breadcrumb "Tasks" link, `#id` text, `<h1>` with title, status badge with correct color class (`bg-accent-blue` for ready), risk badge with border color |
| 3 | PipelineBar with labels | Pipeline bar present, stage label text visible (e.g. "spec review", "planning") |
| 4 | All 7 tabs render | Buttons: Overview, Stages, Events, Runs, Chat, Artifacts, Costs |
| 5 | Tab switching works | Click each tab → URL hash updates (use `expect(page).toHaveURL(/#stages/)` pattern) |
| 6 | Overview tab shows spec fields | TaskDescription renders Goal, User Scenarios, Success Criteria content |
| 7 | Action buttons present | "Move to..." select with options (backlog, ready, cancelled, done), Delete button with red border |
| 8 | Delete button opens ConfirmDialog | Click Delete → ConfirmDialog appears with "Delete this task?" title, "Delete" confirm button (danger variant), Cancel button |
| 9 | TaskSidebar renders | Sidebar section visible on right side with task metadata |
| 10 | Breadcrumb navigates back | Click "Tasks" breadcrumb → URL is `/` |

### 5. Task Operations (6 tests)

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Backlog task in Queued | Create without spec (→ backlog) → card in Queued section with "backlog" badge |
| 2 | Ready task in Queued | Create with spec (→ ready) → card in Queued section with "ready" badge |
| 3 | Cancel task moves to Completed | Cancel via API → reload → card in Completed section, status "cancelled" |
| 4 | Risk level rendering | Create 3 tasks (low/medium/high risk) → verify risk label text on each card |
| 5 | Priority sorting | Create tasks with priority 0, 5, 10 → within Queued group, highest priority card appears first |
| 6 | Delete task removes from grid | Delete via API → reload → card gone from grid |

### 6. Filtering & Search (5 tests)

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Filter button opens bar | Click Filter → 3 select dropdowns visible (status, risk, running) |
| 2 | Status filter works | Select "backlog" → URL has `?status=backlog`, filter badge span shows count "1" |
| 3 | Risk filter works | Select "low" → URL has `?risk=low` |
| 4 | Clear all resets | Click "Clear all" → URL params removed, filter badge gone |
| 5 | Search input works | Type substring of task title → URL has `?q=...` param, clear button (✕) resets search |

### 7. Real-time WebSocket Updates (3 tests) `[visual-only]`

These tests are Chromium-only — Lightpanda's JS environment may not fully support Socket.IO.

| # | Test | Key assertions |
|---|------|---------------|
| 1 | New task appears live | Create task via API while grid open → card appears without page reload (wait up to 5s) |
| 2 | Cancel reflects live on grid | Cancel via API while grid open → card moves to Completed group without reload |
| 3 | Status updates on detail page | Navigate to task detail → cancel via API → status badge updates to "cancelled" without reload |

### 8. Responsive Behavior (3 tests) `[visual-only]`

Chromium-only — Lightpanda has no layout engine for viewport/column assertions.

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Desktop 1280x800 | Grid uses multi-column layout, sidebar expanded with "Agentboard" text visible |
| 2 | Tablet 768x1024 | Grid visible, tasks displayed |
| 3 | Mobile 375x812 | Sidebar off-screen (has `-translate-x-full`), hamburger toggle button visible (aria-label "Toggle menu") |

### 9. Error States (3 tests)

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Non-existent task shows error | Navigate to `/tasks/999999` → error message "Task not found", "Back to Tasks" link |
| 2 | Invalid task ID | Navigate to `/tasks/abc` → error state renders |
| 3 | No console errors on grid load | Capture console errors during grid load → expect empty array |

### 10. Keyboard Navigation (3 tests) `[visual-only]`

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Task card activates on Enter | Focus card with Tab, press Enter → navigates to `/tasks/:id` |
| 2 | Task card activates on Space | Focus card with Tab, press Space → navigates to `/tasks/:id` |
| 3 | Escape closes dialog | Open New Task dialog → press Escape → dialog closes |

### 11. Edit Flow (2 tests)

| # | Test | Key assertions |
|---|------|---------------|
| 1 | Edit button opens TaskForm | On detail page for non-active task → click Edit → dialog appears in edit mode with "Edit Task" title, pre-filled fields |
| 2 | Edit saves changes | Update title via edit form → submit → title updates on detail page |

## Visual Screenshots (Chromium file only)

Captured at key moments with `maxDiffPixelRatio: 0.05` (overrides global 0.01 due to dynamic timestamps):

| Screenshot name | When |
|----------------|------|
| `lifecycle-board-with-tasks.png` | After creating test tasks, full grid view |
| `lifecycle-dialog-chatting.png` | Task creation dialog, chatting phase |
| `lifecycle-dialog-confirming.png` | Task creation dialog, confirming phase |
| `lifecycle-task-detail.png` | Task detail page, overview tab |
| `lifecycle-task-detail-stages.png` | Task detail page, stages tab |
| `lifecycle-filter-active.png` | Filter bar open with active status filter |
| `lifecycle-responsive-mobile.png` | Mobile viewport 375px |
| `lifecycle-responsive-desktop.png` | Desktop viewport 1280px |
| `lifecycle-error-not-found.png` | Task not found error page |
| `lifecycle-delete-confirm.png` | Delete confirmation dialog |

## Documentation Update

After implementation, update `docs/browser-testing.md`:
- Add task-lifecycle tests to the test inventory table
- Document the test data conventions (shared helpers, cleanup pattern)
- Document `[visual-only]` test marking convention
- Add a "Running lifecycle tests" section with commands

## Constraints

- No AI/Claude dependency — task specs pre-filled via API, chat not exercised
- Tests must be idempotent — create and delete their own data
- No `POST /api/tasks/:id/move` route exists — status transitions via create (with/without spec) and cancel only
- No worker/pipeline execution — cannot simulate running stages
- Follow existing patterns: `toBeAttached()` for Lightpanda, `toBeVisible()` for Chromium
- Lightpanda file imports from `./fixtures.js`, visual file imports from `@playwright/test`
- `[visual-only]` tests skipped in the functional file (responsive, WebSocket, keyboard)
