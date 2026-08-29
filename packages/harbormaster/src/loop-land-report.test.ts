import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  attemptSummaryLine,
  parkComment,
  defaultParkReason,
  everyAttemptHitTheProvider,
  everyAttemptTimedOut,
  ledgerEvidenceFor,
  observedTimeoutMs,
  timedOutWaitingForASlot,
} from './loop-land-report.js';
import type { SilentCompletion } from './loop-land-session-acceptance.js';
import type { LandAttempt } from './loop-land.js';

/**
 * W13-41. The park comment is the only thing a person reads after a ticket
 * fails, and it used to say `exitCode=1 no completion manifest returned` for
 * three different failures: a session that ran out of turns, one that crashed,
 * and one that answered nothing.
 */
/**
 * Assembled at runtime, never written out as a literal: a credential-shaped
 * string committed to this repo is flagged forever by
 * validate-history-secrets, and a history hit is not fixed by deleting the
 * file. The redactor sees the same characters either way.
 */
const PLANTED_TOKEN = ['sk', 'abcdef0123456789'].join('-');

function attempt(output: string, attemptNo = 1): LandAttempt {
  return {
    attempt: attemptNo,
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

describe('attemptSummaryLine — why a session returned nothing (W13-41)', () => {
  it("carries the session's own reason, so the remedy is discoverable", () => {
    // Verbatim from a real run: a ticket on a local model spent its whole tool
    // budget twice and parked, and this sentence was thrown away.
    const line = attemptSummaryLine(
      attempt(
        'agent session stopped: exceeded the per-session tool-iteration budget (12) ' +
          'without a Completion Manifest (T-27)',
      ),
      2,
    );

    expect(line).toContain('no completion manifest returned');
    // The number and the name of the limit both survive: without them nobody
    // could know `maxToolIterations` is the setting to reach for.
    expect(line).toContain('tool-iteration budget (12)');
  });

  it('stays as it was when the session explained nothing', () => {
    // Adding anything here would be inventing a reason. The bare line is the
    // honest answer for a session that returned no manifest and said nothing.
    expect(attemptSummaryLine(attempt('   '), 2)).toBe(
      'attempt 1/2: exitCode=1 no completion manifest returned',
    );
  });

  it('redacts secrets — this string is appended to an append-only log (Law 8)', () => {
    const line = attemptSummaryLine(
      attempt(
        'failed talking to the provider with Authorization: Bearer sk-abcdef0123456789',
      ),
      2,
    );

    expect(line).not.toContain(PLANTED_TOKEN);
  });

  it('announces truncation rather than cutting silently', () => {
    const line = attemptSummaryLine(attempt('x'.repeat(2_500)), 2);

    // A fragment that begins mid-sentence with no sign anything was cut gets
    // read as the whole failure.
    expect(line).toContain('earlier output truncated');
    expect(line.length).toBeLessThan(2_500);
  });

  it('park comment carries the reason for every attempt', () => {
    const comment = parkComment(
      'ladder_exhausted',
      2,
      [attempt('ran out of turns', 1), attempt('ran out of turns', 2)],
      undefined,
    );

    expect(comment.match(/ran out of turns/g)).toHaveLength(2);
  });
});

describe('the attempt counter cannot exceed its own cap (W21-15)', () => {
  const attempt = (n: number): LandAttempt =>
    ({
      attempt: n,
      session: { exitCode: 1, output: '', manifest: null } as LandAttempt['session'],
      closeGate: null,
    }) as LandAttempt;

  it('RED FIXTURE: the exact observed shape — 2 judged attempts and 3 absorbed retries — never prints "5/2"', () => {
    const body = parkComment(
      'ladder_exhausted',
      2,
      [attempt(1), attempt(2)],
      undefined,
      3,
    );
    expect(body).toContain('attempt 1/2');
    expect(body).toContain('attempt 2/2');
    expect(body).not.toContain('attempt 3/2');
    expect(body).not.toContain('attempt 4/2');
    expect(body).not.toContain('attempt 5/2');
  });

  it('the absorbed retries are still VISIBLE — hiding them would trade one lie for another', () => {
    const body = parkComment('ladder_exhausted', 2, [attempt(1)], undefined, 3);
    expect(body).toContain('3 infrastructure retry(s) were absorbed');
    expect(body).toContain('did NOT count against the cap');
    expect(body).toContain('session.infra_retry');
  });

  it('a run with no infra trouble says nothing about retries', () => {
    const body = parkComment('ladder_exhausted', 2, [attempt(1)], undefined, 0);
    expect(body).not.toContain('absorbed');
  });
});

/**
 * W21-44. The park comment is the founder's whole account of why a ticket
 * stopped, and it was a three-way choice with a catch-all else — so
 * `no_progress` had rendered as "ladder attempt cap reached" since W13-29, and
 * `attempted_nothing` inherited the same lie the moment it existed. It was
 * noticed live: a park after ONE attempt announcing a cap of two had been hit.
 */
describe('every park reason names its own mechanism (W21-44)', () => {
  const noAttempts: never[] = [];

  it('RED FIXTURE: attempted_nothing does not claim a cap it never reached', () => {
    const comment = parkComment('attempted_nothing', 2, noAttempts, undefined);
    expect(comment).toContain('changed NOTHING');
    expect(comment).not.toContain('attempt cap');
  });

  it('no_progress says what actually stopped it — identical gaps, not a cap', () => {
    const comment = parkComment('no_progress', 2, noAttempts, undefined);
    expect(comment).toContain('IDENTICAL gaps');
    expect(comment).not.toContain('attempt cap');
  });

  it('a real ladder exhaustion still says so', () => {
    expect(parkComment('ladder_exhausted', 2, noAttempts, undefined)).toContain(
      'ladder attempt cap (2)',
    );
  });

  it('the other two documented reasons keep their own sentences', () => {
    expect(parkComment('locked_ceiling_reached', 3, noAttempts, undefined)).toContain(
      'convergence ceiling (3)',
    );
    expect(parkComment('awaiting_escalation_token', 2, noAttempts, undefined)).toContain(
      'approval token',
    );
  });
});

/**
 * W21-58. Run 40: LM Studio had no model loaded, every session died on a 400,
 * and the park header read "ladder attempt cap (2) reached … will likely park
 * again unless the evidence below is addressed" — pointing the founder at the
 * ticket and the model when the action was "load a model". The attempt lines
 * named the provider failure honestly; only the headline was wrong.
 *
 * Third instance of that class in this wave, after W21-40's idle summary and
 * W21-44's park comment.
 */
describe('a dead endpoint is not a verdict on the ticket (W21-58)', () => {
  const providerFailure = (attempt: number) =>
    ({
      attempt,
      session: {
        exitCode: null,
        output: 'provider failure: lm-studio: request failed with 400 Bad Request',
        manifest: null,
        manifestParseTier: null,
        scopeViolations: [],
        changedPaths: [],
      },
      closeGate: null,
    }) as unknown as Parameters<typeof everyAttemptHitTheProvider>[0][number];

  const realAttempt = () =>
    ({
      attempt: 1,
      session: {
        exitCode: 1,
        output: 'no completion manifest returned',
        manifest: null,
        manifestParseTier: null,
        scopeViolations: [],
        changedPaths: [],
      },
      closeGate: null,
    }) as unknown as Parameters<typeof everyAttemptHitTheProvider>[0][number];

  it('RED FIXTURE: run 40 — two provider failures do not report a ladder cap', () => {
    expect(everyAttemptHitTheProvider([providerFailure(1), providerFailure(2)])).toBe(true);
    expect(defaultParkReason([providerFailure(1), providerFailure(2)], 'ladder')).toBe(
      'provider_unavailable',
    );
  });

  it('the header says what to DO and disclaims any verdict on the ticket', () => {
    const comment = parkComment('provider_unavailable', 2, [], undefined);
    expect(comment).toContain('EVERY attempt failed before the model could work');
    expect(comment).toContain('Nothing here is a judgement about this ticket');
    expect(comment).toContain('has a model loaded');
    expect(comment).not.toContain('attempt cap');
  });

  it('a MIXED run keeps the ladder reason — the ticket genuinely was attempted', () => {
    expect(everyAttemptHitTheProvider([providerFailure(1), realAttempt()])).toBe(false);
    expect(defaultParkReason([providerFailure(1), realAttempt()], 'ladder')).toBe(
      'ladder_exhausted',
    );
  });

  it('no attempts at all is not a provider verdict either', () => {
    expect(everyAttemptHitTheProvider([])).toBe(false);
  });

  it('locked mode still reports its own ceiling when the attempts were real', () => {
    expect(defaultParkReason([realAttempt()], 'locked')).toBe('locked_ceiling_reached');
  });
});

describe('W21-83 — the park tells the PERSON the work is already done', () => {
  /**
   * The half of W21-83 that shipped missing. Tally's founder saw "re-run it
   * first" for three runs while `npm run build` exited 0 in the worktree the
   * whole time. Advice to retry finished work is worse than none.
   */
  const attempt = (silent: SilentCompletion | undefined) => ({
    attempt: 1,
    session: { exitCode: 1, output: '', manifest: null, manifestParseTier: null, scopeViolations: [], changedPaths: [] },
    closeGate: null,
    ...(silent ? { silent } : {}),
  });

  it('names the passing criteria and says not to redo the work', () => {
    const line = attemptSummaryLine(
      attempt({ complete: true, passing: ['npm run build'] }),
      2,
    );
    expect(line).toContain('ALREADY DONE');
    expect(line).toContain('npm run build');
    expect(line).toContain('return the manifest');
  });

  it('is silent when the work is not done, so the ordinary line stands', () => {
    const line = attemptSummaryLine(attempt({ complete: false, passing: [] }), 2);
    expect(line).toContain('no completion manifest returned');
    expect(line).not.toContain('ALREADY DONE');
  });

  it('an attempt from before this existed is unchanged', () => {
    const line = attemptSummaryLine(attempt(undefined), 2);
    expect(line).toContain('no completion manifest returned');
    expect(line).not.toContain('ALREADY DONE');
  });
});

describe('a timeout is not a refusal (W21-64)', () => {
  /** Runs 48 and 49 exactly: three attempts, every one a request timeout. */
  const timedOut = (attempt: number, output?: string) =>
    ({
      attempt,
      session: {
        exitCode: null,
        output:
          output ??
          'provider failure: lm-studio (model qwen3.8-27b): request timed out after 300000ms',
        manifest: null,
        manifestParseTier: null,
        scopeViolations: [],
        changedPaths: [],
      },
      closeGate: null,
    }) as unknown as LandAttempt;

  const refused = (attempt: number) =>
    ({
      attempt,
      session: {
        exitCode: null,
        output: 'provider failure: lm-studio: endpoint unreachable — ECONNREFUSED',
        manifest: null,
        manifestParseTier: null,
        scopeViolations: [],
        changedPaths: [],
      },
      closeGate: null,
    }) as unknown as LandAttempt;

  it('RED FIXTURE: three timeouts park as a timeout, not as an endpoint refusal', () => {
    // W21-58 parked runs 48/49 as provider_unavailable and told the founder to
    // check the endpoint — which was up and answering. Diagnosing it took a
    // stopwatch on tokens/sec and a ledger read.
    const attempts = [timedOut(1), timedOut(2), timedOut(3)];
    expect(everyAttemptTimedOut(attempts)).toBe(true);
    expect(defaultParkReason(attempts, 'ladder')).toBe('provider_timeout');
  });

  it('a genuine endpoint refusal still parks as an endpoint refusal', () => {
    // The half that must not regress: W21-58's behaviour is correct when the
    // endpoint really did refuse.
    const attempts = [refused(1), refused(2)];
    expect(everyAttemptTimedOut(attempts)).toBe(false);
    expect(defaultParkReason(attempts, 'ladder')).toBe('provider_unavailable');
  });

  it('a MIX of a timeout and a refusal is not reported as all-timeouts', () => {
    expect(everyAttemptTimedOut([timedOut(1), refused(2)])).toBe(false);
  });

  it('the evidence names the ceiling and the largest completion observed', () => {
    // Acceptance 2: the founder should not have to measure tokens/sec by hand.
    const body = parkComment(
      'provider_timeout',
      2,
      [timedOut(1), timedOut(2)],
      undefined,
      0,
      null,
      { largestCompletionTokens: 4475, lengthStops: 0 },
    );
    expect(body).toContain('300000ms');
    expect(body).toContain('4475');
    expect(body).toContain('requestTimeoutMs');
    expect(body).not.toContain('endpoint refused');
  });

  it('says plainly when no completion size was recorded, rather than inventing one', () => {
    const body = parkComment('provider_timeout', 2, [timedOut(1)], undefined, 0, null, {
      largestCompletionTokens: null,
      lengthStops: 0,
    });
    expect(body).toContain('No completion size was recorded');
    expect(body).toContain('300000ms');
  });

  it(
    'a QUEUE-WAIT timeout names the queue, not requestTimeoutMs — the wrong ' +
      'lever would waste the founder’s next run (DEFAULT_QUEUE_ACQUIRE_MS is ' +
      'also 300_000 and will present identically at berths > 1)',
    () => {
      const queued = timedOut(
        1,
        'provider failure: lm-studio (waiting for a request-queue slot; 1 active, 2 queued): request timed out after 300000ms',
      );
      expect(timedOutWaitingForASlot([queued])).toBe(true);
      const body = parkComment('provider_timeout', 2, [queued], undefined, 0, null, {
        largestCompletionTokens: 4475,
        lengthStops: 0,
      });
      expect(body).toContain('REQUEST SLOT');
      expect(body).toContain('will not help');
    },
  );

  it('reads the ceiling back from the message rather than assuming the default', () => {
    const raised = timedOut(
      1,
      'provider failure: lm-studio (model x): request timed out after 1200000ms',
    );
    expect(observedTimeoutMs([raised])).toBe(1_200_000);
    expect(parkComment('provider_timeout', 2, [raised], undefined, 0, null, {
      largestCompletionTokens: 9000,
      lengthStops: 0,
    })).toContain(
      '1200000ms',
    );
  });
});


/** A throwaway log for the ledger-reading helpers (W21-67). */
function reportLedger(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-report-ledger-'));
  reportDirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  reportLogs.push(log);
  createIdentity(log, { id: 'agent', name: 'Agent', kind: 'machine' });
  return log;
}

function spend(
  log: EventLog,
  payload: Record<string, unknown>,
  ticketId = 'T-1',
  runId = 'run-1',
): void {
  appendEvent(log, { eventType: 'spend.recorded', actorId: 'agent', ticketId, runId, payload });
}

const reportDirs: string[] = [];
const reportLogs: EventLog[] = [];
afterEach(() => {
  for (const log of reportLogs.splice(0)) log.close();
  for (const dir of reportDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the park can say the model was cut off mid-thought (W21-67)', () => {
  const attempt0 = () =>
    ({
      attempt: 1,
      session: {
        exitCode: 1,
        output: 'no completion manifest returned',
        manifest: null,
        manifestParseTier: null,
        scopeViolations: [],
        changedPaths: [],
      },
      closeGate: null,
    }) as unknown as LandAttempt;

  it('RED FIXTURE: length stops are reported, so truncation is not read as a bad model', () => {
    // The founder's question — "is a thinking model being cut off before it
    // does the work?" — which the ledger could not answer at all. A session
    // whose every turn was truncated looks, from outside, exactly like a model
    // that could not do the job.
    const body = parkComment('ladder_exhausted', 2, [attempt0()], undefined, 0, null, {
      largestCompletionTokens: 4475,
      lengthStops: 3,
    });
    expect(body).toContain('3 turn(s) were CUT OFF');
    expect(body).toContain('finish_reason: length');
    expect(body).toContain('maxTurnTokens');
  });

  it('says nothing when every turn ended naturally — silence is the honest default', () => {
    const body = parkComment('ladder_exhausted', 2, [attempt0()], undefined, 0, null, {
      largestCompletionTokens: 93,
      lengthStops: 0,
    });
    expect(body).not.toContain('CUT OFF');
  });

  it('reports truncation for ANY park reason, not just the timeout one', () => {
    const body = parkComment('attempted_nothing', 2, [attempt0()], undefined, 0, null, {
      largestCompletionTokens: 5405,
      lengthStops: 1,
    });
    expect(body).toContain('CUT OFF');
  });
});

describe('ledgerEvidenceFor reads both numbers together (W21-67)', () => {
  it('takes the LARGEST completion and counts length stops', () => {
    const log = reportLedger();
    spend(log, { completionTokens: 93, finishReason: 'tool_calls' });
    spend(log, { completionTokens: 4475, finishReason: 'length' });
    spend(log, { completionTokens: 5405, finishReason: 'length' });

    const evidence = ledgerEvidenceFor(log, 'T-1', 'run-1');
    expect(evidence.largestCompletionTokens).toBe(5405);
    expect(evidence.lengthStops).toBe(2);
  });

  it('ignores other tickets and other runs', () => {
    const log = reportLedger();
    spend(log, { completionTokens: 9999, finishReason: 'length' }, 'T-2', 'run-1');
    spend(log, { completionTokens: 8888, finishReason: 'length' }, 'T-1', 'run-2');
    spend(log, { completionTokens: 42, finishReason: 'stop' });

    const evidence = ledgerEvidenceFor(log, 'T-1', 'run-1');
    expect(evidence.largestCompletionTokens).toBe(42);
    expect(evidence.lengthStops).toBe(0);
  });

  it('an older record with no finishReason counts as no length stop, not as one', () => {
    // The field is new. A record written before it must not be read as
    // evidence of truncation that was never observed.
    const log = reportLedger();
    spend(log, { completionTokens: 4475 });
    const evidence = ledgerEvidenceFor(log, 'T-1', 'run-1');
    expect(evidence.largestCompletionTokens).toBe(4475);
    expect(evidence.lengthStops).toBe(0);
  });
});
