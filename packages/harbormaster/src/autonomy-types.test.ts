import { describe, expect, it } from 'vitest';
import { NEVER_AUTO_RISK_CLASSES } from './review-queue-classifier.js';
import {
  ALL_PAUSE_SITE_KINDS,
  isNeverAutoPauseSite,
  isPauseSiteKind,
  NEVER_AUTO_PAUSE_SITES,
  type PauseSiteKind,
} from './autonomy-types.js';

describe('NEVER_AUTO_PAUSE_SITES (CONSTRAINTS.md C-5, SC-10)', () => {
  it('is frozen — no in-place mutation pathway exists', () => {
    expect(Object.isFrozen(NEVER_AUTO_PAUSE_SITES)).toBe(true);
    expect(() => {
      (NEVER_AUTO_PAUSE_SITES as unknown as PauseSiteKindArray).push('escalation');
    }).toThrow(TypeError);
  });

  it('extends W3-05s NEVER_AUTO_RISK_CLASSES rather than duplicating it', () => {
    for (const riskClass of NEVER_AUTO_RISK_CLASSES) {
      expect(NEVER_AUTO_PAUSE_SITES).toContain(riskClass);
    }
  });

  it('includes interview — the one C-5 item no ActionDescriptor can express', () => {
    expect(NEVER_AUTO_PAUSE_SITES).toContain('interview');
  });

  it('does not include clarification/escalation/budget — those are auto-eligible', () => {
    expect(NEVER_AUTO_PAUSE_SITES).not.toContain('clarification');
    expect(NEVER_AUTO_PAUSE_SITES).not.toContain('escalation');
    expect(NEVER_AUTO_PAUSE_SITES).not.toContain('budget');
  });
});

describe('isNeverAutoPauseSite', () => {
  it('classifies every NEVER_AUTO_PAUSE_SITES entry as never-auto', () => {
    for (const site of NEVER_AUTO_PAUSE_SITES) {
      expect(isNeverAutoPauseSite(site)).toBe(true);
    }
  });

  it('classifies clarification as auto-eligible', () => {
    expect(isNeverAutoPauseSite('clarification')).toBe(false);
  });

  it('fails closed for a value that is not a recognized PauseSiteKind — a typo, wrong case, or forged string is never auto-eligible', () => {
    const forged = 'Deploy ' as unknown as PauseSiteKind; // wrong case + trailing space, not the real 'deploy'
    expect(isNeverAutoPauseSite(forged)).toBe(true);
    expect(isNeverAutoPauseSite('destructiv' as unknown as PauseSiteKind)).toBe(true);
    expect(isNeverAutoPauseSite('' as unknown as PauseSiteKind)).toBe(true);
  });
});

describe('isPauseSiteKind', () => {
  it('accepts every ALL_PAUSE_SITE_KINDS entry', () => {
    for (const site of ALL_PAUSE_SITE_KINDS) {
      expect(isPauseSiteKind(site)).toBe(true);
    }
  });

  it('rejects a typo, wrong case, stray whitespace, or non-string value', () => {
    expect(isPauseSiteKind('Deploy')).toBe(false);
    expect(isPauseSiteKind('deploy ')).toBe(false);
    expect(isPauseSiteKind('destructiv')).toBe(false);
    expect(isPauseSiteKind('')).toBe(false);
    expect(isPauseSiteKind(null)).toBe(false);
    expect(isPauseSiteKind(undefined)).toBe(false);
    expect(isPauseSiteKind(42)).toBe(false);
  });
});

type PauseSiteKindArray = Array<import('./autonomy-types.js').PauseSiteKind>;
