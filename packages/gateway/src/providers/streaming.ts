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

import { QueueAcquireTimeoutError, type RequestQueue } from './request-queue.js';
import { ProviderTimeoutError } from './errors.js';

/**
 * Splits a fetch Response body into individual SSE `data:` payload strings,
 * reassembling records that span multiple `reader.read()` chunks. Mirrors
 * the buffering every adapter's internal streaming path already used
 * (W2-02): split on blank-line record separators, keep the trailing partial
 * record in `buffer` until more bytes arrive.
 */
export async function* readSseDataLines(
  body: ReadableStream<Uint8Array>,
  onChunk?: () => void,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // W13-15: proof of life. A stream that is producing is alive by
      // definition, so the caller resets its idle bound here rather than
      // running a clock against the whole request.
      onChunk?.();
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
  providerId = 'provider',
): AsyncGenerator<T> {
  // W13-42: the slot is taken and given back explicitly. This used to hold it
  // open through a gate promise handed to `queue.run`, which meant the slot was
  // released only by this generator's `finally` — so a stream abandoned without
  // being closed held it forever, and every later call to the provider blocked
  // with no bound. `RequestQueue.acquire` now owns both the wait and its
  // deadline, so `chat()` and `chatStream()` get the same guarantee instead of
  // one of them getting it.
  try {
    await queue.acquire();
  } catch (err) {
    throw asProviderTimeout(err, providerId);
  }
  try {
    yield* source();
  } finally {
    queue.releaseSlot();
  }
}

/** Gives a queue-wait timeout the name the rest of the system already reads as infrastructure. */
export function asProviderTimeout(err: unknown, providerId: string): unknown {
  // Counts come from the ERROR, not from the queue as it is now: the waiter
  // leaves the queue the instant it gives up, so re-reading here would report
  // a depth one short of the one that caused the timeout.
  return err instanceof QueueAcquireTimeoutError
    ? new ProviderTimeoutError(
        `${providerId} (waiting for a request-queue slot; ` +
          `${err.active} active, ${err.queued} queued)`,
        err.timeoutMs,
      )
    : err;
}

/**
 * An abort that fires when a stream goes QUIET, not when it takes a while
 * (W13-15).
 *
 * `AbortSignal.timeout()` bounds total duration, which is the wrong control
 * for a generation: it kills a model that is healthily producing tokens at
 * exactly the same moment it kills one that hung, and on local hardware a 27B
 * model legitimately generates for minutes. The founder put it plainly — as
 * long as it is streaming, leave it open.
 *
 * `bump()` is called for every chunk received; the abort fires only if none
 * arrives within `idleMs`.
 */
export interface IdleAbort {
  readonly signal: AbortSignal;
  /** Called per chunk — restarts the idle window. */
  bump(): void;
  /** Always call when the stream ends, or the timer keeps the process alive. */
  done(): void;
  /** Whether any chunk has arrived — the first-chunk bound has handed over. */
  readonly startedStreaming: boolean;
}

export function createIdleAbort(idleMs: number, firstChunkMs = idleMs): IdleAbort {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seenChunk = false;
  const arm = (ms: number) => {
    /**
     * The reason carries `name: 'TimeoutError'` because that is what this IS,
     * and because every classifier downstream reads `name`. A bare
     * `new Error('idle')` has name 'Error', so `fetchRaw` fell through to
     * `ProviderUnreachableError` and a healthy but slow model was reported as
     * "endpoint unreachable — Error: idle". That is the same novice-facing
     * harm a9d2efb fixed this morning, arriving through a different door, and
     * it breaks RUN_LIMITS.md's rule that every limit names itself when it
     * fires.
     */
    timer = setTimeout(
      () => controller.abort(Object.assign(new Error('idle'), { name: 'TimeoutError' })),
      ms,
    );
    // Never hold the event loop open for a timer whose only job is to cancel.
    timer.unref?.();
  };
  /**
   * TWO BOUNDS, because they answer different questions.
   *
   * The idle window is armed BEFORE the request is sent (the adapter passes
   * this signal to fetch), so until the first chunk arrives it is not bounding
   * silence between tokens — it is bounding connect + upload + the server's
   * prefill. On a large local model with a long prompt, prefill is legitimately
   * slow and silent, and 60s of it is normal. Holding that to the inter-token
   * bound made a working setup fail.
   *
   * So `firstChunkMs` governs until the first chunk, then `idleMs` takes over.
   * A caller that passes one value keeps the old behaviour exactly.
   */
  arm(firstChunkMs);
  return {
    signal: controller.signal,
    bump() {
      if (timer) clearTimeout(timer);
      seenChunk = true;
      arm(idleMs);
    },
    done() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    get startedStreaming() {
      return seenChunk;
    },
  };
}

/**
 * Translates an aborted BODY into a `ProviderTimeoutError` (W13-22).
 *
 * The other half of `createIdleAbort`: that arms the abort, this gives its
 * arrival a name the rest of the system already understands. Adapters
 * translate aborts around the initial fetch, but once headers arrive that
 * translation has returned — so a stall mid-stream escaped as a raw
 * `DOMException`, `isProviderError` rejected it, and nothing absorbed it into
 * a failed attempt. The run died with its ticket stranded at `in_progress`.
 *
 * A wrapper rather than a predicate because the adapter that needs it is
 * already at the 400-line cap: this way the call site changes by one line.
 */
export async function* mapAbortsToTimeout<T>(
  inner: AsyncIterable<T>,
  providerId: string,
  idleMs: number,
): AsyncGenerator<T> {
  try {
    yield* inner;
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new ProviderTimeoutError(providerId, idleMs);
    }
    throw err;
  }
}

