# Security Guidelines

## Mandatory Security Checks

Before ANY commit:
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated
- [ ] SQL injection prevention (parameterized queries / prepared statements)
- [ ] XSS prevention (sanitized HTML)
- [ ] CSRF protection enabled
- [ ] Authentication/authorization verified
- [ ] Rate limiting on all endpoints
- [ ] Error messages don't leak sensitive data

## Agentboard-Specific Security Rules

- **Prepared statements only** — all DB queries go through `src/db/queries.ts` with parameterized queries
- **`execFile` only** — never use `exec` for shell commands. `execFile` passes arguments as arrays, preventing command injection
- **Single DB connection** — use `getDatabase()` singleton, never create new connections
- **No `any`** — strict TypeScript throughout. Use `unknown` and narrow safely

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
