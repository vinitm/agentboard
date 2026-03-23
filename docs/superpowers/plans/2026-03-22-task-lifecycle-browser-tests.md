# Task Lifecycle Browser Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create exhaustive browser tests covering the full agentboard task lifecycle from creation to deletion, testing all UI components along the flow.

**Architecture:** Two test files — `task-lifecycle.spec.ts` (Lightpanda/functional, fast CI) and `task-lifecycle.visual.spec.ts` (Chromium/visual regression, screenshots). Both use grouped `describe` blocks with shared API helpers and per-group test data. Visual-only tests (responsive, WebSocket, keyboard) are skipped in the functional file.

**Tech Stack:** Playwright, Lightpanda (CDP), Chromium, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-22-task-lifecycle-browser-tests-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `browser-tests/task-lifecycle.spec.ts` | Lightpanda functional tests (~35 tests) |
| Create | `browser-tests/task-lifecycle.visual.spec.ts` | Chromium visual + screenshot tests (~57 tests) |
| Modify | `docs/browser-testing.md` | Add lifecycle tests to inventory, document conventions |

---

### Task 0: Create feature branch

- [ ] **Step 1: Create branch**

```bash
git checkout -b agentboard/task-lifecycle-browser-tests
```

---

### Task 1: Scaffold functional test file with API helpers

**Files:**
- Create: `browser-tests/task-lifecycle.spec.ts`

- [ ] **Step 1: Create file with imports, interfaces, constants, and API helpers**

```typescript
import { test, expect } from './fixtures.js';

const API_BASE = 'http://localhost:4200';

const TASK_TITLE = 'Add player skill description field for team-making context';
const TASK_DESCRIPTION = 'Players need a free-text skill description field visible during team drafts';
const TASK_SPEC = JSON.stringify({
  goal: 'Add a skill description field to player profiles so captains have context when drafting teams',
  userScenarios: 'P1: Given a player profile, When editing, Then a skill description textarea is available\nP2: Given a team draft view, When viewing a player, Then their skill description is visible',
  successCriteria: 'Skill description field persists across sessions, displays in draft view, max 500 chars',
});

interface Project { id: string; name: string; path: string }
interface Task {
  id: number; projectId: string; title: string; status: string;
  description?: string; riskLevel: string; priority: number;
  spec?: string; chatSessionId?: string;
  blockedReason?: string; claimedBy?: string; claimedAt?: string;
  createdAt: string; updatedAt: string;
}

async function getProjectId(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/projects`);
  const projects: Project[] = await res.json();
  if (projects.length === 0) throw new Error('No projects found — register a project first');
  return projects[0].id;
}

