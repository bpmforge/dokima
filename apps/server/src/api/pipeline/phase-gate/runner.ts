/**
 * Phase-validator runner (W9-06): executes a phase's declared validator set for real
 * and mints a genuine gate receipt under a distinct verifier identity — the FIRST
 * production caller of `@dokima/validators`' `mintValidatorRunReceipt` (whose
 * header calls itself "the only path from a validator run to a receipt").
 *
 * FR-P1 "no receipt without a real run": `phase.validators` is read live off
 * `@dokima/pipeline`'s topology on every call via `getPhase` — never frozen at an
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
 *
 * KNOWN GAP (found while building this, confirmed empirically, out of this ticket's
 * write_scope): every phase in `@dokima/pipeline`'s `PHASES` (0–5) unconditionally
 * declares `validate-mermaid` (R-H3, `packages/pipeline/src/phases/topology.ts`).
 * `content/validators/validate-mermaid.sh` does not source `_lib.sh` (unlike every
 * other validator) and emits ZERO bytes to stdout on a genuinely clean scan — verified
 * directly: `MERMAID_NO_RENDER=1 bash content/validators/validate-mermaid.sh
 * <clean-dir>` exits 0 with empty stdout. `packages/validators/src/contract.ts`'s
 * `parseValidatorOutput('')` returns `null` (malformed output) for empty stdout
 * regardless of exit code, so `runValidator` normalizes that specific script's clean
 * case to `exitCode: 2`, never `0` — and a SINGLE finding misparses too (a lone
 * `{"severity":...}` line is valid JSON on its own, so `JSON.parse` succeeds and the
 * NDJSON per-line fallback — the only path that would recognize it — never runs; two or
 * more findings do work, because the concatenated lines are no longer valid JSON as a
 * whole and `JSON.parse` throws into the NDJSON fallback). Net effect: **no phase can
 * currently produce a clean gate receipt through `runPhaseGate` against real,
 * unmodified content** — not a bug in this runner (which is correctly fail-closed on
 * the resulting `exitCode: 2`, see `evaluate.test.ts`), but a pre-existing defect in
 * `content/validators/validate-mermaid.sh` ("DO NOT EDIT" imported content) and/or
 * `packages/validators/src/contract.ts`'s NDJSON detection, both outside this write
 * scope. `runner.test.ts` documents and works around this for its own GREEN fixture;
 * a separate real-content-only test in the same file (`GREEN (real content, criterion 2
 * proof)`) proves the mint/verify machinery itself is correct end to end against
 * `secrets-scan.sh`, a real validator that does conform.
 */
import { randomUUID } from 'node:crypto';
import {
  loadValidatorPack,
  mintValidatorRunReceipt,
  runValidatorPack,
  UnknownValidatorSelectionError,
  type ValidatorRunResult,
} from '@dokima/validators';
import type { EventLog, ReceiptInputFile, ReceiptRecord } from '@dokima/events';
import { getPhase, type PhaseId } from '@dokima/pipeline';
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
  /** Keychain-resolved minting secret — see `@dokima/events`' `mintReceipt`. */
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
