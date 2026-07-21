import { describe, expect, it } from 'vitest';
import { computeBundleEventHash, GENESIS_HASH, verifyBundleChain } from './hash-chain.js';
import type { ExportedEvent } from './types.js';

function chain(
  rows: Array<Pick<ExportedEvent, 'seq' | 'eventType' | 'actorId' | 'payloadJson'>>,
): ExportedEvent[] {
  const out: ExportedEvent[] = [];
  let prevHash = GENESIS_HASH;
  for (const row of rows) {
    const hash = computeBundleEventHash({ ...row, prevHash });
    out.push({
      ...row,
      ticketId: null,
      runId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      prevHash,
      hash,
    });
    prevHash = hash;
  }
  return out;
}

describe('computeBundleEventHash', () => {
  it("matches packages/events/src/hash.ts's documented fixture-shape behavior: deterministic, field-sensitive", () => {
    const input = {
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: 'ticket.created',
      actorId: 'a',
      payloadJson: '{}',
    };
    expect(computeBundleEventHash(input)).toBe(computeBundleEventHash(input));
    expect(computeBundleEventHash({ ...input, seq: 2 })).not.toBe(
      computeBundleEventHash(input),
    );
  });

  it('has no field-boundary collisions (length-prefixed preimage, same injectivity property as hash.ts)', () => {
    const a = {
      prevHash: GENESIS_HASH,
      seq: 12,
      eventType: 'x',
      actorId: 'maker',
      payloadJson: '{}',
    };
    const b = {
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: '2x',
      actorId: 'maker',
      payloadJson: '{}',
    };
    expect(computeBundleEventHash(a)).not.toBe(computeBundleEventHash(b));
  });
});

describe('verifyBundleChain', () => {
  it('is valid for a well-formed chain of any length', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{"n":1}' },
      { seq: 2, eventType: 'ticket.claimed', actorId: 'a', payloadJson: '{"n":2}' },
      { seq: 3, eventType: 'ticket.closed', actorId: 'a', payloadJson: '{"n":3}' },
    ]);
    expect(verifyBundleChain(events)).toEqual({
      valid: true,
      brokenAtSeq: null,
      reason: null,
    });
  });

  it('is valid for an empty chain', () => {
    expect(verifyBundleChain([])).toEqual({
      valid: true,
      brokenAtSeq: null,
      reason: null,
    });
  });

  it('detects a tampered payload (red fixture: an attacker edits one event after export)', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{"n":1}' },
      { seq: 2, eventType: 'ticket.claimed', actorId: 'a', payloadJson: '{"n":2}' },
    ]);
    events[1] = { ...events[1]!, payloadJson: '{"n":999}' };
    const result = verifyBundleChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it('detects a tampered hash', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{}' },
    ]);
    events[0] = { ...events[0]!, hash: 'f'.repeat(64) };
    const result = verifyBundleChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });

  it('detects a truncated prefix (missing genesis link)', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{}' },
      { seq: 2, eventType: 'ticket.claimed', actorId: 'a', payloadJson: '{}' },
      { seq: 3, eventType: 'ticket.closed', actorId: 'a', payloadJson: '{}' },
    ]);
    const result = verifyBundleChain(events.slice(1));
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it('detects a reordered pair', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{}' },
      { seq: 2, eventType: 'ticket.claimed', actorId: 'a', payloadJson: '{}' },
    ]);
    const result = verifyBundleChain([events[1]!, events[0]!]);
    expect(result.valid).toBe(false);
  });
});
