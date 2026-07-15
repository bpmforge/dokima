# Shipwright — API Design (REST /api/v1 + WS)

Traces to: BLUEPRINT.md §3 (all components), ARCHITECTURE.md §3/§4, DATABASE.md tables,
DECISIONS.md D-005 (auth middleware from W0, single-user mode at v1), D-012 (settings
scopes), D-013 (multi-project Fleet). Consumers: the
Canvas SPA and the `shipwright` CLI — both drive the same verbs (BLUEPRINT §5.3).
Served by apps/server on localhost only (SC-08).

## 1. Conventions

- **Base** `/api/v1`; additive-only within v1. OpenAPI generated from Fastify + zod
  route schemas, served at `/api/v1/openapi.json` in dev.
- **Auth (D-005):** every route (except `/healthz`) sits behind the auth middleware.
  v1 single-user mode: a bearer token generated at first run, stored in
  `~/.shipwright/token`, auto-injected by the served SPA and the CLI —
  `Authorization: Bearer <token>`. Missing/wrong ⇒ 401. v2 swaps the middleware's
  verifier for OIDC/SAML without touching routes. Origin/Host allowlist on every
  request; WS upgrade re-checks both (SC-08).
- **Errors:** RFC 7807 `application/problem+json` — `{type, title, status, detail,
  instance, request_id}`. Invariant refusals (verb rejected, gate failed) return
  **409** with `detail` = the specific rule and `receipt_id`/evidence refs — the UI's
  "explain-this-refusal" renders this payload verbatim (FR-T4).
- **Idempotency:** every mutating POST accepts `Idempotency-Key` (client UUID). Keys are
  stored with the resulting event seq; replay returns the original response (crash-safe
  clients + at-least-once CLI scripting). Verb endpoints REQUIRE it.
- **Verbs as POST actions:** lifecycle transitions are `POST /tickets/{id}/{verb}`,
  never PATCHes to a status field — the transition graph is the API (FR-T1).
- **Actor attribution:** mutations carry the caller's identity (v1: the operator; berth
  and agent actions never come through this API — they act in-process via Harbormaster).

## 2. Endpoint catalog

### projects & runs (BLUEPRINT §3.2/§3.6/§3.11)
| Method+Path | Req → Res |
|---|---|
| `GET /projects` | **Fleet home cards** (FR-F1): per project `{id, path, phase, board: {ready, blocked, done}, berths_running + heartbeat freshness, pending_decide_count, spend_today}` |
| `POST /projects` | register/create/onboard/import a project dir → `{id, path, mode, phase, autonomy, berths}` |
| `POST /projects/{id}/archive` | close the folder (FR-F2 — state stays with the repo dir); reopen via `POST /projects` |
| `GET /projects/{id}` | detail + current run, phase receipts summary, spend snapshot |
| `POST /projects/{id}/runs` | `{mode, phase?, breakpoint: ticket\|wave\|never, berths: 1..N, budget?}` → 202 `{run_id}` (autorun = never × N, D-010) |
| `POST /runs/{id}/pause` | global pause: finish current ticket(s), checkpoint, stop → `{checkpointed_tickets[]}` |
| `POST /runs/{id}/resume` | idempotent receipt-based resume; state drift ⇒ 409 + drift report (FR-H3) |
| `GET /runs/{id}` | status, phase, per-berth activity, breaker state |
| `GET /runs/{id}/trace?ticket=` | session trace: events for replay UI (BLUEPRINT §12.4) |

### tickets — verbs (FR-T1..T4)
| Method+Path | Req → Res |
|---|---|
| `GET /projects/{id}/tickets` | filters `status, lane, type, claimable=true, stale=true` → board projection rows |
| `GET /tickets/{id}` | full contract + manifest + history + evidence + receipts |
| `POST /tickets/{id}/claim` | `{owner?}` → 200 or 409 (WIP=1, hygiene red, deps unmet) |
| `POST /tickets/{id}/start` · `/close` · `/accept` · `/release` | close: manifest + verify 0 + commits or 409; accept: reviewer ≠ owner or 409 (machine-`accept` allowed / merge human-only is a working assumption, pending slate — see docs/DECISIONS.md) |
| `POST /tickets/{id}/comment` | `{body}` → history row (mirrors to forge when connected, D-004) |
| `POST /projects/{id}/tickets` · `PATCH /tickets/{id}` | human DAG edits pre-build (split/merge/reprioritize); schema-validated (lane/scope invariants) or 409 |

