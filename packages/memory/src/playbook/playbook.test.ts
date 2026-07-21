import { describe, expect, it } from 'vitest';
import {
  UnconfirmedPlaybookEntryError,
  getPlaybookEntryById,
  getPlaybookHead,
  insertPlaybookEntry,
  listPlaybookHistory,
  normalizePlaybookTaskClass,
} from './playbook.js';
import { createTestHandle } from './test-helpers.js';

const NOW = () => '2026-07-20T12:00:00.000Z';
const LATER = () => '2026-07-20T13:00:00.000Z';

describe('insertPlaybookEntry', () => {
  it('FR-M2: rejects an entry with no tool/challenger confirmation', () => {
    const handle = createTestHandle();
    expect(() =>
      insertPlaybookEntry(
        handle,
        // @ts-expect-error deliberately bypassing the type to prove the runtime check
        { taskClass: 'x', entry: 'y', verifiedBy: 'self-reported' },
        NOW,
      ),
    ).toThrow(UnconfirmedPlaybookEntryError);
  });

  it('rejects a missing verifiedBy the same way', () => {
    const handle = createTestHandle();
    expect(() =>
      insertPlaybookEntry(
        handle,
        // @ts-expect-error deliberately omitting a required field
        { taskClass: 'x', entry: 'y' },
        NOW,
      ),
    ).toThrow(UnconfirmedPlaybookEntryError);
  });

  it('stores a tool-confirmed entry as version 1 with no delta parent', () => {
    const handle = createTestHandle();
    const entry = insertPlaybookEntry(
      handle,
      { taskClass: 'flaky-timeout-fix', entry: 'retry with backoff', verifiedBy: 'tool' },
      NOW,
    );
    expect(entry.version).toBe(1);
    expect(entry.deltaOf).toBeNull();
    expect(entry.retiredAt).toBeNull();
    expect(getPlaybookHead(handle, 'flaky-timeout-fix')?.id).toBe(entry.id);
  });

  it("is delta-edit-only: a second entry for the same task class never mutates the first row's text", () => {
    const handle = createTestHandle();
    const v1 = insertPlaybookEntry(
      handle,
      { taskClass: 'cold-start-enoent', entry: 'v1: mkdir -p first', verifiedBy: 'tool' },
      NOW,
    );
    const v2 = insertPlaybookEntry(
      handle,
      {
        taskClass: 'cold-start-enoent',
        entry: 'v2: mkdir -p first, then retry once',
        verifiedBy: 'challenger',
      },
      LATER,
    );

    expect(v2.version).toBe(2);
    expect(v2.deltaOf).toBe(v1.id);

    const history = listPlaybookHistory(handle, 'cold-start-enoent');
    expect(history).toHaveLength(2);
    const storedV1 = getPlaybookEntryById(handle, v1.id);
    expect(storedV1?.entry).toBe('v1: mkdir -p first');
    expect(storedV1?.retiredAt).toBe('2026-07-20T13:00:00.000Z');

    expect(getPlaybookHead(handle, 'cold-start-enoent')?.id).toBe(v2.id);
  });

  it('normalizes taskClass at store time, so casing/whitespace variants find the same head and delta-edit it, not fork a new one', () => {
    const handle = createTestHandle();
    const v1 = insertPlaybookEntry(
      handle,
      { taskClass: 'Flaky Timeout Fix', entry: 'retry with backoff', verifiedBy: 'tool' },
      NOW,
    );
    expect(v1.taskClass).toBe('flaky timeout fix');

    const v2 = insertPlaybookEntry(
      handle,
      {
        taskClass: '  flaky   timeout FIX  ',
        entry: 'retry with backoff, capped at 3 attempts',
        verifiedBy: 'challenger',
      },
      LATER,
    );
    expect(v2.taskClass).toBe('flaky timeout fix');
    expect(v2.version).toBe(2);
    expect(v2.deltaOf).toBe(v1.id);

    const history = listPlaybookHistory(handle, 'flaky timeout fix');
    expect(history).toHaveLength(2);
    expect(getPlaybookEntryById(handle, v1.id)?.retiredAt).toBe(LATER());

    expect(
      getPlaybookHead(handle, normalizePlaybookTaskClass('FLAKY TIMEOUT FIX'))?.id,
    ).toBe(v2.id);
  });
});

describe('normalizePlaybookTaskClass', () => {
  it('is exact-match only (trim/lowercase/collapse whitespace), never fuzzy', () => {
    expect(normalizePlaybookTaskClass('  The Thing   Works  ')).toBe('the thing works');
    expect(normalizePlaybookTaskClass('the thing works')).toBe('the thing works');
  });
});
