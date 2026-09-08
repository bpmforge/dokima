/**
 * W23-12. The claim under test is that a chain of dependent tickets finishes
 * in one run with nobody accepting anything by hand — and that the way it does
 * so is by satisfying `depsDone`, which still requires `done`. A test that
 * proved the chain by loosening that would prove the opposite of the point.
 */

import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  claimTicket,
  closeTicket,
  computeBoard,
  createTicket,
  getTicket,
  listTickets,
  startTicket,
} from '@dokima/tickets';
import {
  VERIFIED_DECISION_EVENT,
  reviewFactsFor,
  verifyAndAcceptTicket,
  type CurrentSource,
} from './verified-ticket-decision.js';
import { REVIEWER_ACTOR_ID, ensureReviewerIdentity } from './review-decision.js';
import type { ApprovedBuildPolicy } from './approved-build-policy.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const POLICY: ApprovedBuildPolicy = {
  version: 'approved-build-v1',
  projectId: 'p1',
  approvalId: '7',
  inputDigest: 'sha256:inputs',
  budgetCents: 5_000,
  maxRepairRounds: 3,
};

function board(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-verified-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'maker', name: 'Maker', kind: 'machine' });
  createIdentity(log, { id: 'founder', name: 'Founder', kind: 'human' });
  ensureReviewerIdentity(log);
  for (const [id, dependsOn] of [
    ['T-1', []],
    ['T-2', ['T-1']],
    ['T-3', ['T-2']],
    ['T-9', []],
  ] as const) {
    createTicket(log, 'founder', {
      id,
      type: 'task',
      title: `work ${id}`,
      lane: id,
      writeScope: [`src/${id}/**`],
      dependsOn: [...dependsOn],
    });
  }
  return log;
}

/** Land a ticket: claim, start, close with a manifest whose last commit is the head. */
function land(log: EventLog, ticketId: string, head: string): void {
  claimTicket(log, { ticketId, actorId: 'maker' });
  startTicket(log, { ticketId, actorId: 'maker' });
  closeTicket(log, {
    ticketId,
    actorId: 'maker',
    files: [`src/${ticketId}/a.ts`],
    verify: { command: 'pnpm test', exitCode: 0 },
    commits: ['older', head],
  });
}

/** A recorded machine verdict, exactly as `loop-review.ts` writes it. */
function verdict(
  log: EventLog,
  ticketId: string,
  over: Record<string, unknown> = {},
): void {
  appendEvent(log, {
    eventType: 'review.verdict',
    actorId: REVIEWER_ACTOR_ID,
    ticketId,
    runId: 'run-1',
    payload: {
      verdict: 'CONFIRMED',
      reviewerModel: 'big-reviewer',
      makerModel: 'local-coder',
      sourceDigest: `sha256:${ticketId}`,
      securityChecks: [
        { checkId: 'tool-sast', status: 'passed' },
        { checkId: 'tool-deps', status: 'not_applicable' },
      ],
      ...over,
    },
  });
}

const source =
  (ticketId: string, head: string): (() => Promise<CurrentSource>) =>
  async () => ({ headCommit: head, sourceDigest: `sha256:${ticketId}` });

const decide = (log: EventLog, ticketId: string, head: string) =>
  verifyAndAcceptTicket({
    log,
    runId: 'run-1',
    ticketId,
    policy: POLICY,
    mode: 'interactive',
    currentInputDigest: POLICY.inputDigest,
    repair: async () => null,
    currentSource: source(ticketId, head),
  });

describe('three dependent tickets finish in one run, with nobody accepting by hand', () => {
  it('each acceptance unlocks the next through the reflow that already exists', async () => {
    const log = board();
    try {
      const blocked = () =>
        new Map(computeBoard([...listTickets(log).values()]).map((e) => [e.ticketId, e]));
      // T-2 and T-3 are blocked at the start — by `depsDone`, which requires done.
      expect(blocked().get('T-2')?.status).toBe('blocked');

      for (const id of ['T-1', 'T-2', 'T-3']) {
        expect(blocked().get(id)?.claimable).toBe(true);
        land(log, id, `head-${id}`);
        verdict(log, id);
        const outcome = await decide(log, id, `head-${id}`);
        expect(outcome.accepted).toBe(true);
        expect(outcome.ruleId).toBe('machine-accept');
        expect(getTicket(log, id)?.status).toBe('done');
      }

      // Nothing a human did: every acceptance is signed by the machine.
      const accepts = getTicket(log, 'T-3')?.history.filter((h) => h.verb === 'accept');
      expect(accepts?.map((a) => a.actorId)).toEqual([REVIEWER_ACTOR_ID]);
    } finally {
      log.close();
    }
  });
});

