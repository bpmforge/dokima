/**
 * loop-gates-verify-unrunnable.ts — a verify that ran nothing, and whose fix
 * the ticket is not allowed to make (W23-30).
 *
 * A chapter of loop-gates-acceptance.ts, which sits at the 400-line
 * CODE_BOOK_PROTOCOL cap; the seam is real: that file decides whether a
 * ticket's checks passed, this one decides WHO can fix a check that cannot
 * run.
 */
import { matchesAnyGlob } from '@dokima/shared';

/**
 * W23-30: a verify command that runs nothing is usually not the TICKET's
 * defect. Live (Vault, 2026-09-18): package.json's `test` was bare
 * `node --test`, whose default discovery ignores the project's *.spec.ts
 * files, so `npm run test` exited 0 having run nothing — and package.json was
 * in no ticket's write_scope, so both tickets on the board parked after two
 * full ladders each, rediscovering one fact. The refusal now says WHERE the
 * command lives and whether this ticket is even allowed to change it; a
 * stable marker lets the loop park once and stop claiming siblings.
 */
export const UNRUNNABLE_VERIFY_MARKER = 'UNRUNNABLE VERIFY (board-level)';

/** The file the verify command is defined in, when it is a package script. */
export function verifyCommandFile(verifyCommand: string): string | null {
  return /^(npm|pnpm|yarn)\s+(run\s+)?[a-z:_-]+/i.test(verifyCommand)
    ? 'package.json'
    : null;
}

/**
 * The board-level sentence for a verify that ran nothing, or null when the
 * ticket itself can fix the command (its own `verify` field, or a
 * package.json inside its write_scope).
 */
export function unrunnableVerifyReason(
  verifyCommand: string,
  writeScope: readonly string[] | undefined,
): string | null {
  const file = verifyCommandFile(verifyCommand);
  if (!file) return null;
  if (!writeScope || matchesAnyGlob(file, [...writeScope])) return null;
  return (
    `${UNRUNNABLE_VERIFY_MARKER}: the command comes from ${file}'s scripts, and ` +
    `${file} is outside this ticket's write_scope — no attempt on this ticket can change it. ` +
    `Correct the script on the board (a ticket whose write_scope includes ${file}) before retrying ` +
    `any ticket that verifies with it.`
  );
}

/** Whether a close-gate refusal carries the board-level verify sentence, and its text. */
export function unrunnableVerifyIn(reasons: readonly string[]): string | null {
  return reasons.find((r) => r.startsWith(UNRUNNABLE_VERIFY_MARKER)) ?? null;
}
