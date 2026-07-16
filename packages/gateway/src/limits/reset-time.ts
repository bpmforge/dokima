/**
 * Stated-reset-time parser (FR-G8: "parses stated reset time where present"). Ported for
 * behavior parity (D-008) from `scripts/conductor.mjs`'s `msUntilReset` — the repo's own build
 * conductor already proves this pattern operationally against real provider CLI output. Same
 * regex, same "roll to tomorrow if the clock time has already passed today" rule, same 2-minute
 * buffer past the stated instant so a resume attempt doesn't race the provider's own clock.
 */

const RESET_TIME_RE = /resets?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*([ap]m)/i;

const RESET_BUFFER_MS = 2 * 60_000;

/**
 * Finds a "resets HH:MMam/pm" (optionally "at") clock-time statement in `text` and resolves it
 * to an absolute ISO timestamp relative to `nowMs`. Returns `null` when no such statement is
 * present — the caller then falls back to backoff (this function never guesses a time).
 */
export function parseResetTimestamp(text: string, nowMs: number): string | null {
  const match = text.match(RESET_TIME_RE);
  if (!match) return null;
  const [, hourStr, minuteStr, meridiem] = match;
  let hour = Number(hourStr) % 12;
  if (meridiem?.toLowerCase() === 'pm') hour += 12;
  const resetDate = new Date(nowMs);
  resetDate.setHours(hour, Number(minuteStr), 0, 0);
  if (resetDate.getTime() <= nowMs) {
    resetDate.setDate(resetDate.getDate() + 1);
  }
  return new Date(resetDate.getTime() + RESET_BUFFER_MS).toISOString();
}
