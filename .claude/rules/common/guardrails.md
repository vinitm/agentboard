---
paths:
  - "src/**"
  - "ui/**"
---

# Guardrails — Non-Negotiable Rules

## NEVER Do

- NEVER add dependencies without explicit user approval. Why: unvetted deps introduce supply-chain risk and bloat.
- NEVER modify the worker loop's 5-second polling interval or stage ordering. Why: the polling cadence and stage order are load-tested assumptions.
- NEVER commit directly to master. Why: enforced by pre-bash hook. You will get a blocking error.
- NEVER hardcode model names. Why: use `config.modelDefaults` and `model-selector.ts` — models change.
- NEVER create new DB connections. Why: use `getDatabase()` singleton — multiple connections corrupt WAL mode.
- NEVER skip workflow steps without explicit user approval.
- NEVER commit without `npm test` AND `npm run build` passing. Why: pre-commit hook enforces this — if you skip it, the hook will block you.

## Backpressure — STOP and Ask the User When:

- Change touches >5 files you did not expect
- You need to add a new dependency
- You are modifying worker loop polling or stage ordering
- Tests fail after 3 attempts to fix
- You are changing the pipeline state machine (backlog → ready → spec → ... → done)

## Backpressure Commands

Run after EVERY implementation step:
- `npm test` — ALL tests MUST pass
- `npm run build` — MUST compile cleanly
- If build fails → use **build-error-resolver** agent before attempting manual fixes
