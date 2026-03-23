---
paths:
  - "src/server/**"
  - "src/db/**"
  - "src/worker/**"
---

# Security Guidelines

## Agentboard-Specific Security Rules

- **Prepared statements only** — all DB queries go through `src/db/queries.ts` with parameterized queries
- **`execFile` only** — never use `exec` for shell commands. `execFile` passes arguments as arrays, preventing command injection

## Secret Management

- NEVER hardcode secrets in source code
- ALWAYS use environment variables or a secret manager
- Validate that required secrets are present at startup
- Rotate any secrets that may have been exposed

## Security Response Protocol

If security issue found:
1. STOP immediately
2. Use **security-reviewer** agent
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review entire codebase for similar issues
