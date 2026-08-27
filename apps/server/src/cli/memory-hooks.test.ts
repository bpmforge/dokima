import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openEventLog, type EventLog } from '@dokima/events';
import { createMemoryAnchor, insertFact, listFacts, markFactVerified } from '@dokima/memory';
import type { LandAttempt } from '@dokima/harbormaster';
import { createLearningHook, createR0ConsultHook } from './memory-hooks.js';

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
      changedPaths: [],
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
      changedPaths: [],
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

describe('calibration keys by the model that actually made the claim (W16-01)', () => {
  it('RED FIXTURE: a ticket whose attempts ran R1 and R2 folds each observation into ITS model\'s record — charging R2\'s claim to R1 is the miscalibration FR-L3 exists to prevent', async () => {
    const log = await makeLog();
    const { getCalibration } = await import('@dokima/memory');
    const hook = createLearningHook({
      log,
      secretValues: [],
      makerModel: 'cheap-local',
      now: () => '2026-08-21T00:00:00.000Z',
    });

    const withLabel = (label: string, gateOk: boolean): LandAttempt => ({
      ...claimedPassAttemptFor(gateOk),
      sessionLabel: label,
    });
    await hook.onLanded({
      ticketId: 'T-1',
      commits: [],
      attempts: [withLabel('cheap-local', false), withLabel('frontier', true)],
    });

    const cheap = getCalibration(log.db, 'cheap-local', 'coding-agent')!;
    const frontier = getCalibration(log.db, 'frontier', 'coding-agent')!;
    expect(cheap.sampleCount).toBe(1);
    expect(frontier.sampleCount).toBe(1);
    // The failed claim landed on the cheap model's record, not the frontier's.
    expect(cheap.meanRawConf - cheap.meanVerifiedConf).toBe(1);
    expect(frontier.meanRawConf - frontier.meanVerifiedConf).toBe(0);
  });

  it('an unlabeled attempt (no rung seam) still keys by makerModel — pre-W16-01 behavior unchanged', async () => {
    const log = await makeLog();
    const { getCalibration } = await import('@dokima/memory');
    const hook = createLearningHook({
      log,
      secretValues: [],
      makerModel: 'cheap-local',
      now: () => '2026-08-21T00:00:00.000Z',
    });
    await hook.onLanded({
      ticketId: 'T-1',
      commits: [],
      attempts: [claimedPassAttemptFor(true)],
    });
    expect(getCalibration(log.db, 'cheap-local', 'coding-agent')!.sampleCount).toBe(1);
  });
});

function claimedPassAttemptFor(gateOk: boolean): LandAttempt {
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
      changedPaths: [],
    },
    closeGate: gateOk
      ? ({ ok: true } as never)
      : ({ ok: false, reasons: ['verify failed'] } as never),
  };
}

describe('the R0 consult hook, composed (W16-03)', () => {
  it('RED FIXTURE: a planted verified fact for the ticket produces a ledgered playbook.r0_hit and the answer itself — the consult event exists before any model would run', async () => {
    const log = await makeLog();
    const { createIdentity, listEvents } = await import('@dokima/events');
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
    const fact = insertFact(
      log.db,
      {
        kind: 'error_solution',
        content: 'ABI mismatch on native addon — pin Node to 22 and rebuild.',
        source: 'harbormaster:park',
        confidence: 1,
        ticketId: 'T-9',
      },
      () => '2026-08-21T00:00:00.000Z',
    );
    markFactVerified(log.db, fact.id);

    const hook = createR0ConsultHook({
      log,
      actorId: 'worker-1',
      secretValues: [],
      loadGlobalEntries: () => [],
      now: () => '2026-08-21T00:00:00.000Z',
      // W21-35: this event was the last one in a live run still carrying
      // run=null after W21-32 stamped everything else.
      runId: 'run-A',
    });
    const result = await hook.consult({
      ticketId: 'T-9',
      criterion: 'native addon ABI mismatch pin Node',
    });

    expect(result.answered).toBe(true);
    const hit = listEvents(log).find((e) => e.eventType === 'playbook.r0_hit');
    expect(hit!.runId).toBe('run-A');
    expect(result.summary).toContain('pin Node to 22');
    const hits = listEvents(log).filter((e) => e.eventType === 'playbook.r0_hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.payload).toMatchObject({ source: 'fact', findingId: `fact:${fact.id}` });
  });

  it('a miss is ledgered too — the audit trail records that memory had no answer', async () => {
    const log = await makeLog();
    const { createIdentity, listEvents } = await import('@dokima/events');
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });

    const hook = createR0ConsultHook({
      log,
      actorId: 'worker-1',
      secretValues: [],
      loadGlobalEntries: () => [],
    });
    const result = await hook.consult({ ticketId: 'T-9', criterion: 'never seen before' });

    expect(result.answered).toBe(false);
    expect(listEvents(log).filter((e) => e.eventType === 'playbook.r0_miss')).toHaveLength(1);
  });

  it('a promoted GLOBAL entry answers for a project that has never seen the task (FR-F5)', async () => {
    const log = await makeLog();
    const { createIdentity } = await import('@dokima/events');
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });

    const hook = createR0ConsultHook({
      log,
      actorId: 'worker-1',
      secretValues: [],
      loadGlobalEntries: () => [
        { id: 7, taskClass: 'rotate a stale api credential', entry: 'Use the vault rotate verb; never edit settings files.' },
      ],
    });
    const result = await hook.consult({
      ticketId: 'T-1',
      criterion: 'Rotate a stale API credential',
    });
    expect(result.answered).toBe(true);
    expect(result.summary).toContain('vault rotate verb');
  });
});

