#!/usr/bin/env bash
# hooks/install.sh — point core.hooksPath at the tracked hooks/ directory.
# Idempotent; verify with: git config core.hooksPath  (expect: hooks)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
chmod +x hooks/pre-commit hooks/pre-push
git config core.hooksPath hooks
echo "core.hooksPath=$(git config core.hooksPath) — pre-commit (format+secrets on staged) and pre-push (pnpm validate) active"
