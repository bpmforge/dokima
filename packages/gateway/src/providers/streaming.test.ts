/**
 * W13-15. The founder's point: "as long as it's streaming responses we should
 * be leaving it open, not having arbitrary timeouts."
 */
import { describe, expect, it, vi } from 'vitest';
import { createIdleAbort, readSseDataLines } from './streaming.js';

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
