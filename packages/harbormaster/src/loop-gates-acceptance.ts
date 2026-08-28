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
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VerifyRunResult } from './loop-gates-types.js';
import { scopeBlockedNotice } from './loop-gates-scope-blocked.js';
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

/**
 * A package script that cannot fail (W21-87).
 *
 * `ranZeroTests` above catches a run that executed nothing, which is how an
 * HONEST runner reports emptiness. It cannot catch a script that PRINTS a pass
 * and exits 0, because such a script produces none of those strings. LIVE, on
 * Tally's first ticket to reach a receipt: package.json shipped
 * `"test": "echo 'Tests passed' || true"`, and the minted receipt records
 * verify as `npm run lint && npm run typecheck && npm run test` exit 0. The
 * receipt rests partly on a command that cannot fail.
 *
 * The provenance matters and is not the agent's fault alone: the agent wrote
 * that script to satisfy `pnpm test`, a command W21-75 was wrongly imposing on
 * an npm project. The product created the pressure that produced the lie and
 * then recorded the lie as evidence.
 *
 * THIS IS NOT A GENERAL LYING-SCRIPT DETECTOR — that is undecidable. It
 * recognises only the obvious no-op shapes: a body made entirely of `echo`,
 * `true`, `:` and `exit 0` joined by `;`, `&&` or `||`. A real runner is
 * untouched, and anything ambiguous is left alone, because the cost of the two
 * errors is asymmetric — a missed no-op is today's behaviour, while refusing a
 * real command would fail good work.
 */
export function isNoOpScriptBody(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  const segments = trimmed
    .split(/\|\||&&|;/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (segments.length === 0) return true;
  return segments.every((segment) => {
    if (/^:$/.test(segment)) return true;
    if (/^true$/.test(segment)) return true;
    if (/^exit\s+0$/.test(segment)) return true;
    // `echo` with any argument, quoted or not — the printed text is the lie.
    if (/^echo\b/.test(segment)) return true;
    return false;
  });
}

/** The `<runner> run <script>` names a verify command invokes, in order. */
function scriptsInvokedBy(command: string): string[] {
  const names: string[] = [];
  const pattern = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g;
  let match = pattern.exec(command);
  while (match) {
    const name = match[1];
    if (name && name !== 'run' && !names.includes(name)) names.push(name);
    match = pattern.exec(command);
  }
  return names;
}

/**
 * Every script the verify command runs whose package.json body cannot fail.
 *
 * Reads the manifest the gate already has on disk; runs nothing. A worktree
 * with no manifest, or an unreadable one, yields nothing — absence of evidence
 * is not evidence of a lie.
 */
export async function noOpVerifyScripts(
  worktreePath: string,
  command: string,
): Promise<{ readonly name: string; readonly body: string }[]> {
  let manifest: Record<string, unknown> | null = null;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(worktreePath, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    return [];
  }
  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  const found: { name: string; body: string }[] = [];
  for (const name of scriptsInvokedBy(command)) {
    const body = scripts[name];
    if (typeof body === 'string' && isNoOpScriptBody(body)) found.push({ name, body });
  }
  return found;
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
  /** W21-80: to tell an unwinnable ticket from one with work left. */
  readonly writeScope?: readonly string[];
}): Promise<{
  readonly verify: VerifyRunResult;
  readonly acceptance: AcceptanceOutcome;
  readonly reasons: readonly string[];
}> {
  const reasons: string[] = [];
  const verify = await reRunVerify(input.worktreePath, input.verifyCommand, input.timeoutMs);
  /**
   * W21-87: the verify re-run gets the SAME vacuity check the acceptance
   * criteria have had since W21-41. It did not have one — `runGateChecks`
   * tested `run.ranNothing` for every criterion and only `exitCode !== 0` for
   * verify, so the one command the manifest is judged against got the weaker
   * check. Both shapes are covered: a run that executed nothing, and a package
   * script that prints a pass without running anything.
   */
  const verifyRanNothing =
    verify.exitCode === 0 && ranZeroTests(`${verify.stdout}\n${verify.stderr}`);
  // Not gated on the exit code: this reads the manifest and runs nothing, and
  // a fake test script is worth naming whether or not something else failed.
  const noOpScripts = await noOpVerifyScripts(input.worktreePath, input.verifyCommand);
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
  } else if (verifyRanNothing) {
    reasons.push(
      `verify ran NOTHING: \`${input.verifyCommand}\` exited 0 having executed zero ` +
        `tests. A check that cannot fail is not a check — write the tests it names, ` +
        `or correct the command.`,
    );
  }
  // Named, never opaque: the refusal says WHICH script and what its body is,
  // because the fix is to write that script, and a ticket failed without
  // naming it would send a maker looking in the wrong place. It is reported
  // even when verify already failed for another reason — a fake test script
  // stays fake, and the next attempt should know.
  for (const script of noOpScripts) {
    reasons.push(
      `verify component \`${script.name}\` cannot fail: package.json runs it as ` +
        `\`${script.body}\`, a script that reports success without running anything. ` +
        `The receipt would rest on it. Give \`${script.name}\` a real runner, or drop ` +
        `it from the verify command so the gate stops claiming it was checked.`,
    );
  }
  const acceptance = await runAcceptanceCriteria(
    input.worktreePath,
    input.criteria,
    input.timeoutMs,
  );
  reasons.push(...acceptance.reasons);
  /**
   * W21-80: advisory only — never changes the verdict, because the extraction
   * is a heuristic over compiler output and a heuristic must not fail a
   * ticket. Read from output the gate already captured; runs no command.
   */
  if (input.writeScope && reasons.length > 0) {
    const notice = scopeBlockedNotice({
      command: input.verifyCommand,
      output: `${verify.stdout}\n${verify.stderr}\n${reasons.join('\n')}`,
      writeScope: input.writeScope,
      worktreePath: input.worktreePath,
    });
    if (notice) reasons.push(notice);
  }
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
