# Playwright Test Agents Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Playwright MCP server so Claude Code can use the planner/generator/healer test agents, and document the workflow.

**Architecture:** Add `@playwright/mcp` as an MCP server in `.mcp.json`. Update `docs/browser-testing.md` with a new section explaining the three agents and how they fit the existing two-browser setup.

**Tech Stack:** Playwright MCP, Claude Code agents

---

### Task 1: Add Playwright MCP Server

**Files:**
- Modify: `.mcp.json`

- [ ] **Step 1: Add the playwright-test MCP server entry**

Add a `playwright-test` server alongside the existing `claude-flow` server:

```json
"playwright-test": {
  "command": "npx",
  "args": ["@playwright/mcp@latest"]
}
```

The full `.mcp.json` becomes:

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": [
        "-y",
        "@claude-flow/cli@latest",
        "mcp",
        "start"
      ],
      "env": {
        "npm_config_update_notifier": "false",
        "CLAUDE_FLOW_MODE": "v3",
        "CLAUDE_FLOW_HOOKS_ENABLED": "true",
        "CLAUDE_FLOW_TOPOLOGY": "hierarchical-mesh",
        "CLAUDE_FLOW_MAX_AGENTS": "15",
        "CLAUDE_FLOW_MEMORY_BACKEND": "hybrid",
        "AGENT_BROWSER_CDP": "9222",
        "PATH": "./node_modules/.bin:/home/user/Personal/agentboard/node_modules/.bin:${PATH}"
      },
      "autoStart": true
    },
    "playwright-test": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

- [ ] **Step 2: Verify the MCP server starts**

Run: `npm info @playwright/mcp version`
Expected: A version number (confirms the package resolves). The MCP server uses stdio transport, so `--help` may not produce output.

- [ ] **Step 3: Commit**

```bash
git add .mcp.json
git commit -m "feat: add Playwright MCP server for test agent support"
```

---

### Task 2: Document Playwright Test Agents

**Files:**
- Modify: `docs/browser-testing.md` (append new section before the existing "Troubleshooting" section, at line ~212)

- [ ] **Step 1: Add the Playwright Test Agents section**

Insert the following section in `docs/browser-testing.md` before the "## Troubleshooting" heading (line 212):

```markdown
## Playwright Test Agents

Three Claude Code subagents for AI-assisted test creation and maintenance. They ship with the `playwright` package and are enabled by the `playwright-test` MCP server in `.mcp.json`. The MCP server defaults to accessibility snapshots (not screenshots) for browser interaction.

| Agent | Purpose | When to use |
|-------|---------|-------------|
| **Planner** | Explores the running app, produces a Markdown test plan | Starting a new test suite for a feature |
| **Generator** | Turns a Markdown plan into Playwright test files | After planner produces a plan, or from a hand-written plan |
| **Healer** | Debugs and fixes failing tests by replaying and patching | Tests break after UI changes |

### How they work

1. **Planner** — Call with a URL and feature description. It navigates the app via accessibility snapshots, maps user flows, and saves a structured Markdown test plan with scenarios, steps, and expected outcomes.

2. **Generator** — Feed it the planner's Markdown output. It opens the app, executes each step live to discover selectors, reads its own interaction log, and writes a `.spec.ts` file with one test per scenario.

3. **Healer** — Point it at failing tests. It runs them via `test_run`, then uses `test_debug` to replay failing tests with pause-on-error. It inspects page state via snapshots, edits the test code, and re-runs until green. If a test is genuinely broken (app bug, not test bug), it marks it `test.fixme()` with an explanatory comment.

### Integration with two-browser setup

The Playwright MCP server launches its own Chromium instance (separate from Lightpanda). The generator creates `*.spec.ts` files by default, which match the **lightpanda** project glob. These tests use standard `@playwright/test` imports and will work in both projects, but for best results choose one:

**For visual regression tests** (recommended for generated tests):
1. Rename to `*.visual.spec.ts` so it runs in the Chromium **visual** project
2. Add `toHaveScreenshot()` assertions where appropriate

**For functional tests** (Lightpanda):
1. Keep the `*.spec.ts` name (already matches lightpanda project)
2. Change the import to `./fixtures.js`
3. Replace `toBeVisible()` with `toBeAttached()` and `getByRole()` with explicit locators per the Lightpanda limitations table above

### Example workflow

```bash
# 1. Start dev server
npm run dev

# 2. In Claude Code, ask to plan tests for a feature
#    Claude uses the planner agent: navigates localhost:4200, saves plan

# 3. Ask Claude to generate tests from the plan
#    Claude uses the generator agent: writes .spec.ts files

# 4. Run the tests
npm run test:visual

# 5. If tests fail after a UI change, ask Claude to heal them
#    Claude uses the healer agent: diagnoses, patches, re-runs
```

### Agent file locations

The agent definitions live in `node_modules/playwright/lib/agents/`:
- `playwright-test-planner.agent.md`
- `playwright-test-generator.agent.md`
- `playwright-test-healer.agent.md`

These are standard Claude Code agent specs (YAML frontmatter + markdown instructions). They are read-only — customizations should go in `.claude/agents/` instead.
```

- [ ] **Step 2: Verify the documentation renders correctly**

Run: `head -n 5 docs/browser-testing.md && echo "---" && grep -c "##" docs/browser-testing.md`
Expected: File header is intact, section count increased by 1.

- [ ] **Step 3: Commit**

```bash
git add docs/browser-testing.md
git commit -m "docs: add Playwright test agents section to browser-testing guide"
```
