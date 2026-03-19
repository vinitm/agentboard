import { test, expect } from '@playwright/test';

test.describe('Task Grid — visual regression', () => {
  test('grid page renders correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('grid-full.png', {
      fullPage: true,
    });
  });

  test('task grid layout', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const mainContent = page.locator('#main-content').first();
    await expect(mainContent).toHaveScreenshot('grid-content.png');
  });

  test('sidebar navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('nav, [data-testid="sidebar"]').first();
    await expect(sidebar).toHaveScreenshot('sidebar.png');
  });
});
