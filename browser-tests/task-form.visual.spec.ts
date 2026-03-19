import { test, expect } from '@playwright/test';

test.describe('Task form — visual regression', () => {
  test('new task dialog', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await newTaskBtn.click();

    // Wait for dialog animation to settle
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('task-dialog-open.png');
  });

  test('task form fields', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await newTaskBtn.click();
    await page.waitForTimeout(300);

    // Focus on the form area
    const dialog = page.locator('dialog, [role="dialog"], [data-testid="task-dialog"]').first();
    await expect(dialog).toHaveScreenshot('task-form-fields.png');
  });
});
