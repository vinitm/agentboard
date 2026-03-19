#!/bin/bash
# Bootstrap ruflo on a new device from committed state
# Run from the agentboard repo root after cloning
set -euo pipefail

echo "[ruflo-bootstrap] Initializing ruflo runtime..."
ruflo init --skip-claude --with-embeddings --force

echo "[ruflo-bootstrap] Importing config..."
if [ -f .ruflo/config-export.json ]; then
  ruflo config import .ruflo/config-export.json
else
  ruflo config init --v3
fi

echo "[ruflo-bootstrap] Importing Q-learning routing table..."
if [ -f .ruflo/q-table.json ]; then
  ruflo route import .ruflo/q-table.json
fi

echo "[ruflo-bootstrap] Importing neural models..."
if [ -f .ruflo/models/neural-export.json ]; then
  ruflo neural import .ruflo/models/neural-export.json
fi

echo "[ruflo-bootstrap] Running deep pretrain..."
ruflo hooks pretrain --depth deep

echo "[ruflo-bootstrap] Compiling guidance..."
ruflo guidance compile

echo "[ruflo-bootstrap] Starting daemon..."
ruflo daemon start

echo "[ruflo-bootstrap] Bootstrap complete. Run 'ruflo doctor' to verify."
