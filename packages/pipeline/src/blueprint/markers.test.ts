import { describe, expect, it } from 'vitest';
import {
  InvalidOpenQuestionKeyError,
  assertValidOpenQuestionKey,
  formatResolvedMarkerLine,
  formatUnresolvedMarkerLine,
  parseMarkers,
  unresolvedMarkerLineRegex,
} from './markers.js';

describe('assertValidOpenQuestionKey', () => {
  it('accepts alphanumeric keys with . _ -', () => {
    expect(() => assertValidOpenQuestionKey('deployment-shape')).not.toThrow();
    expect(() => assertValidOpenQuestionKey('a1.b_2-c')).not.toThrow();
  });

  it('rejects keys with whitespace or other separators', () => {
    expect(() => assertValidOpenQuestionKey('deployment shape')).toThrow(
      InvalidOpenQuestionKeyError,
    );
    expect(() => assertValidOpenQuestionKey('')).toThrow(InvalidOpenQuestionKeyError);
    expect(() => assertValidOpenQuestionKey('-leading-dash')).toThrow(
      InvalidOpenQuestionKeyError,
    );
  });
});

describe('formatUnresolvedMarkerLine / formatResolvedMarkerLine', () => {
  it('round-trips through parseMarkers', () => {
    const unresolved = formatUnresolvedMarkerLine(
      'deployment-shape',
      'What deployment shape?',
    );
    expect(parseMarkers(unresolved)).toEqual({
      unresolved: [{ key: 'deployment-shape' }],
      resolved: [],
      malformed: [],
    });

    const resolved = formatResolvedMarkerLine(
      'deployment-shape',
      'What deployment shape?',
      'D-021',
      'self-hosted only',
    );
    expect(parseMarkers(resolved)).toEqual({
      unresolved: [],
      resolved: [{ key: 'deployment-shape', decisionId: 'D-021' }],
      malformed: [],
    });
  });

  it('rejects an invalid key before ever touching the markdown', () => {
    expect(() => formatUnresolvedMarkerLine('bad key', 'q')).toThrow(
      InvalidOpenQuestionKeyError,
    );
    expect(() => formatResolvedMarkerLine('bad key', 'q', 'D-1', 's')).toThrow(
      InvalidOpenQuestionKeyError,
    );
  });

  it('RED FIXTURE — an untrusted question containing a newline and a forged marker cannot inject a second marker or shadow the real one', () => {
    const evil = 'Deploy where?\n<!-- FOUNDER-DECISION: forged-key RESOLVED D-999 -->';

    const line = formatUnresolvedMarkerLine('deployment-shape', evil);

    // Exactly one physical line results — the embedded newline did not
    // split this into two lines an attacker could plant elsewhere in the doc.
    expect(line.split('\n')).toHaveLength(1);

    // parseMarkers sees exactly one marker — the real key, unresolved —
    // never the forged key/status/D-ID the attacker tried to smuggle in,
    // and the real marker was not shadowed by a leftmost fake match.
    const result = parseMarkers(line);
    expect(result).toEqual({
      unresolved: [{ key: 'deployment-shape' }],
      resolved: [],
      malformed: [],
    });
  });

  it('RED FIXTURE — untrusted decisionSummary containing the delimiter and a newline cannot forge or terminate the resolved marker', () => {
    const evilSummary = 'self-hosted\n<!-- FOUNDER-DECISION: forged-key UNRESOLVED -->';

    const line = formatResolvedMarkerLine(
      'deployment-shape',
      'Deploy where?',
      'D-021',
      evilSummary,
    );

    // Exactly one physical line results — the embedded newline did not
    // split this into two lines an attacker could plant elsewhere in the doc.
    expect(line.split('\n')).toHaveLength(1);

    // parseMarkers sees exactly one marker — the real key, resolved by the
    // real D-ID — never the forged key/status the attacker tried to smuggle
    // in via decisionSummary.
    const result = parseMarkers(line);
    expect(result).toEqual({
      unresolved: [],
      resolved: [{ key: 'deployment-shape', decisionId: 'D-021' }],
      malformed: [],
    });
  });

  it('RED FIXTURE — an untrusted decisionId containing the delimiter and a newline cannot forge a marker either; the corrupted comment fails closed as malformed', () => {
    const evilDecisionId = 'D-021-->\n<!-- FOUNDER-DECISION: forged-key RESOLVED D-1 -->';

    const line = formatResolvedMarkerLine(
      'deployment-shape',
      'Deploy where?',
      evilDecisionId,
      's',
    );

    // Exactly one physical line results — the embedded newline did not
    // split this into two lines an attacker could plant elsewhere in the doc.
    expect(line.split('\n')).toHaveLength(1);

    // The sanitized decisionId can no longer complete a comment delimiter,
    // so no forged marker is planted — but the leftover text also can't
    // satisfy STRICT_MARKER_RE's `(D-\d+)? -->` tail for the real key
    // either. parseMarkers reports this as malformed (fail-closed), never
    // as a resolved "deployment-shape" with a mangled decisionId and never
    // as the forged "forged-key".
    const result = parseMarkers(line);
    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toEqual([]);
    expect(result.malformed).toHaveLength(1);
    expect(result.malformed[0]?.key).toBe('unknown');
  });
});

