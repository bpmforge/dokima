import { describe, expect, it } from 'vitest';
import { getFact, insertFact, markFactVerified } from '../store/facts.js';
import type { SqliteHandle } from '../store/handle.js';
import { createTestHandle } from '../store/test-helpers.js';
import { dedupeFacts } from './dedupe.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

function verifiedFact(
  handle: SqliteHandle,
  overrides: Parameters<typeof insertFact>[1],
  now = NOW,
) {
  const fact = insertFact(handle, overrides, now);
  markFactVerified(handle, fact.id);
  return fact;
}

describe('dedupeFacts', () => {
  it('merges exact-duplicate verified facts (same kind, ticket, content) into the oldest survivor', () => {
    const handle = createTestHandle();
    const first = verifiedFact(handle, {
      kind: 'error_solution',
      content: 'ENOENT on cold start -> mkdir -p first',
      confidence: 0.7,
      ticketId: 'W7-03',
    });
    const second = verifiedFact(
      handle,
      {
        kind: 'error_solution',
        content: 'ENOENT on cold start -> mkdir -p first',
        confidence: 0.9,
        ticketId: 'W7-03',
      },
      () => '2026-07-20T13:00:00.000Z',
    );

    const merges = dedupeFacts(handle);

    expect(merges).toEqual([{ survivorId: first.id, mergedIds: [second.id] }]);
    expect(getFact(handle, second.id)?.decayed).toBe(true);
    const survivor = getFact(handle, first.id);
    expect(survivor?.decayed).toBe(false);
    expect(survivor?.confidence).toBe(0.9);
  });

  it('folds use_count and keeps the latest last_used_at on the survivor', () => {
    const handle = createTestHandle();
    const first = verifiedFact(handle, {
      kind: 'fact',
      content: 'duplicate content',
      confidence: 0.5,
    });
    const second = verifiedFact(handle, {
      kind: 'fact',
      content: 'duplicate content',
      confidence: 0.5,
    });
    handle
      .prepare('UPDATE facts SET use_count = 3, last_used_at = ? WHERE id = ?')
      .run('2026-07-19T00:00:00.000Z', first.id);
    handle
      .prepare('UPDATE facts SET use_count = 2, last_used_at = ? WHERE id = ?')
      .run('2026-07-20T00:00:00.000Z', second.id);

    dedupeFacts(handle);

    const survivor = getFact(handle, first.id);
    expect(survivor?.useCount).toBe(5);
    expect(survivor?.lastUsedAt).toBe('2026-07-20T00:00:00.000Z');
  });

  it('never merges facts scoped to different tickets, kinds, or with distinct content', () => {
    const handle = createTestHandle();
    verifiedFact(handle, {
      kind: 'fact',
      content: 'same text',
      confidence: 0.5,
      ticketId: 'a',
    });
    verifiedFact(handle, {
      kind: 'fact',
      content: 'same text',
      confidence: 0.5,
      ticketId: 'b',
    });
    verifiedFact(handle, { kind: 'research', content: 'same text', confidence: 0.5 });
    verifiedFact(handle, { kind: 'fact', content: 'different text', confidence: 0.5 });

    expect(dedupeFacts(handle)).toEqual([]);
  });

  it('does not collide facts whose ticketId/content pairs share a field boundary', () => {
    const handle = createTestHandle();
    verifiedFact(handle, {
      kind: 'fact',
      content: 'b c',
      confidence: 0.5,
      ticketId: 'a',
    });
    verifiedFact(handle, {
      kind: 'fact',
      content: 'c',
      confidence: 0.5,
      ticketId: 'a b',
    });

    expect(dedupeFacts(handle)).toEqual([]);
  });

  it('never touches an unverified or already-decayed fact', () => {
    const handle = createTestHandle();
    insertFact(handle, { kind: 'fact', content: 'unverified dup', confidence: 0.5 }, NOW);
    insertFact(handle, { kind: 'fact', content: 'unverified dup', confidence: 0.5 }, NOW);

    expect(dedupeFacts(handle)).toEqual([]);
  });
});
