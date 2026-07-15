#!/bin/bash
#
# secrets-scan.sh -- close-gate secrets scanner (BLUEPRINT §12.5, SC-06,
# ticket W3-13). Scans the project tree for known live-credential shapes:
# GitHub tokens, PEM private-key blocks, AWS access key ids,
# OpenAI/Anthropic-style `sk-` keys, Slack tokens, and DB connection
# strings with embedded credentials -- the same category set as
# packages/shared/src/secrets/patterns.ts and the write-path guard in
# packages/shared/src/config/settings-files.ts (SECRET_LIKE_PATTERNS).
#
# A matched value is never printed in full, only a short masked prefix --
# a validator run must not become the leak it exists to prevent.
#
# NOTE ON NAMING: this file intentionally does NOT use the `validate-`
# prefix packages/validators/src/pack.ts's VALIDATOR_NAME_RE expects for
# automatic pack discovery -- this ticket's write_scope
# (content/validators/secrets-scan*) and that pre-existing discovery
# regex (`^(validate|run)-.+\.sh$`, landed W1-02, out of this ticket's
# write_scope) are mutually incompatible prefixes; no single filename can
# satisfy both. Recorded as a HANDOFF in plan.json W3-13 notes.
#
# Usage: secrets-scan.sh [project-root]
# Exit 0 clean / 1 gaps / 2 error.

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

validator_init "secrets-scan"

ROOT="$(detect_project_root "${1:-}")"

EXCLUDE_ARGS=(
  --exclude-dir=.git
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=coverage
  --exclude-dir=.turbo
  --exclude-dir=.shipwright
)

# category|extended-regex (grep -E compatible)
PATTERNS=(
  "github-token|gh[pousr]_[A-Za-z0-9]{20,}"
  "aws-access-key-id|AKIA[0-9A-Z]{16}"
  "openai-style-key|sk-[A-Za-z0-9_-]{16,}"
  "slack-token|xox[baprs]-[A-Za-z0-9-]{10,}"
  "pem-private-key|-----BEGIN [A-Z ]*PRIVATE KEY-----"
  "db-connection-credentials|(postgres(ql)?|mysql|mongodb(\+srv)?)://[^:@[:space:]]+:[^@[:space:]]+@"
)

# mask <value> -- first 4 chars + a length marker, never the full secret.
mask() {
  local s="$1"
  printf '%s...REDACTED(%d chars)' "${s:0:4}" "${#s}"
}

for entry in "${PATTERNS[@]}"; do
  category="${entry%%|*}"
  pattern="${entry#*|}"

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    file="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"

    # Never report a hit inside this validator's own pattern definitions.
    case "$file" in
      */secrets-scan.sh) continue ;;
    esac

    matched="$(grep -oE -- "$pattern" "$file" 2>/dev/null | head -1)"
    relfile="${file#"$ROOT"/}"
    gap "$category" "${relfile}:${lineno} — $(mask "$matched")"
  done < <(grep -rEIn "${EXCLUDE_ARGS[@]}" -- "$pattern" "$ROOT" 2>/dev/null)
done

if [[ "$GAP_COUNT" -eq 0 ]]; then
  pass "no known live-credential shapes found under $ROOT"
fi

validator_exit
