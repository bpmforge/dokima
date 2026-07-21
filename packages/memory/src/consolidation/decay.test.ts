import { describe, expect, it } from 'vitest';
import { getFact, insertFact, markFactVerified, touchFactUsage } from '../store/facts.js';
import { createTestHandle } from '../store/test-helpers.js';
import { decayStaleFacts } from './decay.js';

describe('decayStaleFacts', () => {
  it('decays a verified fact whose last use is past the idle threshold', () => {
    const handle = createTestHandle();
    const fact = insertFact(
      handle,
      { kind: 'fact', content: 'stale fact', confidence: 0.5 },
      () => '2026-01-01T00:00:00.000Z',
    );
    markFactVerified(handle, fact.id);
    touchFactUsage(handle, fact.id, () => '2026-01-01T00:00:00.000Z');

    const decayed = decayStaleFacts(handle, {
      now: () => '2026-07-20T00:00:00.000Z',
      maxIdleDays: 90,
    });

    expect(decayed).toEqual([fact.id]);
    expect(getFact(handle, fact.id)?.decayed).toBe(true);
  });

  it('leaves a recently-used verified fact alone', () => {
    const handle = createTestHandle();
    const fact = insertFact(
      handle,
      { kind: 'fact', content: 'fresh fact', confidence: 0.5 },
      () => '2026-07-19T00:00:00.000Z',
    );
    markFactVerified(handle, fact.id);

    const decayed = decayStaleFacts(handle, {
      now: () => '2026-07-20T00:00:00.000Z',
      maxIdleDays: 90,
    });

    expect(decayed).toEqual([]);
    expect(getFact(handle, fact.id)?.decayed).toBe(false);
  });

  it('uses created_at as the reference when a fact was never recalled', () => {
    const handle = createTestHandle();
    const fact = insertFact(
      handle,
      { kind: 'fact', content: 'never recalled', confidence: 0.5 },
      () => '2026-01-01T00:00:00.000Z',
    );
    markFactVerified(handle, fact.id);

    const decayed = decayStaleFacts(handle, {
      now: () => '2026-07-20T00:00:00.000Z',
      maxIdleDays: 90,
    });

    expect(decayed).toEqual([fact.id]);
  });

  it('never decays an unverified fact', () => {
    const handle = createTestHandle();
    insertFact(
      handle,
      { kind: 'fact', content: 'unverified stale', confidence: 0.5 },
      () => '2026-01-01T00:00:00.000Z',
    );

    const decayed = decayStaleFacts(handle, {
      now: () => '2026-07-20T00:00:00.000Z',
      maxIdleDays: 90,
    });

    expect(decayed).toEqual([]);
  });
});
