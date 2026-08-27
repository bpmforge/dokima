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
import { extractSessionCheckpoint } from './agent-session/session-checkpoint.js';
import type { LandLoopOptions } from './loop-land.js';
import type { AttemptFeedback } from './loop-handoff.js';
import { sameGaps } from './loop-land-infra.js';
import { provisionWorktree } from './worktree-provision.js';
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
        changedPaths: [],
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
  /** W13-29: what the last attempt got wrong, so this one can correct rather than re-roll. */
  feedback?: AttemptFeedback,
): Promise<{
  session: SessionResult;
  closeGate: CloseGateResult | null;
  infraFailure: InfraFailureKind | null;
}> {
  const handoff = await options.buildHandoff(ticket, feedback);
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
  /**
   * W21-74: provision AGAIN, now that the session has run.
   *
   * The pre-session provision (loop-land-ticket.ts) inspects a worktree the
   * agent has not touched yet. For the first ticket of a greenfield project
   * that worktree is empty, so it correctly records `no package.json —
   * nothing to install` and never looks again — and the very next thing the
   * agent does is write the package.json that declares the toolchain its own
   * acceptance criterion needs.
   *
   * Live (Tally, run-mtbtsm2c): provisioned at 17:57:49 with `ran:false`, the
   * agent wrote package.json at 17:58:03 naming typescript, and the close
   * gate refused with `sh: tsc: command not found` on BOTH the verify re-run
   * and `npm run build`. Every new project failed its first ticket this way.
   *
   * That is the exact scenario worktree-provision.ts was written for (W21-12);
   * it was only ever wired to a moment that cannot see it. Running it a second
   * time here is the whole fix — the step self-skips when node_modules already
   * exists, so a worktree that was provisioned before the session pays two
   * stat calls and nothing else.
   *
   * SC-18/D-023 are untouched: this takes no input from the model, the command
   * is still derived from the lockfile (or its absence) on disk, and the skip
   * or install is ledgered exactly as the pre-session one is.
   */
  await provisionWorktree({
    worktreePath: worktree.path,
    log: options.log,
    actorId: options.actorId,
    ticketId: ticket.id,
    ...(options.runId ? { runId: options.runId } : {}),
  });
  const closeGate = await runCloseGate({
    log: options.log,
    actorId: options.actorId,
    projectId: options.projectId,
    runId: options.runId ?? null,
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

/**
 * The gaps a failed attempt produced, in the order a maker should read them.
 *
 * A missing manifest comes FIRST when it happened, because nothing else the
 * session did matters if it never reported: telling a model its scope was
 * wrong when it never returned a manifest points at the wrong fix.
 */
export function gapsFrom(session: SessionResult, closeGate: CloseGateResult | null): string[] {
  const gaps: string[] = [];
  if (!session.manifest) {
    gaps.push(
      'no Completion Manifest was returned — reply with ONLY the JSON object described above',
    );
  }
  for (const violation of session.scopeViolations ?? []) {
    gaps.push(`wrote outside write_scope: ${violation}`);
  }
  if (closeGate && !closeGate.ok) gaps.push(...closeGate.reasons);
  return gaps;
}

/**
 * What this attempt taught us, or that it taught us nothing (W13-29).
 *
 * Returns the feedback the NEXT attempt should carry, or `no_progress` when
 * the gaps are identical to the previous attempt's — BLUEPRINT §3.5 step 5's
 * no-progress kill. Two attempts producing the same gap set are not
 * converging, and spending the rest of the ladder on them costs tokens and
 * delays a park a person has to read.
 */
export function nextFeedback(
  previous: AttemptFeedback | undefined,
  attempt: number,
  session: SessionResult,
  closeGate: CloseGateResult | null,
  /**
   * LADDER MODE ONLY, and only while an attempt remains to be saved.
   * `locked` is DEFINED as looping in place to its FR-L7 convergence ceiling
   * and `token-gated` maps attempts onto rungs, so an early kill would defeat
   * the mode rather than serve it. At the ceiling the ladder's own reason is
   * the true one — relabelling an exhausted ladder would change FR-H1/H2's
   * documented outcome for the commonest failure there is.
   */
  bounds: { readonly mode: string; readonly limit: number },
): { kind: 'continue'; feedback: AttemptFeedback } | { kind: 'no_progress' } {
  const gaps = gapsFrom(session, closeGate);
  const stalled = previous !== undefined && gaps.length > 0 && sameGaps(previous.gaps, gaps);
  if (stalled && bounds.mode === 'ladder' && attempt < bounds.limit) {
    return { kind: 'no_progress' };
  }
  // W17-02: a budget-stopped session leaves a checkpoint; the next attempt
  // continues from it. The worktree's REAL changed paths ride along as
  // ground truth, and a checkpoint claiming completed work the diff does
  // not show is flagged, never believed (C-2).
  const checkpoint = extractSessionCheckpoint(session.output);
  return {
    kind: 'continue',
    feedback: {
      attempt,
      gaps,
      ...(checkpoint
        ? {
            checkpoint: {
              ...checkpoint,
              worktreeChanged: session.changedPaths,
              claimMismatch:
                checkpoint.completed.length > 0 && session.changedPaths.length === 0,
            },
          }
        : {}),
    },
  };
}

