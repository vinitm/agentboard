---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript Security

> This file extends [common/security.md](../common/security.md) with TypeScript/JavaScript specific content.

## Secret Management

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables
const apiKey = process.env.API_KEY

if (!apiKey) {
  throw new Error('API_KEY not configured')
}
```

## Shell Command Safety

```typescript
// NEVER: exec (vulnerable to command injection)
import { exec } from 'child_process'
exec(`git commit -m "${message}"`)

// ALWAYS: execFile (arguments as array)
import { execFile } from 'child_process'
execFile('git', ['commit', '-m', message])
```

## Agent Support

- Use **security-reviewer** agent for comprehensive security audits
