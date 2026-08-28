/**
 * This module's header states the invariant: "every field must be listed
 * twice, and a field missing from either direction is settable and inert."
 *
 * `requestTimeoutMs` was missing from BOTH. The registry has carried it since
 * W10-57 — whose type comment exists for exactly this case, "a 70B on a laptop
 * can exceed even 300s" — validation accepts it, and `targetToConfig` threads
 * it to the provider. Only the HTTP contract dropped it, so the one knob that
 * lets a slow local box finish a long step was reachable only by hand-editing
 * settings JSON. Measured 2026-08-28: the resume that builds the board timed
 * out at the 300s default three times running, with no way to ask for longer.
 */
import { describe, expect, it } from 'vitest';
import { fromWire, toWire } from './providers-wire.js';

const ENTRY = {
  id: 'lm-studio',
  kind: 'lm-studio' as const,
  baseUrl: 'http://127.0.0.1:1234/v1',
  enabled: true,
};

describe('providers-wire: the per-entry request timeout survives both directions', () => {
  it('RED FIXTURE: toWire carries the timeout the registry holds', () => {
    expect(toWire({ ...ENTRY, requestTimeoutMs: 900_000 }).request_timeout_ms).toBe(900_000);
  });

  it('RED FIXTURE: fromWire keeps a timeout the caller sent', () => {
    const mapped = fromWire({ ...ENTRY, base_url: ENTRY.baseUrl, request_timeout_ms: 900_000 });
    expect((mapped as { requestTimeoutMs?: number }).requestTimeoutMs).toBe(900_000);
  });

  it('round-trips unchanged, which is what "listed twice" is for', () => {
    const wire = toWire({ ...ENTRY, requestTimeoutMs: 600_000 });
    const back = fromWire(wire) as { requestTimeoutMs?: number };
    expect(back.requestTimeoutMs).toBe(600_000);
  });

  it('an entry without one stays without one — absent means the kind default', () => {
    expect(toWire(ENTRY).request_timeout_ms).toBeUndefined();
    const back = fromWire(toWire(ENTRY)) as { requestTimeoutMs?: number };
    expect(back.requestTimeoutMs).toBeUndefined();
  });

  it('still carries the fields it already did, so this widens nothing else', () => {
    const wire = toWire({ ...ENTRY, requestExtras: { reasoning_effort: 'high' } });
    expect(wire.request_extras).toEqual({ reasoning_effort: 'high' });
    expect(wire.base_url).toBe('http://127.0.0.1:1234/v1');
    expect(wire.enabled).toBe(true);
  });
});

/**
 * W21 audit follow-up: `streamIdleMs` governs every streamed pipeline phase
 * (chat-json prefers chatStream), and until now it was the one bound with no
 * registry surface at all — hardcoded 60s, unreachable from the API.
 */
describe('providers-wire: the stream idle bound round-trips too', () => {
  it('RED FIXTURE: toWire carries it', () => {
    expect(toWire({ ...ENTRY, streamIdleMs: 120_000 }).stream_idle_ms).toBe(120_000);
  });

  it('RED FIXTURE: fromWire keeps it', () => {
    const mapped = fromWire({ ...ENTRY, base_url: ENTRY.baseUrl, stream_idle_ms: 120_000 });
    expect((mapped as { streamIdleMs?: number }).streamIdleMs).toBe(120_000);
  });

  it('absent stays absent — the adapter default still applies', () => {
    expect(toWire(ENTRY).stream_idle_ms).toBeUndefined();
  });
});
