// heal.test.mjs — P2-05: the shipped @dokima/loop policy engine wired into
// the conductor. These tests import the REAL TS modules through heal.mjs, so
// they also pin that the wiring loads (Node type-stripping) and that the
// SHIPPED constants govern — not the doctrine prose's ceiling of 6.

import { describe, it, expect } from 'vitest';
import { createHealState, assessAttempt, proposeSplit } from './heal.mjs';
import {
  METERED_PROGRESS_CEILING_CAP,
  LOCAL_PROGRESS_CEILING_FLOOR,
} from '../../packages/loop/src/loop-policy-convergence.ts';

const rows = (...fps) => fps.map((fp) => ({ fp }));

describe('shipped constants govern (P2-05, Law L4)', () => {
  it('metered cap is 8 and local floor is 12 — the tested code wins over doctrine prose (6)', async () => {
    expect(METERED_PROGRESS_CEILING_CAP).toBe(8);
    expect(LOCAL_PROGRESS_CEILING_FLOOR).toBe(12);
  });
});

describe('assessAttempt (P2-05)', () => {
  it('first failed pass opens budgets and continues', async () => {
    const s = await createHealState(3);
    const r = assessAttempt(s, rows('a', 'b'));
    expect(r.action).toBe('CONTINUE');
  });

  it('a STALLED fingerprint escalates after 2 same-tier attempts — never 3 identical tries', async () => {
    const s = await createHealState(3);
    assessAttempt(s, rows('a')); // pass 1: budget opened (attempt 1 on 'a')
    const r2 = assessAttempt(s, rows('a')); // still present -> attempt 2
    expect(r2.action).toBe('ESCALATE');
  });

  it('post-escalation stall BLOCKs — the third identical attempt is the worst spend', async () => {
    const s = await createHealState(3);
    assessAttempt(s, rows('a'));
    assessAttempt(s, rows('a')); // ESCALATE
    const r3 = assessAttempt(s, rows('a')); // still present after escalation
    expect(r3.action).toBe('BLOCK');
  });

  it('PROGRESSED into the shipped ceiling PARKs into a SPLIT — a decomposition signal, not a failure', async () => {
    const s = await createHealState(1); // ceiling = min(3+1, 8) = 4 passes on metered
    let r = assessAttempt(s, rows('a1', 'a2', 'a3')); // pass 1
    r = assessAttempt(s, rows('b1', 'b2')); // pass 2: all prior closed, fewer new -> PROGRESSED
    r = assessAttempt(s, rows('c1')); // pass 3: PROGRESSED again
    r = assessAttempt(s, rows('d1')); // pass 4: hits ceiling 4
    expect(r.action).toBe('SPLIT');
    expect(r.why).toContain('ceiling');
  });

  it('closing everything CLEARs and continues', async () => {
    const s = await createHealState(3);
    assessAttempt(s, rows('a'));
    const r = assessAttempt(s, rows()); // all resolved
    expect(r.action).toBe('CONTINUE');
  });
});

describe('proposeSplit (P2-05)', () => {
  const parent = {
    id: 'W1-09',
    title: 'Big thing',
    lane: 'scripts',
    write_scope: ['scripts/a.mjs', 'scripts/b.mjs', 'packages/x/src/**'],
    acceptance: ['does the thing'],
    points: 5,
  };

  it('partitions write_scope into two child tickets, S2 depending on S1, parent parked', async () => {
    const kids = proposeSplit(parent);
    expect(kids).toHaveLength(2);
    expect(kids[0].id).toBe('W1-09-S1');
    expect(kids[1].depends_on).toEqual(['W1-09-S1']);
    expect([...kids[0].write_scope, ...kids[1].write_scope]).toEqual(parent.write_scope);
    expect(kids[0].status).toBe('todo');
    expect(kids[0].points + kids[1].points).toBeLessThanOrEqual(parent.points + 1);
  });

  it('a single-entry scope cannot split — returns null so the caller BLOCKS honestly', async () => {
    expect(proposeSplit({ ...parent, write_scope: ['one/file.ts'] })).toBeNull();
  });
});

describe('convergence window (P2-05)', () => {
  it('two non-PROGRESSED passes with non-decreasing open count DIVERGE -> escalate', async () => {
    const s = await createHealState(5);
    assessAttempt(s, rows('a')); // pass 1 (FIRST)
    // pass 2: 'a' resolved but two NEW open -> MIXED-ish, open count grows 1 -> 2
    assessAttempt(s, rows('b', 'c'));
    // pass 3: same two still open (non-decreasing, not PROGRESSED)
    const r = assessAttempt(s, rows('b', 'c'));
    expect(['ESCALATE', 'BLOCK']).toContain(r.action); // diverged or budget-struck — never a quiet CONTINUE
  });
});
