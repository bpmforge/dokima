import { describe, expect, it } from 'vitest';
import { buildExportBundle, parseExportBundle } from './bundle.js';
import { computeBundleEventHash, GENESIS_HASH, verifyBundleChain } from './hash-chain.js';
import { EXPORT_BUNDLE_VERSION } from './types.js';
import { InvalidExportBundleError } from './validate.js';

describe('buildExportBundle', () => {
  it('stamps version and exportedAt, preserving the given rows verbatim', () => {
    const hash = computeBundleEventHash({
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: 'ticket.created',
      actorId: 'operator',
      payloadJson: '{}',
    });
    const bundle = buildExportBundle({
      projectId: 'proj-1',
      identities: [
        {
          id: 'operator',
          name: 'Operator',
          kind: 'human',
          authProvider: null,
          role: null,
          modelHint: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      events: [
        {
          seq: 1,
          eventType: 'ticket.created',
          actorId: 'operator',
          ticketId: null,
          runId: null,
          payloadJson: '{}',
          createdAt: '2026-01-01T00:00:00.000Z',
          prevHash: GENESIS_HASH,
          hash,
        },
      ],
      receipts: [],
      now: () => '2026-02-02T00:00:00.000Z',
    });

    expect(bundle.version).toBe(EXPORT_BUNDLE_VERSION);
    expect(bundle.exportedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(bundle.identities).toHaveLength(1);
    expect(bundle.events).toHaveLength(1);
    expect(verifyBundleChain(bundle.events)).toEqual({
      valid: true,
      brokenAtSeq: null,
      reason: null,
    });
  });
});

describe('parseExportBundle', () => {
  it('round-trips build -> JSON.stringify -> parse -> chain verify', () => {
    const hash = computeBundleEventHash({
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: 'ticket.created',
      actorId: 'operator',
      payloadJson: '{"title":"hello"}',
    });
    const built = buildExportBundle({
      projectId: 'proj-1',
      identities: [
        {
          id: 'operator',
          name: 'Operator',
          kind: 'human',
          authProvider: null,
          role: null,
          modelHint: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      events: [
        {
          seq: 1,
          eventType: 'ticket.created',
          actorId: 'operator',
          ticketId: 'T-1',
          runId: null,
          payloadJson: '{"title":"hello"}',
          createdAt: '2026-01-01T00:00:00.000Z',
          prevHash: GENESIS_HASH,
          hash,
        },
      ],
      receipts: [],
    });

    const parsed = parseExportBundle(JSON.stringify(built));
    expect(parsed).toEqual(built);
    expect(verifyBundleChain(parsed.events)).toEqual({
      valid: true,
      brokenAtSeq: null,
      reason: null,
    });
  });

  it('throws SyntaxError on malformed JSON', () => {
    expect(() => parseExportBundle('{not json')).toThrow(SyntaxError);
  });

  it('throws InvalidExportBundleError on well-formed JSON that is not a valid bundle', () => {
    expect(() => parseExportBundle('{"version":1}')).toThrow(InvalidExportBundleError);
  });

  it('a tampered-but-structurally-valid bundle parses fine but fails chain verification', () => {
    const hash = computeBundleEventHash({
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: 'ticket.created',
      actorId: 'operator',
      payloadJson: '{"n":1}',
    });
    const built = buildExportBundle({
      projectId: 'proj-1',
      identities: [
        {
          id: 'operator',
          name: 'Operator',
          kind: 'human',
          authProvider: null,
          role: null,
          modelHint: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      events: [
        {
          seq: 1,
          eventType: 'ticket.created',
          actorId: 'operator',
          ticketId: null,
          runId: null,
          payloadJson: '{"n":1}',
          createdAt: '2026-01-01T00:00:00.000Z',
          prevHash: GENESIS_HASH,
          hash,
        },
      ],
      receipts: [],
    });
    const tampered = {
      ...built,
      events: [{ ...built.events[0]!, payloadJson: '{"n":999}' }],
    };

    const parsed = parseExportBundle(JSON.stringify(tampered));
    const result = verifyBundleChain(parsed.events);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });
});
