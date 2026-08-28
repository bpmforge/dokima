/**
 * W16-06. The novice-journey audit (2026-08-21) confirmed the interview — the
 * first screen a person meets after describing their idea — rendered raw
 * exception strings plus a bracketed HTTP code as its primary error line.
 * These tests pin the replacement shape: plain words first, the technical
 * string demoted, and mechanism-true wording per status.
 */
import { describe, expect, it } from 'vitest';
import { OnboardingApiError } from './api.js';
import {
  describeResumeError,
  describeResumeFailure,
  describeRunFailure,
  describeStillWaiting,
} from './friendly-error.js';

describe('describeRunFailure (W16-06)', () => {
  it(
    'RED FIXTURE: the summary never carries the raw "(HTTP n)" marker — that ' +
      'string was the primary error line this ticket was filed to demote',
    () => {
      for (const status of [401, 403, 404, 422, 500, 503]) {
        const { summary } = describeRunFailure(new OnboardingApiError(status, 'boom'));
        expect(summary).not.toContain('(HTTP');
        expect(summary).not.toContain('boom');
      }
      expect(describeRunFailure(new Error('fetch failed')).summary).not.toContain(
        'fetch failed',
      );
    },
  );

  it('keeps the technical string, demoted — shown, not swallowed', () => {
    const failure = describeRunFailure(new OnboardingApiError(500, 'boom'));
    expect(failure.detail).toBe('boom (HTTP 500)');
  });

  it('offers a concrete next step, and says the answers were kept', () => {
    const failure = describeRunFailure(new OnboardingApiError(500, 'boom'));
    expect(failure.summary).toMatch(/try again/i);
    expect(failure.summary).toMatch(/answers are still here/i);
  });

  it('says what a 401/403 actually means here: the session, not the person', () => {
    expect(describeRunFailure(new OnboardingApiError(401)).summary).toMatch(/signed in/i);
  });

  it('says what a 404 actually means here: an older server, with the recovery', () => {
    expect(describeRunFailure(new OnboardingApiError(404)).summary).toMatch(
      /older Dokima version/i,
    );
  });

  it('a non-HTTP failure blames the connection, not the person', () => {
    const failure = describeRunFailure(new TypeError('fetch failed'));
    expect(failure.summary).toMatch(/couldn't be reached/i);
    expect(failure.detail).toBe('fetch failed');
  });

  it('a thrown non-Error still produces a string detail', () => {
    expect(describeRunFailure('exploded').detail).toBe('exploded');
  });
});

describe('describeResumeFailure (W16-06)', () => {
  it('same shape as the run path, with resume wording and no kept-answers claim', () => {
    const failure = describeResumeFailure(new OnboardingApiError(500, 'boom'));
    expect(failure.summary).not.toContain('(HTTP');
    expect(failure.summary).not.toMatch(/answers are still here/i);
    expect(failure.detail).toBe('boom (HTTP 500)');
  });
});

describe('describeStillWaiting (W16-06)', () => {
  it('explains the 409 in the words of the screen above it — unanswered decisions', () => {
    const text = describeStillWaiting();
    expect(text).toMatch(/decisions above/i);
    expect(text).toMatch(/Continue/);
    expect(text).not.toContain('409');
  });
});

/**
 * Found live 2026-08-28 by walking the novice path with no provider
 * configured: create a project, answer one interview question, press Build
 * the board. The server answered 409 with the right sentence; the screen
 * showed the generic one and buried the useful one under "Technical detail".
 */
describe('describeRunFailure: 409 is the no-model case, and it must not say "try again"', () => {
  const failure = () => describeRunFailure(new OnboardingApiError(409, 'no model is configured'));

  it('names the fix instead of an invented cause', () => {
    const { summary } = failure();
    expect(summary).toContain('Settings → Models');
    expect(summary).toContain('Providers');
    // The generic branch's two wrong claims: there is no model to be running,
    // and retrying cannot succeed.
    expect(summary).not.toMatch(/check that your model is running/i);
    expect(summary).not.toMatch(/^The server hit an error/);
  });

  it('says plainly that retrying will not help', () => {
    expect(failure().summary).toMatch(/will not help/i);
  });

  it('still reassures that the answers survived, and still demotes the raw string', () => {
    const { summary, detail } = failure();
    expect(summary).toMatch(/answers are still here/i);
    expect(summary).not.toContain('(HTTP');
    expect(summary).not.toContain('no model is configured');
    expect(detail).toBe('no model is configured (HTTP 409)');
  });

  it('leaves every other status on the generic branch', () => {
    expect(describeRunFailure(new OnboardingApiError(500, 'boom')).summary).toMatch(
      /check that your model is running/i,
    );
  });
});

describe('describeResumeFailure: the parked run whose model went away', () => {
  it('names the fix rather than reporting a generic server error', () => {
    const { summary } = describeResumeFailure(new OnboardingApiError(409, 'no model', 'MODEL_RESOLUTION'));
    expect(summary).toContain('Settings → Models');
    expect(summary).not.toMatch(/check that your model is running/i);
    // The decisions were already answered — never imply they were lost.
    expect(summary).toMatch(/saved/i);
  });

  it('does not claim decisions are still unanswered — that screen is asking nothing', () => {
    const { summary } = describeResumeFailure(new OnboardingApiError(409, 'no model', 'MODEL_RESOLUTION'));
    expect(summary).not.toMatch(/still need an answer/i);
  });
});

describe('OnboardingApiError carries the problem rule, so two 409s stay distinguishable', () => {
  it('keeps the rule the server sent', () => {
    expect(new OnboardingApiError(409, 'x', 'UNDECIDED_SLATE').rule).toBe('UNDECIDED_SLATE');
    expect(new OnboardingApiError(409, 'x', 'MODEL_RESOLUTION').rule).toBe('MODEL_RESOLUTION');
  });

  it('is optional — a server that sends no rule still constructs', () => {
    expect(new OnboardingApiError(500, 'x').rule).toBeUndefined();
  });
});

describe('describeResumeError: which of the two 409s is this', () => {
  it('an UNDECIDED_SLATE 409 is still-waiting, not a failure', () => {
    const out = describeResumeError(new OnboardingApiError(409, 'x', 'UNDECIDED_SLATE'));
    expect(out.kind).toBe('still-waiting');
    expect(out.kind === 'still-waiting' && out.message).toMatch(/still need an answer/i);
  });

  it('RED FIXTURE: a MODEL_RESOLUTION 409 is a failure naming the fix, never still-waiting', () => {
    const out = describeResumeError(new OnboardingApiError(409, 'no model', 'MODEL_RESOLUTION'));
    expect(out.kind).toBe('failed');
    expect(out.kind === 'failed' && out.failure.summary).toContain('Settings → Models');
  });

  it('a 409 with no rule keeps the old still-waiting reading — the server that sends none is the old one', () => {
    expect(describeResumeError(new OnboardingApiError(409, 'x')).kind).toBe('still-waiting');
  });

  it('any other status is a failure', () => {
    expect(describeResumeError(new OnboardingApiError(500, 'boom')).kind).toBe('failed');
    expect(describeResumeError(new Error('offline')).kind).toBe('failed');
  });
});

/**
 * Found by driving the guided sample to completion on a real local model
 * (2026-08-28): after all three founder decisions were answered, Continue
 * returned 500 "lm-studio: request timed out after 300000ms" and the screen
 * said "check that your model is running". The model was running. It was slow.
 */
describe('a slow or absent model is not "check that your model is running"', () => {
  it('RED FIXTURE: a 504 says the model was too slow, and that a retry is worth it', () => {
    const { summary } = describeRunFailure(new OnboardingApiError(504, 'timed out', 'MODEL_TIMEOUT'));
    expect(summary).toMatch(/did not answer in time/i);
    expect(summary).toMatch(/faster model/i);
    expect(summary).not.toMatch(/check that your model is running/i);
    // Measured: three consecutive resume attempts timed out identically, so a
    // promise that retrying works would be a claim the product cannot keep.
    expect(summary).not.toMatch(/trying again is worth it/i);
    expect(summary).toMatch(/one more try may/i);
    expect(summary).toMatch(/times out again/i);
  });

  it('a 503 points at the endpoint, not at the model choice', () => {
    const { summary } = describeRunFailure(
      new OnboardingApiError(503, 'unreachable', 'MODEL_UNREACHABLE'),
    );
    expect(summary).toMatch(/could not reach/i);
    expect(summary).toMatch(/Settings → Providers/);
    expect(summary).not.toMatch(/check that your model is running/i);
  });

  it('both reach the resume path too — the run that timed out was a resume', () => {
    expect(describeResumeFailure(new OnboardingApiError(504, 'timed out')).summary).toMatch(
      /did not answer in time/i,
    );
    expect(describeResumeFailure(new OnboardingApiError(504, 'x')).summary).toMatch(
      /continuing the run/i,
    );
  });

  it('an ordinary 500 still gets the generic branch', () => {
    expect(describeRunFailure(new OnboardingApiError(500, 'boom')).summary).toMatch(
      /check that your model is running/i,
    );
  });
});
