/**
 * W23-11. The loop's whole value is its BOUND, so the tests that matter most
 * are the ones that stop it: an exhausted budget a restart cannot refill, a
 * pair of attempts that changed nothing, an outage that is not a defect, and a
 * finding the ticket has no right to touch.
 */

import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, listEvents, openEventLog, type EventLog } from '@dokima/events';
import {
  TicketError,
  acceptTicket,
  claimTicket,
  closeTicket,
  createTicket,
  getTicket,
  rejectTicket,
  startTicket,
} from '@dokima/tickets';
import {
  DEFAULT_MAX_REPAIR_ROUNDS,
  REPAIR_ROUND_EVENT,
  decideRepairAction,
  recordedRepairRounds,
  repairReason,
  runRepairRounds,
  type RepairFacts,
  type RepairTicketInputs,
} from './build-repair-loop.js';
import { REVIEWER_ACTOR_ID } from './review-decision.js';
import { consolidateFindings, type RawFinding } from './repair-findings.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const MANIFEST = {
  files: ['src/db/users.ts'],
  verify: { command: 'pnpm test', exitCode: 0 },
  commits: ['abc1234'],
};

/** A ticket sitting in `in_review`, owned by the maker — the live shape. */
function reviewed(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-repair-loop-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'maker', name: 'Maker', kind: 'machine' });
  createIdentity(log, { id: 'founder', name: 'Founder', kind: 'human' });
  createTicket(log, 'founder', {
    id: 'T-1',
    type: 'task',
    title: 'User lookup',
    lane: 'core',
    writeScope: ['src/**'],
  });
  toReview(log);
  return log;
}

function toReview(log: EventLog): void {
  claimTicket(log, { ticketId: 'T-1', actorId: 'maker' });
  startTicket(log, { ticketId: 'T-1', actorId: 'maker' });
  closeTicket(log, { ticketId: 'T-1', actorId: 'maker', ...MANIFEST });
}

const RAW: RawFinding = {
  originId: 'tool-sast',
  ruleId: 'tool-sast.sql-injection',
  path: 'src/db/users.ts',
  location: 'L42',
  severity: 'HIGH',
  title: 'SQL injection in the user lookup',
  confidenceKind: 'tool-confirmed',
  evidenceFingerprint: 'sha256:evidence-1',
};

const INPUTS = (over: Partial<RepairTicketInputs> = {}): RepairTicketInputs => ({
  eligible: false,
  blockers: ['required check tool-sast reported findings'],
  infrastructure: [],
  sourceDigest: 'sha256:tree-1',
  raw: [RAW],
  scopes: [{ ticketId: 'T-1', writeScope: ['src/**'] }],
  verificationChecks: ['tool-sast', 'review'],
  ...over,
});

const facts = (over: Partial<RepairFacts> = {}): RepairFacts => ({
  ticketId: 'T-1',
  eligible: false,
  blockers: ['required check tool-sast reported findings'],
  infrastructure: [],
  sourceDigest: 'sha256:tree-1',
  batch: consolidateFindings({
    raw: [RAW],
    scopes: [{ ticketId: 'T-1', writeScope: ['src/**'] }],
    verificationChecks: ['tool-sast'],
  }),
  rounds: [],
  maxRounds: DEFAULT_MAX_REPAIR_ROUNDS,
  ...over,
});

describe('reject → fix → independent re-verify, with nobody in the room', () => {
  it('a planted failing check is rejected, repaired, and comes back confirmed', async () => {
    const log = reviewed();
    try {
      let repaired = false;
      const outcomes = await runRepairRounds({
        log,
        runId: 'run-1',
        ticketIds: ['T-1'],
        inspect: async () =>
          repaired ? INPUTS({ eligible: true, raw: [], blockers: [] }) : INPUTS(),
        remake: async (ticketId) => {
          // The maker's next attempt: it reads the rejection, fixes, and closes
          // back into review. The loop never touches status itself.
          expect(getTicket(log, ticketId)?.status).toBe('ready');
          repaired = true;
          toReview(log);
        },
      });
      expect(outcomes[0]?.stop).toBe('confirmed');
      expect(outcomes[0]?.rounds).toBe(1);
      expect(getTicket(log, 'T-1')?.status).toBe('in_review');
      // And the reject was signed by the reviewer, not by the human who
      // started the build and not by the maker.
      const rejects = listEvents(log).filter((e) => e.eventType === 'ticket.rejected');
      expect(rejects.map((e) => e.actorId)).toEqual([REVIEWER_ACTOR_ID]);
    } finally {
      log.close();
    }
  });

  it('the rejection carries the batch the maker has to answer', () => {
    const batch = consolidateFindings({
      raw: [
        RAW,
        {
          ...RAW,
          path: 'infra/main.tf',
          originId: 'tool-secrets',
          ruleId: 'tool-secrets.key',
        },
      ],
      scopes: [{ ticketId: 'T-1', writeScope: ['src/**'] }],
      verificationChecks: ['tool-sast', 'tool-secrets'],
    });
    const reason = repairReason('T-1', batch, ['the core re-run failed']);
    expect(reason).toMatch(/the core re-run failed/);
    expect(reason).toMatch(/src\/db\/users\.ts:L42/);
    // The out-of-scope one is named as NOT the maker's to change.
    expect(reason).toMatch(/NOT yours to change/);
    expect(reason).toMatch(/infra\/main\.tf/);
  });
});

