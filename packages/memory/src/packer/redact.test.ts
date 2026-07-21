import { describe, expect, it } from 'vitest';
import { noopPacketRedactor } from './redact.js';

describe('noopPacketRedactor', () => {
  it('passes text through unchanged (real redaction is injected by the caller, see redact.ts header)', () => {
    expect(noopPacketRedactor.redact('sk-live-abc123')).toBe('sk-live-abc123');
  });
});
