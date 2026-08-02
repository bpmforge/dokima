# Dokima — Database Design (SQLite WAL, per project)

Traces to: BLUEPRINT.md §2.3/§3.4/§3.8/§3.10/§3.11, ARCHITECTURE.md §3/§4 law 4/§6,
DECISIONS.md D-003 (SQLite WAL), D-005 (identity model), D-013 (Fleet). One database file
per project: **`.dokima/state.db`** (gitignored — state travels with the repo dir,
FR-F2); the fleet-level global registry lives in `~/.dokima/` (§7) and holds no
project state. Conventions: `snake_case`; PKs
`INTEGER PRIMARY KEY` (rowid) unless noted; timestamps ISO-8601 TEXT (UTC); JSON columns
are TEXT validated by zod contracts in `packages/shared` at the `events` API boundary.

## 1. WAL + single writer (constraint C6)

- `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`.
- **Exactly one writer**: the core server process (`packages/events` is the only module
  that opens a writable connection — ARCHITECTURE §4 law 4). better-sqlite3's synchronous
  API makes append + projection update a single atomic `db.transaction()` — there is no
  interleaving window between invariant check and event append, which is what makes ticket
  verbs and berth claims race-free without locks (ARCHITECTURE §5).
- WAL allows concurrent **readers**: the CLI and any external tooling open read-only
  connections. Rationale: local-first, crash-safe, one copyable file, zero server deps.

## 2. Source of truth — event log & identities

**events** — append-only, hash-chained (ARCHITECTURE §3, SC-11).
`seq INTEGER PK, event_type TEXT, actor_id FK identities, ticket_id TEXT NULL,
run_id TEXT NULL, payload TEXT(JSON), created_at, prev_hash TEXT, hash TEXT`.
INSERT-only: `BEFORE UPDATE` / `BEFORE DELETE` triggers `RAISE(ABORT)` — tamper attempts
fail at the DB layer and chain verification catches file-level edits.
Index: `(event_type, seq)`, `(ticket_id, seq)`, `(run_id, seq)`.

**identities** — every event has an actor (D-005: schema is multi-user-ready from W0;
v1 runs single-operator).
`id TEXT PK, name TEXT, kind TEXT CHECK(kind IN ('human','machine')),
auth_provider TEXT NULL (v1: 'local'; v2: 'oidc'|'saml'|…), role TEXT
('operator'|'maker'|'reviewer'|'berth'), model_hint TEXT NULL, created_at`.
Seeded rows: the human operator, `dokima-maker`, `dokima-reviewer`, plus one
machine identity per berth as berths are created (D-010). Reviewer ≠ maker identity is
what `accept` checks (BLUEPRINT §3.4).

**receipts** — the durable anchors (never derivable, so not a projection).
`id TEXT PK, kind TEXT ('gate'|'close'|'waiver'|'challenge'|'coverage'|'fitness'),
project_id, phase INTEGER NULL, ticket_id TEXT NULL, validators TEXT(JSON: [{name,
exit_code, gap_count}]), input_tree_hash TEXT, verify_command TEXT NULL,
verify_exit INTEGER NULL, signed_by FK identities NULL (waivers: human only, SC-05),
payload TEXT(JSON), created_at`. Every receipt mint also appends a `gate.receipt_minted`
event carrying the receipt id — the chain proves *when*, the row holds *what*.

## 3. Projection tables (rebuildable from the log)

Maintained transactionally with their source events; `dokima rebuild-projections`
regenerates all of them — a projection is never the only copy of anything except as noted.

**tickets** — contract layer + live status (BLUEPRINT §3.4). Contract fields arrive in
the `ticket.created` payload; lifecycle fields fold in subsequent events.
`id TEXT PK ('W2-04'), type TEXT ('epic'|'story'|'task'|'bug'), title TEXT, lane TEXT,
owner_id FK identities NULL, status TEXT ('ready'|'claimed'|'in_progress'|'in_review'|
'blocked'|'done'|'waived'), interface TEXT, write_scope TEXT(JSON: glob[]),
depends_on TEXT(JSON: id[]), acceptance TEXT(JSON: [{id, text, done}]),
verify TEXT (command that must exit 0 to close), manifest TEXT(JSON NULL: files[],
verify_result, commits[], receipt_id), history TEXT(JSON: verb log incl. queued forge
mirror writes — D-004 offline queue), evidence TEXT(JSON: failure receipts, escalation
trail), claimed_at TEXT NULL, closed_at TEXT NULL`.
Indexes: `(status, lane)`, `(owner_id, status)` (WIP=1 check).

**board** — derived claimability + UI flags, recomputed on every event (reflow).
`ticket_id PK FK tickets, claimable INTEGER (ready ∧ unowned ∧ deps done),
stale_blocked INTEGER (blocked but blockers all done — badge), wave INTEGER,
sort_key TEXT`.

