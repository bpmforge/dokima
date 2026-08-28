/**
 * gateway-model-port/chat-json.ts — the generic model-call helper every phase goes through.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 *
 * W10-59: the parse moved to `../model-json.js`, shared with the twin call
 * site in `onboard-dispatch-port.ts`. Both used a bare `JSON.parse` on a model
 * completion, and both therefore died on a markdown fence.
 */

import { ProviderResponseShapeError, type Provider } from '@dokima/gateway';
import { parseModelJson } from '../model-json.js';

/**
 * STREAMS WHEN THE ADAPTER CAN, because a blocking call cannot outlive five
 * minutes no matter what anyone configures.
 *
 * Node's own `fetch` defaults `headersTimeout` to 300s, and a non-streaming
 * completion sends no response headers until generation finishes — so every
 * phase was capped at five minutes by our HTTP client, independent of the
 * `AbortSignal` `requestTimeoutMs` governs. Measured 2026-08-28 by driving the
 * real journey: raising the registry ceiling to 20 and then 30 minutes changed
 * nothing, and the failure finally identified itself as
 * `TypeError: fetch failed <- HeadersTimeoutError [UND_ERR_HEADERS_TIMEOUT]`.
 *
 * A streamed response sends headers immediately, so that bound never applies.
 * What governs instead is `createIdleAbort` (DEFAULT_STREAM_IDLE_MS, 60s) —
 * "an abort that fires when a stream goes QUIET, not when it takes a while",
 * which is the right question to ask of a slow local model: it tolerates a
 * twenty-minute generation that keeps producing tokens and still fails fast on
 * a genuine stall.
 *
 * `chatStream` is OPTIONAL on Provider (declaration-merged in gateway's
 * types.ts) — vertex and copilot have not ported their SSE paths — so this
 * falls back to `chat()` rather than requiring every adapter to move first.
 * The terminal `final` event carries "the same normalized ChatResponse chat()
 * would have returned, usage included", so metering and parsing are unchanged;
 * this is the same answer by a transport that can survive the wait.
 */
export async function chatJson(
  provider: Provider,
  model: string,
  phase: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown>> {
  const request = {
    model,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ],
    temperature: 0,
  };

  if (provider.chatStream) {
    try {
      for await (const event of provider.chatStream(request)) {
        if (event.type === 'final') return parseModelJson(event.response.message.content, phase);
      }
    } catch (err) {
      /**
       * A provider that streams but will not METER cannot be used on this path
       * — `oai-compat` refuses a stream that ends with no usage-bearing chunk,
       * because FR-G1 forbids an unmetered call. But `chat()` reads usage from
       * the aggregated body and never needed `stream_options.include_usage`,
       * so switching the pipeline to streaming silently narrowed which
       * endpoints work at all: any OpenAI-compatible server that ignores that
       * option went from working to failing every phase.
       *
       * So fall back rather than fail. It costs one repeated generation on
       * such an endpoint, which is strictly better than losing the phase, and
       * it keeps the metering guarantee intact — the fallback IS metered.
       * Only this shape falls back; every other stream failure still surfaces.
       */
      if (!(err instanceof ProviderResponseShapeError) || !/cannot meter/i.test(err.message)) {
        throw err;
      }
      return parseModelJson((await provider.chat(request)).message.content, phase);
    }
    // A stream that ends without its terminal event has told us nothing about
    // what the model said. Falling through to `chat()` here would quietly pay
    // for the work twice; refusing names the transport as the problem.
    // ProviderResponseShapeError, not a bare Error: `isProviderError` matches an
    // explicit list, and the land loop rethrows anything absent from it
    // (loop-land-session.ts) — so a plain Error would strand the ticket and
    // render as a generic 500, which is exactly what this branch exists to
    // avoid. The endpoint returning a truncated stream IS a response-shape
    // problem.
    throw new ProviderResponseShapeError(
      'pipeline-run',
      `${phase}: the model stream ended without a final event — no completion was received`,
    );
  }

  const response = await provider.chat(request);
  return parseModelJson(response.message.content, phase);
}
