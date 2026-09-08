/**
 * W23-10. `eligible` is the field a later card will accept a ticket on, so
 * every one of its preconditions gets its own failing case — and each failure
 * must produce a REASON, because "not eligible" with no reason is a shrug.
 */

import { promises as fs, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getIdentity, openEventLog, type EventLog } from '@dokima/events';
import {
  REVIEWER_ACTOR_ID,
  decideReview,
  ensureReviewerIdentity,
  type DecisionFacts,
} from './review-decision.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

function logFixture(): EventLog {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dokima-review-decision-'));
  dirs.push(dir);
  return openEventLog(path.join(dir, 'state.db'));
}

const FRESH: DecisionFacts = {
  ticketId: 'T-1',
  modelVerdict: 'CONFIRMED',
  score: 8,
  reviewedHead: 'a'.repeat(40),
  sourceDigest: 'sha256:head',
  evidenceComplete: true,
  evidenceStillCurrent: true,
  gatePassed: true,
  checks: [
    { checkId: 'tool-sast', status: 'passed', required: true },
    { checkId: 'tool-secrets', status: 'passed', required: true },
  ],
  makerModel: 'local-coder',
  makerModels: ['local-coder', 'bigger-coder'],
  reviewerModel: 'big-reviewer',
  reviewerActorId: REVIEWER_ACTOR_ID,
  makerActorId: 'agent-1',
};

describe('a fresh, complete review is eligible — and says nothing is wrong with it', () => {
  it('eligible, with an empty reason list', () => {
    const decision = decideReview(FRESH);
    expect(decision.eligible).toBe(true);
    expect(decision.ineligibleBecause).toEqual([]);
    expect(decision.verdict).toBe('CONFIRMED');
  });
});

describe('every ineligible condition, one at a time, each with its own reason', () => {
  it.each([
    [
      'the reviewer identity IS the maker identity — the half a model check cannot see',
      { makerActorId: REVIEWER_ACTOR_ID },
      /identity never reviews its own work/,
    ],
    ['no reviewer model', { reviewerModel: null }, /nothing independent looked/],
    [
      'the reviewer is the maker’s own model',
      { reviewerModel: 'local-coder' },
      /never reviews its own work/,
    ],
    [
      'the reviewer is a model used during ESCALATION, not just R1',
      { reviewerModel: 'bigger-coder' },
      /made work this run/,
    ],
    [
      'a failed independent re-run',
      { gatePassed: false },
      /independent re-run of the verify/,
    ],
    [
      'a required check that errored',
      { checks: [{ checkId: 'tool-sast', status: 'error', required: true }] },
      /is error — that is not a pass/,
    ],
    [
      'a required check that was unavailable',
      { checks: [{ checkId: 'tool-deps', status: 'unavailable', required: true }] },
      /is unavailable — that is not a pass/,
    ],
    [
      'a required check that found something',
      { checks: [{ checkId: 'tool-sast', status: 'findings', required: true }] },
      /reported findings/,
    ],
    [
      'evidence the reviewer never saw',
      { evidenceComplete: false },
      /not shown the complete source/,
    ],
    [
      'a snapshot that moved',
      { evidenceStillCurrent: false },
      /source changed after the review/,
    ],
    ['no parseable verdict', { modelVerdict: null }, /no usable verdict/],
    [
      'a verdict that is not a confirmation',
      { modelVerdict: 'CONTRADICTED' as const },
      /verdict was CONTRADICTED/,
    ],
  ])('%s → ineligible', (_name, change, pattern) => {
    const decision = decideReview({ ...FRESH, ...(change as Partial<DecisionFacts>) });
    expect(decision.eligible).toBe(false);
    expect(decision.ineligibleBecause.join(' | ')).toMatch(pattern as RegExp);
  });

  it('a NOT_APPLICABLE required check does not block — nothing was skipped that could have been looked at', () => {
    const decision = decideReview({
      ...FRESH,
      checks: [{ checkId: 'tool-deps', status: 'not_applicable', required: true }],
    });
    expect(decision.eligible).toBe(true);
  });

  it('several problems produce several reasons, not one', () => {
    const decision = decideReview({
      ...FRESH,
      gatePassed: false,
      evidenceComplete: false,
      modelVerdict: 'UNVERIFIABLE',
    });
    expect(decision.ineligibleBecause.length).toBeGreaterThanOrEqual(3);
  });
});

describe('an independent check dominates the model', () => {
  it('a failed re-run is CONTRADICTED however confident the model was', () => {
    expect(decideReview({ ...FRESH, gatePassed: false }).verdict).toBe('CONTRADICTED');
  });

  it('a CONFIRMED over incomplete or moved evidence is recorded UNVERIFIABLE, never upgraded', () => {
    expect(decideReview({ ...FRESH, evidenceComplete: false }).verdict).toBe(
      'UNVERIFIABLE',
    );
    expect(decideReview({ ...FRESH, evidenceStillCurrent: false }).verdict).toBe(
      'UNVERIFIABLE',
    );
  });

  it('nothing turns a CONTRADICTED into something better', () => {
    const decision = decideReview({
      ...FRESH,
      modelVerdict: 'CONTRADICTED',
      gatePassed: false,
      evidenceComplete: true,
    });
    expect(decision.verdict).toBe('CONTRADICTED');
  });

  it('the model’s own verdict is kept beside the recorded one — the two differing is the interesting case', () => {
    const decision = decideReview({ ...FRESH, evidenceComplete: false });
    expect(decision.modelVerdict).toBe('CONFIRMED');
    expect(decision.verdict).toBe('UNVERIFIABLE');
  });
});

describe('the machine signs its own review', () => {
  it('mints a distinct machine identity, once, and reuses it', () => {
    const log = logFixture();
    try {
      expect(getIdentity(log, REVIEWER_ACTOR_ID)).toBeUndefined();
      const first = ensureReviewerIdentity(log);
      const second = ensureReviewerIdentity(log);
      expect(first).toBe(REVIEWER_ACTOR_ID);
      expect(second).toBe(REVIEWER_ACTOR_ID);
      const identity = getIdentity(log, REVIEWER_ACTOR_ID);
      expect(identity?.kind).toBe('machine');
      expect(identity?.role).toBe('code-reviewer');
    } finally {
      log.close();
    }
  });
});
