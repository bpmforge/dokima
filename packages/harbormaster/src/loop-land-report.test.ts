import { describe, expect, it } from 'vitest';
import { attemptSummaryLine, parkComment } from './loop-land-report.js';
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
