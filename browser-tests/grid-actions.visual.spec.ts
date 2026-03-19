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

async function createTask(projectId: string, overrides: Partial<{ title: string; description: string; priority: number; riskLevel: string }> = {}): Promise<Task> {
  const body = {
    projectId,
    title: overrides.title ?? `E2E test task ${Date.now()}`,
    description: overrides.description ?? 'Created by grid-actions E2E test',
    priority: overrides.priority ?? 0,
    riskLevel: overrides.riskLevel ?? 'low',
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

test.describe('Grid Actions — E2E', () => {
  const createdTaskIds: number[] = [];

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      await deleteTask(id).catch(() => {});
    }
  });

  test('Filter tasks by status — opens filter bar and updates URL', async ({ page }) => {
    const projectId = await getProjectId();

    // Create tasks for this test
    const task1 = await createTask(projectId, { title: `E2E filter task A ${Date.now()}` });
    createdTaskIds.push(task1.id);

    const task2 = await createTask(projectId, { title: `E2E filter task B ${Date.now()}` });
    createdTaskIds.push(task2.id);
    await cancelTask(task2.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open the filter bar by clicking the Filter button.
    // Use 'button' element (not div[role="button"] which task cards use).
    const filterBtn = page.locator('button').filter({ hasText: /^Filter/ });
    await expect(filterBtn).toBeVisible({ timeout: 5000 });
    await filterBtn.click();

    // The filter bar should now be visible with the status select
    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toBeVisible({ timeout: 5000 });

    // Select "Backlog" status filter
    await statusSelect.selectOption('backlog');

    // Wait for URL to update with filter param
    await expect(page).toHaveURL(/status=backlog/, { timeout: 3000 });

    // Verify the filter badge appears in the TopBar (span with count '1')
    // The badge is a rounded span inside the filter button after a filter is applied
    const filterBadge = page.locator('button').filter({ hasText: /^Filter/ }).locator('span.rounded-full');
    await expect(filterBadge).toBeVisible({ timeout: 3000 });

    await expect(page).toHaveScreenshot('grid-actions-filter-active.png', { fullPage: true });

    // Clear the filter by selecting "All Statuses"
    await statusSelect.selectOption('');
    await page.waitForTimeout(200);

    // URL should no longer have status param
    await expect(page).not.toHaveURL(/status=backlog/, { timeout: 3000 });

    // Filter badge should be gone
    await expect(filterBadge).not.toBeVisible({ timeout: 3000 });

    await expect(page).toHaveScreenshot('grid-actions-filter-cleared.png', { fullPage: true });
  });

  test('Task detail page loads with title and breadcrumb', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `E2E detail page test ${Date.now()}` });
    createdTaskIds.push(task.id);

    // Navigate directly to task detail page
    await page.goto(`/tasks/${task.id}`);
    await page.waitForLoadState('networkidle');

    // Verify the task title is shown
    const titleHeading = page.locator('h1');
    await expect(titleHeading).toBeVisible({ timeout: 5000 });
    await expect(titleHeading).toContainText(task.title, { timeout: 5000 });

    // Verify the breadcrumb "Tasks" link is visible
    const breadcrumb = page.getByRole('link', { name: /tasks/i }).first();
    await expect(breadcrumb).toBeVisible({ timeout: 5000 });

    // Verify URL is correct
    await expect(page).toHaveURL(`/tasks/${task.id}`);

    await expect(page).toHaveScreenshot('grid-actions-task-detail.png', { fullPage: true });
  });

  test('Cancel task via API and verify in Completed group', async ({ page }) => {
    const projectId = await getProjectId();
    const task = await createTask(projectId, { title: `E2E cancel test ${Date.now()}` });
    createdTaskIds.push(task.id);

    // Cancel the task via API before loading the page
    await cancelTask(task.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find and expand the Completed group (it is collapsed by default)
    const completedSection = page.locator('section[aria-label="Completed"]');
    await expect(completedSection).toBeVisible({ timeout: 5000 });

    // Check if the grid is already visible (section might be expanded by default if tasks exist)
    const completedGrid = completedSection.locator('.grid');
    const isExpanded = await completedGrid.isVisible();

    if (!isExpanded) {
      // Toggle to expand
      const toggleBtn = completedSection.locator('button').first();
      await toggleBtn.click();
      await expect(completedGrid).toBeVisible({ timeout: 5000 });
    }

    // Verify the cancelled task is in the Completed group
    const cancelledCard = completedGrid.locator(`text=#${task.id}`).or(completedGrid.locator(`[aria-label*="${task.id}"]`));
    await expect(cancelledCard.first()).toBeVisible({ timeout: 5000 });
  });
});
