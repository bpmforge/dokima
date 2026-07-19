import { describe, expect, it } from 'vitest';
import { formatUnresolvedMarkerLine, parseMarkers } from './markers.js';
import { UnknownOpenQuestionError, resolveOpenQuestion } from './revision.js';
import type { BlueprintDocument } from './types.js';

function doc(markdown: string, version = 1): BlueprintDocument {
  return { version, markdown };
}

describe('resolveOpenQuestion', () => {
  it('replaces the UNRESOLVED marker line with a RESOLVED one and bumps the version', () => {
    const before = [
      '# Blueprint',
      '',
      '## Open Questions',
      '',
      formatUnresolvedMarkerLine('licensing', 'What license?'),
      formatUnresolvedMarkerLine('deployment-shape', 'What deployment shape?'),
    ].join('\n');

    const result = resolveOpenQuestion(doc(before), {
      key: 'licensing',
      question: 'What license?',
      decisionId: 'D-021',
      decisionSummary: 'MIT — adoption is the goal',
    });

    expect(result.before).toBe(before);
    expect(result.document.version).toBe(2);

    const parsed = parseMarkers(result.document.markdown);
    expect(parsed.resolved).toEqual([{ key: 'licensing', decisionId: 'D-021' }]);
    expect(parsed.unresolved).toEqual([{ key: 'deployment-shape' }]);
    expect(parsed.malformed).toEqual([]);

    // Every other line is preserved.
    expect(result.document.markdown).toContain('# Blueprint');
    expect(result.document.markdown).toContain('## Open Questions');
  });

  it('is a single-line replace — line count is unchanged', () => {
    const before = [
      formatUnresolvedMarkerLine('licensing', 'q'),
      formatUnresolvedMarkerLine('deployment-shape', 'q2'),
    ].join('\n');

    const result = resolveOpenQuestion(doc(before), {
      key: 'licensing',
      question: 'q',
      decisionId: 'D-1',
      decisionSummary: 's',
    });

    expect(result.document.markdown.split('\n')).toHaveLength(2);
  });

  it('throws for an unknown key', () => {
    expect(() =>
      resolveOpenQuestion(doc(formatUnresolvedMarkerLine('licensing', 'q')), {
        key: 'nonexistent',
        question: 'q',
        decisionId: 'D-1',
        decisionSummary: 's',
      }),
    ).toThrow(UnknownOpenQuestionError);
  });

  it('throws when the key is already resolved (no live UNRESOLVED marker to replace)', () => {
    const before =
      '- **Decided (D-1):** q — s <!-- FOUNDER-DECISION: licensing RESOLVED D-1 -->';
    expect(() =>
      resolveOpenQuestion(doc(before), {
        key: 'licensing',
        question: 'q',
        decisionId: 'D-2',
        decisionSummary: 's2',
      }),
    ).toThrow(UnknownOpenQuestionError);
  });

  it("RED FIXTURE — resolving one key never touches a different key's marker", () => {
    const before = [
      formatUnresolvedMarkerLine('licensing', 'q1'),
      formatUnresolvedMarkerLine('deployment-shape', 'q2'),
    ].join('\n');

    const result = resolveOpenQuestion(doc(before), {
      key: 'licensing',
      question: 'q1',
      decisionId: 'D-1',
      decisionSummary: 's',
    });

    expect(result.document.markdown).toContain(
      formatUnresolvedMarkerLine('deployment-shape', 'q2'),
    );
  });

  it('RED FIXTURE — resolving a dotted key never touches a same-shaped key with a different character at the dot offset', () => {
    // Regression: an unescaped "." in the key regex matches any character,
    // so resolving "api.versioning" could previously also rewrite the
    // unrelated "apiXversioning" marker.
    const before = [
      formatUnresolvedMarkerLine('api.versioning', 'q1'),
      formatUnresolvedMarkerLine('apiXversioning', 'q2'),
    ].join('\n');

    const result = resolveOpenQuestion(doc(before), {
      key: 'api.versioning',
      question: 'q1',
      decisionId: 'D-1',
      decisionSummary: 's',
    });

    expect(result.document.markdown).toContain(
      formatUnresolvedMarkerLine('apiXversioning', 'q2'),
    );

    const parsed = parseMarkers(result.document.markdown);
    expect(parsed.resolved).toEqual([{ key: 'api.versioning', decisionId: 'D-1' }]);
    expect(parsed.unresolved).toEqual([{ key: 'apiXversioning' }]);
  });
});
