import { describe, expect, it } from 'vitest';
import { RequestQueue } from './request-queue.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('RequestQueue', () => {
  it('rejects a non-positive-integer concurrency', () => {
    expect(() => new RequestQueue(0)).toThrow(RangeError);
    expect(() => new RequestQueue(-1)).toThrow(RangeError);
    expect(() => new RequestQueue(1.5)).toThrow(RangeError);
  });

  it('runs one task at a time by default (local endpoints, FR-G1)', async () => {
    const queue = new RequestQueue();
    const order: string[] = [];
    const gate = deferred<void>();

    const first = queue.run(async () => {
      order.push('first-start');
      await gate.promise;
      order.push('first-end');
    });

    // Second task is queued behind the first; it must not start yet.
    const second = queue.run(async () => {
      order.push('second-start');
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['first-start']);
    expect(queue.activeCount).toBe(1);
    expect(queue.queuedCount).toBe(1);

    gate.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('allows N tasks in flight when concurrency > 1', async () => {
    const queue = new RequestQueue(2);
    let concurrentPeak = 0;
    let concurrent = 0;

    const task = async () => {
      concurrent += 1;
      concurrentPeak = Math.max(concurrentPeak, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
    };

    await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
    expect(concurrentPeak).toBe(2);
  });

  it('releases the slot even when the task throws', async () => {
    const queue = new RequestQueue(1);
    await expect(
      queue.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(queue.activeCount).toBe(0);
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok');
  });
});