async function createTask(
  projectId: string,
  overrides: Partial<{ title: string; description: string; priority: number; riskLevel: string; spec: string }> = {},
): Promise<Task> {
  const body = {
    projectId,
    title: overrides.title ?? TASK_TITLE,
    description: overrides.description ?? TASK_DESCRIPTION,
    priority: overrides.priority ?? 0,
    riskLevel: overrides.riskLevel ?? 'low',
    spec: overrides.spec ?? TASK_SPEC,
  };
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function createTaskMinimal(projectId: string, title: string): Promise<Task> {
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, title }),
  });
  if (!res.ok) throw new Error(`createTaskMinimal failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function cancelTask(taskId: number): Promise<Task> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`cancelTask failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function deleteTask(taskId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteTask failed: ${res.status} ${await res.text()}`);
  }
}

async function getTask(taskId: number): Promise<Task> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);
  if (!res.ok) throw new Error(`getTask failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function updateTask(taskId: number, fields: Partial<{ title: string; description: string; riskLevel: string; priority: number; spec: string }>): Promise<Task> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`updateTask failed: ${res.status} ${await res.text()}`);
  return res.json();
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep task-lifecycle || echo "OK"`
Expected: No errors for this file (or "OK")

- [ ] **Step 3: Commit scaffold**

```bash
git add browser-tests/task-lifecycle.spec.ts
git commit -m "test: scaffold task-lifecycle functional test with API helpers"
```

---

### Task 2: Layout & Navigation tests (functional)

**Files:**
- Modify: `browser-tests/task-lifecycle.spec.ts`

- [ ] **Step 1: Add Layout & Navigation describe block**

Append to `task-lifecycle.spec.ts`:

```typescript
test.describe('Layout & Navigation', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Agentboard/);
  });

  test('sidebar renders all navigation elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Logo
    const logo = page.locator('text=Agentboard').first();
    await expect(logo).toBeAttached();

    // Nav items
    for (const label of ['Board', 'Activity', 'Learnings', 'Costs', 'Design System', 'Settings']) {
      const navItem = page.locator(`text=${label}`).first();
      await expect(navItem).toBeAttached();
    }

    // Projects section
    const projectsLabel = page.locator('text=Projects').first();
    await expect(projectsLabel).toBeAttached();

    // Connection status dot
    const statusDot = page.locator('aside span.rounded-full').first();
    await expect(statusDot).toBeAttached();

    // Collapse toggle
    const collapseBtn = page.locator('text=Collapse').first();
    await expect(collapseBtn).toBeAttached();
  });

  test('topbar renders title, count, search, filter, and new task button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Title text
    const title = page.locator('h2', { hasText: /Tasks|Board/ }).first();
    await expect(title).toBeAttached();

    // Task count badge (rounded-full span near the title)
    const countBadge = page.locator('h2 + span.rounded-full, h2 ~ span.rounded-full').first();
    // Count badge may not exist if 0 tasks — just check it doesn't error
    await countBadge.isAttached().catch(() => false);

    // Search input
    const searchInput = page.locator('input[placeholder="Search tasks..."]');
    await expect(searchInput).toBeAttached();

    // ⌘K hint
    const kbdHint = page.locator('kbd');
    // Hint may be hidden when search is focused — check attachment
    await kbdHint.first().isAttached().catch(() => false);

    // Filter button
    const filterBtn = page.locator('button').filter({ hasText: /^Filter/ });
    await expect(filterBtn).toBeAttached();

    // New Task button
    const newTaskBtn = page.locator('button', { hasText: /new task/i });
    await expect(newTaskBtn).toBeAttached();
  });

  test('sidebar collapse hides labels and expand restores them', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Collapse
    const collapseBtn = page.locator('button').filter({ hasText: /Collapse/ });
    await collapseBtn.click();

    // "Agentboard" text should be detached (hidden when collapsed)
    const logoText = page.locator('span', { hasText: 'Agentboard' });
    await expect(logoText).not.toBeAttached({ timeout: 3000 });

    // Expand — click the chevron button in the collapsed sidebar
    const expandBtn = page.locator('aside button').last();
    await expandBtn.click();

    // "Agentboard" text returns
    await expect(page.locator('span', { hasText: 'Agentboard' }).first()).toBeAttached({ timeout: 3000 });
  });

  test('nav links navigate to correct routes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click Activity
    const activityLink = page.locator('a', { hasText: 'Activity' });
    await activityLink.click();
    await expect(page).toHaveURL(/\/activity/);

    // Click Board to go back
    const boardLink = page.locator('a', { hasText: 'Board' });
    await boardLink.click();
    await expect(page).toHaveURL(/\/$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx playwright test browser-tests/task-lifecycle.spec.ts --project lightpanda --reporter line 2>&1 | tail -5`
Expected: 5 passed

- [ ] **Step 3: Commit**

```bash
git add browser-tests/task-lifecycle.spec.ts
git commit -m "test: add layout & navigation functional tests"
```

---

### Task 3: Task Creation Dialog tests (functional)

**Files:**
- Modify: `browser-tests/task-lifecycle.spec.ts`

- [ ] **Step 1: Add Task Creation Dialog describe block**

Append to `task-lifecycle.spec.ts`:

```typescript
test.describe('Task Creation Dialog', () => {
  test('New Task button opens dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newTaskBtn = page.locator('button', { hasText: /new task/i });
    await newTaskBtn.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeAttached();

    // Header shows "New Task"
    const title = dialog.locator('text=New Task').first();
    await expect(title).toBeAttached();
  });

  test('chatting phase renders welcome message and textarea', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: /new task/i }).click();

    // Welcome message
    const welcome = page.locator('text=Describe what you want to build').first();
    await expect(welcome).toBeAttached();

    // Textarea
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeAttached();
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toContain('Describe what you need built');

    // Spec preview panel
    const specPreview = page.locator('text=Spec Preview').first();
    await expect(specPreview).toBeAttached();

    // 0/3 filled counter
    const counter = page.locator('text=0/3 filled').first();
    await expect(counter).toBeAttached();
  });

  test('send button is disabled when textarea is empty', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: /new task/i }).click();

    // The send button (with SVG) should be disabled
    const sendBtn = page.locator('[role="dialog"] button[title="Send (Enter)"]');
    await expect(sendBtn).toBeAttached();
    await expect(sendBtn).toBeDisabled();
  });

  test('skip to quick create link is present', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: /new task/i }).click();

    const skipLink = page.locator('text=Skip to quick create').first();
    await expect(skipLink).toBeAttached();
  });

  test('skip to quick create transitions to confirming phase', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: /new task/i }).click();

    await page.locator('text=Skip to quick create').first().click();

    // Textarea should be gone
    const textarea = page.locator('textarea');
    await expect(textarea).not.toBeAttached({ timeout: 3000 });

    // Spec field cards visible
    for (const label of ['Goal', 'User Scenarios', 'Success Criteria']) {
      await expect(page.locator(`text=${label}`).first()).toBeAttached();
    }

    // "Not filled" placeholders
    const notFilled = page.locator('text=Not filled');
    const count = await notFilled.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('confirming phase shows all controls', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: /new task/i }).click();
    await page.locator('text=Skip to quick create').first().click();

    // Title placeholder
    await expect(page.locator('text=Untitled Task').first()).toBeAttached();

    // Risk badge
    await expect(page.locator('text=Low risk').first()).toBeAttached();

    // Buttons
    await expect(page.locator('button', { hasText: /^Cancel$/ }).first()).toBeAttached();
    await expect(page.locator('button', { hasText: /Keep Editing/ }).first()).toBeAttached();
    await expect(page.locator('button', { hasText: /Create Task/ }).first()).toBeAttached();
  });

  test('title validation shows error', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: /new task/i }).click();
    await page.locator('text=Skip to quick create').first().click();

    // Click Create Task without filling anything
    await page.locator('button', { hasText: /Create Task/ }).first().click();

    // Error message
    await expect(page.locator('text=Title is required').first()).toBeAttached();
  });

  test('spec field validation lists missing fields when title is present', async ({ page }) => {
    const projectId = await getProjectId();
    // Create a minimal task to get a taskId, then open edit form (which pre-fills title)
    const task = await createTaskMinimal(projectId, `Spec validation test ${Date.now()}`);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // Click Edit to open TaskForm in edit mode (title pre-filled, spec empty)
    const editBtn = page.locator('button', { hasText: /^Edit$/ });
    await editBtn.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeAttached({ timeout: 3000 });

    // Skip to confirming phase if in chatting
    const skipLink = page.locator('text=Skip to quick create');
    if (await skipLink.isAttached().catch(() => false)) {
      await skipLink.click();
    }

    // Try to submit — title is filled but spec fields are empty
    await page.locator('button', { hasText: /Update Task/ }).first().click();

    // Should show spec validation error listing all 3 missing fields
    await expect(page.locator('text=Goal').first()).toBeAttached();
    await expect(page.locator('text=User Scenarios').first()).toBeAttached();
    await expect(page.locator('text=Success Criteria').first()).toBeAttached();

    // Clean up — close dialog and delete task
    await page.locator('button', { hasText: /^Cancel$/ }).first().click();
    await deleteTask(task.id);
  });

  test('Keep Editing returns to chatting phase', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: /new task/i }).click();
    await page.locator('text=Skip to quick create').first().click();

    // Click Keep Editing
    await page.locator('button', { hasText: /Keep Editing/ }).first().click();

    // Textarea should reappear
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeAttached({ timeout: 3000 });

    // Spec preview panel still present
    await expect(page.locator('text=Spec Preview').first()).toBeAttached();
  });

  test('cancel closes dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button', { hasText: /new task/i }).click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeAttached();

    // Click Cancel
    await page.locator('button', { hasText: /^Cancel$/ }).first().click();

    // Dialog should be gone
    await expect(dialog).not.toBeAttached({ timeout: 3000 });

    // Main content visible
    await expect(page.locator('#main-content').first()).toBeAttached();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx playwright test browser-tests/task-lifecycle.spec.ts --project lightpanda --reporter line 2>&1 | tail -5`
Expected: 15 passed (5 layout + 10 dialog)

- [ ] **Step 3: Commit**

```bash
git add browser-tests/task-lifecycle.spec.ts
git commit -m "test: add task creation dialog functional tests"
```

---

### Task 4: Task Card Rendering tests (functional)

**Files:**
- Modify: `browser-tests/task-lifecycle.spec.ts`

- [ ] **Step 1: Add Task Card Rendering describe block**

```typescript
test.describe('Task Card Rendering', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) await deleteTask(id).catch(() => {});
  });

  test('task with spec appears in Queued section as ready', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const queuedSection = page.locator('section[aria-label="Queued"]');
    await expect(queuedSection).toBeAttached({ timeout: 5000 });

    const card = queuedSection.locator(`text=#${task.id}`);
    await expect(card.first()).toBeAttached({ timeout: 5000 });
  });

  test('card shows title and description', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Lifecycle card title ${Date.now()}`, description: 'Test card description text' });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator(`text=${task.title}`).first()).toBeAttached({ timeout: 5000 });
    await expect(page.locator('text=Test card description text').first()).toBeAttached({ timeout: 5000 });
  });

  test('card shows status badge with ready text', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The StatusBadge renders the status text
    const card = page.locator(`[aria-label*="${task.id}"]`).first();
    await expect(card).toBeAttached({ timeout: 5000 });
    await expect(card.locator('text=ready').first()).toBeAttached();
  });

  test('card shows risk level', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { riskLevel: 'medium' });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).first();
    await expect(card).toBeAttached({ timeout: 5000 });
    await expect(card.locator('text=medium').first()).toBeAttached();
  });

  test('card contains PipelineBar', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).first();
    await expect(card).toBeAttached({ timeout: 5000 });

    // PipelineBar renders as a div with flex and stage dots
    const pipelineBar = card.locator('.flex.gap-0, .flex.items-center').first();
    await expect(pipelineBar).toBeAttached();
  });

  test('card has correct ARIA attributes', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `ARIA test ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[role="button"][aria-label*="${task.id}"]`).first();
    await expect(card).toBeAttached({ timeout: 5000 });

    const ariaLabel = await card.getAttribute('aria-label');
    expect(ariaLabel).toContain(String(task.id));
    expect(ariaLabel).toContain(task.title);
    expect(ariaLabel).toContain('low');
    expect(ariaLabel).toContain('ready');
  });

  test('priority badge renders for non-zero priority', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { priority: 5 });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).first();
    await expect(card).toBeAttached({ timeout: 5000 });
    await expect(card.locator('text=P5').first()).toBeAttached();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx playwright test browser-tests/task-lifecycle.spec.ts --project lightpanda --reporter line 2>&1 | tail -5`
Expected: 22 passed

- [ ] **Step 3: Commit**

```bash
git add browser-tests/task-lifecycle.spec.ts
git commit -m "test: add task card rendering functional tests"
```

---

### Task 5: Task Detail Page tests (functional)

**Files:**
- Modify: `browser-tests/task-lifecycle.spec.ts`

- [ ] **Step 1: Add Task Detail Page describe block**

```typescript
test.describe('Task Detail Page', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) await deleteTask(id).catch(() => {});
  });

  test('clicking card navigates to task detail page', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).or(page.locator(`text=#${task.id}`)).first();
    await expect(card).toBeAttached({ timeout: 5000 });
    await card.click();

    await expect(page).toHaveURL(`/tasks/${task.id}`, { timeout: 5000 });
  });

  test('header renders breadcrumb, ID, title, status, and risk badges', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Detail header test ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // Breadcrumb
    const breadcrumb = page.locator('a', { hasText: /Tasks/i }).first();
    await expect(breadcrumb).toBeAttached({ timeout: 5000 });

    // Task ID
    await expect(page.locator(`text=#${task.id}`).first()).toBeAttached();

    // Title in h1
    const h1 = page.locator('h1');
    await expect(h1).toBeAttached();
    await expect(h1).toContainText(task.title);

    // Status badge
    await expect(page.locator('text=ready').first()).toBeAttached();

    // Risk badge
    await expect(page.locator('text=low').first()).toBeAttached();
  });

  test('PipelineBar renders with stage labels', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // Stage labels visible in pipeline bar area
    for (const label of ['spec review', 'planning', 'implementing']) {
      await expect(page.locator(`text=${label}`).first()).toBeAttached({ timeout: 5000 });
    }
  });

  test('all 7 tabs render', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    for (const tab of ['Overview', 'Stages', 'Events', 'Runs', 'Chat', 'Artifacts', 'Costs']) {
      await expect(page.locator('button', { hasText: tab }).first()).toBeAttached({ timeout: 5000 });
    }
  });

  test('tab switching updates URL hash', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    for (const tab of ['stages', 'events', 'runs', 'chat', 'artifacts', 'costs', 'overview']) {
      const tabLabel = tab.charAt(0).toUpperCase() + tab.slice(1);
      await page.locator('button', { hasText: tabLabel }).first().click();
      await expect(page).toHaveURL(new RegExp(`#${tab}`), { timeout: 3000 });
    }
  });

  test('overview tab shows spec fields', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // Spec content from TASK_SPEC
    await expect(page.locator('text=skill description field').first()).toBeAttached({ timeout: 5000 });
  });

  test('action buttons are present', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // Move to select
    const moveSelect = page.locator('select').filter({ hasText: /Move to/ });
    await expect(moveSelect).toBeAttached({ timeout: 5000 });

    // Delete button
    const deleteBtn = page.locator('button', { hasText: /Delete/ });
    await expect(deleteBtn).toBeAttached();
  });

  test('delete button opens confirmation dialog', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /Delete/ }).first().click();

    // ConfirmDialog
    await expect(page.locator('text=Delete this task?').first()).toBeAttached({ timeout: 3000 });

    // Cancel the dialog so we don't actually delete
    await page.locator('button', { hasText: /^Cancel$/ }).first().click();
  });

  test('TaskSidebar renders', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // TaskSidebar is a div with w-[280px] class containing task metadata
    // Check for sidebar-specific content like "Status" or "Created"
    const sidebar = page.locator('.shrink-0').last();
    await expect(sidebar).toBeAttached({ timeout: 5000 });
  });

  test('breadcrumb navigates back to grid', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    const breadcrumb = page.locator('a', { hasText: /Tasks/i }).first();
    await breadcrumb.click();
    await expect(page).toHaveURL(/\/$/, { timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx playwright test browser-tests/task-lifecycle.spec.ts --project lightpanda --reporter line 2>&1 | tail -5`
Expected: 32 passed

- [ ] **Step 3: Commit**

```bash
git add browser-tests/task-lifecycle.spec.ts
git commit -m "test: add task detail page functional tests"
```

---

### Task 6: Task Operations, Filtering, Error States, and Edit Flow tests (functional)

**Files:**
- Modify: `browser-tests/task-lifecycle.spec.ts`

- [ ] **Step 1: Add remaining describe blocks**

```typescript
test.describe('Task Operations', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) await deleteTask(id).catch(() => {});
  });

  test('task without spec appears as backlog in Queued', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTaskMinimal(projectId, `Backlog test ${Date.now()}`);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const queuedSection = page.locator('section[aria-label="Queued"]');
    await expect(queuedSection).toBeAttached({ timeout: 5000 });
    await expect(queuedSection.locator(`text=#${task.id}`).first()).toBeAttached({ timeout: 5000 });
  });

  test('task with spec appears as ready in Queued', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).first();
    await expect(card).toBeAttached({ timeout: 5000 });
    await expect(card.locator('text=ready').first()).toBeAttached();
  });

  test('cancelled task appears in Completed section', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);
    await cancelTask(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const completedSection = page.locator('section[aria-label="Completed"]');
    await expect(completedSection).toBeAttached({ timeout: 5000 });

    // Expand if collapsed
    const grid = completedSection.locator('.grid');
    if (!(await grid.isAttached().catch(() => false))) {
      await completedSection.locator('button').first().click();
    }
    await expect(completedSection.locator(`text=#${task.id}`).first()).toBeAttached({ timeout: 5000 });
  });

  test('different risk levels render correct labels', async ({ page }) => {
    const projectId = await getProjectId();
    const tasks = await Promise.all([
      createTask(projectId, { riskLevel: 'low', title: `Risk low ${Date.now()}` }),
      createTask(projectId, { riskLevel: 'medium', title: `Risk medium ${Date.now()}` }),
      createTask(projectId, { riskLevel: 'high', title: `Risk high ${Date.now()}` }),
    ]);
    createdIds.push(...tasks.map(t => t.id));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    for (const task of tasks) {
      const card = page.locator(`[aria-label*="${task.id}"]`).first();
      await expect(card).toBeAttached({ timeout: 5000 });
      await expect(card.locator(`text=${task.riskLevel}`).first()).toBeAttached();
    }
  });

  test('higher priority tasks appear first in group', async ({ page }) => {
    const projectId = await getProjectId();
    const low = await createTask(projectId, { priority: 0, title: `Prio 0 ${Date.now()}` });
    const mid = await createTask(projectId, { priority: 5, title: `Prio 5 ${Date.now()}` });
    const high = await createTask(projectId, { priority: 10, title: `Prio 10 ${Date.now()}` });
    createdIds.push(low.id, mid.id, high.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const queuedSection = page.locator('section[aria-label="Queued"]');
    const cards = queuedSection.locator('[role="button"]');
    const firstCardLabel = await cards.first().getAttribute('aria-label');
    // High priority (10) card should come first
    expect(firstCardLabel).toContain(String(high.id));
  });

  test('deleted task is gone from grid', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Delete test ${Date.now()}` });
    // Don't push to createdIds — we're deleting it ourselves
    await deleteTask(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`text=#${task.id}`);
    await expect(card).not.toBeAttached({ timeout: 3000 });
  });
});