### phases, gates, waivers (FR-P1/P2)
| Method+Path | Req → Res |
|---|---|
| `GET /projects/{id}/phases` | per phase: status, deliverables, receipt summary, coverage state |
| `POST /projects/{id}/phases/{n}/gate` | run the phase's validator set → 200 `{receipt_id}` or 422 `{gaps[]}` |
| `GET /receipts/{id}` | structured receipt (gate/close/waiver/challenge/coverage/fitness) |
| `POST /projects/{id}/phases/{n}/waivers` | `{scope, reason, signature}` — human name required; agent identities rejected (SC-05) → waiver receipt |

### decisions & slates (FR-P6)
| Method+Path | Req → Res |
|---|---|
| `GET /projects/{id}/slates?status=open` | open slate cards: options, trade-offs, recommended |
| `POST /slates/{id}/decide` | `{chosen, rationale?}` → appends DECISIONS.md + decisions row → next D-ID |
| `GET /projects/{id}/decisions` | the D-ID ledger |

### clarifications & approvals (FR-N1/N2)
| Method+Path | Req → Res |
|---|---|
| `GET /clarifications?status=open` | question cards (context, options, default-if-unanswered) |
| `POST /clarifications/{id}/answer` | `{answer}` → dependent loop resumes at checkpoint |
| `POST /clarifications/{id}/dismiss` | documented default taken + approvals_ledger row |
| `GET /approvals/queue?project=` | morning queue, sorted by leverage (merges → approvals → clarifications → digests); **aggregates across all projects** by default, filterable per project (FR-F4) |
| `GET /notifications?tier=&project=&status=` | notification center rows, aggregated across projects (FR-F4); Record tier is feed-only (FR-N4) |
| `POST /approvals/{id}/decide` | `{decision: approved\|rejected, note?}` — NEVER-AUTO items require this human path; resumes or re-plans |

### providers, models, fitness (FR-G1/G2; D-007)
| Method+Path | Req → Res |
|---|---|
| `GET /providers` | configured providers + reachability/warm-up state |
| `POST /providers/copilot/device-auth` | start device flow → `{user_code, verification_uri}`; `GET .../device-auth` polls until token stored in vault |
| `POST /providers/vertex` | `{project, location, credentials_path?}` → validates ADC, stores non-secret config |
| `POST /providers/local` | `{kind: lmstudio\|ollama\|openai_compat, base_url}` → discovery + warm-up ping |
| `GET /models` | discovered models + price table + context length |
| `GET/PUT /projects/{id}/model-matrix` | role × task-type grid + fallback chains; presets `all-local` / `hybrid` / `all-cloud` |
| `POST /models/fitness` | `{model, role}` → 202; planted-defect harness → fitness receipt (BLUEPRINT §12.1) |

### budgets & spend (FR-G4)
| Method+Path | Req → Res |
|---|---|
| `GET/PUT /projects/{id}/budget` | per-project and per-run caps (tokens/USD) + breaker thresholds 70/85/100 |
| `GET /projects/{id}/spend?group_by=ticket\|model\|rung&window=` | ledger rollups; answers "what did escalation buy" |

### memory & playbook (FR-M1..M3)
| Method+Path | Req → Res |
|---|---|
| `GET /projects/{id}/memory/facts?q=` | hybrid retrieval (FTS5/BM25 + optional embeddings) |
| `GET /projects/{id}/playbook?task_class=` · `POST …/playbook` · `DELETE …/playbook/{id}` | entries are delta-edited; manual adds marked unverified until confirmed |
| `POST /playbook/{id}/promote` | project entry → **global playbook** with provenance (source project + entry, promoted_by); human/reviewer-gated, never automatic (FR-F5); `GET /playbook/global` lists |

### settings — three scopes, run > project > global (FR-S1..S3; BLUEPRINT §3.10)
| Method+Path | Req → Res |
|---|---|
| `GET /projects/{id}/settings/effective?run=` | every settings key → `{value, winning_scope: run\|project\|global, overridden: [{scope, value}]}` — the "why this value" payload (FR-S1) |
| `GET/PUT /settings/global` | global scope (`~/.shipwright/config.json`): provider registrations by **credential ref** (never secrets — FR-S2), matrix presets, notification prefs + quiet hours, global berth governor |
| `GET/PUT /projects/{id}/settings` | project scope (`.shipwright/settings.json`, safe to commit — FR-S2): matrix overrides, autonomy, budgets, berths default, forge ref, MCP registrations |
| — | run scope has no endpoint: it is the flags on `POST /projects/{id}/runs` |

Every settings PUT appends a `settings.changed` event (FR-S3) — configuration is audited
like execution; changes are visible in the activity feed.

