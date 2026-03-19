import { test, expect } from './fixtures.js';

test.describe('Board', () => {
  test('kanban columns render', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Main columns should be visible
    const expectedColumns = [
      'Backlog',
      'Ready',
      'Implementing',
      'Done',
    ];

    for (const label of expectedColumns) {
      const column = page.getByText(label, { exact: true }).first();
      await expect(column).toBeVisible();
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
      await expect(header).toBeVisible();
    }
  });

  test('extra status columns render', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const extraLabels = ['Blocked', 'Failed'];

    for (const label of extraLabels) {
      const column = page.getByText(label, { exact: true }).first();
      await expect(column).toBeVisible();
    }
  });
});
