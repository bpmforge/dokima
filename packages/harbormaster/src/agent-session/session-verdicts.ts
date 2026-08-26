import { checkWriteScope } from '@dokima/git';
import {
  computeChangedPaths,
  type SpawnSessionOutput,
  type ValidatorResult,
} from '@dokima/loop';

/**
 * session-verdicts.ts — reading what a session actually DID.
 *
 * Chapter of `gateway-session.ts`, split at the 400-line CODE_BOOK_PROTOCOL
 * cap (W13-43). The seam is real: both functions here answer "what does the
 * evidence say happened", against the real worktree diff and against a tool's
 * own reported result — never against the model's claims about either. What
 * they were extracted from is the turn loop that produces that evidence.
 */

/**
 * W21-23: evidence that dumps thousands of paths is not evidence.
 *
 * A single provisioning install once put several thousand `node_modules/...`
 * entries into a park comment, and the one line that mattered was
 * unfindable. The count is what a person needs first; a readable handful of
 * examples is what they need second. Everything after that is volume.
 */
const MAX_LISTED_VIOLATIONS = 12;

function summariseViolations(
  violations: readonly { path: string; reason: string }[],
): string {
  const shown = violations
    .slice(0, MAX_LISTED_VIOLATIONS)
    .map((v) => `${v.path} (${v.reason})`)
    .join(', ');
  if (violations.length <= MAX_LISTED_VIOLATIONS) return shown;
  return `${violations.length} paths, first ${MAX_LISTED_VIOLATIONS}: ${shown}, …`;
}

/**
 * SC-01's own real check (see module header), run once the tool loop has
 * genuinely ended. `changedPaths` is the REAL worktree diff against `HEAD`
 * (tracked + untracked, exactly what canonical SC-01 diffs) — never the
 * model's claims. Returns a refusal `SpawnSessionOutput` (no manifest text,
 * non-zero exit, same shape the iteration/cost-cap stops already use) when
 * any changed path fails `checkWriteScope`; `null` when the diff is clean.
 */
export async function refuseIfSessionExceededScope(
  cwd: string,
  writeScope: readonly string[],
): Promise<SpawnSessionOutput | null> {
  const changedPaths = await computeChangedPaths(cwd, 'HEAD');
  const violations = await checkWriteScope([...changedPaths], [...writeScope], cwd);
  if (violations.length === 0) return null;
  return {
    stdout: '',
    stderr:
      'agent session refused (SC-01, out-of-session — this runs regardless of the ' +
      'tool-boundary pre-check): the real worktree diff contains path(s) outside ' +
      `write_scope after the tool loop ended — ${summariseViolations(violations)}. ` +
      'Session output discarded; no Completion Manifest was produced.',
    exitCode: 1,
  };
}
export function parseVerifyResult(
  resultText: string,
  verifyCommand: string,
): ValidatorResult | null {
  const start = resultText.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed: unknown = JSON.parse(resultText.slice(start));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const exitCode = (parsed as { exitCode?: unknown }).exitCode;
    if (typeof exitCode !== 'number') return null;
    return {
      name: verifyCommand,
      exitCode,
      // The verify tool reports a command result, not a gap-counting
      // validator, so a non-zero exit IS the single gap. Inventing a
      // finer count from stdout would be fabrication.
      gapCount: exitCode === 0 ? 0 : 1,
    };
  } catch {
    return null;
  }
}