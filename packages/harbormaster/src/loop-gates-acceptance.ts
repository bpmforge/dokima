/**
 * loop-gates-acceptance.ts — a ticket's acceptance criteria are run (W21-41).
 *
 * The finding this exists for is the most serious of the wave, and it is not
 * hypothetical: the product shipped it into a password manager.
 *
 * PLAN-vault-002, "Implement Argon2id and AES-256-GCM Wrappers", landed with a
 * signed close receipt. Its one acceptance criterion is a runnable command —
 * `node --test src/crypto/*.spec.ts`. The worktree contains no `.spec.ts`
 * files. The agent wrote no tests, the criterion was never executed, and the
 * gate passed. What landed was `hashPassword()` returning a string containing
 * `Buffer.from(password).toString('base64')` — a reversible encoding of the
 * plaintext password — and `verifyPassword()` returning
 * `hash.startsWith('argon2id')`, which accepts any password for any account.
 * Both docstrings said "(placeholder)".
 *
 * The mechanism was plain once looked at: the ticket's `verify` field was
 * null, so the gate ran its DEFAULT command instead. Acceptance criteria were
 * carried on the ticket, rendered into the handoff, and executed by nothing.
 * They were text. `lint` and `typecheck` pass happily on a placeholder, and
 * the required validators ask about secrets and remotes, not about whether the
 * work does what the ticket said.
 *
 * So this closes the gap from the acceptance side, as the validator set closes
 * it from the other. Two decisions shape it:
 *
 *   - AN EXECUTABLE CRITERION IS RUN, and its exit code goes on the receipt.
 *     Not "should be run" — the whole defect is that a stated, runnable check
 *     existed and nothing ran it.
 *   - A CRITERION THAT IS NOT EXECUTABLE IS NOT COUNTED AS SATISFIED. Prose
 *     criteria are real and most criteria are prose; silently treating them as
 *     met is how a gate reports more assurance than it has. They are reported
 *     as needing a human check, which is what the acceptance card is for.
 *
 * Recognising "executable" is deliberately narrow: the first token must be a
 * known runner. A prose criterion beginning "node" is not a sentence anybody
 * writes, and the cost of the two errors is asymmetric — refusing to run a
 * real command leaves today's behaviour, while running a sentence as a shell
 * command would refuse good work for noise.
 */
import type { VerifyRunResult } from './loop-gates-types.js';
import { reRunVerify, verifyFailureTail } from './loop-gates-verify.js';
import { unfalsifiableCriteria, unfalsifiableReason } from './loop-gates-unfalsifiable.js';

/**
 * First tokens that mean "this line is a command". Extend deliberately: every
 * addition widens what gets executed against a worktree.
 */
const RUNNERS = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx',
  'node', 'deno', 'tsx', 'vitest', 'jest', 'playwright',
  'python', 'python3', 'pytest', 'ruff', 'mypy',
  'go', 'cargo', 'make', 'bash', 'sh',
]);

/**
 * Function words that mean this line is a sentence. A shell one-liner using
 * `for`/`in` is misread as prose and simply not run — which is today's
 * behaviour, and the safe direction of the two errors.
 */
const PROSE_WORDS = new Set([
  'is', 'are', 'was', 'were', 'be', 'been', 'the', 'a', 'an', 'to', 'in',
  'of', 'and', 'or', 'that', 'this', 'must', 'should', 'does', 'do', 'not',
  'with', 'from', 'by', 'it', 'its', 'no', 'never', 'always',
]);

export interface AcceptanceCriterionLike {
  readonly id?: string;
  readonly text: string;
}

export interface AcceptanceRun {
  readonly id: string;
  readonly command: string;
  readonly exitCode: number;
  /** Exited 0 having executed no tests at all — green, and meaningless. */
  readonly ranNothing: boolean;
}

export interface AcceptanceOutcome {
  /** Criteria that were run, with their real exit codes — receipt material. */
  readonly runs: readonly AcceptanceRun[];
  /** Gate reasons, one per failing criterion, naming the criterion and its output. */
  readonly reasons: readonly string[];
  /** Criteria no machine can check, reported rather than counted as met. */
  readonly needsHumanCheck: readonly string[];
}

/**
 * Whether a criterion's text is a command rather than a sentence. Narrow by
 * design — see the module comment on why the two error costs are asymmetric.
 */
export function isExecutableCriterion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const words = trimmed.split(/\s+/);
  if (!RUNNERS.has(words[0]!)) return false;
  // Two prose tells, both found by fixtures rather than reasoned up front.
  // Terminal punctuation on a PLAIN word — checking the punctuation alone
  // rejected `go test ./...`. And English function words standing alone,
  // which caught "node is pinned to 22 in .nvmrc." where the punctuation
  // test did not, because `.nvmrc.` is not a plain word.
  const last = words[words.length - 1]!;
  if (/^[A-Za-z]+[.?!]$/.test(last)) return false;
  return !words.some((word) => PROSE_WORDS.has(word.toLowerCase()));
}

/**
 * A test run that executed NOTHING, which every runner reports as success.
 *
 * Found while writing this chapter's fixture, and it is the larger half of the
 * defect. `node --test 'src/crypto/*.spec.ts'` against a directory with no
 * spec files prints `# tests 0` and exits ZERO. So PLAN-vault-002's criterion
 * would have passed even if the gate had run it: the placeholder password hash
 * would have landed anyway, endorsed by a green check.
 *
 * A criterion that cannot fail is not a check. Zero tests executed is treated
 * as a failure, with the count named, because "0 passed" and "0 failed" is the
 * single most reassuring-looking way for a gate to say nothing at all.
 */
