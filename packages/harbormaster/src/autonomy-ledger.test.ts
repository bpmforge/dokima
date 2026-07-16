import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createIdentity,
  openEventLog,
  type EventLog,
} from '@shipwright/events';
import {
  appendAutoDefaultRow,
  appendNeverAutoDecisionRow,
  AgentSignatureRejectedError,
  HumanSignatureRequiredError,
  LEDGER_EVENT_TYPE,
  NeverAutoAutoDefaultRefusedError,
  readAutonomyLedger,
  validateAutonomyLedger,
} from './autonomy-ledger.js';

interface Fixture {
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-autonomy-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  createIdentity(log, { id: 'human-1', name: 'Operator', kind: 'human' });
  createIdentity(log, { id: 'human-claude', name: 'Claude Reviewer', kind: 'human' });
  return {
    dbDir,
    log,
    cleanup: async () => {
      log.close();
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

describe('appendAutoDefaultRow', () => {
  let fixture: Fixture | undefined;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('appends a machine-parseable ledger row for an auto-eligible pause site (US-703 AC-1)', async () => {
    fixture = await setupFixture();
    const row = appendAutoDefaultRow(fixture.log, {
      id: 'ledger-1',
      pauseSite: 'clarification',
      defaultTaken: 'proceed with recommended option',
      wouldHaveAsked: 'which auth provider should the sample project use?',
      actorId: 'worker-1',
    });
    expect(row).toMatchObject({
      id: 'ledger-1',
      pauseSite: 'clarification',
      mode: 'auto',
      defaultTaken: 'proceed with recommended option',
      wouldHaveAsked: 'which auth provider should the sample project use?',
      decision: 'auto-default',
      humanSignature: null,
    });
    expect(typeof row.createdAt).toBe('string');
    expect(() => new Date(row.createdAt).toISOString()).not.toThrow();
  });

  it('refuses to auto-default a NEVER-AUTO pause site (CONSTRAINTS.md C-5)', async () => {
    fixture = await setupFixture();
    expect(() =>
      appendAutoDefaultRow(fixture!.log, {
        id: 'ledger-bad',
        pauseSite: 'main-merge',
        defaultTaken: 'merge to main',
        wouldHaveAsked: 'may I merge this to main?',
        actorId: 'worker-1',
      }),
    ).toThrow(NeverAutoAutoDefaultRefusedError);
  });

  it('refuses to auto-default the interview pause site', async () => {
    fixture = await setupFixture();
    expect(() =>
      appendAutoDefaultRow(fixture!.log, {
        id: 'ledger-bad-2',
        pauseSite: 'interview',
        defaultTaken: 'skip the interview',
        wouldHaveAsked: 'what should the product vision be?',
        actorId: 'worker-1',
      }),
    ).toThrow(NeverAutoAutoDefaultRefusedError);
  });
});

describe('appendNeverAutoDecisionRow (US-703 AC-2, SC-05)', () => {
  let fixture: Fixture | undefined;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('ledgers a NEVER-AUTO decision signed by a human', async () => {
    fixture = await setupFixture();
    const row = appendNeverAutoDecisionRow(fixture.log, {
      id: 'ledger-2',
      pauseSite: 'deploy',
      mode: 'auto',
      decision: 'approved',
      wouldHaveAsked: 'may I deploy release v1.2.0?',
      humanSignature: 'human-1',
      actorId: 'human-1',
    });
    expect(row).toMatchObject({
      pauseSite: 'deploy',
      decision: 'approved',
      humanSignature: 'human-1',
      defaultTaken: null,
    });
  });

  it('rejects a missing signature', async () => {
    fixture = await setupFixture();
    expect(() =>
      appendNeverAutoDecisionRow(fixture!.log, {
        id: 'ledger-3',
        pauseSite: 'destructive',
        mode: 'auto',
        decision: 'approved',
        wouldHaveAsked: 'may I drop this table?',
        humanSignature: '',
        actorId: 'worker-1',
      }),
    ).toThrow(HumanSignatureRequiredError);
  });

  it('rejects a signature belonging to a machine identity', async () => {
    fixture = await setupFixture();
    expect(() =>
      appendNeverAutoDecisionRow(fixture!.log, {
        id: 'ledger-4',
        pauseSite: 'destructive',
        mode: 'auto',
        decision: 'approved',
        wouldHaveAsked: 'may I drop this table?',
        humanSignature: 'worker-1',
        actorId: 'worker-1',
      }),
    ).toThrow(AgentSignatureRejectedError);
  });

  it('rejects a human identity whose name matches the agent-name blocklist', async () => {
    fixture = await setupFixture();
    expect(() =>
      appendNeverAutoDecisionRow(fixture!.log, {
        id: 'ledger-5',
        pauseSite: 'main-merge',
        mode: 'interactive',
        decision: 'approved',
        wouldHaveAsked: 'may I merge this to main?',
        humanSignature: 'human-claude',
        actorId: 'human-claude',
      }),
    ).toThrow(AgentSignatureRejectedError);
  });

  it('rejects an unknown signer identity', async () => {
    fixture = await setupFixture();
    expect(() =>
      appendNeverAutoDecisionRow(fixture!.log, {
        id: 'ledger-6',
        pauseSite: 'main-merge',
        mode: 'interactive',
        decision: 'rejected',
        wouldHaveAsked: 'may I merge this to main?',
        humanSignature: 'ghost',
        actorId: 'human-1',
      }),
    ).toThrow(HumanSignatureRequiredError);
  });
});

describe('readAutonomyLedger', () => {
  let fixture: Fixture | undefined;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('returns every appended row in order', async () => {
    fixture = await setupFixture();
    appendAutoDefaultRow(fixture.log, {
      id: 'row-a',
      pauseSite: 'budget',
      defaultTaken: 'downshift to cheaper rung',
      wouldHaveAsked: 'spend is at 85% — continue at a cheaper tier?',
      actorId: 'worker-1',
    });
    appendNeverAutoDecisionRow(fixture.log, {
      id: 'row-b',
      pauseSite: 'deploy',
      mode: 'auto',
      decision: 'approved',
      wouldHaveAsked: 'may I cut release v2.0.0?',
      humanSignature: 'human-1',
      actorId: 'human-1',
    });
    const rows = readAutonomyLedger(fixture.log);
    expect(rows.map((r) => r.id)).toEqual(['row-a', 'row-b']);
  });
});

describe('validateAutonomyLedger — runtime validation (SRS FR-N3, US-703 AC-3)', () => {
  let fixture: Fixture | undefined;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('reports valid for a ledger built entirely through the minting functions', async () => {
    fixture = await setupFixture();
    appendAutoDefaultRow(fixture.log, {
      id: 'ok-1',
      pauseSite: 'clarification',
      defaultTaken: 'use SQLite',
      wouldHaveAsked: 'which database should the sample project use?',
      actorId: 'worker-1',
    });
    appendNeverAutoDecisionRow(fixture.log, {
      id: 'ok-2',
      pauseSite: 'destructive',
      mode: 'auto',
      decision: 'rejected',
      wouldHaveAsked: 'may I run this migration?',
      humanSignature: 'human-1',
      actorId: 'human-1',
    });
    const result = validateAutonomyLedger(fixture.log);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('reports valid for an empty ledger', async () => {
    fixture = await setupFixture();
    expect(validateAutonomyLedger(fixture.log)).toEqual({ valid: true, errors: [] });
  });

  // TESTING.md §6 "Ledger forgery" fixture 1: NEVER-AUTO row without human signature,
  // planted by calling the generic appendEvent directly — bypassing every check this
  // module's own minting functions perform, exactly what an attacker (or a buggy
  // caller) able to reach the events API directly would do.
  it('detects a NEVER-AUTO row forged via raw appendEvent with no human signature', async () => {
    fixture = await setupFixture();
    appendEvent(fixture.log, {
      eventType: LEDGER_EVENT_TYPE,
      actorId: 'worker-1',
      payload: {
        id: 'forged-1',
        pauseSite: 'deploy',
        mode: 'auto',
        defaultTaken: null,
        wouldHaveAsked: 'may I deploy?',
        humanSignature: null,
        decision: 'approved',
      },
    });
    const result = validateAutonomyLedger(fixture.log);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing humanSignature'))).toBe(true);
  });

  it('detects a NEVER-AUTO row forged as auto-default (never legitimately mintable)', async () => {
    fixture = await setupFixture();
    appendEvent(fixture.log, {
      eventType: LEDGER_EVENT_TYPE,
      actorId: 'worker-1',
      payload: {
        id: 'forged-2',
        pauseSite: 'main-merge',
        mode: 'auto',
        defaultTaken: 'merge anyway',
        wouldHaveAsked: 'may I merge this to main?',
        humanSignature: null,
        decision: 'auto-default',
      },
    });
    const result = validateAutonomyLedger(fixture.log);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("decision is 'auto-default'"))).toBe(
      true,
    );
  });

  it('detects a NEVER-AUTO row signed by a blocklisted identity, planted via raw appendEvent', async () => {
    fixture = await setupFixture();
    appendEvent(fixture.log, {
      eventType: LEDGER_EVENT_TYPE,
      actorId: 'worker-1',
      payload: {
        id: 'forged-3',
        pauseSite: 'destructive',
        mode: 'interactive',
        defaultTaken: null,
        wouldHaveAsked: 'may I drop this table?',
        humanSignature: 'human-claude',
        decision: 'approved',
      },
    });
    const result = validateAutonomyLedger(fixture.log);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('agent-name blocklist'))).toBe(true);
  });

  it('detects a structurally malformed row (missing pauseSite)', async () => {
    fixture = await setupFixture();
    appendEvent(fixture.log, {
      eventType: LEDGER_EVENT_TYPE,
      actorId: 'worker-1',
      payload: {
        id: 'forged-4',
        mode: 'auto',
        defaultTaken: 'x',
        wouldHaveAsked: 'y',
        humanSignature: null,
        decision: 'auto-default',
      },
    });
    const result = validateAutonomyLedger(fixture.log);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pauseSite'))).toBe(true);
  });

  it('detects a row whose decision is outside the enum', async () => {
    fixture = await setupFixture();
    appendEvent(fixture.log, {
      eventType: LEDGER_EVENT_TYPE,
      actorId: 'worker-1',
      payload: {
        id: 'forged-5',
        pauseSite: 'clarification',
        mode: 'auto',
        defaultTaken: null,
        wouldHaveAsked: 'y',
        humanSignature: null,
        decision: 'maybe',
      },
    });
    const result = validateAutonomyLedger(fixture.log);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('decision must be one of'))).toBe(true);
  });

