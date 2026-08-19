/**
 * loop-land-session.ts — running one agent session, and surviving the endpoint.
 *
 * Chapter of `loop-land.ts`, split at the 400-line CODE_BOOK_PROTOCOL cap that
 * file was already sitting exactly on. The seam is real: this is "run one
 * session and tell me what came back", while `loop-land.ts` is the ladder that
 * decides what to do about it.
 */
import { isProviderError } from '@dokima/gateway';
import type { InfraFailureKind } from '@dokima/loop';
import type { WorktreeHandle } from '@dokima/git';
import { redactDeep } from '@dokima/shared';
import type { Ticket } from '@dokima/tickets';
import { runCloseGate, type CloseGateResult } from './loop-gates.js';
import type { LandLoopOptions } from './loop-land.js';
import {
  runSession,
  type Handoff,
  type SessionResult,
  type SpawnSession,
} from '@dokima/loop';

export interface RunSessionInput {
  readonly handoff: Handoff;
  readonly cwd: string;
  readonly spawn: SpawnSession;
}

/**
 * W13-13: A PROVIDER FAILING ENDS THE ATTEMPT, NOT THE PROCESS.
 *
 * Found in live testing. A 27B model on local hardware exceeded the 300s
 * request timeout, and `ProviderTimeoutError` propagated straight out of
 * `runLandLoop` and killed the run with a stack trace — after the session had
 * already written correct code, verified it to exit 0 and committed it. The
 * operator saw a crash instead of a result, and the ticket was left stranded
 * in `in_progress` with no owner.
 *
 * A slow or unreachable endpoint is an EXPECTED condition for a product that
 * guarantees local-only works (C-1, D-024 option a) — local hardware running a
 * 27B model is exactly where a 300-second call comes from. It should end the
 * attempt the way any other failed attempt ends: evidence, the ladder, a park.
 *
 * ONLY provider-shaped errors are absorbed. Anything else is our own bug and
 * must still surface — a catch-all here would turn a crash in the close gate
 * into a quiet "attempt failed", which is the kind of silence this product
 * exists to refuse.
 */
export async function runSessionAbsorbingProviderFailure(
  input: RunSessionInput,
): Promise<{ result: SessionResult; infraFailure: InfraFailureKind | null }> {
  try {
    return { result: await runSession(input), infraFailure: null };
  } catch (err) {
    if (!isProviderError(err)) throw err;
    /**
     * W13-27: reported as INFRASTRUCTURE, so the ladder does not pay for it.
     * W13-13 stopped this crashing the run; it still cost an attempt, and with
     * a ceiling of 2 that meant two endpoint hiccups parked a ticket whose work
     * had never been judged — a park that then needs a person.
     */
    return {
      infraFailure: 'endpoint_failure',
      result: {
        exitCode: null,
        // Named distinctly from "no completion manifest returned": someone
        // choosing a smaller model needs to tell "it did not answer in time"
        // apart from "it answered without a manifest". Those point at
        // different fixes — a bigger timeout versus a different model.
        output: `provider failure: ${err instanceof Error ? err.message : String(err)}`,
        manifest: null,
        manifestParseTier: null,
        scopeViolations: [],
      },
    };
  }
}

/** Runs one fresh session, then (only if it returned a manifest) the real out-of-session close gate. `secretValues` (W11-16) wraps `spawn` to redact the rendered prompt before it leaves the process, since `runSession` has no redaction hook of its own. */
export async function attemptOnce(
  options: LandLoopOptions,
  ticket: Ticket,
  worktree: WorktreeHandle,
  baseRef: string,
): Promise<{
  session: SessionResult;
  closeGate: CloseGateResult | null;
  infraFailure: InfraFailureKind | null;
}> {
  const handoff = await options.buildHandoff(ticket);
  const secrets = options.secretValues;
  const spawn: SpawnSession = secrets?.length
    ? (input) => options.spawn({ ...input, prompt: redactDeep(input.prompt, secrets) })
    : options.spawn;
  // W13-13: a provider failure ends the attempt, not the process — see
  // loop-land-session.ts.
  const { result: session, infraFailure } = await runSessionAbsorbingProviderFailure({
    handoff,
    cwd: worktree.path,
    spawn,
  });
  if (!session.manifest) {
    // NOT infra when `infraFailure` is null: a session that answered without a
    // Completion Manifest failed the contract, and that must keep costing an
    // attempt or a real defect retries forever.
    return { session, closeGate: null, infraFailure };
  }
  const closeGate = await runCloseGate({
    log: options.log,
    actorId: options.actorId,
    projectId: options.projectId,
    ticket,
    worktree,
    manifest: session.manifest,
    baseRef,
    contentDir: options.contentDir,
    signingKey: options.signingKey,
    requiredValidators: options.requiredValidators,
    verifyTimeoutMs: options.verifyTimeoutMs,
    validatorTimeoutMs: options.validatorTimeoutMs,
    role: options.role,
    memoryEligibleRoles: options.memoryEligibleRoles,
    now: options.now,
  });
  return { session, closeGate, infraFailure };
}
