/**
 * W21-34. The red fixture is the live sentence: a run that landed one ticket
 * and left it in review printed "1 landed, 0 parked (stop: idle)" and stopped
 * talking, and the ticket it landed was one nothing in the product would ever
 * advance.
 */
import { describe, expect, it } from 'vitest';
import { printRunOutcomes, runSummaryLine } from './run-summary.js';

describe('runSummaryLine (W21-34)', () => {
  it('RED FIXTURE: a run that hands work back to a person does not read as unqualified success', () => {
    const line = runSummaryLine('run-1', {
      landed: 1,
      parked: 0,
      awaitingAcceptance: 1,
      stopReason: 'idle',
    });
    expect(line).toContain('1 landed, 0 parked');
    expect(line).toContain('waiting on YOU');
    // Names the verb, the way W21-27 named widen-scope.
    expect(line).toContain('dokima accept');
  });

  it('says WHY nothing will move them — otherwise it reads as a delay, not a decision', () => {
    const line = runSummaryLine('run-1', {
      landed: 2,
      parked: 0,
      awaitingAcceptance: 2,
      stopReason: 'idle',
    });
    expect(line).toContain('maker != verifier');
    expect(line).toContain('tickets are');
  });

  it('nothing waiting is one clean line — no advice nobody needs', () => {
    const line = runSummaryLine('run-1', {
      landed: 1,
      parked: 0,
      awaitingAcceptance: 0,
      stopReason: 'idle',
    });
    expect(line).toBe('run-1 finished: 1 landed, 0 parked (stop: idle)');
    expect(line).not.toContain('dokima accept');
  });

  it('singular and plural are both grammatical — a count of 1 is the commonest case', () => {
    expect(
      runSummaryLine('r', { landed: 1, parked: 0, awaitingAcceptance: 1, stopReason: 'idle' }),
    ).toContain('1 ticket is finished');
    expect(
      runSummaryLine('r', { landed: 3, parked: 0, awaitingAcceptance: 3, stopReason: 'idle' }),
    ).toContain('3 tickets are finished');
  });
});

describe('printRunOutcomes (W21-34)', () => {
  it('prints each ticket, then the summary — the live run 16 shape', () => {
    const lines: string[] = [];
    printRunOutcomes(
      (l) => lines.push(l),
      'run-16',
      [{ ticketId: 'PLAN-vault-001', landed: true, attempts: [{}] }],
      'idle',
      1,
    );
    expect(lines[0]).toBe('PLAN-vault-001: landed after 1 attempt(s)');
    expect(lines[1]).toContain('waiting on YOU');
  });

  it('a parked ticket still names its reason', () => {
    const lines: string[] = [];
    printRunOutcomes(
      (l) => lines.push(l),
      'run-x',
      [{ ticketId: 'T-1', landed: false, parkedReason: 'ladder_exhausted', attempts: [{}, {}] }],
      'idle',
      0,
    );
    expect(lines[0]).toBe('T-1: parked (ladder_exhausted) after 2 attempt(s)');
  });
});
