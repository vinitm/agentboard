# Browser Testing

Two Playwright projects for testing Agentboard's React UI:

| Project | Browser | Purpose | Speed |
|---------|---------|---------|-------|
| **lightpanda** | Lightpanda (CDP) | Functional tests — DOM presence, navigation, interaction | ~3s for 10 tests |
| **visual** | Chromium | Visual regression — screenshot comparison across viewports | ~5s for 10 tests |

## Running Tests

```bash
# Functional tests (Lightpanda — fast, no rendering)
npm run test:browser

# Visual regression tests (Chromium — screenshots)
npm run test:visual

# Update visual baselines after intentional UI changes
npm run test:visual:update

# Start Lightpanda manually (for debugging)
npm run lightpanda:start
```

## Why Two Browsers

**Lightpanda** is a Zig-based headless browser purpose-built for automation:
- 11x faster than Chrome headless, 9x less memory
- CDP-compatible — connects via `connectOverCDP()`
- No rendering engine — cannot take screenshots or evaluate visibility

**Chromium** (via Playwright) provides:
- Full rendering engine for pixel-accurate screenshots
- `toHaveScreenshot()` for visual regression with diff detection
- Responsive viewport testing (mobile, tablet, desktop)

## Writing Functional Tests (Lightpanda)

### File conventions

- Tests live in `browser-tests/*.spec.ts` (not `*.visual.spec.ts`)
- Import `test` and `expect` from `./fixtures.js`, not from `@playwright/test`
- The custom fixture connects to Lightpanda via CDP

### Lightpanda limitations

Lightpanda doesn't support all Playwright APIs. Follow these rules:

| Instead of | Use | Why |
|-----------|-----|-----|
| `toBeVisible()` | `toBeAttached()` | No layout engine — visibility can't be computed |
| `getByRole('button')` | `page.locator('button', { hasText: /text/i })` | Incomplete ARIA role computation |
| `response.status()` | `toHaveTitle()` or `toBeAttached()` | CDP default context may return null response |
| `toHaveScreenshot()` | Move to a `*.visual.spec.ts` file | No rendering engine |

### Example

```typescript
import { test, expect } from './fixtures.js';

test('board columns render', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const column = page.getByText('Backlog', { exact: true }).first();
  await expect(column).toBeAttached();
});
```

### Custom fixture

The fixture in `browser-tests/fixtures.ts` handles two Lightpanda quirks:

