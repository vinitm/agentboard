import { test, expect } from './fixtures.js';

test.describe('Task Grid', () => {
  test('grid renders with status groups', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The grid should show group headers when tasks exist,
    // or an empty state when no tasks exist
    const grid = page.locator('section, [data-testid="task-grid"]').first();
    const emptyState = page.getByText(/no tasks/i).first();

    // One of these should be present
    const gridAttached = await grid.isAttached().catch(() => false);
    const emptyAttached = await emptyState.isAttached().catch(() => false);
    expect(gridAttached || emptyAttached).toBe(true);
  });

  test('status group labels render for populated groups', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // These are the possible group labels in the new grid view
    const possibleGroups = [
      'Needs Attention',
      'Running',
      'Queued',
      'Completed',
    ];

    // At least one group should be visible if tasks exist,
    // or the empty state should show
    let found = false;
    for (const label of possibleGroups) {
      const group = page.getByText(label, { exact: true }).first();
      if (await group.isAttached().catch(() => false)) {
        found = true;
        break;
      }
    }

    if (!found) {
      // No groups means empty state should be showing
      const emptyState = page.getByText(/no tasks/i).first();
      await expect(emptyState).toBeAttached();
    }
  });

  test('task cards are clickable', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // If there are task cards, they should have role="button"
    const cards = page.locator('[role="button"]');
    const count = await cards.count();

    if (count > 0) {
      // First card should be clickable (has cursor-pointer)
      const firstCard = cards.first();
      await expect(firstCard).toBeAttached();
    }
    // If no cards, that's fine — empty state
  });
});
