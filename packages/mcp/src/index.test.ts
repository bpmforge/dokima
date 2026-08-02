import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, requestToolCall } from './index.js';

describe('@dokima/mcp', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('mcp');
  });

  it('re-exports the tool-call host surface from the barrel', () => {
    expect(typeof requestToolCall).toBe('function');
  });
});
