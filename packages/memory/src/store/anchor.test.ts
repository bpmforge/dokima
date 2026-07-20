import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryAnchor } from './anchor.js';
import { insertFact, markFactVerified } from './facts.js';
import type { SqliteHandle } from './handle.js';
import { createTestHandle } from './test-helpers.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('createMemoryAnchor', () => {
  let handle: SqliteHandle;

  beforeEach(() => {
    handle = createTestHandle();
  });

  it('gather() returns [] when nothing verified is on record (honest, not fabricated)', async () => {
    const anchor = createMemoryAnchor(handle, { now: NOW });
    const facts = await anchor.gather({
      item: { id: 'W9-99', description: 'implement the widget' },
      criterion: 'widget renders without error',
    });
    expect(facts).toEqual([]);
  });

  it('gather() recalls a verified fact scoped to the item id', async () => {
    const fact = insertFact(
      handle,
      {
        kind: 'error_solution',
        content: 'widget crashes unless initialized before render',
        confidence: 0.9,
        ticketId: 'W9-99',
      },
      NOW,
    );
    markFactVerified(handle, fact.id);

    const anchor = createMemoryAnchor(handle, { now: NOW });
    expect(anchor.kind).toBe('memory');
    const facts = await anchor.gather({
      item: { id: 'W9-99', description: 'implement the widget' },
      criterion: 'widget renders without error',
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: 'memory',
      source: `fact:${fact.id}`,
      statement: fact.content,
    });
  });

  it('does not recall an unverified fact', async () => {
    insertFact(
      handle,
      {
        kind: 'fact',
        content: 'unverified widget claim',
        confidence: 0.9,
        ticketId: 'W9-99',
      },
      NOW,
    );
    const anchor = createMemoryAnchor(handle, { now: NOW });
    const facts = await anchor.gather({
      item: { id: 'W9-99', description: 'widget' },
      criterion: 'widget',
    });
    expect(facts).toEqual([]);
  });

  it('does not recall a fact scoped to a different item id', async () => {
    const fact = insertFact(
      handle,
      {
        kind: 'fact',
        content: 'widget fact for a different ticket',
        confidence: 0.9,
        ticketId: 'OTHER-1',
      },
      NOW,
    );
    markFactVerified(handle, fact.id);
    const anchor = createMemoryAnchor(handle, { now: NOW });
    const facts = await anchor.gather({
      item: { id: 'W9-99', description: 'widget' },
      criterion: 'widget',
    });
    expect(facts).toEqual([]);
  });
});
