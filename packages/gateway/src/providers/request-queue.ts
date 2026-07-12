/**
 * Per-endpoint request queue (FR-G1): local endpoints typically serve one
 * request at a time (TECH_STACK.md "LM Studio realities"), so the default
 * concurrency is 1 — callers never fire requests in parallel at a single
 * endpoint; extra calls queue FIFO instead of thrashing the model.
 */
export class RequestQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(public readonly concurrency: number = 1) {
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

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}
