/**
 * The approvals ledger (SRS FR-N3, DATABASE.md §4 `approvals_ledger`, US-703).
 * Ledger rows are events, not a separate table: `approvals_ledger` is
 * documented as "append-only like events (same trigger guard)" and no
 * migration for it exists in `@shipwright/events` (out of this ticket's
 * `packages/harbormaster/src/autonomy*` write_scope to add one) — so rows
 * are minted via the same `appendEvent` primitive every other durable write
 * in this codebase uses (C-6: single writer, hash-chained), and read back by
 * filtering `listEvents` on this module's own event type. They inherit the
 * event log's tamper-evidence for free (a forged/edited row breaks
 * `verifyChain`, exercised in `validateAutonomyLedger` below) rather than
 * needing a second signing scheme.
 *
 * NEVER-AUTO rows require a human signer (CONSTRAINTS.md C-5, SC-05): the
 * same discipline `@shipwright/events`' `mintReceipt` applies to waiver
 * receipts (FR-P2), reproduced here for the ledger's own `humanSignature`
 * field rather than imported, because a receipt's shape (validators,
 * input-tree hash, verify command/exit) does not fit a ledger row at all —
 * same "reproduce the shape, don't reach past the package's own concern"
 * call `loop-land-policy.ts` made for D-018's escalation modes.
 */

import {
  appendEvent,
  DEFAULT_AGENT_NAME_BLOCKLIST,
  getIdentity,
  listChainRows,
  listEvents,
  verifyChain,
  type EventLog,
} from '@shipwright/events';
import {
  isNeverAutoPauseSite,
  LEDGER_DECISIONS,
  type AutonomyLedgerRow,
  type AutonomyMode,
  type LedgerDecision,
  type PauseSiteKind,
} from './autonomy-types.js';

/** The single event type every ledger row is anchored under (readAutonomyLedger's filter). */
export const LEDGER_EVENT_TYPE = 'autonomy.ledger_row_appended';

export class NeverAutoAutoDefaultRefusedError extends Error {
  constructor(pauseSite: PauseSiteKind) {
    super(
      `pause site '${pauseSite}' is NEVER-AUTO — auto mode may not take a default here; ` +
        'it must be routed to a human decision and ledgered via appendNeverAutoDecisionRow (CONSTRAINTS.md C-5, FR-N3)',
    );
    this.name = 'NeverAutoAutoDefaultRefusedError';
  }
}

export class HumanSignatureRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HumanSignatureRequiredError';
  }
}

export class AgentSignatureRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentSignatureRejectedError';
  }
}

/** Mirrors `@shipwright/events`' receipts.ts private helper of the same name — see module doc. */
function isBlockedAgentName(name: string, blocklist: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return blocklist.some((term) => lower.includes(term.toLowerCase()));
}

interface LedgerRowPayload {
  id?: unknown;
  runId?: unknown;
  pauseSite?: unknown;
  mode?: unknown;
  defaultTaken?: unknown;
  wouldHaveAsked?: unknown;
  humanSignature?: unknown;
  decision?: unknown;
}

function toRow(
  id: string,
  payload: LedgerRowPayload,
  createdAt: string,
  decidedBy: string,
): AutonomyLedgerRow {
  return {
    id,
    runId: typeof payload.runId === 'string' ? payload.runId : null,
    pauseSite: payload.pauseSite as PauseSiteKind,
    mode: payload.mode as AutonomyMode,
    defaultTaken: typeof payload.defaultTaken === 'string' ? payload.defaultTaken : null,
    wouldHaveAsked:
      typeof payload.wouldHaveAsked === 'string' ? payload.wouldHaveAsked : '',
    decidedBy,
    humanSignature:
      typeof payload.humanSignature === 'string' ? payload.humanSignature : null,
    decision: payload.decision as LedgerDecision,
    createdAt,
  };
}

export interface AppendAutoDefaultInput {
  readonly id: string;
  readonly runId?: string | null;
  readonly pauseSite: PauseSiteKind;
  readonly defaultTaken: string;
  readonly wouldHaveAsked: string;
  /** The identity appending the row (the Harbormaster/worker's own machine identity). */
  readonly actorId: string;
}

export interface AppendLedgerRowOptions {
  now?: () => string;
}

/**
 * Ledgers one auto-taken default (US-703 AC-1: "every auto-taken default
 * appends a ledger row [pause-site, default, what would've been asked]").
 * Refuses outright for a NEVER-AUTO pause site — this is the only minting
 * path for `decision: 'auto-default'` rows, so the refusal here is what
 * makes "auto mode can never resolve a NEVER-AUTO site by default" true by
 * construction rather than by caller discipline.
 */
