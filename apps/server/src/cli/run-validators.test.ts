/**
 * W21-38. The founder asked directly whether the product keeps a model honest
 * about the stack it designed. It did not: 83 validators ship in the content
 * pack, DEFAULT_REQUIRED_VALIDATORS is exactly two, and run-build.ts had no
 * path to pass anything else — so there was no way to opt in even knowing the
 * names.
 */
import { describe, expect, it } from 'vitest';
import { resolveRequiredValidators } from './run-validators.js';

const KNOWN = [
  'secrets-scan',
  'validate-remote-parity',
  'validate-tech-stack',
  'validate-deps',
];

describe('resolveRequiredValidators (W21-38)', () => {
  it('RED FIXTURE: a project can require the stack checks that already ship', () => {
    const result = resolveRequiredValidators(
      ['secrets-scan', 'validate-tech-stack', 'validate-deps'],
      KNOWN,
    );
    expect(result).toEqual({
      requiredValidators: ['secrets-scan', 'validate-tech-stack', 'validate-deps'],
    });
  });

  it('unset keeps the built-in set — an install that never touches this is unchanged', () => {
    expect(resolveRequiredValidators(undefined, KNOWN)).toEqual({
      requiredValidators: undefined,
    });
    expect(resolveRequiredValidators(null, KNOWN)).toEqual({
      requiredValidators: undefined,
    });
  });

  it('AN UNKNOWN NAME REFUSES — a validator that silently does nothing is worse than none', () => {
    const result = resolveRequiredValidators(['validate-tech-stak'], KNOWN);
    expect('refusal' in result).toBe(true);
    if (!('refusal' in result)) return;
    expect(result.refusal).toContain('validate-tech-stak');
    expect(result.refusal).toContain('silently does nothing');
    // It says what IS available, so the typo is fixable without a doc hunt.
    expect(result.refusal).toContain('validate-tech-stack');
  });

  it('an EMPTY list refuses — a gate with no validators is a decision, not a default', () => {
    const result = resolveRequiredValidators([], KNOWN);
    expect('refusal' in result).toBe(true);
    if (!('refusal' in result)) return;
    expect(result.refusal).toContain('remove the setting');
  });

  it('a non-list refuses with the shape it wanted', () => {
    const result = resolveRequiredValidators('secrets-scan', KNOWN);
    expect('refusal' in result).toBe(true);
    if (!('refusal' in result)) return;
    expect(result.refusal).toContain('must be a list');
  });

  it('whitespace and blanks are tolerated — a hand-edited settings file is normal', () => {
    expect(resolveRequiredValidators([' secrets-scan ', '', 'validate-deps'], KNOWN)).toEqual({
      requiredValidators: ['secrets-scan', 'validate-deps'],
    });
  });
});
