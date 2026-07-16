import type { BoardTicket } from './types.js';

/** Test fixture builder — every field defaulted, override what the test cares about. */
export function makeBoardTicket(
  overrides: Partial<BoardTicket> & Pick<BoardTicket, 'id'>,
): BoardTicket {
  return {
    type: 'task',
    title: `Ticket ${overrides.id}`,
    lane: 'ui',
    ownerId: null,
    status: 'ready',
    dependsOn: [],
    acceptance: [],
    manifest: null,
    history: [],
    claimedAt: null,
    closedAt: null,
    claimable: true,
    staleBlocked: false,
    wave: 0,
    sortKey: overrides.id,
    ...overrides,
  };
}
