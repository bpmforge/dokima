import { describe, expect, it } from 'vitest';
import { EXPORT_BUNDLE_VERSION, type ExportBundle } from './types.js';
import { InvalidExportBundleError, validateExportBundle } from './validate.js';

function validBundle(): ExportBundle {
  return {
    version: EXPORT_BUNDLE_VERSION,
    projectId: 'proj-1',
    exportedAt: '2026-01-01T00:00:00.000Z',
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
        payloadJson: '{}',
        createdAt: '2026-01-01T00:00:00.000Z',
        prevHash: '0'.repeat(64),
        hash: 'a'.repeat(64),
      },
    ],
    receipts: [
      {
        id: 'r-1',
        kind: 'gate',
        projectId: 'proj-1',
        phase: null,
        ticketId: 'T-1',
        validatorsJson: '[]',
        inputTreeHash: 'b'.repeat(64),
        verifyCommand: null,
        verifyExit: null,
        signedBy: 'operator',
        payloadJson: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

describe('validateExportBundle', () => {
  it('accepts a well-formed bundle and returns it unchanged', () => {
    const bundle = validBundle();
    expect(validateExportBundle(bundle)).toEqual(bundle);
  });

  it('accepts an empty (zero-event, zero-receipt) bundle', () => {
    const bundle = { ...validBundle(), identities: [], events: [], receipts: [] };
    expect(validateExportBundle(bundle)).toEqual(bundle);
  });

  it('rejects a non-object', () => {
    expect(() => validateExportBundle('not a bundle')).toThrow(InvalidExportBundleError);
    expect(() => validateExportBundle(null)).toThrow(InvalidExportBundleError);
    expect(() => validateExportBundle([1, 2, 3])).toThrow(InvalidExportBundleError);
  });

  it('rejects an unsupported version', () => {
    const bundle = { ...validBundle(), version: 2 };
    expect(() => validateExportBundle(bundle)).toThrow(/unsupported version/);
  });

  it('rejects a missing projectId', () => {
    const bundle = { ...validBundle(), projectId: '' };
    expect(() => validateExportBundle(bundle)).toThrow(/projectId/);
  });

  it('rejects a malformed identity (bad kind)', () => {
    const bundle = validBundle();
    bundle.identities[0] = { ...bundle.identities[0]!, kind: 'robot' as never };
    expect(() => validateExportBundle(bundle)).toThrow(
      /kind must be "human" or "machine"/,
    );
  });

  it('rejects a malformed event (non-integer seq)', () => {
    const bundle = validBundle();
    bundle.events[0] = { ...bundle.events[0]!, seq: 1.5 };
    expect(() => validateExportBundle(bundle)).toThrow(/seq must be a positive integer/);
  });

  it('rejects an event whose actorId references an identity not in the bundle', () => {
    const bundle = validBundle();
    bundle.events[0] = { ...bundle.events[0]!, actorId: 'ghost' };
    expect(() => validateExportBundle(bundle)).toThrow(
      /references unknown actorId "ghost"/,
    );
  });

  it('rejects a receipt whose signedBy references an identity not in the bundle', () => {
    const bundle = validBundle();
    bundle.receipts[0] = { ...bundle.receipts[0]!, signedBy: 'ghost' };
    expect(() => validateExportBundle(bundle)).toThrow(
      /references unknown signedBy "ghost"/,
    );
  });

  it('rejects events that are not seq-ordered and contiguous from 1', () => {
    const bundle = validBundle();
    bundle.events = [
      { ...bundle.events[0]!, seq: 1 },
      { ...bundle.events[0]!, seq: 3 },
    ];
    expect(() => validateExportBundle(bundle)).toThrow(/seq-ordered and contiguous/);
  });

  it('collects multiple reasons in one throw rather than stopping at the first', () => {
    const bundle = { ...validBundle(), projectId: '', version: 2 };
    try {
      validateExportBundle(bundle);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidExportBundleError);
      const reasons = (err as InvalidExportBundleError).reasons;
      expect(reasons.some((r) => /version/.test(r))).toBe(true);
      expect(reasons.some((r) => /projectId/.test(r))).toBe(true);
    }
  });
});
