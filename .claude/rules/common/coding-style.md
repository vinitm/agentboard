# Coding Style

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate existing ones:

```
// Pseudocode
WRONG:  modify(original, field, value) → changes original in-place
CORRECT: update(original, field, value) → returns new copy with change
```

Rationale: Immutable data prevents hidden side effects, makes debugging easier, and enables safe concurrency.

## File Organization

MANY SMALL FILES > FEW LARGE FILES:
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities from large modules
- Organize by feature/domain, not by type

## Error Handling

ALWAYS handle errors comprehensively:
- Handle errors explicitly at every level
- Provide user-friendly error messages in UI-facing code
- Log detailed error context on the server side
- Never silently swallow errors

## Input Validation

ALWAYS validate at system boundaries:
- Validate all user input before processing
- Fail fast with clear error messages
- Never trust external data (API responses, user input, file content)

## Agentboard Conventions

- **ES module imports** with `.js` extensions (even for .ts files) — see [docs/gotchas/imports.md](docs/gotchas/imports.md)
- **Console.log with bracketed prefixes**: `[worker]`, `[http]`, `[recovery]` — this IS the logging convention for this project
- **snake_case DB columns → camelCase TypeScript** via row-conversion functions
- **Prompt templates** in `prompts/` as markdown files
- **Follow existing stage patterns** in `src/worker/stages/`
- **Model names** via `config.modelDefaults` and `model-selector.ts`, never hardcoded

## Code Quality Checklist

Before marking work complete:
- [ ] Code is readable and well-named
- [ ] Functions are small (<50 lines)
- [ ] Files are focused (<800 lines)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No hardcoded values (use constants or config)
- [ ] No mutation (immutable patterns used)
