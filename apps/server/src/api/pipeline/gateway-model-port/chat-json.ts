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

import type { Provider } from '@dokima/gateway';
import { parseModelJson } from '../model-json.js';

export async function chatJson(
  provider: Provider,
  model: string,
  phase: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown>> {
  const response = await provider.chat({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
  });
  return parseModelJson(response.message.content, phase);
}
