/**
 * The review evidence bundle (W23-03, AB-03) — what the reviewer is actually
 * shown.
 *
 * WHAT WAS WRONG. `reviewPrompt` listed the ticket's acceptance, the FILENAMES
 * from its manifest, its commit shas and the core's verify output, and then
 * asked a model to "judge whether the work satisfies its acceptance criteria".
 * It never showed the model a single line of the code. A reviewer that cannot
 * see the diff can only re-state the gate's own result, which the gate already
 * knows — and every insecure change that passes its tests is invisible to it
 * by construction. The C-4 machinery around it was real; the thing it was
 * protecting was a review of a file list.
 *
 * THE EVIDENCE IS RUNTIME-OWNED. The core resolves the refs, runs git itself
 * with an argument array, and reads the result. No model text reaches a shell:
 * `git` is invoked through `@dokima/git`'s `git()`, which uses `execa` with an
 * args array and no shell at all, and the refs passed to it are shas the core
 * resolved, never strings a session supplied.
 *
 * READING AN UNTRUSTED REPOSITORY IS ITSELF AN ATTACK SURFACE. The worktree
 * being diffed contains code an agent session just wrote. Git will happily run
 * a program named by that repository's own configuration while producing a
 * diff — `diff.external`, a `textconv` filter in `.gitattributes`, a
 * `diff.<driver>.command`. Every read here therefore passes `--no-ext-diff` and
 * `--no-textconv` AND neutralizes the config that would supply them
 * (`-c diff.external=`, `-c core.attributesFile=/dev/null`, `-c core.hooksPath=/dev/null`).
 * A diff is data; producing it must not execute anything.
 *
 * INCOMPLETE IS A STATE, NOT A ROUNDING ERROR. Oversized, dirty and stale
 * evidence each set `complete: false` with a reason. The caller's contract is
 * that an incomplete bundle can never produce a CONFIRMED verdict — a review
 * of a diff that was silently cut in half is worse than no review, because it
 * comes with a verdict attached.
 */

import { createHash } from 'node:crypto';
import { git } from '@dokima/git';
import { redactString } from '@dokima/shared';

/**
 * The diff budget, in characters. Chosen to sit well inside a small local
 * model's context alongside the rest of the prompt, and enforced as a hard
 * limit rather than a truncation point: over it, the bundle is incomplete.
 */
export const REVIEW_DIFF_LIMIT_CHARS = 60_000;

/**
 * Git invocation flags that make reading a repository a pure read. Applied to
 * every command in this module, including `rev-parse` and `status`, so a
 * single call added later cannot be the one that forgets.
 */
const SAFE_READ_FLAGS = [
  '-c',
  'diff.external=',
  '-c',
  'core.attributesFile=/dev/null',
  '-c',
  'core.hooksPath=/dev/null',
];

export interface ReviewEvidenceBundle {
  readonly ticketId: string;
  /** Digest over the head sha and the diff text — what a verdict is bound to. */
  readonly sourceDigest: string;
  readonly headCommit: string | null;
  readonly baseCommit: string | null;
  /** Redacted, and empty when the bundle is incomplete for a reason that makes it meaningless. */
  readonly diff: string;
  readonly files: readonly string[];
  /** False when the reviewer is not looking at the whole, settled truth. */
  readonly complete: boolean;
  /** Why it is incomplete, in a sentence a person can act on. Null when complete. */
  readonly reason: string | null;
}

