import { describe, expect, it } from 'vitest';
import { createInMemoryFitnessEventSink, noopFitnessEventSink } from './events.js';
import type { FitnessAckEvent } from './events.js';
import type { FitnessCard } from './types.js';

const card: FitnessCard = {
  model: 'qwen2.5-coder-7b-instruct',
  role: 'challenger',
  verdict: 'unfit',
  harnessVersion: '1.0.0',
  taskResults: [],
  runAt: '2026-07-12T00:00:00.000Z',
};

function ackEvent(): FitnessAckEvent {
  return {
    type: 'fitness.unfit_ack',
    model: card.model,
    role: card.role,
    verdict: card.verdict,
    card,
    actorId: 'user:founder',
    occurredAt: '2026-07-12T00:00:01.000Z',
  };
}

describe('noopFitnessEventSink', () => {
  it('is a no-op callers can pass without an audit trail', () => {
    expect(() => noopFitnessEventSink.emit(ackEvent())).not.toThrow();
  });
});

describe('createInMemoryFitnessEventSink', () => {
  it('records every emitted event in order', () => {
    const sink = createInMemoryFitnessEventSink();
    const e1 = ackEvent();
    const e2 = { ...ackEvent(), actorId: 'user:other' };
    sink.emit(e1);
    sink.emit(e2);
    expect(sink.events).toEqual([e1, e2]);
  });
});
