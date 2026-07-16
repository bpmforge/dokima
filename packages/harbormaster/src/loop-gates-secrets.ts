/**
 * Secrets-scan gap classification and R-G2 memory-written checking for the
 * out-of-session close gate (`loop-gates.ts`). Split out per
 * CODE_BOOK_PROTOCOL.md — see `loop-gates-types.ts` for why this is a flat
 * sibling file, not a subdirectory.
 */

import type { ValidatorRunResult } from '@shipwright/validators';
import type {
  CompletionManifest,
  ParsedGapLocation,
  SecretsGateSummary,
} from './loop-gates-types.js';

/**
 * Parses secrets-scan.sh's `gap()` detail format: `"<relfile>:<lineno> —
 * <masked>"`. Matches the line number greedily from the END of the
 * location segment (`/^(.*):(\d+)$/`) so a colon inside the file path
 * itself can't misparse into the wrong file/line split — the guard the
 * shell script's own `${line%%:*}` split (first-colon, not last) doesn't
 * have. Doing this in TypeScript string parsing rather than a second shell
 * re-grep also means there's no `grep | head` pipeline here to race a
 * SIGPIPE on.
 */
export function parseGapLocation(detail: string): ParsedGapLocation | null {
  const [locationPart] = detail.split(' — ');
  if (!locationPart) return null;
  const match = /^(.*):(\d+)$/.exec(locationPart);
  if (!match) return { file: locationPart, line: null };
  return { file: match[1] ?? locationPart, line: Number(match[2]) };
}

/**
 * D-014/L-28 shadow-calibration: `secrets-scan.sh` scans the WHOLE
 * worktree, so it always re-reports every pre-existing fixture/doc
 * self-hit already in the repo (this repo's own baseline: 27, none of
 * them touched by a typical ticket's write_scope) — gating on the raw
 * result would block every close, forever. The calibration is diff-scope:
 * a gap only blocks if its file is one THIS session's own diff touched
 * ("a planted secret in the diff blocks close" — acceptance 4); a
 * pre-existing hit in a file the session never touched is reported (raw
 * count never hidden, D-014 "raw never hidden") but not gating. Known
 * accepted limitation: a ticket that legitimately touches one of those
 * pre-existing files for an unrelated reason will re-surface its
 * untouched-content hit as blocking too — no ticket in this wave's
 * write_scope does that; a content-hash-keyed baseline is the natural
 * follow-up if it becomes an issue.
 *
 * CALLER CONTRACT (the CRITICAL fail-open this ticket exists to close):
 * this function assumes `result` is a genuinely CLEAN 0/1 contract run
 * (exitCode 0 or 1, gaps parsed from real scanner output). It must never
 * be called on an exitCode === 2 result (timeout, spawn error, malformed
 * output, or a contract violation per `runValidator`'s 0/1/2 contract) —
 * `loop-gates.ts`'s `effectiveValidatorResults` short-circuits on exitCode
 * 2 BEFORE reaching this function, so a scanner that crashed or hung is
 * always preserved as a hard failure and never diff-scope-calibrated into
 * a false clean.
 */
export function classifySecretsGaps(
  result: ValidatorRunResult,
  changedPaths: ReadonlySet<string>,
): SecretsGateSummary {
  const effectiveGaps = result.gaps.filter((gap) => {
    const loc = parseGapLocation(gap.detail);
    return loc !== null && changedPaths.has(loc.file);
  });
  return {
    raw: result.gaps.length,
    effective: effectiveGaps.length,
    suppressed: result.gaps.length - effectiveGaps.length,
    effectiveGaps,
  };
}

/** R-G2 (deferred until W7-01 lands): inert unless `role` is passed and listed in `memoryEligibleRoles`. */
export function checkMemoryWritten(
  manifest: CompletionManifest,
  role: string | undefined,
  memoryEligibleRoles: readonly string[],
): string | null {
  if (!role || !memoryEligibleRoles.includes(role)) return null;
  const memoryWritten = (manifest as unknown as { memory_written?: unknown })
    .memory_written;
  if (!Array.isArray(memoryWritten) || memoryWritten.length === 0) {
    return (
      `role "${role}" is memory-eligible but the manifest's memory_written[] is missing ` +
      'or empty (R-G2, once W7-01 lands)'
    );
  }
  return null;
}

export function formatFailureComment(reasons: readonly string[]): string {
  return [
    'close gate refused — no receipt minted (FR-H1, SC-02):',
    ...reasons.map((reason) => `- ${reason}`),
  ].join('\n');
}