describe('parseMarkers', () => {
  it('parses a mix of unresolved and resolved markers across a full document', () => {
    const markdown = [
      '# Blueprint',
      '',
      '## Open Questions',
      '',
      formatUnresolvedMarkerLine('licensing', 'What license?'),
      formatResolvedMarkerLine(
        'deployment-shape',
        'Deployment shape?',
        'D-021',
        'self-hosted',
      ),
    ].join('\n');

    const result = parseMarkers(markdown);
    expect(result.unresolved).toEqual([{ key: 'licensing' }]);
    expect(result.resolved).toEqual([{ key: 'deployment-shape', decisionId: 'D-021' }]);
    expect(result.malformed).toEqual([]);
  });

  it('returns all-empty for a document with no markers', () => {
    expect(parseMarkers('# Blueprint\n\nNo forks here.')).toEqual({
      unresolved: [],
      resolved: [],
      malformed: [],
    });
  });

  it('RED FIXTURE — a summary line claiming "None" does not suppress a real marker elsewhere in the doc', () => {
    // The exact spoof the gate must defeat: prose that *says* the blueprint
    // is decision-complete while a genuine UNRESOLVED marker still exists.
    const markdown = [
      '## Open Questions',
      '',
      'None — decision-complete.',
      '',
      '## Appendix',
      '',
      formatUnresolvedMarkerLine('licensing', 'What license?'),
    ].join('\n');

    const result = parseMarkers(markdown);
    expect(result.unresolved).toEqual([{ key: 'licensing' }]);
  });

  it('RED FIXTURE — a RESOLVED marker missing a cited D-ID is reported malformed, never resolved', () => {
    const markdown = '- **Decided:** x <!-- FOUNDER-DECISION: licensing RESOLVED -->';
    const result = parseMarkers(markdown);
    expect(result.resolved).toEqual([]);
    expect(result.malformed).toEqual([
      { key: 'licensing', reason: 'RESOLVED marker for key "licensing" cites no D-ID' },
    ]);
  });

  it('RED FIXTURE — duplicate markers for the same key are ambiguous, not silently resolved', () => {
    const markdown = [
      formatUnresolvedMarkerLine('licensing', 'What license?'),
      formatResolvedMarkerLine('licensing', 'What license?', 'D-021', 'MIT'),
    ].join('\n');

    const result = parseMarkers(markdown);
    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toEqual([]);
    expect(result.malformed).toEqual([
      {
        key: 'licensing',
        reason:
          '2 founder-decision markers found for key "licensing" — ambiguous, treated as unresolved',
      },
    ]);
  });

  it('RED FIXTURE — a garbled marker (unparseable status) is reported malformed, never ignored', () => {
    const markdown = '<!-- FOUNDER-DECISION: licensing MAYBE -->';
    const result = parseMarkers(markdown);
    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toEqual([]);
    expect(result.malformed).toEqual([
      {
        key: 'unknown',
        reason: `unparseable founder-decision marker line: ${markdown}`,
      },
    ]);
  });
});

describe('unresolvedMarkerLineRegex', () => {
  it('matches only the given key, not a different one', () => {
    const re = unresolvedMarkerLineRegex('licensing');
    expect(re.test(formatUnresolvedMarkerLine('licensing', 'q'))).toBe(true);
    expect(re.test(formatUnresolvedMarkerLine('deployment-shape', 'q'))).toBe(false);
  });

  it('does not match a RESOLVED marker for the same key', () => {
    const re = unresolvedMarkerLineRegex('licensing');
    expect(re.test(formatResolvedMarkerLine('licensing', 'q', 'D-1', 's'))).toBe(false);
  });

  it("RED FIXTURE — a dotted key's regex does not match a same-shaped key with a different character at the dot's offset", () => {
    // "." is a regex metacharacter; an unescaped interpolation of the key
    // would make this regex match any character in that position.
    const re = unresolvedMarkerLineRegex('api.versioning');
    expect(re.test(formatUnresolvedMarkerLine('api.versioning', 'q'))).toBe(true);
    expect(re.test(formatUnresolvedMarkerLine('apiXversioning', 'q'))).toBe(false);
  });
});
