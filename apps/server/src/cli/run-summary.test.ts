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

describe('a park reports the reason the product already had (W21-72)', () => {
  function lines(outcomes: Parameters<typeof printRunOutcomes>[2]): string[] {
    const out: string[] = [];
    printRunOutcomes((l) => out.push(l), 'run-1', outcomes, 'idle', 0);
    return out;
  }

  it(
    'RED FIXTURE: a pre-attempt park prints its written reason, not "unknown". ' +
      'Live on run 55 this read "parked (unknown) after 0 attempt(s)" while the ' +
      'ledger held a complete explanation at the same moment',
    () => {
      const [line] = lines([
        {
          ticketId: 'PLAN-vault-002',
          landed: false,
          parkedReason: 'cannot_start',
          parkedDetail:
            'PLAN-vault-002 cannot start: its worktree was created from a different base. Recreating it would discard committed work.',
          attempts: [],
        },
      ]);
      expect(line).toContain('cannot start');
      expect(line).not.toContain('unknown');
      expect(line).toContain('after 0 attempt(s)');
    },
  );

  it('takes the FIRST sentence, because a summary line that wraps stops summarising', () => {
    const [line] = lines([
      {
        ticketId: 'T-1',
        landed: false,
        parkedReason: 'cannot_start',
        parkedDetail: 'The worktree is stale. Neither reusing nor recreating it is the product’s call.',
        attempts: [],
      },
    ]);
    expect(line).toContain('The worktree is stale.');
    expect(line).not.toContain('Neither reusing');
  });

  it('falls back to the enum when a park has no written detail', () => {
    // The ladder's own outcomes are enum-only and must be unchanged.
    const [line] = lines([
      { ticketId: 'T-1', landed: false, parkedReason: 'ladder_exhausted', attempts: [{}, {}] },
    ]);
    expect(line).toBe('T-1: parked (ladder_exhausted) after 2 attempt(s)');
  });

  it('says "reason not recorded" rather than "unknown" if a reason is ever absent', () => {
    // Unreachable for a park this product raises — every path now sets one.
    // It matters for an outcome read back from an OLDER log, where the field
    // genuinely may be missing: "unknown" sounds like the product does not
    // know why it stopped, which is a different and worse claim.
    const [line] = lines([{ ticketId: 'T-1', landed: false, attempts: [] }]);
    expect(line).toContain('reason not recorded');
    expect(line).not.toContain('unknown');
  });

  it('a landed ticket is untouched', () => {
    const [line] = lines([{ ticketId: 'T-1', landed: true, attempts: [{}] }]);
    expect(line).toBe('T-1: landed after 1 attempt(s)');
  });
});
