import { describe, expect, it } from 'vitest';
import { ForgeUnreachableError } from '../types.js';
import { attemptOrQueue, flushMirrorQueue, type QueuedMirrorWrite } from './queue.js';
import { fakeMirrorAdapter, TEST_REF } from './mirror-test-helpers.js';
import type { MirrorWriteRequest } from './types.js';

const NOW = () => '2026-07-18T00:00:00.000Z';

function evidenceRequest(body: string): MirrorWriteRequest {
  return { verb: 'evidence', body };
}

describe('attemptOrQueue', () => {
  it('returns the write result and an unchanged queue when the forge is reachable', async () => {
    const adapter = fakeMirrorAdapter();
    const outcome = await attemptOrQueue(
      adapter,
      TEST_REF,
      1,
      evidenceRequest('a'),
      [],
      NOW,
    );
    expect(outcome.result).not.toBeNull();
    expect(outcome.queue).toEqual([]);
  });

  it('queues the write (order-preserving append) when the forge is unreachable', async () => {
    const adapter = fakeMirrorAdapter({
      throwOnCall: () => new ForgeUnreachableError('fake', new Error('ECONNREFUSED')),
    });
    const outcome = await attemptOrQueue(
      adapter,
      TEST_REF,
      1,
      evidenceRequest('a'),
      [],
      NOW,
    );
    expect(outcome.result).toBeNull();
    expect(outcome.queue).toHaveLength(1);
    expect(outcome.queue[0]).toMatchObject({
      issueNumber: 1,
      request: evidenceRequest('a'),
      queuedAt: NOW(),
      attempts: 0,
    });
  });

  it('appends to an existing queue rather than replacing it', async () => {
    const existing: QueuedMirrorWrite[] = [
      { issueNumber: 1, request: evidenceRequest('first'), queuedAt: NOW(), attempts: 0 },
    ];
    const adapter = fakeMirrorAdapter({
      throwOnCall: () => new ForgeUnreachableError('fake', new Error('down')),
    });
    const outcome = await attemptOrQueue(
      adapter,
      TEST_REF,
      2,
      evidenceRequest('second'),
      existing,
      NOW,
    );
    expect(outcome.queue).toHaveLength(2);
    expect((outcome.queue[0] as QueuedMirrorWrite).request).toEqual(
      evidenceRequest('first'),
    );
    expect((outcome.queue[1] as QueuedMirrorWrite).request).toEqual(
      evidenceRequest('second'),
    );
  });

  it('propagates non-offline errors instead of queuing them', async () => {
    const adapter = fakeMirrorAdapter({
      throwOnCall: () => new Error('401 unauthorized'),
    });
    await expect(
      attemptOrQueue(adapter, TEST_REF, 1, evidenceRequest('a'), [], NOW),
    ).rejects.toThrow('401');
  });
});

describe('flushMirrorQueue', () => {
  it('flushes every entry in order when the forge is reachable', async () => {
    const adapter = fakeMirrorAdapter();
    const queue: QueuedMirrorWrite[] = [
      { issueNumber: 1, request: evidenceRequest('one'), queuedAt: NOW(), attempts: 0 },
      { issueNumber: 1, request: evidenceRequest('two'), queuedAt: NOW(), attempts: 0 },
      { issueNumber: 1, request: evidenceRequest('three'), queuedAt: NOW(), attempts: 0 },
    ];
    const outcome = await flushMirrorQueue(adapter, TEST_REF, queue);

    expect(outcome.remaining).toEqual([]);
    expect(outcome.flushed).toHaveLength(3);
    // Order-preserving: the adapter saw the bodies in the same order they were queued.
    expect(adapter.calls.map((c) => c.body)).toEqual(['one', 'two', 'three']);
  });

  it('stops at the first failure and keeps the rest queued, not skipping ahead', async () => {
    const adapter = fakeMirrorAdapter({
      // Fail on the 2nd call (index 1) only.
      throwOnCall: (i) =>
        i === 1 ? new ForgeUnreachableError('fake', new Error('down')) : undefined,
    });
    const queue: QueuedMirrorWrite[] = [
      { issueNumber: 1, request: evidenceRequest('one'), queuedAt: NOW(), attempts: 0 },
      { issueNumber: 1, request: evidenceRequest('two'), queuedAt: NOW(), attempts: 0 },
      { issueNumber: 1, request: evidenceRequest('three'), queuedAt: NOW(), attempts: 0 },
    ];
    const outcome = await flushMirrorQueue(adapter, TEST_REF, queue);

    expect(outcome.flushed).toHaveLength(1);
    expect(outcome.flushed[0]!.entry.request).toEqual(evidenceRequest('one'));
    expect(outcome.remaining).toHaveLength(2);
    expect(outcome.remaining[0]).toMatchObject({
      request: evidenceRequest('two'),
      attempts: 1,
    });
    expect(outcome.remaining[1]).toMatchObject({
      request: evidenceRequest('three'),
      attempts: 0,
    });
    // "three" must never have been attempted — order-preserving means it never got a chance yet.
    expect(adapter.calls.map((c) => c.body)).toEqual(['one', 'two']);
  });

  it('converges to fully flushed across repeated reconnect attempts', async () => {
    let downUntilCall = 1; // first flush call goes offline, second succeeds
    const adapter = fakeMirrorAdapter({
      throwOnCall: (i) =>
        i === downUntilCall
          ? new ForgeUnreachableError('fake', new Error('down'))
          : undefined,
    });
    let queue: QueuedMirrorWrite[] = [
      { issueNumber: 1, request: evidenceRequest('one'), queuedAt: NOW(), attempts: 0 },
      { issueNumber: 1, request: evidenceRequest('two'), queuedAt: NOW(), attempts: 0 },
    ];

    const firstAttempt = await flushMirrorQueue(adapter, TEST_REF, queue);
    expect(firstAttempt.flushed).toHaveLength(1);
    queue = firstAttempt.remaining;
    expect(queue).toHaveLength(1);

    downUntilCall = -1; // reachable again
    const secondAttempt = await flushMirrorQueue(adapter, TEST_REF, queue);
    expect(secondAttempt.remaining).toEqual([]);
    expect(secondAttempt.flushed).toHaveLength(1);
    expect(secondAttempt.flushed[0]!.entry.request).toEqual(evidenceRequest('two'));
  });

  it('propagates non-offline errors instead of silently queuing forever', async () => {
    const adapter = fakeMirrorAdapter({ throwOnCall: () => new Error('422 validation') });
    const queue: QueuedMirrorWrite[] = [
      { issueNumber: 1, request: evidenceRequest('one'), queuedAt: NOW(), attempts: 0 },
    ];
    await expect(flushMirrorQueue(adapter, TEST_REF, queue)).rejects.toThrow('422');
  });
});
