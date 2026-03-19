import { test, expect } from '@playwright/test';

test.describe('Responsive — visual regression', () => {
  test('mobile viewport (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('grid-mobile.png', {
      fullPage: true,
    });
  });

  test('tablet viewport (768px)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('grid-tablet.png', {
      fullPage: true,
    });
  });

  test('wide viewport (1920px)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('grid-wide.png', {
      fullPage: true,
    });
  });
});