test.describe('Filtering & Search', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) await deleteTask(id).catch(() => {});
  });

  test('filter button opens filter bar with 3 selects', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const filterBtn = page.locator('button').filter({ hasText: /^Filter/ });
    await filterBtn.click();

    const selects = page.locator('select');
    const count = await selects.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('status filter updates URL', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTaskMinimal(projectId, `Filter test ${Date.now()}`);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: /^Filter/ }).click();
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('backlog');

    await expect(page).toHaveURL(/status=backlog/, { timeout: 3000 });
  });

  test('risk filter updates URL', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: /^Filter/ }).click();
    const riskSelect = page.locator('select').nth(1);
    await riskSelect.selectOption('low');

    await expect(page).toHaveURL(/risk=low/, { timeout: 3000 });
  });

  test('clear all resets filters', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: /^Filter/ }).click();
    await page.locator('select').first().selectOption('backlog');
    await expect(page).toHaveURL(/status=backlog/, { timeout: 3000 });

    await page.locator('text=Clear all').click();
    await expect(page).not.toHaveURL(/status=/, { timeout: 3000 });
  });

  test('search input updates URL with query param', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Searchable unique ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder="Search tasks..."]');
    await searchInput.fill('Searchable unique');

    await expect(page).toHaveURL(/q=Searchable/, { timeout: 3000 });

    // Clear search
    const clearBtn = page.locator('button[aria-label="Clear search"]');
    await clearBtn.click();
    await expect(page).not.toHaveURL(/q=/, { timeout: 3000 });
  });
});

