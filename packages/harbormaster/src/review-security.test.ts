/**
 * W23-51 — what the reviewer is told about checks that did not run.
 *
 * RED fixture from the 2026-09-23 live review: tool-sast errored (the scanner
 * could not run), the prompt said only that "a tool that could not run is NOT
 * a clean result", and the reviewer answered CONTRADICTED 4/10 for a ticket
 * whose independent re-run passed. A scanner that did not run is missing
 * coverage — never a pass, and never evidence against the diff either.
 */

import { describe, expect, it } from 'vitest';
import { securityChecksPayload, securityChecksSection } from './review-security.js';
import type { CheckEvidence } from './security-checks.js';

const row = (over: Partial<CheckEvidence>): CheckEvidence => ({
  checkId: 'tool-x',
  sourceDigest: 'sha256:head',
  inputDigest: 'sha256:in',
  toolVersion: null,
  ruleDigest: null,
  status: 'passed',
  exitCode: 0,
  artifactDigest: null,
  durationMs: 1,
  reason: null,
  findingCount: 0,
  ...over,
});

const LIVE_EVIDENCE: CheckEvidence[] = [
  row({
    checkId: 'tool-sast',
    status: 'error',
    exitCode: 2,
    reason:
      'semgrep exited 2 before scanning: Cannot create auto config when metrics are off',
  }),
  row({ checkId: 'tool-secrets' }),
  row({
    checkId: 'tool-deps',
    status: 'passed',
    exitCode: 1,
    reason:
      '14 finding(s) already present at base 0ac6e267f6d1; none introduced by this change',
    preexistingCount: 14,
    baselineRef: '0ac6e267f6d1e22674b14dbc1090dbc3f6895cdb',
  }),
];

describe('W23-51: a check that did not run is reported as NOT RUN', () => {
  const text = securityChecksSection({
    evidence: LIVE_EVIDENCE,
    eligible: false,
    blockedBy: ['tool-sast: error'],
  });

  it('RED: labels an errored or unavailable scanner NOT RUN, not ERROR', () => {
    expect(text).toMatch(/- tool-sast: NOT RUN \(exit 2\)/);
    expect(text).not.toMatch(/tool-sast: ERROR/);
  });

  it('RED: tells the reviewer it is neither a pass nor evidence against the change', () => {
    expect(text).toMatch(/do not treat it as a clean result/);
    expect(text).toMatch(/do not count it against this change/);
  });

  it('a pass that rests on pre-existing findings says so', () => {
    expect(text).toContain('- tool-deps: ' + 'PASSED (exit 1)');
    expect(text).toMatch(/14 finding\(s\) already present at base/);
  });

  it('introduced findings are named as the change’s own', () => {
    const findings = securityChecksSection({
      evidence: [
        row({ checkId: 'tool-sast', status: 'findings', exitCode: 1, findingCount: 2 }),
      ],
      eligible: false,
      blockedBy: ['tool-sast: findings'],
    });
    expect(findings).toMatch(/2 finding\(s\) introduced by this change/);
    expect(findings).toMatch(/weigh it as evidence about the diff/);
    expect(findings).not.toMatch(/NOT RUN/);
  });

  it('the event payload keeps the baseline facts and the rule digest', () => {
    const payload = securityChecksPayload({
      evidence: [
        ...LIVE_EVIDENCE.slice(1),
        row({ checkId: 'tool-sast', ruleDigest: 'sha256:rules' }),
      ],
      eligible: true,
      blockedBy: [],
    });
    expect(payload[1]).toMatchObject({
      preexistingCount: 14,
      baselineRef: expect.any(String),
    });
    expect(payload[2]).toMatchObject({ ruleDigest: 'sha256:rules' });
    expect(payload[0]).not.toHaveProperty('preexistingCount');
  });
});
