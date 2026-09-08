/**
 * W23-01. Table-driven over every row of the release pause table
 * (`docs/work/automated-build-handoff/IMPLEMENTATION_PLAN.md` §4), in both
 * modes, plus the refusals that are the reason this function exists at all.
 *
 * Every case asserts the `ruleId`, not just the action. Two rows that both
 * return `ask_human` for different reasons is precisely how a policy function
 * decays into "it asks sometimes, we think" — the id is what makes a wrong
 * branch a red test rather than a green one.
 */

import { describe, expect, it } from 'vitest';
import {
  APPROVED_BUILD_POLICY_VERSION,
  decideApprovedBuildAction,
  type ApprovedBuildFacts,
  type ApprovedBuildPolicy,
  type ApprovedBuildRequest,
  type ApprovedBuildReviewFacts,
  type ApprovedBuildSituationKind,
} from './approved-build-policy.js';

const DIGEST = 'sha256:approved-inputs';

const policy: ApprovedBuildPolicy = {
  version: APPROVED_BUILD_POLICY_VERSION,
  projectId: 'proj-1',
  approvalId: 'evt-approval-1',
  inputDigest: DIGEST,
  budgetCents: 500,
  maxRepairRounds: 3,
};

const facts = (over: Partial<ApprovedBuildFacts> = {}): ApprovedBuildFacts => ({
  currentInputDigest: DIGEST,
  ...over,
});

const req = (
  situation: ApprovedBuildSituationKind,
  over: Partial<ApprovedBuildRequest> = {},
): ApprovedBuildRequest => ({
  situation,
  policy,
  mode: 'auto',
  facts: facts(),
  ...over,
});

const freshReview: ApprovedBuildReviewFacts = {
  makerIdentityId: 'identity-maker',
  reviewerIdentityId: 'identity-reviewer',
  makerModelId: 'model-a',
  reviewerModelId: 'model-b',
  verdict: 'confirmed',
  reviewedSourceDigest: 'sha256:head',
  currentSourceDigest: 'sha256:head',
  requiredChecksAllPassed: true,
  receiptFresh: true,
};

