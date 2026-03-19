import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  timeout: 30_000,
  retries: 1,
  outputDir: '.agentboard/browser-test-results',
  webServer: {
    command: 'npm run dev',
    port: 4200,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    // Functional tests — Lightpanda via CDP (fast, no rendering)
    {
      name: 'lightpanda',
      testMatch: /^(?!.*\.visual\.).*\.spec\.ts$/,
      use: {
        baseURL: 'http://localhost:4200',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
      globalSetup: './browser-tests/global-setup.ts',
      globalTeardown: './browser-tests/global-teardown.ts',
    },
    // Visual regression tests — real Chromium (screenshots + rendering)
    {
      name: 'visual',
      testMatch: /\.visual\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4200',
        screenshot: 'on',
        trace: 'retain-on-failure',
      },
    },
  ],
  // Visual comparison settings
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
});
