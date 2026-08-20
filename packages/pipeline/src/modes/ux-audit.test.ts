/**
 * W13-55. The property that makes any model safe as the judge: an
 * unverifiable claim never becomes work.
 */
import { describe, expect, it } from 'vitest';
import {
  buildUxAuditPrompt,
  judgmentToPlanFields,
  parseUxAuditJudgments,
  verifyCitations,
  type UxAuditJudgment,
  type UxEvidenceState,
} from './ux-audit.js';

const ROSTER_STATE: UxEvidenceState = {
  id: '10-roster',
  strings: [
    'Agent Roster',
    'No model will take this role yet — pick models in Settings → Models.',
  ],
  interactive: [{ name: 'Roster' }],
  geometry: { occupancy: 0.62, viewport: { w: 1280, h: 720 } },
};

function judgment(overrides: Partial<UxAuditJudgment> = {}): UxAuditJudgment {
  return {
    id: 'roster-jargon',
    state: '10-roster',
    problem: 'The roster shows an instruction.',
    severity: 'high',
    citation: 'pick models in Settings → Models',
    fixSummary: 'Point at a tab that exists.',
    ...overrides,
  };
}

describe('verifyCitations — the re-grep (C-2/C-3)', () => {
  it('RED FIXTURE: a fabricated citation is DROPPED with a reason; a real one survives', () => {
    const real = judgment();
    const fabricated = judgment({
      id: 'invented',
      citation: 'this sentence appears nowhere in the product',
    });
    const { verified, dropped } = verifyCitations([real, fabricated], [ROSTER_STATE]);
    expect(verified).toEqual([real]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toContain('citation not present');
  });

  it('a citation is checked against the NAMED state only — a string elsewhere cannot launder a claim', () => {
    const other: UxEvidenceState = { id: '01-fleet', strings: ['Fleet'] };
    const misattributed = judgment({ state: '01-fleet' });
    const { verified, dropped } = verifyCitations([misattributed], [ROSTER_STATE, other]);
    expect(verified).toEqual([]);
    expect(dropped[0]!.reason).toContain('citation not present');
  });

  it('an unknown state is a drop, not a crash', () => {
    const { dropped } = verifyCitations([judgment({ state: 'no-such-frame' })], [ROSTER_STATE]);
    expect(dropped[0]!.reason).toContain('no captured state named');
  });
});

describe('parseUxAuditJudgments', () => {
  it('keeps well-formed findings and reports malformed ones instead of throwing', () => {
    const { judgments, malformed } = parseUxAuditJudgments({
      findings: [
        judgment() as unknown,
        { id: 'half', state: '10-roster' },
        'not an object',
      ],
    });
    expect(judgments).toHaveLength(1);
    expect(malformed).toHaveLength(2);
  });

  it('an empty findings list is a valid answer, not an error', () => {
    expect(parseUxAuditJudgments({ findings: [] })).toEqual({ judgments: [], malformed: [] });
  });
});

describe('prompt and plan mapping', () => {
  it('the prompt carries the evidence and demands verbatim citations', () => {
    const { system, user } = buildUxAuditPrompt([ROSTER_STATE]);
    expect(system).toContain('copied verbatim');
    expect(user).toContain('Settings → Models');
    expect(user).toContain('"occupancy": 0.62');
  });

  it('a judgment maps into the plans funnel with legible provenance', () => {
    const fields = judgmentToPlanFields(judgment());
    expect(fields.catalogId).toBe('UX-roster-jargon');
    expect(fields.severity).toBe(3);
    expect(fields.rank).toBe(6);
    expect(fields.evidence).toEqual({
      state: '10-roster',
      citation: 'pick models in Settings → Models',
    });
  });
});
