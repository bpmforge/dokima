import { describe, expect, it } from 'vitest';
import { isSafeEvidenceHref } from './Card.js';
import { plainLeadFor } from './plain-lead.js';

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

describe('findings speak human first (W19-07)', () => {
  it('RED FIXTURE: a budget-park finding leads with the plain sentence naming the fix — the verbatim evidence stays below, untouched', () => {
    const lead = plainLeadFor(
      'exitCode=1 no completion manifest returned — agent session stopped: ' +
        'exceeded the per-session tool-iteration budget (12) without a Completion Manifest (T-27)',
    );
    expect(lead).toContain('ran out of its turn budget');
    expect(lead).toContain('Runs & Forge');
  });

  it('ladder exhaustion and failing checks each get their own sentence', () => {
    expect(plainLeadFor('PARKED (ladder_exhausted) after 2 attempt(s)')).toContain(
      'escalation ladder',
    );
    expect(plainLeadFor('verify failed: 3 tests failing')).toContain('checks failed');
  });

  it('an unrecognised finding gets NO lead — never a paraphrase pretending to be a translation (C-1)', () => {
    expect(plainLeadFor('some novel failure mode nobody has classified')).toBeNull();
  });
});
