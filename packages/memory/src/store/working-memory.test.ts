import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteHandle } from './handle.js';
import { createTestHandle } from './test-helpers.js';
import {
  insertWorkingFinding,
  listWorkingFindings,
  resolveWorkingFinding,
} from './working-memory.js';

const NOW = () => '2026-07-20T12:00:00.000Z';

describe('working memory store', () => {
  let handle: SqliteHandle;

  beforeEach(() => {
    handle = createTestHandle();
  });

  it('inserts a finding unresolved by default', () => {
    const finding = insertWorkingFinding(
      handle,
      { runId: 'run-1', summary: 'possible race in claim loop' },
      NOW,
    );
    expect(finding.resolved).toBe(false);
    expect(finding.createdAt).toBe(NOW());
  });

  it('resolveWorkingFinding flips resolved', () => {
    const finding = insertWorkingFinding(handle, { summary: 's' }, NOW);
    resolveWorkingFinding(handle, finding.id);
    expect(listWorkingFindings(handle, { unresolvedOnly: true })).toHaveLength(0);
  });

  it('lists by runId and ticketId independently', () => {
    insertWorkingFinding(handle, { runId: 'run-1', summary: 'a' }, NOW);
    insertWorkingFinding(handle, { ticketId: 'W7-01', summary: 'b' }, NOW);
    insertWorkingFinding(handle, { summary: 'c' }, NOW);

    expect(listWorkingFindings(handle, { runId: 'run-1' })).toHaveLength(1);
    expect(listWorkingFindings(handle, { ticketId: 'W7-01' })).toHaveLength(1);
    expect(listWorkingFindings(handle)).toHaveLength(3);
  });
});
