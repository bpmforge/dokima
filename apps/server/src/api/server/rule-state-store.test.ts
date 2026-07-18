import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  demoteRule,
  listRuleStates,
  promoteRule,
  recordRuleOutcome,
  registerRule,
  RuleStateError,
} from './rule-state-store.js';

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-rule-state-'));
}

describe('rule state store', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it('registers a rule at proposed, idempotently', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    const first = await registerRule(dir, 'R-01');
    expect(first).toMatchObject({
      ruleId: 'R-01',
      state: 'proposed',
      fpWindowFindings: 0,
    });
    const second = await registerRule(dir, 'R-01');
    expect(second.state).toBe('proposed');
    expect(await listRuleStates(dir)).toHaveLength(1);
  });

  it('promote refuses an unknown rule', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await expect(promoteRule(dir, 'ghost')).rejects.toThrow(RuleStateError);
  });

  it('promote climbs one rung at a time without the FP gate below `gate`', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-01');
    const shadow = await promoteRule(dir, 'R-01');
    expect(shadow.state).toBe('shadow');
    const advisory = await promoteRule(dir, 'R-01');
    expect(advisory.state).toBe('advisory');
  });

  it('promotion to gate is refused below the sample minimum, with counts in the error', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-01');
    await promoteRule(dir, 'R-01'); // -> shadow
    await promoteRule(dir, 'R-01'); // -> advisory
    await expect(
      promoteRule(dir, 'R-01', { minSampleCount: 5, maxFpRate: 0.5 }),
    ).rejects.toMatchObject({ code: 'BELOW_SAMPLE_MINIMUM' });
  });

  it('promotion to gate is refused above the max FP rate', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-01');
    await promoteRule(dir, 'R-01');
    await promoteRule(dir, 'R-01');
    for (let i = 0; i < 5; i++) await recordRuleOutcome(dir, 'R-01', true); // all FPs
    await expect(
      promoteRule(dir, 'R-01', { minSampleCount: 5, maxFpRate: 0.2 }),
    ).rejects.toMatchObject({ code: 'FP_RATE_TOO_HIGH' });
  });

  it('promotion to gate succeeds once the sample/FP gate is satisfied', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-01');
    await promoteRule(dir, 'R-01');
    await promoteRule(dir, 'R-01');
    for (let i = 0; i < 10; i++) await recordRuleOutcome(dir, 'R-01', false); // all true positives
    const gated = await promoteRule(dir, 'R-01', { minSampleCount: 5, maxFpRate: 0.2 });
    expect(gated.state).toBe('gate');
    expect(gated.promotedAt).not.toBeNull();
  });

  it('refuses promotion past the terminal state', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-01');
    await promoteRule(dir, 'R-01');
    await promoteRule(dir, 'R-01');
    await promoteRule(dir, 'R-01', { minSampleCount: 0, maxFpRate: 1 }); // -> gate
    await promoteRule(dir, 'R-01', { minSampleCount: 0, maxFpRate: 1 }); // -> deprecated
    await expect(promoteRule(dir, 'R-01')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('demote steps back one rung and clears the demotion flag', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-01');
    await promoteRule(dir, 'R-01'); // shadow
    const back = await demoteRule(dir, 'R-01');
    expect(back.state).toBe('proposed');
    await expect(demoteRule(dir, 'R-01')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('recordRuleOutcome auto-flags demotion once trailing FP exceeds the threshold on a gate rule', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await registerRule(dir, 'R-01');
    await promoteRule(dir, 'R-01', { minSampleCount: 0, maxFpRate: 1 });
    await promoteRule(dir, 'R-01', { minSampleCount: 0, maxFpRate: 1 });
    await promoteRule(dir, 'R-01', { minSampleCount: 0, maxFpRate: 1 }); // -> gate
    await recordRuleOutcome(dir, 'R-01', true);
    const flagged = await recordRuleOutcome(dir, 'R-01', true);
    expect(flagged.fpRate).toBeGreaterThan(0.5);
    expect(flagged.demotionFlagged).toBe(true);
  });
});
