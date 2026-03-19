import { test, expect } from '@playwright/test';

test.describe('Board — visual regression', () => {
  test('board page renders correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('board-full.png', {
      fullPage: true,
    });
  });

  test('kanban columns layout', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const board = page.locator('.board-scroll-container').first();
    await expect(board).toHaveScreenshot('board-columns.png');
  });

  test('sidebar navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('nav, [data-testid="sidebar"]').first();
    await expect(sidebar).toHaveScreenshot('sidebar.png');
  });
});
