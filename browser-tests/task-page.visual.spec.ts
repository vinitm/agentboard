import { test, expect } from '@playwright/test';

test.describe('Task page — visual regression', () => {
  test('task detail view', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click the first task card to open task detail
    const taskCard = page.locator('[data-testid="task-card"]').first();
    const hasCards = await taskCard.count() > 0;

    if (hasCards) {
      await taskCard.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('task-detail.png', {
        fullPage: true,
      });
    }
  });

  test('settings page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to settings if available
    const settingsLink = page.getByRole('link', { name: /settings/i })
      .or(page.getByRole('button', { name: /settings/i }));
    const hasSettings = await settingsLink.count() > 0;

    if (hasSettings) {
      await settingsLink.first().click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('settings-page.png', {
        fullPage: true,
      });
    }
  });
});
