import { describe, expect, it } from 'vitest';
import { CostLedger } from './ledger.js';
import { BudgetBreakerTracker, policyForLevel, readBreaker } from './breakers.js';
import { createInMemoryBudgetEventSink } from './events.js';
import type { LedgerEntry } from './types.js';

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    projectId: 'proj-1',
    runId: 'run-1',
    ticketId: 'W2-07',
    berthId: 'berth-1',
    costUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    model: 'claude-opus-4-8',
    recordedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('readBreaker', () => {
  it('is ok with no spend', () => {
    const ledger = new CostLedger();
    const reading = readBreaker(ledger, 'proj-1', 'run-1', { runLimitUsd: 10 });
    expect(reading).toEqual({
      level: 'ok',
      scope: undefined,
      ratio: 0,
      runSpentUsd: 0,
      projectSpentUsd: 0,
    });
  });

  it('never trips with no limits configured, however much is spent', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 1_000_000 }));
    const reading = readBreaker(ledger, 'proj-1', 'run-1', {});
    expect(reading.level).toBe('ok');
    expect(reading.ratio).toBe(0);
  });

  it('warns at exactly 70% of the run limit', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 7 }));
    const reading = readBreaker(ledger, 'proj-1', 'run-1', { runLimitUsd: 10 });
    expect(reading.level).toBe('warn');
    expect(reading.scope).toBe('run');
    expect(reading.ratio).toBeCloseTo(0.7);
  });

  it('stays ok just under 70%', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 6.99 }));
    const reading = readBreaker(ledger, 'proj-1', 'run-1', { runLimitUsd: 10 });
    expect(reading.level).toBe('ok');
  });

  it('downshifts at exactly 85%', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 8.5 }));
    const reading = readBreaker(ledger, 'proj-1', 'run-1', { runLimitUsd: 10 });
    expect(reading.level).toBe('downshift');
  });

  it('hard-stops at exactly 100%', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 10 }));
    const reading = readBreaker(ledger, 'proj-1', 'run-1', { runLimitUsd: 10 });
    expect(reading.level).toBe('hard_stop');
  });

  it('hard-stops past 100% too', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 15 }));
    const reading = readBreaker(ledger, 'proj-1', 'run-1', { runLimitUsd: 10 });
    expect(reading.level).toBe('hard_stop');
  });

  it('picks whichever of run/project ratio is worse', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 9 })); // 90% of run limit, 9% of project limit
    const reading = readBreaker(ledger, 'proj-1', 'run-1', {
      runLimitUsd: 10,
      projectLimitUsd: 100,
    });
    expect(reading.level).toBe('downshift');
    expect(reading.scope).toBe('run');
  });

  it('a tight project limit can trip the breaker even when the run limit is fine', () => {
    const ledger = new CostLedger();
    ledger.record(entry({ costUsd: 9 })); // 9% of run limit, 90% of project limit
    const reading = readBreaker(ledger, 'proj-1', 'run-1', {
      runLimitUsd: 100,
      projectLimitUsd: 10,
    });
    expect(reading.level).toBe('downshift');
    expect(reading.scope).toBe('project');
  });
});

describe('policyForLevel', () => {
  it('ok: no constraints', () => {
    expect(policyForLevel('ok')).toEqual({
      skipOptionalPasses: false,
      preferCheaperRungs: false,
      canClaimNewTicket: true,
    });
  });

  it('warn: no constraints yet (70% is Record-tier ledger only, UC-05 step 1)', () => {
    expect(policyForLevel('warn')).toEqual({
      skipOptionalPasses: false,
      preferCheaperRungs: false,
      canClaimNewTicket: true,
    });
  });

  it('downshift: skips optional passes, prefers cheaper rungs, still claims new tickets', () => {
    expect(policyForLevel('downshift')).toEqual({
      skipOptionalPasses: true,
      preferCheaperRungs: true,
      canClaimNewTicket: true,
    });
  });

  it('hard_stop: fully constrained, no new ticket claims', () => {
    expect(policyForLevel('hard_stop')).toEqual({
      skipOptionalPasses: true,
      preferCheaperRungs: true,
      canClaimNewTicket: false,
    });
  });
});

