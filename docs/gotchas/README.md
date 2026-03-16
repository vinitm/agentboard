# Gotchas

Known pitfalls organized by subsystem. Each gotcha is failure-backed — it documents a real issue that caused an agent or developer to fail.

Every entry must pass the pruning test:
1. **Failure-backed?** — Can you point to a specific failure this prevents?
2. **Tool-enforceable?** — If yes, use a linter instead of documenting it.
3. **Decision-encoding?** — Does it capture a "why" not inferable from code?
4. **Triggerable?** — Is it context-specific (load on demand)?

If an entry fails all four, delete it.

## Files

- [imports.md](imports.md) — Module resolution gotchas
- [worker.md](worker.md) — Worker loop and task processing
- [subtasks.md](subtasks.md) — Subtask pipeline edge cases
- [database.md](database.md) — SQLite singleton and query patterns
