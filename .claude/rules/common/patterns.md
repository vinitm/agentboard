---
paths:
  - "src/**"
---

# Agentboard Patterns

- **Stage pattern** — new pipeline stages MUST follow the pattern in `src/worker/stages/`
- **Row conversion** — snake_case DB rows → camelCase TypeScript objects via conversion functions in `src/db/`
- **Prompt templates** — stage prompts live in `prompts/` as markdown files with `{variable}` interpolation
