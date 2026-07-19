/**
 * Decision slate domain types (BLUEPRINT §3.2, FR-P6, R-H1).
 *
 * Two slate shapes, per R-H1's amendment to FR-P6:
 * - Founder-owned forks (name, deployment shape, licensing, irreversible
 *   architecture) keep the free 2–4 option format that shipped with FR-P6.
 * - Technical forks (architecture/design decisions an agent would otherwise
 *   have to guess at) route through the design-options discipline instead:
 *   always exactly 3 options labelled Minimal/Clean/Pragmatic, compared on
 *   6 fixed dimensions, with the recommendation tied to a named constraint.
 *
 * `DecisionRecord` mirrors `docs/DECISIONS.md`'s ledger row shape
 * field-for-field — this package's write_scope
 * (`packages/pipeline/src/decisions/**`) has no reach to `docs/DECISIONS.md`,
 * `apps/server`, or `packages/events`, so ledger persistence here is a pure
 * text transform (`ledger.ts`); the wiring ticket (W5-13) binds it to the
 * real file plus the `decisions` table row.
 */

export interface FounderSlateOption {
  readonly id: string;
  readonly label: string;
  readonly tradeoffs: string;
}

export interface FounderSlate {
  readonly kind: 'founder';
  readonly title: string;
  /** 2–4 options, enforced by `founder-slate.ts`'s `buildFounderSlate`. */
  readonly options: readonly FounderSlateOption[];
  readonly recommendedId: string;
  readonly recommendedReasoning: string;
}

/** R-H1: always exactly these 3 labels, in this order. */
export const TECHNICAL_OPTION_LABELS = ['Minimal', 'Clean', 'Pragmatic'] as const;
export type TechnicalOptionLabel = (typeof TECHNICAL_OPTION_LABELS)[number];

/** R-H1: always exactly these 6 dimensions, in this order. */
export const DESIGN_DIMENSIONS = [
  'time',
  'maintainability',
  'scalability',
  'team-fit',
  'risk',
  'reversibility',
] as const;
export type DesignDimension = (typeof DESIGN_DIMENSIONS)[number];

export type DimensionScores = Readonly<Record<DesignDimension, string>>;

export interface TechnicalSlateOption {
  readonly label: TechnicalOptionLabel;
  readonly summary: string;
  /** One entry per `DESIGN_DIMENSIONS` member — no gaps, no extras. */
  readonly dimensions: DimensionScores;
}

export interface TechnicalSlate {
  readonly kind: 'technical';
  readonly title: string;
  /** Exactly 3 options, one per `TECHNICAL_OPTION_LABELS` member. */
  readonly options: readonly TechnicalSlateOption[];
  readonly recommendedLabel: TechnicalOptionLabel;
  /** Names the constraint the recommendation is tied to (R-H1: never a bare preference). */
  readonly recommendedConstraint: string;
}

export type Slate = FounderSlate | TechnicalSlate;

/** Mirrors `docs/DECISIONS.md`'s ledger row ("ID | Date | Decision | Options considered | Rationale"). */
export interface DecisionRecord {
  /** Stable ID, e.g. `D-021`. */
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly decision: string;
  readonly optionsConsidered: string;
  readonly rationale: string;
}
