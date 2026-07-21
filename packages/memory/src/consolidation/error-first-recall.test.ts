import { describe, expect, it } from 'vitest';
import { insertFact, markFactVerified } from '../store/facts.js';
import { createTestHandle } from '../store/test-helpers.js';
import { assembleErrorFirstContext } from './error-first-recall.js';
import { createInMemoryConsolidationSink } from './events.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('assembleErrorFirstContext', () => {
  it('leads the packet with a matching error->fix pair even when a plain fact ranks higher on BM25', async () => {
    const handle = createTestHandle();
    const errorFact = insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'flaky playwright run -> pass --retries=2',
        confidence: 0.7,
        ticketId: 'W7-03',
      },
      NOW,
    );
    markFactVerified(handle, errorFact.id);
    // A plain fact that repeats the query terms many times so BM25 would
    // naturally outrank the (shorter) error fact absent the error-first rule.
    const plainFact = insertFact(
      handle,
      {
        kind: 'fact',
        content:
          'flaky flaky flaky playwright playwright playwright run run run e2e test suite notes',
        confidence: 0.9,
        ticketId: 'W7-03',
      },
      NOW,
    );
    markFactVerified(handle, plainFact.id);

    const assembled = await assembleErrorFirstContext(handle, 'flaky playwright run', {
      tokenBudget: 500,
      ticketId: 'W7-03',
    });

    expect(assembled.errorFirstCount).toBe(1);
    expect(assembled.facts[0]?.fact.id).toBe(errorFact.id);
    expect(assembled.facts.some((f) => f.fact.id === plainFact.id)).toBe(true);
  });

  it('emits a memory.error_first_recall provenance event only when an error fact actually leads (US-602 AC-2)', async () => {
    const handle = createTestHandle();
    const errorFact = insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'ENOENT cold start -> mkdir -p first',
        confidence: 0.8,
      },
      NOW,
    );
    markFactVerified(handle, errorFact.id);
    const sink = createInMemoryConsolidationSink();

    await assembleErrorFirstContext(handle, 'ENOENT cold start', {
      tokenBudget: 500,
      sink,
      now: NOW,
    });

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      type: 'memory.error_first_recall',
      detail: { errorFactIds: [errorFact.id] },
    });
  });

  it('is an honest miss (no event, plain ordering) when no error_solution fact matches', async () => {
    const handle = createTestHandle();
    const plainFact = insertFact(
      handle,
      { kind: 'fact', content: 'unrelated topic entirely', confidence: 0.8 },
      NOW,
    );
    markFactVerified(handle, plainFact.id);
    const sink = createInMemoryConsolidationSink();

    const assembled = await assembleErrorFirstContext(handle, 'unrelated topic', {
      tokenBudget: 500,
      sink,
      now: NOW,
    });

    expect(assembled.errorFirstCount).toBe(0);
    expect(assembled.facts[0]?.fact.id).toBe(plainFact.id);
    expect(sink.events).toHaveLength(0);
  });

  it('never leads with an error fact scoped to a different ticket', async () => {
    const handle = createTestHandle();
    const errorFact = insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'timeout waiting for element -> increase wait',
        confidence: 0.8,
        ticketId: 'other-ticket',
      },
      NOW,
    );
    markFactVerified(handle, errorFact.id);

    const assembled = await assembleErrorFirstContext(
      handle,
      'timeout waiting for element',
      {
        tokenBudget: 500,
        ticketId: 'this-ticket',
      },
    );

    expect(assembled.errorFirstCount).toBe(0);
  });

  it('respects the token budget and reports dropped candidates', async () => {
    const handle = createTestHandle();
    const errorFact = insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'quota exceeded '.repeat(60),
        confidence: 0.8,
      },
      NOW,
    );
    markFactVerified(handle, errorFact.id);

    const assembled = await assembleErrorFirstContext(handle, 'quota exceeded', {
      tokenBudget: 10,
    });

    expect(assembled.facts).toHaveLength(0);
    expect(assembled.droppedForBudget).toBeGreaterThan(0);
  });
});
