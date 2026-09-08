/**
 * W23-02. The two sentences that are the whole design, asserted in both
 * directions: PROGRESS never invalidates an approval, and a SPECIFICATION edit
 * always does. Everything else here is the refusal path — an opted-in run with
 * no approval, or with one that no longer describes what is about to run.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { claimTicket, createTicket, retargetTicketAcceptance } from '@dokima/tickets';
import {
  APPROVED_BUILD_EVENT,
  DEFAULT_APPROVED_BUILD_REPAIR_ROUNDS,
  approvedBuildDigest,
  approvedBuildSpecification,
  readLatestApprovedBuild,
  recordApprovedBuild,
  validateApprovedBuild,
} from './approved-build.js';

const dirs: string[] = [];
const logs: EventLog[] = [];

afterEach(async () => {
  for (const log of logs.splice(0)) log.close();
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const INPUTS = {
  projectId: 'proj-1',
  modelPolicy: { kind: 'local-only' } as const,
  budgetCents: 500,
  maxRepairRounds: DEFAULT_APPROVED_BUILD_REPAIR_ROUNDS,
};

async function boardWithOneTicket(): Promise<EventLog> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-approved-build-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  logs.push(log);
  createIdentity(log, { id: 'founder', name: 'founder', kind: 'human' });
  createIdentity(log, { id: 'agent-1', name: 'agent-1', kind: 'machine' });
  createTicket(log, 'founder', {
    id: 'T-1',
    type: 'task',
    title: 'add the thing',
    lane: 'core',
    writeScope: ['src/thing.ts', 'src/thing.test.ts'],
    dependsOn: [],
    acceptance: [
      { id: 'AC-1', text: 'the thing exists', done: false },
      { id: 'AC-2', text: 'the thing is tested', done: false },
    ],
  });
  return log;
}

describe('the approved-build digest covers the specification, not the progress', () => {
  it('is stable across repeated computation and independent of write-scope order', async () => {
    const log = await boardWithOneTicket();
    const first = approvedBuildDigest(log, INPUTS);
    expect(approvedBuildDigest(log, INPUTS)).toBe(first);

    const spec = approvedBuildSpecification(log, INPUTS);
    // Sorted on the way in, so a board listing the same two files the other
    // way round is the same specification and not a re-approval.
    // Sorted, not as-listed: the board's order is not part of what a person
    // approved, so reordering a write scope must not force a re-approval.
    expect(spec.tickets[0]?.writeScope).toEqual(['src/thing.test.ts', 'src/thing.ts']);
  });

  it('CLAIMING A TICKET DOES NOT INVALIDATE IT — progress is not specification', async () => {
    const log = await boardWithOneTicket();
    const before = approvedBuildDigest(log, INPUTS);
    claimTicket(log, { ticketId: 'T-1', actorId: 'agent-1' });
    expect(approvedBuildDigest(log, INPUTS)).toBe(before);
  });

  it('editing acceptance text DOES invalidate it', async () => {
    const log = await boardWithOneTicket();
    const before = approvedBuildDigest(log, INPUTS);
    retargetTicketAcceptance(log, {
      ticketId: 'T-1',
      actorId: 'founder',
      criteria: ['the thing exists', 'the thing is tested', 'and documented'],
      reason: 'scope grew',
    });
    expect(approvedBuildDigest(log, INPUTS)).not.toBe(before);
  });

  it.each([
    ['the model policy', { ...INPUTS, modelPolicy: { kind: 'cheapest-first' } as const }],
    ['the budget', { ...INPUTS, budgetCents: 900 }],
    ['the repair-round allowance', { ...INPUTS, maxRepairRounds: 9 }],
    ['the project it is for', { ...INPUTS, projectId: 'proj-2' }],
  ])('changing %s invalidates it', async (_what, changed) => {
    const log = await boardWithOneTicket();
    expect(approvedBuildDigest(log, changed)).not.toBe(approvedBuildDigest(log, INPUTS));
  });
});

describe('recording and reading an approval', () => {
  it('records the version, digest and budget — and no specification or credential material', async () => {
    const log = await boardWithOneTicket();
    const { approvalId, inputDigest } = recordApprovedBuild(log, {
      ...INPUTS,
      actorId: 'founder',
    });

    const stored = readLatestApprovedBuild(log, 'proj-1');
    expect(stored).toMatchObject({ approvalId, inputDigest, budgetCents: 500 });

    const row = log.db
      .prepare<[string], { payload: string; actor_id: string }>(
        'SELECT payload, actor_id FROM events WHERE event_type = ? ORDER BY seq DESC LIMIT 1',
      )
      .get(APPROVED_BUILD_EVENT);
    expect(row?.actor_id).toBe('founder');
    const payload = JSON.parse(row?.payload ?? '{}') as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'budgetCents',
      'inputDigest',
      'maxRepairRounds',
      'projectId',
      'version',
    ]);
  });

  it('reads the newest approval, and ignores one recorded for another project', async () => {
    const log = await boardWithOneTicket();
    recordApprovedBuild(log, { ...INPUTS, actorId: 'founder' });
    recordApprovedBuild(log, { ...INPUTS, projectId: 'other', actorId: 'founder' });
    const newest = recordApprovedBuild(log, {
      ...INPUTS,
      budgetCents: 700,
      actorId: 'founder',
    });
    expect(readLatestApprovedBuild(log, 'proj-1')?.approvalId).toBe(newest.approvalId);
    expect(readLatestApprovedBuild(log, 'proj-1')?.budgetCents).toBe(700);
  });

  it('ignores an event of the right type carrying a different policy version', async () => {
    const log = await boardWithOneTicket();
    appendEvent(log, {
      eventType: APPROVED_BUILD_EVENT,
      actorId: 'founder',
      payload: {
        version: 'approved-build-v0',
        projectId: 'proj-1',
        inputDigest: 'sha256:whatever',
        budgetCents: 999999,
        maxRepairRounds: 99,
      },
    });
    expect(readLatestApprovedBuild(log, 'proj-1')).toBeNull();
  });
});

describe('validateApprovedBuild — the one gate both entrances go through', () => {
  it('a run that did not opt in is legacy, even with an approval sitting there', async () => {
    const log = await boardWithOneTicket();
    recordApprovedBuild(log, { ...INPUTS, actorId: 'founder' });
    expect(validateApprovedBuild(log, { ...INPUTS, optedIn: false })).toEqual({
      status: 'legacy',
    });
  });

  it('opted in with no approval refuses, and says an autonomy setting is not an approval', async () => {
    const log = await boardWithOneTicket();
    const result = validateApprovedBuild(log, { ...INPUTS, optedIn: true });
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('unreachable');
    expect(result.reason).toMatch(/recorded no approval/);
    expect(result.reason).toMatch(/Nothing was claimed/);
  });

  it('opted in with a STALE approval refuses and names both digests', async () => {
    const log = await boardWithOneTicket();
    recordApprovedBuild(log, { ...INPUTS, actorId: 'founder' });
    retargetTicketAcceptance(log, {
      ticketId: 'T-1',
      actorId: 'founder',
      criteria: ['something else entirely'],
      reason: 'changed my mind',
    });

    const result = validateApprovedBuild(log, { ...INPUTS, optedIn: true });
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('unreachable');
    expect(result.reason).toMatch(/inputs changed since approval/);
    expect(result.reason).toMatch(/progress alone never does this/);
  });

  it('opted in, approved, and unchanged: returns the policy the RUNTIME reconstructed', async () => {
    const log = await boardWithOneTicket();
    const { approvalId, inputDigest } = recordApprovedBuild(log, {
      ...INPUTS,
      actorId: 'founder',
    });
    // Progress happens; the approval still holds.
    claimTicket(log, { ticketId: 'T-1', actorId: 'agent-1' });

    const result = validateApprovedBuild(log, { ...INPUTS, optedIn: true });
    expect(result).toEqual({
      status: 'approved',
      policy: {
        version: 'approved-build-v1',
        projectId: 'proj-1',
        approvalId,
        inputDigest,
        budgetCents: 500,
        maxRepairRounds: DEFAULT_APPROVED_BUILD_REPAIR_ROUNDS,
      },
    });
  });
});
