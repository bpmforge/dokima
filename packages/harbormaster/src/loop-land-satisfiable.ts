/**
 * loop-land-satisfiable.ts — a ticket that cannot satisfy itself never runs
 * (W21-43).
 *
 * Run 22 was the first with W21-41's acceptance gate live, and it worked:
 * PLAN-vault-002 was refused twice with "acceptance criterion AC-1 ran
 * NOTHING: `node --test src/crypto/*.spec.ts` exited 0 having executed zero
 * tests". The placeholder password hash did not land.
 *
 * Then the real cause. That ticket's write_scope is exactly three files —
 * `src/crypto/index.ts`, `src/crypto/argon2id.ts`, `src/crypto/aes-gcm.ts`.
 * It does not include `src/crypto/*.spec.ts`. The agent could not create the
 * test files its own acceptance criterion is graded on. It was not failing to
 * comply; it could not comply, and the gate's advice — "write the tests it
 * names" — was advice it had no permission to follow.
 *
 * Both cheaper explanations were checked and eliminated first. The close-gate
 * reasons DO reach the next attempt (`gapsFrom` → `nextFeedback`), so the
 * agent was told, twice. And Node 22 runs a `.spec.ts` directly — a probe spec
 * placed in that worktree executed. Neither the feedback path nor the
 * toolchain was the problem.
 *
 * The product already owns the answer verb: `widen-scope` (W21-27). What it
 * lacked was the moment of noticing. Nothing compared an executable
 * acceptance criterion's paths against write_scope, so an unsatisfiable ticket
 * burned its whole ladder — two sessions, every turn — before a person heard
 * about it. The comparison is free and happens before the first model call.
 *
 * DELIBERATELY CONSERVATIVE. It reports only paths it can extract with
 * confidence: literal-looking path arguments carrying a directory separator or
 * a file extension. A command whose targets it cannot read produces NO finding
 * rather than a guess, because a false refusal blocks real work while a missed
 * one merely leaves today's behaviour.
 */
import { matchesAnyGlob } from '@dokima/git';
import type { AcceptanceCriterionLike } from './loop-gates-acceptance.js';
import { isExecutableCriterion } from './loop-gates-acceptance.js';

/** Tokens that are flags or runner words, never targets. */
function isTarget(token: string): boolean {
  if (token.startsWith('-')) return false;
  if (token.includes('&&') || token.includes('|')) return false;
  return token.includes('/') || /\.[A-Za-z0-9]+$/.test(token);
}

/** Path-ish arguments of a command, in the order they appear. */
export function referencedPaths(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter(isTarget);
}

export interface UnsatisfiableCriterion {
  readonly id: string;
  readonly command: string;
  /** The referenced paths that write_scope does not permit. */
  readonly outsideScope: readonly string[];
}

/**
 * Executable acceptance criteria that reference paths the ticket may not
 * write. Empty when every criterion is satisfiable, or when none is executable.
 */
export function unsatisfiableCriteria(
  criteria: readonly AcceptanceCriterionLike[],
  writeScope: readonly string[],
): UnsatisfiableCriterion[] {
  const found: UnsatisfiableCriterion[] = [];
  for (const [index, criterion] of criteria.entries()) {
    const command = criterion.text.trim();
    if (!isExecutableCriterion(command)) continue;
    const outsideScope = referencedPaths(command).filter(
      (candidate) => !matchesAnyGlob(candidate, [...writeScope]),
    );
    if (outsideScope.length > 0) {
      found.push({ id: criterion.id ?? `AC-${index + 1}`, command, outsideScope });
    }
  }
  return found;
}

/**
 * The founder-facing sentence. Names the paths, names the verb, and says what
 * happens if it is ignored — the shape W21-27's own refusal established.
 */
export function unsatisfiableNotice(
  ticketId: string,
  found: readonly UnsatisfiableCriterion[],
): string {
  const lines = found.map(
    (item) =>
      `  ${item.id}: \`${item.command}\` needs ${item.outsideScope.join(', ')}, ` +
      `which this ticket may not write`,
  );
  return (
    `${ticketId} cannot satisfy its own acceptance as written. Its executable ` +
    `criteria reference paths outside its write_scope:\n${lines.join('\n')}\n` +
    `No attempt was made, because every one of them would fail for this reason ` +
    `and cost a full session to find out. Answer it with:\n` +
    `  dokima widen-scope ${ticketId} --actor <your-id> --add "<glob>" --reason "<why>"`
  );
}

