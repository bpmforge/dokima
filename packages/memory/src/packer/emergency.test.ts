import { describe, expect, it } from 'vitest';
import {
  packToolResult,
  checkEmergencyStop,
  type ToolResultDiskWriter,
} from './emergency.js';
import { resolveTokenEnvelope } from './budget.js';

describe('packToolResult', () => {
  it('passes short tool results through unchanged', () => {
    const writer: ToolResultDiskWriter = { write: () => 'should-not-be-called' };
    expect(packToolResult('short result', writer)).toBe('short result');
  });

  it('writes results over 500 tokens to disk and replaces them with a reference', () => {
    const written: string[] = [];
    const writer: ToolResultDiskWriter = {
      write: (content) => {
        written.push(content);
        return '/tmp/tool-result-1.txt';
      },
    };
    const big = 'x'.repeat(500 * 4 + 1); // 501 tokens at chars/4
    const result = packToolResult(big, writer);
    expect(result).toBe('[tool result written to disk: /tmp/tool-result-1.txt]');
    expect(written).toEqual([big]);
  });

  it('is at the boundary — exactly 500 tokens still passes through unchanged', () => {
    const writer: ToolResultDiskWriter = { write: () => 'should-not-be-called' };
    const exact = 'x'.repeat(500 * 4);
    expect(packToolResult(exact, writer)).toBe(exact);
  });
});

describe('checkEmergencyStop', () => {
  const envelope = resolveTokenEnvelope(32_000); // emergency: 28_000

  it('returns null under the emergency threshold', () => {
    expect(checkEmergencyStop(27_999, envelope)).toBeNull();
  });

  it('returns an honest PARTIAL at the emergency threshold, never a truncated fake-DONE', () => {
    const stop = checkEmergencyStop(28_000, envelope);
    expect(stop?.partial).toBe(true);
    expect(stop?.reason).toContain('28000/28000');
    expect(stop?.lesson.length).toBeGreaterThan(0);
  });

  it('returns PARTIAL past the emergency threshold', () => {
    expect(checkEmergencyStop(30_000, envelope)?.partial).toBe(true);
  });
});
