# Common Patterns

## Design Patterns

### Repository Pattern

Encapsulate data access behind a consistent interface:
- Define standard operations: findAll, findById, create, update, delete
- Concrete implementations handle storage details (database, API, file, etc.)
- Business logic depends on the abstract interface, not the storage mechanism
- Enables easy swapping of data sources and simplifies testing with mocks

### API Response Format

Use a consistent envelope for all API responses:
- Include a success/status indicator
- Include the data payload (nullable on error)
- Include an error message field (nullable on success)
- Include metadata for paginated responses (total, page, limit)

## Agentboard Patterns

- **Stage pattern** — new pipeline stages follow the pattern in `src/worker/stages/`. Each stage is a function that takes a task and returns a result.
- **Prepared statements** — all DB queries go through `src/db/queries.ts` with parameterized queries
- **Row conversion** — snake_case DB rows → camelCase TypeScript objects via conversion functions
- **Prompt templates** — stage prompts live in `prompts/` as markdown files with variable interpolation
