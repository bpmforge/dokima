/**
 * Recovers the ticket id, write_scope and verify command the tool
 * executor needs from an already-rendered HANDOFF block.
 *
 * `SpawnSession` (`@dokima/loop`, out of this ticket's write_scope) is
 * `(input: {prompt, cwd}) => ...` — it carries no structured `Handoff`
 * field, only the rendered text `renderHandoff` produced. `renderHandoff`'s
 * block format is BLUEPRINT §4's "universal choke point", with a stable
 * field order: ROLE and TICKET render BEFORE the free-form CONTEXT field;
 * WRITE-SCOPE, PRODUCE and VERIFY render AFTER it (`packages/loop/src/handoff.ts`).
 *
 * A ticket's CONTEXT can be arbitrary multi-line text (an assembled context
 * packet) and could coincidentally contain a line shaped like one of these
 * fields, so: TICKET is taken as the FIRST match (the real one always
 * precedes CONTEXT); WRITE-SCOPE/VERIFY are taken as the LAST match (the
 * real one always follows CONTEXT). This is a heuristic against
 * `renderHandoff`'s known grammar, not a general parser — a CONTEXT that
 * itself ends with a line shaped like `WRITE-SCOPE: `/`VERIFY: ` would still
 * fool it.
 *
 * KNOWN LIMITATION: `VERIFY:` is rendered through `redactDeep` (secret
 * values replaced with a redaction marker) before this text exists, so a
 * verify command containing a live-credential-shaped literal will not
 * round-trip byte-identical to `ticket.verify`. That is not a correctness
 * problem for the close gate: `runCloseGate` independently re-reads
 * `ticket.verify` and re-runs it itself (SC-02) — this parsed copy only
 * lets the in-session `verify` tool give the model the same signal early,
 * before the gate.
 */

export interface HandoffFields {
  readonly ticketId: string | null;
  readonly writeScope: readonly string[];
  readonly verifyCommand: string | null;
}

function firstMatch(prompt: string, prefix: string): string | null {
  for (const line of prompt.split('\n')) {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
  }
  return null;
}

function lastMatch(prompt: string, prefix: string): string | null {
  let found: string | null = null;
  for (const line of prompt.split('\n')) {
    if (line.startsWith(prefix)) found = line.slice(prefix.length);
  }
  return found;
}

export function parseHandoffFields(prompt: string): HandoffFields {
  const ticketLine = firstMatch(prompt, 'TICKET: ');
  const ticketId = ticketLine ? (ticketLine.split(' ')[0] ?? null) : null;

  const writeScopeLine = lastMatch(prompt, 'WRITE-SCOPE: ');
  const writeScope = writeScopeLine
    ? writeScopeLine
        .split(',')
        .map((glob) => glob.trim())
        .filter((glob) => glob.length > 0)
    : [];

  const verifyCommand = lastMatch(prompt, 'VERIFY: ');

  return { ticketId, writeScope, verifyCommand };
}
