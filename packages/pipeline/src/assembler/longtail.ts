/**
 * Long-tail wave (P3-05 AC3, the B-1 class).
 *
 * THE GAP THIS CLOSES: decomposition reliably tickets the happy paths and
 * reliably forgets the states every real deployment hits — the first run
 * against an empty DB, the empty list screen, the expired session, the
 * declared-but-untested error path, migrating from the previous version,
 * reset/uninstall. `generateLongTailWave` emits those classes as
 * board-shaped tickets tagged `long_tail: true` at decomposition time;
 * `longTailGaps` reports a board that shipped without any such wave.
 */

import type { BoardTicketRow } from './types.js';

export interface LongTailClass {
  readonly long_tail_class: string;
  readonly title: string;
  readonly acceptance: readonly string[];
}

/** The named long-tail classes, in emission order. Data, not code — extend
 * here when a new field-report class lands. */
export const LONG_TAIL_CLASSES: readonly LongTailClass[] = [
  {
    long_tail_class: 'first-run-empty-db',
    title: 'Long tail: first run against an empty database',
    acceptance: [
      'A first run on a completely empty database reaches a working state without manual seeding, and a test proves it',
    ],
  },
  {
    long_tail_class: 'empty-states',
    title: 'Long tail: every list/collection view has a designed empty state',
    acceptance: [
      'Each list/collection view renders a deliberate empty state (not a blank screen or a crash) when it has zero rows, and a test proves it',
    ],
  },
  {
    long_tail_class: 'expired-session',
    title: 'Long tail: expired-session and unauthenticated access paths',
    acceptance: [
      'An expired or missing session on every protected surface yields the designed unauthenticated experience (redirect/401), never a stack trace, and a test proves it',
    ],
  },
  {
    long_tail_class: 'declared-error-paths',
    title: 'Long tail: every declared error path is exercised',
    acceptance: [
      'Each error path the design declares (timeouts, upstream failures, validation rejects) is triggered by a test and produces its documented behavior',
    ],
  },
  {
    long_tail_class: 'migration-from-previous',
    title: 'Long tail: migration from the previous released version',
    acceptance: [
      'Data written by the previous released version migrates forward cleanly on upgrade, and a test proves it against a previous-version fixture',
    ],
  },
  {
    long_tail_class: 'reset-uninstall',
    title: 'Long tail: reset and uninstall leave no broken residue',
    acceptance: [
      'Reset returns the app to a working first-run state and uninstall removes what the docs say it removes, and a test proves it',
    ],
  },
];

/**
 * Emit the long-tail wave as board-shaped rows: ids `<prefix>-LT-01`.. in
 * class order, lane 'long-tail', `long_tail: true`, status 'todo', 1 point
 * each. `write_scope` is empty — the planner narrows it per project; the
 * gate cares about the wave existing and closing, not its scope.
 */
// @unreached generateLongTailWave: P3-05 lands the generator; its caller is decompose-time wave emission onto the board, a later wiring ticket outside this write_scope.
export function generateLongTailWave(prefix: string): BoardTicketRow[] {
  return LONG_TAIL_CLASSES.map((cls, i) => ({
    id: `${prefix}-LT-${String(i + 1).padStart(2, '0')}`,
    title: cls.title,
    lane: 'long-tail',
    write_scope: [],
    acceptance: [...cls.acceptance],
    points: 1,
    status: 'todo' as const,
    long_tail: true,
    long_tail_class: cls.long_tail_class,
  }));
}

export interface LongTailGap {
  readonly kind: 'no-long-tail-wave';
  readonly detail: string;
}

/** A board with no `long_tail`-tagged ticket at all shipped without the
 * B-1 wave — report it. (Whether the wave is CLOSED is the gate's job.) */
export function longTailGaps(tickets: readonly BoardTicketRow[]): LongTailGap[] {
  if (tickets.some((t) => t.long_tail === true)) return [];
  return [
    {
      kind: 'no-long-tail-wave',
      detail:
        'board has no ticket tagged long_tail: true — the B-1 wave (first-run/empty-DB, empty states, expired-session, declared-error-paths, migration, reset/uninstall) was never generated',
    },
  ];
}
