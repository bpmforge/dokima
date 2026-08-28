/**
 * A real, minimal OpenAI-compatible HTTP server (`POST /v1/chat/completions`)
 * for tests — not a mock of `@dokima/gateway`'s TypeScript interfaces.
 * `gateway-model-port.ts` loads the real `createOaiCompatProvider` (via a
 * dynamic `file://` import — see that module's header) and points it at
 * this server's `url`, so a test exercising it proves the REAL adapter's
 * wire-format handling, not a stand-in for it. Mirrors `apps/web/e2e/
 * fixtures/fake-model-gateway.ts`'s same shape (Law 9: no network in CI).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeGatewayServer {
  readonly url: string;
  /** Parsed request bodies, one per call received so far, in order. */
  readonly requests: Record<string, unknown>[];
  close(): Promise<void>;
}

/**
 * `responses[n]` is the assistant message content returned for the
 * (n+1)th call; once exhausted, the last entry repeats. Each entry is
 * typically a JSON string (the shape `gateway-model-port.ts`'s parsers
 * expect) but is passed through verbatim — a non-JSON string is exactly
 * how a malformed-output test simulates a broken completion.
 */
export function startFakeGatewayServer(
  responses: readonly string[],
): Promise<FakeGatewayServer> {
  const requests: Record<string, unknown>[] = [];
  let callIndex = 0;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // W17-05: the run route now preflights GET /models before minting run
      // state — a real oai-compat endpoint always serves it, so the fake
      // does too (empty list: healthy, models unlisted -> warn, not refuse).
      if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsedBody: { stream?: boolean } | undefined;
        try {
          const body = JSON.parse(raw) as Record<string, unknown>;
          requests.push(body);
          parsedBody = body as { stream?: boolean };
        } catch {
          requests.push({ raw });
        }
        const content = responses[callIndex] ?? responses[responses.length - 1] ?? '{}';
        callIndex += 1;
        const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

        /**
         * SSE when asked. `chatJson` now prefers `chatStream`, because a
         * non-streaming completion sends no headers until it finishes and
         * Node's fetch abandons it at 300s (UND_ERR_HEADERS_TIMEOUT) — a
         * ceiling no product setting can lift. A fixture answering only the
         * blocking shape would test a path production no longer takes.
         */
        if (parsedBody?.stream === true) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
          const base = { id: 'fake-completion', object: 'chat.completion.chunk', model: 'local-model' };
          send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] });
          send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'fake-completion',
            model: 'local-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop',
              },
            ],
            usage,
          }),
        );
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}/v1`,
        requests,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
