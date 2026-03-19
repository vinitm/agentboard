import { test, expect } from './fixtures.js';

test.describe('Smoke tests', () => {
  test('page loads at /', async ({ page }) => {
    const response = await page.goto('/');
    // CDP default context may return null response — check page loaded via title instead
    if (response) {
      expect(response.status()).toBe(200);
    } else {
      await expect(page).toHaveTitle(/Agentboard/);
    }
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

    // Use DOM presence checks — Lightpanda has no layout engine for visibility
    const sidebar = page.locator('nav, [data-testid="sidebar"]').first();
    await expect(sidebar).toBeAttached();

    const board = page.locator('.board-scroll-container').first();
    await expect(board).toBeAttached();
  });
});
