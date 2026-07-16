import { describe, expect, it } from 'vitest';
import { CHAT_FIXTURE_EVENTS } from './fixtures.js';
import { reduceChatEvents } from './reduceChatEvents.js';

describe('reduceChatEvents', () => {
  it('renders all four card types from the fixture event stream (FR-C2)', () => {
    const threads = reduceChatEvents(CHAT_FIXTURE_EVENTS);
    const cards = threads.flatMap((thread) => thread.cards);
    const kinds = cards.map((card) => card.kind).sort();
    expect(kinds).toEqual(['finding', 'manifest', 'question', 'slate']);
  });

  it('puts the program thread first, pinned ahead of agent threads', () => {
    const threads = reduceChatEvents(CHAT_FIXTURE_EVENTS);
    expect(threads.map((t) => t.kind)).toEqual(['program', 'agent']);
  });

  it('carries agent/model/ticket/cost provenance and a receipt id on every card', () => {
    const threads = reduceChatEvents(CHAT_FIXTURE_EVENTS);
    const cards = threads.flatMap((thread) => thread.cards);
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.provenance.agent).not.toBe('');
      expect(card.provenance.model).not.toBe('');
      expect(card.provenance.ticketId).not.toBe('');
      expect(card.provenance.costUsd).toBeGreaterThan(0);
      expect(card.provenance.receiptId).not.toBe('');
    }
  });

  it('archives a thread on thread.archived without dropping its cards', () => {
    const archived = reduceChatEvents([
      ...CHAT_FIXTURE_EVENTS,
      {
        sub: 'chat:default',
        seq: 7,
        type: 'thread.archived',
        at: '2026-07-15T14:08:00Z',
        data: { id: 'thread-w4-04-security' },
      },
    ]);
    const agentThread = archived.find((t) => t.id === 'thread-w4-04-security');
    expect(agentThread?.archived).toBe(true);
    expect(agentThread?.cards).toHaveLength(2);
  });

  it('drops a card whose thread was never opened', () => {
    const threads = reduceChatEvents([
      {
        sub: 'chat:default',
        seq: 1,
        type: 'card.finding',
        at: '2026-07-15T14:00:00Z',
        data: {
          id: 'orphan',
          thread_id: 'no-such-thread',
          provenance: {
            agent: 'a',
            model: 'm',
            ticket_id: 't',
            cost_usd: 0.01,
            receipt_id: 'r',
          },
          severity: 'low',
          issue: 'orphaned',
          evidence_href: '/x',
        },
      },
    ]);
    expect(threads).toHaveLength(0);
  });

  it('ignores unknown event types instead of throwing', () => {
    expect(() =>
      reduceChatEvents([
        { sub: 'chat:default', seq: 1, type: 'something.unrelated', at: 'now', data: {} },
      ]),
    ).not.toThrow();
  });

  it('returns an empty thread list for an empty event stream', () => {
    expect(reduceChatEvents([])).toEqual([]);
  });
});
