import { describe, expect, it } from 'vitest';
import {
  beginOptimisticMove,
  confirmOptimisticMove,
  rollbackOptimisticMove,
} from './dragOptimistic.js';
import { makeBoardTicket } from './test-helpers.js';

describe('beginOptimisticMove', () => {
  it('moves the card immediately, keeping a snapshot for rollback', () => {
    const before = new Map([
      ['W4-01', makeBoardTicket({ id: 'W4-01', status: 'ready' })],
    ]);
    const move = beginOptimisticMove(before, 'W4-01', 'claimed');
    expect(move?.tickets.get('W4-01')?.status).toBe('claimed');
    expect(move?.snapshot.status).toBe('ready');
    expect(before.get('W4-01')?.status).toBe('ready');
  });

  it('is a no-op for an unknown ticket id', () => {
    expect(beginOptimisticMove(new Map(), 'ghost', 'claimed')).toBeNull();
  });
});

describe('confirmOptimisticMove', () => {
  it('merges the server-canonical ticket fields onto the board row', () => {
    const optimistic = new Map([
      ['W4-01', makeBoardTicket({ id: 'W4-01', status: 'claimed' })],
    ]);
    const serverTicket = {
      ...makeBoardTicket({ id: 'W4-01', status: 'claimed' }),
      ownerId: 'agent-1',
    };
    const confirmed = confirmOptimisticMove(optimistic, 'W4-01', serverTicket);
    expect(confirmed.get('W4-01')?.ownerId).toBe('agent-1');
  });
});

describe('rollbackOptimisticMove', () => {
  it('restores the pre-drag snapshot on refusal (FR-T4: the card snaps back)', () => {
    const snapshot = makeBoardTicket({ id: 'W4-01', status: 'ready' });
    const afterFailedDrag = new Map([
      ['W4-01', { ...snapshot, status: 'claimed' as const }],
    ]);
    const rolledBack = rollbackOptimisticMove(afterFailedDrag, 'W4-01', snapshot);
    expect(rolledBack.get('W4-01')?.status).toBe('ready');
  });
});
