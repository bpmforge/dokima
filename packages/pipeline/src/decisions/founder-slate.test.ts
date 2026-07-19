import { describe, expect, it } from 'vitest';
import {
  InvalidFounderSlateError,
  buildFounderSlate,
  resolveFounderFork,
  type ForkDescriptor,
} from './founder-slate.js';

const VALID_INPUT = {
  title: 'Deployment shape',
  options: [
    { id: 'a', label: 'Local-first', tradeoffs: 'offline, single-machine' },
    { id: 'b', label: 'Multi-user server', tradeoffs: 'needs infra, no offline' },
  ],
  recommendedId: 'a',
  recommendedReasoning: 'matches the local-first constraint (C1)',
};

describe('buildFounderSlate', () => {
  it('accepts 2 options', () => {
    const slate = buildFounderSlate(VALID_INPUT);
    expect(slate.kind).toBe('founder');
    expect(slate.options).toHaveLength(2);
    expect(slate.recommendedId).toBe('a');
  });

  it('accepts up to 4 options', () => {
    const slate = buildFounderSlate({
      ...VALID_INPUT,
      options: [
        ...VALID_INPUT.options,
        { id: 'c', label: 'Electron desktop', tradeoffs: 'packaging burden' },
        {
          id: 'd',
          label: 'Tauri desktop',
          tradeoffs: 'packaging burden, smaller binary',
        },
      ],
    });
    expect(slate.options).toHaveLength(4);
  });

  it('refuses fewer than 2 options', () => {
    expect(() =>
      buildFounderSlate({ ...VALID_INPUT, options: [VALID_INPUT.options[0]!] }),
    ).toThrow(InvalidFounderSlateError);
  });

  it('refuses more than 4 options', () => {
    const five = [0, 1, 2, 3, 4].map((i) => ({
      id: `o${i}`,
      label: `Option ${i}`,
      tradeoffs: 'x',
    }));
    expect(() => buildFounderSlate({ ...VALID_INPUT, options: five })).toThrow(
      InvalidFounderSlateError,
    );
  });

  it('refuses duplicate option ids', () => {
    expect(() =>
      buildFounderSlate({
        ...VALID_INPUT,
        options: [VALID_INPUT.options[0]!, { ...VALID_INPUT.options[0]! }],
      }),
    ).toThrow(InvalidFounderSlateError);
  });

  it('refuses a recommendedId not among the options', () => {
    expect(() => buildFounderSlate({ ...VALID_INPUT, recommendedId: 'nope' })).toThrow(
      InvalidFounderSlateError,
    );
  });

  it('refuses empty recommendedReasoning', () => {
    expect(() =>
      buildFounderSlate({ ...VALID_INPUT, recommendedReasoning: '   ' }),
    ).toThrow(InvalidFounderSlateError);
  });
});

describe('resolveFounderFork', () => {
  const fork: ForkDescriptor = { key: 'deployment-shape', slate: VALID_INPUT };

  it('returns the decision id when the fork key is already decided', () => {
    const decided = new Map([['deployment-shape', 'D-003']]);
    expect(resolveFounderFork(fork, decided)).toEqual({
      status: 'decided',
      decisionId: 'D-003',
    });
  });

  it('never assumes: an undecided fork always comes back as slate-required, not a default pick', () => {
    const decided = new Map<string, string>();
    const result = resolveFounderFork(fork, decided);
    expect(result.status).toBe('slate-required');
    if (result.status === 'slate-required') {
      expect(result.slate.kind).toBe('founder');
      expect(result.slate.recommendedId).toBe('a');
    }
  });

  it('a decided key for a different fork does not leak into this one', () => {
    const decided = new Map([['unrelated-fork', 'D-005']]);
    expect(resolveFounderFork(fork, decided).status).toBe('slate-required');
  });
});
