# Security pass — wave W4 (2026-07-18T21:06:22.472Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "apps/server/src/api/server/notifications-routes/emit-route.ts",
      "issue": "POST /api/v1/projects/:id/notifications lets any bearer-token holder create Decide/Review-tier notifications (e.g. kind: 'approval', 'pr_ready', 'gate_passed') with completely free-form title/body/ref_type/ref_id. Nothing checks that ref_id/ref_type point to a real ticket, or that a gate/close receipt actually backs the claim (contrast with artifacts-routes.ts's isGatedDeliverable, which does check receipts before setting revisionRequested). This breaks the 'receipts required for durable state claims' trust model: a caller can fabricate an 'approval' card claiming a PR is ready or a gate passed, and it will surface unmodified in the human's morning queue (GET /api/v1/approvals/queue) with no indication it is unverified.",
      "fix": "For tier=decide/review kinds that assert a fact about project state (pr_ready, gate_passed, approval), require and verify a receipt id (or ticket+gate lookup) server-side before accepting the emission, and surface provenance (receipt id / verified: true|false) in the wire payload so the UI can visually distinguish system-verified cards from freeform ones."
    }
  ],
  "medium": [
    {
      "file": "apps/server/src/api/server/notifications-routes/decide-routes.ts",
      "issue": "decideNotification/dismissNotification always record actorId as the hardcoded OPERATOR_ACTOR_ID regardless of which caller (any holder of the shared bearer token) actually issued the request. The resulting notification.decided event is the durable record of a human approval decision, but it provides no real non-repudiation — any process with API access produces an indistinguishable 'operator approved' event.",
      "fix": "If this endpoint can ever be reached by more than the single interactive browser session (e.g. multiple operator devices, or future automation), thread a real caller identity (from auth context) into actorId instead of a constant, so the event log's hash chain reflects who actually decided."
    },
    {
      "file": "apps/server/src/api/server/artifacts-routes.ts",
      "issue": "POST /artifacts/comments and GET /artifacts/comments accept/query an arbitrary body.path / query.path without ever running it through isSafeRelativePath (unlike the /doc, /diff, /doc-diff routes). Currently the value is only used as a string-compare filter, not a filesystem path, so it isn't exploitable today, but the value is persisted to the event log and re-read by other consumers — any future code path that uses the stored comment path for a file operation would reintroduce the path-traversal / dot-prefix leak class this file's own header describes fixing elsewhere.",
      "fix": "Validate body.path with isSafeRelativePath at write time (reject 400 on failure), consistent with the other artifact routes, so no unsafe path can ever enter the event log via this route."
    },
    {
      "file": "apps/server/src/api/server/notifications-routes/shared.ts",
      "issue": "refreshAndListProjectNotifications performs writes (promoteEligibleNotifications, maybeEmitTrustGraduationSuggestion — both open the DB in write mode and INSERT/UPDATE) as a side effect of every GET /api/v1/notifications and GET /api/v1/approvals/queue call. GET requests are expected to be safe/idempotent; any prefetching, browser extension, proxy, or link-scanner that issues a GET could trigger unintended state promotion (pushing a Decide item live, minting a trust-graduation suggestion) outside of explicit user action.",
      "fix": "Move promotion/suggestion evaluation to an explicit POST/refresh action or a background tick, and make GET routes read-only."
    },
    {
      "file": "apps/server/src/api/server/artifacts-routes.test.ts",
      "issue": "Hardcoded receipt-signing secret ('test-minting-secret') is committed in source (duplicated in receipts-routes.test.ts). Test-only, but if this value or pattern is ever reused as a placeholder default in non-test config it would be a real key-leak.",
      "fix": "Keep as-is for tests but confirm no production code path defaults SIGNING_KEY/signingKey to a literal fallback string; require it to be sourced from keychain/env with no hardcoded default (per FR-S2)."
    }
  ],
  "notes": "Git-invocation surface (git-read.ts) is well-defended: execFile with argv arrays (no shell), isSafeGitRevision blocks option-injection (leading '-', tested against --output=... arbitrary-file-write), isSafeRelativePath blocks traversal/absolute/dot-prefixed segments, and readWorkingTree adds a realpath-based symlink check with dedicated regression tests — no command/path injection found there. All SQL is parameterized (? or named params via better-sqlite3); no SQL injection found. No unsafe deserialization (JSON.parse only, no eval/vm/yaml.load). No new third-party dependencies introduced in this diff. Diff was truncated mid-file at apps/server/src/api/server/rules-routes.ts (POST .../rules/:ruleId/register) — that route and anything after it could not be reviewed."
}
```
