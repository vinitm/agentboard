# Gotchas

Known pitfalls organized by subsystem. Each gotcha is failure-backed — it documents a real issue that caused an agent or developer to fail.

## Files

| File | Subsystem | Gotchas |
|------|-----------|---------|
| [imports.md](imports.md) | Module resolution | `.js` extension required |
| [worker.md](worker.md) | Worker loop | Stale claims, executor scope, stage logs |
| [subtasks.md](subtasks.md) | Subtask pipeline | git_refs lookup, stale objects, sibling cancellation |
| [database.md](database.md) | SQLite | Global DB location, singleton connection, row conversion |

## Pruning Test

Every entry must pass at least one:

1. **Failure-backed?** — Can you point to a specific failure this prevents?
2. **Tool-enforceable?** — If yes, use a linter instead of documenting it.
3. **Decision-encoding?** — Does it capture a "why" not inferable from code?
4. **Triggerable?** — Is it context-specific (load on demand)?

If an entry fails all four, delete it.

## Adding a New Gotcha

1. Pick the right file by subsystem (or create a new one if it doesn't fit)
2. Use the format: **Symptom** → **Cause** → **Fix** (and optionally **Why not enforceable?**)
3. Link to the source code that the gotcha protects
4. Run the pruning test above before committing
