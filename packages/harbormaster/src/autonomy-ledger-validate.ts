/**
 * Runtime validation of the approvals ledger (SRS FR-N3, US-703 AC-3).
 * CODE_BOOK_PROTOCOL.md chapter split from `autonomy-ledger.ts` (minting +
 * reading) — this ticket's `packages/harbormaster/src/autonomy*` write_scope
 * only allows flat sibling files, not a subdirectory, so the split is by
 * filename. Depends one-way on `autonomy-ledger.ts` for the event type tag,
 * the raw payload shape, and the shared agent-name-blocklist matcher — it is
 * never imported back, so the two chapters do not cycle.
 */

import {
  DEFAULT_AGENT_NAME_BLOCKLIST,
  getIdentity,
  listChainRows,
  listEvents,
  verifyChain,
  type EventLog,
} from '@shipwright/events';
import {
  isBlockedAgentName,
  LEDGER_EVENT_TYPE,
  type LedgerRowPayload,
} from './autonomy-ledger.js';
import {
  ALL_PAUSE_SITE_KINDS,
  isNeverAutoPauseSite,
  isPauseSiteKind,
  LEDGER_DECISIONS,
  type PauseSiteKind,
} from './autonomy-types.js';

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
  } else if (!isPauseSiteKind(row.pauseSite)) {
    errors.push(
      `${label}: unrecognized pauseSite ${JSON.stringify(row.pauseSite)}, expected one of ${ALL_PAUSE_SITE_KINDS.join('|')}`,
    );
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
