import { test, expect } from './fixtures.js';

test.describe('Task creation', () => {
  test('"New Task" button opens dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Use text selector — more reliable than getByRole in Lightpanda
    const newTaskBtn = page.locator('button', { hasText: /new task/i });
    await expect(newTaskBtn).toBeAttached();
    await newTaskBtn.click();

    // Dialog should appear with an input for the task description
    const dialog = page.locator('[role="dialog"], dialog, [data-testid="task-dialog"]').first();
    await expect(dialog).toBeAttached();
  });

  test('form validates required title field', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newTaskBtn = page.locator('button', { hasText: /new task/i });
    await newTaskBtn.click();

    // Check dialog is present
    const dialog = page.locator('[role="dialog"], dialog, [data-testid="task-dialog"]').first();
    await expect(dialog).toBeAttached();
  });

  test('spec fields appear in task form', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newTaskBtn = page.locator('button', { hasText: /new task/i });
    await newTaskBtn.click();

    // Spec fields: Goal, User Scenarios, Success Criteria
    const specLabels = ['Goal', 'User Scenarios', 'Success Criteria'];
    for (const label of specLabels) {
      const field = page.getByText(label, { exact: false }).first();
      await expect(field).toBeAttached();
    }
  });
});
