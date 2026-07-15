/**
 * Optimistic, non-blocking UI baseline (NFR-2): apply a local change
 * immediately, reconcile with the server's answer when it arrives, roll
 * back to the pre-optimistic value on failure. Pure state transitions —
 * the async fetch/verb call itself is the caller's concern.
 */

export type OptimisticStatus = 'idle' | 'pending' | 'confirmed' | 'rolled-back';

export interface OptimisticState<T> {
  value: T;
  previous: T | null;
  status: OptimisticStatus;
}

export function createOptimisticState<T>(value: T): OptimisticState<T> {
  return { value, previous: null, status: 'idle' };
}

/** Fires immediately on user action, before the server has confirmed anything. */
export function applyOptimistic<T>(
  state: OptimisticState<T>,
  next: T,
): OptimisticState<T> {
  return { value: next, previous: state.value, status: 'pending' };
}

/** Server confirmed — optionally reconcile to its canonical value. */
export function confirmOptimistic<T>(
  state: OptimisticState<T>,
  confirmedValue?: T,
): OptimisticState<T> {
  return {
    value: confirmedValue !== undefined ? confirmedValue : state.value,
    previous: null,
    status: 'confirmed',
  };
}

/** Server refused/failed — revert to the value that was live before the optimistic apply. */
export function rollbackOptimistic<T>(state: OptimisticState<T>): OptimisticState<T> {
  if (state.previous === null) return { ...state, status: 'rolled-back' };
  return { value: state.previous, previous: null, status: 'rolled-back' };
}
