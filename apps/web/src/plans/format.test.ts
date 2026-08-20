import { describe, expect, it } from 'vitest';
import { canAccept, canDismiss, funnelSummary, scoresVary, STATE_LABEL } from './format.js';

describe('funnelSummary', () => {
  it('renders every FR-RL4-style stage, raw first and never hidden', () => {
    expect(
      funnelSummary({ rawFindings: 5, planItems: 4, accepted: 3, done: 1, regressed: 1 }),
    ).toBe('5 found → 4 planned → 3 accepted → 1 done · 1 regressed');
  });

  it('keeps every stage visible at a count of one (FR-RL4: raw never hidden)', () => {
    expect(
      funnelSummary({ rawFindings: 1, planItems: 1, accepted: 0, done: 0, regressed: 0 }),
    ).toBe('1 found → 1 planned → 0 accepted → 0 done · 0 regressed');
  });
});

describe('canAccept / canDismiss', () => {
  it('accept is offered from proposed and regressed only', () => {
    expect(canAccept('proposed')).toBe(true);
    expect(canAccept('regressed')).toBe(true);
    expect(canAccept('accepted')).toBe(false);
    expect(canAccept('in_progress')).toBe(false);
    expect(canAccept('done')).toBe(false);
  });

  it('dismiss is offered from proposed only (design doc §2 diagram)', () => {
    expect(canDismiss('proposed')).toBe(true);
    expect(canDismiss('accepted')).toBe(false);
    expect(canDismiss('regressed')).toBe(false);
  });
});

describe('STATE_LABEL', () => {
  it('covers every PlanItemState', () => {
    expect(Object.keys(STATE_LABEL).sort()).toEqual(
      ['accepted', 'done', 'in_progress', 'proposed', 'regressed'].sort(),
    );
  });
});


describe('scoresVary (W13-50)', () => {
  const item = (severity: number, leverage: number, rank: number) => ({ severity, leverage, rank });

  it('RED FIXTURE: a creation-run plan — identical scores on every item — renders no scores', () => {
    // The audit's exact case: "severity 3 · leverage 3 · priority score 9"
    // on all 8 cards. Identical numbers cannot rank; showing them is noise
    // wearing authority (UX_AUDIT A-2).
    expect(scoresVary([item(3, 3, 9), item(3, 3, 9), item(3, 3, 9)])).toBe(false);
    expect(scoresVary([item(3, 3, 9)])).toBe(false);
  });

  it('a health-scan plan — scores that differ — shows them, because there they rank', () => {
    expect(scoresVary([item(4, 3, 12), item(2, 3, 6)])).toBe(true);
  });
});
