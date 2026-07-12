import { describe, expect, it } from 'vitest';
import { parseValidatorOutput } from './contract.js';

describe('parseValidatorOutput', () => {
  it('parses the standard _lib.sh envelope', () => {
    const stdout = '{"validator":"validate-adrs","gaps":0,"exit":0,"items":[]}\n';
    expect(parseValidatorOutput(stdout)).toEqual({ gapCount: 0, gaps: [] });
  });

  it('parses gap items with category/detail', () => {
    const stdout = JSON.stringify({
      validator: 'validate-no-ascii-art',
      gaps: 2,
      exit: 1,
      items: [
        { category: 'banner-ascii', detail: 'docs/x.md:3 — ASCII = banner' },
        { category: 'box-drawing', detail: 'docs/x.md:9 — box char' },
      ],
    });
    expect(parseValidatorOutput(stdout)).toEqual({
      gapCount: 2,
      gaps: [
        { category: 'banner-ascii', detail: 'docs/x.md:3 — ASCII = banner' },
        { category: 'box-drawing', detail: 'docs/x.md:9 — box char' },
      ],
    });
  });

  it('accepts a bare JSON array of findings', () => {
    const stdout = JSON.stringify([{ category: 'x', detail: 'y' }, { detail: 'z' }]);
    const parsed = parseValidatorOutput(stdout);
    expect(parsed?.gapCount).toBe(2);
    expect(parsed?.gaps[1]).toEqual({ category: 'finding', detail: 'z' });
  });

  it('accepts NDJSON (one JSON object per line)', () => {
    const stdout = [
      '{"file":"docs/a.md","line":3,"code":"M001","message":"unquoted slash"}',
      '{"file":"docs/b.md","line":9,"code":"M003","message":"unicode arrow"}',
    ].join('\n');
    const parsed = parseValidatorOutput(stdout);
    expect(parsed?.gapCount).toBe(2);
  });

  it('returns null for empty stdout — never a silent pass', () => {
    expect(parseValidatorOutput('')).toBeNull();
    expect(parseValidatorOutput('   \n')).toBeNull();
  });

  it('returns null for non-JSON garbage', () => {
    expect(parseValidatorOutput('everything is fine, trust me')).toBeNull();
  });

  it('returns null for JSON that has no recognizable gap count', () => {
    expect(parseValidatorOutput('{"status":"ok"}')).toBeNull();
  });

  it('returns null when only some NDJSON lines parse', () => {
    const stdout = ['{"code":"M001"}', 'not json at all'].join('\n');
    expect(parseValidatorOutput(stdout)).toBeNull();
  });
});
