/**
 * W23-09. The failure of a deduplicator is always the merge you cannot see, so
 * both directions are asserted: identical findings collapse to one with both
 * origins, and similar-sounding ones at different places stay separate.
 */

import { describe, expect, it } from 'vitest';
import {
  consolidateFindings,
  findingIdentity,
  groupByOwner,
  normalizeFindingPath,
  type RawFinding,
} from './repair-findings.js';

const CHECKS = ['tool-sast', 'tool-secrets', 'review'];
const SCOPES = [
  { ticketId: 'T-1', writeScope: ['src/**'] },
  { ticketId: 'T-2', writeScope: ['docs/*.md'] },
];

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  originId: 'tool-sast',
  ruleId: 'tool-sast.sql-injection',
  path: 'src/db/users.ts',
  location: 'L42',
  severity: 'HIGH',
  title: 'SQL injection in the user lookup',
  confidenceKind: 'tool-confirmed',
  evidenceFingerprint: 'sha256:evidence-1',
  ...over,
});

const consolidate = (findings: RawFinding[]) =>
  consolidateFindings({ raw: findings, scopes: SCOPES, verificationChecks: CHECKS });

describe('identical findings collapse; similar ones do not', () => {
  it('two origins reporting the SAME finding produce one repair with two origins', () => {
    const batch = consolidate([raw(), raw({ originId: 'security-sast' })]);
    expect(batch.findings).toHaveLength(1);
    expect(batch.findings[0]?.originIds).toEqual(['tool-sast', 'security-sast']);
  });

  it.each([
    ['a different path', { path: 'src/db/orders.ts' }],
    ['a different location', { location: 'L99' }],
    ['different evidence on the same line', { evidenceFingerprint: 'sha256:evidence-2' }],
    ['a different rule', { ruleId: 'tool-sast.xss' }],
  ])(
    'RED FIXTURE: %s keeps them separate, however alike the titles read',
    (_what, change) => {
      const batch = consolidate([raw(), raw({ ...change, title: raw().title })]);
      expect(batch.findings).toHaveLength(2);
    },
  );

  it('identity is rule + path + location + evidence — never the title', () => {
    const a = findingIdentity({ ...raw(), title: 'one phrasing' } as never);
    const b = findingIdentity({
      ...raw(),
      title: 'a completely different phrasing',
    } as never);
    expect(a).toBe(b);
  });

  it('a merge raises severity and never lowers it', () => {
    const batch = consolidate([raw({ severity: 'LOW' }), raw({ severity: 'CRITICAL' })]);
    expect(batch.findings[0]?.severity).toBe('CRITICAL');
  });
});

describe('a hypothesis is not a defect', () => {
  it('two agreeing MODELS are still a hypothesis — agreement between models is not evidence', () => {
    const batch = consolidate([
      raw({ originId: 'security-owasp-web', confidenceKind: 'review-hypothesis' }),
      raw({ originId: 'review', confidenceKind: 'review-hypothesis' }),
    ]);
    expect(batch.findings[0]?.confidenceKind).toBe('review-hypothesis');
    expect(batch.findings[0]?.originIds).toHaveLength(2);
  });

  it('a tool-confirmed finding a model also reported stays tool-confirmed', () => {
    const batch = consolidate([
      raw({ confidenceKind: 'tool-confirmed' }),
      raw({ originId: 'review', confidenceKind: 'review-hypothesis' }),
    ]);
    expect(batch.findings[0]?.confidenceKind).toBe('tool-confirmed');
  });

  it('an unconfirmed hypothesis is kept, marked — never silently erased', () => {
    const batch = consolidate([
      raw({ originId: 'review', confidenceKind: 'review-hypothesis' }),
    ]);
    expect(batch.findings).toHaveLength(1);
    expect(batch.findings[0]?.confidenceKind).toBe('review-hypothesis');
  });
});

describe('paths are validated, not repaired', () => {
  it.each([
    ['an escape', '../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['a windows absolute path', 'C:\\Windows\\system32'],
    ['an empty path', '   '],
  ])(
    'RED FIXTURE: %s is refused rather than normalized into something plausible',
    (_what, badPath) => {
      expect(normalizeFindingPath(badPath).ok).toBe(false);
      const batch = consolidate([raw({ path: badPath })]);
      expect(batch.findings).toHaveLength(0);
      expect(batch.rejected).toHaveLength(1);
    },
  );

  it('a legitimate relative path is normalized once and stays inside', () => {
    expect(normalizeFindingPath('./src/./db/users.ts')).toEqual({
      ok: true,
      path: 'src/db/users.ts',
    });
    expect(normalizeFindingPath('src/db/../db/users.ts')).toEqual({
      ok: true,
      path: 'src/db/users.ts',
    });
  });
});

describe('scope and verification', () => {
  it('a finding inside a ticket’s write scope is grouped under it', () => {
    const grouped = groupByOwner(consolidate([raw()]));
    expect([...grouped.keys()]).toEqual(['T-1']);
  });

  it('RED FIXTURE: a repair outside every approved scope is PARKED, not silently claimed', () => {
    const batch = consolidate([raw({ path: 'infra/main.tf' })]);
    expect(batch.findings).toHaveLength(0);
    expect(batch.outOfScope).toHaveLength(1);
    expect(batch.outOfScope[0]?.ownerTicketId).toBeNull();
    // And its evidence survives the parking — a proposal with no evidence is
    // just an assertion.
    expect(batch.outOfScope[0]?.originIds).toEqual(['tool-sast']);
  });

  it('RED FIXTURE: a finding no runtime check can verify does not enter the batch', () => {
    const batch = consolidate([raw({ ruleId: 'vibes.looks-wrong', originId: 'vibes' })]);
    expect(batch.findings).toHaveLength(0);
    expect(batch.rejected[0]?.reason).toMatch(/no runtime check can verify/);
  });

  it('the verification checks are the RUNTIME’s, not a suggested command', () => {
    const batch = consolidate([raw()]);
    expect(batch.findings[0]?.verificationCheckIds).toEqual(['tool-sast']);
  });

  it('a finding with no rule id or no evidence fingerprint is rejected with a reason', () => {
    expect(consolidate([raw({ ruleId: '  ' })]).rejected[0]?.reason).toMatch(
      /no rule id/,
    );
    expect(consolidate([raw({ evidenceFingerprint: '' })]).rejected[0]?.reason).toMatch(
      /evidence fingerprint/,
    );
  });
});
