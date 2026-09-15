/**
 * W23-07. Every timing claim here is made with DEFERRED PROMISES the test
 * releases by hand, never with a clock. "Must finish within 100ms" is a
 * different assertion on a loaded CI runner than on a laptop, and the thing
 * being asserted — that two nodes were in flight at once — does not need a
 * clock to observe.
 */

import { describe, expect, it } from 'vitest';
import { runCheckSchedule, type SchedulableNode } from './check-scheduler.js';

/** A promise the test resolves or rejects on demand. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const node = (id: string, dependsOn: string[] = []): SchedulableNode => ({
  id,
  dependsOn,
});

/** Yields to the microtask queue so started work can register. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('independent nodes overlap; dependents wait', () => {
  it('two independent nodes are BOTH in flight before either finishes', async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const started: string[] = [];

    const run = runCheckSchedule<string>({
      nodes: [node('a'), node('b')],
      workerLimit: 4,
      sourceDigest: 'sha256:head',
      execute: async (n) => {
        started.push(n.id);
        return n.id === 'a' ? a.promise : b.promise;
      },
    });

    await settle();
    expect(started).toEqual(['a', 'b']);

    a.resolve('A');
    b.resolve('B');
    const result = await run;
    expect(result.status).toBe('complete');
    expect(result.results.get('a')).toBe('A');
  });

  it('RED FIXTURE: a dependent does not start until its predecessor has finished', async () => {
    const first = deferred<string>();
    const started: string[] = [];

    const run = runCheckSchedule<string>({
      nodes: [node('tool'), node('specialist', ['tool'])],
      workerLimit: 4,
      sourceDigest: 'sha256:head',
      execute: async (n) => {
        started.push(n.id);
        return n.id === 'tool' ? first.promise : 'S';
      },
    });

    await settle();
    expect(started).toEqual(['tool']);

    first.resolve('T');
    await run;
    expect(started).toEqual(['tool', 'specialist']);
  });

  it('the worker limit is finite and respected', async () => {
    const gates = ['a', 'b', 'c'].map(() => deferred<string>());
    const started: string[] = [];

    const run = runCheckSchedule<string>({
      nodes: [node('a'), node('b'), node('c')],
      workerLimit: 2,
      sourceDigest: 'sha256:head',
      execute: async (n) => {
        started.push(n.id);
        return gates[['a', 'b', 'c'].indexOf(n.id)]!.promise;
      },
    });

    await settle();
    expect(started).toEqual(['a', 'b']);
    gates[0]!.resolve('A');
    await settle();
    expect(started).toEqual(['a', 'b', 'c']);
    gates[1]!.resolve('B');
    gates[2]!.resolve('C');
    await run;
  });
});

describe('a node reads its own predecessors, from a snapshot nobody else can write', () => {
  it('receives exactly its declared predecessors, and a later result cannot appear in it', async () => {
    const slow = deferred<string>();
    let seen: string[] = [];

    const run = runCheckSchedule<string>({
      nodes: [node('a'), node('b'), node('c', ['a'])],
      workerLimit: 4,
      sourceDigest: 'sha256:head',
      execute: async (n, predecessors) => {
        if (n.id === 'a') return 'A';
        if (n.id === 'b') return slow.promise;
        seen = [...predecessors.keys()];
        return 'C';
      },
    });

    await settle();
    slow.resolve('B');
    await run;

    // `b` is nothing to do with `c`, and `c` must not see it even though it
    // had finished by the time `c` ran.
    expect(seen).toEqual(['a']);
  });
});

describe('failure, stop and a moving tree each refuse to look clean', () => {
  it('a failed node stops its dependents but not its independent siblings', async () => {
    const executed: string[] = [];
    const result = await runCheckSchedule<string>({
      nodes: [node('tool'), node('specialist', ['tool']), node('other')],
      workerLimit: 4,
      sourceDigest: 'sha256:head',
      execute: async (n) => {
        executed.push(n.id);
        if (n.id === 'tool') throw new Error('semgrep died');
        return n.id;
      },
    });

    expect(executed).toContain('other');
    expect(executed).not.toContain('specialist');
    expect(result.status).toBe('failed');
    expect(result.records.find((r) => r.nodeId === 'tool')?.reason).toBe('semgrep died');
    expect(result.records.find((r) => r.nodeId === 'specialist')?.outcome).toBe(
      'not_started',
    );
    // The independent evidence is real and was worth collecting.
    expect(result.results.get('other')).toBe('other');
  });

  it('RED FIXTURE: a thrown dispatch never yields a clean overall status', async () => {
    const result = await runCheckSchedule<string>({
      nodes: [node('a')],
      workerLimit: 2,
      sourceDigest: 'sha256:head',
      execute: async () => {
        throw new Error('dispatch exploded');
      },
    });
    expect(result.status).toBe('failed');
    expect(result.status).not.toBe('complete');
  });

  it('stop schedules nothing new and AWAITS what already started', async () => {
    const running = deferred<string>();
    let stop = false;
    const started: string[] = [];
    let resolvedAfterReturn = false;

    const run = runCheckSchedule<string>({
      nodes: [node('a'), node('b')],
      workerLimit: 1,
      sourceDigest: 'sha256:head',
      stopRequested: () => stop,
      execute: async (n) => {
        started.push(n.id);
        return running.promise.then((value) => {
          resolvedAfterReturn = true;
          return value;
        });
      },
    });

    await settle();
    expect(started).toEqual(['a']);
    stop = true;
    running.resolve('A');

    const result = await run;
    // The in-flight node finished BEFORE the scheduler returned — no orphan
    // promise still writing into a run that has been declared over.
    expect(resolvedAfterReturn).toBe(true);
    expect(started).toEqual(['a']);
    expect(result.status).toBe('incomplete');
    expect(result.records.find((r) => r.nodeId === 'b')?.outcome).toBe('not_started');
    expect(result.reason).toMatch(/stopped/);
  });

  it('RED FIXTURE: a source that moved during the run cannot produce a complete result', async () => {
    const result = await runCheckSchedule<string>({
      nodes: [node('a')],
      workerLimit: 2,
      sourceDigest: 'sha256:before',
      currentSourceDigest: () => 'sha256:after',
      execute: async () => 'A',
    });
    expect(result.status).toBe('incomplete');
    expect(result.reason).toMatch(/source changed/);
  });

  it('a moved tree degrades a result and never rescues one', async () => {
    const result = await runCheckSchedule<string>({
      nodes: [node('a')],
      workerLimit: 2,
      sourceDigest: 'sha256:before',
      currentSourceDigest: () => 'sha256:after',
      execute: async () => {
        throw new Error('boom');
      },
    });
    expect(result.status).toBe('failed');
  });
});

describe('a documented skip releases its dependents; anything else does not', () => {
  it('a skippable node is never executed, and its dependent still runs', async () => {
    const executed: string[] = [];
    const result = await runCheckSchedule<string>({
      nodes: [node('cloud'), node('synthesis', ['cloud'])],
      workerLimit: 4,
      sourceDigest: 'sha256:head',
      isSkippable: (id) => id === 'cloud',
      execute: async (n) => {
        executed.push(n.id);
        return n.id;
      },
    });
    expect(executed).toEqual(['synthesis']);
    expect(result.records.find((r) => r.nodeId === 'cloud')?.outcome).toBe('skipped');
    expect(result.status).toBe('complete');
  });
});

describe('the shape of the answer', () => {
  it('records come back in PLAN order, never completion order', async () => {
    const slow = deferred<string>();
    const run = runCheckSchedule<string>({
      nodes: [node('first'), node('second')],
      workerLimit: 4,
      sourceDigest: 'sha256:head',
      execute: async (n) => (n.id === 'first' ? slow.promise : 'SECOND'),
    });
    await settle();
    slow.resolve('FIRST');
    const result = await run;
    expect(result.records.map((r) => r.nodeId)).toEqual(['first', 'second']);
  });

  it('an event is emitted for every start, completion and failure', async () => {
    const events: string[] = [];
    await runCheckSchedule<string>({
      nodes: [node('ok'), node('bad')],
      workerLimit: 4,
      sourceDigest: 'sha256:head',
      onEvent: (e) => events.push(`${e.kind}:${e.nodeId}`),
      execute: async (n) => {
        if (n.id === 'bad') throw new Error('no');
        return 'ok';
      },
    });
    expect(events).toContain('node-started:ok');
    expect(events).toContain('node-completed:ok');
    expect(events).toContain('node-failed:bad');
  });
});
