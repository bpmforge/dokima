/**
 * Scripted OpenAI-compatible provider adapter for the Playwright seeded
 * stack (docs/TESTING.md §7): deterministic per-role responses, an
 * injectable failure budget (leading requests 500 before the script
 * succeeds — escalation-scene coverage), and per-turn latency injection
 * (NFR-2's never-block rule). No CI job ever talks to a real provider.
 *
 * Wire shape matches the OpenAI-compatible `/v1/chat/completions` contract
 * packages/gateway's OaiCompatProvider consumes (verified against
 * platform docs at W2-01) — a plain `node:http` server rather than an
 * import of packages/gateway, since apps/web may only depend on
 * `@dokima/shared` (ARCHITECTURE §4 dependency matrix) and a real
 * HTTP fake is what a real provider config (`local`, base_url) points at
 * anyway.
 */

import { createServer, type Server } from 'node:http';

/** OpenAI wire shape for one scripted tool call — `arguments` is a raw JSON-encoded string, exactly as a real provider emits it, so the adapter's own parsing is what's under test. */
export interface ScriptedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ScriptedTurn {
  content: string;
  latencyMs?: number;
  /** When present, the turn answers with `tool_calls` + `finish_reason: 'tool_calls'` instead of a plain `stop` (FR-G9, W11-01). */
  toolCalls?: ScriptedToolCall[];
}

export interface FakeModelGatewayConfig {
  /** role (the request's `model` field) -> ordered turns; the last turn repeats once exhausted. */
  scripts: Record<string, ScriptedTurn[]>;
  /** role -> count of leading requests that 500 before scripted turns start succeeding. */
  failureBudget?: Record<string, number>;
}

export interface FakeModelGateway {
  url: string;
  callCounts: Record<string, number>;
  close(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startFakeModelGateway(
  config: FakeModelGatewayConfig,
): Promise<FakeModelGateway> {
  const callCounts: Record<string, number> = {};

  const server: Server = createServer((req, res) => {
    // W13-37: the model catalog. The setup wizard reads it to offer the
    // user's own models, so a fixture that answers only /chat/completions
    // sends the wizard down its typed-id fallback and the select path — the
    // one every real customer sees — is never exercised end to end.
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        // The ids it actually SCRIPTS. Advertising anything else would let a
        // spec route to a model this fixture has no turns for, which reads as
        // an empty completion — a confusing way to fail.
        JSON.stringify({
          object: 'list',
          data: Object.keys(config.scripts).map((id) => ({
            id,
            object: 'model',
            owned_by: 'fixture',
          })),
        }),
      );
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void handleRequest(Buffer.concat(chunks).toString('utf8'));
    });

    async function handleRequest(body: string): Promise<void> {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const model = (parsed as { model?: unknown }).model;
      const role = typeof model === 'string' ? model : 'default';
      const callIndex = callCounts[role] ?? 0;
      callCounts[role] = callIndex + 1;

      const budget = config.failureBudget?.[role] ?? 0;
      if (callIndex < budget) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: 'fake-model-gateway: scripted failure',
              type: 'server_error',
            },
          }),
        );
        return;
      }

      const script = config.scripts[role] ?? config.scripts.default ?? [];
      const scriptIndex = Math.min(callIndex - budget, script.length - 1);
      const turn: ScriptedTurn = script[scriptIndex] ?? { content: '' };
      if (turn.latencyMs) await sleep(turn.latencyMs);

      const message: Record<string, unknown> = {
        role: 'assistant',
        content: turn.content,
      };
      if (turn.toolCalls) {
        message.tool_calls = turn.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        }));
      }

      const usage = {
        prompt_tokens: 0,
        completion_tokens: turn.content.length,
        total_tokens: turn.content.length,
      };
      const finishReason = turn.toolCalls ? 'tool_calls' : 'stop';

      /**
       * SSE, when the caller asks for it (W21 streaming switch).
       *
       * `chat-json.ts` — the helper every pipeline phase goes through — now
       * prefers `chatStream` so a slow local model is bounded by silence
       * rather than by total duration. A fixture that only answered
       * non-streaming would have sent the whole e2e suite down a path no
       * customer takes, which is the "a green suite would prove nothing" trap
       * this repo already warns about in W11-01's notes.
       *
       * Deltas are emitted in a few pieces rather than one, so the adapter's
       * accumulation is genuinely exercised instead of trivially satisfied.
       */
      if ((parsed as { stream?: unknown }).stream === true) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
        const base = { id: `fake-${role}-${callIndex}`, object: 'chat.completion.chunk', created: 0, model: role };

        if (turn.toolCalls) {
          send({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: turn.toolCalls.map((call, index) => ({
                    index,
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: call.arguments },
                  })),
                },
                finish_reason: null,
              },
            ],
          });
        } else {
          const text = turn.content;
          const pieces = text.length > 1 ? [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))] : [text];
          let first = true;
          for (const piece of pieces) {
            send({
              ...base,
              choices: [
                {
                  index: 0,
                  delta: first ? { role: 'assistant', content: piece } : { content: piece },
                  finish_reason: null,
                },
              ],
            });
            first = false;
          }
        }

        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `fake-${role}-${callIndex}`,
          object: 'chat.completion',
          created: 0,
          model: role,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage,
        }),
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no address');

  return {
    url: `http://127.0.0.1:${address.port}`,
    callCounts,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