export function appendAutoDefaultRow(
  log: EventLog,
  input: AppendAutoDefaultInput,
  opts: AppendLedgerRowOptions = {},
): AutonomyLedgerRow {
  if (isNeverAutoPauseSite(input.pauseSite)) {
    throw new NeverAutoAutoDefaultRefusedError(input.pauseSite);
  }
  const payload: LedgerRowPayload = {
    id: input.id,
    runId: input.runId ?? null,
    pauseSite: input.pauseSite,
    mode: 'auto' satisfies AutonomyMode,
    defaultTaken: input.defaultTaken,
    wouldHaveAsked: input.wouldHaveAsked,
    humanSignature: null,
    decision: 'auto-default' satisfies LedgerDecision,
  };
  const event = appendEvent(
    log,
    {
      eventType: LEDGER_EVENT_TYPE,
      actorId: input.actorId,
      runId: input.runId ?? null,
      payload,
    },
    { now: opts.now },
  );
  return toRow(input.id, payload, event.createdAt, input.actorId);
}

export interface AppendNeverAutoDecisionInput {
  readonly id: string;
  readonly runId?: string | null;
  readonly pauseSite: PauseSiteKind;
  /** The project's autonomy mode at decision time — recorded for audit even though NEVER-AUTO always asks regardless of mode. */
  readonly mode: AutonomyMode;
  readonly decision: 'approved' | 'rejected';
  readonly wouldHaveAsked: string;
  /** Identity id of the human signer; must resolve to `kind: 'human'` and pass the agent-name blocklist (FR-P2/FR-N3/SC-05). */
  readonly humanSignature: string;
  /** The identity appending the row (may equal `humanSignature`, e.g. a human operating the board directly). */
  readonly actorId: string;
  /** Extra names to reject on top of DEFAULT_AGENT_NAME_BLOCKLIST. */
  readonly agentNameBlocklist?: readonly string[];
}

/**
 * Ledgers a human decision on a NEVER-AUTO pause site (US-703 AC-2: "NEVER-
 * AUTO rows require a human signature"). Independently re-verifies the
 * signer at mint time — same discipline as `mintReceipt`'s waiver check —
 * so a caller cannot ledger a NEVER-AUTO row under a machine or blocklisted
 * identity even if some upstream check was skipped.
 */
export function appendNeverAutoDecisionRow(
  log: EventLog,
  input: AppendNeverAutoDecisionInput,
  opts: AppendLedgerRowOptions = {},
): AutonomyLedgerRow {
  const blocklist = [
    ...DEFAULT_AGENT_NAME_BLOCKLIST,
    ...(input.agentNameBlocklist ?? []),
  ];
  if (!input.humanSignature) {
    throw new HumanSignatureRequiredError(
      `NEVER-AUTO pause site '${input.pauseSite}' requires humanSignature (FR-N3/SC-05)`,
    );
  }
  const signer = getIdentity(log, input.humanSignature);
  if (!signer) {
    throw new HumanSignatureRequiredError(
      `humanSignature identity not found: ${input.humanSignature}`,
    );
  }
  if (signer.kind !== 'human') {
    throw new AgentSignatureRejectedError(
      `NEVER-AUTO decisions require a human signature; identity "${signer.id}" is kind "${signer.kind}" (FR-N3/SC-05)`,
    );
  }
  if (isBlockedAgentName(signer.name, blocklist)) {
    throw new AgentSignatureRejectedError(
      `NEVER-AUTO signer name "${signer.name}" matches the agent-name blocklist (FR-N3/SC-05)`,
    );
  }

  const payload: LedgerRowPayload = {
    id: input.id,
    runId: input.runId ?? null,
    pauseSite: input.pauseSite,
    mode: input.mode,
    defaultTaken: null,
    wouldHaveAsked: input.wouldHaveAsked,
    humanSignature: input.humanSignature,
    decision: input.decision,
  };
  const event = appendEvent(
    log,
    {
      eventType: LEDGER_EVENT_TYPE,
      actorId: input.actorId,
      runId: input.runId ?? null,
      payload,
    },
    { now: opts.now },
  );
  return toRow(input.id, payload, event.createdAt, input.actorId);
}

/** Every ledger row appended so far, in event order — no filtering/validation (see `validateAutonomyLedger` for that). */
export function readAutonomyLedger(log: EventLog): AutonomyLedgerRow[] {
  return listEvents(log)
    .filter((event) => event.eventType === LEDGER_EVENT_TYPE)
    .map((event) => {
      const payload = (event.payload ?? {}) as LedgerRowPayload;
      const id = typeof payload.id === 'string' ? payload.id : String(event.seq);
      return toRow(id, payload, event.createdAt, event.actorId);
    });
}

export interface LedgerValidationResult {
  readonly valid: boolean;
  /** Empty when valid; one entry per problem found when invalid. */
  readonly errors: string[];
}

export interface ValidateLedgerOptions {
  readonly agentNameBlocklist?: readonly string[];
}

/**
 * Structural + semantic validation of one raw ledger-row payload, independent
 * of how it got into the log — the row need not have been minted through
 * `appendAutoDefaultRow`/`appendNeverAutoDecisionRow` for this to catch it
 * (TESTING.md §6 "Ledger forgery" fixture: a NEVER-AUTO row lacking a human
 * signature). Returns one message per problem; empty means valid.
 */
