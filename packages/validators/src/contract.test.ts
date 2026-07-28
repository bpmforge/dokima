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

  /**
   * RED FIXTURE (W9-08 Defect 2): exactly ONE NDJSON finding line — the same
   * per-line finding shape as the two-line case above, just with a single
   * line. `JSON.parse` on the whole trimmed stdout succeeds immediately
   * (one valid object), so the code never falls through to `parseNdjson` —
   * it hits the final `return null` because the object has no numeric
   * `gaps` field. Two-plus lines only work "by accident": concatenating
   * them makes the whole string invalid JSON, which throws into the
   * `parseNdjson` fallback. Before the fix this asserts `gapCount === 1`
   * and gets `null` instead — i.e. a real, single finding is reported as
   * malformed (exitCode 2) rather than "1 gap" (exitCode 1).
   */
  it('parses a single NDJSON finding line — not malformed (Defect 2)', () => {
    const stdout =
      '{"file":"docs/a.md","line":3,"code":"M001","message":"unquoted slash"}\n';
    const parsed = parseValidatorOutput(stdout);
    expect(parsed).not.toBeNull();
    expect(parsed?.gapCount).toBe(1);
  });

  it('returns null for empty stdout — never a silent pass', () => {
    expect(parseValidatorOutput('')).toBeNull();
    expect(parseValidatorOutput('   \n')).toBeNull();
  });

  it('returns null for non-JSON garbage', () => {
    expect(parseValidatorOutput('everything is fine, trust me')).toBeNull();
  });

  /**
   * `{"status":"ok"}` is valid JSON, has no numeric `gaps` field, and isn't
   * an array — under the W9-08 fix this is treated exactly like any other
   * one-line NDJSON payload (see the "single NDJSON finding line" test
   * above): one finding, with the whole object folded into `detail` since
   * it has neither `category` nor `detail` fields of its own. This was
   * previously asserted as `null` ("no recognizable gap count"), but that
   * was the asymmetry Defect 2 describes — the exact same object appearing
   * on 2+ lines was ALREADY accepted via the NDJSON fallback with zero
   * shape validation; a single line must not be held to a stricter rule
   * than two lines of identical content.
   */
  it('treats a single non-envelope JSON object as one NDJSON finding, not malformed', () => {
    const parsed = parseValidatorOutput('{"status":"ok"}');
    expect(parsed).not.toBeNull();
    expect(parsed?.gapCount).toBe(1);
    expect(parsed?.gaps).toEqual([{ category: 'finding', detail: '{"status":"ok"}' }]);
  });

  it('returns null when only some NDJSON lines parse', () => {
    const stdout = ['{"code":"M001"}', 'not json at all'].join('\n');
    expect(parseValidatorOutput(stdout)).toBeNull();
  });
});
