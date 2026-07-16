import { describe, expect, it } from 'vitest';
import { NEVER_AUTO_RISK_CLASSES } from './review-queue-classifier.js';
import { isNeverAutoPauseSite, NEVER_AUTO_PAUSE_SITES } from './autonomy-types.js';

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
});

type PauseSiteKindArray = Array<import('./autonomy-types.js').PauseSiteKind>;