describe('the bound', () => {
  it('a persistent defect ends at the bound, and a RESTART does not refill it', async () => {
    const log = reviewed();
    try {
      // Each round the source moves (so the no-progress rule does not fire
      // first) and the defect survives — the shape a bound exists for.
      let tree = 0;
      const run = () =>
        runRepairRounds({
          log,
          runId: 'run-1',
          ticketIds: ['T-1'],
          inspect: async () => INPUTS({ sourceDigest: `sha256:tree-${tree}` }),
          remake: async () => {
            tree += 1;
            toReview(log);
          },
        });
      const first = await run();
      expect(first[0]?.stop).toBe('exhausted');
      expect(first[0]?.rounds).toBe(DEFAULT_MAX_REPAIR_ROUNDS);

      // THE RESTART. A new loop invocation over the SAME log — the state a
      // fresh process would come back to — is granted no new rounds, because
      // the count was never in this function's stack.
      const second = await run();
      expect(second[0]?.stop).toBe('exhausted');
      expect(second[0]?.rounds).toBe(DEFAULT_MAX_REPAIR_ROUNDS);
      expect(
        listEvents(log).filter((e) => e.eventType === REPAIR_ROUND_EVENT),
      ).toHaveLength(DEFAULT_MAX_REPAIR_ROUNDS);
    } finally {
      log.close();
    }
  });

  it('a caller may tighten the bound and may not raise it', async () => {
    const log = reviewed();
    try {
      const outcomes = await runRepairRounds({
        log,
        runId: 'run-1',
        ticketIds: ['T-1'],
        maxRounds: 99,
        inspect: async () => INPUTS({ sourceDigest: `sha256:${Math.random()}` }),
        remake: async () => toReview(log),
      });
      expect(outcomes[0]?.rounds).toBe(DEFAULT_MAX_REPAIR_ROUNDS);
    } finally {
      log.close();
    }
  });

  it('an acceptance is the ONE thing that refills the budget — reopened work is new work', async () => {
    const log = reviewed();
    try {
      await runRepairRounds({
        log,
        runId: 'run-1',
        ticketIds: ['T-1'],
        maxRounds: 1,
        inspect: async () => INPUTS(),
        remake: async () => toReview(log),
      });
      expect(recordedRepairRounds(log, 'T-1')).toHaveLength(1);
      acceptTicket(log, { ticketId: 'T-1', actorId: 'founder' });
      expect(recordedRepairRounds(log, 'T-1')).toHaveLength(0);
    } finally {
      log.close();
    }
  });

  it('two attempts over the same tree with the same unresolved findings stop early', () => {
    const rounds = [
      {
        round: 1,
        sourceDigest: 'sha256:tree-1',
        signature: consolidateFindings({
          raw: [RAW],
          scopes: [{ ticketId: 'T-1', writeScope: ['src/**'] }],
          verificationChecks: ['tool-sast'],
        }).findings.map((f) => f.id),
      },
    ];
    const action = decideRepairAction(facts({ rounds }));
    expect(action.kind).toBe('stop');
    expect(action).toMatchObject({ stop: 'no-progress' });
  });

  it('a moved tree is progress even when the finding list looks the same', () => {
    const rounds = [{ round: 1, sourceDigest: 'sha256:tree-0', signature: [] }];
    expect(decideRepairAction(facts({ rounds })).kind).toBe('repair');
  });
});

describe('an outage is not a defect, and a scope conflict is not a licence', () => {
  it('RED FIXTURE: a check that could not answer parks with the true reason', async () => {
    const log = reviewed();
    try {
      const outcomes = await runRepairRounds({
        log,
        runId: 'run-1',
        ticketIds: ['T-1'],
        inspect: async () => INPUTS({ infrastructure: ['tool-sast'], raw: [] }),
        remake: async () => {
          throw new Error(
            'a maker must not be sent after a defect nobody has evidence of',
          );
        },
      });
      expect(outcomes[0]?.stop).toBe('infrastructure');
      expect(outcomes[0]?.reason).toMatch(/not\s+the code being wrong/);
      expect(outcomes[0]?.rounds).toBe(0);
      // The work is retained: the ticket keeps its review state and its worktree.
      expect(getTicket(log, 'T-1')?.status).toBe('in_review');
    } finally {
      log.close();
    }
  });

  it('RED FIXTURE: findings only outside the write scope never auto-expand the ticket', async () => {
    const log = reviewed();
    try {
      const outcomes = await runRepairRounds({
        log,
        runId: 'run-1',
        ticketIds: ['T-1'],
        inspect: async () =>
          INPUTS({ raw: [{ ...RAW, path: 'infra/main.tf' }], blockers: [] }),
        remake: async () => {
          throw new Error('a repair round must never grant itself the file');
        },
      });
      expect(outcomes[0]?.stop).toBe('scope-conflict');
      expect(getTicket(log, 'T-1')?.writeScope).toEqual(['src/**']);
    } finally {
      log.close();
    }
  });

  it('a stopped run schedules no new round and keeps the artifacts', async () => {
    const log = reviewed();
    try {
      const outcomes = await runRepairRounds({
        log,
        runId: 'run-1',
        ticketIds: ['T-1'],
        stopped: () => true,
        inspect: async () => {
          throw new Error('a stopped run must not even ask');
        },
        remake: async () => undefined,
      });
      expect(outcomes[0]?.stop).toBe('stopped');
      expect(getTicket(log, 'T-1')?.status).toBe('in_review');
    } finally {
      log.close();
    }
  });
});

describe('the maker cannot reject as the verifier', () => {
  it('the owner is refused by the verb itself, whatever the loop asks for', () => {
    const log = reviewed();
    try {
      expect(() =>
        rejectTicket(log, {
          ticketId: 'T-1',
          actorId: 'maker',
          reason: 'my own work is bad',
        }),
      ).toThrow(TicketError);
    } finally {
      log.close();
    }
  });
});
