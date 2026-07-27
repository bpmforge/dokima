/**
 * Phase-validator runner (W9-06): executes a phase's declared validator set for real
 * and mints a genuine gate receipt under a distinct verifier identity — the FIRST
 * production caller of `@shipwright/validators`' `mintValidatorRunReceipt` (whose
 * header calls itself "the only path from a validator run to a receipt").
 *
 * FR-P1 "no receipt without a real run": `phase.validators` is read live off
 * `@shipwright/pipeline`'s topology on every call via `getPhase` — never frozen at an
 * earlier mint time or duplicated into this file — then run for real via
 * `loadValidatorPack`/`runValidatorPack` against the project's actual on-disk
 * deliverables (`packages/harbormaster/src/loop-gates.ts` is the working precedent for
 * this shape of call). A clean run (every validator `exitCode === 0`,
 * `evaluate.ts`) mints; anything else — a genuine failure, an untrustworthy verdict
 * (`exitCode === 2`), a validator pack that fails to even load, or a phase with zero
 * validators to run — returns `ok: false` with `receipt: null` and never touches
 * `mintValidatorRunReceipt` at all.
 *
 * Does NOT run for `PipelineRunEvent` (model-authored interview/blueprint/decompose
 * output) — that path stays the plain hash-chained audit event
 * `apps/server/src/api/pipeline/pipeline-routes/events.ts`'s `emitPhaseEvent` appends
 * (SECURITY_W5 CRITICAL FIX). This runner is what a *real* gate looks like: independent
 * validator scripts executed against the deliverables, not a hardcoded pass signed by
 * the same identity that produced the content.
 */
import { randomUUID } from 'node:crypto';
import {
  loadValidatorPack,
  mintValidatorRunReceipt,
  runValidatorPack,
  UnknownValidatorSelectionError,
  type ValidatorRunResult,
} from '@shipwright/validators';
import type { EventLog, ReceiptInputFile, ReceiptRecord } from '@shipwright/events';
import { getPhase, type PhaseId } from '@shipwright/pipeline';
import { evaluatePhaseGateResults } from './evaluate.js';
import {
  assertVerifierDistinctFromAuthor,
  ensurePhaseGateVerifierIdentity,
  PHASE_GATE_VERIFIER_ACTOR_ID,
} from './identity.js';
import { PhaseDeliverableMissingError, readPhaseInputFiles } from './input-files.js';

const DEFAULT_VALIDATOR_TIMEOUT_MS = 30_000;

export interface RunPhaseGateInput {
  readonly projectId: string;
  readonly phaseId: PhaseId;
  /** Directory validator executables are discovered from — normally `content/validators`. */
  readonly contentDir: string;
  /** The project's real on-disk deliverable tree: both `runValidatorPack`'s `cwd` and
   * the root every path-shaped deliverable is read from for the receipt's input tree —
   * one root for both, so the hash and the run anchor to the exact same files. */
  readonly projectRoot: string;
  /** The identity that authored the phase's currently-on-disk output. Required and
   * non-blank (Law 5) — see `identity.ts`'s `assertVerifierDistinctFromAuthor`. */
  readonly authorActorId: string;
  /** Defaults to `PHASE_GATE_VERIFIER_ACTOR_ID`. Overridable only for tests that need a
   * second, still-distinct machine identity. */
  readonly verifierActorId?: string;
  readonly id?: string;
  readonly now?: () => string;
  readonly validatorTimeoutMs?: number;
}

export interface RunPhaseGateOptions {
  /** Keychain-resolved minting secret — see `@shipwright/events`' `mintReceipt`. */
  readonly signingKey: string;
}

export interface RunPhaseGateResult {
  readonly ok: boolean;
  readonly phaseId: PhaseId;
  /** Every validator's real result, whether or not a receipt was minted. */
  readonly results: readonly ValidatorRunResult[];
  readonly receipt: ReceiptRecord | null;
  readonly reasons: readonly string[];
}

function refused(
  phaseId: PhaseId,
  reasons: readonly string[],
  results: readonly ValidatorRunResult[] = [],
): RunPhaseGateResult {
  return { ok: false, phaseId, results, receipt: null, reasons };
}

export async function runPhaseGate(
  log: EventLog,
  input: RunPhaseGateInput,
  opts: RunPhaseGateOptions,
): Promise<RunPhaseGateResult> {
  const phase = getPhase(input.phaseId);
  const verifierActorId = input.verifierActorId ?? PHASE_GATE_VERIFIER_ACTOR_ID;
  const now = input.now ?? (() => new Date().toISOString());

  // Law 5, mechanical, unconditional — refused BEFORE any validator runs, so a
  // same-identity call can never even produce a run, let alone a receipt.
  assertVerifierDistinctFromAuthor(phase.id, input.authorActorId, verifierActorId);

  let specs;
  try {
    specs = await loadValidatorPack({
      contentDir: input.contentDir,
      select: phase.validators,
    });
  } catch (err) {
    if (err instanceof UnknownValidatorSelectionError) {
      return refused(phase.id, [
        `could not load phase ${phase.id}'s validator pack: ${err.message}`,
      ]);
    }
    throw err;
  }

  let inputFiles: ReceiptInputFile[];
  try {
    inputFiles = await readPhaseInputFiles(phase, input.projectRoot);
  } catch (err) {
    if (err instanceof PhaseDeliverableMissingError) {
      return refused(phase.id, [err.message]);
    }
    throw err;
  }

  const results = await runValidatorPack(specs, {
    cwd: input.projectRoot,
    timeoutMs: input.validatorTimeoutMs ?? DEFAULT_VALIDATOR_TIMEOUT_MS,
  });

  const evaluation = evaluatePhaseGateResults(results);
  if (!evaluation.ok) {
    return refused(phase.id, evaluation.reasons, results);
  }

  ensurePhaseGateVerifierIdentity(log, verifierActorId, now);

  const receipt = mintValidatorRunReceipt(
    log,
    {
      id: input.id ?? randomUUID(),
      kind: 'gate',
      projectId: input.projectId,
      phase: phase.id,
      ticketId: null,
      inputFiles,
      results,
      actorId: verifierActorId,
    },
    { signingKey: opts.signingKey, now },
  );

  return { ok: true, phaseId: phase.id, results, receipt, reasons: [] };
}
