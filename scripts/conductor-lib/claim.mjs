// conductor-lib/claim.mjs — chapter of the conductor's pure helper library.
// Split out of the 590-line scripts/conductor-lib.mjs under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only: same exported names, same
// behaviour. scripts/conductor-lib.mjs remains the barrel every caller imports,
// so no call site moved.

import { wave } from './parsing.mjs';

export function claimableTickets(plan, { waves = null, hold = [], excluded = [] } = {}) {
  const done = new Set(plan.tickets.filter((t) => t.status === 'done').map((t) => t.id));
  const busyLanes = new Set(plan.tickets.filter((t) => t.status === 'in_progress').map((t) => t.lane));
  const holdSet = new Set(hold);
  const excludedSet = new Set(excluded);
  return plan.tickets
    .filter((t) => t.status === 'todo')
    .filter((t) => !holdSet.has(t.id)) // F2: human-pair tickets are never claimed unattended
    .filter((t) => !excludedSet.has(t.id))
    .filter((t) => !waves || waves.includes(wave(t.id)))
    .filter((t) => (t.depends_on ?? []).every((d) => done.has(d)))
    .filter((t) => !busyLanes.has(t.lane))
    .sort((a, b) => a.id.localeCompare(b.id));
}


/**
 * Lint rule: a ticket whose write_scope can touch implementation files but not
 * their test siblings cannot add tests without tripping the out-of-scope gate.
 *
 * Kryptkeeper W6-01, 2026-07-28: the agent implemented HA leader election,
 * wrote five table-driven tests plus a prove-the-negative red-check, verified
 * them, then DELETED them and self-blocked — because write_scope listed three
 * .go files and no _test.go, and ALWAYS_OK carries no test pattern. It obeyed
 * MASTER_PROMPT's "never self-amend write_scope" rule and the harness punished
 * it for it. Catching this at filing time costs nothing; catching it mid-ticket
 * costs a full session and loses the tests.
 *
 * Returns a warning string, or null when the ticket is fine or the check is off.
 */
