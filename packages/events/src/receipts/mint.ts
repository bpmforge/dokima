/**
 * receipts/mint.ts — mintReceipt — the sole appender of gate.receipt_minted / gate.waived.
 *
 * Chapter of the 553-line packages/events/src/receipts.ts, split under the
 * 400-line CODE_BOOK_PROTOCOL cap (W10-47). Extraction only: the byte
 * sequence every MAC is computed over is unchanged, and receipts-golden.test.ts
 * pins that with hex values frozen from the pre-split implementation.
 */

import { appendEvent } from '../append.js';
import { getIdentity } from '../identities.js';
import type { EventLog } from '../types.js';
import type { ReceiptInputFile, ReceiptKind, ReceiptRecord, ValidatorResult } from './types.js';
import { DEFAULT_AGENT_NAME_BLOCKLIST, isBlockedAgentName, AgentWaiverRejectedError, WaiverSignatureRequiredError } from './waiver-policy.js';
import {
  assertSigningKey,
  computeInputTreeHash,
  computeReceiptMac,
  eventTypeForKind,
} from './mac.js';

export interface MintReceiptInput {
  id: string;
  kind: ReceiptKind;
  projectId: string;
  phase?: number | null;
  ticketId?: string | null;
  validators: ValidatorResult[];
  inputFiles: readonly ReceiptInputFile[];
  verifyCommand?: string | null;
  verifyExit?: number | null;
  /** Identity minting the receipt; recorded on the anchoring event (C3). */
  actorId: string;
  /** Required for kind === 'waiver'; must resolve to a human identity (FR-P2). */
  signedBy?: string | null;
  payload?: unknown;
}

export interface MintReceiptOptions {
  /**
   * Keychain-resolved minting secret (HMAC key) held only by the trusted
   * minting path (FR-S2, law #8). Required and non-empty — see
   * `computeReceiptMac`. Never stored on the row/event or logged.
   */
  signingKey: string;
  now?: () => string;
  /** Extra names to reject on top of DEFAULT_AGENT_NAME_BLOCKLIST. */
  agentNameBlocklist?: readonly string[];
}

export interface ReceiptRow {
  id: string;
  kind: ReceiptKind;
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

export function rowToRecord(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    phase: row.phase,
    ticketId: row.ticket_id,
    validators: JSON.parse(row.validators) as ValidatorResult[],
    inputTreeHash: row.input_tree_hash,
    verifyCommand: row.verify_command,
    verifyExit: row.verify_exit,
    signedBy: row.signed_by,
    payload: row.payload === null ? null : (JSON.parse(row.payload) as unknown),
    createdAt: row.created_at,
  };
}

/**
 * Mints a receipt (DATABASE.md §2): inserts the durable row and appends the
 * anchoring `gate.receipt_minted` (or `gate.waived`) event — carrying the
 * keyed MAC over the row's content — in one transaction, so the row and the
 * event either both land or neither does. `verifyReceipt`'s anchor check
 * relies on that MAC (C3: only a caller holding the minting secret can
 * produce a receipt whose anchor tag verifies).
 */
export function mintReceipt(
  log: EventLog,
  input: MintReceiptInput,
  opts: MintReceiptOptions,
): ReceiptRecord {
  const { signingKey } = opts;
  assertSigningKey(signingKey);
  const now = opts.now ?? (() => new Date().toISOString());
  const blocklist = [...DEFAULT_AGENT_NAME_BLOCKLIST, ...(opts.agentNameBlocklist ?? [])];

  if (input.kind === 'waiver') {
    if (!input.signedBy) {
      throw new WaiverSignatureRequiredError('waiver receipts require signedBy (FR-P2)');
    }
    const signer = getIdentity(log, input.signedBy);
    if (!signer) {
      throw new WaiverSignatureRequiredError(
        `waiver signedBy identity not found: ${input.signedBy}`,
      );
    }
    if (signer.kind !== 'human') {
      throw new AgentWaiverRejectedError(
        `waiver receipts require a human signature; identity "${signer.id}" is kind "${signer.kind}" (FR-P2)`,
      );
    }
    if (isBlockedAgentName(signer.name, blocklist)) {
      throw new AgentWaiverRejectedError(
        `waiver signer name "${signer.name}" matches the agent-name blocklist (FR-P2/FR-N3)`,
      );
    }
  }

  const inputTreeHash = computeInputTreeHash(input.inputFiles);
  const createdAt = now();
  const eventType = eventTypeForKind(input.kind);
  const phase = input.phase ?? null;
  const ticketId = input.ticketId ?? null;
  const verifyCommand = input.verifyCommand ?? null;
  const verifyExit = input.verifyExit ?? null;
  const signedBy = input.signedBy ?? null;
  const payload = input.payload ?? null;
  const validatorsJson = JSON.stringify(input.validators);
  const payloadJson = JSON.stringify(payload);
  const contentMac = computeReceiptMac(
    {
      id: input.id,
      kind: input.kind,
      projectId: input.projectId,
      phase,
      ticketId,
      validators: input.validators,
      inputTreeHash,
      verifyCommand,
      verifyExit,
      signedBy,
    },
    signingKey,
  );

  const run = log.db.transaction((): void => {
    log.db
      .prepare(
        `INSERT INTO receipts
           (id, kind, project_id, phase, ticket_id, validators, input_tree_hash,
            verify_command, verify_exit, signed_by, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.kind,
        input.projectId,
        phase,
        ticketId,
        validatorsJson,
        inputTreeHash,
        verifyCommand,
        verifyExit,
        signedBy,
        payloadJson,
        createdAt,
      );
    appendEvent(
      log,
      {
        eventType,
        actorId: input.actorId,
        ticketId,
        payload: { receiptId: input.id, kind: input.kind, contentMac },
      },
      { now },
    );
  });
  run();

  return {
    id: input.id,
    kind: input.kind,
    projectId: input.projectId,
    phase,
    ticketId,
    validators: input.validators,
    inputTreeHash,
    verifyCommand,
    verifyExit,
    signedBy,
    payload,
    createdAt,
  };
}
