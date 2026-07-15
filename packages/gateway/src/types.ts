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

/** Terminal event: the same normalized ChatResponse chat() would have returned, usage included. */
export interface ChatStreamFinal {
  type: 'final';
  response: ChatResponse;
}

export type ChatStreamEvent = ChatStreamDelta | ChatStreamFinal;

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