describe('a review that is red, stale or missing blocks the chain — and only the chain', () => {
  it.each([
    ['CONTRADICTED', { verdict: 'CONTRADICTED' }, 'accept-verdict-not-confirmed'],
    ['inconclusive', { verdict: 'UNVERIFIABLE' }, 'accept-verdict-not-confirmed'],
    [
      'a required check that could not answer',
      { securityChecks: [{ checkId: 'tool-sast', status: 'unavailable' }] },
      'accept-required-check-failed',
    ],
    [
      'a review of source that has since moved',
      { sourceDigest: 'sha256:something-else' },
      'accept-stale-review',
    ],
    [
      'a reviewer that is the maker’s own model',
      { reviewerModel: 'local-coder', makerModel: 'local-coder' },
      'accept-same-model',
    ],
  ])(
    'RED FIXTURE: %s leaves the ticket in review and its dependent blocked',
    async (_what, over, ruleId) => {
      const log = board();
      try {
        land(log, 'T-1', 'head-T-1');
        verdict(log, 'T-1', over);
        const outcome = await decide(log, 'T-1', 'head-T-1');
        expect(outcome.accepted).toBe(false);
        expect(outcome.ruleId).toBe(ruleId);
        expect(getTicket(log, 'T-1')?.status).toBe('in_review');
        const entries = new Map(
          computeBoard([...listTickets(log).values()]).map((e) => [e.ticketId, e]),
        );
        expect(entries.get('T-2')?.status).toBe('blocked');
        // ...while an unrelated ticket is untouched and still claimable.
        expect(entries.get('T-9')?.claimable).toBe(true);
      } finally {
        log.close();
      }
    },
  );

  it('RED FIXTURE: no review at all is refused with its own rule, not treated as silence', async () => {
    const log = board();
    try {
      land(log, 'T-1', 'head-T-1');
      const outcome = await decide(log, 'T-1', 'head-T-1');
      expect(outcome.accepted).toBe(false);
      expect(outcome.ruleId).toBe('accept-no-reviewer');
    } finally {
      log.close();
    }
  });

  it('RED FIXTURE: a receipt that no longer refers to the current head is refused', async () => {
    const log = board();
    try {
      land(log, 'T-1', 'head-T-1');
      verdict(log, 'T-1');
      const outcome = await verifyAndAcceptTicket({
        log,
        runId: 'run-1',
        ticketId: 'T-1',
        policy: POLICY,
        mode: 'interactive',
        currentInputDigest: POLICY.inputDigest,
        repair: async () => null,
        // The tree moved after the close: the receipt describes an older head.
        currentSource: async () => ({
          headCommit: 'someone-else-committed',
          sourceDigest: 'sha256:T-1',
        }),
      });
      expect(outcome.ruleId).toBe('accept-stale-receipt');
    } finally {
      log.close();
    }
  });

  it('a verdict followed by a re-close is not a confirmation of the new work', () => {
    const log = board();
    try {
      land(log, 'T-1', 'head-a');
      verdict(log, 'T-1');
      // The maker closed again after the verdict — same digest, different work.
      appendEvent(log, {
        eventType: 'ticket.closed',
        actorId: 'maker',
        ticketId: 'T-1',
        runId: 'run-1',
        payload: { manifest: { commits: ['head-b'] } },
      });
      const facts = reviewFactsFor(log, 'T-1', {
        headCommit: 'head-b',
        sourceDigest: 'sha256:T-1',
      });
      expect(facts.verdict).toBe('inconclusive');
    } finally {
      log.close();
    }
  });
});

describe('every decision leaves a row', () => {
  it('a refusal is recorded with the rule that produced it, not merely omitted', async () => {
    const log = board();
    try {
      land(log, 'T-1', 'head-T-1');
      await decide(log, 'T-1', 'head-T-1');
      const rows = [...listTickets(log).values()];
      expect(rows.length).toBeGreaterThan(0);
      const events = (await import('@dokima/events')).listEvents(log);
      const decisions = events.filter((e) => e.eventType === VERIFIED_DECISION_EVENT);
      expect(decisions).toHaveLength(1);
      expect((decisions[0]?.payload as { ruleId?: string }).ruleId).toBe(
        'accept-no-reviewer',
      );
    } finally {
      log.close();
    }
  });
});
