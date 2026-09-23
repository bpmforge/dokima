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
import {
  repeatedZeroInformationCalls,
  repetitionHandoffNote,
} from './loop-land-repetition.js';
import { runCloseGate, type CloseGateResult } from './loop-gates.js';
import { DEFAULT_VERIFY_TIMEOUT_MS } from './loop-gates-types.js';
import {
  derivedManifestNotice,
  hasCommitsSinceBase,
} from './loop-land-session-derive.js';
import { extractSessionCheckpoint } from './agent-session/session-checkpoint.js';
import type { LandLoopOptions } from './loop-land.js';
import type { AttemptFeedback } from './loop-handoff.js';
import { sameGaps } from './loop-land-infra.js';
import { provisionWorktree } from './worktree-provision.js';
import {
  deriveManifest,
  NOTHING_TO_REPORT,
  silentCompletion,
  silentCompletionGap,
  type SilentCompletion,
} from './loop-land-session-acceptance.js';
import { commentTicket } from '@dokima/tickets';
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
  /** W21-83: the work was finished and never reported. */
  silent: SilentCompletion;
}> {
  const built = await options.buildHandoff(ticket, feedback);
  // W21-69: the run knows what earlier sessions already asked; hand it over.
  // Appended to `context` for the same reason `withFeedback` appends there —
  // the ticket's own interface is still the thing being built.
  const repetition = repetitionHandoffNote(
    repeatedZeroInformationCalls({ log: options.log, ticketId: ticket.id }),
  );
  const handoff = repetition
    ? { ...built, context: `${built.context}\n\n${repetition}` }
    : built;
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
    /**
     * NOT infra when `infraFailure` is null: answering without a manifest fails
     * the contract and keeps costing an attempt. W21-83: but ask whether it
     * finished anyway, provisioning first so the criteria have a toolchain.
     * W23-41: an infra failure is ASKED too. The early return W21-83 put here
     * ("an endpoint that died tells you nothing about the session") predated
     * W23-35 and hid its derive path: live 2026-09-22 the fix was committed,
     * its criterion passed, the 900 s request timeout fired, and the harness
     * retried over finished work. The argument does not apply to deriving —
     * silentCompletion is evidence about the WORKTREE, and the gate re-derives
     * everything from git; neither reads the session. Deriving only ADDS an
     * outcome: no commits or a declined derive return exactly as before (free
     * retry, W13-27, and no criteria run over an untouched worktree); a gate
     * that accepts clears `infraFailure` and lands; a gate that refuses keeps
     * it, so the attempt still costs nothing.
     */
    if (infraFailure && !(await hasCommitsSinceBase(worktree.path, baseRef)))
      return { session, closeGate: null, infraFailure, silent: NOTHING_TO_REPORT };
    await provisionWorktree({
      worktreePath: worktree.path,
      log: options.log,
      actorId: options.actorId,
      ticketId: ticket.id,
      ...(options.runId ? { runId: options.runId } : {}),
    });
    const timeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
    const silent = await silentCompletion({
      worktreePath: worktree.path,
      criteria: ticket.acceptance ?? [],
      timeoutMs,
    });
    /**
     * W23-35: AND IF IT IS DONE, REPORT IT FOR IT — ON THIS ATTEMPT.
     *
     * W21-83 told the next attempt "your criteria already pass; return the
     * manifest". The Vault runs of 2026-09-18 followed that instruction on
     * neither rung: a 27B model deliberating in 24k-token turns exhausts its
     * leash again, and the ticket parks with the work committed, the criteria
     * passing, and the close gate never run — 181k completion tokens to land
     * nothing the gate would have accepted.
     *
     * So the harness derives the claim from git and submits it to the SAME
     * close gate, unmodified. The manifest was never what the gate trusted
     * (Law 4): it re-runs the ticket's own verify, re-runs every criterion,
     * stats every claimed file, and checks the claim against the real diff and
     * commit set in both directions. A derived claim is checked identically,
     * and a derived claim that does not hold up is refused identically.
     *
     * `session.manifest` stays NULL. It is the record of what the AGENT
     * returned, and overwriting it would erase the very distinction the
     * derivation has to preserve.
     */
    const derived = await deriveManifest({
      worktreePath: worktree.path,
      ticketId: ticket.id,
      ticketVerify: ticket.verify,
      criteria: ticket.acceptance ?? [],
      baseRef,
      found: silent,
      timeoutMs,
    });
    // W23-41: the infra path's accounting is byte-identical to before.
    if (!derived)
      return {
        session,
        closeGate: null,
        infraFailure,
        silent: infraFailure ? NOTHING_TO_REPORT : silent,
      };
    // The ticket's own history says so before the gate runs, so the derivation
    // is legible whether the gate then accepts or refuses (acceptance 2).
    commentTicket(
      options.log,
      {
        ticketId: ticket.id,
        actorId: options.actorId,
        body: derivedManifestNotice(derived.files, derived.commits, infraFailure),
      },
      { runId: options.runId ?? null, ...(options.now ? { now: options.now } : {}) },
    );
    const derivedGate = await runCloseGate({
      log: options.log,
      actorId: options.actorId,
      projectId: options.projectId,
      runId: options.runId ?? null,
      ticket,
      worktree,
      manifest: derived,
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
    // W23-41: a land clears the flag (no free retry over in_review work).
    return {
      session,
      closeGate: derivedGate,
      infraFailure: derivedGate.ok ? null : infraFailure,
      silent,
    };
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
  return { session, closeGate, infraFailure, silent: NOTHING_TO_REPORT };
}

/**
 * The gaps a failed attempt produced, in the order a maker should read them.
 *
 * A missing manifest comes FIRST when it happened, because nothing else the
 * session did matters if it never reported: telling a model its scope was
 * wrong when it never returned a manifest points at the wrong fix.
 */
export function gapsFrom(
  session: SessionResult,
  closeGate: CloseGateResult | null,
  silent: SilentCompletion = NOTHING_TO_REPORT,
): string[] {
  const gaps: string[] = [];
  /**
   * W23-35: a derived manifest reaching the gate is signalled by `closeGate`
   * being non-null while `session.manifest` is null — the only way that pair
   * can occur. When it happened, "no Completion Manifest was returned" is no
   * longer the gap: the harness returned one for it and the gate judged the
   * work. Whatever the gate then said is the truth about this attempt, and
   * saying "your criteria already pass, just report" on top of a gate refusal
   * would tell the next maker to re-report work the gate has just rejected.
   *
   * This is where acceptance 4 lands: the "THE WORK IS ALREADY DONE THOUGH"
   * line is retired exactly where the derived path applies, and kept where it
   * does not — no fork point, no commits, nothing on disk, or a verify the
   * harness re-ran and watched fail.
   */
  if (!session.manifest && closeGate === null) {
    gaps.push(
      silentCompletionGap(silent) ??
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
  /** W21-83: so the next attempt is told the work is already done. */
  silent: SilentCompletion = NOTHING_TO_REPORT,
): { kind: 'continue'; feedback: AttemptFeedback } | { kind: 'no_progress' } {
  const gaps = gapsFrom(session, closeGate, silent);
  const stalled =
    previous !== undefined && gaps.length > 0 && sameGaps(previous.gaps, gaps);
  if (stalled && bounds.mode === 'ladder' && attempt < bounds.limit) {
    return { kind: 'no_progress' };
  }
  // W17-02: a budget-stopped session leaves a checkpoint; the next attempt
  // continues from it. The worktree's REAL changed paths ride along as
  // ground truth, and a checkpoint claiming completed work the diff does
  // not show is flagged, never believed (C-2).
  const checkpoint = extractSessionCheckpoint(session.output);
  /**
   * W21-73: the last REAL gate output, carried across attempts that never
   * reached the gate. An attempt that ran it supplies fresh evidence; one that
   * was budget-stopped keeps its predecessor's, because that output is still
   * the most recent thing actually observed about this ticket.
   */
  const gateEvidence =
    closeGate && !closeGate.ok ? closeGate.reasons : previous?.gateEvidence;
  return {
    kind: 'continue',
    feedback: {
      attempt,
      gaps,
      ...(gateEvidence && gateEvidence.length > 0 ? { gateEvidence } : {}),
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
