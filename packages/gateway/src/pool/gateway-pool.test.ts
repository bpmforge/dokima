import { describe, expect, it } from 'vitest';
import { GatewayPool } from './gateway-pool.js';

describe('GatewayPool', () => {
  it('defaults an endpoint to concurrency 1 (FR-G1)', async () => {
    const pool = new GatewayPool();
    let concurrentPeak = 0;
    let concurrent = 0;

    const task = async () => {
      concurrent += 1;
      concurrentPeak = Math.max(concurrentPeak, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
    };

    await Promise.all([
      pool.run('lmstudio', 'proj-a', task),
      pool.run('lmstudio', 'proj-b', task),
    ]);
    expect(concurrentPeak).toBe(1);
  });

  it('honors a per-endpoint concurrency override', async () => {
    const pool = new GatewayPool({ endpointConcurrency: { 'multi-slot': 2 } });
    let concurrentPeak = 0;
    let concurrent = 0;

    const task = async () => {
      concurrent += 1;
      concurrentPeak = Math.max(concurrentPeak, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
    };

    await Promise.all([
      pool.run('multi-slot', 'proj-a', task),
      pool.run('multi-slot', 'proj-b', task),
      pool.run('multi-slot', 'proj-c', task),
    ]);
    expect(concurrentPeak).toBe(2);
  });

  it('keeps separate endpoints independent (no cross-endpoint contention)', async () => {
    const pool = new GatewayPool();
    const order: string[] = [];

    await Promise.all([
      pool.run('endpoint-a', 'proj-1', async () => {
        order.push('a1');
      }),
      pool.run('endpoint-b', 'proj-1', async () => {
        order.push('b1');
      }),
    ]);
    expect(order.sort()).toEqual(['a1', 'b1']);
    expect(pool.activeCount('endpoint-a')).toBe(0);
    expect(pool.activeCount('endpoint-b')).toBe(0);
  });

  it('two autorunning projects interleave fairly on one single-slot endpoint, no starvation (FR-F3/US-805)', async () => {
    // "Autorunning" project A keeps a deep backlog queued against the one
    // fake endpoint; project B is a second autorunning project sharing the
    // same host. Under naive FIFO, B would wait behind all of A's backlog.
    const pool = new GatewayPool(); // default concurrency 1 == "one single-slot fake endpoint"
    const order: string[] = [];

    const submit = (project: string, label: string) =>
      pool.run('shared-lmstudio', project, async () => {
        order.push(label);
      });

    const results = [
      submit('project-a', 'A0'),
      submit('project-a', 'A1'),
      submit('project-a', 'A2'),
      submit('project-a', 'A3'),
      submit('project-b', 'B0'),
      submit('project-b', 'B1'),
    ];

    await Promise.all(results);

    // B is admitted within one round-robin lap of arriving, not after A's
    // entire backlog drains — the request-order assertion FR-F3 requires.
    expect(order.indexOf('B0')).toBeLessThan(order.indexOf('A3'));
    expect(order[0]).toBe('A0');
    expect(order).toHaveLength(6);
    expect(new Set(order).size).toBe(6);
  });
});
