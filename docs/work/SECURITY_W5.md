# Security pass — wave W5 (2026-07-19T20:57:35.023Z)

```json
{
  "critical": [
    {
      "file": "packages/pipeline/src/decisions/ledger.ts",
      "issue": "escapeCell() only escapes a lone `|` to `\\|` and strips newlines, but never escapes a pre-existing literal backslash. If attacker/LLM-controlled content (decision/rationale/optionsConsidered, and — per this same file's own gate-fix note — also id/date) contains a backslash immediately before a pipe (e.g. `...\\|D-999|forged|...`), escapeCell turns that into `\\\\|...` (two backslashes + unescaped pipe). Per CommonMark/GFM table rules, `\\\\` is parsed as one escaped literal backslash, which consumes the escaping backslash and leaves the following `|` as a live, unescaped table-cell delimiter — fully defeating the pipe-escaping this module (and its two rounds of gate-fixes) was specifically built to guarantee. This lets agent-authored decision text still shift columns or forge an extra `| D-999 | ... |` row in the append-only docs/DECISIONS.md ledger once W5-13 wires this to the real file, and a forged row starting `| D-<n> |` would also be picked up by `appendDecision`'s `ID_LINE` anchor and `nextDecisionId`'s scan on subsequent calls, compounding the corruption.",
      "fix": "Escape backslashes before escaping pipes (and before the newline strip), e.g. `value.replace(/\\\\/g, '\\\\\\\\').replace(/\\|/g, '\\\\|').replace(/\\r\\n|\\r|\\n/g, ' ')` — escape the escape character first so a later literal `\\` can never re-combine with an escaped `\\|` to un-escape it. Add a regression test with a literal backslash immediately preceding an injected `|` (e.g. rationale = `legit\\|D-999|forged|n/a|n/a|`) asserting no new `| D-...` row appears."
    }
  ],
  "high": [],
  "medium": [
    {
      "file": "packages/pipeline/src/decisions/ledger.ts",
      "issue": "citesDecisionId(text, decisionId) interpolates decisionId unescaped into `new RegExp(\\`\\\\b${decisionId}\\\\b\\`)`. Every current call site (gate.ts, via STRICT_MARKER_RE's captured `(D-\\d+)` group) happens to pass a digits-only string, so it's not exploitable through this diff's own code paths. But the function is exported as public API and its own doc comment states it's meant for 'a future doc-consistency validator' that checks whether other (untrusted, agent/LLM-authored) documents cite a decision ID — a caller passing attacker-influenced text there would hit regex-metacharacter injection: a decisionId like `D-1(` throws an uncaught SyntaxError (DoS), and other metacharacter combinations risk ReDoS or false-positive citation matches.",
      "fix": "Escape decisionId with the existing escapeRegExp helper (currently private to markers.ts — hoist it to a small shared util) before building the RegExp: `new RegExp(\\`\\\\b${escapeRegExp(decisionId)}\\\\b\\`)`. Add a test asserting a decisionId containing regex metacharacters doesn't throw and doesn't produce a false match."
    }
  ],
  "notes": "Scope of this diff (packages/pipeline/src/blueprint/** and src/decisions/**) is pure text-transform logic with no filesystem/child-process/network reach, so command injection, path traversal, hardcoded secrets, unsafe deserialization, and dependency-risk classes don't apply here — no child_process/git shell-out, no new dependencies, no credentials. The markers.ts character-level sanitizeMarkerText fix (delete `<`,`!`,`>` outright rather than string-replace the `<!--`/`-->` tokens) is sound and not subject to the same escape-the-escape class of bug as ledger.ts's escapeCell, since deletion can't be reversed by concatenation. gate.ts's decideBlueprintUnlock correctly re-derives from raw markdown + the real ledger every call (no cached self-attested completeness flag), consistent with the project's maker≠verifier/no-self-grading trust-boundary rule. One non-security robustness note: parseMarkers' LOOSE_MARKER_RE (`/FOUNDER-DECISION/`) will flag ordinary prose that happens to contain the literal string \"FOUNDER-DECISION\" as a malformed marker, fail-closed-blocking the gate — safe direction (never fails open) but worth knowing as a false-positive/availability quirk, not a vulnerability."
}
```
