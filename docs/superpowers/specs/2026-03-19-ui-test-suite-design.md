# UI Test Suite Design

**Date:** 2026-03-19
**Status:** Draft

## Problem

The task-grid redesign introduced new components (TaskGrid, TaskCard, PipelineBar) with only 19 basic component tests and 10 visual regression snapshots. Critical UI flows — task creation, real-time updates, navigation, filtering, action panels — have no automated test coverage.

## Solution

Two-layer test strategy: component regression tests (Vitest + testing-library) for breadth, E2E workflow tests (Playwright + Chromium) for depth. Target ~81 total UI tests up from 29.

## Layer 1: Component Regression (Vitest + testing-library)

Fast, no server needed, runs in jsdom. Tests render components in isolation with mock data and verify DOM output, interactions, and accessibility.

### TaskCard (~20 tests)

Expand `ui/src/components/TaskCard.test.tsx` from 7 to ~20 tests.

**Status rendering:**
- Status badge text for each category: backlog, implementing, blocked, failed, done, needs_plan_review, needs_human_review, cancelled
- Status badge color classes: amber for blocked, red for failed, green for done, pink for needs_human_review, purple for pipeline stages, gray for cancelled (`bg-bg-tertiary text-text-tertiary`)

**Visual accents:**
- Left border: amber for blocked/needs_plan_review, red for failed, pink for needs_human_review, transparent for normal statuses

**Content:**
- No description → description div not rendered
- Long title → has line-clamp-2 class
- Priority 0 → no P0 badge; priority 3 → shows P3

**Interaction:**
- Click navigates to /tasks/:id (mock useNavigate, verify called with correct path)
- Enter key triggers navigation
- Space key triggers navigation

**Accessibility:**
- aria-label contains task ID, title, risk level, status

**Pipeline bar segments:**
- `[data-segment]` elements present for pipeline statuses (implementing, checks, etc.)
- No `[data-segment]` elements for backlog, ready, cancelled (PipelineBar returns null internally; the wrapping div still mounts but is empty)

### TaskGrid (~15 tests)

Expand `ui/src/components/TaskGrid.test.tsx` from 5 to ~15 tests.

**Grouping:**
- All 4 groups visible when tasks exist in all phases
- Correct statuses map to correct groups (blocked → Attention, implementing → Running, backlog → Queued, done → Completed)
- Groups with zero tasks are hidden

**Collapse/expand:**
- Completed group collapsed by default (cards not rendered until expanded)
- Click group header toggles collapse state
- Expanded group shows all its cards

**Sorting:**
- Tasks sorted by priority descending within group
- Secondary sort by updatedAt descending (most recent first)

**Visual:**
- Attention group has `text-accent-amber` class on header
- Running group has `text-accent-purple` class on header
- Group count badge matches actual task count

**States:**
- Loading → skeleton rendered
- Empty → "No tasks yet" message
- Single task → correct group visible with count 1

### PipelineBar (~12 tests)

Expand `ui/src/components/PipelineBar.test.tsx` from 7 to ~12 tests.

**Status mapping:**
- Each pipeline status (spec_review through pr_creation) shows correct completed/current segments
- needs_plan_review maps to planning stage with amber color
- needs_human_review maps to all 7 completed
- done maps to all 7 completed
- failed shows red segment at the failed stage
- Returns null (no `[data-segment]` in DOM) for: backlog, ready, cancelled — test all three explicitly

**Labels:**
- showLabels=true renders label text elements beneath segments
- showLabels=false (default) renders no label elements

**Count:**
- Stage count text shows correct "N/7" for each status

### TaskPage (~12 tests)

Create `ui/src/components/TaskPage.test.tsx`.

**Header:**
- Renders task title, #id, status badge
- PipelineBar present with showLabels
- "Tasks" breadcrumb link points to /

**Action panels (contextual):**
- Hidden when status is backlog, implementing, or other non-action statuses
- Plan review buttons ("Approve Plan" / "Reject") shown when needs_plan_review
- Blocked panel with `<textarea>` shown when blocked, displays structured blockedReason (parsed with severity badges)
- Retry button shown when failed OR blocked
- "Move to" dropdown with "cancelled" option available (not a standalone Cancel button)

**Content sections:**
- Stage accordion section rendered
- Events timeline section rendered

**Error states:**
- 404 message when task ID not found

### TaskForm (~8 tests)

Create `ui/src/components/TaskForm.test.tsx`.

**Dialog:**
- Renders with "New Task" title
- Close (X) button calls onCancel
- Cancel button calls onCancel

**Content:**
- Chat input present with placeholder "Describe what you need built..." (initial state; changes to "Answer the question..." after first message)
- Spec preview panel shows Goal, User Scenarios, Success Criteria labels
- "Skip to quick create" link present

