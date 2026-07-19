import { describe, expect, it } from 'vitest';
import { formatResolvedMarkerLine, formatUnresolvedMarkerLine } from './markers.js';
import {
  UnresolvedFounderDecisionError,
  assertDecisionComplete,
  decideBlueprintUnlock,
} from './gate.js';

const REAL_LEDGER = [
  '| ID | Date | Decision | Options considered | Rationale |',
  '|---|---|---|---|---|',
  '| D-021 | 2026-07-19 | License is MIT | MIT, AGPL-3.0 | adoption is the goal |',
].join('\n');

describe('decideBlueprintUnlock (FR-P7)', () => {
  it('allows phase 3/4 when the blueprint has no open questions at all', () => {
    const markdown = '# Blueprint\n\n## Open Questions\n\nNone — decision-complete.';
    for (const phaseId of [3, 4] as const) {
      const result = decideBlueprintUnlock(markdown, REAL_LEDGER, phaseId);
      expect(result).toEqual({ allowed: true, phaseId, reasons: [] });
    }
  });

  it('allows when every marker is resolved and each cited D-ID is real', () => {
    const markdown = formatResolvedMarkerLine(
      'licensing',
      'What license?',
      'D-021',
      'MIT',
    );
    const result = decideBlueprintUnlock(markdown, REAL_LEDGER, 3);
    expect(result).toEqual({ allowed: true, phaseId: 3, reasons: [] });
  });

  it('refuses with a named reason when an unresolved marker remains', () => {
    const markdown = formatUnresolvedMarkerLine('licensing', 'What license?');
    const result = decideBlueprintUnlock(markdown, REAL_LEDGER, 3);
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/"licensing" is unresolved/);
  });

  it('RED FIXTURE — decision-complete prose does not unlock the gate if a real marker remains', () => {
    // Defeats the exact spoof a naive "search for the word None" gate would
    // fall for: a summary claiming completeness while a genuine UNRESOLVED
    // marker still sits in the document.
    const markdown = [
      '## Open Questions',
      '',
      'None — decision-complete.',
      '',
      formatUnresolvedMarkerLine('licensing', 'What license?'),
    ].join('\n');

    const result = decideBlueprintUnlock(markdown, REAL_LEDGER, 4);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toContain('licensing');
  });

  it('RED FIXTURE — a RESOLVED marker citing a D-ID absent from the ledger is refused as a spoofed resolution', () => {
    // The headline fixture: the blueprint text alone looks fully resolved
    // (no UNRESOLVED marker anywhere), but the cited decision was never
    // actually recorded in docs/DECISIONS.md — a blueprint grading itself.
    const markdown = formatResolvedMarkerLine(
      'licensing',
      'What license?',
      'D-999',
      'MIT (fabricated)',
    );
    const result = decideBlueprintUnlock(markdown, REAL_LEDGER, 3);
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/D-999/);
    expect(result.reasons[0]).toMatch(/no such decision exists/);
  });

  it('RED FIXTURE — an empty ledger refuses every resolved marker, however plausible', () => {
    const markdown = formatResolvedMarkerLine(
      'licensing',
      'What license?',
      'D-021',
      'MIT',
    );
    const result = decideBlueprintUnlock(markdown, '', 3);
    expect(result.allowed).toBe(false);
  });

  it('RED FIXTURE — a malformed marker (missing D-ID) blocks the gate exactly like an unresolved one', () => {
    const markdown = '- **Decided:** x <!-- FOUNDER-DECISION: licensing RESOLVED -->';
    const result = decideBlueprintUnlock(markdown, REAL_LEDGER, 4);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toContain('cites no D-ID');
  });

  it('RED FIXTURE — duplicate markers for one key block the gate even when one of them is validly resolved', () => {
    const markdown = [
      formatUnresolvedMarkerLine('licensing', 'q'),
      formatResolvedMarkerLine('licensing', 'q', 'D-021', 'MIT'),
    ].join('\n');
    const result = decideBlueprintUnlock(markdown, REAL_LEDGER, 3);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toContain('ambiguous');
  });
});

describe('assertDecisionComplete', () => {
  it('does not throw when the gate allows', () => {
    expect(() =>
      assertDecisionComplete('# Blueprint\n\nNo markers.', REAL_LEDGER, 3),
    ).not.toThrow();
  });

  it('throws UnresolvedFounderDecisionError with the reasons when the gate refuses', () => {
    const markdown = formatUnresolvedMarkerLine('licensing', 'What license?');
    expect(() => assertDecisionComplete(markdown, REAL_LEDGER, 4)).toThrow(
      UnresolvedFounderDecisionError,
    );
    expect(() => assertDecisionComplete(markdown, REAL_LEDGER, 4)).toThrow(
      /phase 4.*licensing/s,
    );
  });
});
