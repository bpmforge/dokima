import {
  appendEvent,
  createIdentity,
  listEvents,
  openEventLog,
} from '@dokima/events';
import { describe, expect, it } from 'vitest';
import { upcastPayload, type UpcastRegistry } from './upcast.js';

describe('upcastPayload', () => {
  it('passes through a payload with no v field unchanged (every real event type today)', () => {
    const payload = { ticketId: 'W1-01', actorId: 'a1' };
    expect(upcastPayload('ticket.claimed', payload, {})).toEqual(payload);
  });

  it('passes through a payload already at its type current version', () => {
    const registry: UpcastRegistry = {
      'fixture.example': [(p) => ({ ...p, newField: p.oldField, oldField: undefined })],
    };
    const payload = { v: 2, newField: 'x' };
    expect(upcastPayload('fixture.example', payload, registry)).toEqual(payload);
  });

  it('upcasts a v1 fixture payload to the current (v2) shape', () => {
    const registry: UpcastRegistry = {
      'fixture.example': [(p) => ({ v: 2, newField: p.oldField })],
    };
    const v1Payload = { v: 1, oldField: 'legacy-value' };
    const result = upcastPayload('fixture.example', v1Payload, registry);
    expect(result).toEqual({ v: 2, newField: 'legacy-value' });
  });

  it('chains multiple upcast steps (v1 -> v2 -> v3)', () => {
    const registry: UpcastRegistry = {
      'fixture.chain': [(p) => ({ v: 2, mid: p.start }), (p) => ({ v: 3, end: p.mid })],
    };
    const result = upcastPayload('fixture.chain', { v: 1, start: 'seed' }, registry);
    expect(result).toEqual({ v: 3, end: 'seed' });
  });

  it('old-version fixture log reads clean: a real event log seeded with a v1 payload upcasts on read', () => {
    // Simulates "an old log opened by a newer binary" (DATABASE.md §8): the
    // event is appended exactly as an old release would have written it
    // (v1 shape), then read back through the current upcast registry.
    const log = openEventLog(':memory:');
    createIdentity(log, { id: 'actor-1', name: 'actor-1', kind: 'human' });
    appendEvent(log, {
      eventType: 'fixture.example',
      actorId: 'actor-1',
      payload: { v: 1, oldField: 'from-an-old-release' },
    });

    const registry: UpcastRegistry = {
      'fixture.example': [(p) => ({ v: 2, newField: p.oldField })],
    };
    const [record] = listEvents(log);
    const upcasted = upcastPayload(record?.eventType ?? '', record?.payload, registry);
    expect(upcasted).toEqual({ v: 2, newField: 'from-an-old-release' });
    log.close();
  });

  it('returns non-object payloads unchanged', () => {
    expect(upcastPayload('anything', null, {})).toBeNull();
    expect(upcastPayload('anything', 'a string', {})).toBe('a string');
  });
});
