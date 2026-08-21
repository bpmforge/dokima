import type { DragEvent } from 'react';
import type { LifecycleVerb } from './api.js';
import { Card } from './Card.js';
import type { BoardColumn } from './lanes.js';
import type { HeartbeatData } from './types.js';

const COLUMN_LABEL: Record<string, string> = {
  ready: 'Ready',
  claimed: 'Claimed',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
};

export interface ColumnProps {
  column: BoardColumn;
  heartbeats: ReadonlyMap<string, HeartbeatData>;
  /** ticket id → unfinished dependency ids, for blocked cards (W13-60). */
  blockedDeps: ReadonlyMap<string, readonly string[]>;
  onDrop: (ticketId: string, toColumn: BoardColumn['status']) => void;
  onFireVerb: (ticketId: string, verb: LifecycleVerb) => void;
  onRaiseBudgetRetry?: (ticketId: string, newBudget: number) => void;
}

export function Column({
  column,
  heartbeats,
  blockedDeps,
  onDrop,
  onFireVerb,
  onRaiseBudgetRetry,
}: ColumnProps) {
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => event.preventDefault();
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const ticketId = event.dataTransfer.getData('text/plain');
    if (ticketId) onDrop(ticketId, column.status);
  };
  const handleDragStart = (event: DragEvent<HTMLDivElement>, ticketId: string) => {
    event.dataTransfer.setData('text/plain', ticketId);
  };

  return (
    <div
      /* W12-30: an empty column is still a drop target and must stay one —
         it just should not cost the same vertical space as a full one. Most
         of the captured board was empty boxes at full height. */
      className={`board-column${column.tickets.length === 0 ? ' board-column--empty' : ''}`}
      data-testid={`column-${column.status}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <header className="board-column__header">{COLUMN_LABEL[column.status]}</header>
      <div className="board-column__cards" role="list">
        {column.tickets.map((ticket) => (
          <Card
            key={ticket.id}
            ticket={ticket}
            heartbeat={heartbeats.get(ticket.id)}
            blockers={blockedDeps.get(ticket.id)}
            onDragStart={handleDragStart}
            onFireVerb={onFireVerb}
            onRaiseBudgetRetry={onRaiseBudgetRetry}
          />
        ))}
      </div>
    </div>
  );
}
