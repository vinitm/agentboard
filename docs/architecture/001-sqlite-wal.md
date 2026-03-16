# ADR-001: SQLite with WAL Mode

## Status
Accepted

## Context
Agentboard is a self-hosted tool that runs on a single machine alongside a repo. It needs persistence for tasks, runs, artifacts, and events. The Express server reads the DB while the worker writes concurrently.

Options considered: PostgreSQL, MySQL, SQLite, or an embedded key-value store.

## Decision
Use SQLite with WAL (Write-Ahead Logging) mode via `better-sqlite3`.

- Single connection singleton pattern (`getDatabase()` in `src/db/index.ts`)
- Synchronous prepared statements for all queries
- WAL mode enabled via `db.pragma('journal_mode = WAL')` to allow concurrent readers without blocking the writer
- Snake_case DB columns mapped to camelCase TypeScript via row-conversion functions (`rowToTask`, `rowToProject`, etc.) in `queries.ts`
- 6 tables: `projects`, `tasks`, `runs`, `artifacts`, `git_refs`, `events`

## Consequences

### Positive
- Zero-config deployment — no external database to install or manage
- Fast reads, simple single-file backup
- WAL allows the HTTP server to read while the worker writes without blocking

### Negative
- Single-writer limits throughput (acceptable for single-machine use case)
- No built-in replication or multi-server support

### Risks
- If multi-server deployment is ever needed, SQLite becomes a bottleneck
- WAL files can grow large under sustained write load
- The singleton pattern means the entire process shares one connection — connection lifecycle bugs affect everything
