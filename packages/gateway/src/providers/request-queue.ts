/**
 * Per-endpoint request queue (FR-G1): local endpoints typically serve one
 * request at a time (TECH_STACK.md "LM Studio realities"), so the default
 * concurrency is 1 — callers never fire requests in parallel at a single
 * endpoint; extra calls queue FIFO instead of thrashing the model.
 */
/**
 * How long a caller may wait for a slot before giving up (W13-42).
 *
 * Generous on purpose: several berths sharing one endpoint queue legitimately,
 * and a bound that fired on honest contention would turn a working setup into
 * spurious infrastructure failures. Five minutes is far longer than any real
 * queue wait observed and far shorter than the forever a held slot produced.
 */
export const DEFAULT_QUEUE_ACQUIRE_MS = 300_000;

interface Waiter {
  readonly grant: () => void;
  cancelled: boolean;
}

export class RequestQueue {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    public readonly concurrency: number = 1,
    /**
     * W13-42, second half. The bound lives HERE rather than at a call site,
     * because there are two call sites and only one of them was fixed the
     * first time: `chatStream()` went through `runQueuedStream`, which got a
     * bound, while `chat()` calls `run()` directly and kept waiting forever.
     * Measured: a run sat at `running` for 10 minutes with the node process at
     * 1.2% CPU and LM Studio answering an unrelated completion in 0.3s — the
     * request had never been sent. A guard that protects one of two paths
     * protects neither.
     *
     * 0 disables the bound.
     */
    public readonly acquireTimeoutMs: number = DEFAULT_QUEUE_ACQUIRE_MS,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /** Exposed so a streamed call can hold a slot across a generator's lifetime. */
  async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    const waiter: Waiter = { grant: () => undefined, cancelled: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        (waiter as { grant: () => void }).grant = () => {
          this.active += 1;
          resolve();
        };
        this.waiters.push(waiter);
        if (this.acquireTimeoutMs <= 0) return;
        timer = setTimeout(() => {
          // REMOVED from the queue, not just rejected. A waiter left in place
          // would be handed the next released slot and increment `active`
          // with nobody to release it — the same wedge, one layer down.
          // Built BEFORE leaving the queue, so the depth it reports is the
          // depth at the moment of giving up rather than one short of it.
          const err = new QueueAcquireTimeoutError(this.acquireTimeoutMs, this);
          // REMOVED from the queue, not just rejected. A waiter left in place
          // would be handed the next released slot and increment `active`
          // with nobody to release it — the same wedge, one layer down.
          waiter.cancelled = true;
          const at = this.waiters.indexOf(waiter);
          if (at >= 0) this.waiters.splice(at, 1);
          reject(err);
        }, this.acquireTimeoutMs);
        // Never hold the event loop open for a timer whose only job is to give up.
        timer.unref?.();
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Releases a slot taken by `acquire()`. */
  releaseSlot(): void {
    this.release();
  }

  private release(): void {
    this.active -= 1;
    // Skip anyone who gave up while waiting: granting a cancelled waiter would
    // raise `active` for a caller that is already gone.
    for (;;) {
      const next = this.waiters.shift();
      if (!next) return;
      if (next.cancelled) continue;
      next.grant();
      return;
    }
  }
}

/** Named so callers can map it to their own timeout error (adapters raise `ProviderTimeoutError`). */
export class QueueAcquireTimeoutError extends Error {
  /** Depth AT THE MOMENT OF GIVING UP — the waiter leaves the queue straight after. */
  readonly active: number;
  readonly queued: number;

  constructor(
    readonly timeoutMs: number,
    queue: RequestQueue,
  ) {
    super(
      `timed out after ${timeoutMs}ms waiting for a request-queue slot ` +
        `(${queue.activeCount} active, ${queue.queuedCount} queued)`,
    );
    this.active = queue.activeCount;
    this.queued = queue.queuedCount;
    this.name = 'QueueAcquireTimeoutError';
  }
}
