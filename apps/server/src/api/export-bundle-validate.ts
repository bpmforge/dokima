/**
 * Structural + referential-integrity validation of an untrusted import body
 * (mirrors `packages/shared/src/export/validate.ts`'s checks — see
 * `export-bundle.ts`'s module header for why the logic is duplicated rather
 * than imported). Does NOT verify the hash chain; that's `importExportBundle`
 * (export-bundle-import.ts), which reuses `@shipwright/events`'s
 * `verifyChain` directly.
 */
import {
  EXPORT_BUNDLE_VERSION,
  BundleValidationError,
  type BundleEvent,
  type BundleIdentity,
  type BundleReceipt,
  type ExportBundle,
} from './export-bundle-types.js';

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
): BundleIdentity | undefined {
  if (!isPlainObject(raw)) {
    reasons.push(`identities[${index}] must be an object`);
    return undefined;
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    reasons.push(`identities[${index}]: id must be a non-empty string`);
  }
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    reasons.push(`identities[${index}]: name must be a non-empty string`);
  }
  if (raw.kind !== 'human' && raw.kind !== 'machine') {
    reasons.push(`identities[${index}]: kind must be "human" or "machine"`);
  }
  if (!isNullableString(raw.authProvider)) {
    reasons.push(`identities[${index}]: authProvider must be a string or null`);
  }
  if (!isNullableString(raw.role)) {
    reasons.push(`identities[${index}]: role must be a string or null`);
  }
  if (!isNullableString(raw.modelHint)) {
    reasons.push(`identities[${index}]: modelHint must be a string or null`);
  }
  if (typeof raw.createdAt !== 'string') {
    reasons.push(`identities[${index}]: createdAt must be a string`);
  }
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
): BundleEvent | undefined {
  if (!isPlainObject(raw)) {
    reasons.push(`events[${index}] must be an object`);
    return undefined;
  }
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 1) {
    reasons.push(`events[${index}]: seq must be a positive integer`);
  }
  if (typeof raw.eventType !== 'string' || raw.eventType.length === 0) {
    reasons.push(`events[${index}]: eventType must be a non-empty string`);
  }
  if (typeof raw.actorId !== 'string' || raw.actorId.length === 0) {
    reasons.push(`events[${index}]: actorId must be a non-empty string`);
  }
  if (!isNullableString(raw.ticketId)) {
    reasons.push(`events[${index}]: ticketId must be a string or null`);
  }
  if (!isNullableString(raw.runId))
    reasons.push(`events[${index}]: runId must be a string or null`);
  if (typeof raw.payloadJson !== 'string') {
    reasons.push(`events[${index}]: payloadJson must be a string`);
  }
  if (typeof raw.createdAt !== 'string')
    reasons.push(`events[${index}]: createdAt must be a string`);
  if (typeof raw.prevHash !== 'string')
    reasons.push(`events[${index}]: prevHash must be a string`);
  if (typeof raw.hash !== 'string')
    reasons.push(`events[${index}]: hash must be a string`);
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
): BundleReceipt | undefined {
  if (!isPlainObject(raw)) {
    reasons.push(`receipts[${index}] must be an object`);
    return undefined;
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    reasons.push(`receipts[${index}]: id must be a non-empty string`);
  }
  if (typeof raw.kind !== 'string' || raw.kind.length === 0) {
    reasons.push(`receipts[${index}]: kind must be a non-empty string`);
  }
  if (typeof raw.projectId !== 'string' || raw.projectId.length === 0) {
    reasons.push(`receipts[${index}]: projectId must be a non-empty string`);
  }
  if (!isNullableNumber(raw.phase))
    reasons.push(`receipts[${index}]: phase must be a number or null`);
  if (!isNullableString(raw.ticketId)) {
    reasons.push(`receipts[${index}]: ticketId must be a string or null`);
  }
  if (typeof raw.validatorsJson !== 'string') {
    reasons.push(`receipts[${index}]: validatorsJson must be a string`);
  }
  if (typeof raw.inputTreeHash !== 'string') {
    reasons.push(`receipts[${index}]: inputTreeHash must be a string`);
  }
  if (!isNullableString(raw.verifyCommand)) {
    reasons.push(`receipts[${index}]: verifyCommand must be a string or null`);
  }
  if (!isNullableNumber(raw.verifyExit)) {
    reasons.push(`receipts[${index}]: verifyExit must be a number or null`);
  }
  if (!isNullableString(raw.signedBy)) {
    reasons.push(`receipts[${index}]: signedBy must be a string or null`);
  }
  if (!isNullableString(raw.payloadJson)) {
    reasons.push(`receipts[${index}]: payloadJson must be a string or null`);
  }
  if (typeof raw.createdAt !== 'string')
    reasons.push(`receipts[${index}]: createdAt must be a string`);
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

export function validateExportBundle(value: unknown): ExportBundle {
  const reasons: string[] = [];
  if (!isPlainObject(value)) {
    throw new BundleValidationError(['bundle must be a JSON object']);
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
  if (reasons.length > 0) throw new BundleValidationError(reasons);

  const identities = (value.identities as unknown[]).map((raw, i) =>
    validateIdentity(raw, i, reasons),
  );
  const events = (value.events as unknown[]).map((raw, i) =>
    validateEvent(raw, i, reasons),
  );
  const receipts = (value.receipts as unknown[]).map((raw, i) =>
    validateReceipt(raw, i, reasons),
  );
  if (reasons.length > 0) throw new BundleValidationError(reasons);

  const goodIdentities = identities as BundleIdentity[];
  const goodEvents = events as BundleEvent[];
  const goodReceipts = receipts as BundleReceipt[];

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
  if (reasons.length > 0) throw new BundleValidationError(reasons);

  return {
    version: EXPORT_BUNDLE_VERSION,
    projectId: value.projectId as string,
    exportedAt: value.exportedAt as string,
    identities: goodIdentities,
    events: goodEvents,
    receipts: goodReceipts,
  };
}
