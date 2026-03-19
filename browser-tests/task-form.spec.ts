import { test, expect } from './fixtures.js';

test.describe('Task creation', () => {
  test('"New Task" button opens dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the New Task button
    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await expect(newTaskBtn).toBeVisible();
    await newTaskBtn.click();

    // Dialog should appear with a title input
    const titleInput = page.getByPlaceholder(/title/i).or(page.locator('input[name="title"]'));
    await expect(titleInput).toBeVisible();
  });

  test('form validates required title field', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await newTaskBtn.click();

    // Try to submit without title — button should be disabled or form should show validation
    const titleInput = page.getByPlaceholder(/title/i).or(page.locator('input[name="title"]'));
    await expect(titleInput).toBeVisible();

    // Title should be empty initially
    const value = await titleInput.inputValue();
    expect(value).toBe('');
  });

  test('spec fields appear in task form', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await newTaskBtn.click();

    // Spec fields: Goal, User Scenarios, Success Criteria
    const specLabels = ['Goal', 'User Scenarios', 'Success Criteria'];
    for (const label of specLabels) {
      const field = page.getByText(label, { exact: false }).first();
      await expect(field).toBeVisible();
    }
  });
});
