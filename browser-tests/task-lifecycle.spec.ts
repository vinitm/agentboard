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

// ---------------------------------------------------------------------------
// 1. Layout & Navigation
// ---------------------------------------------------------------------------
test.describe('Layout & Navigation', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Agentboard/);
  });

  test('sidebar renders with expected elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Logo text
    const logo = page.locator('aside').getByText('Agentboard');
    await expect(logo).toBeAttached();

    // Nav items
    for (const label of ['Board', 'Activity', 'Learnings', 'Costs', 'Design System', 'Settings']) {
      const link = page.locator('aside').getByText(label, { exact: true });
      await expect(link).toBeAttached();
    }

    // Projects heading
    const projectsHeading = page.locator('aside').getByText('Projects');
    await expect(projectsHeading).toBeAttached();

    // Connection status dot
    const statusDot = page.locator('aside span.rounded-full').first();
    await expect(statusDot).toBeAttached();

    // Collapse button text
    const collapseText = page.locator('aside').getByText('Collapse');
    await expect(collapseText).toBeAttached();
  });

  test('topbar renders with expected elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Title heading
    const title = page.locator('h2');
    await expect(title).toBeAttached();

    // Search input
    const searchInput = page.locator('input[placeholder="Search tasks..."]');
    await expect(searchInput).toBeAttached();

    // Kbd hint
    const kbd = page.locator('kbd');
    await expect(kbd).toBeAttached();

    // Filter button
    const filterBtn = page.locator('button', { hasText: /Filter/ });
    await expect(filterBtn).toBeAttached();

    // New Task button
    const newTaskBtn = page.locator('button', { hasText: /New Task/ });
    await expect(newTaskBtn).toBeAttached();
  });

  test('sidebar collapse and expand', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click Collapse
    const collapseBtn = page.locator('aside').getByText('Collapse');
    await collapseBtn.click();

    // "Agentboard" text should be gone from sidebar
    const logoText = page.locator('aside').getByText('Agentboard');
    await expect(logoText).not.toBeAttached();

    // Click the last button in aside to expand (chevron right)
    const expandBtn = page.locator('aside button').last();
    await expandBtn.click();

    // "Agentboard" text should return
    const logoTextAgain = page.locator('aside').getByText('Agentboard');
    await expect(logoTextAgain).toBeAttached();
  });

  test('nav links navigate correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click Activity
    const activityLink = page.locator('aside').getByText('Activity', { exact: true });
    await activityLink.click();
    await expect(page).toHaveURL(/\/activity/);

    // Click Board
    const boardLink = page.locator('aside').getByText('Board', { exact: true });
    await boardLink.click();
    await expect(page).toHaveURL(/\/$/);
  });
});

