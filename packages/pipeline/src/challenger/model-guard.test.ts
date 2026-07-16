import { describe, expect, it } from 'vitest';
import {
  ChallengerSameModelError,
  assertChallengerModelDistinct,
} from './model-guard.js';

describe('assertChallengerModelDistinct (W2-05)', () => {
  it('passes silently when the challenger and maker models differ', () => {
    expect(() =>
      assertChallengerModelDistinct({
        claimId: 'C-1',
        challengerModel: 'claude-opus',
        makerModel: 'claude-sonnet',
      }),
    ).not.toThrow();
  });

  it('throws ChallengerSameModelError when the models match, with no override path', () => {
    expect(() =>
      assertChallengerModelDistinct({
        claimId: 'C-1',
        challengerModel: 'claude-sonnet',
        makerModel: 'claude-sonnet',
      }),
    ).toThrow(ChallengerSameModelError);
  });
});
