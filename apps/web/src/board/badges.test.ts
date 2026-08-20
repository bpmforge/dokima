import { describe, expect, it } from 'vitest';
import {
  cardStateClass,
  isStaleBlocked,
  isWaived,
  STALE_BADGE_LABEL,
  WAIVED_BADGE_LABEL,
} from './badges.js';
import { makeBoardTicket } from './test-helpers.js';

describe('isStaleBlocked', () => {
  it('is true only when status is blocked AND the projection flags it stale', () => {
    const stale = makeBoardTicket({ id: 'W1', status: 'blocked', staleBlocked: true });
    expect(isStaleBlocked(stale)).toBe(true);
  });

  it('is false for a blocked ticket whose blockers are not all done', () => {
    const blocked = makeBoardTicket({ id: 'W1', status: 'blocked', staleBlocked: false });
    expect(isStaleBlocked(blocked)).toBe(false);
  });

  it('is false for a non-blocked ticket even if the flag is somehow set', () => {
    const ready = makeBoardTicket({ id: 'W1', status: 'ready', staleBlocked: true });
    expect(isStaleBlocked(ready)).toBe(false);
  });
});

describe('isWaived', () => {
  it('flags waived-status tickets for the permanent ⚠ badge (NFR-6)', () => {
    expect(isWaived(makeBoardTicket({ id: 'W1', status: 'waived' }))).toBe(true);
    expect(isWaived(makeBoardTicket({ id: 'W1', status: 'done' }))).toBe(false);
  });
});

describe('badge copy', () => {
  it('matches UX_SPEC §4 verbatim', () => {
    expect(STALE_BADGE_LABEL).toBe('STALE — claimable?');
    expect(WAIVED_BADGE_LABEL).toBe('⚠ waived');
  });
});

describe('cardStateClass (W13-52)', () => {
  it('RED FIXTURE: blocked is a shape — a blocked card carries the warning stripe class', () => {
    // UX_AUDIT A-4 measured a Blocked and a Ready card pixel-identical.
    expect(cardStateClass('blocked')).toBe(' surface--blocked');
  });

  it('in_review carries attention — accepting someone else\'s work is always a person (C-4)', () => {
    expect(cardStateClass('in_review')).toBe(' surface--attention');
  });

  it('the quiet states stay quiet: the norm is silence', () => {
    for (const status of ['ready', 'claimed', 'in_progress', 'done', 'waived']) {
      expect(cardStateClass(status)).toBe('');
    }
  });
});
