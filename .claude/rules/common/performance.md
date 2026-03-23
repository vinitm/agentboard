---
paths:
  - "src/worker/**"
---

# Model Selection

Agentboard uses `src/worker/model-selector.ts` to map pipeline stages to models via `config.modelDefaults`. ALWAYS use this system — NEVER hardcode model names.

General guidance for interactive sessions:

- **Haiku 4.5** — lightweight agents, frequent invocation, 3x cost savings
- **Sonnet 4.6** — main development work, orchestrating multi-agent workflows
- **Opus 4.6** — complex architectural decisions, maximum reasoning
