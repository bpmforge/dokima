/**
 * P4-01 — wave automations. The load-bearing pins:
 *  - zero Decide-tier auto-actions: the options types carry NO accept/merge/
 *    revert capability, and the module source never references the Decide-tier
 *    verbs (asserted on the file text — the strongest cheap form).
 *  - cursor advances only after a successful review pass (at-least-once).
 *  - sweep PROPOSES; it never writes board state itself.
 *  - smoke: first failure notifies, second consecutive escalates to a human,
 *    success resets the counter; no auto-revert exists to call.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  pollBranchAdvisoryReviews,
  createMemoryBranchCursor,
  runDependencySweep,
  postMergeSmoke,
} from './wave-automations.js';

describe('zero Decide-tier auto-actions (P4-01)', () => {
  it('the module never references accept/merge/revert verbs — auto-merge deliberately unimplemented', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./wave-automations.ts', import.meta.url)),
      'utf8',
    );
    // Comments explaining the ban are fine; CODE identifiers are not.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(
      /acceptPlanItem|autoMerge|git\s*\(\s*\[?['"]merge|revert\(/,
    );
    expect(src).toContain('AUTO-MERGE IS DELIBERATELY NOT IMPLEMENTED');
  });
});

describe('pollBranchAdvisoryReviews', () => {
  it('reviews a new head once, skips unchanged heads, and only advances the cursor on success', async () => {
    const cursor = createMemoryBranchCursor();
    const calls: string[] = [];
    const notes: string[] = [];
    const opts = {
      listCandidateBranches: async () => [{ branch: 'sw/x', head: 'aaaa1111' }],
      runAdvisoryReview: async (b: string) => {
        calls.push(b);
        return [{ severity: 'HIGH', file: 'a.ts', issue: 'thing' }];
      },
      cursor,
      notify: (m: string) => void notes.push(m),
    };
    const r1 = await pollBranchAdvisoryReviews(opts);
    expect(r1.reviewed).toEqual(['sw/x']);
    expect(notes[0] ?? '').toContain('advisory review of sw/x');
    const r2 = await pollBranchAdvisoryReviews(opts);
    expect(r2.skipped).toEqual(['sw/x']); // same head — no re-review
    expect(calls).toHaveLength(1);
  });

  it('a failed review leaves the cursor unmoved (at-least-once) and does not sink the tick', async () => {
    const cursor = createMemoryBranchCursor();
    let attempt = 0;
    const errors: string[] = [];
    const opts = {
      listCandidateBranches: async () => [
        { branch: 'sw/bad', head: 'bbbb2222' },
        { branch: 'sw/good', head: 'cccc3333' },
      ],
      runAdvisoryReview: async (b: string) => {
        if (b === 'sw/bad' && attempt++ === 0) throw new Error('provider hiccup');
        return [];
      },
      cursor,
      notify: () => {},
      onError: (b: string) => void errors.push(b),
    };
    const r1 = await pollBranchAdvisoryReviews(opts);
    expect(errors).toEqual(['sw/bad']);
    expect(r1.reviewed).toEqual(['sw/good']); // the tick survived
    const r2 = await pollBranchAdvisoryReviews(opts); // retry reviews sw/bad now
    expect(r2.reviewed).toEqual(['sw/bad']);
  });
});

describe('runDependencySweep', () => {
  it('proposes tickets above the severity floor; a human accepts them, never this code', async () => {
    const proposals: Array<{ title: string }> = [];
    const r = await runDependencySweep({
      runAudit: async () => [
        { pkg: 'left-pad', severity: 'critical', advisory: 'CVE-1' },
        { pkg: 'meh', severity: 'low', advisory: 'CVE-2' },
      ],
      proposeTicket: (p) => void proposals.push(p),
      notify: () => {},
    });
    expect(r.proposed).toBe(1);
    expect(proposals[0]?.title).toContain('left-pad');
  });
});

describe('postMergeSmoke — fails twice, bring in a human', () => {
  it('first failure notifies; second consecutive escalates; success resets', async () => {
    const state = { consecutiveFailures: 0 };
    const notes: string[] = [];
    const escalations: string[] = [];
    const failing = {
      runSmoke: async () => ({ ok: false, detail: 'boom' }),
      state,
      notify: (m: string) => void notes.push(m),
      escalateToHuman: (m: string) => void escalations.push(m),
    };
    const r1 = await postMergeSmoke(failing);
    expect(r1.escalated).toBe(false);
    expect(notes).toHaveLength(1);
    const r2 = await postMergeSmoke(failing);
    expect(r2.escalated).toBe(true);
    expect(escalations[0] ?? '').toContain('human needed');
    const r3 = await postMergeSmoke({
      ...failing,
      runSmoke: async () => ({ ok: true, detail: '' }),
    });
    expect(r3.ok).toBe(true);
    expect(state.consecutiveFailures).toBe(0);
  });
});
