/**
 * run-recovery.ts — rejoining a run the panel did not start (W13-38/W13-39).
 *
 * Chapter of `InterviewPanel.tsx`, split at the 400-line CODE_BOOK_PROTOCOL
 * cap. The seam is real: this is "what was already happening when the screen
 * opened", while the panel owns "what the founder does next". The panel's
 * mount effect calls this once; every outcome flows back through callbacks so
 * the state stays owned in one place.
 */
import { fetchActiveRun, pollPipelineRun } from './api.js';
import { describeRunFailure, type FriendlyFailure } from './friendly-error.js';
import {
  isAwaitingDecisions,
  type PipelineAwaitingDecisions,
  type PipelineRunPhase,
  type PipelineRunResult,
} from './types.js';

export interface RunRecoveryCallbacks {
  /** True once the panel unmounted — every late arrival is dropped. */
  readonly cancelled: () => boolean;
  readonly onAwaiting: (awaiting: PipelineAwaitingDecisions) => void;
  /** The recovery found a RUNNING run — restore the building state before the poll begins. */
  readonly onRejoinRunning: () => void;
  readonly onPhases: (phases: readonly PipelineRunPhase[]) => void;
  readonly onDone: (result: PipelineRunResult) => void;
  readonly onFailed: (failure: FriendlyFailure) => void;
}

/**
 * Discovers and rejoins whatever run is already active for this project.
 *
 * W13-38 recovered a run that had PAUSED on founder decisions. W13-39 widened
 * it to a run still RUNNING: the discovery route always listed them, the
 * client filtered them out — so navigating away mid-run (a wide window,
 * minutes on a local model) and back showed a blank interview form whose only
 * button earned a correct 409 for pressing it. Recovery only DISCOVERS and
 * REJOINS; starting or resuming stays a button a human presses (Law 4).
 */
export async function recoverActiveRun(
  projectId: string,
  cb: RunRecoveryCallbacks,
): Promise<void> {
  const active = await fetchActiveRun(projectId);
  if (cb.cancelled() || !active) return;
  if (active.kind === 'awaiting') {
    cb.onAwaiting(active.awaiting);
    return;
  }
  cb.onRejoinRunning();
  try {
    const outcome = await pollPipelineRun(projectId, active.runId, {
      onProgress: (progress) => {
        if (!cb.cancelled()) cb.onPhases(progress.phases);
      },
    });
    if (cb.cancelled()) return;
    if (isAwaitingDecisions(outcome)) {
      cb.onAwaiting(outcome);
      return;
    }
    cb.onDone(outcome);
  } catch (err) {
    if (cb.cancelled()) return;
    // W16-06: the rejoined run failed — same plain-words-first shape as a
    // fresh submit failure, raw string demoted to the disclosure.
    cb.onFailed(describeRunFailure(err));
  }
}
