/**
 * Technical-fork slate construction (R-H1): the design-options discipline
 * productized as the FR-P6 generator for *technical* forks. Always exactly
 * 3 options labelled Minimal/Clean/Pragmatic, compared on the same 6 fixed
 * dimensions every time, with the recommendation tied to a named
 * constraint — never a bare "we recommend Clean" with no reason a founder
 * (or a later reviewer) can hold the agent to.
 */
import {
  DESIGN_DIMENSIONS,
  TECHNICAL_OPTION_LABELS,
  type DesignDimension,
  type DimensionScores,
  type TechnicalOptionLabel,
  type TechnicalSlate,
  type TechnicalSlateOption,
} from './types.js';

export class InvalidTechnicalSlateError extends Error {
  constructor(reason: string) {
    super(
      `invalid technical slate: ${reason} (R-H1 requires exactly 3 options — ` +
        'Minimal/Clean/Pragmatic — scored on all 6 fixed dimensions)',
    );
    this.name = 'InvalidTechnicalSlateError';
  }
}

export interface TechnicalSlateOptionInput {
  readonly label: TechnicalOptionLabel;
  readonly summary: string;
  readonly dimensions: Partial<DimensionScores>;
}

export interface TechnicalSlateInput {
  readonly title: string;
  readonly options: readonly TechnicalSlateOptionInput[];
  readonly recommendedLabel: TechnicalOptionLabel;
  readonly recommendedConstraint: string;
}

function validateDimensions(
  label: TechnicalOptionLabel,
  dimensions: Partial<DimensionScores>,
): DimensionScores {
  const missing: DesignDimension[] = [];
  const extra = Object.keys(dimensions).filter(
    (key) => !(DESIGN_DIMENSIONS as readonly string[]).includes(key),
  );
  for (const dim of DESIGN_DIMENSIONS) {
    const value = dimensions[dim];
    if (value === undefined || value.trim().length === 0) missing.push(dim);
  }
  if (missing.length > 0) {
    throw new InvalidTechnicalSlateError(
      `option "${label}" is missing dimension(s): ${missing.join(', ')}`,
    );
  }
  if (extra.length > 0) {
    throw new InvalidTechnicalSlateError(
      `option "${label}" has unknown dimension(s): ${extra.join(', ')}`,
    );
  }
  return dimensions as DimensionScores;
}

/**
 * Builds a `TechnicalSlate`, enforcing R-H1's fixed 3×6 grid and requiring
 * the recommendation to cite a constraint. Refuses malformed input rather
 * than silently dropping/reordering options — a technical slate that isn't
 * exactly the 3×6 shape isn't a valid instance of the discipline.
 */
export function buildTechnicalSlate(input: TechnicalSlateInput): TechnicalSlate {
  if (input.options.length !== 3) {
    throw new InvalidTechnicalSlateError(
      `got ${input.options.length} options, want exactly 3`,
    );
  }

  const labelsSeen = new Set<TechnicalOptionLabel>();
  const options: TechnicalSlateOption[] = TECHNICAL_OPTION_LABELS.map((label) => {
    const match = input.options.find((o) => o.label === label);
    if (!match) {
      throw new InvalidTechnicalSlateError(`missing the required "${label}" option`);
    }
    labelsSeen.add(match.label);
    if (match.summary.trim().length === 0) {
      throw new InvalidTechnicalSlateError(
        `option "${label}" must have a non-empty summary`,
      );
    }
    return {
      label,
      summary: match.summary,
      dimensions: validateDimensions(label, match.dimensions),
    };
  });

  if (labelsSeen.size !== 3) {
    throw new InvalidTechnicalSlateError(
      'option labels must be exactly Minimal, Clean, and Pragmatic (each once)',
    );
  }
  if (!TECHNICAL_OPTION_LABELS.includes(input.recommendedLabel)) {
    throw new InvalidTechnicalSlateError(
      `unknown recommendedLabel "${input.recommendedLabel}"`,
    );
  }
  if (input.recommendedConstraint.trim().length === 0) {
    throw new InvalidTechnicalSlateError(
      'recommendedConstraint must name the constraint the recommendation is tied to',
    );
  }

  return {
    kind: 'technical',
    title: input.title,
    options,
    recommendedLabel: input.recommendedLabel,
    recommendedConstraint: input.recommendedConstraint,
  };
}
