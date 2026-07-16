/**
 * Shared vocabulary for the human/agent edit-conflict policy (BLUEPRINT
 * §7.3, ARCHITECTURE.md §3/§7, SRS FR-T6, UC-04, US-206). Split per
 * CODE_BOOK_PROTOCOL.md so conflict-leases/-watcher/-events/-rebase share
 * one vocabulary without importing each other in a cycle.
 */

/** One ticket's active write-scope lease — the thing a human edit can collide with. */
export interface LeaseRecord {
  readonly ticketId: string;
  readonly ownerId: string;
  readonly writeScope: readonly string[];
}

/** One glob's lock-badge entry (UX_SPEC §4: "🔒 lease badge in any file tree for paths held by an active ticket"). */
export interface LeasedPathBadge {
  readonly glob: string;
  readonly ticketId: string;
  readonly ownerId: string;
}

/** A path the watcher observed changed in the human's checkout, independent of whether it collides with a lease (UC-04 A2: an edit outside any lease is still an ordinary event). */
export interface HumanEdit {
  readonly path: string;
  readonly detectedAt: string;
}

/** One lease a human edit collided with (FR-T6: "edits inside an actively-leased write-scope"). */
export interface ConflictDetection {
  readonly ticketId: string;
  readonly ownerId: string;
  readonly path: string;
  readonly matchedGlob: string;
}
