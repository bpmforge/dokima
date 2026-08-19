/**
 * The guard's own tests. A guard that passes because it never fires is worse
 * than no guard: it reports a safety it is not providing. The first cut of
 * `vitest.network-guard.ts` refused every un-stubbed fetch and turned 52
 * hermetic tests red, so both halves are asserted here — what it must catch,
 * and what it must keep letting through.
 */
import { describe, expect, it } from 'vitest';
import { isForbiddenTestUrl } from '../vitest.network-guard.ts';

describe('law 9(a) network guard', () => {
  it('refuses the exact URL W13-18 called for a day', () => {
    // `envTarget`'s documented default (model-resolution.ts:261). This is the
    // regression: the route fell back to it, reached a real LM Studio, and
    // passed or failed depending on which model happened to be loaded.
    expect(isForbiddenTestUrl('http://127.0.0.1:1234/v1/chat/completions')).toBe(true);
  });

  it('refuses both local model daemons on either loopback spelling', () => {
    for (const url of [
      'http://localhost:1234/v1/models',
      'http://127.0.0.1:11434/v1/chat/completions',
      'http://localhost:11434/api/tags',
    ]) {
      expect(isForbiddenTestUrl(url), url).toBe(true);
    }
  });

  it('refuses any non-loopback host — the failure the law names', () => {
    for (const url of [
      'https://api.anthropic.com/v1/messages',
      'https://api.openai.com/v1/chat/completions',
      'http://192.168.13.179:1234/v1/models',
    ]) {
      expect(isForbiddenTestUrl(url), url).toBe(true);
    }
  });

  it('allows loopback on a port the test itself started', () => {
    // The 52 tests the first cut broke: they boot a Fastify app on an
    // OS-assigned port. The process under test IS the server, so there is no
    // live call to forbid — refusing them enforces "no sockets", a different
    // and wrong rule.
    for (const url of [
      'http://127.0.0.1:62894/v1/chat/completions',
      'http://127.0.0.1:4711/api/v1/events?subscriptions=board:P1',
      'http://localhost:5173/',
    ]) {
      expect(isForbiddenTestUrl(url), url).toBe(false);
    }
  });

  it('ignores non-http schemes and unparseable input rather than throwing', () => {
    for (const url of ['file:///tmp/x.json', 'data:text/plain,hi', 'not a url', '']) {
      expect(isForbiddenTestUrl(url), url).toBe(false);
    }
  });
});
