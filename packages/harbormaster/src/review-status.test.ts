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
    expect(reviewStatusSentence(reviewStatusFor(log, 'T-1'))).toContain('no review pass has run');
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
    const states = ['passed', 'contradicted', 'inconclusive', 'bounced', 'skipped', 'never-reviewed'] as const;
    for (const state of states) {
      const sentence = reviewStatusSentence({ state, reason: null, reviewerModel: null });
      expect(sentence.length).toBeGreaterThan(10);
    }
  });
});
