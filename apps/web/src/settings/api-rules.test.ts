import { describe, expect, it, vi } from 'vitest';
import {
  createSuppression,
  enableCopilotConsent,
  fetchCopilotConsent,
  fetchGuideTopic,
  fetchRules,
  promoteRule,
} from './api-rules.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('settings api (part 2 — rules/suppressions/consent/guide)', () => {
  it('fetchRules maps snake_case rows including the derived fp_rate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        rules: [
          {
            rule_id: 'R-01',
            state: 'gate',
            fp_window_findings: 20,
            fp_window_fps: 2,
            fp_rate: 0.1,
            promoted_at: '2026-07-15T00:00:00Z',
            demotion_flagged: false,
            updated_at: '2026-07-15T00:00:00Z',
          },
        ],
      }),
    );
    const rules = await fetchRules('proj-1', { fetchImpl, getToken: () => 'tok' });
    expect(rules).toEqual([
      {
        ruleId: 'R-01',
        state: 'gate',
        fpWindowFindings: 20,
        fpWindowFps: 2,
        fpRate: 0.1,
        promotedAt: '2026-07-15T00:00:00Z',
        demotionFlagged: false,
        updatedAt: '2026-07-15T00:00:00Z',
      },
    ]);
  });

  it('promoteRule POSTs with no body and maps the returned state', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ rule_id: 'R-01', state: 'shadow' }));
    const result = await promoteRule('proj-1', 'R-01', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(result.state).toBe('shadow');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rules/R-01/promote');
    expect(init.method).toBe('POST');
  });

  it('createSuppression sends justification + human signature, receives the row back', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 1,
        fingerprint: 'fp-1',
        rule_id: 'R-01',
        justification: 'false_positive',
        signed_by: 'Bradford',
        context_key: 'ctx',
        status: 'active',
        created_at: '2026-07-15T00:00:00Z',
        reopened_at: null,
      }),
    );
    const row = await createSuppression(
      'proj-1',
      'fp-1',
      { justification: 'false_positive', signature: 'Bradford' },
      { fetchImpl, getToken: () => 'tok' },
    );
    expect(row.signedBy).toBe('Bradford');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      justification: 'false_positive',
      signature: 'Bradford',
    });
  });

  it('fetchCopilotConsent surfaces the plain-language risk warning', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ enabled: false, warning: 'GitHub can ban the account' }),
      );
    const consent = await fetchCopilotConsent('proj-1', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(consent.enabled).toBe(false);
    expect(consent.warning).toContain('ban');
  });

  it('enableCopilotConsent maps acknowledged_at to camelCase', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ enabled: true, acknowledged_at: '2026-07-15T00:00:00Z' }),
      );
    const result = await enableCopilotConsent('proj-1', {
      fetchImpl,
      getToken: () => 'tok',
    });
    expect(result).toEqual({ enabled: true, acknowledgedAt: '2026-07-15T00:00:00Z' });
  });

  it('fetchGuideTopic degrades to markdown:null without throwing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ topic: 'unknown', markdown: null }));
    const guide = await fetchGuideTopic('unknown', { fetchImpl, getToken: () => 'tok' });
    expect(guide.markdown).toBeNull();
  });
});
