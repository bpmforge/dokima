/**
 * The packaged CLI's last line of defence (W22-01, lesson L-48).
 *
 * `bootstrap/main.ts` caught every unhandled error with `console.error(err)`,
 * which prints an Error object with its stack. Three tickets in one session
 * were spent teaching one more error type to one more handler so it would not
 * reach here: a `LaneScopeError` escaping `reportVerbError` (W21-81), a native
 * `parseArgs` TypeError escaping `runCli` (W21-91), a `SqliteError` escaping
 * both (W21-99). Each arrived as a node stack trace, which a person reasonably
 * reads as "the product broke" rather than "you gave me a path that does not
 * exist".
 *
 * Three instances is a class, so the DEFAULT flips: a refusal line naming what
 * failed, with the stack one env var away. A fourth error type then needs no
 * fourth ticket.
 *
 * NOT A BLANKET SWALLOW. A stack is the right output for a genuine bug, so it
 * stays reachable and the refusal line SAYS so — hiding it outright would
 * trade a confusing output for an undiagnosable one, the same trade
 * `describeCause` (gateway/providers/errors.ts) was written to undo. And an
 * error carrying no usable message is reported as unexpected rather than
 * dressed up as a refusal, because calling a crash a refusal is its own lie.
 *
 * The stderr sink is a PARAMETER, matching the `io.stderr` idiom the CLI uses
 * everywhere else, so this is testable without stubbing a global.
 */

/** Env var that restores the raw stack. Named here so tests and copy agree. */
export const STACK_ENV_VAR = 'DOKIMA_STACK';

export function reportFatal(
  err: unknown,
  stderr: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env[STACK_ENV_VAR] === '1') {
    stderr(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return;
  }

  const message = err instanceof Error ? err.message.trim() : String(err).trim();
  if (message.length === 0) {
    const kind = err instanceof Error ? err.name : typeof err;
    stderr(
      `dokima failed with an error carrying no message (${kind}). ` +
        `Re-run with ${STACK_ENV_VAR}=1 to see where.`,
    );
    return;
  }

  stderr(`refused: ${message}`);
  stderr(`  (re-run with ${STACK_ENV_VAR}=1 for the full stack)`);
}