export function validateLedgerRowPayload(
  log: EventLog,
  payload: unknown,
  blocklist: readonly string[],
  label: string,
): string[] {
  const errors: string[] = [];
  if (typeof payload !== 'object' || payload === null) {
    return [`${label}: payload is not an object`];
  }
  const row = payload as LedgerRowPayload;

  if (typeof row.id !== 'string' || row.id.length === 0) {
    errors.push(`${label}: missing or non-string id`);
  }
  if (typeof row.pauseSite !== 'string' || row.pauseSite.length === 0) {
    errors.push(`${label}: missing or non-string pauseSite`);
  }
  if (row.mode !== 'interactive' && row.mode !== 'auto') {
    errors.push(
      `${label}: mode must be 'interactive' or 'auto', got ${JSON.stringify(row.mode)}`,
    );
  }
  if (typeof row.wouldHaveAsked !== 'string' || row.wouldHaveAsked.length === 0) {
    errors.push(`${label}: missing or non-string wouldHaveAsked`);
  }
  if (row.defaultTaken !== null && typeof row.defaultTaken !== 'string') {
    errors.push(`${label}: defaultTaken must be a string or null`);
  }
  if (
    typeof row.decision !== 'string' ||
    !(LEDGER_DECISIONS as readonly string[]).includes(row.decision)
  ) {
    errors.push(
      `${label}: decision must be one of ${LEDGER_DECISIONS.join('|')}, got ${JSON.stringify(row.decision)}`,
    );
  }
  if (
    row.humanSignature !== null &&
    row.humanSignature !== undefined &&
    typeof row.humanSignature !== 'string'
  ) {
    errors.push(`${label}: humanSignature must be a string or null`);
  }

  // Structural failures above make the semantic checks below meaningless (nothing to key off of).
  if (errors.length > 0) return errors;

  const pauseSite = row.pauseSite as PauseSiteKind;
  const neverAuto = isNeverAutoPauseSite(pauseSite);

  if (neverAuto) {
    if (row.decision === 'auto-default') {
      errors.push(
        `${label}: pauseSite '${pauseSite}' is NEVER-AUTO but decision is 'auto-default' (CONSTRAINTS.md C-5)`,
      );
    }
    const humanSignature =
      typeof row.humanSignature === 'string' ? row.humanSignature : null;
    if (!humanSignature) {
      errors.push(`${label}: NEVER-AUTO row missing humanSignature (FR-N3/SC-05)`);
    } else {
      const signer = getIdentity(log, humanSignature);
      if (!signer) {
        errors.push(`${label}: humanSignature identity not found: ${humanSignature}`);
      } else if (signer.kind !== 'human') {
        errors.push(
          `${label}: humanSignature identity "${signer.id}" is kind "${signer.kind}", not human (FR-N3/SC-05)`,
        );
      } else if (isBlockedAgentName(signer.name, blocklist)) {
        errors.push(
          `${label}: humanSignature name "${signer.name}" matches the agent-name blocklist (FR-N3/SC-05)`,
        );
      }
    }
  } else if (row.decision === 'auto-default' && row.mode !== 'auto') {
    errors.push(
      `${label}: decision 'auto-default' recorded under mode '${String(row.mode)}', expected 'auto'`,
    );
  }

  return errors;
}

/**
 * Runtime validation of the whole ledger (SRS FR-N3 "ledger schema validated
 * at runtime"; US-703 AC-3). Two independent checks, both must pass:
 *
 * (1) Hash-chain integrity over the *entire* event log (not just ledger
 * rows) — a ledger row is an event, so an edited row breaks `verifyChain`
 * exactly like an edited ticket or receipt event would (C-6, TESTING.md §6
 * "edited ledger row").
 *
 * (2) Every `LEDGER_EVENT_TYPE` row individually passes
 * `validateLedgerRowPayload` — catches a row appended straight through the
 * generic `appendEvent` API (bypassing this module's minting functions and
 * their checks) with a missing field, a NEVER-AUTO site with no human
 * signature, or a NEVER-AUTO site marked `auto-default` (TESTING.md §6
 * "NEVER-AUTO ledger row without human signature").
 */
export function validateAutonomyLedger(
  log: EventLog,
  opts: ValidateLedgerOptions = {},
): LedgerValidationResult {
  const blocklist = [...DEFAULT_AGENT_NAME_BLOCKLIST, ...(opts.agentNameBlocklist ?? [])];
  const errors: string[] = [];

  const chainResult = verifyChain(listChainRows(log));
  if (!chainResult.valid) {
    errors.push(
      `event log hash chain broken at seq ${String(chainResult.brokenAtSeq)}: ${String(chainResult.reason)} — the log is not append-only-clean, so no ledger row in it can be trusted`,
    );
  }

  const ledgerEvents = listEvents(log).filter(
    (event) => event.eventType === LEDGER_EVENT_TYPE,
  );
  for (const event of ledgerEvents) {
    const label = `ledger row at seq ${String(event.seq)}`;
    errors.push(...validateLedgerRowPayload(log, event.payload, blocklist, label));
  }

  return { valid: errors.length === 0, errors };
}
