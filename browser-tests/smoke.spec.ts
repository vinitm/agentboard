import { test, expect } from './fixtures.js';

test.describe('Smoke tests', () => {
  test('page loads at /', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });

  test('title contains Agentboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Agentboard/);
  });

  test('key layout elements render', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Sidebar navigation should be visible
    const sidebar = page.locator('nav, [data-testid="sidebar"]').first();
    await expect(sidebar).toBeVisible();

    // Board area should be present
    const board = page.locator('[data-testid="board"], main').first();
    await expect(board).toBeVisible();
  });
});
