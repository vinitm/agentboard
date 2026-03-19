---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "src/test/**"
  - "e2e/**"
---

# Testing Requirements

## Minimum Test Coverage: 80%

Test Types (ALL required):
1. **Unit Tests** — Individual functions, utilities, components
2. **Integration Tests** — API endpoints, database operations
3. **E2E Tests** — Critical user flows (Playwright in `e2e/`)

## Agentboard Test Helpers

Always use the project's test infrastructure:
- `createTestDb()` from `src/test/helpers.ts` — in-memory SQLite per test
- `createTestRepo()` — real git repo with auto-cleanup
- `createTestApp()` — Express app with supertest for API route tests

## Troubleshooting Test Failures

1. Use **tdd-guide** agent
2. Check test isolation — each test gets its own DB via `createTestDb()`
3. Verify mocks are correct
4. Fix implementation, not tests (unless tests are wrong)

## Agent Support

- **tdd-guide** — Use PROACTIVELY for new features, enforces write-tests-first
- **e2e-runner** — Playwright E2E testing specialist for critical user flows
