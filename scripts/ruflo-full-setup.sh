#!/bin/bash
# Full ruflo setup for any repo
# Usage: ./ruflo-full-setup.sh [--force]
#
# What it does:
#   1. Backs up .claude/settings.json
#   2. Initializes ruflo runtime (skip-claude to protect settings)
#   3. Configures memory, embeddings, skills, completions
#   4. Runs static analysis + deep pretrain
#   5. Generates agent configs, compiles guidance
#   6. Runs security scan + performance benchmark
#   7. Starts daemon
#   8. Exports portable state to .ruflo/
#
# After running this, invoke the Claude command for MCP-based setup:
#   /project:ruflo-seed
#
set -euo pipefail

FORCE_FLAG=""
if [[ "${1:-}" == "--force" ]]; then
  FORCE_FLAG="--force"
fi

echo "═══════════════════════════════════════"
echo "  Ruflo Full Setup"
echo "═══════════════════════════════════════"

# ── Phase 1: Backup & Init ──────────────────────
echo ""
echo "[1/8] Backing up settings.json..."
if [ -f .claude/settings.json ]; then
  cp .claude/settings.json .claude/settings.json.pre-ruflo
  echo "  Backup: .claude/settings.json.pre-ruflo"
else
  echo "  No settings.json found, skipping backup"
fi

echo ""
echo "[2/8] Initializing ruflo runtime..."
ruflo init --skip-claude --with-embeddings --start-daemon $FORCE_FLAG 2>&1 || true

echo ""
echo "[3/8] Configuring memory & embeddings..."
ruflo memory configure --backend hybrid 2>&1 || true
ruflo embeddings init --model all-MiniLM-L6-v2 --hyperbolic $FORCE_FLAG 2>&1 || true
ruflo embeddings warmup 2>&1 || true

echo ""
echo "[4/8] Installing skills & completions..."
ruflo init skills --all 2>&1 || true
if [ -d ~/.bash_completion.d ]; then
  ruflo completions bash > ~/.bash_completion.d/ruflo 2>/dev/null || true
fi

# ── Phase 2: Intelligence Bootstrap ─────────────
echo ""
echo "[5/8] Running analysis & pretrain..."
SRC_DIR="src"
if [ ! -d "$SRC_DIR" ]; then
  SRC_DIR="."
fi
ruflo analyze complexity "$SRC_DIR" --threshold 15 2>&1 | tail -5 || true
ruflo analyze circular "$SRC_DIR" 2>&1 | tail -3 || true
ruflo hooks pretrain --depth deep 2>&1 | tail -10

echo ""
echo "[6/8] Generating agent configs & compiling guidance..."
ruflo hooks build-agents --focus all --persist 2>&1 | tail -5 || true
ruflo guidance compile 2>&1 | tail -5 || true
ruflo guidance optimize 2>&1 | tail -3 || true

echo ""
echo "[7/8] Security scan & daemon..."
ruflo security scan 2>&1 | tail -10 || true
ruflo daemon start 2>&1 || true

# ── Phase 3: Export Portable State ──────────────
echo ""
echo "[8/8] Exporting portable state to .ruflo/..."
mkdir -p .ruflo/models
ruflo route export > .ruflo/q-table.json 2>/dev/null || true
ruflo config list --format json > .ruflo/config-export.json 2>/dev/null || true
ruflo neural export --output .ruflo/models/neural-export.json 2>/dev/null || true

# ── Summary ─────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Setup Complete"
echo "═══════════════════════════════════════"
echo ""
ruflo doctor 2>&1 | grep -E "^[✓⚠✗]" || true
echo ""
echo "Next steps:"
echo "  1. Review .claude/settings.json (ruflo may have added hooks)"
echo "  2. Merge with your .pre-ruflo backup if needed"
echo "  3. In Claude Code, run: /project:ruflo-seed"
echo "     (seeds memory, creates workflows, trains neural models)"
echo "  4. Run: ruflo doctor"
echo ""
