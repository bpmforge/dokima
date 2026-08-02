/**
 * Server-side bundle wire shapes (BLUEPRINT §12.8). Deliberately NOT
 * imported from `packages/shared/src/export` — see `export-bundle.ts`'s
 * module header for why (the barrel/`exports`-map wiring that would take
 * sits outside this ticket's `write_scope`). Field-for-field mirror of
 * `packages/shared/src/export/types.ts`'s `ExportedIdentity`/
 * `ExportedEvent`/`ExportedReceipt`/`ExportBundle`.
 */
import type { ChainVerificationResult } from '@dokima/events';

export const EXPORT_BUNDLE_VERSION = 1;

export interface BundleIdentity {
  id: string;
  name: string;
  kind: 'human' | 'machine';
  authProvider: string | null;
  role: string | null;
  modelHint: string | null;
  createdAt: string;
}

export interface BundleEvent {
  seq: number;
  eventType: string;
  actorId: string;
  ticketId: string | null;
  runId: string | null;
  /** Raw column text — never re-serialized (preserves hash reproducibility). */
  payloadJson: string;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export interface BundleReceipt {
  id: string;
  kind: string;
  projectId: string;
  phase: number | null;
  ticketId: string | null;
  validatorsJson: string;
  inputTreeHash: string;
  verifyCommand: string | null;
  verifyExit: number | null;
  signedBy: string | null;
  payloadJson: string | null;
  createdAt: string;
}

export interface ExportBundle {
  version: number;
  projectId: string;
  exportedAt: string;
  identities: BundleIdentity[];
  events: BundleEvent[];
  receipts: BundleReceipt[];
}

export interface IdentityRow {
  id: string;
  name: string;
  kind: 'human' | 'machine';
  auth_provider: string | null;
  role: string | null;
  model_hint: string | null;
  created_at: string;
}

export interface EventRow {
  seq: number;
  event_type: string;
  actor_id: string;
  ticket_id: string | null;
  run_id: string | null;
  payload: string;
  created_at: string;
  prev_hash: string;
  hash: string;
}

export interface ReceiptRow {
  id: string;
  kind: string;
  project_id: string;
  phase: number | null;
  ticket_id: string | null;
  validators: string;
  input_tree_hash: string;
  verify_command: string | null;
  verify_exit: number | null;
  signed_by: string | null;
  payload: string | null;
  created_at: string;
}

export class BundleValidationError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`invalid export bundle: ${reasons.join('; ')}`);
    this.name = 'BundleValidationError';
  }
}

export class NonEmptyImportTargetError extends Error {
  constructor(readonly existingEventCount: number) {
    super(
      `import target already has ${existingEventCount} event(s) — import only accepts an empty project (restore semantics, not merge)`,
    );
    this.name = 'NonEmptyImportTargetError';
  }
}

export class ChainVerificationFailedError extends Error {
  constructor(readonly result: ChainVerificationResult) {
    super(
      `bundle hash chain is invalid at seq ${String(result.brokenAtSeq)}: ${result.reason ?? 'unknown reason'}`,
    );
    this.name = 'ChainVerificationFailedError';
  }
}

export class ReceiptAnchorVerificationFailedError extends Error {
  constructor(readonly receiptIds: readonly string[]) {
    super(
      `bundle contains receipt(s) with no valid anchoring event (no gate.receipt_minted/gate.waived event carrying a matching contentMac) — not minted by a real run: ${receiptIds.join(', ')}`,
    );
    this.name = 'ReceiptAnchorVerificationFailedError';
  }
}
