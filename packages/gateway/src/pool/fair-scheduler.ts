/**
 * Capacity-limited round-robin scheduler, keyed by an arbitrary partition
 * key (a project id, in every caller in this module). FR-F3/D-013: this is
 * the shared primitive behind both the per-endpoint request queue and the
 * global berth governor — "fair cross-project scheduling" and "total-berth
 * governor" are the same shape of problem (N admitted at once, everyone
 * else waits their turn) at two different layers.
 *
 * Fairness rule: a partition key enters the rotation the moment its queue
 * goes from empty to non-empty, and is re-appended to the *back* of the
 * rotation each time one of its waiters is dispatched (as long as it still
 * has more queued). A key with a deep backlog therefore gets exactly one
 * dispatch per lap around the rotation, never a burst — a shallow-backlog
 * key waiting behind it is never forced to drain the deep one first.
 */

export class FairScheduler {
  private active = 0;
  private readonly queues = new Map<string, Array<() => void>>();
  private readonly rotation: string[] = [];

  constructor(public readonly capacity: number) {
    const validInteger = Number.isInteger(capacity) && capacity >= 1;
    if (!validInteger && capacity !== Number.POSITIVE_INFINITY) {
      throw new RangeError(
        `capacity must be a positive integer or Infinity, got ${capacity}`,
      );
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    let total = 0;
    for (const q of this.queues.values()) total += q.length;
    return total;
  }

  queuedCountFor(partitionKey: string): number {
    return this.queues.get(partitionKey)?.length ?? 0;
  }

  async run<T>(partitionKey: string, task: () => Promise<T>): Promise<T> {
    await this.acquire(partitionKey);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(partitionKey: string): Promise<void> {
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.enqueue(partitionKey, () => {
        this.active += 1;
        resolve();
      });
    });
  }

  private enqueue(partitionKey: string, grant: () => void): void {
    let queue = this.queues.get(partitionKey);
    if (!queue) {
      queue = [];
      this.queues.set(partitionKey, queue);
    }
    if (queue.length === 0) {
      this.rotation.push(partitionKey);
    }
    queue.push(grant);
  }

  private release(): void {
    this.active -= 1;
    this.dispatchNext();
  }

  private dispatchNext(): void {
    while (this.active < this.capacity) {
      const key = this.rotation.shift();
      if (key === undefined) return;
      const queue = this.queues.get(key);
      if (!queue || queue.length === 0) continue;
      const grant = queue.shift()!;
      if (queue.length > 0) {
        this.rotation.push(key);
      } else {
        this.queues.delete(key);
      }
      grant();
    }
  }
}
