#!/bin/bash
# Set up ruflo intelligence for any repo
# Usage: ./scripts/ruflo-setup-for-repo.sh /path/to/target-repo [--force]
#
# What it does:
#   1. Runs full ruflo CLI setup in the target repo
#   2. Copies /ruflo-seed command for MCP seeding
#   3. Copies bootstrap script for cross-device portability
#   4. Sets up .claudeignore and .gitignore
#   5. Prints next steps
#
# After running this, open the target repo in Claude Code and run:
#   /ruflo-seed
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Argument parsing ─────────────────────────────
TARGET_REPO=""
FORCE_FLAG=""

for arg in "$@"; do
  case "$arg" in
    --force) FORCE_FLAG="--force" ;;
    -*) echo "Unknown flag: $arg"; exit 1 ;;
    *) TARGET_REPO="$arg" ;;
  esac
done

if [ -z "$TARGET_REPO" ]; then
  echo "Usage: $0 /path/to/target-repo [--force]"
  echo ""
  echo "Sets up ruflo intelligence for the target repo."
  echo "Run from the agentboard repo (source of setup files)."
  exit 1
fi

# Resolve to absolute path
TARGET_REPO="$(cd "$TARGET_REPO" 2>/dev/null && pwd)" || {
  echo "Error: Directory does not exist: $TARGET_REPO"
  exit 1
}

if [ ! -d "$TARGET_REPO/.git" ]; then
  echo "Warning: $TARGET_REPO is not a git repository."
  read -p "Continue anyway? [y/N] " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

echo "═══════════════════════════════════════"
echo "  Ruflo Setup for: $TARGET_REPO"
echo "═══════════════════════════════════════"

# ── Phase 1: CLI Setup in Target Repo ────────────
cd "$TARGET_REPO"

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

# ── Phase 2: Intelligence Bootstrap ──────────────
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

# ── Phase 3: Export Portable State ───────────────
echo ""
echo "[8/8] Exporting portable state to .ruflo/..."
mkdir -p .ruflo/models
ruflo route export > .ruflo/q-table.json 2>/dev/null || true
ruflo config list --format json > .ruflo/config-export.json 2>/dev/null || true
ruflo neural export --output .ruflo/models/neural-export.json 2>/dev/null || true

# ── Phase 4: Copy Replication Files ──────────────
echo ""
echo "Copying replication files from agentboard..."

# Copy /ruflo-seed command
mkdir -p .claude/commands
cp "$SOURCE_REPO/.claude/commands/ruflo-seed.md" .claude/commands/ruflo-seed.md
echo "  Copied: .claude/commands/ruflo-seed.md"

# Copy bootstrap script
mkdir -p scripts
cp "$SOURCE_REPO/scripts/ruflo-bootstrap.sh" scripts/ruflo-bootstrap.sh
chmod +x scripts/ruflo-bootstrap.sh
echo "  Copied: scripts/ruflo-bootstrap.sh"

# ── Phase 5: Configure Ignores ───────────────────
echo ""
echo "Configuring ignore files..."

# .claudeignore
if [ ! -f .claudeignore ]; then
  cat > .claudeignore << 'EIGNORE'
.claude-flow/
.agents/
.ruflo/session-export.json
node_modules/
dist/
*.rvf
EIGNORE
  echo "  Created: .claudeignore"
else
  # Ensure ruflo entries exist
  for entry in ".claude-flow/" ".agents/" ".ruflo/session-export.json"; do
    if ! grep -qF "$entry" .claudeignore; then
      echo "$entry" >> .claudeignore
      echo "  Added to .claudeignore: $entry"
    fi
  done
fi

# .gitignore
if [ -f .gitignore ]; then
  NEEDS_RUFLO=false
  for entry in ".agents/" ".claude-flow/" ".ruflo/session-export.json"; do
    if ! grep -qF "$entry" .gitignore; then
      NEEDS_RUFLO=true
      break
    fi
  done
  if [ "$NEEDS_RUFLO" = true ]; then
    cat >> .gitignore << 'GIGNORE'

# Ruflo runtime state (not portable)
.agents/
.claude-flow/
.ruflo/session-export.json

# Keep committed (portable state):
# .ruflo/memory-export.json
# .ruflo/q-table.json
# .ruflo/config-export.json
# .ruflo/models/
GIGNORE
    echo "  Updated: .gitignore (added ruflo entries)"
  else
    echo "  .gitignore already has ruflo entries"
  fi
else
  cat > .gitignore << 'GIGNORE'
node_modules/

# Ruflo runtime state (not portable)
.agents/
.claude-flow/
.ruflo/session-export.json

# Keep committed (portable state):
# .ruflo/memory-export.json
# .ruflo/q-table.json
# .ruflo/config-export.json
# .ruflo/models/
GIGNORE
  echo "  Created: .gitignore"
fi

# ── Summary ──────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  CLI Setup Complete"
echo "═══════════════════════════════════════"
echo ""
ruflo doctor 2>&1 | grep -E "^[✓⚠✗]" || true
echo ""
echo "Next steps:"
echo "  1. Review .claude/settings.json (ruflo may have added hooks)"
echo "     Compare with .claude/settings.json.pre-ruflo if needed"
echo "  2. Open $TARGET_REPO in Claude Code"
echo "  3. Run: /ruflo-seed"
echo "     (seeds memory, creates workflows, trains neural models)"
echo "  4. Commit the .ruflo/ directory for cross-device portability"
echo ""
