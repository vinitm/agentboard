---
paths:
  - "src/**"
  - "ui/**"
---

# Coding Style

## File Organization

MANY SMALL FILES > FEW LARGE FILES:
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Organize by feature/domain, not by type

## Input Validation

ALWAYS validate at system boundaries:
- Validate all user input before processing
- Fail fast with clear error messages
- NEVER trust external data (API responses, user input, file content)
