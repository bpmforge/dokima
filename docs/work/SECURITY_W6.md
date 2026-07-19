# Security pass — wave W6 (2026-07-19T03:36:24.765Z)

```json
{
  "critical": [
    {
      "file": "packages/forge/src/mirror/reconciliation.ts",
      "issue": "hasReceiptComment() grades a ticket VERIFIED based purely on comment text (ticketId + /receipt|verify|exit/i) and never checks IssueComment.authorLogin against the maker/reviewer identity. Since the maker's own 'evidence' verb can post arbitrary comments under the maker identity (write-through.ts), the maker itself can defeat the entire SC-15/reconciliation audit by posting a comment like 'receipt for W6-03, verify exit 0' — no actual close, no actual test run required. This is precisely the maker-self-attests-completion scenario the maker≠verifier boundary (C-4/SC-03) and reconciliation audit exist to prevent, and it is trivially bypassable by the untrusted party.",
      "fix": "Require the receipt comment to have been authored by the identity write-through.ts uses for the 'close' verb (authorLogin === maker login, ideally also cross-checked against the reviewer's separate accept comment), and/or require a structured, non-spoofable marker (e.g. a hash/anchor embedded by the close verb, matched against the locally-stored receipt hash) rather than free-text keyword matching."
    }
  ],
  "high": [
    {
      "file": "packages/forge/src/mirror/write-through.ts",
      "issue": "The 'close' case unconditionally sets the forge issue state to 'closed' regardless of request.receipt.verifyExitCode. A receipt reporting a failed verification (nonzero exit code) still closes the mirrored issue and posts a comment stating the failing exit code — the forge state and the receipt content disagree, and nothing blocks the close. This violates the 'every durable state change goes through receipts' rule (CLAUDE.md law 4): the receipt is treated as inert display data rather than a gate.",
      "fix": "Before calling updateIssue with state:'closed', assert request.receipt.verifyExitCode === 0 (throw/refuse otherwise) so a failed verification cannot produce a closed forge issue."
    },
    {
      "file": "packages/forge/src/mirror/reconciliation.ts",
      "issue": "commitsOverlap() only checks receiptCommits.length === 0 for the trivial-pass case, but a receipt containing an empty-string entry (e.g. closeReceiptCommits: ['']) also trivially passes: ''.startsWith(sha) is false but sha.startsWith('') is always true for any non-empty gitCommits, so any malformed/empty commit sha in the receipt is treated as verified against arbitrary git history.",
      "fix": "Filter out empty/falsy entries from receiptCommits before comparing, and treat a receipt whose commits array contains only empty strings as UNVERIFIED, not implicitly VERIFIED."
    }
  ],
  "medium": [
    {
      "file": "packages/forge/src/mirror/types.ts",
      "issue": "MIRROR_VERB_IDENTITY (the maker/reviewer verb→identity mapping that mechanically enforces SC-03) is exported as a plain mutable object, not frozen. Any importer (including a test or a future refactor) can reassign MIRROR_VERB_IDENTITY.accept = 'maker' at runtime and silently collapse the maker≠verifier guarantee that write-through.ts relies on being immutable.",
      "fix": "Wrap the object in Object.freeze() at declaration so the identity mapping cannot be mutated at runtime, matching law 5's 'maker ≠ verifier is mechanical' requirement."
    },
    {
      "file": "packages/forge/src/mirror/write-through.ts",
      "issue": "receiptCommentBody() interpolates receipt.ticketId/ownerId/verifyCommand/commits/files directly into a markdown comment body with no escaping. If any of these caller-supplied strings (ultimately sourced from ticket/manifest data an agent session produced) contain markdown control characters or forge-specific syntax (e.g. GitHub @mentions, issue-closing keywords like 'Fixes #1'), the posted comment could trigger unintended forge-side effects (notification spam, cross-linking, or accidental issue closure of an unrelated issue) — a stored-content trust-boundary leak from agent-authored text into a comment posted under a privileged (maker) forge identity.",
      "fix": "Sanitize/escape receipt fields before interpolation (e.g. strip or escape leading '@', '#', and closing-keyword patterns) or wrap them in a code block, since this text is authored upstream by an untrusted agent session and posted under a real forge identity."
    }
  ],
  "notes": "Scope: packages/forge/src/mirror/** (W6-03 write-through, offline queue, reconciliation audit) plus the plan.json/STATUS.md bookkeeping. No hardcoded secrets found (test tokens are fixture literals). No command/child-process/git-shell code in this diff — write-through only calls the existing ForgeAdapter HTTP methods. No unsafe deserialization introduced. No new dependencies. The most important issue is architectural: the reconciliation audit's 'independent forge/git evidence' is not actually independent of the maker identity, which undermines the core SC-15/C-4 guarantee this ticket is meant to deliver. The write-through and queue modules are currently unwired (HANDOFF to a future harbormaster ticket per the diff's own notes), so these are pre-integration findings — fix before the harbormaster caller lands, since callers will trust this module's grading/closing semantics as-is."
}
```
