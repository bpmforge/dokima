import { expect, test } from '@playwright/test';
import {
  startFakeModelGateway,
  type FakeModelGateway,
} from './fixtures/fake-model-gateway.js';

/**
 * Proves the fake-model-gateway fixture works end-to-end inside a real
 * Playwright run (not just vitest) — this is the artifact TESTING.md §7
 * calls the "seeded stack"'s scripted provider adapter. No UI ticket wires
 * a provider call into the Canvas yet (that lands with chat/board scenes
 * in later W4 tickets); this spec is what proves the adapter itself is
 * live and ready for those tickets to point a `local` provider config at.
 */
test.describe('fake-model gateway fixture', () => {
  let gateway: FakeModelGateway;

  test.beforeEach(async () => {
    gateway = await startFakeModelGateway({
      scripts: {
        interviewer: [
          { content: 'scripted answer one' },
          { content: 'scripted answer two' },
        ],
        flaky: [{ content: 'recovered', latencyMs: 40 }],
      },
      failureBudget: { flaky: 1 },
    });
  });

  test.afterEach(async () => {
    await gateway.close();
  });

  test('returns deterministic per-role scripted turns to a real HTTP client', async ({
    request,
  }) => {
    const first = await request.post(`${gateway.url}/v1/chat/completions`, {
      data: { model: 'interviewer', messages: [] },
    });
    const second = await request.post(`${gateway.url}/v1/chat/completions`, {
      data: { model: 'interviewer', messages: [] },
    });
    expect((await first.json()).choices[0].message.content).toBe('scripted answer one');
    expect((await second.json()).choices[0].message.content).toBe('scripted answer two');
  });

  test('fails per the failure budget then recovers, with injected latency', async ({
    request,
  }) => {
    const failed = await request.post(`${gateway.url}/v1/chat/completions`, {
      data: { model: 'flaky', messages: [] },
    });
    expect(failed.status()).toBe(500);

    const started = Date.now();
    const recovered = await request.post(`${gateway.url}/v1/chat/completions`, {
      data: { model: 'flaky', messages: [] },
    });
    expect(recovered.status()).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect((await recovered.json()).choices[0].message.content).toBe('recovered');
  });
});