// ---------------------------------------------------------------------------
// 2. Task Creation Dialog
// ---------------------------------------------------------------------------
test.describe('Task Creation Dialog', () => {
  test('New Task opens dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newTaskBtn = page.locator('button', { hasText: /New Task/ });
    await newTaskBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached();

    const dialogTitle = dialog.getByText('New Task');
    await expect(dialogTitle).toBeAttached();
  });

  test('chatting phase shows welcome and spec preview', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /New Task/ }).click();

    // Welcome message
    const welcome = page.getByText(/Describe what you want to build/i);
    await expect(welcome).toBeAttached();

    // Chat textarea
    const textarea = page.locator('textarea[placeholder="Describe what you need built..."]');
    await expect(textarea).toBeAttached();

    // Spec Preview heading
    const specPreview = page.getByText('Spec Preview');
    await expect(specPreview).toBeAttached();

    // 0/3 filled
    const filledCount = page.getByText('0/3 filled');
    await expect(filledCount).toBeAttached();
  });

  test('send button disabled when textarea is empty', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /New Task/ }).click();

    const sendBtn = page.locator('button[title="Send (Enter)"]');
    await expect(sendBtn).toBeDisabled();
  });

  test('"Skip to quick create" link is present', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /New Task/ }).click();

    const skipLink = page.getByText(/Skip to quick create/i);
    await expect(skipLink).toBeAttached();
  });

  test('skip transitions to confirming phase', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /New Task/ }).click();
    await page.getByText(/Skip to quick create/i).click();

    // Textarea should be gone (confirming phase)
    const textarea = page.locator('textarea[placeholder="Describe what you need built..."]');
    await expect(textarea).not.toBeAttached();

    // Spec field labels
    for (const label of ['Goal', 'User Scenarios', 'Success Criteria']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeAttached();
    }

    // At least 3 "Not filled" texts
    const notFilled = page.getByText('Not filled');
    const count = await notFilled.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('confirming shows task meta and action buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /New Task/ }).click();
    await page.getByText(/Skip to quick create/i).click();

    // Untitled Task
    await expect(page.getByText('Untitled Task')).toBeAttached();

    // Low risk
    await expect(page.getByText(/Low risk/i)).toBeAttached();

    // Action buttons
    await expect(page.locator('button', { hasText: /^Cancel$/ })).toBeAttached();
    await expect(page.locator('button', { hasText: /Keep Editing/ })).toBeAttached();
    await expect(page.locator('button', { hasText: /Create Task/ })).toBeAttached();
  });

  test('title validation on Create Task', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /New Task/ }).click();
    await page.getByText(/Skip to quick create/i).click();

    await page.locator('button', { hasText: /Create Task/ }).click();

    const error = page.getByText('Title is required');
    await expect(error).toBeAttached();
  });

  test('spec field validation on edit', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTaskMinimal(projectId, `Spec validation test ${Date.now()}`);

    try {
      await page.goto(`/tasks/${task.id}`);
      await page.waitForLoadState('networkidle');

      // Click Edit button
      const editBtn = page.locator('button', { hasText: /^Edit$/ });
      await editBtn.click();

      // Skip to confirming
      await page.getByText(/Skip to quick create/i).click();

      // Click Update Task
      await page.locator('button', { hasText: /Update Task/ }).click();

      // Error should mention spec fields
      const error = page.getByText(/Goal/);
      await expect(error).toBeAttached();

      const errorScenarios = page.getByText(/User Scenarios/);
      await expect(errorScenarios).toBeAttached();

      const errorCriteria = page.getByText(/Success Criteria/);
      await expect(errorCriteria).toBeAttached();
    } finally {
      await deleteTask(task.id);
    }
  });

  test('Keep Editing returns to chat phase', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /New Task/ }).click();
    await page.getByText(/Skip to quick create/i).click();

    // Click Keep Editing
    await page.locator('button', { hasText: /Keep Editing/ }).click();

    // Textarea should reappear
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeAttached();

    // Spec Preview still present
    await expect(page.getByText('Spec Preview')).toBeAttached();
  });

  test('cancel closes dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /New Task/ }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached();

    await page.locator('button', { hasText: /^Cancel$/ }).click();

    await expect(dialog).not.toBeAttached();
    await expect(page.locator('#main-content')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// 3. Task Card Rendering
// ---------------------------------------------------------------------------
test.describe('Task Card Rendering', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) {
      await deleteTask(id).catch(() => {});
    }
  });

  test('task appears in Queued section', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const queuedSection = page.locator('section[aria-label="Queued"]');
    await expect(queuedSection).toBeAttached();

    const idText = queuedSection.getByText(`#${task.id}`);
    await expect(idText).toBeAttached();
  });

  test('card shows title and description', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const taskId = createdIds[0];
    const card = page.locator(`[aria-label*="${taskId}"]`).first();

    await expect(card.getByText(TASK_TITLE)).toBeAttached();
    await expect(card.getByText(TASK_DESCRIPTION)).toBeAttached();
  });

  test('card shows ready status badge', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const taskId = createdIds[0];
    const card = page.locator(`[aria-label*="${taskId}"]`).first();

    await expect(card.getByText('ready')).toBeAttached();
  });

  test('card shows risk level', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { riskLevel: 'medium', title: `Medium risk test ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).first();
    await expect(card.getByText('medium')).toBeAttached();
  });

  test('card has PipelineBar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const taskId = createdIds[0];
    const card = page.locator(`[aria-label*="${taskId}"]`).first();

    // PipelineBar renders as a .flex container inside the card
    const pipelineBar = card.locator('.flex').first();
    await expect(pipelineBar).toBeAttached();
  });

  test('card has correct ARIA attributes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const taskId = createdIds[0];
    const card = page.locator(`[aria-label*="${taskId}"]`).first();

    await expect(card).toHaveAttribute('role', 'button');

    const ariaLabel = await card.getAttribute('aria-label');
    expect(ariaLabel).toContain(`#${taskId}`);
    expect(ariaLabel).toContain(TASK_TITLE);
    expect(ariaLabel).toContain('low');
    expect(ariaLabel).toContain('ready');
  });

  test('priority badge renders', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { priority: 5, title: `Priority test ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).first();
    await expect(card.getByText('P5')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// 4. Task Detail Page
// ---------------------------------------------------------------------------
test.describe('Task Detail Page', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) {
      await deleteTask(id).catch(() => {});
    }
  });

  test('card click navigates to detail page', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Detail page test ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).first();
    await card.click();

    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}`));
  });

  test('header renders breadcrumb, id, title, status, and risk', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    // Breadcrumb
    const breadcrumb = page.locator('a', { hasText: 'Tasks' }).first();
    await expect(breadcrumb).toBeAttached();

    // Task ID
    await expect(page.getByText(`#${taskId}`).first()).toBeAttached();

    // Title in h1
    const h1 = page.locator('h1');
    await expect(h1).toBeAttached();

    // Status
    await expect(page.getByText('ready').first()).toBeAttached();

    // Risk level
    await expect(page.getByText('low').first()).toBeAttached();
  });

  test('PipelineBar labels render', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    for (const label of ['spec review', 'planning', 'implementing']) {
      await expect(page.getByText(label, { exact: false }).first()).toBeAttached();
    }
  });

  test('all 7 tabs render', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    for (const tabLabel of ['Overview', 'Stages', 'Events', 'Runs', 'Chat', 'Artifacts', 'Costs']) {
      const tab = page.locator('button', { hasText: new RegExp(`^${tabLabel}`) });
      await expect(tab).toBeAttached();
    }
  });

  test('tab switching updates URL hash', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    const tabHashes: Record<string, string> = {
      Stages: '#stages',
      Events: '#events',
      Runs: '#runs',
      Chat: '#chat',
      Artifacts: '#artifacts',
      Costs: '#costs',
    };

    for (const [tabLabel, hash] of Object.entries(tabHashes)) {
      const tab = page.locator('button', { hasText: new RegExp(`^${tabLabel}`) });
      await tab.click();
      await expect(page).toHaveURL(new RegExp(`${hash}$`));
    }
  });

  test('overview shows spec content', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    // The overview tab should show spec content
    await expect(page.getByText(/skill description field/i).first()).toBeAttached();
  });

  test('action buttons render', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    // Move to select
    const moveSelect = page.locator('select').filter({ hasText: /Move to/ });
    await expect(moveSelect).toBeAttached();

    // Delete button
    const deleteBtn = page.locator('button', { hasText: /Delete/ });
    await expect(deleteBtn).toBeAttached();
  });

  test('delete opens ConfirmDialog then cancel closes it', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /Delete/ }).click();

    // Confirm dialog
    await expect(page.getByText('Delete this task?')).toBeAttached();

    // Cancel the dialog
    const cancelBtn = page.locator('button', { hasText: /^Cancel$/ });
    await cancelBtn.click();

    // Dialog should close
    await expect(page.getByText('Delete this task?')).not.toBeAttached();
  });

  test('TaskSidebar renders', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    // TaskSidebar is the last .shrink-0 element in the layout
    const sidebar = page.locator('.shrink-0').last();
    await expect(sidebar).toBeAttached();
  });

  test('breadcrumb navigates back to grid', async ({ page }) => {
    const taskId = createdIds[0];
    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    const breadcrumb = page.locator('a', { hasText: 'Tasks' }).first();
    await breadcrumb.click();

    await expect(page).toHaveURL(/\/$/);
  });
});

