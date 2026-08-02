#!/bin/bash
# Provenance: bpm-opencode-experts
# Source path: scripts/validators/validate-mermaid.sh
# Import date: 2026-07-12
# DO NOT EDIT — this is imported content
#
# LOCAL PATCH (Shipwright W9-08, 2026-07-28): this script used to be the only
# validator in this directory that did not source `_lib.sh` and never emitted
# an envelope — on a clean scan it printed zero bytes to stdout while still
# exiting 0, which `packages/validators/src/contract.ts`'s
# `parseValidatorOutput('')` correctly treats as untrustworthy (malformed),
# not a pass. Since every phase in `PHASES[0..5]` requires this validator
# (R-H3), no phase could ever gate cleanly. Fixed by sourcing `_lib.sh` and
# routing every real finding through `gap`/`warn` so `validator_exit` always
# emits a conforming envelope, on every run including the zero-findings case.
# The scan logic (checks M001-M013, MRENDER) and the pass/fail judgement
# (fail iff at least one ERROR-level finding; warnings never fail the gate)
# are unchanged — this patch only fixes how the verdict is reported.

#
# validate-mermaid.sh — scan markdown files for Mermaid syntax problems
#
# Checks (static analysis, no external renderer required):
#   M001  Unquoted / in node label          [/sdlc] → ["/sdlc"]
#   M002  Semicolon in Note over text       Note over X: a; b  → Note over X: a, b
#   M003  Unicode → in Mermaid block        → should be ->
#   M004  Unquoted | in node label context  [a|b text] (likely meant "alias pipe")
#   M005  Empty node label                  [] or ()
#   M006  Unclosed mermaid fenced block
#   M007  Unquoted ( ) in node label         [Do (async)] → ["Do (async)"]
#   M008  Reserved word 'end' as node id     end[X] → End[X] (lowercase end closes blocks)
#   M009  Smart quotes / em-dash / nbsp      “ ” ‘ ’ — – (non-breaking space) → ASCII
#   M010  Markdown emphasis in label         [**Bold**] / [`code`] → plain or quoted
#   M011  // line comment in mermaid          // → %% (Mermaid comments are %%)
#   M012  Unbalanced [ ] on a node line       count mismatch → typo
#   M013  Backtick anywhere in diagram body   confirmed publish-fallback bug (T29.9), ERROR not warning
#
# If the mermaid CLI (mmdc) is installed, ALSO renders every block headlessly
# and surfaces real parser errors (authoritative — catches everything the
# static checks don't). Set MERMAID_NO_RENDER=1 to skip.
#
# Usage:
#   validate-mermaid.sh [root-dir] [scan-path]
#   Defaults: root-dir=$(pwd), scan-path=root-dir/docs
#
# Exit: 0 = clean, 1 = gaps found, 2 = validator error (per _lib.sh contract)
# stdout: _lib.sh envelope — {"validator":"validate-mermaid","gaps":N,
#         "exit":0|1,"items":[{"category":"M0xx","detail":"..."}]}
#         M004/M010 are warnings — reported on stderr only, never counted as
#         a gap (they never failed the gate before this patch either).
# stderr: human-readable summary (colorized if a tty)
#

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

validator_init "validate-mermaid"

ROOT="${1:-$(pwd)}"
SCAN_PATH="${2:-$ROOT/docs}"

[[ ! -d "$SCAN_PATH" ]] && SCAN_PATH="$ROOT"

total_warnings=0
files_scanned=0

emit() {
  # Route one finding to the envelope (errors) or to stderr only (warnings) —
  # never both, so warnings keep their pre-existing non-blocking behavior.
  local severity="$1" file="$2" line="$3" code="$4" msg="$5"
  local rel="$file"
  [[ -n "${ROOT:-}" && "$file" == "$ROOT/"* ]] && rel="${file#"$ROOT/"}"
  if [[ "$severity" == "error" ]]; then
    gap "$code" "${rel}:${line} — ${msg}"
  else
    warn "${rel}:${line} — ${code}: ${msg}"
  fi
}

