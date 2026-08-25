/** W20-05: the interviewer has a name — and still claims nothing the ledger cannot back. */
import { describe, expect, it } from 'vitest';
import {
  describeHeading,
  describeSubhead,
  INTERVIEWER,
  slateAttribution,
} from './personaCopy.js';

describe('persona-voiced copy (W20-05, D-028)', () => {
  it('the describe flow is addressed by a person, in both the first-contact and re-describe states', () => {
    expect(describeHeading(false)).toContain('Ida');
    expect(describeHeading(false)).toContain('questions');
    expect(describeHeading(true)).toContain('Ida');
    expect(describeHeading(true)).toContain('start over');
  });

  it('slate attribution names who brought it and pluralises honestly', () => {
    expect(slateAttribution(1)).toBe('Ida brought you a question only you can answer.');
    expect(slateAttribution(3)).toBe('Ida brought you 3 questions only you can answer.');
  });

  it('RED FIXTURE: no persona copy asserts a STATE — a face says who is asking, the ledger says what happened (D-028)', () => {
    const stateWords =
      /\b(working|running|done|finished|complete|building|reviewing|shipped|in progress)\b/i;
    for (const s of [
      describeHeading(true),
      describeHeading(false),
      describeSubhead(),
      slateAttribution(1),
      slateAttribution(4),
    ]) {
      expect(s, `copy asserts a state: "${s}"`).not.toMatch(stateWords);
    }
  });

  it('the interviewer identity matches the roster role, so the face and the actor id cannot drift', () => {
    expect(INTERVIEWER.role).toBe('pm-interviewer');
    expect(INTERVIEWER.displayName).toBe('Ida');
  });
});
