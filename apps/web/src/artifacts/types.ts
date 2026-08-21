/**
 * Artifact Viewer + Receipt Inspector types (FR-C3/C5/C8, UX_SPEC §5).
 * Mirrors the wire shapes served by
 * `apps/server/src/api/server/{artifacts,receipts}-routes.ts`.
 */

export interface ArtifactListItem {
  path: string;
  title: string;
  /** W18-03: written by a run but in no commit yet — listed, marked, never hidden. */
  uncommitted?: boolean;
}

export interface ArtifactVersion {
  rev: string;
  author: string;
  at: string;
  subject: string;
}

export interface ArtifactDoc {
  path: string;
  content: string;
  rev: string | null;
  versions: ArtifactVersion[];
}

export interface ArtifactDiff {
  path: string;
  ticket: string;
  branch: string;
  base: string;
  oldContent: string;
  newContent: string;
}

/** Doc-vs-doc diff across two arbitrary revisions of one path (FR-C8: revised version vs. the commented version). */
export interface ArtifactDocDiff {
  path: string;
  from: string;
  to: string;
  oldContent: string;
  newContent: string;
}

export interface ArtifactComment {
  seq: number;
  at: string;
  actorId: string;
  body: string;
  versionRef: string;
  revisionRequested: boolean;
}

export interface CreateCommentInput {
  path: string;
  body: string;
  versionRef: string;
  ticketId?: string | null;
  phase?: number | null;
}

export type ReceiptKind =
  'gate' | 'close' | 'waiver' | 'challenge' | 'coverage' | 'fitness';

export interface ReceiptValidatorResult {
  name: string;
  exitCode: number;
  gapCount: number;
}

export interface ReceiptRecord {
  id: string;
  kind: ReceiptKind;
  projectId: string;
  phase: number | null;
  ticketId: string | null;
  validators: ReceiptValidatorResult[];
  inputTreeHash: string;
  verifyCommand: string | null;
  verifyExit: number | null;
  signedBy: string | null;
  payload: unknown;
  createdAt: string;
}

export interface ApprovalLedgerRow {
  id: string;
  riskClass: string;
  mode: string;
  decision: string;
  createdAt: string;
}
