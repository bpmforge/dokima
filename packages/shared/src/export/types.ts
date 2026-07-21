/**
 * Portable export-bundle wire format (BLUEPRINT §12.8, DATABASE.md §2's
 * "source of truth" trio: events, identities, receipts). Everything else —
 * the `tickets`/`board` projection, budget ledgers, etc. — is documented in
 * DATABASE.md §3 as *rebuildable from the log*, so a bundle carrying exactly
 * these three durable inputs is sufficient to reconstruct every projection
 * on import; it does not need its own copy of derived state.
 */

export const EXPORT_BUNDLE_VERSION = 1;

export type ExportedIdentityKind = 'human' | 'machine';

export interface ExportedIdentity {
  id: string;
  name: string;
  kind: ExportedIdentityKind;
  authProvider: string | null;
  role: string | null;
  modelHint: string | null;
  createdAt: string;
}

export interface ExportedEvent {
  seq: number;
  eventType: string;
  actorId: string;
  ticketId: string | null;
  runId: string | null;
  /**
   * The exact JSON text stored in the `payload` column — never a
   * re-serialization. `hash` was computed over these exact bytes
   * (packages/events/src/hash.ts); round-tripping through `JSON.parse` +
   * `JSON.stringify` is not guaranteed to reproduce them byte-for-byte, so
   * carrying the raw text is what keeps the bundle hash-reproducible.
   */
  payloadJson: string;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export interface ExportedReceipt {
  id: string;
  kind: string;
  projectId: string;
  phase: number | null;
  ticketId: string | null;
  /** Raw JSON text of the `validators` column (same byte-preservation rationale as `ExportedEvent.payloadJson`). */
  validatorsJson: string;
  inputTreeHash: string;
  verifyCommand: string | null;
  verifyExit: number | null;
  signedBy: string | null;
  /** Raw JSON text of the `payload` column, or null when the column is null. */
  payloadJson: string | null;
  createdAt: string;
}

export interface ExportBundle {
  version: typeof EXPORT_BUNDLE_VERSION;
  projectId: string;
  exportedAt: string;
  identities: ExportedIdentity[];
  events: ExportedEvent[];
  receipts: ExportedReceipt[];
}
