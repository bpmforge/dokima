// wave-review.test.mjs — P3-03: Tier-A concurrent multi-model advisory review.
// RED provenance: no wave-level review existed; the citation gate and the
// cannot-block construction are the acceptance's own negative controls.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  waveReviewers,
  synthesizeWaveFindings,
  consensusKey,
  runWaveReview,
  checksToRerun,
} from './wave-review.mjs';

const F = (file, issue, severity = 'HIGH') => ({ file, issue, severity, fix: 'do it' });

describe('waveReviewers (P3-03)', () => {
  it('code always; others only when the aggregate diff carries their surface', () => {
    expect(waveReviewers(['scripts/x.mjs'])).toEqual(['code']);
    expect(waveReviewers(['packages/events/hash.ts'])).toContain('security');
    expect(waveReviewers(['apps/web/src/App.tsx'])).toContain('ux');
    expect(waveReviewers(['packages/gateway/src/db.ts'])).toContain('perf');
  });
});

describe('synthesizeWaveFindings — the interrogate shape (P3-03)', () => {
  const exists = () => true;
  const memberByFile = (f) => (f?.startsWith('src/a/') ? 'T-A' : null);

  it('2+ reviewers agreeing on a HIGH = Act On, with the agreement map recording both', () => {
    const t = synthesizeWaveFindings(
      [
        {
          kind: 'code',
          findings: [F('src/a/x.ts', 'route never mounted anywhere visible')],
        },
        {
          kind: 'security',
          findings: [F('src/a/x.ts', 'route never mounted anywhere visible')],
        },
      ],
      { fileExists: exists, memberByFile },
    );
    expect(t.actOn).toHaveLength(1);
    expect(t.actOn[0].reviewers.sort()).toEqual(['code', 'security']);
    expect(t.actOn[0].attributedTo).toBe('T-A');
    expect(t.agreementMap[0].reviewers).toHaveLength(2);
  });

  it('a lone HIGH off the security surface is Consider, not Act On', () => {
    const t = synthesizeWaveFindings(
      [
        {
          kind: 'code',
          findings: [F('src/a/x.ts', 'possible confusion in naming here')],
        },
      ],
      { fileExists: exists, memberByFile },
    );
    expect(t.actOn).toHaveLength(0);
    expect(t.consider).toHaveLength(1);
  });

  it('a lone CRITICAL on a security surface is NEVER auto-dismissed — Act On', () => {
    const t = synthesizeWaveFindings(
      [
        {
          kind: 'security',
          findings: [F('packages/events/hash.ts', 'preimage not injective', 'CRITICAL')],
        },
      ],
      { fileExists: exists, memberByFile: () => 'T-SEC' },
    );
    expect(t.actOn).toHaveLength(1);
  });

  it('the citation gate discards unresolvable findings BEFORE synthesis (fabricated-REJECT control)', () => {
    const t = synthesizeWaveFindings(
      [
        {
          kind: 'code',
          findings: [F('src/never-existed.ts', 'made-up wiring omission', 'CRITICAL')],
        },
      ],
      { fileExists: () => false, memberByFile },
    );
    expect(t.actOn).toHaveLength(0);
    expect(t.dismissed).toHaveLength(1);
    expect(t.dismissed[0].reason).toContain('citation does not resolve');
  });

  it('CANNOT block by construction — the blocking field is empty always (Law L2)', () => {
    const t = synthesizeWaveFindings(
      [
        { kind: 'code', findings: [F('src/a/x.ts', 'catastrophic', 'CRITICAL')] },
        { kind: 'security', findings: [F('src/a/x.ts', 'catastrophic', 'CRITICAL')] },
      ],
      { fileExists: exists, memberByFile },
    );
    expect(t.blocking).toEqual([]);
  });

  it('consensusKey tolerates phrasing noise via leading-token normalization', () => {
    expect(consensusKey(F('a.ts', 'Route never mounted anywhere, visible!'))).toBe(
      consensusKey(F('a.ts', 'route NEVER mounted anywhere visible')),
    );
  });
});

describe('runWaveReview — concurrent, own models, immutable reports (P3-03)', () => {
  it('runs every recruited kind concurrently on its own model and writes per-reviewer reports before synthesis', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wave-rev-'));
    try {
      const sessions = [];
      const runSession = async (prompt, model, label) => {
        sessions.push({ model, label, at: Date.now() });
        await new Promise((r) => setTimeout(r, 20));
        return {
          out: JSON.stringify({ findings: [F('src/a/x.ts', `finding from ${label}`)] }),
          code: 0,
        };
      };
      const started = Date.now();
      const r = await runWaveReview({
        waveId: 'W-1',
        diff: '+x',
        memberIds: ['T-A'],
        touchedFiles: ['packages/events/hash.ts', 'apps/web/src/App.tsx'],
        models: {
          code: 'model-code',
          security: 'model-sec',
          ux: 'model-ux',
          reviewer: 'fallback',
        },
        runSession,
        wt: dir,
        evidenceDir: dir,
        fileExists: () => true,
        memberByFile: () => 'T-A',
      });
      const wall = Date.now() - started;
      expect(r.kinds.sort()).toEqual(['code', 'security', 'ux']);
      // each reviewer got its OWN model
      expect(new Set(sessions.map((s) => s.model)).size).toBe(3);
      // concurrent: 3 x 20ms sessions must not take 60ms serially
      expect(wall).toBeLessThan(55);
      // immutable per-reviewer reports + the synthesized wave report
      for (const k of ['code', 'security', 'ux'])
        expect(existsSync(join(dir, `review-${k}.json`))).toBe(true);
      const report = JSON.parse(readFileSync(join(dir, 'wave-report.json'), 'utf8'));
      expect(report.blocking).toEqual([]);
      // ledger IDs stamped (real @dokima/loop ledger loads in this repo)
      const all = [...report.actOn, ...report.consider, ...report.noted];
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((f) => typeof f.id === 'string' && f.id.startsWith('F-'))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('checksToRerun — delta re-review (OPT-10)', () => {
  it('first run reviews everything; after a pass, only the reviewers behind Act On findings re-run', () => {
    expect(checksToRerun(null)).toBeNull();
    expect(checksToRerun({ actOn: [{ reviewers: ['security'] }] })).toEqual(['security']);
  });
});
