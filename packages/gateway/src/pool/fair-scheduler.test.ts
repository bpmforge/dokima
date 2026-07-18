import { describe, expect, it } from 'vitest';
import { FairScheduler } from './fair-scheduler.js';

describe('FairScheduler', () => {
  it('rejects an invalid capacity', () => {
    expect(() => new FairScheduler(0)).toThrow(RangeError);
    expect(() => new FairScheduler(-1)).toThrow(RangeError);
    expect(() => new FairScheduler(1.5)).toThrow(RangeError);
  });

  it('accepts Infinity as an ungoverned capacity', async () => {
    const scheduler = new FairScheduler(Number.POSITIVE_INFINITY);
    const order: string[] = [];
    await Promise.all(
      ['a', 'b', 'c'].map((label) =>
        scheduler.run('p', async () => {
          order.push(label);
        }),
      ),
    );
    expect(order).toHaveLength(3);
    expect(scheduler.activeCount).toBe(0);
  });

  it('releases the slot even when the task throws', async () => {
    const scheduler = new FairScheduler(1);
    await expect(
      scheduler.run('p', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(scheduler.activeCount).toBe(0);
    await expect(scheduler.run('p', async () => 'ok')).resolves.toBe('ok');
  });

  it('does not starve a shallow-backlog key behind a deep one (FR-F3/US-805)', async () => {
    // A single-slot endpoint: partition 'A' arrives with a D-deep backlog
    // (all submitted synchronously, so it is fully queued before 'B'
    // arrives), then partition 'B' arrives with exactly one request. Under
    // plain FIFO ordering B would start at position D+1 — growing without
    // bound as A's backlog grows. Under fair round-robin, B's start
    // position must stay constant regardless of D: that is the
    // discriminating property, not any one hardcoded full order.
    for (const depth of [2, 8]) {
      const scheduler = new FairScheduler(1);
      const order: string[] = [];
      const results: Array<Promise<void>> = [];

      for (let i = 0; i < depth; i += 1) {
        const label = `A${i}`;
        results.push(
          scheduler.run('A', async () => {
            order.push(label);
          }),
        );
      }
      results.push(
        scheduler.run('B', async () => {
          order.push('B0');
        }),
      );

      await Promise.all(results);

      expect(order[0]).toBe('A0');
      expect(order[1]).toBe('A1');
      expect(order.indexOf('B0')).toBe(2);
    }
  });

  it('interleaves two backlogged partitions round-robin, one dispatch per lap', async () => {
    const scheduler = new FairScheduler(1);
    const order: string[] = [];

    const submit = (project: string, label: string) =>
      scheduler.run(project, async () => {
        order.push(label);
      });

    const results = [
      submit('A', 'A0'),
      submit('A', 'A1'),
      submit('A', 'A2'),
      submit('B', 'B0'),
      submit('B', 'B1'),
      submit('B', 'B2'),
    ];

    await Promise.all(results);

    expect(order).toEqual(['A0', 'A1', 'B0', 'A2', 'B1', 'B2']);
    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.queuedCount).toBe(0);
  });

  it('allows N tasks in flight when capacity > 1, still fair per key', async () => {
    const scheduler = new FairScheduler(2);
    let concurrentPeak = 0;
    let concurrent = 0;

    const task = async () => {
      concurrent += 1;
      concurrentPeak = Math.max(concurrentPeak, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
    };

    await Promise.all([
      scheduler.run('A', task),
      scheduler.run('A', task),
      scheduler.run('B', task),
      scheduler.run('B', task),
    ]);
    expect(concurrentPeak).toBe(2);
  });
});
