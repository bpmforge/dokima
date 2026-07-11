import { describe, expect, it } from 'vitest';
import { computeEventHash, GENESIS_HASH, verifyChain, type ChainRow } from './hash.js';

function chain(rows: Array<Omit<ChainRow, 'prevHash' | 'hash'>>): ChainRow[] {
  const out: ChainRow[] = [];
  let prevHash = GENESIS_HASH;
  for (const row of rows) {
    const hash = computeEventHash({ ...row, prevHash });
    out.push({ ...row, prevHash, hash });
    prevHash = hash;
  }
  return out;
}

describe('computeEventHash', () => {
  it('is deterministic for identical inputs', () => {
    const input = {
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: 'ticket.created',
      actorId: 'a',
      payloadJson: '{}',
    };
    expect(computeEventHash(input)).toBe(computeEventHash(input));
  });

  it('changes when any field changes', () => {
    const base = {
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: 'ticket.created',
      actorId: 'a',
      payloadJson: '{}',
    };
    const variants = [
      { ...base, seq: 2 },
      { ...base, eventType: 'ticket.claimed' },
      { ...base, actorId: 'b' },
      { ...base, payloadJson: '{"x":1}' },
      { ...base, prevHash: 'f'.repeat(64) },
    ];
    const baseHash = computeEventHash(base);
    for (const variant of variants) {
      expect(computeEventHash(variant)).not.toBe(baseHash);
    }
  });

  // Regression: the preimage must be injective across field boundaries, or a
  // tampered event could forge a matching hash. Each pair below concatenates to
  // the same bytes under a naive (delimiter-free) hash and MUST NOT collide.
  it('has no field-boundary collisions (length-prefixed preimage)', () => {
    const base = {
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: 'ticket.claimed',
      actorId: 'maker',
      payloadJson: '{}',
    };
    const pairs: Array<[typeof base, typeof base]> = [
      // seq / eventType boundary:  "12" + "x"  vs  "1" + "2x"
      [
        { ...base, seq: 12, eventType: 'x' },
        { ...base, seq: 1, eventType: '2x' },
      ],
      // eventType / actorId boundary
      [
        { ...base, eventType: 'ticket.claimed', actorId: 'maker' },
        { ...base, eventType: 'ticket.claimedmak', actorId: 'er' },
      ],
      // actorId / payload boundary:  "u1" + "23"  vs  "u12" + "3"
      [
        { ...base, actorId: 'u1', payloadJson: '23' },
        { ...base, actorId: 'u12', payloadJson: '3' },
      ],
    ];
    for (const [a, b] of pairs) {
      expect(computeEventHash(a)).not.toBe(computeEventHash(b));
    }
  });
});

describe('verifyChain', () => {
  it('is valid for a well-formed chain of any length', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{"n":1}' },
      { seq: 2, eventType: 'ticket.claimed', actorId: 'a', payloadJson: '{"n":2}' },
      { seq: 3, eventType: 'ticket.closed', actorId: 'a', payloadJson: '{"n":3}' },
    ]);
    expect(verifyChain(events)).toEqual({ valid: true, brokenAtSeq: null, reason: null });
  });

  it('is valid for an empty chain', () => {
    expect(verifyChain([])).toEqual({ valid: true, brokenAtSeq: null, reason: null });
  });

  it('detects a tampered payload', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{"n":1}' },
      { seq: 2, eventType: 'ticket.claimed', actorId: 'a', payloadJson: '{"n":2}' },
    ]);
    events[1] = { ...events[1]!, payloadJson: '{"n":999}' };
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it('detects a tampered hash', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{}' },
    ]);
    events[0] = { ...events[0]!, hash: 'f'.repeat(64) };
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });

  it('detects a truncated prefix (missing genesis link)', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{}' },
      { seq: 2, eventType: 'ticket.claimed', actorId: 'a', payloadJson: '{}' },
      { seq: 3, eventType: 'ticket.closed', actorId: 'a', payloadJson: '{}' },
    ]);
    const truncated = events.slice(1);
    const result = verifyChain(truncated);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it('detects a reordered pair', () => {
    const events = chain([
      { seq: 1, eventType: 'ticket.created', actorId: 'a', payloadJson: '{}' },
      { seq: 2, eventType: 'ticket.claimed', actorId: 'a', payloadJson: '{}' },
    ]);
    const reordered = [events[1]!, events[0]!];
    const result = verifyChain(reordered);
    expect(result.valid).toBe(false);
  });
});
