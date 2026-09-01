/**
 * scheduler/wave-automations-wiring.ts — P6-13: the composition that finally
 * STARTS the P4-01 wave automations. The final make-sure Challenger found the
 * trigger→advisory pipeline built on both ends and connected by a comment:
 * `startWaveAutomations` had no caller, and `pollBranchAdvisoryReviews`'
 * injected review was named only in prose. This chapter is the missing
 * middle: one Review-tier tick over every registered fleet project's PARKED
 * branches, reviewed by the role-routed reviewer model when one resolves and
 * SKIPPED LOUDLY when none does (FR-G5 — an unreviewed branch that looks
 * reviewed is worse than an honest skip).
 *
 * Scope, stated: only the advisory poll is composed here. The dependency
 * sweep and post-merge smoke remain UNSTARTED — their wiring is P6-14, and
 * wave-automations.ts' header now says so instead of implying otherwise.
 */
import { openEventLog } from '@dokima/events';
import { git } from '@dokima/git';
import { parkedBranches } from '@dokima/harbormaster';
import { ROLE_CODE_REVIEWER } from '@dokima/gateway';
import { computeFleetRegistryPath, listProjectCards } from '../api/projects.js';
import { resolveModelTarget } from '../api/pipeline/model-resolution.js';
import { providerForConfig } from '../api/pipeline/gateway-model-port/provider.js';
import { targetToConfig } from '../api/pipeline/gateway-model-port/config.js';
import { stateDbPath } from '../api/server/board-project.js';
import {
  createMemoryBranchCursor,
  pollBranchAdvisoryReviews,
  startWaveAutomations,
  type AdvisoryReviewFinding,
} from './wave-automations.js';

const REVIEW_MAX_TOKENS = 2_000;

/** Best-effort JSON findings from a one-shot advisory prompt; prose yields []. */
export function parseAdvisoryFindings(raw: string): AdvisoryReviewFinding[] {
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    const arr: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((f) =>
      f && typeof f === 'object' && 'file' in f && 'issue' in f
        ? [
            {
              severity: String((f as { severity?: unknown }).severity ?? 'NOTED'),
              file: String((f as { file: unknown }).file),
              issue: String((f as { issue: unknown }).issue),
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

async function advisoryReviewFor(
  projectPath: string,
  branch: string,
  head: string,
  notify: (line: string) => void,
): Promise<readonly AdvisoryReviewFinding[]> {
  let chat: ((prompt: string) => Promise<string>) | null = null;
  try {
    const target = await resolveModelTarget({
      projectPath,
      role: ROLE_CODE_REVIEWER,
      taskType: 'verification',
      actorId: 'wave-automations',
    });
    const provider = await providerForConfig(targetToConfig(target, process.env));
    chat = async (prompt) =>
      (
        await provider.chat({
          model: target.model,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: REVIEW_MAX_TOKENS,
        })
      ).message.content;
  } catch (err) {
    notify(
      `advisory review SKIPPED for ${branch}@${head.slice(0, 8)} — no reviewer model resolves (${err instanceof Error ? err.message : String(err)})`,
    );
    return [];
  }
  const diff = (await git(projectPath, ['diff', `main...${branch}`])).stdout.slice(
    0,
    120_000,
  );
  const raw = await chat(
    `Advisory review of parked branch ${branch}. Reply with ONLY a JSON array ` +
      `[{"severity":"HIGH|MEDIUM|LOW","file":"path","issue":"one line"}] — [] if clean.\n\n${diff}`,
  );
  return parseAdvisoryFindings(raw);
}

/** One tick: poll every registered project's parked branches for new heads. */
export function fleetAdvisoryTick(opts: {
  fleetHome: string | undefined;
  notify: (line: string) => void;
  cursor: ReturnType<typeof createMemoryBranchCursor>;
}): () => Promise<void> {
  return async () => {
    const projects = await listProjectCards(computeFleetRegistryPath(opts.fleetHome));
    for (const project of projects) {
      if (!project.available) continue;
      const log = openEventLog(stateDbPath(project.path));
      try {
        const parked = [...parkedBranches(log).values()];
        if (parked.length === 0) continue;
        await pollBranchAdvisoryReviews({
          listCandidateBranches: async () =>
            parked.map((p) => ({ branch: p.branch, head: p.headSha })),
          runAdvisoryReview: (branch, head) =>
            advisoryReviewFor(project.path, branch, head, opts.notify).then((f) => [
              ...f,
            ]),
          cursor: opts.cursor,
          notify: opts.notify,
          onError: (branch, err) =>
            opts.notify(
              `advisory review ERROR on ${branch}: ${err instanceof Error ? err.message : String(err)}`,
            ),
        });
      } finally {
        log.close();
      }
    }
  };
}

/** Boot the automations beside the plan scheduler. Returns the stop handle. */
export function startFleetWaveAutomations(opts: {
  fleetHome: string | undefined;
  intervalMs?: number;
  notify?: (line: string) => void;
}): { stop: () => void } {
  const notify =
    opts.notify ?? ((line: string) => console.log(`[wave-automations] ${line}`));
  const stop = startWaveAutomations({
    tick: fleetAdvisoryTick({
      fleetHome: opts.fleetHome,
      notify,
      cursor: createMemoryBranchCursor(),
    }),
    ...(opts.intervalMs !== undefined ? { intervalMs: opts.intervalMs } : {}),
  });
  return { stop };
}
