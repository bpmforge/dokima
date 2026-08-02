import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createIdentity,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import { appendAutoDefaultRow, LEDGER_EVENT_TYPE } from './autonomy-ledger.js';
import {
  AutonomyLedgerInvalidError,
  assertLedgerValidForNextClaim,
  resolvePauseAction,
} from './autonomy.js';

interface Fixture {
  dbDir: string;
  log: EventLog;
  cleanup: () => Promise<void>;
}

async function setupFixture(): Promise<Fixture> {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-autonomy-gate-db-'));
  const log = openEventLog(path.join(dbDir, 'state.db'));
  createIdentity(log, { id: 'worker-1', name: 'Worker One', kind: 'machine' });
  return {
    dbDir,
    log,
    cleanup: async () => {
      log.close();
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

describe('resolvePauseAction — the single mode-dial enforcement point (SC-10)', () => {
  it('interactive mode always asks a human, even for an auto-eligible site', () => {
    expect(resolvePauseAction('interactive', 'clarification')).toBe('ask_human');
    expect(resolvePauseAction('interactive', 'budget')).toBe('ask_human');
  });

  it('interactive mode asks a human for a NEVER-AUTO site too', () => {
    expect(resolvePauseAction('interactive', 'deploy')).toBe('ask_human');
  });

  it('auto mode takes the default at an auto-eligible site', () => {
    expect(resolvePauseAction('auto', 'clarification')).toBe('take_default');
    expect(resolvePauseAction('auto', 'escalation')).toBe('take_default');
  });

  it('auto mode still asks a human at every NEVER-AUTO site — the dial cannot override C-5', () => {
    expect(resolvePauseAction('auto', 'deploy')).toBe('ask_human');
    expect(resolvePauseAction('auto', 'main-merge')).toBe('ask_human');
    expect(resolvePauseAction('auto', 'destructive')).toBe('ask_human');
    expect(resolvePauseAction('auto', 'interview')).toBe('ask_human');
  });
});

describe('assertLedgerValidForNextClaim — FR-N3 "a missing/malformed row blocks the next claim"', () => {
  let fixture: Fixture | undefined;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = undefined;
  });

  it('does not throw when the ledger is valid (including empty)', async () => {
    fixture = await setupFixture();
    expect(() => assertLedgerValidForNextClaim(fixture!.log)).not.toThrow();

    appendAutoDefaultRow(fixture.log, {
      id: 'row-1',
      pauseSite: 'clarification',
      defaultTaken: 'use the recommended default',
      wouldHaveAsked: 'which option?',
      actorId: 'worker-1',
    });
    expect(() => assertLedgerValidForNextClaim(fixture!.log)).not.toThrow();
  });

  it('blocks the next claim when a malformed row is present, and names every problem', async () => {
    fixture = await setupFixture();
    appendEvent(fixture.log, {
      eventType: LEDGER_EVENT_TYPE,
      actorId: 'worker-1',
      payload: {
        id: 'malformed-1',
        pauseSite: 'main-merge',
        mode: 'auto',
        defaultTaken: 'merge anyway',
        wouldHaveAsked: 'may I merge?',
        humanSignature: null,
        decision: 'auto-default',
      },
    });

    let caught: unknown;
    try {
      assertLedgerValidForNextClaim(fixture.log);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AutonomyLedgerInvalidError);
    const err = caught as InstanceType<typeof AutonomyLedgerInvalidError>;
    expect(err.errors.length).toBeGreaterThan(0);
    expect(err.errors.some((e) => e.includes('main-merge'))).toBe(true);
  });
});
