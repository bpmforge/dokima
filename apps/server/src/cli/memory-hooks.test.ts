import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openEventLog, type EventLog } from '@dokima/events';
import { createMemoryAnchor, insertFact, listFacts, markFactVerified } from '@dokima/memory';
import type { LandAttempt } from '@dokima/harbormaster';
import { createLearningHook } from './memory-hooks.js';

const dirs: string[] = [];
let openLog: EventLog | undefined;
afterEach(async () => {
  openLog?.close();
  openLog = undefined;
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeLog(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-learning-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  openLog = log;
  return log;
}

/** Assembled at runtime, never a literal (validate-history-secrets). */
const PLANTED_SECRET = ['sk', 'feedcafe0123456789ab'].join('-');

function attempt(output: string): LandAttempt {
  return {
    attempt: 1,
    session: {
      exitCode: 1,
      output,
      manifest: null,
      manifestParseTier: null,
      scopeViolations: [],
    },
    closeGate: null,
  };
}

describe('the learning loop writes (W14-05)', () => {
  it('RED FIXTURE: a park inserts a VERIFIED error_solution fact carrying the reason and the failing output — and a planted credential never reaches the fact bank (Law 8)', async () => {
    const log = await makeLog();
    const hook = createLearningHook({
      log,
      secretValues: [PLANTED_SECRET],
      now: () => '2026-08-20T00:00:00.000Z',
    });

    await hook.onParked({
      ticketId: 'T-1',
      reason: 'ladder_exhausted',
      attempts: [
        attempt(`verify failed: pnpm test exit 1 — token ${PLANTED_SECRET} leaked into stderr`),
      ],
    });

    const facts = listFacts(log.db, { kind: 'error_solution', ticketId: 'T-1' });
    expect(facts).toHaveLength(1);
    const fact = facts[0]!;
    // Verified at insert: the symptom is the gate's own output, code-observed
    // (C-2) — recall only surfaces verified facts, and the retry is exactly
    // when this must surface.
    expect(fact.verified).toBe(true);
    expect(fact.content).toContain('PARKED (ladder_exhausted)');
    expect(fact.content).toContain('verify failed');
    expect(fact.content).not.toContain(PLANTED_SECRET);
  });

  it('RED FIXTURE: a later close appends the SOLVED half to the same row — the pair, not a second orphan fact — and is idempotent', async () => {
    const log = await makeLog();
    const hook = createLearningHook({ log, secretValues: [] });
    await hook.onParked({
      ticketId: 'T-1',
      reason: 'no_progress',
      attempts: [attempt('two attempts, identical gaps')],
    });
    await hook.onLanded({ ticketId: 'T-1', commits: ['abc1234'], attempts: [] });
    await hook.onLanded({ ticketId: 'T-1', commits: ['abc1234'], attempts: [] });

    const facts = listFacts(log.db, { kind: 'error_solution', ticketId: 'T-1' });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.content).toContain('identical gaps');
    expect(facts[0]!.content.match(/SOLVED:/g)).toHaveLength(1);
    expect(facts[0]!.content).toContain('abc1234');
  });

  it("RED FIXTURE: on retry, the prior failure LEADS the anchor — position 0, ahead of an ordinary fact BM25 would rank higher (US-602)", async () => {
    const log = await makeLog();
    const now = () => '2026-08-20T00:00:00.000Z';
    // An ordinary verified fact that matches the query strongly.
    const plain = insertFact(
      log.db,
      {
        kind: 'fact',
        content: 'lane routing verify: the lane routing module verifies lane routing rules',
        confidence: 1,
        ticketId: 'T-1',
      },
      now,
    );
    markFactVerified(log.db, plain.id);
    const hook = createLearningHook({ log, secretValues: [], now });
    await hook.onParked({
      ticketId: 'T-1',
      reason: 'ladder_exhausted',
      attempts: [attempt('verify failed on lane routing: expected 3 rules, saw 2')],
    });

    const anchor = createMemoryAnchor(log.db, { errorFirst: true, now });
    const facts = await anchor.gather({
      item: { id: 'T-1', description: 'fix the lane routing rules' },
      criterion: 'pnpm test lane routing verify',
    });
    expect(facts.length).toBeGreaterThanOrEqual(2);
    expect(facts[0]!.statement).toContain('PARKED');
    expect(facts[0]!.detail?.factKind).toBe('error_solution');
  });
});

describe('calibration observations from attempts (W15-02, FR-L3)', () => {
  function claimedPassAttempt(gateOk: boolean): LandAttempt {
    return {
      attempt: 1,
      session: {
        exitCode: 0,
        output: 'done',
        manifest: {
          ticket: 'T-1',
          files: ['a.ts'],
          verify: { command: 'true', exit: 0 },
          commits: ['abc'],
          evidence: [],
          memory_written: [],
        },
        manifestParseTier: 'contract',
        scopeViolations: [],
      },
      closeGate: gateOk
        ? ({ ok: true } as never)
        : ({ ok: false, reasons: ['verify failed'] } as never),
    };
  }

  it('RED FIXTURE: six claimed-pass/gate-fail attempts build an over-claimer record; six honest ones do not', async () => {
    const log = await makeLog();
    const { getCalibration } = await import('@dokima/memory');
    const hook = createLearningHook({
      log,
      secretValues: [],
      makerModel: 'local-coder',
      now: () => '2026-08-20T00:00:00.000Z',
    });

    for (let i = 0; i < 6; i += 1) {
      await hook.onLanded({
        ticketId: `T-${i}`,
        commits: [],
        attempts: [claimedPassAttempt(false)],
      });
    }
    const overclaimer = getCalibration(log.db, 'local-coder', 'coding-agent')!;
    expect(overclaimer.sampleCount).toBe(6);
    expect(overclaimer.meanRawConf - overclaimer.meanVerifiedConf).toBeGreaterThanOrEqual(
      0.25,
    );

    const log2 = await makeLog();
    const honest = createLearningHook({
      log: log2,
      secretValues: [],
      makerModel: 'local-coder',
      now: () => '2026-08-20T00:00:00.000Z',
    });
    for (let i = 0; i < 6; i += 1) {
      await honest.onLanded({
        ticketId: `T-${i}`,
        commits: [],
        attempts: [claimedPassAttempt(true)],
      });
    }
    const clean = getCalibration(log2.db, 'local-coder', 'coding-agent')!;
    expect(clean.meanRawConf - clean.meanVerifiedConf).toBe(0);
  });

  it('an attempt with no manifest made no claim and observes nothing', async () => {
    const log = await makeLog();
    const { getCalibration } = await import('@dokima/memory');
    const hook = createLearningHook({
      log,
      secretValues: [],
      makerModel: 'local-coder',
    });
    await hook.onParked({
      ticketId: 'T-1',
      reason: 'ladder_exhausted',
      attempts: [attempt('no manifest at all')],
    });
    expect(getCalibration(log.db, 'local-coder', 'coding-agent')).toBeUndefined();
  });
});
