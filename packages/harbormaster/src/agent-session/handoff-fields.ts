/**
 * Recovers the ticket id the tool executor needs from an already-rendered
 * HANDOFF block. THIS IS THE ONLY FIELD THIS MODULE STILL PARSES (W11-22):
 * `write_scope` (W11-03) and `verifyCommand` (W11-22) both moved to the
 * authoritative ticket record instead, looked up via `getTicket` in
 * `gateway-session.ts` once the ticket id below resolves it — see that
 * module's PROVENANCE header for why session-influenced prompt text can
 * never be the source of either decision under C-2/C-3.
 *
 * `SpawnSession` (`@dokima/loop`, out of this ticket's write_scope) is
 * `(input: {prompt, cwd}) => ...` — it carries no structured `Handoff`
 * field, only the rendered text `renderHandoff` produced. `renderHandoff`'s
 * block format is BLUEPRINT §4's "universal choke point", with TICKET
 * rendered BEFORE the free-form CONTEXT field
 * (`packages/loop/src/handoff.ts`) — the ticket id is taken as the FIRST
 * `TICKET: ` match, so a CONTEXT that itself contains a lookalike
 * `TICKET: ` line (a file the session read, BLUEPRINT §7) can never win:
 * the real one always precedes it.
 *
 * WHY A PARSED TICKET ID IS STILL SAFE (acceptance 4, W11-22): it feeds
 * exactly one decision — which ticket record `getTicket` looks up — and
 * that decision's blast radius is bounded on both sides. A resolvable id
 * can only select a REAL ticket's own `writeScope`/`verify`, never a value
 * the prompt itself supplied; an unresolvable id (parse failure, or a
 * ticket the log has no record of) fails CLOSED — `gateway-session.ts`
 * treats a missing ticket as `writeScope: []` and
 * `verifyCommand: DEFAULT_VERIFY_COMMAND`. Nothing else is parsed from the
 * prompt any more, so there is no second field here for a future change to
 * assume was always safe and re-widen back into a decision.
 */

export interface HandoffFields {
  readonly ticketId: string | null;
}

function firstMatch(prompt: string, prefix: string): string | null {
  for (const line of prompt.split('\n')) {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
  }
  return null;
}

export function parseHandoffFields(prompt: string): HandoffFields {
  const ticketLine = firstMatch(prompt, 'TICKET: ');
  const ticketId = ticketLine ? (ticketLine.split(' ')[0] ?? null) : null;
  return { ticketId };
}
