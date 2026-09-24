/**
 * validate-plan's P13 chapter (split out under the 400-line cap when W23-39
 * added its precision rules). Pure: takes the board's tickets, returns the
 * report lines. validate-plan.mjs prints them; the report never fails.
 */

/**
 * A note that says "worth a follow-up" or "its own ticket" and names none.
 *
 * FOUND BY BEING CAUGHT. Across one long session I deferred work in ticket
 * notes five times — cross-run gate evidence (W21-73), deliverable tickets
 * beyond phase 0 (W21-76), the e2e teardown retry (W21-77), the Decide-card
 * half of the rejection notice (W21-90), the first real @unreached marker
 * (W22-02) — and filed none of them. Every one was written down honestly, in
 * the right place, and still lost, because writing it down was the last thing
 * that happened to it. The founder asked what was watching for that. Nothing
 * was.
 *
 * MEASURED before wiring, as P12 and W22-09 both were: 17 deferral-shaped
 * notes across the whole board, 7 naming an existing ticket and 10 not. Hand
 * reading the 10, roughly half are genuine unfiled work and the rest are scope
 * or closure notes that merely read like deferrals. ~50% is far better than
 * P12's 13% and still not a gate — a validator wrong half the time teaches
 * people to skim it (D-014, W21-38). So it reports.
 *
 * THE CHEAP ANSWER IS ALSO THE RIGHT ONE: name the ticket in the note. A
 * deferral that says "filed as W22-10" is both a better note and invisible to
 * this check, which is the incentive it should create.
 */
export function deferredWorkNotes(T) {
  const DEFER =
    /\b(worth (its own |a )?(ticket|follow-?up)|its own ticket|needs its own ticket|filed (separately|as its own)|a follow-?up|left for (a|its own) (ticket|follow-?up))\b/i;
  // A CARRIER IS OPEN WORK. Referencing a done ticket is history — this
  // repo's notes cite W-ids constantly, so "mentions any ticket" matched
  // almost everything and the check reported ZERO, which is the L-47 failure
  // it was written to prevent. Only a ticket that can still be worked can
  // carry a deferral.
  const carriers = new Set(T.filter((t) => t.status !== 'done').map((t) => t.id));
  // W23-39 (a): a carrier named EXPLICITLY — "CARRIED FORWARD as W22-12",
  // "filed as W22-10" — discharges the deferral whatever its status. The rule
  // above reported W21-77, W21-90 and W22-02 the moment their carriers landed:
  // they did exactly what this check's header asks, and succeeding re-reported
  // them. A bare mention is still history; only a named carry is a discharge.
  const exists = new Set(T.map((t) => t.id));
  const CARRY =
    /\b(?:carried forward (?:as|to|by)|filed as|carried by)\s+(W\d+-\d{2}[a-c]?)\b/gi;
  // W23-39 (c): a deferral inside quote marks is somebody's words being cited.
  // Removed before testing, but ONLY in a note that records a discharge — W22-15's
  // live deferral is itself a quotation of W9-14's header, adopted as its own.
  const QUOTED =
    /(^|[^A-Za-z0-9])(['"‘“])(?:(?!\2)[^\n])*?[a-z](?:(?!\2)[^\n])*?[.?!]?(?:\2|[’”])(?=[^A-Za-z0-9]|$)/g;
  const DISCHARGE =
    /\b(DROPPED (FINDING|FOLLOW-?UP)\b.*\bfiled|filed \d{4}-\d{2}-\d{2}|THIS ticket is|NOT a deferral)/i;
  // W23-39 (b): Law 1's other answer. "part of this change and not a
  // follow-up" / "rather than a follow-up" is a widen being RECORDED — the
  // deferral phrase is negated. Only the negated occurrence is dropped, so a
  // widen note that also defers the rest still reports.
  const NEGATED =
    /\b(?:and not|not|rather than|instead of)\s+(?:worth (?:its own |a )?(?:ticket|follow-?up)|its own ticket|a follow-?up)\b/gi;
  // Law 1's own maxim, cited — "a follow-up that names no ticket id is a
  // dropped finding" — is the rule being quoted, not work being promised.
  const LAW1 = /\ba follow-?up that names no ticket( id)?\b/gi;
  const defersIn = (note) => {
    let text = note.replace(NEGATED, ' ').replace(LAW1, ' ');
    if (DISCHARGE.test(text)) text = text.replace(QUOTED, '$1');
    return DEFER.test(text);
  };
  const notes = [];
  // DONE TICKETS INCLUDED, and that is the point: a deferral is made at CLOSE
  // time — "this half is a follow-up" is the last thing written before a
  // ticket stops being looked at. Skipping done tickets would skip every case.
  for (const t of T) {
    // Not every ticket stores notes as an array — guard rather than assume.
    const all = (Array.isArray(t.notes) ? t.notes : []).filter(
      (n) => typeof n === 'string',
    );
    // PER TICKET, not per note. A deferral recorded in one note and its
    // carrier named in another is exactly how a ticket SHOULD read, and an
    // earlier draft of this check reported all five of the ones I had just
    // filed carriers for — a validator that cannot see the fix it asked for.
    const joined = all.join(' ');
    const refs = joined.match(/\bW\d+-\d{2}[a-c]?\b/g) ?? [];
    if (refs.some((r) => r !== t.id && carriers.has(r))) continue;
    const carried = [...joined.matchAll(CARRY)].map((m) => m[1].toUpperCase());
    if (carried.some((r) => r !== t.id && exists.has(r))) continue;
    const deferral = all.find(defersIn);
    if (deferral === undefined) continue;
    notes.push(
      `${t.id} defers work and names no ticket for it\n      note: ${deferral.slice(0, 150)}`,
    );
  }
  return notes;
}
