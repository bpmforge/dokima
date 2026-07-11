import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ProjectionRegistry, rebuildProjection, type Projection } from './projection.js';
import type { EventRecord } from './types.js';

const EVENT_TYPES = [
  'ticket.created',
  'ticket.claimed',
  'ticket.closed',
  'gate.receipt_minted',
] as const;

const eventInputArb = fc.record({
  eventType: fc.constantFrom(...EVENT_TYPES),
  actorId: fc.constantFrom('human-1', 'machine-1'),
  ticketId: fc.option(fc.constantFrom('W0-01', 'W0-02'), { nil: null }),
  amount: fc.integer({ min: -100, max: 100 }),
});

const eventsArb = fc.array(eventInputArb, { maxLength: 60 }).map((inputs) =>
  inputs.map((input, index): EventRecord => ({
    seq: index + 1,
    eventType: input.eventType,
    actorId: input.actorId,
    ticketId: input.ticketId,
    runId: null,
    payload: { amount: input.amount },
    createdAt: '2026-07-11T00:00:00.000Z',
    prevHash: '0'.repeat(64),
    hash: String(index + 1),
  })),
);

const countByTypeProjection: Projection<Record<string, number>> = {
  name: 'countByType',
  initial: () => ({}),
  reduce: (state, event) => ({
    ...state,
    [event.eventType]: (state[event.eventType] ?? 0) + 1,
  }),
};

const amountByTicketProjection: Projection<Record<string, number>> = {
  name: 'amountByTicket',
  initial: () => ({}),
  reduce: (state, event) => {
    const key = event.ticketId ?? 'none';
    const amount = (event.payload as { amount: number }).amount;
    return { ...state, [key]: (state[key] ?? 0) + amount };
  },
};

describe('projection framework: rebuild-from-zero equals incremental state', () => {
  it('holds for a single projection across any event sequence', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const registry = new ProjectionRegistry();
        registry.register(countByTypeProjection);
        for (const event of events) registry.apply(event);
        const incremental = registry.get<Record<string, number>>('countByType');

        registry.rebuild(events);
        const rebuilt = registry.get<Record<string, number>>('countByType');

        expect(incremental).toEqual(rebuilt);
        expect(incremental).toEqual(rebuildProjection(events, countByTypeProjection));
      }),
    );
  });

  it('holds for multiple simultaneously registered projections', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const registry = new ProjectionRegistry();
        registry.register(countByTypeProjection);
        registry.register(amountByTicketProjection);
        for (const event of events) registry.apply(event);

        const incrementalCounts = registry.get<Record<string, number>>('countByType');
        const incrementalAmounts = registry.get<Record<string, number>>('amountByTicket');

        registry.rebuild(events);

        expect(registry.get('countByType')).toEqual(incrementalCounts);
        expect(registry.get('amountByTicket')).toEqual(incrementalAmounts);
      }),
    );
  });

  it('rebuilding a prefix then applying the remainder matches rebuilding the whole log', () => {
    fc.assert(
      fc.property(eventsArb, fc.nat(), (events, splitSeed) => {
        const splitAt = events.length === 0 ? 0 : splitSeed % events.length;
        const prefix = events.slice(0, splitAt);
        const rest = events.slice(splitAt);

        const registry = new ProjectionRegistry();
        registry.register(amountByTicketProjection);
        registry.rebuild(prefix);
        for (const event of rest) registry.apply(event);

        expect(registry.get('amountByTicket')).toEqual(
          rebuildProjection(events, amountByTicketProjection),
        );
      }),
    );
  });
});
