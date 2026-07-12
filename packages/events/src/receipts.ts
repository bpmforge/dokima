import {
  createHash,
  createHmac,
  timingSafeEqual,
  type Hash,
  type Hmac,
} from 'node:crypto';
import { appendEvent, listEvents } from './append.js';
import { getIdentity } from './identities.js';
import type { EventLog } from './types.js';

export type ReceiptKind =
  'gate' | 'close' | 'waiver' | 'challenge' | 'coverage' | 'fitness';

export interface ValidatorResult {
  name: string;
  exitCode: number;
  gapCount: number;
}

export interface ReceiptInputFile {
  path: string;
  content: string;
}

export interface ReceiptRecord {
  id: string;
  kind: ReceiptKind;
  projectId: string;
  phase: number | null;
  ticketId: string | null;
  validators: ValidatorResult[];
  inputTreeHash: string;
  verifyCommand: string | null;
  verifyExit: number | null;
  signedBy: string | null;
  payload: unknown;
  createdAt: string;
}

/**
 * Waiver receipts require a human signer (FR-P2). `kind !== 'human'` on the
 * resolved identity is the load-bearing check; DEFAULT_AGENT_NAME_BLOCKLIST
 * is defense-in-depth for a mislabeled identity, so keep it conservative —
 * broad substrings (e.g. "ai") false-positive on ordinary human names.
 */
export const DEFAULT_AGENT_NAME_BLOCKLIST: readonly string[] = [
  'agent',
  'claude',
  'gpt',
  'copilot',
  'bot',
  'assistant',
];

function isBlockedAgentName(name: string, blocklist: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return blocklist.some((term) => lower.includes(term.toLowerCase()));
}

export class WaiverSignatureRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiverSignatureRequiredError';
  }
}

export class AgentWaiverRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentWaiverRejectedError';
  }
}

/**
 * The minting secret (the HMAC key for the receipt anchor tag) must be a
 * non-empty value resolved from the keychain by the trusted minting path —
 * never a literal in code, settings, a prompt, or the event log (FR-S2,
 * law #8). A missing/empty key is a wiring bug, not a soft default: an empty
 * key would make the tag reproducible by any caller and reopen the forgery
 * path the tag exists to close, so we fail loudly instead.
 */
export class SigningKeyRequiredError extends Error {
  constructor() {
    super(
      'a non-empty minting secret is required — resolve it from the keychain in the ' +
        'trusted minting path (FR-S2); receipts.ts never holds a default key',
    );
    this.name = 'SigningKeyRequiredError';
  }
}

function assertSigningKey(signingKey: string): void {
  if (!signingKey) throw new SigningKeyRequiredError();
}

function lengthPrefixed(h: Hash | Hmac, value: string): void {
  const buf = Buffer.from(value, 'utf8');
  h.update(String(buf.length));
  h.update('\n');
  h.update(buf);
}

/**
 * Deterministic hash of an input-file tree (BLUEPRINT §3.2). Sorted by path
 * and length-prefixed per field for the same injectivity reason as
 * `computeEventHash` (hash.ts) — touching any file's content, or adding or
 * removing one, changes the result.
 */
export function computeInputTreeHash(files: readonly ReceiptInputFile[]): string {
  const sorted = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const h = createHash('sha256');
  for (const file of sorted) {
    lengthPrefixed(h, file.path);
    lengthPrefixed(h, file.content);
  }
  return h.digest('hex');
}

/** Fields covered by the anchoring event's MAC — everything that identifies what the receipt attests to. */
export interface ReceiptContent {
  id: string;
  kind: ReceiptKind;
  projectId: string;
  phase: number | null;
  ticketId: string | null;
  validators: ValidatorResult[];
  inputTreeHash: string;
  verifyCommand: string | null;
  verifyExit: number | null;
  signedBy: string | null;
}

const eventTypeForKind = (kind: ReceiptKind): string =>
  kind === 'waiver' ? 'gate.waived' : 'gate.receipt_minted';