export interface CollectReviewEvidenceInput {
  readonly ticketId: string;
  /** The ticket's own worktree. Everything is read from here, not from the repo root. */
  readonly worktreePath: string;
  /** The commit the work started from, when the runtime knows it. */
  readonly baseRef?: string | null;
  readonly secretValues?: readonly string[];
  readonly limitChars?: number;
  /** Injected for tests; defaults to the real git CLI. */
  readonly runGit?: (
    cwd: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

function digest(headCommit: string | null, diff: string): string {
  return `sha256:${createHash('sha256')
    .update(`${headCommit ?? 'no-head'}\n${diff}`)
    .digest('hex')}`;
}

function incomplete(
  input: CollectReviewEvidenceInput,
  headCommit: string | null,
  baseCommit: string | null,
  reason: string,
  diff = '',
  files: readonly string[] = [],
): ReviewEvidenceBundle {
  return {
    ticketId: input.ticketId,
    sourceDigest: digest(headCommit, diff),
    headCommit,
    baseCommit,
    diff,
    files,
    complete: false,
    reason,
  };
}

/**
 * Collects the bundle. Never throws for an ordinary git failure — a worktree
 * that is not a repository, a ref that does not resolve, a git that is not
 * installed are all *incomplete evidence*, which is a reviewable state, rather
 * than an exception that would take down a run that has already landed work.
 */
export async function collectReviewEvidence(
  input: CollectReviewEvidenceInput,
): Promise<ReviewEvidenceBundle> {
  const run = input.runGit ?? ((cwd: string, args: string[]) => git(cwd, args));
  const limit = input.limitChars ?? REVIEW_DIFF_LIMIT_CHARS;
  const secrets = input.secretValues ?? [];

  let headCommit: string | null = null;
  let baseCommit: string | null = null;
  try {
    headCommit = (
      await run(input.worktreePath, [...SAFE_READ_FLAGS, 'rev-parse', 'HEAD'])
    ).stdout.trim();
  } catch (err) {
    return incomplete(
      input,
      null,
      null,
      `the ticket's worktree could not be read (${err instanceof Error ? err.message.slice(0, 160) : String(err)}), ` +
        `so no source change could be shown to the reviewer`,
    );
  }

  // DIRTY IS INCOMPLETE, and it is checked BEFORE the diff is taken. A
  // worktree with uncommitted changes has no immutable tree to hash: hashing
  // HEAD and ignoring the working copy would bind a verdict to code that is
  // not the code that ran (IMPLEMENTATION_PLAN §6).
  try {
    const status = (
      await run(input.worktreePath, [...SAFE_READ_FLAGS, 'status', '--porcelain'])
    ).stdout.trim();
    if (status.length > 0) {
      return incomplete(
        input,
        headCommit,
        null,
        `the worktree has uncommitted changes, so there is no settled tree to review; ` +
          `the reviewer would be judging a commit the agent has already edited past`,
      );
    }
  } catch {
    return incomplete(input, headCommit, null, 'the worktree status could not be read');
  }

  // The base: what the runtime says, else the first parent. A ticket whose
  // head is a root commit has no parent and diffs against the empty tree.
  try {
    baseCommit =
      input.baseRef ??
      (
        await run(input.worktreePath, [...SAFE_READ_FLAGS, 'rev-parse', 'HEAD^'])
      ).stdout.trim();
  } catch {
    baseCommit = null;
  }

  const range = baseCommit ? [`${baseCommit}..${headCommit}`] : ['--root', headCommit];
  let raw: string;
  let files: string[];
  try {
    raw = (
      await run(input.worktreePath, [
        ...SAFE_READ_FLAGS,
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        ...range,
      ])
    ).stdout;
    files = (
      await run(input.worktreePath, [
        ...SAFE_READ_FLAGS,
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--name-only',
        ...range,
      ])
    ).stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    return incomplete(
      input,
      headCommit,
      baseCommit,
      `the diff could not be produced (${err instanceof Error ? err.message.slice(0, 160) : String(err)})`,
    );
  }

  // REDACT BEFORE ANYTHING ELSE LOOKS AT IT. The diff goes to a model and its
  // summary goes into an append-only log; a secret that reaches either is
  // permanent (FR-S2, SC-06). Pattern redaction runs even with no registered
  // values, because the thing an agent just committed is exactly where an
  // unregistered credential shows up.
  const diff = redactString(raw, secrets);

  if (diff.length > limit) {
    return incomplete(
      input,
      headCommit,
      baseCommit,
      `the change is ${diff.length} characters, over the ${limit}-character review budget. ` +
        `The reviewer is not being shown a truncated diff and calling it a review; ` +
        `split the ticket or review this one yourself`,
      '',
      files,
    );
  }

  if (diff.trim().length === 0) {
    return incomplete(
      input,
      headCommit,
      baseCommit,
      `the range ${baseCommit ?? '(root)'}..${headCommit} contains no source change at all`,
      '',
      files,
    );
  }

  return {
    ticketId: input.ticketId,
    sourceDigest: digest(headCommit, diff),
    headCommit,
    baseCommit,
    diff,
    files,
    complete: true,
    reason: null,
  };
}

/**
 * Whether the worktree still holds exactly the source that was reviewed.
 *
 * A model turn takes seconds to minutes, and nothing stops the agent session,
 * a person, or a concurrent berth from committing during it. A verdict bound
 * to evidence that has since moved is a verdict about code nobody is going to
 * ship, so the caller re-checks after the model answers and refuses to treat a
 * moved head as confirmable (IMPLEMENTATION_PLAN §6, "snapshot changes after
 * review invalidate it").
 */
export async function evidenceStillCurrent(
  bundle: ReviewEvidenceBundle,
  input: CollectReviewEvidenceInput,
): Promise<boolean> {
  const fresh = await collectReviewEvidence(input);
  return fresh.complete && fresh.sourceDigest === bundle.sourceDigest;
}

/**
 * The evidence section of the reviewer's prompt. A function rather than a
 * string built at the call site so the "incomplete" wording is impossible to
 * omit: a reviewer told nothing about a missing diff will confidently review
 * the absence of one.
 */
export function reviewEvidenceSection(bundle: ReviewEvidenceBundle): string {
  if (!bundle.complete) {
    return [
      `SOURCE CHANGE: NOT AVAILABLE — ${bundle.reason}.`,
      `You are NOT looking at the code. Do not answer CONFIRMED on this evidence;`,
      `UNVERIFIABLE is the honest verdict when the change itself is missing.`,
    ].join('\n');
  }
  return [
    `Source change (${bundle.baseCommit ?? '(root)'}..${bundle.headCommit}), ${bundle.files.length} file(s):`,
    '```diff',
    bundle.diff,
    '```',
  ].join('\n');
}
