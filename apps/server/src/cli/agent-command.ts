/**
 * agent-command.ts — external agent argv parsing (W12-03), extracted from
 * `run-build.ts` verbatim when W14-02's MCP preload wiring pushed that file
 * over the 400-line CODE_BOOK_PROTOCOL cap. A move, not a rewrite.
 */

/**
 * Splits an external agent command into argv, honouring single and double
 * quotes (W12-03). The previous `.split(' ')` mis-parsed any path or argument
 * containing a space — `/Applications/My Agent/bin/agent --flag` tokenized to
 * `/Applications/My` plus four bogus args, and the operator saw a spawn
 * failure naming a truncated path with nothing explaining why. On macOS,
 * `/Applications` paths with spaces are ordinary, so this was a confusing
 * refusal waiting to happen rather than an exotic case.
 *
 * NOT A SECURITY FIX, and the distinction matters: `createChildProcessSpawn`
 * passes an argv ARRAY to `node:child_process` spawn with no shell, so a
 * split token could never have become a second command. W11-20's
 * `parseAgentRunnerSetting` separately rejects shell metacharacters and caps
 * length, and **that constraint is untouched here** — supporting quotes is
 * not licence to relax it. This function only decides where argument
 * boundaries fall in a string that has already been accepted.
 *
 * A trailing unterminated quote yields the token as typed rather than
 * throwing: the caller's existing empty-command refusal is the honest place
 * for "that isn't a runnable command", and a parse error here would surface
 * as a stack trace instead of a named refusal.
 */
export function tokenizeAgentCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      // An empty quoted string is a real, intentional argument.
      started = true;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}
