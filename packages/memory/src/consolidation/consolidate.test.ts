import { describe, expect, it } from 'vitest';
import { getFact, insertFact, markFactVerified, touchFactUsage } from '../store/facts.js';
import { createTestHandle } from '../store/test-helpers.js';
import {
  CONSOLIDATION_ENABLED_BY_DEFAULT,
  runSleepConsolidation,
} from './consolidate.js';
import { createInMemoryConsolidationSink } from './events.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('runSleepConsolidation', () => {
  it('is ON by default (FR-M3)', () => {
    expect(CONSOLIDATION_ENABLED_BY_DEFAULT).toBe(true);
  });

  it('dedupes, decays, and builds a pre-brief in one pass, emitting exactly one memory.consolidated event', () => {
    const handle = createTestHandle();
    const dup1 = insertFact(
      handle,
      { kind: 'error_solution', content: 'flaky test -> add retry', confidence: 0.6 },
      NOW,
    );
    markFactVerified(handle, dup1.id);
    const dup2 = insertFact(
      handle,
      { kind: 'error_solution', content: 'flaky test -> add retry', confidence: 0.8 },
      NOW,
    );
    markFactVerified(handle, dup2.id);
    const stale = insertFact(
      handle,
      { kind: 'fact', content: 'ancient fact', confidence: 0.5 },
      () => '2026-01-01T00:00:00.000Z',
    );
    markFactVerified(handle, stale.id);

    const sink = createInMemoryConsolidationSink();
    const report = runSleepConsolidation(handle, { now: NOW, sink });

    expect(report.skipped).toBe(false);
    expect(report.dedupeMerges).toEqual([{ survivorId: dup1.id, mergedIds: [dup2.id] }]);
    expect(report.decayedFactIds).toEqual([stale.id]);
    expect(report.preBrief?.dedupedCount).toBe(1);
    expect(report.preBrief?.decayedCount).toBe(1);
    expect(report.preBrief?.leadFacts.map((f) => f.id)).toEqual([dup1.id]);

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      type: 'memory.consolidated',
      detail: { dedupeMergeCount: 1, decayedCount: 1 },
    });
  });

  it('no-ops and touches nothing when explicitly disabled per-project (US-603 AC-1)', () => {
    const handle = createTestHandle();
    const fact = insertFact(
      handle,
      { kind: 'fact', content: 'untouched', confidence: 0.5 },
      () => '2026-01-01T00:00:00.000Z',
    );
    markFactVerified(handle, fact.id);
    touchFactUsage(handle, fact.id, () => '2026-01-01T00:00:00.000Z');

    const sink = createInMemoryConsolidationSink();
    const report = runSleepConsolidation(handle, { now: NOW, enabled: false, sink });

    expect(report.skipped).toBe(true);
    expect(report.preBrief).toBeNull();
    expect(sink.events).toHaveLength(0);
    expect(getFact(handle, fact.id)?.decayed).toBe(false);
  });
});
