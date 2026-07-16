import { describe, expect, it } from 'vitest';
import { parseResetTimestamp } from './reset-time.js';

const NOON_2026_07_12 = new Date('2026-07-12T12:00:00.000Z').getTime();

describe('parseResetTimestamp', () => {
  it('returns null when no reset statement is present', () => {
    expect(
      parseResetTimestamp('rate limit exceeded, try again later', NOON_2026_07_12),
    ).toBeNull();
  });

  it('parses "resets 10:10pm" to today at 22:10 local plus the 2m buffer', () => {
    const iso = parseResetTimestamp(
      'usage limit reached, resets 10:10pm',
      NOON_2026_07_12,
    );
    expect(iso).not.toBeNull();
    const parsed = new Date(iso as string);
    const expected = new Date(NOON_2026_07_12);
    expected.setHours(22, 10, 0, 0);
    expect(parsed.getTime()).toBe(expected.getTime() + 2 * 60_000);
  });

  it('parses "resets at 3:05am" (with "at") rolling to tomorrow when already past that time today', () => {
    const nowMs = new Date('2026-07-12T12:00:00.000Z').getTime();
    const iso = parseResetTimestamp('session limit, resets at 3:05am', nowMs);
    const parsed = new Date(iso as string);
    const expected = new Date(nowMs);
    expected.setHours(3, 5, 0, 0);
    expected.setDate(expected.getDate() + 1);
    expect(parsed.getTime()).toBe(expected.getTime() + 2 * 60_000);
  });

  it('does not roll to tomorrow when the stated time has not yet passed today', () => {
    const nowMs = new Date('2026-07-12T12:00:00.000Z').getTime();
    const iso = parseResetTimestamp('resets 6:00pm', nowMs);
    const parsed = new Date(iso as string);
    const expected = new Date(nowMs);
    expected.setHours(18, 0, 0, 0);
    expect(parsed.getTime()).toBe(expected.getTime() + 2 * 60_000);
  });

  it('is case-insensitive and tolerates "reset" (singular)', () => {
    expect(parseResetTimestamp('QUOTA reset 9:00AM', NOON_2026_07_12)).not.toBeNull();
  });
});