**runs** — pipeline/build executions.
`id TEXT PK, project_id, mode TEXT ('new_product'|'onboard'|'feature'|'improve'),
phase INTEGER NULL, status TEXT ('running'|'paused'|'suspended'|'done'|'stopped'),
breakpoint TEXT ('ticket'|'wave'|'never'), berths INTEGER DEFAULT 1, budget_usd REAL NULL,
budget_tokens INTEGER NULL, started_at, ended_at NULL`.

**budget_ledger** — one row per model call (projection of `model.call_completed`).
`id PK, run_id, ticket_id NULL, role TEXT, task_type TEXT ('reasoning'|'code'|
'verification'|'embed'|'escalation'), provider TEXT, model TEXT, rung TEXT ('R0'..'R4'),
tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL (local = 0, still metered),
duration_ms INTEGER, at TEXT`. Index `(run_id, at)`, `(ticket_id)`.

**spend** — rollups for meters/breakers: `scope TEXT ('project'|'run'|'day'),
scope_id TEXT, tokens INTEGER, cost_usd REAL, threshold_state TEXT
(NULL|'warn70'|'downshift85'|'stopped100'), updated_at`; PK `(scope, scope_id)`.

**notifications** — the taxonomy is code, not convention (FR-N4).
`id PK, tier TEXT CHECK(tier IN ('decide','review','record')), kind TEXT
('clarification'|'approval'|'blocked'|'budget'|'pr_ready'|'gate_passed'|'digest'|'drift_report'),
— closed enum; adding a kind is a migration + FR-N4 tier-declaration review, never an inline string,
ref_type TEXT, ref_id TEXT, title TEXT, body TEXT(JSON card), leverage INTEGER
(morning-queue sort — merges rank highest), status TEXT ('open'|'done'|'dismissed'),
created_at, resolved_at NULL`. Index `(tier, status, leverage DESC)`.

## 4. HITL & governance tables

**decisions** — the D-ID ledger (FR-P6); DB mirror of `docs/DECISIONS.md` (the markdown
file in the repo remains the human-readable canonical; slate resolution writes both).
`id TEXT PK ('D-001'), title TEXT, options TEXT(JSON: [{label, tradeoffs,
recommended}]), chosen TEXT, rationale TEXT, decided_by FK identities, decided_at`.

**clarifications** (FR-N1) — `id PK, run_id, ticket_id NULL, asked_by FK identities,
question TEXT, context TEXT(JSON), options TEXT(JSON NULL), default_action TEXT,
status TEXT ('open'|'answered'|'dismissed'), answer TEXT NULL, checkpoint_ref TEXT
(resume point), created_at, resolved_at NULL`.

**approvals_ledger** (FR-N3) — append-only like events (same trigger guard).
`id PK, run_id NULL, pause_site TEXT, risk_class TEXT ('deploy'|'main-merge'|
'destructive'|'escalation'|'budget'), mode TEXT ('interactive'|'auto'),
default_taken TEXT NULL (auto mode: what was decided + what you would have been asked),
decided_by FK identities NULL, human_signature TEXT NULL (required for NEVER-AUTO;
agent-name blocklist enforced — SC-05/SC-10), decision TEXT ('approved'|'rejected'|
'auto-default'), created_at`.

## 5. Memory & learning (BLUEPRINT §3.8)

**facts** — long-term memory. `id PK, kind TEXT ('fact'|'error_solution'|'decision_ref'|
'research'), content TEXT, source TEXT (citation), confidence REAL, verified INTEGER
(challenger/tool-confirmed — only verified facts enter R0), ticket_id NULL, phase NULL,
created_at, last_used_at, use_count INTEGER, decayed INTEGER DEFAULT 0`.
**facts_fts** — FTS5 virtual table (`content=facts`) — BM25 retrieval baseline; optional
embedding BLOB column on facts when a local embed model is configured (hybrid retrieval).

**playbook** — ACE-style entries, delta-edited never replaced (FR-M2).
`id PK, task_class TEXT, entry TEXT, version INTEGER, verified_by TEXT
('tool'|'challenger'), delta_of INTEGER NULL self-FK, created_at, retired_at NULL`.
Index `(task_class, retired_at)` — R0 lookup path.

**calibration** — per-(model, phase) confidence bias (FR-L3).
`model TEXT, phase TEXT, bias REAL (rescue-only, clamped ≥0 ≤MAX_BIAS),
sample_count INTEGER (min-sample gated), mean_verified_conf REAL, updated_at`;
PK `(model, phase)`.

Consolidation (sleep-time job) rewrites facts/playbook via ordinary events
(`memory.consolidated`) so even memory mutations are audited.

## 5b. Rule lifecycle, findings & plans (D-014/D-016, added 2026-07-14)

**rule_state** — lifecycle per validator/gate rule (FR-RL1/2).
`rule_id TEXT PK, state TEXT CHECK(state IN ('proposed','shadow','advisory','gate',
'deprecated')), fp_window_findings INTEGER, fp_window_fps INTEGER, fp_rate REAL
(derived), promoted_at TEXT NULL, demotion_flagged INTEGER DEFAULT 0, updated_at`.
State transitions are events (`rule.state_changed`, human actor required).

