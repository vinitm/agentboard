---
paths:
  - "src/worker/**"
---

# Performance Optimization

## Model Selection Strategy

Agentboard uses `src/worker/model-selector.ts` to map pipeline stages to models via `config.modelDefaults`. Always use this system — never hardcode model names.

General guidance for interactive sessions:

**Haiku 4.5** (90% of Sonnet capability, 3x cost savings):
- Lightweight agents with frequent invocation
- Pair programming and code generation
- Worker agents in multi-agent systems

**Sonnet 4.6** (Best coding model):
- Main development work
- Orchestrating multi-agent workflows
- Complex coding tasks

**Opus 4.6** (Deepest reasoning):
- Complex architectural decisions
- Maximum reasoning requirements
- Research and analysis tasks

## Build Troubleshooting

If build fails:
1. Use **build-error-resolver** agent
2. Analyze error messages
3. Fix incrementally
4. Verify after each fix
