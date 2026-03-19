#!/bin/sh
# Claude Code PostToolUse hook: runs tsc and checks console.log prefixes after .ts edits.
# Fires after Write/Edit tool use. Reads tool result JSON from stdin.
# Always exits 0 (non-blocking) — outputs warnings to stderr.

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# Only check Write/Edit on .ts files in src/
case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

case "$FILE_PATH" in
  */src/*.ts) ;;
  *) exit 0 ;;
esac

# Skip test files
case "$FILE_PATH" in
  *.test.ts) exit 0 ;;
esac

# Run incremental type check (non-blocking)
echo "[post-edit-check] Running tsc --noEmit..." >&2
if ! npx tsc --noEmit --pretty false --project /home/user/Personal/agentboard/tsconfig.json 2>&1 | head -20 >&2; then
  echo "[post-edit-check] WARNING: TypeScript errors detected (see above)." >&2
fi

# Check for console.log without [prefix] pattern
if grep -n 'console\.log(' "$FILE_PATH" 2>/dev/null | grep -v '\[' | grep -v '^\s*//' > /dev/null 2>&1; then
  echo "[post-edit-check] WARNING: console.log without [prefix] pattern found in $FILE_PATH:" >&2
  grep -n 'console\.log(' "$FILE_PATH" | grep -v '\[' | grep -v '^\s*//' >&2
fi

exit 0
