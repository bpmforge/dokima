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
import { runReviewPass, type ReviewOutcome } from '@dokima/harbormaster';
import type { EventLog } from '@dokima/events';
import { resolveModelTarget } from '../api/pipeline/model-resolution.js';
import { providerForConfig } from '../api/pipeline/gateway-model-port/provider.js';
import { targetToConfig } from '../api/pipeline/gateway-model-port/config.js';

const REVIEW_MAX_TOKENS = 2_000;

export interface ExecuteReviewPassOptions {
  readonly log: EventLog;
  readonly actorId: string;
  readonly runId: string;
  readonly repoRoot: string;
  readonly makerModel: string;
  readonly secretValues: readonly string[];
  readonly stderr: (line: string) => void;
}

export async function executeReviewPass(
  options: ExecuteReviewPassOptions,
): Promise<ReviewOutcome[]> {
  let reviewerModel: string | null = null;
  let chat: ((prompt: string) => Promise<string>) | null = null;
  try {
    const target = await resolveModelTarget({
      projectPath: options.repoRoot,
      role: ROLE_CODE_REVIEWER,
      taskType: 'verification',
      actorId: options.actorId,
    });
    const provider = await providerForConfig(targetToConfig(target, process.env));
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

  return runReviewPass({
    log: options.log,
    actorId: options.actorId,
    runId: options.runId,
    repoRoot: options.repoRoot,
    makerModel: options.makerModel,
    reviewerModel,
    reviewChat: chat ?? (async () => ''),
    secretValues: options.secretValues,
  });
}
