import { describe, expect, it } from 'vitest';
import {
  AutoAnswerRefusedError,
  assertHumanActor,
  MAX_FOLLOWUP_DEPTH,
} from './depth-policy.js';
import type { AnswerActor } from './types.js';

describe('assertHumanActor (NA-1)', () => {
  it('does not throw for a human actor', () => {
    expect(() => assertHumanActor({ id: 'brad', kind: 'human' })).not.toThrow();
  });

  it.each<AnswerActor>([
    { id: 'dokima-coder', kind: 'agent' },
    { id: 'auto-runner', kind: 'agent' },
  ])('RED FIXTURE — refuses actor kind "agent" (%o)', (actor) => {
    expect(() => assertHumanActor(actor)).toThrow(AutoAnswerRefusedError);
  });

  it('the rejection message cites NA-1 and names the actor', () => {
    try {
      assertHumanActor({ id: 'dokima-coder', kind: 'agent' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AutoAnswerRefusedError);
      expect((err as Error).message).toContain('NA-1');
      expect((err as Error).message).toContain('dokima-coder');
    }
  });

  it('MAX_FOLLOWUP_DEPTH is a positive finite ceiling', () => {
    expect(MAX_FOLLOWUP_DEPTH).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_FOLLOWUP_DEPTH)).toBe(true);
  });
});
