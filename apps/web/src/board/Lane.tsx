import type { LifecycleVerb } from './api.js';
import { Column } from './Column.js';
import type { BoardLane } from './lanes.js';
import type { HeartbeatData, TicketStatus } from './types.js';

export interface LaneProps {
  lane: BoardLane;
  heartbeats: ReadonlyMap<string, HeartbeatData>;
  blockedDeps: ReadonlyMap<string, readonly string[]>;
  onDrop: (ticketId: string, toColumn: TicketStatus) => void;
  onFireVerb: (ticketId: string, verb: LifecycleVerb) => void;
}

export function Lane({ lane, heartbeats, blockedDeps, onDrop, onFireVerb }: LaneProps) {
  return (
    <section
      className="board-lane"
      aria-label={`Lane ${lane.lane}`}
      data-testid={`lane-${lane.lane}`}
    >
      {/* W13-52: "T001" alone as a heading meant nothing to a user (A-4);
          the vocabulary word makes it parse. Naming lanes meaningfully at
          decompose time is pipeline work, not a display concern. */}
      <h3 className="board-lane__title">Lane {lane.lane}</h3>
      <div
        className="board-lane__columns"
        tabIndex={0}
        role="group"
        aria-label={`${lane.lane} columns, scrollable`}
      >
        {lane.columns.map((column) => (
          <Column
            key={column.status}
            column={column}
            heartbeats={heartbeats}
            blockedDeps={blockedDeps}
            onDrop={onDrop}
            onFireVerb={onFireVerb}
          />
        ))}
      </div>
    </section>
  );
}
