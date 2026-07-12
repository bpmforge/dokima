import { describe, expect, it } from 'vitest';
import { createInMemoryEscalationEventSink, noopEscalationEventSink } from './events.js';
import type { EscalationEvent } from './events.js';

const sampleEvent: EscalationEvent = {
  type: 'escalation.rung_advanced',
  ticketId: 't-1',
  fromRung: 'R1',
  toRung: 'R2',
  actorId: 'harbormaster',
  receipts: [{ name: 'gate', exitCode: 1, gapCount: 1 }],
  occurredAt: '2026-07-12T00:00:00.000Z',
};

describe('noopEscalationEventSink', () => {
  it('accepts an event without throwing and without recording it', () => {
    expect(() => noopEscalationEventSink.emit(sampleEvent)).not.toThrow();
  });
});

describe('createInMemoryEscalationEventSink', () => {
  it('records every emitted event in order', () => {
    const sink = createInMemoryEscalationEventSink();
    sink.emit(sampleEvent);
    sink.emit({ ...sampleEvent, toRung: 'R3', fromRung: 'R2' });
    expect(sink.events).toEqual([
      sampleEvent,
      { ...sampleEvent, toRung: 'R3', fromRung: 'R2' },
    ]);
  });
});
