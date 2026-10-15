import { BOARD_FILTER_OPTIONS, type BoardFilter } from './boardFilter.js';

export interface BoardFilterBarProps {
  filter: BoardFilter;
  counts: Record<BoardFilter, number>;
  onChange: (next: BoardFilter) => void;
}

/**
 * Status filter chips above the lanes. Toggle buttons (`aria-pressed`), one
 * pressed at a time; pressing the pressed chip again, or "Show all", clears
 * it. Each chip carries its count so a person can see where the work is
 * before filtering to it.
 */
export function BoardFilterBar({ filter, counts, onChange }: BoardFilterBarProps) {
  return (
    <div
      className="board-filter"
      role="group"
      aria-label="Filter cards by status"
      data-testid="board-filter"
    >
      <button
        type="button"
        className="tab"
        aria-pressed={filter === 'all'}
        onClick={() => onChange('all')}
        data-testid="board-filter-all"
      >
        Show all <span className="board-filter__count tabular">{counts.all}</span>
      </button>
      {BOARD_FILTER_OPTIONS.map(({ filter: option, label }) => (
        <button
          key={option}
          type="button"
          className="tab"
          aria-pressed={filter === option}
          onClick={() => onChange(filter === option ? 'all' : option)}
          data-testid={`board-filter-${option}`}
        >
          {label} <span className="board-filter__count tabular">{counts[option]}</span>
        </button>
      ))}
    </div>
  );
}
