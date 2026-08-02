import {
  mintReceipt,
  type EventLog,
  type ReceiptInputFile,
  type ReceiptKind,
  type ReceiptRecord,
} from '@dokima/events';
import type { ValidatorRunResult } from './run.js';

export interface MintValidatorRunReceiptInput {
  id: string;
  kind: ReceiptKind;
  projectId: string;
  phase?: number | null;
  ticketId?: string | null;
  /** The gated input tree — what the receipt's `inputTreeHash` anchors to (BLUEPRINT §3.2). */
  inputFiles: readonly ReceiptInputFile[];
  results: readonly ValidatorRunResult[];
  actorId: string;
  signedBy?: string | null;
}

export interface MintValidatorRunReceiptOptions {
  signingKey: string;
  now?: () => string;
  agentNameBlocklist?: readonly string[];
}

/**
 * The only path from a validator run to a receipt (acceptance criterion 1:
 * "results mint receipts via the W0-05 API only") — this is a thin adapter
 * over `mintReceipt`, never a parallel persistence mechanism. Gate currency
 * (BLUEPRINT §3.2) reads exit codes off `validators[]`, so a run result that
 * didn't cleanly pass (exitCode !== 0, including timeouts/malformed output —
 * see `run.ts`) must still land here with its real exit code; it is not this
 * function's job to filter or reinterpret run results.
 */
export function mintValidatorRunReceipt(
  log: EventLog,
  input: MintValidatorRunReceiptInput,
  opts: MintValidatorRunReceiptOptions,
): ReceiptRecord {
  const validators = input.results.map((result) => ({
    name: result.name,
    exitCode: result.exitCode,
    gapCount: result.gapCount,
  }));
  const verifyExit = validators.some((v) => v.exitCode !== 0) ? 1 : 0;

  return mintReceipt(
    log,
    {
      id: input.id,
      kind: input.kind,
      projectId: input.projectId,
      phase: input.phase,
      ticketId: input.ticketId,
      validators,
      inputFiles: input.inputFiles,
      verifyCommand: 'validator-pack',
      verifyExit,
      actorId: input.actorId,
      signedBy: input.signedBy,
      payload: {
        gaps: input.results.map((result) => ({ name: result.name, gaps: result.gaps })),
      },
    },
    opts,
  );
}
