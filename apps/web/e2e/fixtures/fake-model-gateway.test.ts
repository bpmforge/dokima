import { afterEach, describe, expect, it } from 'vitest';
import { startFakeModelGateway, type FakeModelGateway } from './fake-model-gateway.js';

async function chat(gateway: FakeModelGateway, model: string) {
  const started = Date.now();
  const res = await fetch(`${gateway.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
  });
  return { res, elapsedMs: Date.now() - started };
}

describe('startFakeModelGateway', () => {
  let gateway: FakeModelGateway | undefined;

  afterEach(async () => {
    await gateway?.close();
    gateway = undefined;
  });

  it('returns deterministic per-role scripted content', async () => {
    gateway = await startFakeModelGateway({
      scripts: {
        interviewer: [{ content: 'first question' }, { content: 'second question' }],
        reviewer: [{ content: 'looks good' }],
      },
    });

    const first = await (await chat(gateway, 'interviewer')).res.json();
    const second = await (await chat(gateway, 'interviewer')).res.json();
    const reviewer = await (await chat(gateway, 'reviewer')).res.json();

    expect(first.choices[0].message.content).toBe('first question');
    expect(second.choices[0].message.content).toBe('second question');
    expect(reviewer.choices[0].message.content).toBe('looks good');
  });

  it('repeats the last scripted turn once the script is exhausted', async () => {
    gateway = await startFakeModelGateway({
      scripts: { solo: [{ content: 'only turn' }] },
    });
    await chat(gateway, 'solo');
    const { res } = await chat(gateway, 'solo');
    const body = await res.json();
    expect(body.choices[0].message.content).toBe('only turn');
  });

  it('fails the first N requests per role per the failure budget, then succeeds', async () => {
    gateway = await startFakeModelGateway({
      scripts: { flaky: [{ content: 'recovered' }] },
      failureBudget: { flaky: 2 },
    });

    const first = await chat(gateway, 'flaky');
    const secondCall = await chat(gateway, 'flaky');
    const third = await chat(gateway, 'flaky');

    expect(first.res.status).toBe(500);
    expect(secondCall.res.status).toBe(500);
    expect(third.res.status).toBe(200);
    const body = await third.res.json();
    expect(body.choices[0].message.content).toBe('recovered');
  });

  it('injects configured latency per turn (NFR-2 never-block coverage)', async () => {
    gateway = await startFakeModelGateway({
      scripts: { slow: [{ content: 'delayed', latencyMs: 60 }] },
    });
    const { elapsedMs } = await chat(gateway, 'slow');
    expect(elapsedMs).toBeGreaterThanOrEqual(55);
  });

  it('tracks call counts per role', async () => {
    gateway = await startFakeModelGateway({ scripts: { a: [{ content: 'x' }] } });
    await chat(gateway, 'a');
    await chat(gateway, 'a');
    expect(gateway.callCounts.a).toBe(2);
  });
});
