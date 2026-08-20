/**
 * Local port types for Improvement Plans (BLUEPRINT §6.1 FR-PLAN, D-016,
 * docs/design/IMPROVEMENT_PLANS.md, DATABASE.md §5b).
 *
 * This ticket's write_scope is `packages/pipeline/src/plans/**` +
 * `content/plan-catalog/**` + the `index.ts` barrel only —
 * `packages/pipeline/package.json` (where a workspace dependency on
 * `@dokima/events`/`@dokima/tickets`/`@dokima/loop` would be
 * declared) is out of glob and, per W5-01's empirically-confirmed finding,
 * outside `conductor.config.json`'s `alwaysOk` too (only the *root*
 * package.json is covered). Without a declared dependency pnpm never links
 * the sibling package into this package's `node_modules` (confirmed here:
 * `packages/pipeline/node_modules` has no `@dokima/*` entries after a
 * clean `pnpm install`), so `tsc`/`vitest` cannot resolve a real
 * `@dokima/*` import from this module. Same wall, same fix as
 * `../phases/types.ts`: local interfaces that mirror the real primitives'
 * shapes field-for-field —
 *   - `PlanEvaluationSnapshot` mirrors the read-only inputs FR-PLAN1 names
 *     (receipts, `@dokima/loop`'s `CoverageReport.requiredSkipped`, the
 *     `@dokima/loop` finding ledger / rule FP funnel, board/ticket
 *     stats, spend ledger) — no engine here re-derives those numbers, it
 *     only consumes an already-computed snapshot (the wiring ticket,
 *     W5-15, assembles the real one).
 *   - `BoardTicketDraft` mirrors `@dokima/tickets`' `CreateTicketInput`
 *     (types.ts) field-for-field so `accept()`'s output binds straight into
 *     `createTicket(log, actorId, draft)` with a one-line adapter, never a
 *     rewrite.
 * Nothing here re-implements receipt minting, event appending, or ticket
 * creation — those stay exclusively in `@dokima/events` /
 * `@dokima/tickets` (CLAUDE.md law #6, PLAYBOOK.md "do not cheat the
 * trust machine").
 */

// --- Catalog (FR-PLAN1) -----------------------------------------------------

/** `content/plan-catalog/catalog.v<N>.json` file shape — versioned, data not code. */
export interface CatalogFile {
  readonly version: string;
  readonly provenance: string;
  readonly entries: readonly CatalogEntry[];
}

export interface CatalogEntry {
  readonly id: string;
  /** Deterministic boolean predicate over a `PlanEvaluationSnapshot` dot-path (`expr.ts`). */
  readonly condition: string;
  /** Template string; `{n}` = the condition's primary metric, `{phase}` = snapshot.phase,
   * any other `{a.b.c}` = a literal snapshot dot-path lookup. */
  readonly recommendation: string;
  /** Machine-checkable predicate (same grammar as `condition`) — satisfied means the item is done. */
  readonly verify: string;
  /** 1-5, how bad the underlying condition is. */
  readonly severity: number;
  /** 1-5, how much fixing it unblocks/prevents downstream. */
  readonly leverage: number;
}

