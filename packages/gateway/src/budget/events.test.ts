import { describe, expect, it } from 'vitest';
import { createInMemoryBudgetEventSink, noopBudgetEventSink } from './events.js';
import type { BudgetEvent } from './events.js';

const sampleEvent: BudgetEvent = {
  type: 'budget.threshold_crossed',
  tier: 'record',
  scope: 'run',
  projectId: 'proj-1',
  runId: 'run-1',
  thresholdPct: 70,
  spentUsd: 7,
  limitUsd: 10,
  ratio: 0.7,
  occurredAt: '2026-07-12T00:00:00.000Z',
};

describe('noopBudgetEventSink', () => {
  it('accepts an event without throwing and without recording it', () => {
    expect(() => noopBudgetEventSink.emit(sampleEvent)).not.toThrow();
  });
});

describe('createInMemoryBudgetEventSink', () => {
  it('records every emitted event in order', () => {
    const sink = createInMemoryBudgetEventSink();
    sink.emit(sampleEvent);
    sink.emit({ ...sampleEvent, type: 'budget.downshift', thresholdPct: 85 });
    expect(sink.events).toEqual([
      sampleEvent,
      { ...sampleEvent, type: 'budget.downshift', thresholdPct: 85 },
    ]);
  });
});
