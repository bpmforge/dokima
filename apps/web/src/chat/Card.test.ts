import { describe, expect, it } from 'vitest';
import { isSafeEvidenceHref } from './Card.js';

describe('isSafeEvidenceHref', () => {
  it('allows relative /api/v1/ paths', () => {
    expect(isSafeEvidenceHref('/api/v1/receipts/rcpt_chat_f1')).toBe(true);
  });

  it('rejects javascript: URIs', () => {
    expect(isSafeEvidenceHref('javascript:alert(document.cookie)')).toBe(false);
  });

  it('rejects data: URIs', () => {
    expect(isSafeEvidenceHref('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects absolute external URLs', () => {
    expect(isSafeEvidenceHref('https://evil.example/steal')).toBe(false);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isSafeEvidenceHref('//evil.example/steal')).toBe(false);
  });

  it('rejects other relative paths outside the API namespace', () => {
    expect(isSafeEvidenceHref('/other/path')).toBe(false);
  });
});
