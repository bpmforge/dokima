# Security pass — wave W7 (2026-07-21T03:01:17.362Z)

```json
{
  "critical": [],
  "high": [
    {
      "file": "apps/server/src/api/lessons/resolve-filed-by.ts",
      "issue": "filedBy is resolved by trusting a client-supplied (source, sourceRef) pair to look up ANY event in the project's entire event log (via listEvents().find()), with no check that the matched event's ticketId relates to the request, and the 'trace:unknown:<seq>' path lets the caller bypass the runId check entirely by literally typing the string 'unknown'. Since seq is a small sequential integer, an attacker/filer can trivially attribute a field report to any actor who ever produced any event in the project (e.g. a different agent, or an unrelated ticket's actor) just by guessing seq values, fabricating provenance for a report they actually authored themselves. Because triagedBy is hardcoded to OPERATOR_ACTOR_ID, this also lets a filer dress up a self-authored/fabricated report to dodge the SelfTriageError protection that Law 5/C-4 relies on to keep maker and verifier mechanically distinct.",
      "fix": "Require the resolved event's ticketId to equal body.ticketId (or omit ticketId entirely rather than defaulting), scope the lookup to events from the specific session/run the request is actually operating in (not the whole project log), and never let a client-controlled literal like 'unknown' short-circuit the runId match. Consider binding sourceRef to a short-lived, server-issued token minted at prefill time instead of a raw, guessable seq/timestamp."
    },
    {
      "file": "apps/server/src/api/lessons/routes.ts",
      "issue": "The 'ticket' triage decision takes ticketId/title/lane/writeScope/dependsOn straight from the request body and inserts a real ticket into the event log via createTicket with no allowlist/validation on writeScope (e.g. no block on .github/**, CI config, secrets-adjacent paths) and no receipt/second-actor confirmation. This creates tickets outside the normal plan.json review path that CLAUDE.md Law 1 assumes all tickets originate from, meaning any caller who can reach this endpoint can inject a ticket that later grants an autonomous coding agent unrestricted write access to sensitive files — a direct trust-boundary bypass (Law 4: durable state changes should go through verbs/receipts, not an ad hoc triage POST).",
      "fix": "Validate/allowlist writeScope globs before ticket creation (deny CI/workflow/secrets paths, or require them to match an existing plan.json lane's expected scope), and/or require an explicit receipt or second human confirmation step before a triage-originated ticket becomes claimable by an agent."
    }
  ],
  "medium": [
    {
      "file": "apps/server/src/api/server.ts",
      "issue": "registerLessonsRoutes(app, { home: opts.fleetHome }) is registered without the auth option that registerDecisionRoutes explicitly receives one line above (auth: authOpts). It's unclear from this diff whether the global auth hook uniformly covers authorization for field-report filing/triage the same way decisions routes get route-specific auth, given the inconsistency between the two registrations.",
      "fix": "Confirm the global auth preHandler hook fully authorizes these routes, or thread the same auth: authOpts used by decisions routes into registerLessonsRoutes for consistency."
    },
    {
      "file": "apps/server/src/api/lessons/resolve-filed-by.ts",
      "issue": "listEvents(log) materializes the entire append-only (Law 7: never pruned) event log into memory on every single field-report filing request, then does a linear .find(). As the log grows over the project's lifetime this becomes an increasingly expensive full scan per request, and repeated POST /field-reports calls provide a low-cost resource-exhaustion vector.",
      "fix": "Replace the full listEvents() scan with a targeted, indexed query (by seq, or by ticketId+eventType prefix for escalation) instead of loading and linearly scanning the whole log."
    },
    {
      "file": "packages/memory/src/code-index/indexer.ts",
      "issue": "absolutePath is built by string-concatenating rootDir with each relative path ripgrep reports, then read directly with no check that the resolved path stays within rootDir (rg can follow symlinks that point outside the indexed tree). Low likelihood since rootDir is presumably server-configured rather than directly user-supplied, but no containment check exists in this code path.",
      "fix": "Resolve each absolutePath and verify it is still contained within the resolved rootDir before calling readFile."
    }
  ],
  "notes": "No hardcoded secrets found. Subprocess invocation of ripgrep (ripgrep.ts) correctly uses execFile with argv arrays (never a shell string) and inserts '--' before the user-controlled pattern, which is the right mitigation against command/argument injection. The duplicate-ticket-id check before prepareValidatorFixTicket is explicitly reasoned as safe against TOCTOU given the single-writer-per-DB guarantee (Law 7), which checks out. filedBy/triagedBy are both resolved server-side rather than trusted from the client body (good pattern in principle), but the HIGH finding above shows the server-side resolution itself is only as trustworthy as the client-suppliable sourceRef it looks up. The new @shipwright/memory workspace dependency in apps/server/package.json is internal-only, no new external/third-party dependency risk introduced by this diff."
}
```
