/**
 * Decision slate domain + wire types (FR-P6, R-H1, API_DESIGN.md "decisions
 * & slates"). Mirrors `@shipwright/pipeline`'s `Slate` shape and
 * `apps/server/src/api/decisions/routes.ts`'s `toWire` snake_case payload —
 * apps/web has no dependency on `@shipwright/pipeline` or `apps/server`
 * (out of this ticket's write_scope to add one, same as
 * `artifacts/deliverablePhase.ts` mirroring pipeline's phase topology for
 * W5-12), so this module owns its own copy rather than importing either.
 */

export interface FounderSlateOption {
  readonly id: string;
  readonly label: string;
  readonly tradeoffs: string;
}

export interface FounderSlate {
  readonly kind: 'founder';
  readonly title: string;
  /** 2–4 options, enforced server-side by `buildFounderSlate`. */
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
  readonly recommendedConstraint: string;
}

export type Slate = FounderSlate | TechnicalSlate;

export type SlateStatus = 'open' | 'decided';

/** `apps/server/src/api/decisions/routes.ts`'s `toWire` shape. */
export interface SlateRecord {
  id: string;
  status: SlateStatus;
  slate: Slate;
  chosen: string | null;
  rationale: string | null;
  d_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

/** `POST /api/v1/slates/:id/decide`'s response body. */
export interface DecisionResult {
  id: string;
  d_id: string;
  date: string;
  decision: string;
  options_considered: string;
  rationale: string;
}
