# Browser Testing

Browser tests for Agentboard's React UI using Playwright with Lightpanda as the headless browser backend.

## Why Lightpanda

[Lightpanda](https://github.com/lightpanda-io/browser) is a Zig-based headless browser purpose-built for automation:
- **11x faster** than Chrome headless
- **9x less memory** usage
- **CDP-compatible** — drop-in backend for Playwright via `connectOverCDP()`
- No rendering bloat — built for testing and scraping, not display

## Prerequisites

The `@lightpanda/browser` npm package auto-downloads the binary for your platform. No manual install needed.

**Docker fallback** for unsupported platforms:
```bash
LIGHTPANDA_DOCKER=1 npm run test:browser
```

## Running Tests

```bash
# Run all browser tests (starts dev server + Lightpanda automatically)
npm run test:browser

# Start Lightpanda manually (for debugging)
npm run lightpanda:start
```

## Writing New Tests

### File conventions

- Tests live in `browser-tests/*.spec.ts`
- Use the custom fixture from `browser-tests/fixtures.ts` (connects via CDP)
- Import `test` and `expect` from `./fixtures.js`, not from `@playwright/test`

### Example test

```typescript
import { test, expect } from './fixtures.js';

test('page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Agentboard/);
});
```

### Custom fixture

The `test` fixture in `browser-tests/fixtures.ts` connects Playwright to Lightpanda via CDP instead of launching a browser:

```typescript
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = await browser.newContext();
```

This means every test gets a fresh browser context connected to the running Lightpanda instance.

## Architecture

### Lifecycle

1. **Global setup** (`browser-tests/global-setup.ts`) — starts Lightpanda before any tests
2. **Playwright config** (`playwright.config.ts`) — starts `npm run dev` as the web server
3. **Tests run** — each test gets a `page` connected to Lightpanda via CDP
4. **Global teardown** (`browser-tests/global-teardown.ts`) — stops Lightpanda after all tests

### Two modes

| Mode | Trigger | How |
|------|---------|-----|
| **npm binary** (default) | Normal run | `npx @lightpanda/browser --headless --port 9222` |
| **Docker** (fallback) | `LIGHTPANDA_DOCKER=1` | `docker run lightpanda/browser:nightly` |

### CDP connection

Lightpanda exposes a Chrome DevTools Protocol endpoint on port 9222. Playwright connects via `chromium.connectOverCDP()`. The global setup waits for `http://localhost:9222/json/version` to respond before tests start.

## Troubleshooting

### Lightpanda won't start

- Check if port 9222 is already in use: `lsof -i :9222`
- Try Docker fallback: `LIGHTPANDA_DOCKER=1 npm run test:browser`
- Enable debug output: `LIGHTPANDA_DEBUG=1 npm run test:browser`

### Port conflicts

Change the port in `browser-tests/helpers.ts` (`DEFAULT_PORT`) and set `CDP_ENDPOINT` env var for the fixture.

### Docker fallback

If the npm binary doesn't work on your platform:
```bash
# Pull the image
docker pull lightpanda/browser:nightly

# Run tests with Docker
LIGHTPANDA_DOCKER=1 npm run test:browser
```

## MCP Browser Tools (agent-browser)

The claude-flow MCP server exposes `browser_open`, `browser_snapshot`, `browser_click`, etc. These tools call the `agent-browser` CLI (installed as a dev dependency) which connects to Lightpanda via CDP.

### Setup

1. `agent-browser` is installed as a dev dependency (`npm install`)
2. `.mcp.json` sets `AGENT_BROWSER_CDP=9222` and adds `node_modules/.bin` to `PATH`
3. Start Lightpanda before using MCP browser tools:

```bash
npm run lightpanda:start
```

### Manual testing

```bash
# Open a page
npx agent-browser --cdp 9222 --json open http://localhost:3000

# Get accessibility snapshot
npx agent-browser --cdp 9222 --json snapshot

# Click an element ref
npx agent-browser --cdp 9222 --json click @e2
```

### Via MCP tools

Once Lightpanda is running and the claude-flow MCP server is connected, use the browser tools directly:

- `browser_open` — navigate to a URL
- `browser_snapshot` — get AI-optimized accessibility tree
- `browser_click` — click an element by ref or selector
- `browser_fill` — fill an input field

See [.claude/skills/browser/SKILL.md](../.claude/skills/browser/SKILL.md) for the full command reference.

## Limitations

- Lightpanda is in beta — some Web APIs may not be fully supported
- No visual rendering (headless only) — screenshots may differ from Chrome
- CDP support covers most Playwright operations but edge cases may vary
- Dev-only tool — not integrated into the agentboard pipeline or CI checks
