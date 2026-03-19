import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:4200';

interface Project {
  id: string;
  name: string;
  path: string;
}

interface Task {
  id: number;
  projectId: string;
  title: string;
  status: string;
  description?: string;
  riskLevel: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

async function getProjectId(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/projects`);
  const projects: Project[] = await res.json();
  if (projects.length === 0) throw new Error('No projects found — register a project first');
  return projects[0].id;
}

async function createTask(projectId: string, overrides: Partial<{ title: string; description: string; priority: number }> = {}): Promise<Task> {
  const body = {
    projectId,
    title: overrides.title ?? `E2E test task ${Date.now()}`,
    description: overrides.description ?? 'Created by grid-workflow E2E test',
    priority: overrides.priority ?? 0,
  };
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status} ${await res.text()}`);
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

test.describe('Grid Workflow — E2E', () => {
  const createdTaskIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      await deleteTask(id).catch(() => {});
    }
  });

  test('Create task via New Task button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click "+ New Task" button
    const newTaskBtn = page.getByRole('button', { name: 'New Task', exact: true });
    await expect(newTaskBtn).toBeVisible({ timeout: 5000 });
    await newTaskBtn.click();

    // Wait for the task form dialog to appear
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // The chat textarea is present in the "chatting" phase
    const chatInput = page.locator('textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Take screenshot of the open dialog (chatting phase)
    await expect(page).toHaveScreenshot('grid-workflow-create-task.png', { fullPage: true });

    // Click "Skip to quick create" to go directly to confirming phase
    const skipBtn = page.getByText(/skip to quick create/i);
    await expect(skipBtn).toBeVisible({ timeout: 5000 });
    await skipBtn.click();

    // Confirming phase — dialog still open, shows spec preview
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // The chat input should no longer be visible (we are in confirming phase)
    await expect(chatInput).not.toBeVisible({ timeout: 3000 });

    // Close the dialog using Cancel (no confirm since no messages were sent)
    const cancelBtn = dialog.getByRole('button', { name: /^cancel$/i });
    await cancelBtn.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Verify the grid is visible
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 5000 });
  });

  test('Task appears in Queued and moves to Completed after cancel via API', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `E2E realtime test ${Date.now()}` });
    createdTaskIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify task is in Queued group (backlog status → Queued section)
    const queuedSection = page.locator('section[aria-label="Queued"]');
    await expect(queuedSection).toBeVisible({ timeout: 5000 });
    const taskCard = queuedSection.locator(`text=#${task.id}`).or(queuedSection.locator(`[aria-label*="${task.id}"]`));
    await expect(taskCard.first()).toBeVisible({ timeout: 5000 });

    // Cancel the task via API — this triggers a WebSocket 'task:updated' event
    await cancelTask(task.id);

    // The Completed group should now appear (it was defaultCollapsed)
    // Click to expand Completed group if it's collapsed
    const completedSection = page.locator('section[aria-label="Completed"]');

    // Wait for Completed group to appear (it only renders when tasks exist)
    await expect(completedSection).toBeVisible({ timeout: 8000 });

    // Expand Completed group if collapsed
    const completedToggle = completedSection.locator('button').first();
    const completedGrid = completedSection.locator('.grid');
    const isCollapsed = !(await completedGrid.isVisible());
    if (isCollapsed) {
      await completedToggle.click();
    }

    // Verify the task card is now in Completed group
    await expect(completedGrid).toBeVisible({ timeout: 5000 });
    const completedCard = completedGrid.locator(`text=#${task.id}`).or(completedGrid.locator(`[aria-label*="${task.id}"]`));
    await expect(completedCard.first()).toBeVisible({ timeout: 5000 });

    // Use higher pixel ratio tolerance since task cards show dynamic timestamps ("X ago")
    await expect(page).toHaveScreenshot('grid-workflow-realtime-move.png', { fullPage: true, maxDiffPixelRatio: 0.05 });
  });

  test('Card click navigates to detail page', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `E2E card nav test ${Date.now()}` });
    createdTaskIds.push(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find the task card
    const card = page.locator(`[aria-label*="${task.id}"]`).or(page.locator(`text=#${task.id}`)).first();
    await expect(card).toBeVisible({ timeout: 5000 });

    // Click the card
    await card.click();

    // Verify URL changed to /tasks/:id
    await expect(page).toHaveURL(`/tasks/${task.id}`, { timeout: 5000 });

    // Verify the detail page shows the task title
    const titleHeading = page.locator('h1');
    await expect(titleHeading).toBeVisible({ timeout: 5000 });
    await expect(titleHeading).toContainText(task.title, { timeout: 5000 });

    // Verify breadcrumb "Tasks" link is present
    const breadcrumb = page.getByRole('link', { name: /tasks/i }).first();
    await expect(breadcrumb).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('grid-workflow-task-detail.png', { fullPage: true });

    // Click breadcrumb back to grid
    await breadcrumb.click();
    await expect(page).toHaveURL('/', { timeout: 5000 });
  });

  test('Empty state shows No tasks yet message', async ({ page }) => {
    // Check if there are tasks — if yes, skip
    const projectId = await getProjectId();
    const res = await fetch(`${API_BASE}/api/tasks?projectId=${projectId}`);
    const tasks: Task[] = await res.json();

    if (tasks.length > 0) {
      test.skip();
      return;
    }

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify empty state message
    const emptyMsg = page.getByText(/no tasks yet/i);
    await expect(emptyMsg).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('grid-workflow-empty-state.png', { fullPage: true });
  });

  test('Responsive grid — task visible at 1280px and 375px', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `E2E responsive test ${Date.now()}` });
    createdTaskIds.push(task.id);

    // Desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator(`[aria-label*="${task.id}"]`).or(page.locator(`text=#${task.id}`)).first();
    await expect(card).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('grid-workflow-responsive-desktop.png', { fullPage: true });

    // Mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(200);

    const cardMobile = page.locator(`[aria-label*="${task.id}"]`).or(page.locator(`text=#${task.id}`)).first();
    await expect(cardMobile).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('grid-workflow-responsive-mobile.png', { fullPage: true });
  });
});
