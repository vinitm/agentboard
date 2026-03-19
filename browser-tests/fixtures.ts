import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';

/**
 * Custom Playwright fixtures that connect to Lightpanda via CDP.
 *
 * Lightpanda doesn't support all Emulation CDP methods (e.g. setLocaleOverride),
 * so we reuse the default browser context from connectOverCDP() instead of
 * creating a new one via browser.newContext().
 *
 * Since the default CDP context doesn't inherit Playwright's baseURL config,
 * we resolve relative URLs manually in page.goto().
 */
export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const cdpEndpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
    const browser = await chromium.connectOverCDP(cdpEndpoint);
    const context = browser.contexts()[0] ?? await browser.newContext();
    await use(context);
  },
  page: async ({ context, baseURL }, use) => {
    const rawPage = await context.newPage();

    // Wrap page.goto to resolve relative paths against baseURL,
    // since the default CDP context doesn't inherit Playwright's baseURL.
    const originalGoto = rawPage.goto.bind(rawPage);
    rawPage.goto = (url: string, options?: Parameters<Page['goto']>[1]) => {
      if (baseURL && url.startsWith('/')) {
        url = `${baseURL}${url}`;
      }
      return originalGoto(url, options);
    };

    await use(rawPage);
    await rawPage.close();
  },
});

export { expect } from '@playwright/test';