// ---------------------------------------------------------------------------
// 5. Task Operations
// ---------------------------------------------------------------------------
test.describe('Task Operations', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) {
      await deleteTask(id).catch(() => {});
    }
  });

  test('backlog task appears in Queued section', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTaskMinimal(projectId, `Backlog test ${Date.now()}`);
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const queuedSection = page.locator('section[aria-label="Queued"]');
    await expect(queuedSection).toBeAttached();
    await expect(queuedSection.getByText(`#${task.id}`)).toBeAttached();
  });

  test('ready task appears in Queued with ready badge', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Ready test ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const queuedSection = page.locator('section[aria-label="Queued"]');
    const card = queuedSection.locator(`[aria-label*="${task.id}"]`).first();
    await expect(card).toBeAttached();
    await expect(card.getByText('ready')).toBeAttached();
  });

  test('cancelled task appears in Completed section', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTaskMinimal(projectId, `Cancel test ${Date.now()}`);
    createdIds.push(task.id);
    await cancelTask(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const completedSection = page.locator('section[aria-label="Completed"]');
    await expect(completedSection).toBeAttached();

    // Expand if collapsed
    const grid = completedSection.locator('.grid');
    const isCollapsed = !(await grid.isAttached().catch(() => false));
    if (isCollapsed) {
      const toggleBtn = completedSection.locator('button').first();
      await toggleBtn.click();
    }

    await expect(completedSection.getByText(`#${task.id}`)).toBeAttached();
  });

  test('three risk levels render correctly', async ({ page }) => {
    const projectId = await getProjectId();
    const lowTask = await createTask(projectId, { riskLevel: 'low', title: `Low risk ${Date.now()}` });
    const medTask = await createTask(projectId, { riskLevel: 'medium', title: `Medium risk ${Date.now()}` });
    const highTask = await createTask(projectId, { riskLevel: 'high', title: `High risk ${Date.now()}` });
    createdIds.push(lowTask.id, medTask.id, highTask.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const lowCard = page.locator(`[aria-label*="${lowTask.id}"]`).first();
    await expect(lowCard.getByText('low')).toBeAttached();

    const medCard = page.locator(`[aria-label*="${medTask.id}"]`).first();
    await expect(medCard.getByText('medium')).toBeAttached();

    const highCard = page.locator(`[aria-label*="${highTask.id}"]`).first();
    await expect(highCard.getByText('high')).toBeAttached();
  });

  test('priority sorting — highest priority first', async ({ page }) => {
    const projectId = await getProjectId();
    const p0 = await createTask(projectId, { priority: 0, title: `P0 sort test ${Date.now()}` });
    const p5 = await createTask(projectId, { priority: 5, title: `P5 sort test ${Date.now()}` });
    const p10 = await createTask(projectId, { priority: 10, title: `P10 sort test ${Date.now()}` });
    createdIds.push(p0.id, p5.id, p10.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The first card in Queued should be the highest priority
    const queuedSection = page.locator('section[aria-label="Queued"]');
    const firstCard = queuedSection.locator('[role="button"]').first();
    const ariaLabel = await firstCard.getAttribute('aria-label');
    expect(ariaLabel).toContain(`#${p10.id}`);
  });

  test('deleted task is gone from grid', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Delete grid test ${Date.now()}` });
    // Do NOT push to createdIds — we delete it ourselves

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify it exists
    await expect(page.locator(`[aria-label*="${task.id}"]`).first()).toBeAttached();

    // Delete via API
    await deleteTask(task.id);

    // Reload and verify it is gone
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`[aria-label*="${task.id}"]`)).not.toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// 6. Filtering & Search
// ---------------------------------------------------------------------------
test.describe('Filtering & Search', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) {
      await deleteTask(id).catch(() => {});
    }
  });

  test('filter button reveals filter selects', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /Filter/ }).click();

    // At least 3 select elements (status, risk, running)
    const selects = page.locator('select');
    const count = await selects.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('status filter updates URL', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /Filter/ }).click();

    // First select is status
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('backlog');

    await expect(page).toHaveURL(/[?&]status=backlog/);
  });

  test('risk filter updates URL', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /Filter/ }).click();

    // Second select is risk
    const riskSelect = page.locator('select').nth(1);
    await riskSelect.selectOption('low');

    await expect(page).toHaveURL(/[?&]risk=low/);
  });

  test('clear all removes filter params', async ({ page }) => {
    await page.goto('/?status=backlog&risk=low');
    await page.waitForLoadState('networkidle');

    await page.locator('button', { hasText: /Filter/ }).click();

    const clearBtn = page.getByText('Clear all');
    await clearBtn.click();

    // URL should not have status or risk params
    const url = page.url();
    expect(url).not.toMatch(/status=/);
    expect(url).not.toMatch(/risk=/);
  });

  test('search updates URL and clear resets', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Searchable unique ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder="Search tasks..."]');
    await searchInput.fill('Searchable unique');

    // Wait for debounced URL update
    await expect(page).toHaveURL(/[?&]q=/, { timeout: 5000 });

    // Clear search
    const clearBtn = page.locator('button[aria-label="Clear search"]');
    await clearBtn.click();

    const url = page.url();
    expect(url).not.toMatch(/q=/);
  });
});

// ---------------------------------------------------------------------------
// 7. Error States
// ---------------------------------------------------------------------------
test.describe('Error States', () => {
  test('non-existent task shows not found', async ({ page }) => {
    await page.goto('/tasks/999999');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Task not found')).toBeAttached();

    const backLink = page.locator('a', { hasText: 'Back to Tasks' });
    await expect(backLink).toBeAttached();
  });

  test('invalid task ID shows error state', async ({ page }) => {
    await page.goto('/tasks/abc');
    await page.waitForLoadState('networkidle');

    // Should show some error state (the component handles NaN IDs)
    const errorIndicator = page.getByText(/not found|error/i).first();
    await expect(errorIndicator).toBeAttached();
  });

  test('no console errors on grid load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. Edit Flow
// ---------------------------------------------------------------------------
test.describe('Edit Flow', () => {
  const createdIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) {
      await deleteTask(id).catch(() => {});
    }
  });

  test('edit button opens dialog with Edit Task title', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `Edit flow test ${Date.now()}` });
    createdIds.push(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    const editBtn = page.locator('button', { hasText: /^Edit$/ });
    await editBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached();

    await expect(dialog.getByText('Edit Task')).toBeAttached();
  });

  test('edit form shows pre-filled title and can be cancelled', async ({ page }) => {
    const taskId = createdIds[0];
    const task = await getTask(taskId);

    await page.goto(`/tasks/${taskId}`);
    await page.waitForLoadState('networkidle');

    const editBtn = page.locator('button', { hasText: /^Edit$/ });
    await editBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeAttached();

    // Title should be visible somewhere in the dialog (either as text or in the header)
    await expect(dialog.getByText(task.title, { exact: false }).first()).toBeAttached();

    // Close with cancel
    await page.locator('button', { hasText: /^Cancel$/ }).click();
    await expect(dialog).not.toBeAttached();
  });
});
