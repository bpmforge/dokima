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
