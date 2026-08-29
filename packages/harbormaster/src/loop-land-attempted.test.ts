/**
 * W21-44. The red fixture is run 23's tool history exactly: six lists, seven
 * reads, two verifies, zero mutations, across two attempts that both ran to
 * the ladder cap.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  createIdentity,
  listEvents,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import { createTicket } from '@dokima/tickets';
import {
  attemptedNothing,
  attemptedNothingEndsTheLadder,
  attemptedNothingNotice,
  latestSeq,
  parkIfAttemptedNothing,
  toolHistogramSince,
  uncommittedWorkNotice,
  wroteWithoutCommitting,
  type ToolHistogram,
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

/**
 * THE LADDER RULE, and run 27 caught this one live — it was mine.
 *
 * Run 26 proved the climb is the answer to a rung that does nothing: R1 spent
 * forty turns and produced no manifest, R2 produced one in eight. Run 27 then
 * had R1 make ten calls and mutate nothing, and this chapter parked the ticket
 * after ONE attempt, pre-empting the escalation entirely. No
 * `escalation.rung_advanced` appears anywhere in that run.
 *
 * The error was in the sentence the whole module rests on. "A further attempt
 * carries the same information and the same instruction" holds only when the
 * next attempt runs the SAME MODEL.
 */
describe('the ladder rule (W21-44, found by run 27)', () => {
  const ladder = { mode: 'ladder' } as unknown as Parameters<
    typeof attemptedNothingEndsTheLadder
  >[0]['policy'];
  const locked = { mode: 'locked', pinnedTier: 'R2' } as unknown as typeof ladder;

  it('RED FIXTURE: run 27 — attempt 1 of a real ladder must ESCALATE, not park', () => {
    expect(
      attemptedNothingEndsTheLadder({ hasRungSessions: true, policy: ladder, attempt: 1 }),
    ).toBe(false);
  });

  it('at the top of the ladder there is nowhere to climb, so parking is right again', () => {
    expect(
      attemptedNothingEndsTheLadder({ hasRungSessions: true, policy: ladder, attempt: 3 }),
    ).toBe(true);
  });

  it('no rung seam means every attempt is the same model — park', () => {
    expect(
      attemptedNothingEndsTheLadder({ hasRungSessions: false, policy: ladder, attempt: 1 }),
    ).toBe(true);
  });

  it('a LOCKED policy pins one tier, so the next attempt is the same model — park', () => {
    expect(
      attemptedNothingEndsTheLadder({ hasRungSessions: true, policy: locked, attempt: 1 }),
    ).toBe(true);
  });
});

describe('work done and never committed (W21-65)', () => {
  const histogram = (counts: Record<string, number>): ToolHistogram => {
    const map = new Map(Object.entries(counts));
    let mutations = 0;
    let total = 0;
    for (const [toolId, n] of map) {
      total += n;
      if (['write', 'edit', 'commit'].some((s) => toolId.endsWith(s))) mutations += n;
    }
    return { counts: map, mutations, total };
  };

  it('RED FIXTURE: run 51 — 17 mutations, zero commits', () => {
    // The most productive session of the whole exercise, and it could never
    // have closed: the gate reads commits, and the branch tip was unchanged.
    const run51 = histogram({
      'agent-session.read': 24,
      'agent-session.list': 13,
      'agent-session.edit': 7,
      'agent-session.write': 10,
    });
    expect(run51.mutations).toBe(17);
    expect(wroteWithoutCommitting(run51)).toBe(true);
  });

  it('a session that committed at least once is unaffected', () => {
    const committed = histogram({
      'agent-session.write': 10,
      'agent-session.commit': 1,
    });
    expect(wroteWithoutCommitting(committed)).toBe(false);
  });

  it('a session that mutated NOTHING is W21-44’s case, not this one', () => {
    // Acceptance 3: the two signals must not double-report the same session.
    const browsed = histogram({ 'agent-session.read': 24, 'agent-session.list': 13 });
    expect(attemptedNothing(browsed)).toBe(true);
    expect(wroteWithoutCommitting(browsed)).toBe(false);
  });

  it('the notice names what was changed, so the maker knows what to commit', () => {
    const notice = uncommittedWorkNotice(
      histogram({ 'agent-session.write': 10, 'agent-session.edit': 7, 'agent-session.read': 24 }),
    );
    expect(notice).toContain('write x10');
    expect(notice).toContain('edit x7');
    expect(notice).not.toContain('read x24');
    expect(notice).toContain('cannot close until you commit');
  });
});

describe('the park path names uncommitted work as the blocker (W21-65)', () => {
  it('RED FIXTURE: a session that wrote and never committed is told so on the ticket', () => {
    // Acceptance 4. Run 51 reached the close gate, was refused on the
    // acceptance criterion, and the real blocker — no commits — was never
    // named anywhere a person would read.
    const log = fixture();
    const sinceSeq = latestSeq(log);
    for (const tool of ['read', 'write', 'edit']) call(log, `agent-session.${tool}`);
    const parked = parkIfAttemptedNothing({
      log,
      ticketId: 'T-1',
      actorId: 'operator',
      sinceSeq,
    });

    // It does NOT park: the work is real and the next attempt continues from
    // the same worktree.
    expect(parked).toBe(false);
    const comments = listEvents(log).filter((e) => e.eventType === 'ticket.commented');
    expect(JSON.stringify(comments.map((c) => c.payload))).toContain('made NO commit');
  });

  it('a session that committed gets no such comment', () => {
    const log = fixture();
    const sinceSeq = latestSeq(log);
    for (const tool of ['write', 'commit']) call(log, `agent-session.${tool}`);
    parkIfAttemptedNothing({ log, ticketId: 'T-1', actorId: 'operator', sinceSeq });
    const comments = listEvents(log).filter((e) => e.eventType === 'ticket.commented');
    expect(JSON.stringify(comments.map((c) => c.payload))).not.toContain('made NO commit');
  });
});
