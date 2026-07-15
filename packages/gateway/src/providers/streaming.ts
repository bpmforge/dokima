/**
 * Shared streaming plumbing for provider adapters (W2-09, G-23): every
 * adapter's chatStream() parses the same shape of SSE transport (`data:
 * <json>\n\n` records, chunk-boundary reassembly across reads) even though
 * the JSON payload inside each record is per-vendor — so the framing lives
 * here once instead of being re-copied into anthropic.ts/openai.ts/
 * oai-compat.ts a third time (openai.ts's file header already flagged the
 * duplication `parseRetryAfterMs` left behind; this ticket is the one that
 * owns streaming* and can finally de-duplicate the SSE loop too).
 */

import type { RequestQueue } from './request-queue.js';

/**
 * Splits a fetch Response body into individual SSE `data:` payload strings,
 * reassembling records that span multiple `reader.read()` chunks. Mirrors
 * the buffering every adapter's internal streaming path already used
 * (W2-02): split on blank-line record separators, keep the trailing partial
 * record in `buffer` until more bytes arrive.
 */
export async function* readSseDataLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const records = buffer.split('\n\n');
      buffer = records.pop() ?? '';
      for (const record of records) {
        const dataLine = record.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        yield dataLine.slice('data:'.length).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Runs an async generator under a RequestQueue slot (FR-G1: streamed calls
 * respect the same per-endpoint concurrency limit as chat() — a local
 * single-concurrency server must not see a chatStream() call and a chat()
 * call in flight at once). RequestQueue only exposes `run(task)`, so the
 * slot is held open for the generator's lifetime via a gate promise: the
 * queued task acquires the slot and then blocks on `finished` until the
 * generator (consumed by the caller) completes or throws.
 */
export async function* runQueuedStream<T>(
  queue: RequestQueue,
  source: () => AsyncGenerator<T>,
): AsyncGenerator<T> {
  let signalAcquired!: () => void;
  const acquired = new Promise<void>((resolve) => {
    signalAcquired = resolve;
  });
  let signalDone!: () => void;
  const finished = new Promise<void>((resolve) => {
    signalDone = resolve;
  });

  const queued = queue.run(async () => {
    signalAcquired();
    await finished;
  });

  await acquired;
  try {
    yield* source();
  } finally {
    signalDone();
    await queued;
  }
}
