/**
 * W13-15. The founder's point: "as long as it's streaming responses we should
 * be leaving it open, not having arbitrary timeouts."
 */
import { describe, expect, it, vi } from 'vitest';
import { createIdleAbort, readSseDataLines, runQueuedStream } from './streaming.js';
import { RequestQueue } from './request-queue.js';

function sse(chunks: readonly string[], gapMs = 0): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= chunks.length) return controller.close();
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
      controller.enqueue(enc.encode(`data: ${chunks[i++]}\n\n`));
    },
  });
}

describe('an idle bound, not a duration bound (W13-15)', () => {
  it(
    'RED FIXTURE: a stream that keeps producing is NOT aborted, however long it ' +
      'runs. AbortSignal.timeout() killed a healthily-generating local model at ' +
      'exactly the moment it killed a hung one',
    async () => {
      const idle = createIdleAbort(60);
      const seen: string[] = [];
      // Six chunks at 30ms — 180ms total, three times the idle bound, but
      // never quiet for longer than half of it.
      for await (const line of readSseDataLines(
        sse(['a', 'b', 'c', 'd', 'e', 'f'], 30),
        idle.bump,
      )) {
        seen.push(line);
      }
      idle.done();
      expect(seen).toHaveLength(6);
      expect(idle.signal.aborted).toBe(false);
    },
  );

  it('a stream that goes quiet longer than the bound IS aborted', async () => {
    const idle = createIdleAbort(40);
    await new Promise((r) => setTimeout(r, 90));
    expect(idle.signal.aborted).toBe(true);
    idle.done();
  });

  it('bump() restarts the window rather than extending it once', async () => {
    const idle = createIdleAbort(60);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 30));
      idle.bump();
    }
    expect(idle.signal.aborted).toBe(false);
    idle.done();
  });

  it(
    'done() clears the timer — an idle guard that outlives its stream would ' +
      'hold the process open',
    async () => {
      const idle = createIdleAbort(30);
      idle.done();
      await new Promise((r) => setTimeout(r, 70));
      expect(idle.signal.aborted).toBe(false);
    },
  );
});

describe('readSseDataLines reports progress (W13-15)', () => {
  it('calls back per chunk, which is what the idle bound measures', async () => {
    const onChunk = vi.fn();
    const seen: string[] = [];
    for await (const line of readSseDataLines(sse(['x', 'y', 'z']), onChunk)) {
      seen.push(line);
    }
    expect(seen).toEqual(['x', 'y', 'z']);
    expect(onChunk).toHaveBeenCalledTimes(3);
  });

  it('still works with no callback — every existing caller passes none', async () => {
    const seen: string[] = [];
    for await (const line of readSseDataLines(sse(['x']))) seen.push(line);
    expect(seen).toEqual(['x']);
  });
});

/**
 * W13-42. The founder-reported failure: a session that never ends and has to
 * be kickstarted by hand. Reproduced in our own product against a healthy
 * endpoint — the run sat at `running` for 25+ minutes with no events after a
 * single `session.turn_started`, while LM Studio answered a completion on the
 * same model in 0.36s.
 */
describe('waiting for a queue slot is bounded (W13-42)', () => {
  /** Holds the queue's only slot open forever, the way a leaked stream does. */
  function saturate(queue: RequestQueue): void {
    void queue.run(() => new Promise<never>(() => {}));
  }

  it('RED FIXTURE: a slot that is never released FAILS the next call instead of hanging it', async () => {
    vi.useFakeTimers();
    try {
      const queue = new RequestQueue(1);
      saturate(queue);
      await vi.advanceTimersByTimeAsync(0);

      const blocked = (async () => {
        for await (const chunk of runQueuedStream(queue, function* () {
          yield 'never reached';
        } as unknown as () => AsyncGenerator<string>)) {
          // The generator must never start: the slot is gone.
          expect(chunk).toBeUndefined();
        }
      })();
      const settled = expect(blocked).rejects.toThrow(/timed out/);

      // Asserted against the clock, not by waiting: a test that really waited
      // five minutes would be skipped by whoever hit it next.
      await vi.advanceTimersByTimeAsync(300_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the queue and its depth, so the message points somewhere', async () => {
    vi.useFakeTimers();
    try {
      const queue = new RequestQueue(1);
      saturate(queue);
      await vi.advanceTimersByTimeAsync(0);

      const blocked = (async () => {
        for await (const chunk of runQueuedStream(
          queue,
          function* () {
            yield 'x';
          } as unknown as () => AsyncGenerator<string>,
          1_000,
          'lm-studio',
        )) {
          expect(chunk).toBeUndefined();
        }
      })();
      const settled = expect(blocked).rejects.toThrow(
        /lm-studio \(waiting for a request-queue slot; 1 active, 1 queued\)/,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('honest queueing still succeeds — the bound is a timeout, not a refusal to wait', async () => {
    const queue = new RequestQueue(1);
    let release!: () => void;
    void queue.run(() => new Promise<void>((resolve) => (release = resolve)));
    await Promise.resolve();

    const collected: string[] = [];
    const consuming = (async () => {
      for await (const chunk of runQueuedStream(queue, function* () {
        yield 'queued behind someone else';
      } as unknown as () => AsyncGenerator<string>)) {
        collected.push(chunk);
      }
    })();

    release();
    await consuming;
    expect(collected).toEqual(['queued behind someone else']);
  });
});

/**
 * The bound added in W13-42 can cause the wedge it exists to prevent. Kept as
 * its own test because the three above cannot see it: the timeout cases use a
 * holder that never releases, and the success case never times out. Only a
 * holder that times someone out and THEN releases exposes it.
 */
describe('the queue bound must not wedge the queue it protects (W13-42)', () => {
  it('a timed-out waiter leaves the slot usable once the holder releases', async () => {
    const queue = new RequestQueue(1);
    let release!: () => void;
    void queue.run(() => new Promise<void>((resolve) => (release = resolve)));
    await Promise.resolve();

    await expect(
      (async () => {
        for await (const chunk of runQueuedStream(
          queue,
          function* () {
            yield 'timed out';
          } as unknown as () => AsyncGenerator<string>,
          50,
          'p',
        )) {
          expect(chunk).toBeUndefined();
        }
      })(),
    ).rejects.toThrow(/timed out/);

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const got: string[] = [];
    await Promise.race([
      (async () => {
        for await (const chunk of runQueuedStream(
          queue,
          function* () {
            yield 'ran';
          } as unknown as () => AsyncGenerator<string>,
          2_000,
          'p',
        )) {
          got.push(chunk);
        }
      })(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('the queue is wedged')), 1_500),
      ),
    ]);
    expect(got).toEqual(['ran']);
  });
});
