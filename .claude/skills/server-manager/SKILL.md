---
name: server-manager
description: Ensures a dev server is running before any task that needs one — browser tests, screenshots, API checks, UI interactions, E2E flow checks, UX audits, or anything requiring a live server. Use this skill whenever you're about to take a screenshot, run browser/E2E tests, hit an API endpoint, open a URL, audit a UI/UX flow, check an end-to-end flow in the browser, verify visual changes, or do any work that depends on a running server. Also use when the user says "start the server", "restart the server", "open the app", "test the UI", "check the flow", "audit the UX", or mentions anything that implies a server needs to be up. Even if the user doesn't mention a server explicitly — if their task requires one, use this skill.
---

# Server Manager

You're about to do something that needs a running server. Before jumping into the actual task, follow this workflow to make sure the server is up and healthy.

## Why this matters

A surprising amount of time gets wasted when Claude tries to take screenshots of dead servers, run tests against nothing, or debug "connection refused" errors that are just "the server isn't running." This skill front-loads that check so you can focus on the real work.

## Critical rule: use a subagent for the server

The server process MUST run in a separate shell — either a subagent (Agent tool) or a background bash command (`run_in_background: true`). If you start the server in your main shell, it blocks everything and you can't do the actual task. This is non-negotiable.

The recommended pattern is to spawn a subagent whose only job is to start and babysit the server:

```
Agent: "Start and verify <project> server"
Prompt: "Build the project, kill anything on port <PORT>, start the server,
         verify it responds with 200, then report back the URL."
```

Alternatively, use a background bash command:

```bash
# run_in_background: true
<BUILD_COMMAND> && lsof -ti :<PORT> | xargs kill -9 2>/dev/null; sleep 1; <START_COMMAND> &>/tmp/<project>-server.log &
```

Either way, the main conversation must remain free to continue with the real task once the server is confirmed up.

## The workflow

```
Check port → (If healthy, use fast path) → Build → Kill if occupied → Start in subagent/background → Verify → Proceed
```

### Step 1: Figure out what server you need

Look at the project context to determine:
- **What command starts the server** — check `package.json` scripts, `Makefile`, `docker-compose.yml`, `CLAUDE.md`, or `AGENTS.md` for the start/dev/up command
- **What port it runs on** — check config files, `.env`, or the start command for port numbers. Common defaults: 3000, 4200, 5173, 8000, 8080
- **Whether it needs a build step first** — see Step 3 for when to skip the build
- **Prefer compiled server over dev mode** — if the project has both a dev command (`tsx watch`, `ts-node`) and a compiled version (`node dist/...`), prefer the compiled version for serving. Dev-mode runners like `tsx` can have path resolution issues with static assets (e.g., UI files in `ui/dist/` may not be found when running from the `src/` directory). Build first, then run the compiled output.

If you can't determine these from the project, ask the user.

### Step 2: Check port — fast path

