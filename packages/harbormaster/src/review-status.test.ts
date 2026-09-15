/**
 * W21-34. The live case is the first fixture: a ticket whose review was
 * skipped because the only candidate reviewer was the maker's own model.
 */
import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createIdentity, openEventLog, type EventLog } from '@dokima/events';
import { reviewStatusFor, reviewStatusSentence } from './review-status.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function fixture(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'review-status-'));
  dirs.push(dir);
  const log = openEventLog(path.join(dir, 'state.db'));
  createIdentity(log, { id: 'operator', name: 'Operator', kind: 'machine' });
  return log;
}

const review = (log: EventLog, eventType: string, payload: unknown, ticketId = 'T-1') =>
  appendEvent(log, { eventType, actorId: 'operator', ticketId, payload });

describe('reviewStatusFor (W21-34)', () => {
  it('RED FIXTURE: the live case — review skipped because the only reviewer was the maker itself', () => {
    const log = fixture();
    review(log, 'review.skipped', {
      reason: 'same model as maker',
      reviewerModel: 'qwen/qwen3-coder-next',
    });
    const status = reviewStatusFor(log, 'T-1');
    expect(status.state).toBe('skipped');
    expect(reviewStatusSentence(status)).toContain('SKIPPED');
    expect(reviewStatusSentence(status)).toContain('nothing has checked this but you');
    log.close();
  });

  it('never-reviewed is NOT the same as skipped — an absence is not a refusal', () => {
    const log = fixture();
    expect(reviewStatusFor(log, 'T-1').state).toBe('never-reviewed');
    expect(reviewStatusSentence(reviewStatusFor(log, 'T-1'))).toContain(
      'no review pass has run',
    );
    log.close();
  });

  it('the reviewer’s three verdict kinds stay distinct — pass/fail would lose the middle one', () => {
    for (const [verdict, state] of [
      ['CONFIRMED', 'passed'],
      ['CONTRADICTED', 'contradicted'],
      ['UNVERIFIABLE', 'inconclusive'],
    ] as const) {
      const log = fixture();
      review(log, 'review.verdict', { verdict, reviewerModel: 'other-model' });
      expect(reviewStatusFor(log, 'T-1').state).toBe(state);
      log.close();
    }
  });

  it('latest wins — a re-review supersedes what came before', () => {
    const log = fixture();
    review(log, 'review.skipped', { reason: 'no reviewer model' });
    review(log, 'review.verdict', { verdict: 'CONFIRMED', reviewerModel: 'other-model' });
    expect(reviewStatusFor(log, 'T-1').state).toBe('passed');
    expect(reviewStatusSentence(reviewStatusFor(log, 'T-1'))).toContain('other-model');
    log.close();
  });

  it('another ticket’s review is not this ticket’s', () => {
    const log = fixture();
    review(log, 'review.verdict', { verdict: 'CONFIRMED' }, 'T-2');
    expect(reviewStatusFor(log, 'T-1').state).toBe('never-reviewed');
    log.close();
  });

  it('every state produces a sentence — silence would read as "fine"', () => {
    const states = [
      'passed',
      'contradicted',
      'inconclusive',
      'bounced',
      'skipped',
      'never-reviewed',
    ] as const;
    for (const state of states) {
      const sentence = reviewStatusSentence({ state, reason: null, reviewerModel: null });
      expect(sentence.length).toBeGreaterThan(10);
    }
  });
});

describe('W23-08: a verdict that no longer describes the ticket is STALE, not current', () => {
  it('RED FIXTURE: a CONFIRMED cannot survive the source moving under it', () => {
    const log = fixture();
    review(log, 'review.verdict', {
      verdict: 'CONFIRMED',
      reviewerModel: 'big-reviewer',
      sourceDigest: 'sha256:reviewed',
    });
    expect(reviewStatusFor(log, 'T-1').state).toBe('passed');

    const stale = reviewStatusFor(log, 'T-1', 'sha256:something-else');
    expect(stale.state).toBe('stale');
    expect(stale.staleFrom).toBe('passed');
    expect(stale.staleReason).toMatch(/source changed/);
    expect(reviewStatusSentence(stale)).toContain('STALE');
    expect(reviewStatusSentence(stale)).toContain(
      'nothing current has checked this but you'.replace(
        'nothing current',
        'Nothing current',
      ),
    );
    log.close();
  });

  it('RED FIXTURE: a rejection after the verdict makes it stale, with or without a digest', () => {
    const log = fixture();
    review(log, 'review.verdict', {
      verdict: 'CONFIRMED',
      reviewerModel: 'big-reviewer',
      sourceDigest: 'sha256:reviewed',
    });
    review(log, 'ticket.rejected', { reason: 'a person disagreed' });

    const status = reviewStatusFor(log, 'T-1');
    expect(status.state).toBe('stale');
    expect(status.staleReason).toMatch(/rejected/);
    // Still stale when the digest happens to match — the rejection is its own
    // reason, independent of whether anyone changed a line yet.
    expect(reviewStatusFor(log, 'T-1', 'sha256:reviewed').state).toBe('stale');
    log.close();
  });

  it('a new close after a verdict makes it stale', () => {
    const log = fixture();
    review(log, 'review.verdict', { verdict: 'CONFIRMED', sourceDigest: 'sha256:a' });
    review(log, 'ticket.closed', { files: ['src/app.ts'] });
    expect(reviewStatusFor(log, 'T-1').state).toBe('stale');
    log.close();
  });

  it('a FRESH verdict after a rejection supersedes it — staleness is not permanent', () => {
    const log = fixture();
    review(log, 'review.verdict', { verdict: 'CONFIRMED', sourceDigest: 'sha256:a' });
    review(log, 'ticket.rejected', { reason: 'no' });
    review(log, 'review.verdict', { verdict: 'CONFIRMED', sourceDigest: 'sha256:b' });
    expect(reviewStatusFor(log, 'T-1', 'sha256:b').state).toBe('passed');
    log.close();
  });

  it('a caller that supplies no digest gets the old behaviour, not an invented staleness', () => {
    const log = fixture();
    review(log, 'review.verdict', { verdict: 'CONFIRMED', sourceDigest: 'sha256:a' });
    expect(reviewStatusFor(log, 'T-1').state).toBe('passed');
    log.close();
  });

  it('a verdict recorded before W23-03 has no digest, and is not called stale for lacking one', () => {
    const log = fixture();
    review(log, 'review.verdict', { verdict: 'CONFIRMED', reviewerModel: 'old' });
    expect(reviewStatusFor(log, 'T-1', 'sha256:anything').state).toBe('passed');
    log.close();
  });
});
