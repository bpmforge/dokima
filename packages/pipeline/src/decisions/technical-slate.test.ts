import { describe, expect, it } from 'vitest';
import { InvalidTechnicalSlateError, buildTechnicalSlate } from './technical-slate.js';
import { DESIGN_DIMENSIONS, type DimensionScores } from './types.js';

function dims(fill: string): DimensionScores {
  return Object.fromEntries(DESIGN_DIMENSIONS.map((d) => [d, fill])) as DimensionScores;
}

const OPTION_MINIMAL = {
  label: 'Minimal' as const,
  summary: 'JSON file on disk',
  dimensions: dims('low'),
};
const OPTION_CLEAN = {
  label: 'Clean' as const,
  summary: 'Normalized SQLite schema',
  dimensions: dims('medium'),
};
const OPTION_PRAGMATIC = {
  label: 'Pragmatic' as const,
  summary: 'SQLite, denormalized board view',
  dimensions: dims('medium-high'),
};

const VALID_INPUT = {
  title: 'Ticket board persistence',
  options: [OPTION_MINIMAL, OPTION_CLEAN, OPTION_PRAGMATIC],
  recommendedLabel: 'Pragmatic' as const,
  recommendedConstraint:
    'single-machine local-first install (C1) rules out a server-backed store',
};

describe('buildTechnicalSlate', () => {
  it('accepts exactly 3 options with all 6 dimensions scored', () => {
    const slate = buildTechnicalSlate(VALID_INPUT);
    expect(slate.kind).toBe('technical');
    expect(slate.options.map((o) => o.label)).toEqual(['Minimal', 'Clean', 'Pragmatic']);
    expect(Object.keys(slate.options[0]!.dimensions)).toHaveLength(6);
  });

  it('refuses fewer than 3 options', () => {
    expect(() =>
      buildTechnicalSlate({ ...VALID_INPUT, options: [OPTION_MINIMAL, OPTION_CLEAN] }),
    ).toThrow(InvalidTechnicalSlateError);
  });

  it('refuses more than 3 options', () => {
    expect(() =>
      buildTechnicalSlate({
        ...VALID_INPUT,
        options: [
          OPTION_MINIMAL,
          OPTION_CLEAN,
          OPTION_PRAGMATIC,
          { ...OPTION_MINIMAL, summary: 'dup' },
        ],
      }),
    ).toThrow(InvalidTechnicalSlateError);
  });

  it('refuses a missing required label (duplicate label instead of the third)', () => {
    expect(() =>
      buildTechnicalSlate({
        ...VALID_INPUT,
        options: [OPTION_MINIMAL, OPTION_CLEAN, OPTION_CLEAN],
      }),
    ).toThrow(InvalidTechnicalSlateError);
  });

  it('refuses an option missing a dimension', () => {
    const partial: Record<string, string> = { ...dims('low') };
    delete partial.risk;
    expect(() =>
      buildTechnicalSlate({
        ...VALID_INPUT,
        options: [
          { ...OPTION_MINIMAL, dimensions: partial as DimensionScores },
          OPTION_CLEAN,
          OPTION_PRAGMATIC,
        ],
      }),
    ).toThrow(InvalidTechnicalSlateError);
  });

  it('refuses an option with an unknown dimension key', () => {
    expect(() =>
      buildTechnicalSlate({
        ...VALID_INPUT,
        options: [
          {
            ...OPTION_MINIMAL,
            dimensions: {
              ...dims('low'),
              portability: 'high',
            } as unknown as DimensionScores,
          },
          OPTION_CLEAN,
          OPTION_PRAGMATIC,
        ],
      }),
    ).toThrow(InvalidTechnicalSlateError);
  });

  it('refuses an empty option summary', () => {
    expect(() =>
      buildTechnicalSlate({
        ...VALID_INPUT,
        options: [{ ...OPTION_MINIMAL, summary: '  ' }, OPTION_CLEAN, OPTION_PRAGMATIC],
      }),
    ).toThrow(InvalidTechnicalSlateError);
  });

  it('refuses an empty recommendedConstraint', () => {
    expect(() =>
      buildTechnicalSlate({ ...VALID_INPUT, recommendedConstraint: '' }),
    ).toThrow(InvalidTechnicalSlateError);
  });

  it('recommendation must be tied to a named constraint, not a bare preference', () => {
    expect(() =>
      buildTechnicalSlate({ ...VALID_INPUT, recommendedConstraint: '   ' }),
    ).toThrow(/recommendedConstraint/);
  });
});