/**
 * A ticket whose gates contradict each other (W21-47).
 *
 * PROVED IN THE WORKTREE, not inferred. PLAN-vault-002 has verify
 * `npm run typecheck` and acceptance AC-1 `node --test src/crypto/*.spec.ts`,
 * and the generated spec imports a sibling module:
 *
 *   without the extension — `node --test` exits 1, ERR_MODULE_NOT_FOUND, so
 *     AC-1 fails;
 *   with `./argon2id.ts` — `tsc --noEmit` exits 1, TS5097, so the ticket's own
 *     verify fails.
 *
 * There is no third option inside the ticket's write_scope: the reconciliation
 * lives in tsconfig.json or package.json, neither of which it may write. Every
 * model that touches it fails one gate or the other, and four runs were spent
 * discovering that — runs 26 and 28 both climbed R1 to R2, both rungs failed
 * identically, and the R0 lesson delivered the exact error to the next attempt
 * and changed nothing. No amount of instruction fixes a contradiction.
 *
 * W21-43 (above) cannot see this and correctly so: it compares an acceptance
 * command's referenced PATHS against write_scope, and here the paths are fine.
 * The contradiction is between two commands' toolchain requirements, which is
 * not decidable statically.
 *
 * THE DETECTABLE VERSION IS EMPIRICAL, and the ladder supplies it. A gate
 * reason that repeats on two DIFFERENT rungs has already had "wrong model"
 * ruled out by the product's own escalation — that is exactly what climbing a
 * rung tests. What remains is a property of the ticket, which is a founder
 * decision.
 *
 * ACCEPTANCE 3 IS THE CONSTRAINT THAT SHAPES IT: a ticket failing for a reason
 * a bigger model plausibly fixes must NOT be surfaced, or this steals the
 * ladder's job. So it requires the SAME reason on DIFFERENT rungs — different
 * reasons mean the ladder is still learning something, and one rung failing
 * twice means nothing has been ruled out yet.
 */
export interface ContradictoryGate {
  /** The gate reason that repeated, verbatim. */
  readonly reason: string;
  /** The distinct rung labels that produced it — at least two. */
  readonly models: readonly string[];
}

export interface RungGateAttempt {
  /** The composing seam's label for what ran this attempt (W16-01). */
  readonly sessionLabel?: string | undefined;
  /** The close gate's reasons, when it ran and refused. */
  readonly reasons: readonly string[];
}

export function contradictoryGates(
  attempts: readonly RungGateAttempt[],
): ContradictoryGate[] {
  /** reason -> the distinct labels that produced it. */
  const byReason = new Map<string, Set<string>>();
  for (const attempt of attempts) {
    const label = attempt.sessionLabel;
    // No label means no rung seam, so "a different model tried it" cannot be
    // established — and without that the finding would be exactly the
    // one-rung-twice case acceptance 3 excludes.
    if (label === undefined || label === '') continue;
    for (const reason of attempt.reasons) {
      const labels = byReason.get(reason) ?? new Set<string>();
      labels.add(label);
      byReason.set(reason, labels);
    }
  }
  return [...byReason]
    .filter(([, labels]) => labels.size >= 2)
    .map(([reason, labels]) => ({ reason, models: [...labels].sort() }));
}

/**
 * The founder-facing sentence. Names what each gate demanded, so the person
 * can see the contradiction without reproducing it (acceptance 2).
 */
export function contradictoryGateNotice(
  found: readonly ContradictoryGate[],
): string | null {
  if (found.length === 0) return null;
  const lines = found.map((item) => `  - ${item.reason}`);
  const models = [...new Set(found.flatMap((f) => f.models))].sort();
  return (
    `This ticket failed the SAME gate on ${models.length} different rungs ` +
    `(${models.join(', ')}). Escalating rung tests whether a stronger model ` +
    `fixes it, and that has now been ruled out — what is left is a property of ` +
    `the ticket, not of the model. What failed identically each time:\n` +
    `${lines.join('\n')}\n` +
    `If its verify command and its acceptance criteria demand different things ` +
    `from the same toolchain, no model can satisfy both: change one of them, or ` +
    `widen the scope to include the file that reconciles them.`
  );
}
