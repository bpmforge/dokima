// conductor-lib/claim.mjs — chapter of the conductor's pure helper library.
// Split out of the 590-line scripts/conductor-lib.mjs under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only: same exported names, same
// behaviour. scripts/conductor-lib.mjs remains the barrel every caller imports,
// so no call site moved.

import { wave } from './parsing.mjs';

export function claimableTickets(plan, { waves = null, hold = [], excluded = [] } = {}) {
  const done = new Set(plan.tickets.filter((t) => t.status === 'done').map((t) => t.id));
  const busyLanes = new Set(
    plan.tickets.filter((t) => t.status === 'in_progress').map((t) => t.lane),
  );
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

/**
 * P2-07 (M-02) — risk-tier admission: the 6/6 pilot filter as code. Only
 * bounded, known-acceptance work is claimable unattended; ambiguous, large, or
 * security-surface tickets are HELD FOR A HUMAN pass instead of ground through
 * the retry ladder. The pilot that used exactly this filter landed 6 of 6;
 * the unfiltered board completed 90.8% but paid 0.72 retries per start for it.
 *
 * cfg (conductor.config.json `unattendedRisk`, absent = no gating):
 *   maxPoints:          hold tickets larger than this (ambiguity proxy)
 *   securityScopeGlobs: hold tickets whose write_scope matches any (regex
 *                       source strings) unless allowlisted
 *   allowUnattended:    ticket ids explicitly cleared by a human
 *
 * @returns {null | string} hold reason, or null when claimable unattended
 */
export function riskHoldReason(t, cfg) {
  if (!cfg) return null;
  if ((cfg.allowUnattended ?? []).includes(t.id)) return null;
  if (cfg.maxPoints != null && Number(t.points ?? 0) > cfg.maxPoints) {
    return `held_for_human: ${t.points} points > unattendedRisk.maxPoints ${cfg.maxPoints} — large work is ambiguity; a human admits it or splits it`;
  }
  for (const g of cfg.securityScopeGlobs ?? []) {
    const re = new RegExp(g);
    const hit = (t.write_scope ?? []).find((p) => re.test(p));
    if (hit) {
      return `held_for_human: write_scope '${hit}' matches security surface /${g}/ — specialist review is admission, not aftermath`;
    }
  }
  return null;
}
