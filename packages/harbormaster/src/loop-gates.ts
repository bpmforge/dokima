/**
 * Out-of-session gate execution (BLUEPRINT §3.6/§7 trust boundary, FR-H1,
 * SC-02, F1 split 2/3): a session's Completion Manifest is an untrusted
 * claim (ARCHITECTURE.md §2 — "completion is never a string an agent can
 * type"). `runCloseGate` never trusts it directly: it independently
 * re-derives ground truth from the worktree — real `fs.stat`, a real
 * re-run of the TICKET's OWN verify command (never the manifest's claimed
 * command or exit code — an agent claiming `{command: 'true', exit: 0}`
 * must not sail through), real `git` history — and only mints a close
 * receipt and closes the ticket once every check passes. Any failure
 * produces a `commentTicket` evidence entry and never advances ticket
 * state ("no close receipt => failure comment, never forward progress").
 *
 * The graded entity (the agent session) never grades itself: this module
 * runs entirely after the session process has exited, using only what it
 * independently observes in the worktree — there is no code path here that
 * consults the session's raw text output (no promise-token grep exists to
 * write), only the structurally-parsed manifest, and even that is treated
 * as a set of claims to verify, never as fact.
 *
 * This is the barrel/index for the close-gate "book" (CODE_BOOK_PROTOCOL.md):
 * types live in `loop-gates-types.ts`, worktree/verify/git helpers in
 * `loop-gates-verify.ts`, secrets-scan classification + R-G2 in
 * `loop-gates-secrets.ts`. Flat sibling files, not a `loop-gates/`
 * subdirectory, because this ticket's `write_scope` only grants
 * single-segment `packages/harbormaster/src/loop-gates*` paths.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { checkWriteScope } from '@dokima/git';
import { computeChangedPaths } from '@dokima/loop';
import { loadValidatorPack, runValidatorPack } from '@dokima/validators';
import { agentAuthoredPaths } from './worktree-harness-paths.js';
import { mintReceipt, type ReceiptInputFile } from '@dokima/events';
import { commentTicket } from '@dokima/tickets';
import { closeTicketLedgeringRefusal } from './loop-gates-close.js';
import { humanCheckNotice, runGateChecks } from './loop-gates-acceptance.js';
import { verifyCommandFor } from './verify-command.js';
import {
  DEFAULT_REQUIRED_VALIDATORS,
  DEFAULT_VALIDATOR_TIMEOUT_MS,
  DEFAULT_VERIFY_TIMEOUT_MS,
  type CloseGateOptions,
  type CloseGateResult,
} from './loop-gates-types.js';
import {
  commitsSince,
  filesChangedInRange,
  resolveForkPoint,
} from './loop-gates-verify.js';
import {
  checkMemoryWritten,
  classifySecretsGaps,
  formatFailureComment,
} from './loop-gates-secrets.js';
import { classifyManifestFile, classifyManifestFiles } from './scope.js';

export type {
  CloseGateFailure,
  CloseGateOptions,
  CloseGateResult,
  CloseGateSuccess,
  CompletionManifest,
  SecretsGateSummary,
} from './loop-gates-types.js';
export { DEFAULT_REQUIRED_VALIDATORS } from './loop-gates-types.js';
export { parseGapLocation, classifySecretsGaps } from './loop-gates-secrets.js';

/**
 * R-G2 production default (W7-01 landed): the maker role every ticket
 * session runs under (`loop-handoff.ts`'s own default, `loop-land.ts`'s
 * D-018 default) is memory-eligible by default, so a real close no longer
 * silently accepts an empty `memory_written[]` the way the pre-W7-01
 * inert default (`[]`) did. Still overridable per caller via
 * `CloseGateOptions.memoryEligibleRoles`.
 */
export const DEFAULT_MEMORY_ELIGIBLE_ROLES: readonly string[] = ['coding-agent'];

