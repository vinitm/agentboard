#!/bin/sh
# Claude Code PreToolUse hook: blocks git commit if tests or build fail.
# Fires before Bash tool use. Reads tool invocation JSON from stdin.
# Exit 0 = allow, Exit 1 = block.

set -e

# Read the tool invocation from stdin
INPUT=$(cat)

# Only check Bash tool calls that contain "git commit"
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

case "$COMMAND" in
  *"git commit"*)
    echo "[pre-commit-check] Running npm test..." >&2
    if ! npm test --prefix /home/user/Personal/agentboard 2>&1 >/dev/null; then
      echo "[pre-commit-check] BLOCKED: npm test failed. Fix tests before committing." >&2
      exit 1
    fi
    echo "[pre-commit-check] Running npm run build..." >&2
    if ! npm run build --prefix /home/user/Personal/agentboard 2>&1 >/dev/null; then
      echo "[pre-commit-check] BLOCKED: npm run build failed. Fix build before committing." >&2
      exit 1
    fi
    echo "[pre-commit-check] All checks passed." >&2
    ;;
esac

exit 0
