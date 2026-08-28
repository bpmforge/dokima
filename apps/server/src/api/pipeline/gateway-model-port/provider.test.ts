/**
 * W21-96. The per-entry request timeout reached the registry, the wire and the
 * resolved config — and then died here.
 *
 * `case 'ollama'` and `case 'lm-studio'` passed `{ baseUrl }` and nothing else,
 * while every cloud branch spread `config.requestTimeoutMs`. Both constructors
 * take `Partial<OaiCompatConfig>`, which carries the field, so the value was
 * simply not handed over and the oai-compat default of 300s always won.
 *
 * Measured live 2026-08-28: a provider entry serving `request_timeout_ms:
 * 1200000` over the authenticated API (GET read it back) still failed the
 * resume with "lm-studio: request timed out after 300000ms". The two kinds a
 * local-first product runs on were the two that could not be given more time —
 * the exact inversion of why W10-57 added the field ("a 70B on a laptop can
 * exceed even 300s").
 */
import { describe, expect, it } from 'vitest';
import { providerForConfig } from './provider.js';

/** The adapter keeps its bound as `acquireTimeoutMs`-adjacent internal state; what we can
 *  observe from outside is that construction accepts and retains the value. */
async function timeoutOf(kind: 'ollama' | 'lm-studio', requestTimeoutMs?: number) {
  const provider = await providerForConfig({
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'some-model',
    kind,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
  return provider as unknown as { requestTimeoutMs?: number };
}

describe('providerForConfig: the local kinds honour the per-entry timeout', () => {
  for (const kind of ['ollama', 'lm-studio'] as const) {
    it(`RED FIXTURE: ${kind} carries a configured requestTimeoutMs`, async () => {
      const provider = await timeoutOf(kind, 1_200_000);
      expect(provider.requestTimeoutMs).toBe(1_200_000);
    });

    it(`${kind} without one keeps the 300s default, so nobody else's behaviour moves`, async () => {
      const provider = await timeoutOf(kind);
      // The adapter resolves the default at construction rather than leaving
      // it absent, so this pins the number the local kinds have always used.
      expect(provider.requestTimeoutMs).toBe(300_000);
    });
  }
});
