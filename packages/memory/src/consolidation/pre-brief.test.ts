import { describe, expect, it } from 'vitest';
import { insertFact, markFactVerified } from '../store/facts.js';
import { createTestHandle } from '../store/test-helpers.js';
import { buildMorningPreBrief } from './pre-brief.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('buildMorningPreBrief', () => {
  it('surfaces the most recent verified error->solution facts as leads, capped at 5', () => {
    const handle = createTestHandle();
    for (let i = 0; i < 7; i += 1) {
      const fact = insertFact(
        handle,
        { kind: 'error_solution', content: `failure ${i} -> fix ${i}`, confidence: 0.7 },
        () => `2026-07-${10 + i}T00:00:00.000Z`,
      );
      markFactVerified(handle, fact.id);
    }

    const brief = buildMorningPreBrief(handle, {
      ranAt: NOW(),
      dedupeMerges: [],
      decayedFactIds: [],
    });

    expect(brief.leadFacts).toHaveLength(5);
    expect(brief.leadFacts[0]?.content).toBe('failure 6 -> fix 6');
  });

  it('never surfaces an unverified or decayed error fact', () => {
    const handle = createTestHandle();
    insertFact(
      handle,
      { kind: 'error_solution', content: 'unverified', confidence: 0.5 },
      NOW,
    );
    const decayed = insertFact(
      handle,
      { kind: 'error_solution', content: 'decayed', confidence: 0.5 },
      NOW,
    );
    markFactVerified(handle, decayed.id);
    handle.exec(`UPDATE facts SET decayed = 1 WHERE content = 'decayed'`);

    const brief = buildMorningPreBrief(handle, {
      ranAt: NOW(),
      dedupeMerges: [],
      decayedFactIds: [],
    });

    expect(brief.leadFacts).toHaveLength(0);
  });

  it('reports dedupedCount and decayedCount from the pass results', () => {
    const handle = createTestHandle();
    const brief = buildMorningPreBrief(handle, {
      ranAt: NOW(),
      dedupeMerges: [{ survivorId: 1, mergedIds: [2, 3] }],
      decayedFactIds: [4, 5],
    });

    expect(brief.dedupedCount).toBe(2);
    expect(brief.decayedCount).toBe(2);
  });
});