### TopBar (~6 tests)

Create `ui/src/components/TopBar.test.tsx`.

**Content:**
- Renders title text and task count badge
- Search input present with placeholder "Search tasks..."
- Keyboard shortcut hint (⌘K) visible in search

**Conditional rendering:**
- "New Task" button present when onNewTask callback provided (button text is "New Task"; the "+" is an SVG icon — use `getByRole('button', { name: /new task/i })`)
- "New Task" button absent when onNewTask is undefined
- Filter button present when filters prop provided

## Layer 2: E2E Workflow Tests (Playwright + Chromium)

Runs against the compiled server with real HTTP, WebSocket, and browser rendering. Uses API calls (`fetch`) to create tasks and simulate worker status changes. 8 tests covering critical user journeys.

**Files:**
- `browser-tests/grid-workflow.visual.spec.ts` — Tests 1-3, 7-8 (need full Chromium rendering for layout and navigation)
- `browser-tests/grid-actions.visual.spec.ts` — Tests 4-6 (action/filter workflows)

Both use `.visual.spec.ts` naming to run with the Chromium project, since these tests require full SPA rendering that Lightpanda cannot provide.

**Setup:** Each test creates its own tasks via API and cleans up after. All tests share one server instance via Playwright global setup.

**Implementation note:** Filter tests (Test 4) use native `<select>` elements — use Playwright's `page.selectOption()` rather than click-based selection.

### Test 1: Create task through UI

1. Navigate to /
2. Click "New Task" button (`getByRole('button', { name: /new task/i })`)
3. Verify dialog opens (title "New Task" visible)
4. Click "Skip to quick create" link
5. Fill in title field
6. Submit the form
7. Verify dialog closes
8. Verify new task card appears in "Queued" group

### Test 2: Task moves between groups via real-time updates

1. Create task via API (status: backlog)
2. Verify card in "Queued" group
3. Update task status to "implementing" via API
4. Wait for WebSocket update (~1-2s)
5. Verify card moved to "Running" group without page reload
6. Update task status to "done" via API
7. Verify card moved to "Completed" group

### Test 3: Card click navigates to detail page

1. Create task via API
2. Navigate to /
3. Click the task card
4. Verify URL is /tasks/:id
5. Verify detail page shows task title, status badge, PipelineBar with labels
6. Click "Tasks" breadcrumb link
7. Verify URL is / (back to grid)

### Test 4: Filter tasks by status

1. Create 3 tasks via API: backlog, implementing, done
2. Navigate to /
3. Click "Filter" button to show filter bar
4. Use `page.selectOption()` on the status `<select>` to choose "backlog"
5. Verify only backlog task card visible
6. Clear filter (select empty option)
7. Verify all 3 tasks visible

### Test 5: Plan review action on detail page

1. Create task via API, update status to "needs_plan_review", set plan JSON
2. Navigate to /tasks/:id
3. Verify "Approve Plan" and "Reject" buttons visible
4. Click "Approve Plan"
5. Verify buttons disappear (status changed)

### Test 6: Cancel task via Move dropdown

1. Create task via API (backlog)
2. Navigate to /tasks/:id
3. Use `page.selectOption()` on the "Move to" dropdown, select "cancelled"
4. Verify status changes to "cancelled"
5. Navigate to /
6. Verify task in "Completed" group

### Test 7: Empty state

1. Ensure no tasks exist for the test project
2. Navigate to /
3. Verify "No tasks yet" empty state message visible
4. Verify "New Task" button accessible

### Test 8: Responsive grid layout

1. Create 4 tasks via API (one per status group)
2. Navigate to / at 1280px viewport
3. Verify grid shows multiple card columns
4. Resize viewport to 375px
5. Verify grid shows single column

## What's NOT Tested

- Worker pipeline execution (covered by 500 unit tests)
- Claude API integration (external dependency)
- WebSocket reconnection handling (infrastructure concern)
- Visual pixel accuracy (covered by existing 10 visual regression tests)

## Files

### Expand
- `ui/src/components/TaskCard.test.tsx` — 7 → ~20 tests
- `ui/src/components/TaskGrid.test.tsx` — 5 → ~15 tests
- `ui/src/components/PipelineBar.test.tsx` — 7 → ~12 tests

### Create
- `ui/src/components/TaskPage.test.tsx` — ~12 tests
- `ui/src/components/TaskForm.test.tsx` — ~8 tests
- `ui/src/components/TopBar.test.tsx` — ~6 tests
- `browser-tests/grid-workflow.visual.spec.ts` — 5 E2E tests (Tests 1-3, 7-8)
- `browser-tests/grid-actions.visual.spec.ts` — 3 E2E tests (Tests 4-6)

### No New Dependencies
- Vitest + @testing-library/react (already installed)
- Playwright + Chromium (already installed)
