import { describe, expect, it } from 'vitest';
import { createTestHandle } from './test-helpers.js';
import { insertCodeChunk } from './store.js';
import { createInMemoryCodeIndexEventSink, noopCodeIndexEventSink } from './events.js';
import { codeSearchTool } from './tool.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('codeSearchTool', () => {
  it('returns the same ranked results as codeSearch', async () => {
    const handle = createTestHandle();
    insertCodeChunk(
      handle,
      {
        path: 'src/a.ts',
        startLine: 1,
        endLine: 5,
        content: 'export function frobnicate() {}',
      },
      NOW,
    );
    const results = await codeSearchTool(
      handle,
      { actorId: 'agent-1', query: 'frobnicate' },
      { now: NOW },
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('src/a.ts');
  });

  it('emits exactly one code_index.code_search audit event per call (FR-M4: agent code_search calls are audited)', async () => {
    const handle = createTestHandle();
    insertCodeChunk(
      handle,
      {
        path: 'src/a.ts',
        startLine: 1,
        endLine: 5,
        content: 'export function frobnicate() {}',
      },
      NOW,
    );
    const sink = createInMemoryCodeIndexEventSink();
    await codeSearchTool(
      handle,
      { actorId: 'agent-1', query: 'frobnicate', topK: 5, pathFilter: 'src/**' },
      { sink, now: NOW },
    );
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toEqual({
      type: 'code_index.code_search',
      occurredAt: NOW(),
      detail: {
        actorId: 'agent-1',
        query: 'frobnicate',
        topK: 5,
        pathFilter: 'src/**',
        resultCount: 1,
      },
    });
  });

  it('does not throw when no sink is supplied (defaults to the noop sink)', async () => {
    const handle = createTestHandle();
    await expect(
      codeSearchTool(handle, { actorId: 'agent-1', query: 'nothing' }, { now: NOW }),
    ).resolves.toEqual([]);
  });

  it('the default noop sink is used verbatim when none is supplied', () => {
    expect(noopCodeIndexEventSink.emit).toBeInstanceOf(Function);
  });
});
