---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript — Project-Specific Style

## Console.log Convention

This project uses `console.log` with bracketed prefixes as its logging convention:
- `[worker]`, `[http]`, `[recovery]`, `[db]`, etc.
- This IS the standard — do NOT replace with a logging library
- Do NOT add console.log without a prefix

## Immutability

ALWAYS create new objects with spread, NEVER mutate in place:
```typescript
// WRONG: Mutation
user.name = name
// CORRECT: Immutable update
return { ...user, name }
```
Use `Readonly<T>` for function parameters that must not be mutated.

## File Size

- 200-400 lines typical, 800 max per file
- Extract utilities from large modules
