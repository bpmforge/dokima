import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteHandle } from './handle.js';
import { createTestHandle } from './test-helpers.js';
import {
  getFact,
  insertFact,
  listFacts,
  markFactVerified,
  touchFactUsage,
} from './facts.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('facts store', () => {
  let handle: SqliteHandle;

  beforeEach(() => {
    handle = createTestHandle();
  });

  it('inserts a fact unverified by default (verified-before-stored)', () => {
    const fact = insertFact(
      handle,
      { kind: 'fact', content: 'the sky is blue', confidence: 0.8 },
      NOW,
    );
    expect(fact.verified).toBe(false);
    expect(fact.useCount).toBe(0);
    expect(fact.createdAt).toBe(NOW());
  });

  it('has no input path to insert an already-verified fact (maker cannot self-verify)', () => {
    const fact = insertFact(
      handle,
      {
        kind: 'fact',
        content: 'attempted self-verified claim',
        confidence: 0.9,
        // @ts-expect-error InsertFactInput carries no `verified` field — only
        // markFactVerified (a distinct call) may flip it.
        verified: true,
      },
      NOW,
    );
    expect(fact.verified).toBe(false);
  });

  it('markFactVerified flips verified once confirmed', () => {
    const fact = insertFact(
      handle,
      { kind: 'error_solution', content: 'ENOENT -> mkdir -p first', confidence: 0.9 },
      NOW,
    );
    expect(getFact(handle, fact.id)?.verified).toBe(false);
    markFactVerified(handle, fact.id);
    expect(getFact(handle, fact.id)?.verified).toBe(true);
  });

  it('touchFactUsage increments use_count and stamps last_used_at', () => {
    const fact = insertFact(
      handle,
      { kind: 'decision_ref', content: 'D-003: SQLite WAL', confidence: 1 },
      NOW,
    );
    touchFactUsage(handle, fact.id, () => '2026-07-20T13:00:00.000Z');
    const updated = getFact(handle, fact.id);
    expect(updated?.useCount).toBe(1);
    expect(updated?.lastUsedAt).toBe('2026-07-20T13:00:00.000Z');
  });

  it('listFacts filters by kind, verifiedOnly, and excludes decayed by default', () => {
    const a = insertFact(handle, { kind: 'fact', content: 'a', confidence: 0.5 }, NOW);
    insertFact(handle, { kind: 'research', content: 'b', confidence: 0.5 }, NOW);
    markFactVerified(handle, a.id);
    handle.exec(`UPDATE facts SET decayed = 1 WHERE content = 'a'`);

    expect(listFacts(handle, { kind: 'research' })).toHaveLength(1);
    expect(listFacts(handle, { verifiedOnly: true })).toHaveLength(0);
    expect(listFacts(handle, { verifiedOnly: true, includeDecayed: true })).toHaveLength(
      1,
    );
  });

  it('scopes facts by ticketId', () => {
    insertFact(
      handle,
      { kind: 'fact', content: 'scoped', confidence: 0.5, ticketId: 'W7-01' },
      NOW,
    );
    insertFact(handle, { kind: 'fact', content: 'other', confidence: 0.5 }, NOW);
    expect(listFacts(handle, { ticketId: 'W7-01' })).toHaveLength(1);
  });
});
