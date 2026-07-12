import { describe, expect, it } from 'vitest';
import {
  CHALLENGER_BORDERLINE_HIGH,
  CHALLENGER_BORDERLINE_LOW,
  anchorIsPresent,
  createStubChallengerAnchor,
  createStubMemoryAnchor,
  createToolAnchor,
  formatAnchorFactsForPrompt,
  gatherAnchorFacts,
  type ValidatorResult,
} from './anchors.js';

const ITEM = { id: 'item-1', description: 'implement pop()' };
const GATHER_INPUT = {
  item: ITEM,
  criterion: 'pop() removes and returns the top element',
};

describe('tool anchor (FR-L2: wired to validator/scanner output)', () => {
  it('produces one fact per validator result', async () => {
    const results: ValidatorResult[] = [
      { name: 'semgrep', exitCode: 0, gapCount: 0 },
      {
        name: 'tsc',
        exitCode: 1,
        gapCount: 2,
        gaps: ['missing return type', 'unused import'],
      },
    ];
    const facts = await createToolAnchor(results).gather(GATHER_INPUT);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({ kind: 'tool', source: 'semgrep' });
    expect(facts[0]?.statement).toContain('passed');
    expect(facts[1]?.statement).toContain('missing return type');
  });

  it('FR-L2: tool fact contradicting the model forces reconciliation', async () => {
    // A failing validator produces a fact even when nothing else in the loop
    // has flagged a problem — the model has no way to omit or "not see" it.
    const results: ValidatorResult[] = [{ name: 'tsc', exitCode: 1, gapCount: 1 }];
    const facts = await createToolAnchor(results).gather(GATHER_INPUT);
    expect(anchorIsPresent(facts)).toBe(true);
    const prompt = formatAnchorFactsForPrompt(facts);
    expect(prompt).toContain('reconcile');
    expect(prompt).toContain('tsc');
    expect(prompt).toContain('failed');
  });

  it('produces no facts (anchor absent) for an empty validator set', async () => {
    const facts = await createToolAnchor([]).gather(GATHER_INPUT);
    expect(facts).toEqual([]);
    expect(anchorIsPresent(facts)).toBe(false);
  });
});

describe('challenger anchor (FR-L2: borderline-confidence firing, stub gather)', () => {
  it('FR-L2: challenger not invoked on high-confidence tool-backed pass (cost assertion)', () => {
    const challenger = createStubChallengerAnchor();
    expect(
      challenger.shouldFire({
        ...GATHER_INPUT,
        rawConfidence: CHALLENGER_BORDERLINE_HIGH + 0.01,
      }),
    ).toBe(false);
  });

  it('fires within the borderline confidence band, inclusive', () => {
    const challenger = createStubChallengerAnchor();
    expect(
      challenger.shouldFire({
        ...GATHER_INPUT,
        rawConfidence: CHALLENGER_BORDERLINE_LOW,
      }),
    ).toBe(true);
    expect(
      challenger.shouldFire({
        ...GATHER_INPUT,
        rawConfidence: CHALLENGER_BORDERLINE_HIGH,
      }),
    ).toBe(true);
    expect(
      challenger.shouldFire({
        ...GATHER_INPUT,
        rawConfidence: CHALLENGER_BORDERLINE_LOW - 0.01,
      }),
    ).toBe(false);
  });

  it('stub gather never fabricates a verdict fact (real wiring is W5)', async () => {
    const facts = await createStubChallengerAnchor().gather(GATHER_INPUT);
    expect(facts).toEqual([]);
  });
});

describe('memory anchor (stub interface, real wiring is W7)', () => {
  it('stub gather never fabricates a finding fact', async () => {
    const facts = await createStubMemoryAnchor().gather(GATHER_INPUT);
    expect(facts).toEqual([]);
  });
});

describe('gatherAnchorFacts (FR-L2: gather -> facts into prompt)', () => {
  it('composes facts from every anchor in order, empty stubs contribute nothing', async () => {
    const results: ValidatorResult[] = [{ name: 'jscpd', exitCode: 0, gapCount: 0 }];
    const anchors = [
      createToolAnchor(results),
      createStubMemoryAnchor(),
      createStubChallengerAnchor(),
    ];
    const facts = await gatherAnchorFacts(anchors, GATHER_INPUT);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.kind).toBe('tool');
  });

  it('formatAnchorFactsForPrompt renders nothing for an empty fact set', () => {
    expect(formatAnchorFactsForPrompt([])).toBe('');
  });
});