describe('approved-build-v1: the pause table, row by row', () => {
  it.each([
    [
      'implement an approved ticket inside its scope',
      req('implement-ticket', { facts: facts({ withinApprovedScope: true }) }),
      'proceed',
      'implement-inside-scope',
    ],
    [
      'run configured tests/scanners in the allowed sandbox',
      req('run-configured-check'),
      'proceed',
      'run-configured-check',
    ],
    [
      'ordinary implementation detail — no manufactured clarification',
      req('ordinary-implementation-detail'),
      'proceed',
      'ordinary-detail',
    ],
    [
      'repair inside the approved acceptance and remaining budget',
      req('repair-finding', {
        facts: facts({ withinApprovedScope: true, repairRoundsUsed: 1 }),
      }),
      'proceed_bounded_retry',
      'repair-inside-scope',
    ],
    [
      'retry a transient provider failure under the existing limit',
      req('retry-transient-provider', {
        facts: facts({ providerAttemptsUsed: 1, providerAttemptLimit: 3 }),
      }),
      'proceed_bounded_retry',
      'provider-transient-retry',
    ],
    [
      'fresh independent review + required checks confirm the current head',
      req('machine-accept', { facts: facts({ review: freshReview }) }),
      'machine_accept',
      'machine-accept',
    ],
    [
      'ambiguous requirement the approved stories do not cover',
      req('ambiguous-requirement'),
      'ask_human',
      'ambiguous-requirement',
    ],
    [
      'new scope, new dependency/stack, auth/crypto or destructive',
      req('scope-or-stack-change'),
      'ask_human',
      'scope-or-stack-change',
    ],
    [
      'spend above the approved budget',
      req('budget-or-escalation', { facts: facts({ requestedCents: 900 }) }),
      'ask_human',
      'budget-exceeded',
    ],
    [
      'an approval-gated model boundary, even inside budget',
      req('budget-or-escalation', { facts: facts({ requestedCents: 100 }) }),
      'ask_human',
      'escalation-boundary',
    ],
    [
      'missing scanner, credential or independent reviewer',
      req('missing-capability', { facts: facts({ missingCapability: 'semgrep' }) }),
      'report_missing_capability',
      'missing-capability',
    ],
    [
      'main/master merge, release, publication or deploy',
      req('protected-action'),
      'ask_human',
      'protected-action',
    ],
  ])('%s', (_name, request, action, ruleId) => {
    const decision = decideApprovedBuildAction(request);
    expect({ action: decision.action, ruleId: decision.ruleId }).toEqual({
      action,
      ruleId,
    });
  });

  it('interactive mode with no approval preserves the legacy interactive behaviour, row for row', () => {
    for (const situation of [
      'implement-ticket',
      'run-configured-check',
      'repair-finding',
      'machine-accept',
      'ordinary-implementation-detail',
    ] as const) {
      const decision = decideApprovedBuildAction(
        req(situation, { policy: null, mode: 'interactive' }),
      );
      expect(decision.action).toBe('ask_human');
      expect(decision.ruleId).toBe('legacy-requires-opt-in');
    }
  });

  it('a legacy auto project keeps the legacy default and is NOT opted into approved-build-v1', () => {
    const decision = decideApprovedBuildAction(
      req('implement-ticket', {
        policy: null,
        mode: 'auto',
        facts: facts({ withinApprovedScope: true }),
      }),
    );
    // Legacy `auto` at an auto-eligible site takes its documented default —
    // exactly what resolvePauseAction already said, decided by that same
    // function. What it must never be is the NEW behaviour: the rule id says
    // which policy answered, and it is the legacy one.
    expect(decision.action).toBe('proceed');
    expect(decision.ruleId).toBe('legacy-autonomy-default');
  });
});

