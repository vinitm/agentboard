---
paths:
  - ".claude/hooks/**"
  - ".claude/settings.json"
---

# Hooks System

Three hooks live in `.claude/hooks/` — see `.claude/settings.json` for configuration. The hooks enforce:
- **Pre-commit:** `npm test` + `npm run build` must pass before any commit
- **Post-edit:** Type-check warnings on `src/**/*.ts` edits
- **Session-end:** Final `npm test` + `npm run build` verification

## Auto-Accept Permissions

Use with caution:
- Enable for trusted, well-defined plans
- Disable for exploratory work
- NEVER use dangerously-skip-permissions flag
