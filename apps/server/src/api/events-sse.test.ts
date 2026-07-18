import { afterEach, describe, expect, it } from 'vitest';
import { buildApiServer, type ApiServer } from './server.js';

const TOKEN = 'test-token-0123456789abcdef';

/** Reads chunks off `reader` until `accumulated` satisfies `predicate` or `timeoutMs` elapses. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (accumulated: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  let accumulated = '';
  const deadline = Date.now() + timeoutMs;
  while (!predicate(accumulated)) {
    if (Date.now() > deadline) {
      throw new Error(
        `readUntil timed out; accumulated so far: ${JSON.stringify(accumulated)}`,
      );
    }
    const { value, done } = await reader.read();
    if (done) break;
    accumulated += Buffer.from(value!).toString('utf8');
  }
  return accumulated;
}

/** `registerEventsSseRoute` is wired into `buildApiServer` itself (server.ts), so these tests build the real app and hit the route it already registered — proving the mechanics against the live auth hook/route table. */
describe('GET /api/v1/events (SSE fallback, API_DESIGN §3)', () => {
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
  });

  async function boot(port: number): Promise<ApiServer> {
    const server = await buildApiServer({
      token: TOKEN,
      port,
      isDbOpen: () => true,
      logger: false,
    });
    active = server;
    await server.app.listen({ host: '127.0.0.1', port });
    return server;
  }

  it('streams a live-published envelope to a subscribed connection', async () => {
    const port = 4710;
    const { wsHub } = await boot(port);
    const controller = new AbortController();
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/events?subscriptions=board:P1`,
        {
          headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${TOKEN}` },
          signal: controller.signal,
        },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const reader = res.body!.getReader();
      await readUntil(reader, (acc) => acc.includes(': connected')); // headers flushed, subscribe landed
      wsHub.publish('board:P1', 'ticket.closed', { id: 'W4-01' });

      const chunk = await readUntil(reader, (acc) =>
        acc.includes('"type":"ticket.closed"'),
      );
      expect(chunk).toContain('"sub":"board:P1"');
      expect(chunk).toContain('"id":"W4-01"');
    } finally {
      controller.abort();
    }
  });

  it('replays only envelopes newer than last_seq on connect (resume)', async () => {
    const port = 4711;
    const { wsHub } = await boot(port);
    wsHub.publish('board:P1', 'ticket.claimed', { seq: 1 });
    wsHub.publish('board:P1', 'ticket.closed', { seq: 2 });

    const controller = new AbortController();
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/events?subscriptions=board:P1&last_seq=1`,
        {
          headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${TOKEN}` },
          signal: controller.signal,
        },
      );
      const reader = res.body!.getReader();
      const chunk = await readUntil(reader, (acc) => acc.includes('"seq":2'));
      expect(chunk).not.toContain('"seq":1');
    } finally {
      controller.abort();
    }
  });

  it('rejects an unauthenticated connection with 401', async () => {
    const port = 4712;
    await boot(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/events`, {
      headers: { host: `127.0.0.1:${port}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a bad Origin with 403', async () => {
    const port = 4713;
    await boot(port);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/events`, {
      headers: {
        host: `127.0.0.1:${port}`,
        authorization: `Bearer ${TOKEN}`,
        origin: 'http://evil.example',
      },
    });
    expect(res.status).toBe(403);
  });
});
