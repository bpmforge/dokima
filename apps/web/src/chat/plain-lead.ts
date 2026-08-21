/**
 * W19-07: the plain-language first line of a finding card.
 *
 * Finding cards led with the mechanism ("exitCode=1 no completion manifest
 * returned — agent session stopped: exceeded the per-session tool-iteration
 * budget (12)…") — true, and unreadable as a first contact. Each recognised
 * mechanical shape gets one human sentence that names the next action; the
 * verbatim evidence stays below, untouched. An UNRECOGNISED finding gets no
 * lead at all — summarising text we don't understand would be a paraphrase
 * pretending to be a translation (C-1).
 */
const LEADS: readonly { match: RegExp; lead: string }[] = [
  {
    match: /tool-iteration budget|completion manifest/i,
    lead:
      'The agent ran out of its turn budget before finishing. If the work was real, ' +
      'raise the turn budget (the Runs & Forge tab in Settings) or use the park card’s one-click retry.',
  },
  {
    match: /ladder.*(cap|exhausted)|ladder_exhausted/i,
    lead:
      'Every attempt on the escalation ladder was used without a finished result — ' +
      'the ticket is parked with its evidence.',
  },
  {
    match: /verify failed|tests? fail/i,
    lead:
      'The work was attempted but its checks failed — the evidence below names the failing check.',
  },
  {
    match: /write[- ]scope|outside .*scope/i,
    lead:
      'The agent tried to touch files outside what this ticket owns, and was refused.',
  },
];

export function plainLeadFor(issue: string): string | null {
  for (const { match, lead } of LEADS) {
    if (match.test(issue)) return lead;
  }
  return null;
}
