/**
 * chatStream() event shapes and the Provider contract augmentation (W2-09,
 * G-23). providers/types.ts (where Provider lives) predates this ticket and
 * is outside its write_scope (W2-02's file header flagged exactly this: "a
 * future ticket that owns types.ts can add a real streaming method"; the
 * ticket board names this file, not providers/types.ts, as the one W2-09
 * owns) — so the optional `chatStream` method is added via TS module
 * augmentation instead of editing providers/types.ts directly.
 */
import type { ChatRequest, ChatResponse } from './providers/types.js';

/** One incremental fragment of the assistant message as it streams in. */
export interface ChatStreamDelta {
  type: 'delta';
  content: string;
}

/**
 * The model has decided to call a tool (W13-20).
 *
 * Emitted ONCE PER TOOL CALL, when the function NAME first arrives — not on
 * every argument fragment. Arguments stream in many chunks and say nothing a
 * watcher can read; the name arrives once and answers the actual question,
 * which is "what is it doing?" rather than only "is it alive?".
 *
 * This exists because W13-16 made the session observable and then measured
 * that it was not: 41% of one model's turns produced no signal at all,
 * because a turn that only calls tools emits no `content` and `ChatStreamDelta`
 * carries nothing else. The adapter had these deltas in hand and discarded
 * them into an accumulator.
 */
export interface ChatStreamToolCall {
  type: 'tool_call';
  /** Position within this turn's tool_calls array — stable across fragments. */
  index: number;
  /** The function the model chose. Never empty: the event fires when it lands. */
  name: string;
}

/** Terminal event: the same normalized ChatResponse chat() would have returned, usage included. */
export interface ChatStreamFinal {
  type: 'final';
  response: ChatResponse;
}

export type ChatStreamEvent = ChatStreamDelta | ChatStreamToolCall | ChatStreamFinal;

declare module './providers/types.js' {
  interface Provider {
    /**
     * Streams token/delta events, ending with a `final` event carrying the
     * same normalized ChatResponse chat() would return — identical
     * metering, no unmetered streamed call (FR-G1, W2-09/G-23). Optional:
     * adapters that haven't ported their internal SSE path yet omit it,
     * same as any other still-unimplemented Provider capability.
     */
    chatStream?(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
  }
}