export class CatalogValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`plan catalog failed validation:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'CatalogValidationError';
    this.issues = issues;
  }
}

// --- Evaluation snapshot (FR-PLAN1: receipts/coverage/finding-ledger inputs) -----------------

/** Mirrors the subset of `@dokima/events` receipt state a catalog condition can read. */
export interface ReceiptsSnapshot {
  readonly staleCount: number;
}

/** Mirrors `@dokima/loop`'s `CoverageReport` (coverage.ts): `requiredSkipped.length`. */
export interface CoverageSnapshot {
  readonly requiredSkipped: number;
}

/** Mirrors `@dokima/loop`'s finding ledger (findings-types.ts `FindingFunnel` + gate state). */
export interface FindingsSnapshot {
  readonly openCriticalUnwaived: number;
}

/** Mirrors DATABASE.md §5b `rule_state`'s per-rule FP bookkeeping (FR-RL4 funnel). */
export interface RulesSnapshot {
  readonly fpHeavyCount: number;
}

/** Board/ticket stats (`@dokima/tickets` projections). */
export interface TicketsSnapshot {
  readonly oscillatingCount: number;
  readonly blockedWithEvidenceMaxAgeDays: number;
}

/** Spend ledger repeat-threshold-breach count. */
export interface SpendSnapshot {
  readonly thresholdBreachRepeatCount: number;
}

/** Gate-integrity (missing red fixtures) count. */
export interface GatesSnapshot {
  readonly missingRedFixtureCount: number;
}

/** Provider registry ToS-verification count. */
export interface ProvidersSnapshot {
  readonly unverifiedTosCount: number;
}

/** Orphaned phase deliverables (no producing role / never referenced downstream). */
export interface DeliverablesSnapshot {
  readonly orphanedCount: number;
}

/** Self-referential: prior evaluation's plan_items that flipped to `regressed`. */
export interface PlanItemsSnapshot {
  readonly regressedCount: number;
}

/** Fleet global_playbook staleness (DATABASE.md §7). */
export interface PlaybookSnapshot {
  readonly staleEntryCount: number;
}

/**
 * Read-only inputs a catalog `condition`/`verify` predicate can reference by
 * dot path (e.g. `coverage.requiredSkipped`, `phase`). Assembling the real
 * snapshot from live receipts/coverage/finding-ledger/board state is the
 * wiring ticket's job (W5-15) — this engine only consumes it.
 */
export interface PlanEvaluationSnapshot {
  /** Current phase name (BLUEPRINT §3.2), or null when evaluation isn't phase-scoped. */
  readonly phase: string | null;
  readonly receipts: ReceiptsSnapshot;
  readonly coverage: CoverageSnapshot;
  readonly findings: FindingsSnapshot;
  readonly rules: RulesSnapshot;
  readonly tickets: TicketsSnapshot;
  readonly spend: SpendSnapshot;
  readonly gates: GatesSnapshot;
  readonly providers: ProvidersSnapshot;
  readonly deliverables: DeliverablesSnapshot;
  readonly planItems: PlanItemsSnapshot;
  readonly playbook: PlaybookSnapshot;
}

/** One catalog entry whose `condition` evaluated true against a snapshot. */
export interface CatalogMatch {
  readonly catalogId: string;
  /** `recommendation` template with `{n}`/`{phase}`/`{a.b.c}` resolved against the snapshot. */
  readonly recommendation: string;
  readonly verifyCriterion: string;
  readonly severity: number;
  readonly leverage: number;
}

// --- plan_items lifecycle (FR-PLAN2/3, DATABASE.md §5b) ---------------------

export type PlanItemState =
  'proposed' | 'accepted' | 'in_progress' | 'done' | 'regressed';

/** DATABASE.md §5b `plan_items` row. */
export interface PlanItemRecord {
  readonly id: string;
  readonly catalogId: string;
  readonly rank: number;
  readonly state: PlanItemState;
  readonly ticketId: string | null;
  readonly verifyCriterion: string;
  readonly recommendation: string;
  readonly severity: number;
  readonly leverage: number;
  readonly lastVerifiedAt: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly firstSeenAt: string;
  /** Increments each time a `regressed` item is re-accepted (design doc §2 state diagram). */
  readonly attempt: number;
}

export type PlanLifecycleErrorCode =
  'INVALID_TRANSITION' | 'ALREADY_LINKED' | 'MISSING_TICKET_LINK';

export class PlanLifecycleError extends Error {
  readonly code: PlanLifecycleErrorCode;

  constructor(code: PlanLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'PlanLifecycleError';
    this.code = code;
  }
}

/** Mirrors `@dokima/tickets`' `CreateTicketInput` (types.ts) field-for-field. */
export interface BoardTicketDraft {
  readonly id: string;
  readonly type: 'task';
  readonly title: string;
  readonly lane: string;
  readonly writeScope: readonly string[];
  readonly dependsOn: readonly string[];
  readonly acceptance: readonly {
    readonly id: string;
    readonly text: string;
    readonly done: boolean;
  }[];
  /**
   * The ticket's verify COMMAND, or null to fall back to the project's own
   * gate. W13-31: this used to carry the plan item's `verifyCriterion`
   * verbatim, which is a machine-checkable predicate, not a command — and the
   * close gate executes it. FR-PLAN2 is carried by `acceptance` above.
   */
  readonly verify: string | null;
}
