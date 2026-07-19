import { describe, expect, it } from 'vitest';
import { writeThroughVerb } from './write-through.js';
import { fakeMirrorAdapter, TEST_REF } from './mirror-test-helpers.js';
import type { MirrorWriteRequest } from './types.js';

describe('writeThroughVerb', () => {
  it('claim assigns + labels under the maker identity', async () => {
    const adapter = fakeMirrorAdapter();
    const request: MirrorWriteRequest = {
      verb: 'claim',
      assigneeLogin: 'alice',
      label: 'claimed',
    };
    const result = await writeThroughVerb(adapter, TEST_REF, 42, request);

    expect(result.identity).toBe('maker');
    expect(result.issue?.assignees).toEqual(['alice']);
    expect(result.issue?.labels).toEqual(['claimed']);
    expect(adapter.calls).toEqual([
      {
        op: 'updateIssue',
        ref: TEST_REF,
        issueNumber: 42,
        identity: 'maker',
        update: { assignees: ['alice'], labels: ['claimed'] },
      },
    ]);
  });

  it('evidence posts a plain comment under the maker identity', async () => {
    const adapter = fakeMirrorAdapter();
    const request: MirrorWriteRequest = {
      verb: 'evidence',
      body: 'ran the tests, 12 passed',
    };
    const result = await writeThroughVerb(adapter, TEST_REF, 42, request);

    expect(result.identity).toBe('maker');
    expect(result.comment?.body).toBe('ran the tests, 12 passed');
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]!.op).toBe('commentOnIssue');
  });

  it('close sets state=closed and posts a receipt comment, both under the maker identity', async () => {
    const adapter = fakeMirrorAdapter();
    const request: MirrorWriteRequest = {
      verb: 'close',
      receipt: {
        ticketId: 'W6-03',
        ownerId: 'agent-1',
        verifyCommand: 'pnpm test',
        verifyExitCode: 0,
        commits: ['abc1234'],
        files: ['packages/forge/src/mirror/index.ts'],
        mintedAt: '2026-07-18T00:00:00.000Z',
      },
    };
    const result = await writeThroughVerb(adapter, TEST_REF, 42, request);

    expect(result.identity).toBe('maker');
    expect(result.issue?.state).toBe('closed');
    expect(result.comment?.body).toContain('W6-03');
    expect(result.comment?.body).toContain('pnpm test');
    expect(adapter.calls.map((c) => c.op)).toEqual(['updateIssue', 'commentOnIssue']);
    expect(adapter.calls.every((c) => c.identity === 'maker')).toBe(true);
  });

  it('accept posts a comment under the reviewer identity, distinct from maker calls', async () => {
    const adapter = fakeMirrorAdapter();
    await writeThroughVerb(adapter, TEST_REF, 42, {
      verb: 'evidence',
      body: 'maker comment',
    });
    const acceptResult = await writeThroughVerb(adapter, TEST_REF, 42, {
      verb: 'accept',
      body: 'looks good',
    });

    expect(acceptResult.identity).toBe('reviewer');
    expect(acceptResult.comment?.authorLogin).toBe('shipwright-reviewer');
    // SC-03: the mirror timeline carries two distinct actor identities, never one identity for both.
    const identities = adapter.calls.map((c) => c.identity);
    expect(new Set(identities)).toEqual(new Set(['maker', 'reviewer']));
  });

  it('propagates non-offline adapter errors', async () => {
    const adapter = fakeMirrorAdapter({
      throwOnCall: () => new Error('boom: 422 validation failed'),
    });
    await expect(
      writeThroughVerb(adapter, TEST_REF, 42, { verb: 'evidence', body: 'x' }),
    ).rejects.toThrow('boom');
  });
});