describe('BudgetBreakerTracker', () => {
  it('ledgers exactly one threshold_crossed event the instant spend crosses 70%, never again', async () => {
    const ledger = new CostLedger();
    const sink = createInMemoryBudgetEventSink();
    const tracker = new BudgetBreakerTracker(
      ledger,
      { runLimitUsd: 10 },
      sink,
      () => 't',
    );

    await tracker.record(entry({ costUsd: 6 })); // 60% — ok
    expect(sink.events).toHaveLength(0);

    await tracker.record(entry({ costUsd: 1 })); // 70% — crosses warn
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      type: 'budget.threshold_crossed',
      tier: 'record',
      thresholdPct: 70,
      scope: 'run',
      spentUsd: 7,
      limitUsd: 10,
    });
    expect(sink.events[0]!.approvalCard).toBeUndefined();

    await tracker.record(entry({ costUsd: 0.5 })); // 75% — still warn, no new event
    expect(sink.events).toHaveLength(1);
  });

  it('ledgers downshift at 85% and hard_stop with an approval card at 100%', async () => {
    const ledger = new CostLedger();
    const sink = createInMemoryBudgetEventSink();
    const tracker = new BudgetBreakerTracker(
      ledger,
      { runLimitUsd: 10 },
      sink,
      () => 't',
    );

    await tracker.record(entry({ costUsd: 7 })); // warn
    await tracker.record(entry({ costUsd: 1.5 })); // 85% — downshift
    expect(sink.events).toHaveLength(2);
    expect(sink.events[1]).toMatchObject({
      type: 'budget.downshift',
      tier: 'record',
      thresholdPct: 85,
    });
    expect(sink.events[1]!.approvalCard).toBeUndefined();

    await tracker.record(entry({ costUsd: 1.5 })); // 100% — hard_stop
    expect(sink.events).toHaveLength(3);
    const hardStop = sink.events[2]!;
    expect(hardStop).toMatchObject({
      type: 'budget.hard_stop',
      tier: 'decide',
      thresholdPct: 100,
    });
    expect(hardStop.approvalCard).toMatchObject({
      riskClass: 'budget',
      projectId: 'proj-1',
      runId: 'run-1',
      scope: 'run',
      spentUsd: 10,
      limitUsd: 10,
    });
  });

  it('a single entry that jumps past every threshold still ledgers each one, in order, once', async () => {
    const ledger = new CostLedger();
    const sink = createInMemoryBudgetEventSink();
    const tracker = new BudgetBreakerTracker(
      ledger,
      { runLimitUsd: 10 },
      sink,
      () => 't',
    );

    await tracker.record(entry({ costUsd: 12 })); // straight past 70/85/100 in one entry

    expect(sink.events.map((e) => e.type)).toEqual([
      'budget.threshold_crossed',
      'budget.downshift',
      'budget.hard_stop',
    ]);
    // Every threshold reads the same final spend — nothing is ledgered as if it happened incrementally.
    expect(sink.events.every((e) => e.spentUsd === 12)).toBe(true);
  });

  it('never re-emits once hard_stop is reached, however much more is spent', async () => {
    const ledger = new CostLedger();
    const sink = createInMemoryBudgetEventSink();
    const tracker = new BudgetBreakerTracker(
      ledger,
      { runLimitUsd: 10 },
      sink,
      () => 't',
    );

    await tracker.record(entry({ costUsd: 10 }));
    expect(sink.events).toHaveLength(3);
    await tracker.record(entry({ costUsd: 5 }));
    expect(sink.events).toHaveLength(3);
  });

  it('aggregates across berths — different berths in the same run share one breaker state (FR-H5)', async () => {
    const ledger = new CostLedger();
    const sink = createInMemoryBudgetEventSink();
    const tracker = new BudgetBreakerTracker(
      ledger,
      { runLimitUsd: 10 },
      sink,
      () => 't',
    );

    await tracker.record(entry({ berthId: 'berth-1', costUsd: 5 }));
    await tracker.record(entry({ berthId: 'berth-2', costUsd: 5 })); // combined 100%, from a different berth

    expect(tracker.levelFor('proj-1', 'run-1')).toBe('hard_stop');
    expect(sink.events.map((e) => e.type)).toEqual([
      'budget.threshold_crossed',
      'budget.downshift',
      'budget.hard_stop',
    ]);
  });

  it('keeps separate runs in the same project independently tracked', async () => {
    const ledger = new CostLedger();
    const sink = createInMemoryBudgetEventSink();
    const tracker = new BudgetBreakerTracker(
      ledger,
      { runLimitUsd: 10 },
      sink,
      () => 't',
    );

    await tracker.record(entry({ runId: 'run-1', costUsd: 10 })); // hard_stop for run-1
    await tracker.record(entry({ runId: 'run-2', costUsd: 1 })); // 10% of run-2's own limit — ok

    expect(tracker.levelFor('proj-1', 'run-1')).toBe('hard_stop');
    expect(tracker.levelFor('proj-1', 'run-2')).toBe('ok');
  });

  it('record() returns the policy for the level just reached', async () => {
    const ledger = new CostLedger();
    const tracker = new BudgetBreakerTracker(ledger, { runLimitUsd: 10 });

    expect(await tracker.record(entry({ costUsd: 6 }))).toMatchObject({
      canClaimNewTicket: true,
      skipOptionalPasses: false,
    });
    expect(await tracker.record(entry({ costUsd: 3 }))).toMatchObject({
      // 90% total — downshift
      canClaimNewTicket: true,
      skipOptionalPasses: true,
    });
    expect(await tracker.record(entry({ costUsd: 1 }))).toMatchObject({
      // 100% total — hard_stop
      canClaimNewTicket: false,
      skipOptionalPasses: true,
    });
  });

  it('defaults to the noop sink so a tracker can be used without wiring an event log', async () => {
    const ledger = new CostLedger();
    const tracker = new BudgetBreakerTracker(ledger, { runLimitUsd: 10 });
    await expect(tracker.record(entry({ costUsd: 100 }))).resolves.toMatchObject({
      canClaimNewTicket: false,
    });
  });
});
