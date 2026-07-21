import {
  EXPORT_BUNDLE_VERSION,
  type ExportBundle,
  type ExportedEvent,
  type ExportedIdentity,
  type ExportedReceipt,
} from './types.js';

/**
 * Structural + referential-integrity validation for an untrusted bundle
 * (e.g. a JSON file a user hands to `import`). No `zod` here: `zod` is not a
 * declared dependency of `packages/shared` (only `packages/validators` has
 * it — TECH_STACK.md's "one validation library everywhere" is aspirational,
 * not yet true repo-wide), and adding it would mean editing
 * `packages/shared/package.json`, which sits outside this ticket's
 * `write_scope` (packages/shared/src/export/** only).
 */
export class InvalidExportBundleError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`invalid export bundle: ${reasons.join('; ')}`);
    this.name = 'InvalidExportBundleError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function validateIdentity(
  raw: unknown,
  index: number,
  reasons: string[],
): ExportedIdentity | undefined {
  if (!isPlainObject(raw)) {
    reasons.push(`identities[${index}] must be an object`);
    return undefined;
  }
  const at = (msg: string): void => {
    reasons.push(`identities[${index}]: ${msg}`);
  };
  if (typeof raw.id !== 'string' || raw.id.length === 0)
    at('id must be a non-empty string');
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    at('name must be a non-empty string');
  }
  if (raw.kind !== 'human' && raw.kind !== 'machine')
    at('kind must be "human" or "machine"');
  if (!isNullableString(raw.authProvider)) at('authProvider must be a string or null');
  if (!isNullableString(raw.role)) at('role must be a string or null');
  if (!isNullableString(raw.modelHint)) at('modelHint must be a string or null');
  if (typeof raw.createdAt !== 'string') at('createdAt must be a string');
  if (
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    (raw.kind !== 'human' && raw.kind !== 'machine') ||
    typeof raw.createdAt !== 'string'
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    authProvider: (raw.authProvider as string | null) ?? null,
    role: (raw.role as string | null) ?? null,
    modelHint: (raw.modelHint as string | null) ?? null,
    createdAt: raw.createdAt,
  };
}

function validateEvent(
  raw: unknown,
  index: number,
  reasons: string[],
): ExportedEvent | undefined {
  if (!isPlainObject(raw)) {
    reasons.push(`events[${index}] must be an object`);
    return undefined;
  }
  const at = (msg: string): void => {
    reasons.push(`events[${index}]: ${msg}`);
  };
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 1) {
    at('seq must be a positive integer');
  }
  if (typeof raw.eventType !== 'string' || raw.eventType.length === 0) {
    at('eventType must be a non-empty string');
  }
  if (typeof raw.actorId !== 'string' || raw.actorId.length === 0) {
    at('actorId must be a non-empty string');
  }
  if (!isNullableString(raw.ticketId)) at('ticketId must be a string or null');
  if (!isNullableString(raw.runId)) at('runId must be a string or null');
  if (typeof raw.payloadJson !== 'string') at('payloadJson must be a string');
  if (typeof raw.createdAt !== 'string') at('createdAt must be a string');
  if (typeof raw.prevHash !== 'string') at('prevHash must be a string');
  if (typeof raw.hash !== 'string') at('hash must be a string');
  if (
    typeof raw.seq !== 'number' ||
    typeof raw.eventType !== 'string' ||
    typeof raw.actorId !== 'string' ||
    typeof raw.payloadJson !== 'string' ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.prevHash !== 'string' ||
    typeof raw.hash !== 'string'
  ) {
    return undefined;
  }
  return {
    seq: raw.seq,
    eventType: raw.eventType,
    actorId: raw.actorId,
    ticketId: (raw.ticketId as string | null) ?? null,
    runId: (raw.runId as string | null) ?? null,
    payloadJson: raw.payloadJson,
    createdAt: raw.createdAt,
    prevHash: raw.prevHash,
    hash: raw.hash,
  };
}

