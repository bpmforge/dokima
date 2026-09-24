/**
 * W23-37: the grounding half of a deliverable ticket's verify. The end-to-end
 * red fixture (the measured boilerplate VISION.md refused by the ticket's own
 * verify) lives in run-pipeline.test.ts, where the blueprint is synthesized
 * the way a real run synthesizes it; these pin the pieces it is made of.
 */
import { describe, expect, it } from 'vitest';
import {
  deliverableDrafts,
  groundedVerify,
  groundingTerms,
} from './deliverable-drafts.js';

const EXPENSE = [
  '# Expense Ledger',
  '## Vision',
  'A simple personal expense tracker that records spending and shows a monthly summary.',
  '## Scope',
  'In scope: add an expense, list expenses, monthly total by category.',
  '## Open Questions',
  'None — decision-complete.',
].join('\n\n');

describe('groundingTerms (W23-37)', () => {
  it('draws the product’s own words from the body — never the title — and none of software-in-general', () => {
    const terms = groundingTerms(EXPENSE);
    // A title pasted over boilerplate must not satisfy the check.
    expect(terms).not.toContain('expense');
    expect(terms).not.toContain('ledger');
    expect(terms).toContain('monthly');
    expect(terms).toContain('spending');
    // The measured boilerplate's vocabulary is exactly what must never count.
    for (const generic of [
      'project',
      'codebase',
      'maintainable',
      'development',
      'simple',
    ])
      expect(terms).not.toContain(generic);
    // Verbs a boilerplate file would use as readily as a real one.
    for (const verb of ['show', 'record', 'list']) expect(terms).not.toContain(verb);
  });

  it('ignores the Open Questions bookkeeping and file paths', () => {
    const terms = groundingTerms(
      '# Tally\n\ncontent for docs/VISION.md\n\n## Open Questions\n\nzebra',
    );
    expect(terms).not.toContain('zebra');
    expect(terms).not.toContain('docs');
  });
});

describe('groundedVerify (W23-37)', () => {
  it('is null — never a pattern that matches anything — when there are too few terms', () => {
    expect(groundedVerify('docs/VISION.md', ['one', 'two'])).toBeNull();
  });

  it('requires two DISTINCT terms, folding plurals, as whole words', () => {
    const verify = groundedVerify('docs/VISION.md', ['expense', 'ledger', 'monthly'])!;
    expect(verify).toMatch(
      /^test -s docs\/VISION\.md && grep -oiwE '\(expense\|ledger\|monthly\)s\?'/,
    );
    expect(verify).toContain("awk 'END { exit NR < 2 }'");
  });
});

describe('deliverableDrafts (W23-37)', () => {
  it('a thin blueprint keeps `test -s` and SAYS no machine checks the grounding', () => {
    const vision = deliverableDrafts([], '# T\n\nbrief').find(
      (d) => d.id === 'PHASE0-VISION',
    )!;
    expect(vision.verify).toBe('test -s docs/VISION.md');
    expect(vision.acceptance[1]).toMatch(/NO MACHINE CHECKS THIS/);
  });

  it('a real blueprint names its terms in the criterion the person reads', () => {
    const vision = deliverableDrafts([], EXPENSE).find((d) => d.id === 'PHASE0-VISION')!;
    expect(vision.verify).toContain('grep -oiwE');
    expect(vision.acceptance[1]).toMatch(/monthly/);
  });
});