/**
 * Runs the full out-of-session close gate for one session's manifest
 * (acceptance 1): stat claimed files, re-run the ticket's own verify, a
 * real commit on the ticket branch, diff-scope subset checks (acceptance
 * 2, R-F4), the symmetric write-scope check (W11-13: the real diff/commit
 * set — never the manifest — checked against `ticket.writeScope` via
 * `checkWriteScope`/`HARD_EXCLUSIONS`, `@dokima/git`, so a session that
 * changed more than it declared cannot close regardless of which
 * `SpawnSession` runner produced it), and the required validator pack
 * including secrets-scan (acceptance 4/5) — then and only then mints a
 * close receipt and closes the ticket. Any failure calls `commentTicket`
 * with every reason and returns without touching ticket state otherwise.
 */
export async function runCloseGate(options: CloseGateOptions): Promise<CloseGateResult> {
  const {
    log,
    actorId,
    projectId,
    ticket,
    worktree,
    manifest,
    baseRef,
    contentDir,
    signingKey,
  } = options;
  const requiredValidators = options.requiredValidators ?? DEFAULT_REQUIRED_VALIDATORS;
  const verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const validatorTimeoutMs = options.validatorTimeoutMs ?? DEFAULT_VALIDATOR_TIMEOUT_MS;
  const now = options.now ?? (() => new Date().toISOString());
  const memoryEligibleRoles =
    options.memoryEligibleRoles ?? DEFAULT_MEMORY_ELIGIBLE_ROLES;

  const reasons: string[] = [];

  if (manifest.files.length === 0) {
    reasons.push('manifest declares zero files');
  }

  // SECURITY (W1-07 symlink-escape class): resolved via fs.realpath and
  // re-checked against the worktree's real root BEFORE anything below stats,
  // reads, or hashes a claimed path — a symlink inside the worktree pointing
  // outside it is refused here, never followed.
  const { missing: missingFiles, symlinkEscapes } = await classifyManifestFiles(
    worktree.path,
    manifest.files,
  );
  if (missingFiles.length > 0) {
    reasons.push(
      `claimed file(s) not found on disk in the worktree: ${missingFiles.join(', ')}`,
    );
  }
  if (symlinkEscapes.length > 0) {
    reasons.push(
      'claimed file(s) resolve outside the worktree via a symlink and are refused ' +
        `(symlink-escape, W1-07 class): ${symlinkEscapes.join(', ')}`,
    );
  }

  const criteria = ticket.acceptance ?? [];
  const verifyCommand = await verifyCommandFor(worktree.path, ticket.verify, criteria);
  const { verify, acceptance, reasons: checkReasons } = await runGateChecks({
    worktreePath: worktree.path,
    verifyCommand,
    claimed: { command: manifest.verify.command, exit: manifest.verify.exit },
    criteria,
    timeoutMs: verifyTimeoutMs,
    repoRoot: worktree.repoRoot,
    baseRef,
    ticketId: ticket.id,
  });
  reasons.push(...checkReasons);

  let base = '';
  try {
    base = await resolveForkPoint(worktree.path, baseRef);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reasons.push(
      `could not determine the ticket branch's fork point from baseRef "${baseRef}": ${message}`,
    );
  }

  let commits: string[] = [];
  let changedPaths: readonly string[] = [];
  if (base) {
    commits = await commitsSince(worktree.path, base);
    if (commits.length === 0) {
      reasons.push('no commits found on the ticket branch since its fork point');
    }

    const committedFiles = await filesChangedInRange(worktree.path, base);
    changedPaths = await computeChangedPaths(worktree.path, base);

    const filesOutsideChangedPaths = manifest.files.filter(
      (file) => !changedPaths.includes(file),
    );
    if (filesOutsideChangedPaths.length > 0) {
      reasons.push(
        'manifest.files not observed in the real diff (computeChangedPaths): ' +
          filesOutsideChangedPaths.join(', '),
      );
    }

    const filesNotInCommits = manifest.files.filter(
      (file) => !committedFiles.includes(file),
    );
    if (filesNotInCommits.length > 0) {
      reasons.push(
        'manifest.files not touched by any commit on the ticket branch (uncommitted, or ' +
          `never real): ${filesNotInCommits.join(', ')}`,
      );
    }

    // SYMMETRIC CHECK (W11-13, SC-17): the two checks above only catch a
    // session UNDER-reporting (claiming less than the real diff/commit
    // set contains). Neither ever checks the reverse — that the real
    // diff/commit set stays inside `ticket.writeScope` — so a session
    // that changed more than it declared, but whose manifest is an
    // honest subset of that overreach, sailed through. This runs
    // regardless of which `SpawnSession` implementation produced the
    // session (D-023's escape-hatch `createChildProcessSpawn` has no
    // equivalent guard of its own), because the gate is the one place
    // outside the session that can't be declined (Law 4).
    //
    // Checked against `committedFiles`, deliberately NOT `changedPaths`:
    // by this point `reRunVerify` above (and, further down, the required
    // validator pack) has already executed arbitrary commands with
    // cwd=worktree.path, so the raw working-tree diff — untracked files
    // included — mixes the session's real work with the GATE'S OWN
    // build/telemetry side effects (e.g. a lint cache or a validator's
    // telemetry file neither committed nor necessarily gitignored). Only
    // what actually lands in the ticket branch's real commit history is
    // what a merge ever delivers, so `committedFiles` (`base..HEAD`) is
    // both the correct scope boundary and immune to false positives from
    // the gate's own execution — a check that fails closed forever on a
    // stray uncommitted artifact would be as broken as one that can be
    // bypassed.
    // W21-31: …and harness-committed files are not the agent's — see
    // agentAuthoredPaths for why this check in particular needs it.
    const scopeViolations = await checkWriteScope(
      agentAuthoredPaths(committedFiles),
      ticket.writeScope,
      worktree.path,
    );
    if (scopeViolations.length > 0) {
      reasons.push(
        'real commit set contains path(s) outside ticket.writeScope: ' +
          scopeViolations.map((v) => `${v.path} (${v.reason})`).join(', '),
      );
    }
  }

  const changedPathsSet = new Set(changedPaths);

  let specs: Awaited<ReturnType<typeof loadValidatorPack>> = [];
  try {
    specs = await loadValidatorPack({ contentDir, select: requiredValidators });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reasons.push(`could not load the required validator pack: ${message}`);
  }

  const validatorResults =
    specs.length > 0
      ? await runValidatorPack(specs, {
          cwd: worktree.path,
          timeoutMs: validatorTimeoutMs,
        })
      : [];

  let secretsSummary: ReturnType<typeof classifySecretsGaps> | null = null;
  const effectiveValidatorResults = validatorResults.map((result) => {
    if (result.name !== 'secrets-scan') return result;
    // SECURITY (fail-closed, review-caught CRITICAL): exitCode === 2 means
    // runValidator's 0/1/2 contract could not produce a trustworthy verdict
    // at all (timeout, spawn error, malformed output, or a self-reported
    // contract violation) — its synthetic gap detail is not file:line
    // shaped, so classifySecretsGaps would parse it as "no location match"
    // and silently drop it, reclassifying a scanner that never actually
    // ran clean into exitCode 0. Short-circuit BEFORE the diff-scope
    // calibration so a crashed/timed-out scanner is always preserved as a
    // hard failure — never treated as clean, regardless of changedPaths.
    if (result.exitCode === 2) return result;
    secretsSummary = classifySecretsGaps(result, changedPathsSet);
    return {
      ...result,
      exitCode: secretsSummary.effective > 0 ? 1 : 0,
      gapCount: secretsSummary.effective,
      gaps: secretsSummary.effectiveGaps,
    };
  });

  const failedValidators = effectiveValidatorResults.filter(
    (result) => result.exitCode !== 0,
  );
  if (failedValidators.length > 0) {
    reasons.push(
      'required validator(s) failed: ' +
        failedValidators
          .map(
            (result) =>
              `${result.name} (exit ${result.exitCode}, ${result.gapCount} gap(s))`,
          )
          .join(', '),
    );
  }

  const memoryReason = checkMemoryWritten(manifest, options.role, memoryEligibleRoles);
  if (memoryReason) reasons.push(memoryReason);

  if (reasons.length > 0) {
    const commented = commentTicket(log, {
      ticketId: ticket.id,
      actorId,
      body: formatFailureComment(reasons),
    });
    return { ok: false, ticket: commented, reasons };
  }

  // SECURITY (TOCTOU close, W1-07 class): reRunVerify above executes the
  // TICKET's OWN verify command with cwd=worktree.path — arbitrary code from
  // the untrusted, already-exited session's own commits — which can mutate
  // the worktree (e.g. replace a clean file with a symlink) after the
  // classifyManifestFiles check ran, above. Re-resolve and re-verify every
  // manifest file immediately before it is read for the receipt via
  // classifyManifestFile, which holds a single fd across its own
  // containment check and the read (see scope.ts) — so the escape refusal
  // holds atomically at read time, never separated from the read itself by
  // a re-resolved path string.
  const realRootAtReadTime = await fs.realpath(worktree.path);
  const readTimeMissing: string[] = [];
  const readTimeEscapes: string[] = [];
  const inputFileEntries = await Promise.all(
    manifest.files.map(async (file): Promise<ReceiptInputFile | null> => {
      const result = await classifyManifestFile(worktree.path, realRootAtReadTime, file);
      if (result.status === 'missing') {
        readTimeMissing.push(file);
        return null;
      }
      if (result.status === 'symlink-escape') {
        readTimeEscapes.push(file);
        return null;
      }
      return { path: file, content: result.content as string };
    }),
  );
  if (readTimeMissing.length > 0 || readTimeEscapes.length > 0) {
    const readTimeReasons: string[] = [];
    if (readTimeMissing.length > 0) {
      readTimeReasons.push(
        'claimed file(s) vanished from the worktree between the initial check and the ' +
          `receipt read (TOCTOU): ${readTimeMissing.join(', ')}`,
      );
    }
    if (readTimeEscapes.length > 0) {
      readTimeReasons.push(
        'claimed file(s) resolve outside the worktree via a symlink introduced after the ' +
          'initial check and are refused at receipt-read time (symlink-escape, W1-07 ' +
          `class, TOCTOU): ${readTimeEscapes.join(', ')}`,
      );
    }
    const commented = commentTicket(log, {
      ticketId: ticket.id,
      actorId,
      body: formatFailureComment(readTimeReasons),
    });
    return { ok: false, ticket: commented, reasons: readTimeReasons };
  }
  const inputFiles = inputFileEntries as ReceiptInputFile[];

  const receiptValidators = effectiveValidatorResults.map((result) => ({
    name: result.name,
    exitCode: result.exitCode,
    gapCount: result.gapCount,
  }));

  const receipt = mintReceipt(
    log,
    {
      id: options.id ?? randomUUID(),
      kind: 'close',
      projectId,
      phase: options.phase ?? null,
      ticketId: ticket.id,
      validators: receiptValidators,
      inputFiles,
      verifyCommand,
      verifyExit: verify.exitCode,
      actorId,
      runId: options.runId ?? null,
      payload: {
        commits,
        files: manifest.files,
        evidence: manifest.evidence,
        secretsScan: secretsSummary,
        // W21-41: the ticket's own stated checks and what they actually
        // returned, plus the ones no machine could check — said out loud,
        // because a receipt quiet about what it did not verify claims more
        // than it earned.
        acceptance: acceptance.runs,
        acceptanceNeedsHumanCheck: humanCheckNotice(acceptance.needsHumanCheck),
      },
    },
    { signingKey, now },
  );
  // W21-32: the receipt is minted, so a refusal here orphans it silently.
  const closed = closeTicketLedgeringRefusal(
    log,
    {
      ticketId: ticket.id,
      actorId,
      files: [...manifest.files],
      verify: { command: verifyCommand, exitCode: verify.exitCode },
      commits,
    },
    { now, runId: options.runId ?? null, receiptId: receipt.id },
  );

  return { ok: true, ticket: closed, receipt };
}
