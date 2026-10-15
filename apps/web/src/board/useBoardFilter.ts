import { useCallback, useEffect, useState } from 'react';
import {
  BOARD_FILTER_PARAM,
  initialBoardFilter,
  writeStoredBoardFilter,
  type BoardFilter,
} from './boardFilter.js';

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The board's status filter for one project: read from `?filter=` first,
 * then the project's remembered choice. Choosing a filter remembers it per
 * project and mirrors it into the URL with `replaceState` (no history entry
 * per chip click), so a reload or a copied link shows the same board.
 */
export function useBoardFilter(
  projectId: string,
): [BoardFilter, (next: BoardFilter) => void] {
  const [filter, setFilterState] = useState<BoardFilter>(() =>
    initialBoardFilter(projectId, window.location.search, safeStorage()),
  );

  useEffect(() => {
    const sync = () =>
      setFilterState(
        initialBoardFilter(projectId, window.location.search, safeStorage()),
      );
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [projectId]);

  const setFilter = useCallback(
    (next: BoardFilter) => {
      setFilterState(next);
      writeStoredBoardFilter(projectId, next, safeStorage());
      const url = new URL(window.location.href);
      if (next === 'all') url.searchParams.delete(BOARD_FILTER_PARAM);
      else url.searchParams.set(BOARD_FILTER_PARAM, next);
      window.history.replaceState(window.history.state, '', url);
    },
    [projectId],
  );

  return [filter, setFilter];
}
