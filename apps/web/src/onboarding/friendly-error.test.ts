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
