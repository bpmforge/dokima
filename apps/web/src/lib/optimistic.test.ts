import { describe, expect, it } from 'vitest';
import {
  applyOptimistic,
  confirmOptimistic,
  createOptimisticState,
  rollbackOptimistic,
} from './optimistic.js';

describe('optimistic state machine', () => {
  it('applies a local change immediately, pending confirmation', () => {
    const initial = createOptimisticState('light');
    const applied = applyOptimistic(initial, 'dark');
    expect(applied).toEqual({ value: 'dark', previous: 'light', status: 'pending' });
  });

  it('confirms with the server value and clears the rollback point', () => {
    const applied = applyOptimistic(createOptimisticState(1), 2);
    const confirmed = confirmOptimistic(applied, 2);
    expect(confirmed).toEqual({ value: 2, previous: null, status: 'confirmed' });
  });

  it('confirms with the already-applied value when the server echoes nothing new', () => {
    const applied = applyOptimistic(createOptimisticState(1), 2);
    const confirmed = confirmOptimistic(applied);
    expect(confirmed.value).toBe(2);
    expect(confirmed.status).toBe('confirmed');
  });

  it('rolls back to the pre-optimistic value on failure', () => {
    const applied = applyOptimistic(
      createOptimisticState('idle-value'),
      'optimistic-value',
    );
    const rolledBack = rollbackOptimistic(applied);
    expect(rolledBack).toEqual({
      value: 'idle-value',
      previous: null,
      status: 'rolled-back',
    });
  });

  it('rollback on a never-applied state is a no-op besides the status flag', () => {
    const initial = createOptimisticState('value');
    const rolledBack = rollbackOptimistic(initial);
    expect(rolledBack.value).toBe('value');
    expect(rolledBack.status).toBe('rolled-back');
  });
});
