#!/bin/bash
#
# validate-verification-integrity.sh -- flags the self-attest antipattern
# (CLAUDE.md law 4, C-2/C-3, D-014) at gate time: completion/verification
# decisions that come from something other than a real receipt/anchor
# correlation against server-derived state.
#
# Advisory-first (D-014 rules-first gate economics): ships in the `advisory`
# lifecycle stage -- it anchors LLM/human review, does not block a gate by
# itself, until red-fixture calibration earns it promotion to `gate`. It
# still follows the standard exit 0/1 + JSON gaps contract so it can be
# promoted with no code change, just a config flip.
#
# Three checks, ported from three real CRITICALs found in this repo
# (docs/LESSONS.md L-41/L-42, W6-03/W6-08, W5-11/W5-16):
#
#   [1] free-text match: a regex/string-match literal built from completion
#       keywords (receipt/verify/verified/exit/done/pass) tested against a
#       free-text field (comment/body/message/text) -- the W6-08 bypass
#       (`hasReceiptComment` used to grade VERIFIED off
#       `/receipt|verify|exit/i.test(c.body)` with no author check).
#   [2] caller-supplied verification input: a request-body field shaped like
#       `body.snapshot` (or a sibling verified/verification field) read and
#       fed toward a state decision -- the W5-16 bypass (`POST /plan/verify`
#       used to flip plan items to `done` off a client-supplied snapshot).
#   [3] a ticket/plan/item state literal flipping to done/verified with no
#       receipt/anchor/snapshot correlation anywhere nearby in the same file
#       -- the generic shape of the antipattern, scoped to ticket/plan/
#       mirror-reconciliation modules to keep signal-to-noise usable.
#
# Grep-based and deliberately coarse (no AST): every gap category can be
# suppressed for known-safe, already-reviewed sites via the sibling
# `validate-verification-integrity.baseline` file (see that file's header)
# so shipping this validator does not re-flag code this repo already fixed
# or already reviewed as safe by construction (e.g. an event-sourced
# reducer folding an already-receipt-checked event).
#
# Usage: validate-verification-integrity.sh [project-root]
# Exit 0 clean / 1 gaps / 2 error.

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

validator_init "validate-verification-integrity"

ROOT="$(detect_project_root "${1:-}")"
BASELINE_FILE="$(dirname "${BASH_SOURCE[0]}")/validate-verification-integrity.baseline"

SRC_DIRS=()
for candidate in "src" "app" "apps" "lib" "packages" "services" "internal" "cmd"; do
  [[ -d "$ROOT/$candidate" ]] && SRC_DIRS+=("$ROOT/$candidate")
done
if [[ "${#SRC_DIRS[@]}" -eq 0 ]]; then
  note "no source directory found at $ROOT -- nothing to scan"
  validator_exit
fi
note "scanning: ${SRC_DIRS[*]}"

find_source_files() {
  find "${SRC_DIRS[@]}" -type f \
    \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) \
    -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/build/*" \
    -not -name "*.d.ts" -not -name "*.test.*" -not -name "*.spec.*" 2>/dev/null || true
}

# trim <text> -- strip leading/trailing whitespace
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# is_baselined <category> <relfile> <raw-line-text> -- true if this exact
# (category, file, trimmed-line-text) triple is pre-approved. Keyed on line
# *content*, not line number, so it survives unrelated edits shifting line
# numbers elsewhere in the file; an edit to the flagged line itself falls
# out of the baseline and must be re-reviewed (recalibrated), which is the
# intended behavior, not a bug.
is_baselined() {
  local category="$1" relfile="$2" raw="$3"
  [[ -f "$BASELINE_FILE" ]] || return 1
  local trimmed
  trimmed="$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  local bcat bfile bline
  while IFS=$'\t' read -r bcat bfile bline; do
    [[ -z "$bcat" || "$bcat" == \#* ]] && continue
    if [[ "$bcat" == "$category" && "$bfile" == "$relfile" && "$bline" == "$trimmed" ]]; then
      return 0
    fi
  done < "$BASELINE_FILE"
  return 1
}

# -- Check 1: free-text completion/verification matching -------------------
printf '\n[1] free-text match deciding completion/verification\n' >&2
KEYWORD_RE='(receipt|verify|verified|exit|done|pass)'
FIELD_RE='\.(body|comment|message|text)\b'
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  rel="${f#"$ROOT"/}"
  while IFS=: read -r lineno linetext; do
    [[ -z "$lineno" ]] && continue
    if is_baselined "free-text-match" "$rel" "$linetext"; then continue; fi
    gap "free-text-match" \
      "$rel:$lineno: completion/verification decided by a regex/string match over free text, not an identity+anchor check -- $(trim "$linetext")"
  done < <(grep -nE '\.(test|exec|match)\(' "$f" 2>/dev/null \
    | grep -iE "$KEYWORD_RE" | grep -E "$FIELD_RE" || true)
done < <(find_source_files)

# -- Check 2: caller-supplied verification-state input ----------------------
printf '\n[2] caller-supplied verification input feeding a state decision\n' >&2
BODY_FIELD_RE='\b(body|req(uest)?\.body)\??\.(snapshot|verified|verification)\b'
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  rel="${f#"$ROOT"/}"
  while IFS=: read -r lineno linetext; do
    [[ -z "$lineno" ]] && continue
    if is_baselined "caller-input-state-flip" "$rel" "$linetext"; then continue; fi
    gap "caller-input-state-flip" \
      "$rel:$lineno: caller-supplied request-body field feeds a verification/state decision instead of server-derived state -- $(trim "$linetext")"
  done < <(grep -nE "$BODY_FIELD_RE" "$f" 2>/dev/null || true)
done < <(find_source_files)

# -- Check 3: ticket/plan/item state flip with no nearby receipt/anchor -----
printf '\n[3] ticket/plan/item state flip to done/verified without a receipt/anchor/snapshot correlation nearby\n' >&2
STATE_FLIP_RE="(state|status)[[:space:]]*[:=][[:space:]]*['\"](done|verified)['\"]"
SAFE_NEARBY_RE='receipt|anchor|snapshot'
WINDOW=20
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  rel="${f#"$ROOT"/}"
  case "$rel" in
    *ticket*|*plan*|*mirror*|*reconcil*) ;;
    *) continue ;;
  esac
  while IFS=: read -r lineno linetext; do
    [[ -z "$lineno" ]] && continue
    if is_baselined "state-flip-no-anchor" "$rel" "$linetext"; then continue; fi
    win_start=$(( lineno - WINDOW )); (( win_start < 1 )) && win_start=1
    win_end=$(( lineno + WINDOW ))
    window="$(sed -n "${win_start},${win_end}p" "$f" 2>/dev/null || true)"
    if printf '%s' "$window" | grep -qiE "$SAFE_NEARBY_RE"; then
      continue
    fi
    gap "state-flip-no-anchor" \
      "$rel:$lineno: ticket/plan/item flips to done/verified with no receipt/anchor/snapshot correlation within ${WINDOW} lines -- $(trim "$linetext")"
  done < <(grep -nE "$STATE_FLIP_RE" "$f" 2>/dev/null || true)
done < <(find_source_files)

validator_exit
