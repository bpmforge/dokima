import { describe, expect, it } from 'vitest';
import { createCoverageTracker } from './state-coverage.mjs';

describe('createCoverageTracker', () => {
  it('rejects a declared list with duplicate ids up front', () => {
    expect(() => createCoverageTracker([{ id: 'a' }, { id: 'a' }])).toThrow(/duplicate/);
  });

  it('finish() reports DONE for every captured state, in declared order', () => {
    const tracker = createCoverageTracker([{ id: 'a' }, { id: 'b' }]);
    tracker.capture('b');
    tracker.capture('a');
    expect(tracker.finish()).toEqual([
      { id: 'a', status: 'done' },
      { id: 'b', status: 'done' },
    ]);
  });

  it('finish() throws naming every state that was declared but never captured (SKIPPED)', () => {
    const tracker = createCoverageTracker([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    tracker.capture('b');
    expect(() => tracker.finish()).toThrow(/SKIPPED.*a.*c|a.*c.*SKIPPED/s);
  });

  it('a WAIVED state passes finish() without ever being captured', () => {
    const tracker = createCoverageTracker([
      { id: 'a' },
      { id: 'b', waiver: 'not mounted anywhere reachable' },
    ]);
    tracker.capture('a');
    expect(tracker.finish()).toEqual([
      { id: 'a', status: 'done' },
      { id: 'b', status: 'waived', reason: 'not mounted anywhere reachable' },
    ]);
  });

  it('capturing a WAIVED state is a bug, not a bonus — it throws', () => {
    const tracker = createCoverageTracker([{ id: 'a', waiver: 'unreachable' }]);
    expect(() => tracker.capture('a')).toThrow(/WAIVED/);
  });

  it('capturing an undeclared state throws instead of silently recording it', () => {
    const tracker = createCoverageTracker([{ id: 'a' }]);
    expect(() => tracker.capture('z')).toThrow(/undeclared/);
  });

  it('capturing the same state twice throws', () => {
    const tracker = createCoverageTracker([{ id: 'a' }]);
    tracker.capture('a');
    expect(() => tracker.capture('a')).toThrow(/twice/);
  });

  it('assert() throws with the state id in the message on a false condition', () => {
    const tracker = createCoverageTracker([{ id: 'a' }]);
    expect(() => tracker.assert('a', false, 'expected zero project cards')).toThrow(
      /"a".*expected zero project cards/,
    );
  });

  it('assert() is a no-op on a true condition', () => {
    const tracker = createCoverageTracker([{ id: 'a' }]);
    expect(() => tracker.assert('a', true, 'unreachable')).not.toThrow();
  });

  it('an empty declared list finishes with an empty report', () => {
    expect(createCoverageTracker([]).finish()).toEqual([]);
  });
});