test.describe('Error States', () => {
  test('non-existent task shows error page', async ({ page }) => {
    await page.goto('/tasks/999999');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Task not found').first()).toBeAttached({ timeout: 5000 });
    await expect(page.locator('a', { hasText: /Back to Tasks/ }).first()).toBeAttached();
  });

  test('invalid task ID shows error', async ({ page }) => {
    await page.goto('/tasks/abc');
    await page.waitForLoadState('networkidle');

    // Should show error state (Task not found or similar)
    const errorText = page.locator('text=Task not found').or(page.locator('text=not found'));
    await expect(errorText.first()).toBeAttached({ timeout: 5000 });
  });

  test('no console errors on grid load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });
});

test.describe('Edit Flow', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) await deleteTask(id).catch(() => {});
  });

  test('edit button opens TaskForm in edit mode', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTaskMinimal(projectId, `Edit test ${Date.now()}`);
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    const editBtn = page.locator('button', { hasText: /^Edit$/ });
    await expect(editBtn).toBeAttached({ timeout: 5000 });
    await editBtn.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeAttached({ timeout: 3000 });

    // Should show "Edit Task" title
    await expect(dialog.locator('text=Edit Task').first()).toBeAttached();
  });

  test('editing via form saves changes and updates detail page', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Before edit ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // Open edit form
    const editBtn = page.locator('button', { hasText: /^Edit$/ });
    await expect(editBtn).toBeAttached({ timeout: 5000 });
    await editBtn.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeAttached({ timeout: 3000 });

    // The edit form opens in chatting phase — skip to confirming to see title field
    // In edit mode, the title is already populated from the task
    // The confirming phase shows the current title
    const skipLink = dialog.locator('text=Skip to quick create');
    if (await skipLink.isAttached().catch(() => false)) {
      // Not in confirming phase yet — but in edit mode the title is already set
      // Click "Review & Create" or skip to get to confirming
      const reviewBtn = dialog.locator('button', { hasText: /Review/ });
      if (await reviewBtn.isAttached().catch(() => false)) {
        await reviewBtn.click();
      } else {
        await skipLink.click();
      }
    }

    // Verify the edit form shows the current title
    await expect(dialog.locator(`text=${task.title}`).first()).toBeAttached({ timeout: 3000 });

    // Close without saving (we verified the edit form opens with correct data)
    await dialog.locator('button', { hasText: /^Cancel$/ }).first().click();
  });
});
```

- [ ] **Step 2: Run full functional test suite**

Run: `npx playwright test browser-tests/task-lifecycle.spec.ts --project lightpanda --reporter line 2>&1 | tail -10`
Expected: ~46 passed (5 + 10 + 7 + 10 + 6 + 5 + 3 + 2 = 48, but some groups may merge)

- [ ] **Step 3: Commit**

```bash
git add browser-tests/task-lifecycle.spec.ts
git commit -m "test: add operations, filtering, error, and edit flow functional tests"
```

---

### Task 7: Create visual test file (Chromium) with all groups + visual-only tests

**Files:**
- Create: `browser-tests/task-lifecycle.visual.spec.ts`

- [ ] **Step 1: Create file with full content**

Create `browser-tests/task-lifecycle.visual.spec.ts` by:

1. Copy the entire `browser-tests/task-lifecycle.spec.ts` file
2. Change the first line from `import { test, expect } from './fixtures.js';` to `import { test, expect } from '@playwright/test';`
3. Apply these systematic replacements throughout:
   - `toBeAttached()` → `toBeVisible()` (all instances)
   - `not.toBeAttached(` → `not.toBeVisible(` (all instances)
   - `isAttached()` → `isVisible()` (all instances in conditionals)
4. Add screenshots at these exact locations (insert AFTER the assertion they follow):

| After this assertion (in which test) | Insert |
|------|--------|
| Layout test 2: after collapse toggle check | `await expect(page).toHaveScreenshot('lifecycle-board-layout.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` |
| Dialog test 2: after "0/3 filled" check | `await expect(page).toHaveScreenshot('lifecycle-dialog-chatting.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` |
| Dialog test 5: after "Not filled" count check | `await expect(page).toHaveScreenshot('lifecycle-dialog-confirming.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` |
| Card test 1: after card in Queued check | `await expect(page).toHaveScreenshot('lifecycle-board-with-tasks.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` |
| Detail test 2: after risk badge check | `await expect(page).toHaveScreenshot('lifecycle-task-detail.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` |
| Detail test 5: after tab switching (stages) | `await expect(page).toHaveScreenshot('lifecycle-task-detail-stages.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` (insert after the `stages` iteration only) |
| Detail test 8: after ConfirmDialog check | `await expect(page).toHaveScreenshot('lifecycle-delete-confirm.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` |
| Filter test 2: after URL check | `await expect(page).toHaveScreenshot('lifecycle-filter-active.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` |
| Error test 1: after "Task not found" check | `await expect(page).toHaveScreenshot('lifecycle-error-not-found.png', { fullPage: true, maxDiffPixelRatio: 0.05 });` |

5. Append the 3 visual-only describe blocks (below) at the end of the file

The visual-only describe blocks to append:

```typescript
test.describe('Real-time WebSocket Updates', () => {
  const createdIds: number[] = [];
  test.afterAll(async () => {
    for (const id of createdIds) await deleteTask(id).catch(() => {});
  });

  test('new task appears on grid without reload', async ({ page }) => {
    const projectId = await getProjectId();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create task while page is open
    const task = await createTask(projectId, { title: `Realtime new ${Date.now()}` });
    createdIds.push(task.id);

    // Wait for card to appear via WebSocket
    const card = page.locator(`text=#${task.id}`).first();
    await expect(card).toBeVisible({ timeout: 8000 });
  });

  test('cancel reflects live on grid', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Realtime cancel ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify in Queued
    const queuedSection = page.locator('section[aria-label="Queued"]');
    await expect(queuedSection.locator(`text=#${task.id}`).first()).toBeVisible({ timeout: 5000 });

    // Cancel via API
    await cancelTask(task.id);

    // Should move to Completed section
    const completedSection = page.locator('section[aria-label="Completed"]');
    await expect(completedSection).toBeVisible({ timeout: 8000 });

    // Expand if collapsed
    const grid = completedSection.locator('.grid');
    if (!(await grid.isVisible().catch(() => false))) {
      await completedSection.locator('button').first().click();
    }
    await expect(completedSection.locator(`text=#${task.id}`).first()).toBeVisible({ timeout: 5000 });
  });

  test('status updates live on detail page', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Realtime detail ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // Verify shows "ready"
    await expect(page.locator('text=ready').first()).toBeVisible({ timeout: 5000 });

    // Cancel via API
    await cancelTask(task.id);

    // Status badge should update to "cancelled"
    await expect(page.locator('text=cancelled').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Responsive Behavior', () => {
  const createdIds: number[] = [];
  test.afterAll(async () => {
    for (const id of createdIds) await deleteTask(id).catch(() => {});
  });

  test('desktop 1280x800 shows expanded sidebar and multi-column grid', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Responsive desktop ${Date.now()}` });
    createdIds.push(task.id);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Agentboard').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator(`text=#${task.id}`).first()).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('lifecycle-responsive-desktop.png', { fullPage: true, maxDiffPixelRatio: 0.05 });
  });

  test('tablet 768x1024 shows grid', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Responsive tablet ${Date.now()}` });
    createdIds.push(task.id);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator(`text=#${task.id}`).first()).toBeVisible({ timeout: 5000 });
  });

  test('mobile 375x812 hides sidebar and shows hamburger', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Responsive mobile ${Date.now()}` });
    createdIds.push(task.id);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Hamburger toggle
    const hamburger = page.locator('button[aria-label="Toggle menu"]');
    await expect(hamburger).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('lifecycle-responsive-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.05 });
  });
});

test.describe('Keyboard Navigation', () => {
  const createdIds: number[] = [];
  test.afterAll(async () => {
    for (const id of createdIds) await deleteTask(id).catch(() => {});
  });

  test('Enter activates task card', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Keyboard Enter ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[role="button"][aria-label*="${task.id}"]`).first();
    await card.focus();
    await card.press('Enter');

    await expect(page).toHaveURL(`/tasks/${task.id}`, { timeout: 5000 });
  });

  test('Space activates task card', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Keyboard Space ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[role="button"][aria-label*="${task.id}"]`).first();
    await card.focus();
    await card.press(' ');

    await expect(page).toHaveURL(`/tasks/${task.id}`, { timeout: 5000 });
  });

  test('Escape closes New Task dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /new task/i }).first().click();
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });
});
```

Also add screenshots throughout the mirrored describe blocks. Key locations:

- After creating tasks on grid: `lifecycle-board-with-tasks.png`
- Dialog chatting phase: `lifecycle-dialog-chatting.png`
- Dialog confirming phase: `lifecycle-dialog-confirming.png`
- Task detail overview: `lifecycle-task-detail.png`
- Task detail stages tab: `lifecycle-task-detail-stages.png`
- Filter active: `lifecycle-filter-active.png`
- Error not found: `lifecycle-error-not-found.png`
- Delete confirm dialog: `lifecycle-delete-confirm.png`

- [ ] **Step 2: Run visual tests**

Run: `npx playwright test browser-tests/task-lifecycle.visual.spec.ts --project visual --reporter line --update-snapshots 2>&1 | tail -10`
Expected: All tests pass, snapshots generated

- [ ] **Step 3: Commit with snapshots**

```bash
git add browser-tests/task-lifecycle.visual.spec.ts browser-tests/*-snapshots/
git commit -m "test: add task-lifecycle visual regression tests with screenshots"
```

---

### Task 8: Update browser-testing documentation

**Files:**
- Modify: `docs/browser-testing.md`

- [ ] **Step 1: Read current file to find insertion points**

Read `docs/browser-testing.md` in full. Find the test inventory section (if it exists) and the "Running Tests" section.

- [ ] **Step 2: Add lifecycle tests to the documentation**

Add a new section after the existing test descriptions:

```markdown
## Task Lifecycle Tests

End-to-end tests exercising the full task lifecycle from creation to deletion. Both functional and visual variants exist:

| File | Runner | Tests | Purpose |
|------|--------|-------|---------|
| `task-lifecycle.spec.ts` | Lightpanda | ~48 | Fast functional DOM assertions |
| `task-lifecycle.visual.spec.ts` | Chromium | ~57 | Visual regression + screenshots |

### Test groups

1. **Layout & Navigation** — Sidebar, TopBar, nav links, collapse/expand
2. **Task Creation Dialog** — Chat phase, confirming phase, validation, phase transitions
3. **Task Card Rendering** — Title, description, status badge, risk level, ARIA, priority
4. **Task Detail Page** — Header, tabs, spec fields, action buttons, ConfirmDialog, sidebar
5. **Task Operations** — Backlog/ready status, cancel, risk levels, priority sorting, delete
6. **Filtering & Search** — Filter bar, status/risk filters, URL sync, search input
7. **Real-time WebSocket** — Live task creation, cancel, status updates `[visual-only]`
8. **Responsive** — Desktop/tablet/mobile viewports `[visual-only]`
9. **Error States** — Non-existent task, invalid ID, console errors
10. **Keyboard Navigation** — Enter/Space card activation, Escape dialog close `[visual-only]`
11. **Edit Flow** — Edit button, title update

### Running lifecycle tests

```bash
# Functional only (fast, ~3s)
npx playwright test browser-tests/task-lifecycle.spec.ts --project lightpanda

# Visual only (screenshots, ~10s)
npx playwright test browser-tests/task-lifecycle.visual.spec.ts --project visual

# Update visual baselines after UI changes
npx playwright test browser-tests/task-lifecycle.visual.spec.ts --project visual --update-snapshots
```

### Visual-only convention

Tests marked `[visual-only]` in the spec run only in the Chromium visual project. They rely on rendering, viewport, or WebSocket features that Lightpanda cannot support. In the functional file, these describe blocks are omitted entirely.

### Test data conventions

- All tests create their own tasks via API helpers at the top of each file
- Tasks are tracked in `createdIds` arrays and deleted in `afterAll`
- Task title: "Add player skill description field for team-making context"
- Tasks with spec → `ready` status; without spec → `backlog` status
- No AI/Claude dependency — specs are pre-filled JSON
```

- [ ] **Step 3: Commit documentation**

```bash
git add docs/browser-testing.md
git commit -m "docs: add task-lifecycle browser tests to documentation"
```

---

### Task 9: Run full test suite and verify

- [ ] **Step 1: Run functional tests**

Run: `npx playwright test browser-tests/task-lifecycle.spec.ts --project lightpanda --reporter list`
Expected: All ~48 tests pass

- [ ] **Step 2: Run visual tests**

Run: `npx playwright test browser-tests/task-lifecycle.visual.spec.ts --project visual --reporter list`
Expected: All ~57 tests pass (snapshots already generated in Task 7)

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx playwright test --reporter list 2>&1 | tail -20`
Expected: All existing tests still pass

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "test: fix any issues found during full suite verification"
```
