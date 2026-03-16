# ADR-005: Stage-and-Risk-Driven Model Selection

## Status
Accepted

## Context
Different pipeline stages have different quality/cost tradeoffs. Only four stages invoke Claude Code: planner, implementer, review-spec, and review-code. The checks stage runs shell commands (test, lint, typecheck) and pr-creator runs `gh` CLI — neither uses an LLM.

## Decision
`selectModel(stage, riskLevel, config)` in `src/worker/model-selector.ts` consults `config.modelDefaults` to look up the model alias for a given stage.

- Stage-to-config mapping: `planning` → `modelDefaults.planning`, `implementing` → `modelDefaults.implementation`, `review_spec` → `modelDefaults.reviewSpec`, `review_code` → `modelDefaults.reviewCode`
- Implementation always uses Opus (hardcoded in `stages/implementer.ts`, bypassing `selectModel`) — deliberate choice for maximum code quality
- High-risk tasks escalate `review_spec` and `review_code` to Opus regardless of config
- Planning and standard-risk reviews respect the per-project config

## Consequences

### Positive
- Per-project cost control via config
- Risk-appropriate quality gates — high-risk tasks get the best model for reviews
- Simple, predictable model selection logic

### Negative
- Implementation always using Opus means no cost savings on the most expensive stage
- `selectModel` maps `checks` and `pr_creation` to the implementation config key, but neither stage calls it — this dead mapping could cause confusion

### Risks
- Model names evolve — the Opus hardcoding in `implementer.ts` needs updating when new models are released
- The risk escalation override is the only hardcoded model name in `selectModel` — changes to model naming could break it
