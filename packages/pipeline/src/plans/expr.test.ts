import { describe, expect, it } from 'vitest';
import {
  ExprEvalError,
  ExprSyntaxError,
  evaluatePredicate,
  getPath,
  primaryPath,
} from './expr.js';

const SNAPSHOT = {
  phase: 'Design',
  coverage: { requiredSkipped: 3 },
  rules: { fpRate: 0.61, fpWindowFindings: 25 },
  flags: { orphaned: true },
  label: 'ready',
};

describe('getPath', () => {
  it('resolves nested dot paths', () => {
    expect(getPath(SNAPSHOT, 'coverage.requiredSkipped')).toBe(3);
  });

  it('returns undefined for a missing path', () => {
    expect(getPath(SNAPSHOT, 'coverage.missing.deep')).toBeUndefined();
  });
});

describe('evaluatePredicate — comparisons', () => {
  it('evaluates a numeric > comparison', () => {
    expect(evaluatePredicate('coverage.requiredSkipped > 0', SNAPSHOT)).toBe(true);
    expect(evaluatePredicate('coverage.requiredSkipped > 10', SNAPSHOT)).toBe(false);
  });

  it('evaluates a numeric == comparison', () => {
    expect(evaluatePredicate('coverage.requiredSkipped == 3', SNAPSHOT)).toBe(true);
    expect(evaluatePredicate('coverage.requiredSkipped == 0', SNAPSHOT)).toBe(false);
  });

  it('evaluates a string == comparison with single or double quotes', () => {
    expect(evaluatePredicate("label == 'ready'", SNAPSHOT)).toBe(true);
    expect(evaluatePredicate('label == "ready"', SNAPSHOT)).toBe(true);
    expect(evaluatePredicate("label == 'other'", SNAPSHOT)).toBe(false);
  });

  it('evaluates a bare boolean path', () => {
    expect(evaluatePredicate('flags.orphaned', SNAPSHOT)).toBe(true);
  });

  it('evaluates negation', () => {
    expect(evaluatePredicate('!flags.orphaned', SNAPSHOT)).toBe(false);
  });
});

describe('evaluatePredicate — boolean composition', () => {
  it('evaluates && with correct precedence over ||', () => {
    expect(
      evaluatePredicate('rules.fpRate > 0.6 && rules.fpWindowFindings >= 20', SNAPSHOT),
    ).toBe(true);
    expect(
      evaluatePredicate('rules.fpRate > 0.6 && rules.fpWindowFindings >= 100', SNAPSHOT),
    ).toBe(false);
  });

  it('evaluates || short-circuiting neither side', () => {
    expect(
      evaluatePredicate(
        'coverage.requiredSkipped > 100 || flags.orphaned == true',
        SNAPSHOT,
      ),
    ).toBe(true);
  });

  it('respects parentheses', () => {
    expect(
      evaluatePredicate(
        '(coverage.requiredSkipped > 100 || flags.orphaned == true) && label == "ready"',
        SNAPSHOT,
      ),
    ).toBe(true);
  });
});

describe('evaluatePredicate — error handling', () => {
  it('rejects mismatched types', () => {
    expect(() => evaluatePredicate('coverage.requiredSkipped == "3"', SNAPSHOT)).toThrow(
      ExprEvalError,
    );
  });

  it('rejects a non-boolean bare operand (no implicit truthiness)', () => {
    expect(() => evaluatePredicate('coverage.requiredSkipped', SNAPSHOT)).toThrow(
      ExprEvalError,
    );
  });

  it('rejects malformed syntax', () => {
    expect(() => evaluatePredicate('coverage.requiredSkipped >', SNAPSHOT)).toThrow(
      ExprSyntaxError,
    );
    expect(() => evaluatePredicate('(coverage.requiredSkipped > 0', SNAPSHOT)).toThrow(
      ExprSyntaxError,
    );
  });

  it('rejects unexpected characters', () => {
    expect(() => evaluatePredicate('coverage.requiredSkipped > 0 @', SNAPSHOT)).toThrow(
      ExprSyntaxError,
    );
  });
});

describe('primaryPath', () => {
  it('returns the leftmost path in a simple comparison', () => {
    expect(primaryPath('coverage.requiredSkipped > 0')).toBe('coverage.requiredSkipped');
  });

  it('returns the leftmost path across && / ||', () => {
    expect(primaryPath('rules.fpRate > 0.6 && rules.fpWindowFindings >= 20')).toBe(
      'rules.fpRate',
    );
  });

  it('returns null when the expression has no path', () => {
    expect(primaryPath('true')).toBeNull();
  });
});