/**
 * W21-45. The fact bank was storing the model's own manifest JSON as the
 * "symptom" of a park, and discarding the close gate's refusal — the one
 * verified sentence about why the ticket stopped. That is C-2 inverted at the
 * exact place memory exists to make the next run smarter, and it is why the R0
 * consult missed on three consecutive runs.
 */
describe('a park records the GATE’s verdict, not the model’s claim (W21-45)', () => {
  const gateAttempt = (reasons: string[], output: string): LandAttempt =>
    ({
      attempt: 1,
      session: {
        exitCode: 0,
        output,
        manifest: null,
        manifestParseTier: null,
        scopeViolations: [],
        changedPaths: [],
      },
      closeGate: { ok: false, reasons, ticket: undefined as never },
    }) as unknown as LandAttempt;

  it('RED FIXTURE: the gate reason is the fact, where the manifest JSON used to be', async () => {
    const log = await makeLog();
    const { createIdentity } = await import('@dokima/events');
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
    const hook = createLearningHook({ log, secretValues: [], now: () => '2026-08-27T00:00:00.000Z' });
    hook.onParked({
      ticketId: 'T-9',
      reason: 'attempted_nothing',
      attempts: [
        gateAttempt(
          ['acceptance criterion AC-1 ran NOTHING: `node --test src/crypto/*.spec.ts` exited 0'],
          '```json\n{"ticket":"T-9","files":["src/crypto/index.ts"]}\n```',
        ),
      ],
    });
    const { listFacts } = await import('@dokima/memory');
    const facts = listFacts(log.db, { kind: 'error_solution', ticketId: 'T-9' });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.content).toContain('acceptance criterion AC-1 ran NOTHING');
    // The searchable text the R0 consult keys on is now present.
    expect(facts[0]!.content).toContain('node --test src/crypto/*.spec.ts');
    expect(facts[0]!.content).not.toContain('"files"');
  });

  it('a session that never reached the gate still records its own words — there is nothing else', async () => {
    const log = await makeLog();
    const { createIdentity } = await import('@dokima/events');
    createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
    const hook = createLearningHook({ log, secretValues: [], now: () => '2026-08-27T00:00:00.000Z' });
    hook.onParked({
      ticketId: 'T-10',
      reason: 'ladder_exhausted',
      attempts: [
        {
          attempt: 1,
          session: {
            exitCode: 1,
            output: 'agent session stopped: exceeded the per-session tool-iteration budget (12)',
            manifest: null,
            manifestParseTier: null,
            scopeViolations: [],
            changedPaths: [],
          },
          closeGate: null,
        } as unknown as LandAttempt,
      ],
    });
    const { listFacts } = await import('@dokima/memory');
    const facts = listFacts(log.db, { kind: 'error_solution', ticketId: 'T-10' });
    expect(facts[0]!.content).toContain('tool-iteration budget');
  });
});
