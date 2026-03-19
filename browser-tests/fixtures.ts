import { test as base, chromium, type BrowserContext } from '@playwright/test';

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const cdpEndpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    const context = await browser.newContext();
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
