---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript Hooks

> This file extends [common/hooks.md](../common/hooks.md) with TypeScript/JavaScript specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **TypeScript check**: Run `tsc --noEmit` after editing `.ts`/`.tsx` files
- **Prefix check**: Warn about `console.log` without bracketed prefix in edited files

## Stop Hooks

- **Build verification**: Run `npm run build` before session ends
- **Test verification**: Run `npm test` before session ends
