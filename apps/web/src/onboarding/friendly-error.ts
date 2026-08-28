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
  /**
   * The model answered nothing in time (504 MODEL_TIMEOUT) or the endpoint was
   * not there (503 MODEL_UNREACHABLE). Both used to land on the generic branch
   * below, which tells the person to "check that your model is running" — the
   * exactly wrong thing to read when the model IS running and merely slow, and
   * the reason a first-run user with a freshly loaded local model gives up on
   * a run that a second attempt would have finished.
   */
  if (status === 504) {
    return (
      `The model did not answer in time, so ${building} was stopped. It was not a wrong ` +
      `answer — just too slow. If the model had only just loaded, one more try may ` +
      `finish it. If it times out again, this step is too slow for that model on this ` +
      `machine rather than a passing glitch — pick a faster model in Settings → Models.`
    );
  }
  if (status === 503) {
    return (
      `Dokima could not reach the model's endpoint, so ${building} was stopped. Start ` +
      `the provider, then try again. The endpoint this project uses is listed under ` +
      `Settings → Providers.`
    );
  }
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

/**
 * The one thing a 409 can mean on the build path, said in the app's own words.
 *
 * `POST /pipeline/run` maps exactly one error to 409 — `ModelResolutionError`
 * (pipeline-routes/problems.ts) — so this is as unambiguous as the 409 on the
 * resume path that `describeStillWaiting` already names. Until now it fell to
 * the generic branch and a novice was told "The server hit an error… Try
 * again — check that your model is running", which is wrong twice: there is no
 * model to be running, and trying again cannot ever succeed. The sentence that
 * would have helped sat inside the collapsed "Technical detail" disclosure,
 * which is the last place someone who has just been told it is technical will
 * look.
 *
 * Written to hold for ALL five causes, not just the common one: no model
 * configured, an unknown or disabled provider, no enabled provider, an
 * ambiguous unprefixed ref, or an unusable pin. Every one of them is fixed in
 * the same two places and none of them is fixed by retrying. The server's own
 * string stays demoted rather than promoted — some of those causes phrase
 * themselves in matrix/provider-id terms, which is exactly the register W16-06
 * moved out of the primary line.
 */
const NO_MODEL =
  "No model is set up for this project yet, so the board wasn't built. Open " +
  'Settings → Models to choose one — if the list is empty, add a provider on ' +
  'the Providers tab first. Trying again will not help until a model is set; ' +
  'the technical detail below says what could not be resolved.';

/** The submit path: "Build the board" failed. */
export function describeRunFailure(err: unknown): FriendlyFailure {
  if (err instanceof OnboardingApiError) {
    if (err.status === 409) {
      return {
        summary: `${NO_MODEL} ${ANSWERS_KEPT}`,
        detail: `${err.message} (HTTP ${String(err.status)})`,
      };
    }
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

/**
 * The resume path: "Continue" after decisions failed.
 *
 * A 409 reaches here ONLY when the caller has already ruled out the
 * still-waiting case by its `rule` (InterviewPanel.tsx) — resume emits two
 * different 409s, and the one that gets this far is MODEL_RESOLUTION.
 */
export function describeResumeFailure(err: unknown): FriendlyFailure {
  if (err instanceof OnboardingApiError) {
    // The run was parked, and the model stopped resolving while it waited.
    // Same two places fix it, and Continue will keep failing until one of
    // them does — so it must not read as a transient server error either.
    if (err.status === 409) {
      return {
        summary:
          "No model is set up for this project yet, so the run couldn't " +
          'continue. Open Settings → Models to choose one — if the list is ' +
          'empty, add a provider on the Providers tab first. Your answers to ' +
          'the decisions are saved; press Continue again once a model is set.',
        detail: `${err.message} (HTTP ${String(err.status)})`,
      };
    }
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

/**
 * What the screen should say when "Continue" failed — the whole decision, in
 * the module that owns error-to-copy mapping.
 *
 * It lives here rather than in the panel because resume emits TWO 409s
 * (pipeline-routes/resume.ts) and telling them apart is a copy decision, not a
 * rendering one: `UNDECIDED_SLATE`, and `MODEL_RESOLUTION` when the model
 * stopped resolving while the run sat parked — a provider disabled, a matrix
 * row repointed, a pin gone stale, all ordinary things to do while a run
 * waits. The panel branched on the bare status, so the second rendered the
 * first's message: answer the decisions you have already answered, on a screen
 * asking nothing, with Continue failing identically every time.
 *
 * The server always distinguished them by `rule`; the client discarded it.
 */
export type ResumeOutcome =
  | { readonly kind: 'still-waiting'; readonly message: string }
  | { readonly kind: 'failed'; readonly failure: FriendlyFailure };

export function describeResumeError(err: unknown): ResumeOutcome {
  const stillWaiting =
    err instanceof OnboardingApiError &&
    err.status === 409 &&
    err.rule !== 'MODEL_RESOLUTION';
  return stillWaiting
    ? { kind: 'still-waiting', message: describeStillWaiting() }
    : { kind: 'failed', failure: describeResumeFailure(err) };
}

/** The 409 on resume means exactly one thing here: the run is still parked on
 * unanswered decisions. Say that, in the words the screen above already uses. */
export function describeStillWaiting(): string {
  return 'Not finished yet — some decisions above still need an answer. Answer them, then press Continue again.';
}
