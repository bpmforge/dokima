/**
 * Local port types for the phase machine (BLUEPRINT §3.2, FR-P1/P2/P3/C8, FR-G5).
 *
 * This ticket's write_scope is `packages/pipeline/src/phases/**` only —
 * `packages/pipeline/package.json` (where a workspace dependency on
 * `@dokima/events`/`@dokima/tickets`/`@dokima/validators`/
 * `@dokima/loop` would be declared) is out of glob and not covered by
 * `conductor.config.json`'s `alwaysOk` (confirmed precedent: plan.json notes
 * on the apps/server↔gateway wiring gap hit this identical wall — per-package
 * package.json is neither in a ticket's own write_scope nor the always-ok
 * allowlist, which only covers the *root* package.json). Without a declared
 * dependency, pnpm never links the sibling package into this package's
 * `node_modules` (verified empirically: `packages/pipeline/node_modules`
 * doesn't exist after a clean `pnpm install`, unlike e.g. `packages/loop`,
 * which does declare `@dokima/shared` and gets a real symlink), so
 * `tsc`/`vitest` cannot resolve a real `@dokima/*` import from here.
 *
 * `@dokima/shared`'s own `events/contracts.ts` already establishes the
 * fix for exactly this shape of problem ("packages/shared cannot depend on
 * packages/events ... so this module is the boundary-object home for the
 * envelope shape"): this file plays the same role for the phase machine —
 * local interfaces that mirror the real primitives' shapes field-for-field,
 * so a future wiring ticket (harbormaster/apps-server, which *do* carry the
 * dependency) can bind the real functions in with a one-line adapter, never
 * a rewrite. Nothing here re-implements receipt minting, HMAC verification,
 * or the human/agent waiver-signer check — those stay exclusively in
 * `@dokima/events` (do not duplicate the trust primitive — CLAUDE.md law
 * #6, docs/PLAYBOOK.md "do not cheat the trust machine").
 */

/** The six-phase program (BLUEPRINT §3.2 table). */
export type PhaseId = 0 | 1 | 2 | 3 | 4 | 5;

export interface Deliverable {
  /** Doc path for phases 0–3 (e.g. `docs/SRS.md`); a descriptive id for the
   * ticket-board-shaped phases 4–5 (e.g. `ticket-board`, `release-notes`). */
  readonly id: string;
  /** The specialist role that produces this deliverable (content/experts id). */
  readonly producingRole: string;
}

export interface PhaseDefinition {
  readonly id: PhaseId;
  /** UI name from BLUEPRINT §3.2's phase table. */
  readonly name: string;
  readonly deliverables: readonly Deliverable[];
  /** content/validators names (no `.sh`), always including `validate-mermaid` (R-H3). */
  readonly validators: readonly string[];
  /** FR-G5: soft-gate waivers permitted on phases 0–3 only; false on 4–5. */
  readonly waiverEligible: boolean;
}

/** Mirrors `@dokima/events`' `ReceiptVerificationResult` (receipts.ts). */
export interface ReceiptVerificationResult {
  readonly valid: boolean;
  readonly reasons: readonly string[];
}

/** Mirrors `@dokima/loop`'s `Handoff` (handoff.ts) minus the renderer — the wiring
 * ticket passes this straight into `renderHandoff` once the real type is reachable. */
export interface RevisionHandoff {
  readonly role: string;
  readonly mission: string;
  readonly ticket: { readonly id: string; readonly title: string };
  readonly context: string;
  readonly writeScope: readonly string[];
  readonly produce: readonly string[];
  readonly verify: string;
}

/** Mirrors `@dokima/events`' `EventInput` (types.ts), payload narrowed to FR-C8's shape. */
export interface RevisionRequestedEvent {
  readonly eventType: 'revision.requested';
  readonly actorId: string;
  readonly payload: {
    readonly artifactPath: string;
    readonly phaseId: PhaseId;
    readonly comment: string;
    readonly producingRole: string;
  };
}

export interface PhaseStalenessResult {
  readonly phaseId: PhaseId;
  readonly stale: boolean;
  readonly reasons: readonly string[];
}
