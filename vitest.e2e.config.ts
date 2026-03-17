import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
