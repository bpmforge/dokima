/**
 * Local port types for the task decomposer (BLUEPRINT §4 step 4, FR-T1, US-203).
 *
 * This ticket's write_scope is `packages/pipeline/src/decompose/**` only —
 * `packages/pipeline/package.json` (where a workspace dependency on
 * `@dokima/tickets`/`@dokima/shared` would be declared) is out of
 * glob, same wall `phases/types.ts` documents. So the shapes below mirror
 * `@dokima/tickets`' `Ticket`/`AcceptanceCriterion` field-for-field
 * instead of importing them, and `lanes.ts` carries its own copy of the
 * write_scope glob-overlap check (mirroring `@dokima/shared`'s segment
 * DP — the same move `packages/tickets/src/lanes.ts` made for the git glob
 * dialect). A future wiring ticket that does carry the dependency binds
 * these to the real types with a one-line adapter, never a rewrite.
 */

/** Matches `@dokima/tickets`' `TicketType`. */
export type TicketDraftType = 'epic' | 'story' | 'task' | 'bug';

/** One named export a package's public barrel is expected to carry. */
export interface InterfaceRef {
  readonly packageName: string;
  readonly exportName: string;
}

/**
 * A raw ticket proposal for the DAG, as produced by whatever derives it from
 * the phase-3 design deliverables (an LLM specialist pass, a human edit, or
 * a prior decompose() run being revised). `decompose()` turns an array of
 * these into a validated, lane-annotated `DecomposedPlan` — the seam-lesson
 * fields (`ownPackage`/`importsWorkspacePackages`/`providesInterfaces`/
 * `consumesInterfaces`) exist so the two plan-linter checks (AC2) have
 * something concrete to check against.
 */
export interface TicketDraftInput {
  readonly id: string;
  readonly type: TicketDraftType;
  readonly title: string;
  readonly writeScope: readonly string[];
  readonly dependsOn: readonly string[];
  readonly acceptance: readonly string[];
  /** The executable verify command (FR-T1's `verify`). */
  readonly verify: string;
  /** Workspace package path (e.g. "apps/server") this ticket's deliverable lives
   * in, or null for a doc-only ticket that has no package of its own. */
  readonly ownPackage: string | null;
  /** `@dokima/*` package names this ticket's code imports (seam lesson
   * #1, field report §10 / the W0-08 class: a consumer needs its OWN
   * package.json in write_scope to declare the dependency). */
  readonly importsWorkspacePackages: readonly string[];
  /** Interfaces this ticket owns the public re-export of (seam lesson #2,
   * the W1-02 class: an export that exists but was never re-exported). */
  readonly providesInterfaces: readonly InterfaceRef[];
  /** Interfaces this ticket's code relies on some ticket in the DAG owning
   * the public re-export of. */
  readonly consumesInterfaces: readonly InterfaceRef[];
}

/** Matches `@dokima/tickets`' `AcceptanceCriterion`. */
export interface DecomposedAcceptanceCriterion {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

/** A DAG node: `TicketDraftInput` plus the derived `lane` (FR-T3: lanes come
 * from write-scope disjointness, never a human/LLM guess). Plain data —
 * JSON-serializable, no methods, no hidden state — so a human can edit it
 * (split/merge/re-prioritize, US-203) before feeding a revised draft list
 * back into `decompose()`. */
export interface DecomposedTicket {
  readonly id: string;
  readonly type: TicketDraftType;
  readonly title: string;
  readonly lane: string;
  readonly writeScope: readonly string[];
  readonly dependsOn: readonly string[];
  readonly acceptance: readonly DecomposedAcceptanceCriterion[];
  readonly verify: string;
}

export type LintViolationKind =
  | 'missing-package-json-scope'
  | 'unowned-interface'
  | 'dependency-cycle'
  /** W10-76: a `writeScope` entry that is not a path or glob at all. */
  | 'unpathlike-write-scope';

/** One plan-linter finding (AC2) — surfaced with the DAG, never thrown away silently. */
export interface LintViolation {
  readonly kind: LintViolationKind;
  readonly ticketId: string;
  readonly detail: string;
}

export interface DecomposedPlan {
  readonly tickets: readonly DecomposedTicket[];
  readonly violations: readonly LintViolation[];
  readonly mermaid: string;
}
