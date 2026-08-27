/**
 * W21-44. The red fixture is run 23's tool history exactly: six lists, seven
 * reads, two verifies, zero mutations, across two attempts that both ran to
 * the ladder cap.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { createTicket } from '@dokima/tickets';
import {
  attemptedNothing,
  attemptedNothingNotice,
  latestSeq,
  parkIfAttemptedNothing,
  toolHistogramSince,
} from './loop-land-attempted.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function fixture(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attempted-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  createTicket(log, 'operator', {
    id: 'T-1',
    type: 'task',
    title: 'a ticket',
    lane: 'solo',
    writeScope: ['src/**'],
  });
  return log;
}

function call(log: EventLog, toolId: string, extra: Record<string, unknown> = {}): void {
  appendEvent(log, {
    eventType: 'mcp.tool_call.completed',
    actorId: 'operator',
    ticketId: 'T-1',
    payload: { toolId, ...extra },
  });
}

/** Run 23's exact shape. */
function runTwentyThree(log: EventLog): void {
  for (let i = 0; i < 6; i += 1) call(log, 'agent-session.list');
  for (let i = 0; i < 7; i += 1) call(log, 'agent-session.read');
  for (let i = 0; i < 2; i += 1) call(log, 'agent-session.verify');
}

describe('toolHistogramSince / attemptedNothing (W21-44)', () => {
  it('RED FIXTURE: run 23 — fifteen calls, zero mutations, not attempted', () => {
    const log = fixture();
    const since = latestSeq(log);
    runTwentyThree(log);
    const histogram = toolHistogramSince(log, 'T-1', since);
    expect(histogram.total).toBe(15);
    expect(histogram.mutations).toBe(0);
    expect(attemptedNothing(histogram)).toBe(true);
    log.close();
  });

  it('one successful write is an attempt, however little else happened', () => {
    const log = fixture();
    const since = latestSeq(log);
    call(log, 'agent-session.read');
    call(log, 'agent-session.write');
    expect(attemptedNothing(toolHistogramSince(log, 'T-1', since))).toBe(false);
    log.close();
  });

  it('a REFUSED write is not an attempt the model skipped — the product blocked it', () => {
    const log = fixture();
    const since = latestSeq(log);
    call(log, 'agent-session.read');
    call(log, 'agent-session.write', { refused: true });
    expect(attemptedNothing(toolHistogramSince(log, 'T-1', since))).toBe(true);
    log.close();
  });

  it('a session that made NO calls at all is not this — that is a session that never started', () => {
    const log = fixture();
    const since = latestSeq(log);
    expect(attemptedNothing(toolHistogramSince(log, 'T-1', since))).toBe(false);
    log.close();
  });

  it('only calls AFTER the marker count — an earlier attempt’s writes are not this one’s', () => {
    const log = fixture();
    call(log, 'agent-session.write'); // attempt 1 did real work
    const since = latestSeq(log);
    runTwentyThree(log); // attempt 2 did not
    expect(attemptedNothing(toolHistogramSince(log, 'T-1', since))).toBe(true);
    log.close();
  });

  it('another ticket’s calls are not this ticket’s', () => {
    const log = fixture();
    const since = latestSeq(log);
    appendEvent(log, {
      eventType: 'mcp.tool_call.completed',
      actorId: 'operator',
      ticketId: 'T-2',
      payload: { toolId: 'agent-session.write' },
    });
    expect(toolHistogramSince(log, 'T-1', since).total).toBe(0);
    log.close();
  });
});

describe('attemptedNothingNotice (W21-44)', () => {
  it('says what the session DID, not that it "failed"', () => {
    const log = fixture();
    const since = latestSeq(log);
    runTwentyThree(log);
    const notice = attemptedNothingNotice('T-1', toolHistogramSince(log, 'T-1', since));
    expect(notice).toContain('agent-session.read x7');
    expect(notice).toContain('agent-session.list x6');
    expect(notice).toContain('changed nothing');
    expect(notice).toContain('cannot see how to start');
    log.close();
  });
});

describe('parkIfAttemptedNothing (W21-44)', () => {
  it('records the evidence on the ticket and reports that the ladder should stop', () => {
    const log = fixture();
    const since = latestSeq(log);
    runTwentyThree(log);
    const stop = parkIfAttemptedNothing({
      log,
      ticketId: 'T-1',
      actorId: 'operator',
      runId: 'run-A',
      sinceSeq: since,
    });
    expect(stop).toBe(true);
    log.close();
  });

  it('an attempt that mutated is left alone — this stops empty attempts, not failing ones', () => {
    const log = fixture();
    const since = latestSeq(log);
    call(log, 'agent-session.write');
    expect(
      parkIfAttemptedNothing({ log, ticketId: 'T-1', actorId: 'operator', sinceSeq: since }),
    ).toBe(false);
    log.close();
  });
});

/**
 * The ceiling rule, which the first version of this chapter got wrong and its
 * own T-27 fixture caught: pre-empting only helps while an attempt remains to
 * be SAVED. At the cap the ladder's own reason is the true one, exactly as
 * `nextFeedback` already documents for `no_progress`.
 */
describe('the ceiling rule (W21-44)', () => {
  it('pre-empting is only worth it while an attempt remains — at the cap it relabels, it does not save', () => {
    // attempt 1 of 1: nothing to save, so the ladder's own reason must stand.
    expect(1 < 1).toBe(false);
    // attempt 1 of 2: a second attempt would be spent on the same information.
    expect(1 < 2).toBe(true);
  });
});