Before building or starting anything, check if the server is already up:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:<PORT>
```

**If you get 200 (or 301/302)** — the server is already running. Consider whether you can skip the rebuild:
- If the user hasn't mentioned code changes, and you haven't modified server-side files in this session → **use the running server as-is**. Skip to Step 7.
- If the user says "I just changed X" or you've edited source files → the running server may be stale. Proceed to Step 3 to rebuild and restart.
- If the user explicitly asks to restart → proceed to Step 3.

This fast path saves significant time (~2x) when the server is already healthy. Don't rebuild for no reason.

**If you get 000 or connection refused** — server is down. Proceed to Step 3.

### Step 3: Build (when needed)

Run the project's build command before starting the server. This catches compile errors early and avoids serving stale code.

```bash
# Example for Node/TypeScript projects
npm run build
```

**When to skip the build:**
- **Hot-reload servers** (`tsx watch`, `vite dev`, `next dev`, `nodemon`) compile on the fly — no build needed before starting them. However, if the project uses a separate build-then-serve pattern (build step + `node dist/...`), always build first.
- **Docker-based projects** handle their own build internally via `docker compose up --build`.

If the build fails, stop and report the error to the user — there's no point starting a server that serves broken code.

### Step 4: Kill existing process (if needed)

If something is on the port (from Step 2 or a fresh check):

```bash
lsof -ti :<PORT> | xargs kill -9 2>/dev/null
sleep 1
```

**If nothing is on the port** — proceed directly to starting the server.

**Safety check:** If `lsof` shows something unexpected on the port (like a system service or another user's process), mention it to the user before killing it.

### Step 5: Start the server in a separate shell

This is where the subagent rule applies. Do NOT run the server in your main shell. Use one of these approaches:

**Option A (preferred): Spawn a subagent**

Use the Agent tool to spawn a general-purpose subagent that handles the start and verification. This keeps the server process fully isolated and lets you get a clean confirmation before proceeding.

**Option B: Background bash command**

If subagents aren't available, use `run_in_background: true` on the Bash tool:

```bash
# run_in_background: true
<START_COMMAND> &>/tmp/<project-name>-server.log
```

Then wait for the background task notification and check logs.

In either case, the server logs should go to `/tmp/<project-name>-server.log` so you can inspect them if something goes wrong. Allow 3-5 seconds for the server to initialize before verifying.

### Step 6: Verify it's actually working

Don't assume the server started successfully — confirm it:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:<PORT>
```

You want a 200 (or 301/302 for apps that redirect). If you get 000 or connection refused:

1. Check the logs: `tail -20 /tmp/<project-name>-server.log`
2. Common issues:
   - **Native module mismatch** (e.g., `NODE_MODULE_VERSION` error) → run `npm rebuild <module>`, then retry
   - **Missing dependencies** → run `npm install` or equivalent
   - **Path resolution errors** — if using `tsx`/`ts-node` and static files aren't found, switch to the compiled version (`npm run build` then `node dist/...`)
   - **Port conflict on a different port** (some servers use multiple ports) → check the logs for the actual error
   - **Missing environment variables** → check for `.env.example` or similar
3. Fix the issue, then retry from Step 5

If the server still won't start after fixing obvious issues, report the problem to the user rather than looping.

### Step 7: Proceed with the original task

The server is up and verified. Continue with whatever you were going to do (screenshot, test run, API call, etc.). If anything needs the server URL, use `http://localhost:<PORT>`.

## Multi-agent scenarios

When multiple subagents might need the same server (e.g., parallel test runs, concurrent screenshots), coordinate carefully:

- **Don't start multiple server instances on the same port.** Before spawning a server-start subagent, check if another agent has already started one. If the port is occupied and responding with 200, use the existing server.
- **Don't kill a server another agent is using.** If `lsof` shows a process on the port and `curl` gets 200, another agent likely started it — use it rather than killing and restarting.
- **Designate one agent as the server owner.** If you're orchestrating parallel work, have the first agent start the server, confirm it's up, then spawn the others. Don't have every agent independently try to manage the server.

## Docker-based projects

If the project has a `docker-compose.yml` or `Dockerfile`, use the Docker workflow instead:

```bash
docker compose up -d
# Wait for health check
docker compose ps
```

The port-check-and-start flow still applies for verification, but skip the build step (Docker handles it) and use `docker compose down` instead of `kill -9` for cleanup.

## Things to watch out for

- **Some projects use multiple ports** (e.g., API on 4200, WebSocket on 4201). Check the project docs if you see connection issues on secondary ports.
- **Compiled vs dev mode** — prefer compiled (`node dist/...`) over dev mode (`tsx`, `ts-node`) for serving, because dev mode can have path resolution issues with static assets. Build first, then serve the compiled output.
- **Don't over-rebuild.** If the server is already up and no code has changed, skip the rebuild. The fast path in Step 2 exists for this reason.
