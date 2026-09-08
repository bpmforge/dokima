/**
 * Review-pass composition (W15-01): apps/server is the layer that can
 * resolve BOTH models — the maker's (this run's coding-agent target) and
 * the reviewer's (the code-reviewer role, task type `verification`, the
 * same routing every other model call takes). harbormaster receives the
 * finished pieces and never learns where they came from — the W13-23 seam.
 *
 * A project with no resolvable reviewer model does not fail the run: the
 * pass records `review.skipped` per ticket and the Decide card keeps its
 * human path. That is FR-G5's honest degradation, not a silent absence.
 */

import { ROLE_CODE_REVIEWER } from '@dokima/gateway';
import {
  reviewTicketDecisions,
  type ReviewDecision,
  type ReviewOutcome,
} from '@dokima/harbormaster';
import { getCalibration } from '@dokima/memory';
import type { EventLog } from '@dokima/events';
import { resolveModelTarget } from '../api/pipeline/model-resolution.js';
import { providerForConfig } from '../api/pipeline/gateway-model-port/provider.js';
import { endpointIdFor, pooledProvider } from './shared-gateway-pool.js';
import { targetToConfig } from '../api/pipeline/gateway-model-port/config.js';

const REVIEW_MAX_TOKENS = 2_000;

export interface ExecuteReviewPassOptions {
  readonly log: EventLog;
  readonly actorId: string;
  readonly runId: string;
  readonly repoRoot: string;
  readonly makerModel: string;
  /** W16-01: every model that made work this run (rung sessions included) — the C-4 refusal set. Defaults to `[makerModel]`. */
  readonly makerModels?: readonly string[];
  readonly secretValues: readonly string[];
  readonly stderr: (line: string) => void;
  /** W23-06: the fair-scheduling key inside one endpoint's queue. Falls back to the repo root, which is stable and unique per project. */
  readonly projectId?: string;
  /**
   * W23-10: the tickets THIS run landed. Without it the pass reviews every
   * `in_review` ticket on the board, including ones a person parked weeks ago
   * whose worktree may no longer exist.
   */
  readonly ticketIds?: readonly string[];
}

export async function executeReviewPass(options: ExecuteReviewPassOptions): Promise<{
  readonly outcomes: readonly ReviewOutcome[];
  readonly decisions: readonly (ReviewDecision | null)[];
}> {
  let reviewerModel: string | null = null;
  let chat: ((prompt: string) => Promise<string>) | null = null;
  try {
    const target = await resolveModelTarget({
      projectPath: options.repoRoot,
      role: ROLE_CODE_REVIEWER,
      taskType: 'verification',
      actorId: options.actorId,
    });
    // W23-06: through the SAME process-wide pool the maker sessions use. Before
    // this the review pass called `chat` directly, so a review overlapping a
    // build could put two concurrent requests on an endpoint that serves one.
    const provider = pooledProvider(
      await providerForConfig(targetToConfig(target, process.env)),
      endpointIdFor(target),
      options.projectId ?? options.repoRoot,
    );
    reviewerModel = target.model;
    chat = async (prompt: string) => {
      const response = await provider.chat({
        model: target.model,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: REVIEW_MAX_TOKENS,
      });
      return response.message.content;
    };
  } catch (err) {
    options.stderr(
      `[review] no reviewer model could be resolved — machine review skipped ` +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        `Tickets stay in In Review for your own read.`,
    );
  }

  const results = await reviewTicketDecisions({
    log: options.log,
    actorId: options.actorId,
    runId: options.runId,
    repoRoot: options.repoRoot,
    makerModel: options.makerModel,
    ...(options.makerModels ? { makerModels: options.makerModels } : {}),
    reviewerModel,
    reviewChat: chat ?? (async () => ''),
    secretValues: options.secretValues,
    // W15-02: the maker's track record biases borderline calls toward a
    // person, never toward acceptance (FR-L3 asymmetry).
    makerCalibration: () =>
      getCalibration(options.log.db, options.makerModel, 'coding-agent'),
    ...(options.ticketIds ? { ticketIds: options.ticketIds } : {}),
  });

  /**
   * W23-10: the decisions are returned to the caller as well as the outcomes,
   * because the eligibility question ("may this be accepted without a person?")
   * is answered by the decision and nothing else can re-derive it honestly.
   */
  return {
    outcomes: results.map((r) => r.outcome),
    decisions: results.map((r) => r.decision),
  };
}
