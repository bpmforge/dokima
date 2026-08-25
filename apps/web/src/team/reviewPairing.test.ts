/** W20-07: maker ≠ verifier is watchable — and the view can still report a breach. */
import { describe, expect, it } from 'vitest';
import { makeBoardTicket } from '../board/test-helpers.js';
import { reviewPairFor, reviewPairLine } from './reviewPairing.js';

const NAMES: Record<string, string> = { 'coding-agent': 'Sam', challenger: 'Wiggum' };
const nameOf = (a: string) => NAMES[a] ?? a;

const withHistory = (ownerId: string | null, history: unknown[]) =>
  makeBoardTicket({ id: 'T-3', ownerId, history: history as never });

describe('reviewPairFor (W20-07)', () => {
  it('names both halves of the pair and says the rule out loud', () => {
    const pair = reviewPairFor(
      withHistory('coding-agent', [
        { verb: 'claim', actorId: 'coding-agent', at: '1' },
        { verb: 'comment', actorId: 'challenger', at: '2', body: 'checking claims' },
      ]),
    );
    expect(pair.makerId).toBe('coding-agent');
    expect(pair.reviewerId).toBe('challenger');
    expect(pair.sameActor).toBe(false);
    expect(reviewPairLine(pair, nameOf)).toBe(
      'Sam built it, Wiggum graded it — never the same person.',
    );
  });

  it("RED FIXTURE: the maker's OWN comment is not a review — self-check is diligence, not a grade (Law 5)", () => {
    const pair = reviewPairFor(
      withHistory('coding-agent', [
        { verb: 'comment', actorId: 'coding-agent', at: '1', body: 'verify: tests ran, 2 failing' },
      ]),
    );
    expect(pair.reviewerId).toBeNull();
    expect(pair.selfChecked).toBe(true);
    expect(reviewPairLine(pair, nameOf)).toBe('Sam built it. Nobody has reviewed it yet.');
  });

  it('a breach would be REPORTED, not hidden — a view that can only render "correct" is decoration', () => {
    // Constructed deliberately: same actor on both ends.
    const pair = {
      ticketId: 'T-9',
      makerId: 'coding-agent',
      reviewerId: 'coding-agent',
      sameActor: true,
      selfChecked: false,
    };
    expect(reviewPairLine(pair, nameOf)).toContain('should be impossible');
  });

  it('an unclaimed ticket says so rather than implying a phantom maker', () => {
    const pair = reviewPairFor(withHistory(null, []));
    expect(pair.makerId).toBeNull();
    expect(reviewPairLine(pair, nameOf)).toBe('Nobody has claimed this yet.');
  });

  it('scoped berth ids resolve to the role on both ends', () => {
    const pair = reviewPairFor(
      withHistory('berth-2:coding-agent', [
        { verb: 'accept', actorId: 'berth-1:challenger', at: '2' },
      ]),
    );
    expect(pair.makerId).toBe('coding-agent');
    expect(pair.reviewerId).toBe('challenger');
    expect(pair.sameActor).toBe(false);
  });
});