1. **Reuses the default CDP context** instead of creating a new one (avoids unsupported `Emulation.setLocaleOverride` calls)
2. **Resolves relative URLs** against `baseURL` manually (the default CDP context doesn't inherit Playwright config)

## Writing Visual Tests (Chromium)

### File conventions

- Tests live in `browser-tests/*.visual.spec.ts`
- Import `test` and `expect` from `@playwright/test` (standard Playwright, not the CDP fixture)
- Baseline screenshots are stored in `browser-tests/*.visual.spec.ts-snapshots/`

### Example

```typescript
import { test, expect } from '@playwright/test';

test('board page renders correctly', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot('board-full.png', {
    fullPage: true,
  });
});
```

### Visual test configuration

In `playwright.config.ts`:
- **Max diff pixel ratio:** 1% — small rendering variations are tolerated
- **Animations:** disabled — prevents flaky diffs from CSS transitions
- **Device:** Desktop Chrome (1280x720 default viewport)

### Updating baselines

When you intentionally change the UI:

```bash
npm run test:visual:update
```

Review the updated PNGs in the `*-snapshots/` directories before committing.

### Current visual tests

| File | What it covers |
|------|----------------|
| `board.visual.spec.ts` | Full board page, kanban columns, sidebar |
| `task-form.visual.spec.ts` | New task dialog, form fields |
| `task-page.visual.spec.ts` | Task detail view, settings page |
| `responsive.visual.spec.ts` | Mobile (375px), tablet (768px), wide (1920px) |

## Task Lifecycle Tests

End-to-end tests exercising the full task lifecycle from creation to deletion. Both functional and visual variants exist:

| File | Runner | Tests | Purpose |
|------|--------|-------|---------|
| `task-lifecycle.spec.ts` | Lightpanda | ~48 | Fast functional DOM assertions |
| `task-lifecycle.visual.spec.ts` | Chromium | ~57 | Visual regression + screenshots |

### Test groups

1. **Layout & Navigation** — Sidebar, TopBar, nav links, collapse/expand
2. **Task Creation Dialog** — Chat phase, confirming phase, validation, phase transitions
3. **Task Card Rendering** — Title, description, status badge, risk level, ARIA, priority
4. **Task Detail Page** — Header, tabs, spec fields, action buttons, ConfirmDialog, sidebar
5. **Task Operations** — Backlog/ready status, cancel, risk levels, priority sorting, delete
6. **Filtering & Search** — Filter bar, status/risk filters, URL sync, search input
7. **Real-time WebSocket** — Live task creation, cancel, status updates `[visual-only]`
8. **Responsive** — Desktop/tablet/mobile viewports `[visual-only]`
9. **Error States** — Non-existent task, invalid ID, console errors
10. **Keyboard Navigation** — Enter/Space card activation, Escape dialog close `[visual-only]`
11. **Edit Flow** — Edit button, title update

### Running lifecycle tests

```bash
# Functional only (fast)
npx playwright test browser-tests/task-lifecycle.spec.ts --project lightpanda

# Visual only (screenshots)
npx playwright test browser-tests/task-lifecycle.visual.spec.ts --project visual

# Update visual baselines after UI changes
npx playwright test browser-tests/task-lifecycle.visual.spec.ts --project visual --update-snapshots
```

### Visual-only convention

Tests marked `[visual-only]` run only in the Chromium visual project. They rely on rendering, viewport, or WebSocket features that Lightpanda cannot support. In the functional file, these describe blocks are omitted entirely.

### Test data conventions

- All tests create their own tasks via API helpers at the top of each file
- Tasks are tracked in `createdIds` arrays and deleted in `afterAll`
- Task title: "Add player skill description field for team-making context"
- Tasks with spec → `ready` status; without spec → `backlog` status
- No AI/Claude dependency — specs are pre-filled JSON

## Prerequisites

**Lightpanda:** The `@lightpanda/browser` npm package auto-downloads the binary. Docker fallback for unsupported platforms:
```bash
LIGHTPANDA_DOCKER=1 npm run test:browser
```

**Chromium:** Installed via Playwright:
```bash
npx playwright install chromium
npx playwright install-deps chromium  # system libraries
```

## Architecture

### Playwright projects

The `playwright.config.ts` defines two projects:

- **lightpanda** — matches `*.spec.ts` (excludes `*.visual.spec.ts`), uses CDP fixture, has global setup/teardown for Lightpanda process
- **visual** — matches `*.visual.spec.ts`, uses standard Playwright with Chromium

Both share the same web server config (`npm run dev` on port 4200).

### Lightpanda lifecycle

1. **Global setup** (`browser-tests/global-setup.ts`) — starts Lightpanda before tests
2. **Tests run** — each test gets a `page` from the default CDP context
3. **Global teardown** (`browser-tests/global-teardown.ts`) — stops Lightpanda

### Lightpanda modes

| Mode | Trigger | How |
|------|---------|-----|
| **npm binary** (default) | Normal run | Binary from `~/.cache/lightpanda-node/` |
| **Docker** (fallback) | `LIGHTPANDA_DOCKER=1` | `docker run lightpanda/browser:nightly` |

## Troubleshooting

### Lightpanda won't start

- Check if port 9222 is already in use: `lsof -i :9222`
- Try Docker fallback: `LIGHTPANDA_DOCKER=1 npm run test:browser`
- Enable debug output: `LIGHTPANDA_DEBUG=1 npm run test:browser`

### Visual tests fail after UI change

Run `npm run test:visual:update` to regenerate baselines, then review the new screenshots.

### Chromium missing system libraries

```bash
npx playwright install-deps chromium
```

### Port conflicts

Change the port in `browser-tests/helpers.ts` (`DEFAULT_PORT`) and set `CDP_ENDPOINT` env var for the fixture.

## MCP Browser Tools (agent-browser)

The claude-flow MCP server exposes `browser_open`, `browser_snapshot`, `browser_click`, etc. These tools call the `agent-browser` CLI which connects to Lightpanda via CDP.

### Setup

1. `agent-browser` is installed as a dev dependency (`npm install`)
2. `.mcp.json` sets `AGENT_BROWSER_CDP=9222` and adds `node_modules/.bin` to `PATH`
3. Start Lightpanda before using MCP browser tools: `npm run lightpanda:start`

### Manual testing

```bash
npx agent-browser --cdp 9222 --json open http://localhost:3000
npx agent-browser --cdp 9222 --json snapshot
npx agent-browser --cdp 9222 --json click @e2
```

See [.claude/skills/browser/SKILL.md](../.claude/skills/browser/SKILL.md) for the full command reference.
