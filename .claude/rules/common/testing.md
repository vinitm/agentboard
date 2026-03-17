# Testing Requirements

## Minimum Test Coverage: 80%

Test Types (ALL required):
1. **Unit Tests** — Individual functions, utilities, components
2. **Integration Tests** — API endpoints, database operations
3. **E2E Tests** — Critical user flows (Playwright in `e2e/`)

## Test-Driven Development

MANDATORY workflow:
1. Write test first (RED)
2. Run test — it should FAIL
3. Write minimal implementation (GREEN)
4. Run test — it should PASS
5. Refactor (IMPROVE)
6. Verify coverage (80%+)

## Agentboard Test Helpers

Always use the project's test infrastructure:
- `createTestDb()` from `src/test/helpers.ts` — in-memory SQLite per test
- `createTestRepo()` — real git repo with auto-cleanup
- `createTestApp()` — Express app with supertest for API route tests

## Test Co-location

Tests live next to the code they test:
- `foo.ts` → `foo.test.ts`
- `Bar.tsx` → `Bar.test.tsx`

## Environment

- Backend: Node test environment
- UI: jsdom environment
- E2E: Playwright in `e2e/`

## Troubleshooting Test Failures

1. Use **tdd-guide** agent
2. Check test isolation — each test gets its own DB via `createTestDb()`
3. Verify mocks are correct
4. Fix implementation, not tests (unless tests are wrong)

## Agent Support

- **tdd-guide** — Use PROACTIVELY for new features, enforces write-tests-first
- **e2e-runner** — Playwright E2E testing specialist for critical user flows