describe('approved-build-v1: what cannot authorize itself', () => {
  it('an unknown situation kind fails closed', () => {
    const decision = decideApprovedBuildAction(
      req('deploy-everything' as unknown as ApprovedBuildSituationKind),
    );
    expect(decision.action).toBe('ask_human');
    expect(decision.ruleId).toBe('unknown-situation');
  });

  it('a forged authorization field on the request changes nothing — the type carries no such field', () => {
    const forged = {
      ...req('scope-or-stack-change'),
      safe: true,
      approved: true,
      autoApprove: true,
      neverAuto: false,
    } as unknown as ApprovedBuildRequest;
    const decision = decideApprovedBuildAction(forged);
    expect(decision.action).toBe('ask_human');
    expect(decision.ruleId).toBe('scope-or-stack-change');
  });

  it('a well-formed approval whose digest no longer matches the current inputs is not an approval', () => {
    const decision = decideApprovedBuildAction(
      req('implement-ticket', {
        facts: facts({
          withinApprovedScope: true,
          currentInputDigest: 'sha256:someone-edited-the-scope',
        }),
      }),
    );
    expect(decision.action).toBe('ask_human');
    expect(decision.ruleId).toBe('approval-stale');
  });

  it('an approval carrying a different version is not this policy', () => {
    const decision = decideApprovedBuildAction(
      req('run-configured-check', {
        policy: { ...policy, version: 'approved-build-v2' },
        mode: 'interactive',
      }),
    );
    expect(decision.ruleId).toBe('legacy-requires-opt-in');
  });

  it('a raised budget is asked, never silently spent', () => {
    const decision = decideApprovedBuildAction(
      req('budget-or-escalation', {
        facts: facts({ requestedCents: policy.budgetCents + 1 }),
      }),
    );
    expect(decision.action).toBe('ask_human');
    expect(decision.ruleId).toBe('budget-exceeded');
  });

  it.each([['deploy'], ['main-merge'], ['destructive'], ['interview']] as const)(
    'a NEVER-AUTO pause site (%s) asks even for a routine situation with a valid approval',
    (site) => {
      const decision = decideApprovedBuildAction(
        req('implement-ticket', {
          facts: facts({ withinApprovedScope: true, pauseSite: site }),
        }),
      );
      expect(decision.action).toBe('ask_human');
      expect(decision.ruleId).toBe('c5-never-auto-pause-site');
    },
  );

  it('an unrecognized pause site is NEVER-AUTO, because isNeverAutoPauseSite fails closed (C-5)', () => {
    const decision = decideApprovedBuildAction(
      req('run-configured-check', {
        facts: facts({ pauseSite: 'clarificatio' as unknown as never }),
      }),
    );
    expect(decision.ruleId).toBe('c5-never-auto-pause-site');
  });

  it('the protected set is consulted, not copied: a main-branch action is refused by the existing classifier', () => {
    const decision = decideApprovedBuildAction(
      req('implement-ticket', {
        facts: facts({
          withinApprovedScope: true,
          action: { kind: 'merge', targetBranch: 'main' },
        }),
      }),
    );
    expect(decision.action).toBe('ask_human');
    expect(decision.ruleId).toBe('c5-protected-action');
  });

  it('an implement inside an approved scope proceeds without an extra approval, but an unchecked scope does not', () => {
    expect(
      decideApprovedBuildAction(
        req('implement-ticket', { facts: facts({ withinApprovedScope: true }) }),
      ).action,
    ).toBe('proceed');
    // Undefined is not "yes". A runtime that forgot to check the scope must
    // not read as a runtime that checked and approved.
    expect(decideApprovedBuildAction(req('implement-ticket')).ruleId).toBe(
      'implement-outside-scope',
    );
  });

  it('repair rounds are bounded by the approval, and an exhausted budget stops rather than loops', () => {
    const decision = decideApprovedBuildAction(
      req('repair-finding', {
        facts: facts({
          withinApprovedScope: true,
          repairRoundsUsed: policy.maxRepairRounds,
        }),
      }),
    );
    expect(decision.action).toBe('ask_human');
    expect(decision.ruleId).toBe('repair-rounds-exhausted');
  });
});

describe('approved-build-v1: machine acceptance refuses each precondition independently', () => {
  it.each([
    ['no review evidence at all', undefined, 'accept-no-review'],
    [
      'no independent reviewer identity',
      { ...freshReview, reviewerIdentityId: null },
      'accept-no-reviewer',
    ],
    [
      'the maker is the reviewer',
      { ...freshReview, reviewerIdentityId: 'identity-maker' },
      'accept-maker-is-verifier',
    ],
    [
      'maker and reviewer are the same model',
      { ...freshReview, reviewerModelId: 'model-a' },
      'accept-same-model',
    ],
    [
      'the model said CONFIRMED but a required check failed',
      { ...freshReview, requiredChecksAllPassed: false },
      'accept-required-check-failed',
    ],
    [
      'the verdict is not a confirmation',
      { ...freshReview, verdict: 'inconclusive' as const },
      'accept-verdict-not-confirmed',
    ],
    [
      'the receipt is stale',
      { ...freshReview, receiptFresh: false },
      'accept-stale-receipt',
    ],
    [
      'the source changed after the review',
      { ...freshReview, currentSourceDigest: 'sha256:head-2' },
      'accept-stale-review',
    ],
    [
      'the reviewed digest is missing entirely',
      { ...freshReview, reviewedSourceDigest: null },
      'accept-stale-review',
    ],
  ])('%s → no acceptance', (_name, review, ruleId) => {
    const decision = decideApprovedBuildAction(
      req('machine-accept', {
        facts: facts({ review: review as ApprovedBuildReviewFacts | undefined }),
      }),
    );
    expect(decision.action).toBe('ask_human');
    expect(decision.ruleId).toBe(ruleId);
  });
});
