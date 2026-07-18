/**
 * Notification taxonomy core (DATABASE.md §3, UX_SPEC §7, FR-N4, US-704,
 * US-404, R-A1/US-310). One project's `.shipwright/state.db` at a time —
 * the route layer (`server/notifications-routes/`) fans this out across
 * every registered project for the aggregated morning queue (FR-F4).
 *
 * "Emitting without a tier is a type/API error" (US-704 AC-1) is enforced
 * twice: `EmitNotificationInput.tier`/`.kind` are typed as the closed union
 * in `./types.js` (a TS compile error to omit or misspell), and
 * `assertValidTaxonomy` re-checks at runtime for anything crossing the HTTP
 * boundary (a POST body is `unknown`, not a TS type) — the DB's own CHECK
 * constraint (`006_notifications.sql`) is the third, unbypassable layer
 * ("the taxonomy is schema, not convention").
 *
 * Book-split per CODE_BOOK_PROTOCOL.md: `types.ts` (taxonomy + row<->record
 * mapping), `emit.ts` (emit + list + review-digest batching), `resolve.ts`
 * (dismiss/decide), `push-promotion.ts` (FR-N4 quiet hours + idle-blocked
 * push), `trust-graduation.ts` (R-A1/US-310 suggestion evidence). This file
 * is the public barrel — callers import `./notifications/index.js` (or the
 * directory) and never reach into a chapter directly.
 */

import { randomUUID } from 'node:crypto';

export * from './types.js';
export * from './emit.js';
export * from './resolve.js';
export * from './push-promotion.js';
export * from './trust-graduation.js';

/** Convenience id generator for callers that don't need deterministic ids (route layer; tests pass their own). */
export function generateNotificationId(): string {
  return randomUUID();
}
