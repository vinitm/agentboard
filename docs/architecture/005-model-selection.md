# ADR-005: Stage-and-Risk-Driven Model Selection

## Status
Accepted

## Context
Different pipeline stages have different quality/cost tradeoffs. Only four stages invoke Claude Code: spec-generator, planner, implementer, and review-panel. The checks stage runs shell commands and pr-creator runs `gh` CLI — neither uses an LLM.

## Decision
`selectModel(stage, riskLevel, config)` in `src/worker/model-selector.ts` consults `config.modelDefaults` to look up the model alias for a given stage.

- High-risk tasks escalate `review_panel` to Opus regardless of config
- Implementation typically uses Opus for maximum code quality
- Planning and standard-risk reviews respect the per-project config

For the full stage-to-model mapping table, see [Agent Orchestration → Model Selection](agent-orchestration.md#model-selection).

## Consequences

### Positive
- Per-project cost control via config
- Risk-appropriate quality gates — high-risk tasks get the best model for reviews
- Simple, predictable model selection logic

### Negative
- Implementation always using Opus means no cost savings on the most expensive stage

### Risks
- Model names evolve — hardcoded model overrides need updating when new models are released
