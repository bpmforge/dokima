/**
 * Out-of-session gate execution (BLUEPRINT §3.6/§7 trust boundary, FR-H1,
 * SC-02, F1 split 2/3): a session's Completion Manifest is an untrusted
 * claim (ARCHITECTURE.md §2 — "completion is never a string an agent can
 * type"). `runCloseGate` never trusts it directly: it independently
 * re-derives ground truth from the worktree — real `fs.stat`, a real
 * re-run of the TICKET's OWN verify command (never the manifest's claimed
 * command or exit code — an agent claiming `{command: 'true', exit: 0}`
 * must not sail through), real `git` history — and only mints a close
 * receipt and calls `closeTicket` once every check passes. Any failure
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
import { computeChangedPaths } from '@shipwright/loop';
import { loadValidatorPack, runValidatorPack } from '@shipwright/validators';
import { mintReceipt, type ReceiptInputFile } from '@shipwright/events';
import { closeTicket, commentTicket } from '@shipwright/tickets';
import { DEFAULT_VERIFY_COMMAND } from './loop-handoff.js';
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
  reRunVerify,
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
 * 2, R-F4), and the required validator pack including secrets-scan
 * (acceptance 4/5) — then and only then mints a close receipt and calls
 * `closeTicket`. Any failure calls `commentTicket` with every reason and
 * returns without touching ticket state otherwise.
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

  const verifyCommand = ticket.verify ?? DEFAULT_VERIFY_COMMAND;
  const verify = await reRunVerify(worktree.path, verifyCommand, verifyTimeoutMs);
  if (verify.exitCode !== 0) {
    reasons.push(
      `verify re-run failed: \`${verifyCommand}\` exited ${verify.exitCode} (manifest claimed ` +
        `\`${manifest.verify.command}\` exit ${manifest.verify.exit} — never trusted)`,
    );
  }

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
      payload: {
        commits,
        files: manifest.files,
        evidence: manifest.evidence,
        secretsScan: secretsSummary,
      },
    },
    { signingKey, now },
  );

  const closed = closeTicket(
    log,
    {
      ticketId: ticket.id,
      actorId,
      files: [...manifest.files],
      verify: { command: verifyCommand, exitCode: verify.exitCode },
      commits,
    },
    { now },
  );

  return { ok: true, ticket: closed, receipt };
}
