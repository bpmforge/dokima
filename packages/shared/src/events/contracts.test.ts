import { describe, expect, it } from 'vitest';
import type { EventEnvelopeContract, IdentityContract } from './contracts.js';
import { isIdentityKind } from './contracts.js';

describe('isIdentityKind', () => {
  it('accepts human and machine', () => {
    expect(isIdentityKind('human')).toBe(true);
    expect(isIdentityKind('machine')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isIdentityKind('robot')).toBe(false);
    expect(isIdentityKind(undefined)).toBe(false);
    expect(isIdentityKind(null)).toBe(false);
  });
});

describe('contract shapes', () => {
  it('IdentityContract carries kind + auth_provider per D-005', () => {
    const identity: IdentityContract = {
      id: 'shipwright-maker',
      name: 'Shipwright Maker',
      kind: 'machine',
      authProvider: null,
      role: 'maker',
      modelHint: null,
      createdAt: '2026-07-11T00:00:00.000Z',
    };
    expect(isIdentityKind(identity.kind)).toBe(true);
  });

  it('EventEnvelopeContract carries the DATABASE.md §2 envelope fields', () => {
    const event: EventEnvelopeContract = {
      seq: 1,
      eventType: 'ticket.created',
      actorId: 'shipwright-maker',
      ticketId: 'W0-02',
      runId: null,
      payload: { title: 'test' },
      createdAt: '2026-07-11T00:00:00.000Z',
      prevHash: '0'.repeat(64),
      hash: 'abc123',
    };
    expect(event.seq).toBe(1);
  });
});