export function ranZeroTests(output: string): boolean {
  return (
    /^#\s*tests\s+0\s*$/m.test(output) ||
    /\bno tests? (ran|found|were found)\b/i.test(output) ||
    /\bNo test files found\b/i.test(output)
  );
}

/** Bounded tail of a failing run, stderr first — the same shape verify uses. */
function failureTail(run: VerifyRunResult, limit = 600): string {
  const text = (run.stderr || run.stdout || '').trim();
  return text.length > limit ? `…${text.slice(-limit)}` : text;
}

/**
 * Runs every executable acceptance criterion in the ticket's worktree, under
 * the same sandbox as `verify` (SC-07 — these are ticket-supplied commands and
 * get no more trust than the verify command does).
 */
export async function runAcceptanceCriteria(
  worktreePath: string,
  criteria: readonly AcceptanceCriterionLike[],
  timeoutMs: number,
): Promise<AcceptanceOutcome> {
  const runs: AcceptanceRun[] = [];
  const reasons: string[] = [];
  const needsHumanCheck: string[] = [];

  for (const [index, criterion] of criteria.entries()) {
    const id = criterion.id ?? `AC-${index + 1}`;
    if (!isExecutableCriterion(criterion.text)) {
      needsHumanCheck.push(id);
      continue;
    }
    const command = criterion.text.trim();
    const run = await reRunVerify(worktreePath, command, timeoutMs);
    const vacuous = run.exitCode === 0 && ranZeroTests(`${run.stdout}\n${run.stderr}`);
    runs.push({ id, command, exitCode: run.exitCode, ranNothing: vacuous });
    if (run.exitCode !== 0) {
      const tail = failureTail(run);
      reasons.push(
        `acceptance criterion ${id} failed: \`${command}\` exited ${run.exitCode}` +
          (tail ? `\n${tail}` : ''),
      );
    } else if (vacuous) {
      reasons.push(
        `acceptance criterion ${id} ran NOTHING: \`${command}\` exited 0 having ` +
          `executed zero tests. A check that cannot fail is not a check — write ` +
          `the tests it names, or correct the command.`,
      );
    }
  }

  return { runs, reasons, needsHumanCheck };
}

/**
 * The sentence the close gate adds when criteria could not be machine-checked.
 * Said out loud rather than omitted: a gate that stays quiet about what it did
 * not check is claiming more than it verified.
 */
export function humanCheckNotice(needsHumanCheck: readonly string[]): string | null {
  if (needsHumanCheck.length === 0) return null;
  return (
    `${needsHumanCheck.length} acceptance criterion/criteria (${needsHumanCheck.join(', ')}) ` +
    `are not executable commands, so no machine checked them — they are for the ` +
    `person accepting this ticket to read.`
  );
}

/**
 * The close gate's two executable checks, together: the ticket's `verify`
 * command and every executable acceptance criterion it states.
 *
 * They belong in one place because they are the same question asked twice —
 * "does this actually work?" — and because separating them is how the second
 * one came to be skipped for the entire life of the product.
 */
export async function runGateChecks(input: {
  readonly worktreePath: string;
  readonly verifyCommand: string;
  readonly claimed: { readonly command: string; readonly exit: number };
  readonly criteria: readonly AcceptanceCriterionLike[];
  readonly timeoutMs: number;
  /** W21-50: for the base probe — a passing criterion that also passes at base proves nothing. */
  readonly repoRoot?: string;
  readonly baseRef?: string;
  readonly ticketId?: string;
}): Promise<{
  readonly verify: VerifyRunResult;
  readonly acceptance: AcceptanceOutcome;
  readonly reasons: readonly string[];
}> {
  const reasons: string[] = [];
  const verify = await reRunVerify(input.worktreePath, input.verifyCommand, input.timeoutMs);
  if (verify.exitCode !== 0) {
    reasons.push(
      `verify re-run failed: \`${input.verifyCommand}\` exited ${verify.exitCode} ` +
        `(manifest claimed \`${input.claimed.command}\` exit ${input.claimed.exit} — never trusted)`,
    );
    // W13-30: and WHAT it said. Bounded and stderr-first — a failing command
    // puts its diagnosis on stderr, and a whole test run would crowd the
    // prompt it is meant to inform.
    const output = verifyFailureTail(verify);
    if (output) reasons.push(output);
  }
  const acceptance = await runAcceptanceCriteria(
    input.worktreePath,
    input.criteria,
    input.timeoutMs,
  );
  reasons.push(...acceptance.reasons);
  // W21-50: only when the criteria PASSED — a failing one is already refusing,
  // and the probe costs a worktree.
  if (input.repoRoot && input.baseRef && input.ticketId) {
    reasons.push(
      ...unfalsifiableReason(
        await unfalsifiableCriteria({
          repoRoot: input.repoRoot,
          ticketId: input.ticketId,
          baseRef: input.baseRef,
          runs: acceptance.runs,
          timeoutMs: input.timeoutMs,
        }),
      ),
    );
  }
  return { verify, acceptance, reasons };
}
