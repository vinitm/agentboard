# ADR-005: Model Selection

## Status
Accepted — **updated 2026-03-17**: simplified to single-model (opus everywhere)

## Context
Different pipeline stages have different quality/cost tradeoffs. The original design used stage-based model routing (sonnet for reviews/planning, opus for implementation, haiku for learning).

During the superpowers workflow rewrite (2026-03-17), model selection was simplified to opus everywhere for consistent quality. The cost savings from using sonnet for reviews were not worth the quality inconsistency.

## Decision
`selectModel(stage, riskLevel, config)` in `src/worker/model-selector.ts` returns the model from `config.modelDefaults` for the given stage.

**Current defaults:**
- All stages: **opus**
- Exception: learner stage uses **haiku** (configurable via `config.modelDefaults.learning`)

Per-project config can override any stage's model via `config.modelDefaults`.

## History

### Original (2026-03-16)
- sonnet for reviews and planning (cost-effective for analysis tasks)
- opus for implementation (maximum code quality)
- High-risk tasks escalated review to opus regardless of config

### Current (2026-03-17, superpowers rewrite)
- opus everywhere for consistent quality
- haiku for post-task learning (lightweight pattern extraction)
- Rationale: simpler configuration, no quality variance between stages

See [Decision Log entry 2026-03-17](../decisions.md) for full context.

## Consequences

### Positive
- Consistent output quality across all stages
- Simpler mental model (one model, one quality level)
- Per-project config still allows overrides for cost control

### Negative
- Higher cost per task (opus for reviews that sonnet could handle)
- No automatic cost optimization for low-risk tasks

### Risks
- Model names evolve — config values need updating when new models are released
