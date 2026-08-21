/**
 * W17-01 (FR-L3): the starting budget shrinks for an over-claimer, never
 * grows, and stays put with no history — downward only, by construction.
 */
import { describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, listEvents, openEventLog } from '@dokima/events';
import { calibratedBaseIterations, sizedBaseIterations } from './run-build-budget.js';

describe('calibratedBaseIterations (W17-01)', () => {
  it('no record, or a clean record, leaves the base untouched', () => {
    expect(calibratedBaseIterations(12, undefined)).toBe(12);
    expect(calibratedBaseIterations(12, { bias: 0, sampleCount: 20 })).toBe(12);
  });

  it('RED FIXTURE: an over-claiming record SHRINKS the base and can never enlarge it', () => {
    const shrunk = calibratedBaseIterations(12, { bias: 0.3, sampleCount: 9 });
    expect(shrunk).toBeLessThan(12);
    expect(shrunk).toBeGreaterThanOrEqual(4);
    // Even an absurd bias never inflates or goes below the floor.
    expect(calibratedBaseIterations(12, { bias: 5, sampleCount: 9 })).toBe(6);
    expect(calibratedBaseIterations(6, { bias: 0.5, sampleCount: 9 })).toBe(4);
  });
});

describe('the raised-budget retry teaches the calibrator (W19-02)', () => {
  const completed = (turns: number) => ({ model: 'm1', turns, completed: true });
  const parked = (turns: number) => ({ model: 'm1', turns, completed: false });

  function seededLog(observations: readonly object[]) {
    const log = openEventLog(':memory:');
    createIdentity(log, { id: 'operator', name: 'operator', kind: 'human' });
    for (const payload of observations) {
      appendEvent(log, {
        eventType: 'session.turns_observed',
        actorId: 'operator',
        payload: payload as never,
      });
    }
    return log;
  }

  it('RED FIXTURE: park at 12 → raise → three retries CLOSE around 18 turns → the next run starts near what actually worked, not back at 12', () => {
    const log = seededLog([parked(12), parked(12), completed(18), completed(20), completed(17)]);
    try {
      const sized = sizedBaseIterations(log, 'm1', {
        actorId: 'operator',
        runId: 'r1',
      });
      expect(sized).toBeGreaterThanOrEqual(18);
      expect(sized).toBeLessThanOrEqual(40);
      // The profile is ledgered with the samples it was computed from.
      const profile = listEvents(log).find(
        (e) => e.eventType === 'session.budget_profile',
      );
      expect((profile?.payload as { samples: number }).samples).toBe(3);
    } finally {
      log.close();
    }
  });

  it('re-parking never inflates: a history of budget stops alone leaves the default untouched', () => {
    const log = seededLog([parked(12), parked(12), parked(20), parked(20), parked(20)]);
    try {
      expect(
        sizedBaseIterations(log, 'm1', { actorId: 'operator', runId: 'r1' }),
      ).toBe(12);
      expect(
        listEvents(log).some((e) => e.eventType === 'session.budget_profile'),
      ).toBe(false);
    } finally {
      log.close();
    }
  });
});
