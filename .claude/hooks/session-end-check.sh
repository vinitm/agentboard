#!/bin/sh
# Claude Code Stop hook: final build+test verification when session ends.
# Always exits 0 (non-blocking) — outputs results to stderr for visibility.

echo "[session-end-check] Running final verification..." >&2

cd /home/user/Personal/agentboard

echo "[session-end-check] npm test..." >&2
if npm test 2>&1 | tail -5 >&2; then
  echo "[session-end-check] Tests: PASS" >&2
else
  echo "[session-end-check] Tests: FAIL — check before pushing." >&2
fi

echo "[session-end-check] npm run build..." >&2
if npm run build 2>&1 | tail -5 >&2; then
  echo "[session-end-check] Build: PASS" >&2
else
  echo "[session-end-check] Build: FAIL — check before pushing." >&2
fi

exit 0