/**
 * Keyed MAC (HMAC-SHA256) binding a receipts row to its anchoring event.
 * Each field is independently JSON-encoded (so `null` and `""` can't
 * collide) then length-prefixed (so field boundaries can't shift) before
 * being fed to the MAC — same injectivity discipline as `computeEventHash`
 * (hash.ts). `mintReceipt` stores the tag in the anchoring event's payload;
 * `verifyReceipt` recomputes it from the row and requires a match.
 *
 * Why a *keyed* MAC, not a plain hash: the row and the anchoring event are
 * both reachable by any code with a `log.db` handle, and this file (with the
 * exact tag algorithm) is readable. A plain content hash is therefore
 * reproducible by an untrusted caller — a forged row plus a self-consistent
 * forged event would recompute to the same digest and verify. The HMAC key
 * is the one input a forger cannot reconstruct from source: it is resolved
 * from the keychain by the trusted minting path (the Harbormaster, which
 * mints receipts from *outside* the untrusted agent session — ARCHITECTURE
 * §2) and is never present in agent-session context (FR-S2, law #8). So a
 * valid tag is evidence the secret-holder produced it.
 *
 * Scope boundary (do not overclaim): this makes forgery require possession
 * of the minting secret. The key *is* the trust boundary — by design, a
 * process holding it is the trusted minter, so "a process with both the key
 * and a `log.db` handle can mint" is not a hole but the definition of the
 * trusted path. Keeping the key (and the raw db handle) out of untrusted
 * agent-session processes entirely is the complementary process-boundary
 * fix (route all durable writes through a privileged gateway) — an
 * ARCHITECTURE-level concern outside this primitive's write_scope. What this
 * ticket delivers is the tag such a boundary needs.
 *
 * Exported so tests can construct forgeries (tagged with an attacker-chosen
 * key, to prove they fail) and, for the FR-P2 isolation test, a validly-
 * tagged row (to prove the waiver re-check is independent of the tag). HMAC
 * security rests on key secrecy, not on hiding this function.
 */
export function computeReceiptMac(content: ReceiptContent, signingKey: string): string {
  assertSigningKey(signingKey);
  const h = createHmac('sha256', signingKey);
  const field = (value: unknown): void => lengthPrefixed(h, JSON.stringify(value));
  field(content.id);
  field(content.kind);
  field(content.projectId);
  field(content.phase);
  field(content.ticketId);
  field(content.validators);
  field(content.inputTreeHash);
  field(content.verifyCommand);
  field(content.verifyExit);
  field(content.signedBy);
  return h.digest('hex');
}

/** Constant-time compare of two hex MAC strings; length mismatch is a non-match, not a throw. */
function macEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function receiptContent(receipt: ReceiptRecord): ReceiptContent {
  return {
    id: receipt.id,
    kind: receipt.kind,
    projectId: receipt.projectId,
    phase: receipt.phase,
    ticketId: receipt.ticketId,
    validators: receipt.validators,
    inputTreeHash: receipt.inputTreeHash,
    verifyCommand: receipt.verifyCommand,
    verifyExit: receipt.verifyExit,
    signedBy: receipt.signedBy,
  };
}

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