  // TESTING.md §6 "Ledger forgery" fixture 2: an edited ledger row. Ledger rows are
  // events, so an edit must break the hash chain (C-6) — simulated the same way a raw
  // file-level tamper would land (the events_no_update trigger only guards SQL UPDATE
  // statements executed through the normal path; dropping it and updating in place
  // reproduces what a lower-level edit achieves without going through appendEvent).
  it('detects a tampered event via the whole-log hash chain', async () => {
    fixture = await setupFixture();
    appendAutoDefaultRow(fixture.log, {
      id: 'chain-1',
      pauseSite: 'clarification',
      defaultTaken: 'use SQLite',
      wouldHaveAsked: 'which database?',
      actorId: 'worker-1',
    });
    fixture.log.db.exec('DROP TRIGGER events_no_update');
    fixture.log.db.prepare('UPDATE events SET payload = ? WHERE event_type = ?').run(
      JSON.stringify({
        id: 'chain-1',
        pauseSite: 'clarification',
        mode: 'auto',
        defaultTaken: 'use Postgres — tampered',
        wouldHaveAsked: 'which database?',
        humanSignature: null,
        decision: 'auto-default',
      }),
      LEDGER_EVENT_TYPE,
    );
    const result = validateAutonomyLedger(fixture.log);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('hash chain broken'))).toBe(true);
  });

  it('accepts extra agentNameBlocklist entries', async () => {
    fixture = await setupFixture();
    createIdentity(fixture.log, {
      id: 'human-custom',
      name: 'Sam Custom',
      kind: 'human',
    });
    appendEvent(fixture.log, {
      eventType: LEDGER_EVENT_TYPE,
      actorId: 'worker-1',
      payload: {
        id: 'forged-6',
        pauseSite: 'destructive',
        mode: 'interactive',
        defaultTaken: null,
        wouldHaveAsked: 'may I run this migration?',
        humanSignature: 'human-custom',
        decision: 'approved',
      },
    });
    const result = validateAutonomyLedger(fixture.log, {
      agentNameBlocklist: ['custom'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('agent-name blocklist'))).toBe(true);
  });
});
