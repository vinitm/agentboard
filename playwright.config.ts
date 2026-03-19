import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4200',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: '.agentboard/browser-test-results',
  webServer: {
    command: 'npm run dev',
    port: 4200,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  globalSetup: './browser-tests/global-setup.ts',
  globalTeardown: './browser-tests/global-teardown.ts',
});