interface ReceiptRow {
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

function rowToRecord(row: ReceiptRow): ReceiptRecord {
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

export function getReceipt(log: EventLog, id: string): ReceiptRecord | undefined {
  const row = log.db
    .prepare<[string], ReceiptRow>('SELECT * FROM receipts WHERE id = ?')
    .get(id);
  return row ? rowToRecord(row) : undefined;
}

interface MintEventPayload {
  receiptId?: string;
  kind?: ReceiptKind;
  contentMac?: string;
}

/**
 * The event anchoring a receipt for *informational* reads (who minted it),
 * matched by kind-appropriate eventType and receiptId only. This does NOT
 * verify the MAC — reading the claimed actor is not a trust decision.
 * `verifyReceipt` does the MAC-checked lookup; the two must not be conflated.
 */
function findAnchorEvent(
  log: EventLog,
  receipt: ReceiptRecord,
): { actorId: string } | undefined {
  const expectedType = eventTypeForKind(receipt.kind);
  return listEvents(log).find((event) => {
    if (event.eventType !== expectedType) return false;
    const payload = event.payload as MintEventPayload | null;
    return payload?.receiptId === receipt.id;
  });
}

/** The identity that minted a receipt, read off its anchoring event (receipts carry no actor column of their own). */
export function getReceiptActor(log: EventLog, receiptId: string): string | null {
  const receipt = getReceipt(log, receiptId);
  if (!receipt) return null;
  return findAnchorEvent(log, receipt)?.actorId ?? null;
}

export interface ReceiptVerificationResult {
  valid: boolean;
  /** Empty when valid; one entry per failed check when invalid. */
  reasons: string[];
}

export interface VerifyReceiptOptions {
  /**
   * Keychain-resolved minting secret (HMAC key), the same one `mintReceipt`
   * used. The trusted verifying path (Harbormaster) holds it; an untrusted
   * caller does not, which is what makes the anchor MAC unforgeable (FR-S2).
   */
  signingKey: string;
  /** Current contents of the receipt's declared input tree (BLUEPRINT §3.2: recompute input hash). */
  inputFiles: readonly ReceiptInputFile[];
  /** Validators currently required for this gate (BLUEPRINT §3.2: validator-set currency). */
  requiredValidators: readonly string[];
  /** Extra names to reject on top of DEFAULT_AGENT_NAME_BLOCKLIST (mirrors MintReceiptOptions). */
  agentNameBlocklist?: readonly string[];
}

/**
 * The two-way re-check from BLUEPRINT §3.2, plus the anti-forgery anchor
 * check:
 *
 * (1) Anchor MAC — an event of the kind-appropriate type
 * (`gate.receipt_minted` for non-waivers, `gate.waived` for waivers) whose
 * payload.contentMac equals the HMAC recomputed from this row's own fields
 * with the minting secret must exist. This catches a row inserted directly
 * with no real mint (no such event), a row paired with a naively-forged
 * event (wrong/missing MAC), and — because the key is not reconstructable
 * from source — a *self-consistent* forgery of any kind (row + event a
 * key-less attacker tagged so they agree with each other): the attacker's
 * tag won't equal the one recomputed under the real secret. See
 * `computeReceiptMac` for what this does and does not close.
 *
 * (2) Input-tree currency — recomputing the input-tree hash over the current
 * files must match the stored hash (catches silently edited input files).
 *
 * (3) Validator currency — every currently-required validator must appear in
 * the receipt with exit code 0 (catches gate-definition drift: a validator
 * added since the receipt was minted makes it stale even though its own hash
 * still checks out).
 *
 * (4) Waiver FR-P2 re-check — for waiver receipts, `signedBy` is re-resolved
 * to a human identity and re-checked against the agent-name blocklist,
 * independently of the MAC. Waivers thus get *two* independent guards (the
 * MAC and this re-check); the re-check exists so that even a validly-tagged
 * waiver (e.g. one minted before a signer's identity was reclassified, or in
 * a world where the secret leaked) cannot pass as an agent-signed waiver.
 * Gate/close/challenge/coverage/fitness receipts get only the MAC guard here
 * — re-running their actual validators server-side is the Harbormaster's job
 * (it mints from ground truth), not this primitive's.
 */
export function verifyReceipt(
  log: EventLog,
  receiptId: string,
  opts: VerifyReceiptOptions,
): ReceiptVerificationResult {
  assertSigningKey(opts.signingKey);
  const receipt = getReceipt(log, receiptId);
  if (!receipt) {
    return { valid: false, reasons: ['receipt not found'] };
  }

  const reasons: string[] = [];

  const expectedType = eventTypeForKind(receipt.kind);
  const expectedMac = computeReceiptMac(receiptContent(receipt), opts.signingKey);
  const anchored = listEvents(log).some((event) => {
    if (event.eventType !== expectedType) return false;
    const payload = event.payload as MintEventPayload | null;
    if (payload?.receiptId !== receipt.id) return false;
    return (
      typeof payload.contentMac === 'string' && macEqual(payload.contentMac, expectedMac)
    );
  });
  if (!anchored) {
    reasons.push(
      'no anchoring gate.receipt_minted/gate.waived event with a matching content MAC — not minted by a real run',
    );
  }

  if (receipt.kind === 'waiver') {
    const blocklist = [
      ...DEFAULT_AGENT_NAME_BLOCKLIST,
      ...(opts.agentNameBlocklist ?? []),
    ];
    if (!receipt.signedBy) {
      reasons.push('waiver receipt has no signedBy (FR-P2)');
    } else {
      const signer = getIdentity(log, receipt.signedBy);
      if (!signer) {
        reasons.push(`waiver signedBy identity not found: ${receipt.signedBy} (FR-P2)`);
      } else if (signer.kind !== 'human') {
        reasons.push(
          `waiver requires a human signature; identity "${signer.id}" is kind "${signer.kind}" (FR-P2)`,
        );
      } else if (isBlockedAgentName(signer.name, blocklist)) {
        reasons.push(
          `waiver signer name "${signer.name}" matches the agent-name blocklist (FR-P2/FR-N3)`,
        );
      }
    }
  }

  const recomputedHash = computeInputTreeHash(opts.inputFiles);
  if (recomputedHash !== receipt.inputTreeHash) {
    reasons.push(
      'input tree hash mismatch — an input file changed since the receipt was minted',
    );
  }

  const missingValidators = opts.requiredValidators.filter(
    (name) => !receipt.validators.some((v) => v.name === name && v.exitCode === 0),
  );
  if (missingValidators.length > 0) {
    reasons.push(
      `validator set is stale — currently-required validator(s) not satisfied: ${missingValidators.join(', ')}`,
    );
  }

  return { valid: reasons.length === 0, reasons };
}
