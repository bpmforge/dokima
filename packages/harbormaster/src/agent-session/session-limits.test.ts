/**
 * W21-18. A turn that hits the output ceiling can mean two opposite things,
 * and the message used to assert only one of them.
 */
import { describe, expect, it } from 'vitest';
import { turnTokenStop } from './session-limits.js';

describe('a truncated reasoning model is not an empty answer (W21-18)', () => {
  it('RED FIXTURE: hit the ceiling with NO answer text — the shape measured on a real MTP server — reads as truncated mid-thought, not as a model that will not stop', () => {
    const stop = turnTokenStop('length', 4096, '');
    expect(stop).not.toBeNull();
    expect(stop!.stderr).toContain('NO answer text');
    expect(stop!.stderr).toContain('reasoning model truncated mid-thought');
    // The distinction that matters downstream: this is NOT the same failure
    // as answering without a manifest, which is what it used to look like.
    expect(stop!.stderr).toContain('not "no manifest returned"');
    expect(stop!.stderr).not.toContain('will not stop');
  });

  it('hit the ceiling MID-ANSWER — still the old diagnosis, because that one was right', () => {
    const stop = turnTokenStop('length', 4096, 'I have started writing the file and');
    expect(stop!.stderr).toContain('will not stop');
    expect(stop!.stderr).not.toContain('mid-thought');
  });

  it('whitespace is not an answer', () => {
    expect(turnTokenStop('length', 4096, '   \n  ')!.stderr).toContain('NO answer text');
  });

  it('a normal stop is not a truncation at all', () => {
    expect(turnTokenStop('stop', 4096, 'done')).toBeNull();
    expect(turnTokenStop('tool_calls', 4096, '')).toBeNull();
  });

  it('the default keeps the old behaviour for callers that pass no content', () => {
    expect(turnTokenStop('length', 4096)!.stderr).toContain('NO answer text');
  });
});