**findings** — the finding ledger (FR-L6, W3-08).
`id TEXT PK ('F-<ticket>-<n>'), fingerprint TEXT (hash(file, category, normalized
issue)), ticket_id, rule_id NULL, severity, file, issue, fix_hint, state TEXT
CHECK(state IN ('OPEN','FIX_ATTEMPTED','RESOLVED','REGRESSED','SUPPRESSED')),
attempts INTEGER, free_retries INTEGER (infra events — never attempts),
experimental INTEGER DEFAULT 0 (shadow-rule findings, FR-RL1), first_seen_pass,
history TEXT(JSON: [(pass, state, evidence, reran_independently)]), created_at`.
Index `(ticket_id, state)`, `(fingerprint)`, `(rule_id, state)` — the FP metric input.

**suppressions** — justification-gated (FR-RL3; waiver machinery at finding grain).
`id PK, fingerprint TEXT, rule_id, justification TEXT CHECK(justification IN
('false_positive','not_applicable_scope','accepted_risk','fixed_elsewhere',
'wont_fix_documented')), signed_by FK identities (human only, SC-05), context_key
TEXT (rule version + file hash + dep version), status TEXT ('active'|'reopened'),
created_at, reopened_at NULL`. Reopen is automatic on context_key mismatch.

**plan_items** — Improvement Plans (FR-PLAN1–3, W5-10/11).
`id PK, catalog_id TEXT (versioned catalog entry), rank INTEGER (deterministic),
state TEXT CHECK(state IN ('proposed','accepted','in_progress','done','regressed')),
ticket_id TEXT NULL (minted on accept), verify_criterion TEXT (machine-checkable),
last_verified_at, evidence TEXT(JSON), created_at`. Nightly auto-verify writes
`plan.item_verified` events; regressions emit Review-tier notifications.

## 6. Provider/config tables (per project)

**model_matrix** — `role TEXT, task_type TEXT, model TEXT, fallback TEXT(JSON: chain[]),
PK (role, task_type)` — the *project-scope override* of the global preset; effective
matrix = run > project > global resolution (FR-S1, BLUEPRINT §3.10).
Provider *credentials are never in any DB or settings file* — secrets live in the OS
keychain under named refs (SC-06, FR-S2); settings files store the refs, which is what
makes `.dokima/settings.json` safe to commit.

## 7. Global registry — `~/.dokima/global.db` (Fleet scope, D-013)

Fleet-level data that is project-independent by definition (ARCHITECTURE §6). Same
engine, same discipline (WAL, single writer = the core process, additive-first
migrations). Tables:

- **projects** — the Fleet index (FR-F1/F2): `id TEXT PK, path TEXT UNIQUE, name TEXT,
  archived INTEGER DEFAULT 0, last_opened_at, created_at`. Card *stats* (phase, board
  counts, spend today, pending Decide) are read live from each project's `state.db` —
  never cached here, so the registry can't lie about a project it hasn't opened.
- **providers** — non-secret provider registry (register Copilot once, use everywhere —
  FR-F3): `id TEXT PK, kind TEXT, base_url TEXT NULL, project TEXT NULL,
  location TEXT NULL, credential_ref TEXT (keychain name — FR-S2), status, created_at`.
- **global_playbook** — promoted entries (FR-F5): playbook columns from §5 **plus
  provenance**: `promoted_from_project TEXT, source_entry_id INTEGER, promoted_by FK-name
  (human or reviewer identity — never automatic), promoted_at`. Consulted at R0 for every
  project; per-project entries stay in their own `state.db` (§5). Promotion appends a
  `playbook.promoted` event to the source project's log.
- **model_fitness** — fitness cards (BLUEPRINT §12.1) are per (model, role), not per
  project: `model TEXT, role TEXT, verdict TEXT ('fit'|'unfit'|'marginal'),
  harness_version TEXT, receipt_payload TEXT(JSON), run_at`;
  PK `(model, role, harness_version)`.

Settings *files* (global `~/.dokima/config.json`, project
`.dokima/settings.json`) stay file-backed and inspectable per BLUEPRINT §3.10 — the
DBs never duplicate them; settings changes are audited as `settings.changed` events
(FR-S3) in the affected project's log (global-scope changes log to every open project's
feed by reference).

## 8. Migrations

- Numbered SQL files in `packages/events/migrations/NNN_name.sql`; applied in order inside
  a transaction on DB open; `PRAGMA user_version` tracks position. Forward-only — no down
  migrations; a pre-migration backup copy of `state.db` is written to
  `.dokima/backups/` first (DEPLOYMENT.md §4).
- **Additive-first**: new columns nullable-or-defaulted; renames = add + backfill + drop
  across separate releases.
- **Event payloads are versioned independently** of tables: each `event_type` payload
  schema carries a `v` field; readers upcast old versions in `packages/events` — the log
  is never rewritten (append-only survives every upgrade).
- Projection-shape changes need no data migration: bump projection version → rebuild from
  the log on first open (§3).
- CI gate: migrations applied to a scratch DB + full test suite + `audit verify` on a
  seeded chained log.