function validateReceipt(
  raw: unknown,
  index: number,
  reasons: string[],
): ExportedReceipt | undefined {
  if (!isPlainObject(raw)) {
    reasons.push(`receipts[${index}] must be an object`);
    return undefined;
  }
  const at = (msg: string): void => {
    reasons.push(`receipts[${index}]: ${msg}`);
  };
  if (typeof raw.id !== 'string' || raw.id.length === 0)
    at('id must be a non-empty string');
  if (typeof raw.kind !== 'string' || raw.kind.length === 0) {
    at('kind must be a non-empty string');
  }
  if (typeof raw.projectId !== 'string' || raw.projectId.length === 0) {
    at('projectId must be a non-empty string');
  }
  if (!isNullableNumber(raw.phase)) at('phase must be a number or null');
  if (!isNullableString(raw.ticketId)) at('ticketId must be a string or null');
  if (typeof raw.validatorsJson !== 'string') at('validatorsJson must be a string');
  if (typeof raw.inputTreeHash !== 'string') at('inputTreeHash must be a string');
  if (!isNullableString(raw.verifyCommand)) at('verifyCommand must be a string or null');
  if (!isNullableNumber(raw.verifyExit)) at('verifyExit must be a number or null');
  if (!isNullableString(raw.signedBy)) at('signedBy must be a string or null');
  if (!isNullableString(raw.payloadJson)) at('payloadJson must be a string or null');
  if (typeof raw.createdAt !== 'string') at('createdAt must be a string');
  if (
    typeof raw.id !== 'string' ||
    typeof raw.kind !== 'string' ||
    typeof raw.projectId !== 'string' ||
    typeof raw.validatorsJson !== 'string' ||
    typeof raw.inputTreeHash !== 'string' ||
    typeof raw.createdAt !== 'string' ||
    !isNullableString(raw.payloadJson)
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    kind: raw.kind,
    projectId: raw.projectId,
    phase: (raw.phase as number | null) ?? null,
    ticketId: (raw.ticketId as string | null) ?? null,
    validatorsJson: raw.validatorsJson,
    inputTreeHash: raw.inputTreeHash,
    verifyCommand: (raw.verifyCommand as string | null) ?? null,
    verifyExit: (raw.verifyExit as number | null) ?? null,
    signedBy: (raw.signedBy as string | null) ?? null,
    payloadJson: raw.payloadJson,
    createdAt: raw.createdAt,
  };
}

/**
 * Validates a bundle's shape, then its cross-reference integrity (every
 * event `actorId` and receipt `signedBy` must resolve to a listed identity;
 * `events` must be seq-ordered and contiguous from 1 — the same invariant
 * `appendEvent` maintains live, DATABASE.md §1). Does NOT verify the hash
 * chain itself — that's `verifyBundleChain` (hash-chain.ts), kept separate
 * so a caller can report "malformed" vs. "tampered" distinctly.
 */
export function validateExportBundle(value: unknown): ExportBundle {
  const reasons: string[] = [];
  if (!isPlainObject(value)) {
    throw new InvalidExportBundleError(['bundle must be a JSON object']);
  }
  if (value.version !== EXPORT_BUNDLE_VERSION) {
    reasons.push(`unsupported version: ${JSON.stringify(value.version)}`);
  }
  if (typeof value.projectId !== 'string' || value.projectId.length === 0) {
    reasons.push('projectId must be a non-empty string');
  }
  if (typeof value.exportedAt !== 'string') reasons.push('exportedAt must be a string');
  if (!Array.isArray(value.identities)) reasons.push('identities must be an array');
  if (!Array.isArray(value.events)) reasons.push('events must be an array');
  if (!Array.isArray(value.receipts)) reasons.push('receipts must be an array');
  if (reasons.length > 0) throw new InvalidExportBundleError(reasons);

  const identities = (value.identities as unknown[]).map((raw, i) =>
    validateIdentity(raw, i, reasons),
  );
  const events = (value.events as unknown[]).map((raw, i) =>
    validateEvent(raw, i, reasons),
  );
  const receipts = (value.receipts as unknown[]).map((raw, i) =>
    validateReceipt(raw, i, reasons),
  );
  if (reasons.length > 0) throw new InvalidExportBundleError(reasons);

  const goodIdentities = identities as ExportedIdentity[];
  const goodEvents = events as ExportedEvent[];
  const goodReceipts = receipts as ExportedReceipt[];

  const identityIds = new Set(goodIdentities.map((i) => i.id));
  for (const event of goodEvents) {
    if (!identityIds.has(event.actorId)) {
      reasons.push(
        `events: seq ${event.seq} references unknown actorId "${event.actorId}"`,
      );
    }
  }
  for (const receipt of goodReceipts) {
    if (receipt.signedBy !== null && !identityIds.has(receipt.signedBy)) {
      reasons.push(
        `receipts: "${receipt.id}" references unknown signedBy "${receipt.signedBy}"`,
      );
    }
  }
  for (let i = 0; i < goodEvents.length; i += 1) {
    const expectedSeq = i + 1;
    if (goodEvents[i]?.seq !== expectedSeq) {
      reasons.push(
        `events must be seq-ordered and contiguous from 1 (index ${i} has seq ${goodEvents[i]?.seq})`,
      );
      break;
    }
  }
  if (reasons.length > 0) throw new InvalidExportBundleError(reasons);

  return {
    version: EXPORT_BUNDLE_VERSION,
    projectId: value.projectId as string,
    exportedAt: value.exportedAt as string,
    identities: goodIdentities,
    events: goodEvents,
    receipts: goodReceipts,
  };
}
