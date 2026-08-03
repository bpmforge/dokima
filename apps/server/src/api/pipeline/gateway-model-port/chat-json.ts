/**
 * gateway-model-port/chat-json.ts — the generic model-call helper every phase goes through.
 *
 * Chapter of the 450-line gateway-model-port.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import { requireObject } from '../json-shape.js';
import type { Provider } from '@dokima/gateway';
import { MalformedModelOutputError } from '../errors.js';

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
  const content = response.message.content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new MalformedModelOutputError(
      phase,
      `response was not valid JSON: ${(err as Error).message}`,
    );
  }
  return requireObject(parsed, phase, '<response>');
}