### rules & improvement plans (FR-RL, FR-PLAN — D-014/D-016, added 2026-07-14)
| Method+Path | Req → Res |
|---|---|
| `GET /projects/{id}/rules` | per rule: lifecycle state, measured FP rate + window counts, fixtures present, provenance/license |
| `POST /rules/{id}/promote` · `/demote` | human-confirmed transitions; refused below sample minimums with counts in the 409 (FR-RL2); every transition an event |
| `GET /projects/{id}/findings?state=&rule=` | finding ledger rows incl. funnel counts raw→deduped→effective→suppressed (FR-RL4) |
| `POST /findings/{fingerprint}/suppress` | `{justification (enum), signature}` — human only (SC-05); auto-reopens on context change (FR-RL3) |
| `GET /projects/{id}/plan` | ranked plan items (catalog id, state, verify criterion, linked ticket) — deterministic, LLM-free (FR-PLAN4) |
| `POST /plan-items/{id}/accept` · `/dismiss` | accept may mint a board ticket carrying the item's verify; dismiss requires a note (ledgered) |

### roster & feedback (FR-E2, FR-C8 — added 2026-07-14)
| Method+Path | Req → Res |
|---|---|
| `GET /roster` | every expert: cluster, mode, effective model resolution + winning scope, fitness cards, instruction cost |
| `GET /roster/{agent}/history` | event-derived: HANDOFFs, outcomes, verdict scores (with re-ran-independently evidence), spend, escalations |
| `POST /artifacts/{path}/comments` | inline feedback on a deliverable; on gated deliverables emits `revision.requested` → revision HANDOFF (FR-C8) |

### autonomy
| Method+Path | Req → Res |
|---|---|
| `GET/PUT /projects/{id}/autonomy` | `{mode: interactive\|auto}`; response always includes the immutable `never_auto[]` list (read-only — no endpoint mutates it, SC-10) |
| `GET /projects/{id}/approvals-ledger` | machine-parseable auto-default rows (FR-N3) |

`GET /healthz` — unauthenticated liveness (DB open, WS hub up).

## 3. WS event stream (projections)

`GET /api/v1/ws` (upgrade; token + Origin checked — SC-08). SSE fallback:
`GET /api/v1/events?subscriptions=…&last_seq=` with identical payloads (TECH_STACK
decision). Protocol:

```jsonc
// client → server
{ "op": "subscribe", "subscriptions": ["board:PROJ1", "spend:PROJ1", "notifications", "run:R42", "chat:PROJ1"] }
{ "op": "resume", "last_seq": 10422 }          // replay missed events per subscription
// server → client (one envelope shape)
{ "sub": "board:PROJ1", "seq": 10423, "type": "ticket.closed",
  "at": "2026-07-10T18:20:11Z", "data": { /* projection delta, not raw event payload */ } }
{ "sub": "run:R42", "type": "loop.heartbeat", "data": { "ticket": "W2-04", "pass": "2/3", "age_s": 12 } }
// heartbeats both directions every 15s; 2 missed → close; client reconnects with resume
```

- Subscriptions map to projections (DATABASE.md §3); the server streams **projection
  deltas**, never raw event payloads (agent-internal detail is summarized — BLUEPRINT §7.1).
- Board freshness contract: projection lag ≤1s after the underlying event (NFR-2/FR-C4).
- Correctness never depends on the stream: every subscription has a REST read
  (board = `GET /tickets`, spend = `GET /spend`, …) and clients reconcile on reconnect.

## 4. Canonical shapes (copy exactly — cheap-agent reference)

```jsonc
// List response (every list endpoint)
{ "items": [ /* ... */ ], "next_cursor": null }

// RFC 7807 refusal (verb invariant) — the explain-this-refusal payload
{ "type": "https://shipwright.dev/errors/close-requires-receipt",
  "title": "close refused: verify has not passed",
  "status": 409,
  "detail": "ticket W2-04 verify `pnpm test --filter gateway` exited 1; see evidence",
  "instance": "/api/v1/tickets/W2-04/close",
  "request_id": "req_01J...",
  "rule": "FR-T2", "evidence": { "receipt_id": null, "verify_exit": 1,
  "failure_receipt": "rcpt_9f2..." } }

// Completion Manifest (agent → Harbormaster; embedded in close receipt on success)
{ "ticket": "W2-04", "files": ["packages/gateway/src/router.ts", "..."],
  "verify": { "command": "pnpm test --filter gateway", "exit": 0 },
  "commits": ["a1b2c3d"], "evidence": ["grep: route table covers all 6 roles"] }
```

## 5. Cross-cutting guarantees

- **Route-walker test:** every route × {no token → 401, bad Origin → 403,
  verb w/o Idempotency-Key → 400}.
- **Refusal contract test:** each verb's 409 carries rule name + evidence ref (FR-T4).
- **No self-approval:** `POST /approvals/{id}/decide` and waiver creation reject
  machine-identity actors at the middleware (SC-05) — tested with a seeded berth identity.
- Request ids on every response; every mutation's resulting event seq echoed as
  `X-Event-Seq` (client cache reconciliation).
