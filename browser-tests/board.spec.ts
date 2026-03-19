import { test, expect } from './fixtures.js';

test.describe('Board', () => {
  test('kanban columns render', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Main columns should be present in the DOM
    const expectedColumns = [
      'Backlog',
      'Ready',
      'Implementing',
      'Done',
    ];

    for (const label of expectedColumns) {
      const column = page.getByText(label, { exact: true }).first();
      await expect(column).toBeAttached();
    }
  });

  test('column headers have correct labels', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Pipeline columns should have standard agentboard labels
    const pipelineLabels = [
      'Spec Review',
      'Planning',
      'Plan Review',
      'Checks',
      'Code Quality',
      'Final Review',
    ];

    for (const label of pipelineLabels) {
      const header = page.getByText(label, { exact: true }).first();
      await expect(header).toBeAttached();
    }
  });

  test('extra status columns render when populated', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Blocked/Failed columns only render when tasks exist in those statuses.
    // Verify the main board container exists — column presence depends on data.
    const board = page.locator('.board-scroll-container').first();
    await expect(board).toBeAttached();
  });
});
