# Hooks System

## Implemented Hooks

Three Claude Code hooks live in `.claude/hooks/`:

### PreToolUse: `pre-commit-check.sh`
- **Fires:** Before any Bash tool call containing `git commit`
- **Action:** Runs `npm test` and `npm run build`
- **Blocking:** Yes — exits 1 if tests or build fail, preventing the commit
- **Disable:** Remove the hook entry from `.claude/settings.json`

### PostToolUse: `post-edit-check.sh`
- **Fires:** After Write/Edit tool calls on `src/**/*.ts` files (excludes `.test.ts`)
- **Action:** Runs `tsc --noEmit` for type checking, greps for `console.log` without `[prefix]` pattern
- **Blocking:** No — outputs warnings to stderr only
- **Disable:** Remove the hook entry from `.claude/settings.json`

### Stop: `session-end-check.sh`
- **Fires:** When a Claude Code session ends
- **Action:** Runs `npm test` and `npm run build` as final verification
- **Blocking:** No — outputs results to stderr for visibility
- **Disable:** Remove the hook entry from `.claude/settings.json`

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **Stop**: When session ends (final verification)

## Auto-Accept Permissions

Use with caution:
- Enable for trusted, well-defined plans
- Disable for exploratory work
- Never use dangerously-skip-permissions flag
- Configure `allowedTools` in `~/.claude.json` instead

## TodoWrite Best Practices

Use TodoWrite tool to:
- Track progress on multi-step tasks
- Verify understanding of instructions
- Enable real-time steering
- Show granular implementation steps

Todo list reveals:
- Out of order steps
- Missing items
- Extra unnecessary items
- Wrong granularity
- Misinterpreted requirements
