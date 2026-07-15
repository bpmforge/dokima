import { useCallback, useState } from 'react';
import {
  applyOptimistic,
  confirmOptimistic,
  createOptimisticState,
  rollbackOptimistic,
  type OptimisticState,
} from './optimistic.js';

export interface UseOptimisticResult<T> {
  value: T;
  status: OptimisticState<T>['status'];
  apply: (next: T) => void;
  confirm: (confirmedValue?: T) => void;
  rollback: () => void;
}

/** React glue over the pure optimistic state machine (NFR-2 baseline). */
export function useOptimistic<T>(initial: T): UseOptimisticResult<T> {
  const [state, setState] = useState<OptimisticState<T>>(() =>
    createOptimisticState(initial),
  );

  return {
    value: state.value,
    status: state.status,
    apply: useCallback(
      (next: T) => setState((current) => applyOptimistic(current, next)),
      [],
    ),
    confirm: useCallback(
      (confirmedValue?: T) =>
        setState((current) => confirmOptimistic(current, confirmedValue)),
      [],
    ),
    rollback: useCallback(() => setState((current) => rollbackOptimistic(current)), []),
  };
}
