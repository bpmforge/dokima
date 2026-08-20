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
import { ProviderTimeoutError } from './errors.js';
import { DEFAULT_QUEUE_ACQUIRE_MS } from './oai-compat-types.js';

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
  /** W13-42: how long to wait for a slot. Omit for the default; 0 disables the bound. */
  acquireTimeoutMs: number = DEFAULT_QUEUE_ACQUIRE_MS,
  providerId = 'provider',
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

  try {
    await waitForSlot(acquired, acquireTimeoutMs, providerId, queue);
  } catch (err) {
    // ALWAYS let the queued task finish, even though we never got the slot.
    // `queue.run(...)` above already pushed a waiter; if that waiter later
    // acquires and finds `finished` unresolved, it holds the slot forever and
    // `RequestQueue.run`'s finally never releases it. The bound added here to
    // stop one wedge would then cause the next one: holder releases, the
    // orphaned waiter takes the slot, and the queue is dead. Caught in review
    // and pinned by "a timed-out waiter must not wedge the queue".
    signalDone();
    // NOT awaited: when the holder never releases, `queued` never settles, and
    // awaiting it here would hang the very call we are trying to fail fast.
    // Resolving `finished` is enough — whenever that waiter does acquire, its
    // task returns immediately and `RequestQueue.run`'s finally releases.
    void queued.catch(() => undefined);
    throw err;
  }
  try {
    yield* source();
  } finally {
    signalDone();
    await queued;
  }
}

/**
 * Waits for the queue slot, but not forever (W13-42).
 *
 * MEASURED, and it is the founder-reported failure class: a ticket ran on a
 * local model and the run sat at `running` for 25+ minutes with ZERO events
 * after a single `session.turn_started`. LM Studio was healthy the whole time
 * — `/v1/models` in 1ms, a completion on the same model in 0.36s. The product
 * was hung, not the endpoint, and the only way out was a person restarting it.
 *
 * The 60s idle abort (W13-15) could not help: it is armed INSIDE the stream,
 * and the stream had not started. This `await` came first and had no bound at
 * all, so a slot that was never released stopped every later call to that
 * provider — `RequestQueue` defaults to concurrency 1, and the slot above is
 * released only by the generator's `finally`, so one abandoned stream is
 * enough.
 *
 * The bound does not punish honest queueing: several berths sharing one
 * endpoint legitimately wait, which is why the default is generous and this is
 * a timeout rather than a refusal to queue. Finding the abandonment path that
 * leaks a slot is separate work; this makes the product recover instead of
 * needing a person to kickstart it.
 *
 * Raises `ProviderTimeoutError` — the shape the rest of the system already
 * reads as infrastructure, so W13-27 retries it for free rather than spending
 * a ladder rung on it.
 */
async function waitForSlot(
  acquired: Promise<void>,
  timeoutMs: number,
  providerId: string,
  queue: RequestQueue,
): Promise<void> {
  if (timeoutMs <= 0) return acquired;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      acquired,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new ProviderTimeoutError(
              `${providerId} (waiting for a request-queue slot; ` +
                `${queue.activeCount} active, ${queue.queuedCount} queued)`,
              timeoutMs,
            ),
          );
        }, timeoutMs);
        // Never hold the event loop open for a timer whose only job is to give up.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
}

export function createIdleAbort(idleMs: number): IdleAbort {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    timer = setTimeout(() => controller.abort(new Error('idle')), idleMs);
    // Never hold the event loop open for a timer whose only job is to cancel.
    timer.unref?.();
  };
  arm();
  return {
    signal: controller.signal,
    bump() {
      if (timer) clearTimeout(timer);
      arm();
    },
    done() {
      if (timer) clearTimeout(timer);
      timer = undefined;
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

