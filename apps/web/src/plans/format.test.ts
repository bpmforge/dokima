import { describe, expect, it } from 'vitest';
import { canAccept, canDismiss, funnelSummary, STATE_LABEL } from './format.js';

describe('funnelSummary', () => {
  it('renders every FR-RL4-style stage, raw first and never hidden', () => {
    expect(
      funnelSummary({ rawFindings: 5, planItems: 4, accepted: 3, done: 1, regressed: 1 }),
    ).toBe('5 raw → 4 plan items → 3 accepted → 1 done / 1 regressed');
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