scan_file() {
  local file="$1"
  local in_mermaid=0
  local mermaid_open_line=0
  local diagram_type=""
  local lineno=0
  local file_warnings=0

  while IFS= read -r rawline; do
    lineno=$((lineno + 1))
    line="$rawline"

    # ── fence tracking ─────────────────────────────────────────────────────
    if [[ "$line" =~ ^[[:space:]]*\`\`\`([a-zA-Z]*)$ ]]; then
      local lang="${BASH_REMATCH[1]:-}"
      if [[ $in_mermaid -eq 0 && "$lang" == "mermaid" ]]; then
        in_mermaid=1
        mermaid_open_line=$lineno
        diagram_type=""
      elif [[ $in_mermaid -eq 1 ]]; then
        in_mermaid=0
        diagram_type=""
      fi
      continue
    fi

    [[ $in_mermaid -eq 0 ]] && continue

    # Detect diagram type from first keyword line
    if [[ -z "$diagram_type" && "$line" =~ ^[[:space:]]*(sequenceDiagram|flowchart|graph|erDiagram|stateDiagram|classDiagram) ]]; then
      diagram_type="${BASH_REMATCH[1]}"
      continue
    fi

    # ── M001: unquoted / in square-bracket node label ──────────────────────
    # Match [...] where content has / but is not already "..."
    # Exclude <br/> which is intentional HTML
    local stripped_br="${line//<br\/>/BRPLACEHOLDER}"
    # Pattern stored in a variable, not written inline in the [[ =~ ]] test:
    # a bare (unescaped) " embedded directly in the pattern operand is
    # parsed differently across bash versions. Confirmed live (T32.4,
    # 2026-07-13): run against this repo's own real docs, the inline form
    # NEVER matched on macOS bash 3.2 (0 findings, including the classic
    # [/sdlc]-style case this check exists to catch) but matched correctly
    # on GNU bash 5.x -- the same macOS-vs-Linux divergence class M012 hit
    # (T32.1), just surfacing in a [[ =~ ]] regex operand instead of a
    # ${var//pattern/} glob. Storing the pattern in a variable first (the
    # style M007 below already used) removes the ambiguity on both engines.
    local m001_pattern='\[([^]["]*\/[^]["]*)\]'
    if [[ "$stripped_br" =~ $m001_pattern ]]; then
      local label="${BASH_REMATCH[1]}"
      # Ignore if the / appears inside a quoted edge label  -->|"text/text"|
      local arrow_label_pattern='-->\|.*".*".*\|'
      if [[ ! "$line" =~ $arrow_label_pattern ]]; then
        emit "error" "$file" "$lineno" "M001" \
          "Unquoted / in node label: [${label}] — wrap in double quotes: [\"${label}\"]"
      fi
    fi

    # ── M002: semicolon in Note over text ──────────────────────────────────
    if [[ "$line" =~ ^[[:space:]]*Note[[:space:]]+over[[:space:]]+[A-Za-z,[:space:]]+:[[:space:]].*\; ]]; then
      emit "error" "$file" "$lineno" "M002" \
        "Semicolon in Note over text breaks Mermaid parser — replace ; with , or remove"
    fi

    # ── M003: Unicode arrow → in Mermaid block ─────────────────────────────
    if [[ "$line" == *"→"* ]]; then
      emit "error" "$file" "$lineno" "M003" \
        "Unicode arrow → in Mermaid block — replace with ASCII ->"
    fi

    # ── M004: unquoted | in square-bracket label (likely pipe-syntax confusion)
    # Skip database shape syntax like [a|b] which is intentional
    # Found broken during the T32.4 bash-divergence audit: the class was
    # written [^\[\]\"] -- backslash has no escaping meaning inside a POSIX
    # bracket expression, so the expression actually closes at the first
    # bare ']' (the third class member) rather than at the trailing \] the
    # author intended, leaving \"] as ordinary regex text afterward.
    # Confirmed live: this NEVER matched on either macOS bash 3.2 or GNU
    # bash 5.x, including the exact [a | b] case it exists to catch --
    # identically dead code on both engines (not a cross-version
    # divergence, but the same underlying mistake as M001/M012: assuming
    # bracket-expression semantics that don't hold). Fixed the same way as
    # M001 -- ']' as the literal first class member (the one position that
    # never needs escaping) and the pattern stored in a variable.
    local m004_pattern='\[([^]["]+)[[:space:]]\|[[:space:]]([^]["]+)\]'
    if [[ "$line" =~ $m004_pattern ]]; then
      emit "warning" "$file" "$lineno" "M004" \
        "Possible unquoted | inside node label — use quoted label or check syntax"
      file_warnings=$((file_warnings + 1))
    fi

    # ── M005: empty node label ─────────────────────────────────────────────
    if [[ "$line" =~ [^a-zA-Z0-9]\[\][[:space:]] || "$line" =~ [^a-zA-Z0-9]\(\)[[:space:]] ]]; then
      emit "error" "$file" "$lineno" "M005" \
        "Empty node label [] or () — all Mermaid nodes must have labels"
    fi

    # ── M007: unquoted parentheses inside a square-bracket node label ──────
    # [Do thing (async)] — the ( starts a new shape and breaks the parser.
    # Skip already-quoted labels ["..."] and shape combos like ([...]) / [(...)]
    local paren_label_pat='\[[^]"]*[()][^]"]*\]'
    if [[ "$line" =~ $paren_label_pat && "$line" != *'["'* && "$line" != *'(['* && "$line" != *'[('* ]]; then
      emit "error" "$file" "$lineno" "M007" \
        "Unquoted ( ) in node label — wrap the label text in double quotes"
    fi

    # ── M008: reserved word 'end' (lowercase) used as a node id ────────────
    # 'end' closes subgraph/loop blocks; as a node (end[...] / end(...) / end{) it breaks flowcharts.
    if [[ "$diagram_type" == "flowchart" || "$diagram_type" == "graph" ]] && \
       [[ "$line" =~ (^|[[:space:]])end[\[\(\{] ]]; then
      emit "error" "$file" "$lineno" "M008" \
        "Reserved word 'end' as node id — rename to 'End' or 'endNode' (lowercase end closes blocks)"
    fi

    # ── M009: smart quotes / em-dash / en-dash / non-breaking space ────────
    if [[ "$line" == *$'“'* || "$line" == *$'”'* || "$line" == *$'‘'* || \
          "$line" == *$'’'* || "$line" == *$'—'* || "$line" == *$'–'* || \
          "$line" == *$' '* ]]; then
      emit "error" "$file" "$lineno" "M009" \
        "Smart quote / em-dash / non-breaking space in Mermaid — use straight ASCII quotes and hyphens (run mermaid-fix.mjs --write)"
    fi

    # ── M010: markdown emphasis (**bold**) inside a node label ─────────────
    # Cosmetic only — Mermaid renders ** literally rather than breaking the
    # parser, so this stays a non-blocking warning. (Backticks used to share
    # this check; see M013 below — a real parser break, not cosmetic.)
    if [[ "$line" =~ \[[^]\"]*(\*\*)[^]\"]*\] ]]; then
      emit "warning" "$file" "$lineno" "M010" \
        "Markdown emphasis (**) inside node label — Mermaid renders it literally; remove or quote"
      file_warnings=$((file_warnings + 1))
    fi

    # ── M013: unescaped backtick anywhere in Mermaid diagram body (T29.9) ──
    # CONFIRMED-HIT bug: a backtick anywhere in Mermaid diagram text (node
    # label, edge label, decision node, Note text, ...) breaks the parser,
    # and the publish pipeline silently falls back to rendering the raw
    # ```mermaid code block instead of the diagram. Scoped to the whole
    # diagram body (not just [...] labels) because the historical bug and
    # adversarial variants can land in {...}, (...), |...| edge labels, or
    # Note text just as easily. %% comment lines are exempt — a backtick in
    # a comment never reaches the parser. This is an ERROR (fails the gate),
    # unlike M010's cosmetic ** warning — a real docs sweep (T29.9) found
    # zero legitimate backtick usage inside any mermaid block, so this is
    # safe to promote without a documented escape hatch.
    if [[ "$line" == *'`'* && ! "$line" =~ ^[[:space:]]*%% ]]; then
      emit "error" "$file" "$lineno" "M013" \
        "Backtick in Mermaid diagram text breaks the parser (confirmed publish-fallback bug) — remove the backtick or rephrase without it"
    fi

    # ── M011: // comment (Mermaid uses %%) ─────────────────────────────────
    if [[ "$line" =~ ^[[:space:]]*// ]]; then
      emit "error" "$file" "$lineno" "M011" \
        "// is not a Mermaid comment — use %% instead"
    fi

    # ── M012: unbalanced [ ] on a node line ────────────────────────────────
    # Only count when the line actually uses node-label brackets. Counted
    # via an explicit char-by-char loop, not `${line//[^]]/}` -- independent
    # review (2026-07-09) found that bracket-negation idiom is interpreted
    # correctly on bash 3.2 (leading `]` right after `[^` is POSIX-literal)
    # but silently matches NOTHING on GNU bash 5.x (confirmed live: closes
    # came back as the entire unchanged line instead of just the `]`
    # chars), so `closes` was always wrong -- effectively dead code -- on
    # any bash 5.x runner (this repo's own CI). The char loop has no such
    # cross-version ambiguity.
    if [[ "$line" == *"["* || "$line" == *"]"* ]]; then
      local opens=0 closes=0 _m012_i _m012_ch
      for (( _m012_i=0; _m012_i<${#line}; _m012_i++ )); do
        _m012_ch="${line:_m012_i:1}"
        [[ "$_m012_ch" == "[" ]] && opens=$((opens + 1))
        [[ "$_m012_ch" == "]" ]] && closes=$((closes + 1))
      done
      if [[ "$opens" -ne "$closes" ]]; then
        emit "error" "$file" "$lineno" "M012" \
          "Unbalanced square brackets (${opens} '[' vs ${closes} ']') — likely a typo"
      fi
    fi

  done < "$file"

  # ── M006: unclosed mermaid block ───────────────────────────────────────
  if [[ $in_mermaid -eq 1 ]]; then
    emit "error" "$file" "$mermaid_open_line" "M006" \
      "Unclosed mermaid code block — missing closing backtick fence"
  fi

  total_warnings=$((total_warnings + file_warnings))
}

# ── scan all markdown files ───────────────────────────────────────────────────

# ── optional authoritative render check via mermaid CLI ───────────────────────
# Extracts each ```mermaid block and asks mmdc to parse/render it. Any block the
# static checks passed but the real parser rejects is caught here. Opt-out with
# MERMAID_NO_RENDER=1; auto-skips when mmdc is absent (static checks still run).
MMDC=""
if [[ "${MERMAID_NO_RENDER:-0}" != "1" ]]; then
  if command -v mmdc >/dev/null 2>&1; then MMDC="mmdc";
  elif command -v npx >/dev/null 2>&1 && npx --no-install mmdc --version >/dev/null 2>&1; then MMDC="npx --no-install mmdc"; fi
fi

render_check_file() {
  local file="$1" lineno=0 in_m=0 open_line=0 block="" tmp rc errout
  while IFS= read -r l; do
    lineno=$((lineno + 1))
    if [[ "$l" =~ ^[[:space:]]*\`\`\`mermaid$ ]]; then in_m=1; open_line=$lineno; block=""; continue; fi
    if [[ $in_m -eq 1 && "$l" =~ ^[[:space:]]*\`\`\`[[:space:]]*$ ]]; then
      in_m=0
      tmp="$(mktemp -t mermaid.XXXXXX.mmd)"
      printf '%s\n' "$block" > "$tmp"
      # Disable errexit around the external render call — its non-zero exit
      # is the very thing we're checking, not a validator-internal failure.
      set +e
      errout="$($MMDC -i "$tmp" -o "$tmp.svg" 2>&1)"
      rc=$?
      set -e
      rm -f "$tmp" "$tmp.svg"
      if [[ $rc -ne 0 ]]; then
        local msg; msg="$(printf '%s' "$errout" | grep -iE 'error|expecting|parse' | head -1)"
        emit "error" "$file" "$open_line" "MRENDER" "Mermaid render failed: ${msg:-see mmdc output}"
      fi
      continue
    fi
    [[ $in_m -eq 1 ]] && block+="$l"$'\n'
  done < "$file"
}

while IFS= read -r -d '' mdfile; do
  [[ "$mdfile" == *"/node_modules/"* ]] && continue
  [[ "$mdfile" == *"/.git/"* ]] && continue
  files_scanned=$((files_scanned + 1))
  scan_file "$mdfile" || true
  [[ -n "$MMDC" ]] && render_check_file "$mdfile"
done < <(find "$SCAN_PATH" -name "*.md" -print0 2>/dev/null)

# ── summary to stderr ─────────────────────────────────────────────────────────
if [[ "$GAP_COUNT" -eq 0 ]]; then
  pass "$files_scanned file(s) scanned — no issues found"
else
  note "$GAP_COUNT error(s) across $files_scanned file(s) scanned"
fi
if [[ "$total_warnings" -gt 0 ]]; then
  note "$total_warnings warning(s) also found (non-blocking — M004/M010)"
fi
if [[ -z "$MMDC" && "${MERMAID_NO_RENDER:-0}" != "1" ]]; then
  note "mmdc not installed — static checks only; install @mermaid-js/mermaid-cli for authoritative render validation"
fi
note "auto-fix the mechanical findings: node scripts/mermaid-fix.mjs <file> --write"

validator_exit
