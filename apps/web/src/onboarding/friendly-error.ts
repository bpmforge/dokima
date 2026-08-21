/**
 * W16-06: first-contact errors speak novice.
 *
 * The interview is the first thing a person does after describing their idea,
 * and until this ticket its failure path rendered `` `${err.message} (HTTP
 * ${status})` `` verbatim — a bare exception string plus a bracketed status
 * code, with no next step, on the one screen guaranteed to be seen by someone
 * who has never met an HTTP status. The novice-journey audit (2026-08-21)
 * confirmed it at InterviewPanel.tsx:204-210 and the resume path at :227.
 *
 * The fix is a describable shape, not scattered copy: every catch site maps
 * its unknown error to a plain-language summary (what happened + what to try),
 * with the raw technical string DEMOTED to a secondary line the UI renders
 * inside a disclosure — kept, never hidden, because "shown, not swallowed"
 * (the InterviewPanel module header) still holds. Mechanism-true wording only:
 * each summary states what the status code actually means in this app, never
 * an invented cause.
 */
import { OnboardingApiError } from './api.js';

export interface FriendlyFailure {
  /** Plain-language: what happened and the concrete next step. */
  readonly summary: string;
  /** The raw technical string (message + HTTP status), demoted, never primary. */
  readonly detail: string;
}

/** The one reassurance every interview failure shares — the form state is
 * still in React state, so this is a mechanism claim, not a comfort phrase. */
const ANSWERS_KEPT = 'Your answers are still here — nothing you typed was lost.';

function summarizeStatus(status: number, building: string): string {
  if (status === 401 || status === 403) {
    return `This window is no longer signed in to your Dokima server, so ${building} was refused. Close and reopen the project, then try again.`;
  }
  if (status === 404) {
    return `The server that answered doesn't offer this step — it may be an older Dokima version still running. Restart Dokima, then try again.`;
  }
  if (status === 422) {
    return `The server couldn't use these answers as sent. Try again — if it keeps failing, the technical detail below says which part it rejected.`;
  }
  return `The server hit an error while ${building}. Try again — if it keeps failing, check that your model is running (Settings shows which one this project uses).`;
}

/** The submit path: "Build the board" failed. */
export function describeRunFailure(err: unknown): FriendlyFailure {
  if (err instanceof OnboardingApiError) {
    return {
      summary: `${summarizeStatus(err.status, 'building the board')} ${ANSWERS_KEPT}`,
      detail: `${err.message} (HTTP ${String(err.status)})`,
    };
  }
  return {
    summary: `The Dokima server couldn't be reached, so the board wasn't built. Check that the server is still running, then try again. ${ANSWERS_KEPT}`,
    detail: err instanceof Error ? err.message : String(err),
  };
}

/** The resume path: "Continue" after decisions failed (409 is NOT an error —
 * the caller handles still-waiting separately with `describeStillWaiting`). */
export function describeResumeFailure(err: unknown): FriendlyFailure {
  if (err instanceof OnboardingApiError) {
    return {
      summary: summarizeStatus(err.status, 'continuing the run'),
      detail: `${err.message} (HTTP ${String(err.status)})`,
    };
  }
  return {
    summary:
      "The Dokima server couldn't be reached, so the run wasn't continued. Check that the server is still running, then press Continue again.",
    detail: err instanceof Error ? err.message : String(err),
  };
}

/** The 409 on resume means exactly one thing here: the run is still parked on
 * unanswered decisions. Say that, in the words the screen above already uses. */
export function describeStillWaiting(): string {
  return 'Not finished yet — some decisions above still need an answer. Answer them, then press Continue again.';
}
