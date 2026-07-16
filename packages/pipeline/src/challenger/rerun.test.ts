import { describe, expect, it } from 'vitest';
import { formatRerunLine, isValidRerun } from './rerun.js';

describe('isValidRerun (R-B2)', () => {
  it('accepts a well-formed evidence record', () => {
    expect(
      isValidRerun({ command: 'pnpm test', counts: { passed: 1 }, exitCode: 0 }),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    { command: '', counts: { a: 1 }, exitCode: 0 },
    { command: '   ', counts: { a: 1 }, exitCode: 0 },
    { command: 'x', counts: {}, exitCode: 0 },
    { command: 'x', counts: { a: 1 }, exitCode: 1.5 },
  ])('rejects malformed input: %j', (input) => {
    expect(isValidRerun(input as never)).toBe(false);
  });
});

describe('formatRerunLine', () => {
  it('renders the literal re-ran independently line', () => {
    const line = formatRerunLine({
      command: 'pnpm test',
      counts: { passed: 3 },
      exitCode: 0,
    });
    expect(line).toBe('re-ran independently: pnpm test, counts={"passed":3}, exit 0');
  });
});
