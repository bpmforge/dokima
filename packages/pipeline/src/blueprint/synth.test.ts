import { describe, expect, it } from 'vitest';
import type { FounderSlateInput } from '../decisions/founder-slate.js';
import { parseMarkers } from './markers.js';
import { DuplicateOpenQuestionKeyError, synthesizeBlueprint } from './synth.js';

const LICENSING_SLATE: FounderSlateInput = {
  title: 'What license?',
  options: [
    { id: 'mit', label: 'MIT', tradeoffs: 'maximal adoption, minimal protection' },
    {
      id: 'agpl',
      label: 'AGPL-3.0',
      tradeoffs: 'copyleft, deters some enterprise adoption',
    },
  ],
  recommendedId: 'mit',
  recommendedReasoning: 'adoption is the goal',
};

describe('synthesizeBlueprint', () => {
  it('assembles a version-1 document with sections and one slate per open question', () => {
    const result = synthesizeBlueprint({
      title: 'Shipwright — Blueprint',
      sections: [
        { heading: 'Software Requirements (condensed)', body: 'FR-P7: ...' },
        { heading: 'High-level architecture', body: 'Event-sourced core, ...' },
      ],
      openQuestions: [{ key: 'licensing', slate: LICENSING_SLATE }],
    });

    expect(result.document.version).toBe(1);
    expect(result.slates).toHaveLength(1);
    expect(result.slates[0]).toMatchObject({ kind: 'founder', title: 'What license?' });

    expect(result.document.markdown).toContain('# Shipwright — Blueprint');
    expect(result.document.markdown).toContain('## Software Requirements (condensed)');
    expect(result.document.markdown).toContain('## High-level architecture');
    expect(result.document.markdown).toContain('## Open Questions');

    const parsed = parseMarkers(result.document.markdown);
    expect(parsed.unresolved).toEqual([{ key: 'licensing' }]);
    expect(parsed.resolved).toEqual([]);
    expect(parsed.malformed).toEqual([]);
  });

  it('renders "None — decision-complete." when there are no open questions', () => {
    const result = synthesizeBlueprint({
      title: 'Blueprint',
      sections: [{ heading: 'SRS', body: 'body' }],
      openQuestions: [],
    });

    expect(result.slates).toEqual([]);
    expect(result.document.markdown).toContain('None — decision-complete.');
    expect(parseMarkers(result.document.markdown)).toEqual({
      unresolved: [],
      resolved: [],
      malformed: [],
    });
  });

  it('refuses a reused open-question key', () => {
    expect(() =>
      synthesizeBlueprint({
        title: 'Blueprint',
        sections: [],
        openQuestions: [
          { key: 'licensing', slate: LICENSING_SLATE },
          { key: 'licensing', slate: LICENSING_SLATE },
        ],
      }),
    ).toThrow(DuplicateOpenQuestionKeyError);
  });

  it('propagates buildFounderSlate validation failures (e.g. only 1 option) rather than swallowing them', () => {
    expect(() =>
      synthesizeBlueprint({
        title: 'Blueprint',
        sections: [],
        openQuestions: [
          {
            key: 'licensing',
            slate: { ...LICENSING_SLATE, options: [LICENSING_SLATE.options[0]!] },
          },
        ],
      }),
    ).toThrow(/2–4 options/);
  });
});
