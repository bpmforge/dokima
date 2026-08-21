/**
 * `GET /api/v1/projects/:id/research/templates?phase=N` (W16-05, FR-P8/US-105).
 *
 * The research templates (`templatesForPhase`) have existed since W5 and no
 * surface served them — "cited research on demand" had nothing to hand the
 * person or agent asking. This route is the feed: the templates a phase
 * declares, plus the project's RECORDED research-depth policy (law 9b: depth
 * is the user's choice — the `researchDepth` setting, defaulting to
 * `standard`, never silently deepened or shallowed).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getEffectiveSettings, resolveEffectiveValue } from '@dokima/shared';
import {
  getPhase,
  templatesForPhase,
  UnknownPhaseError,
  type PhaseId,
  type ResearchDepth,
} from '@dokima/pipeline';
import { computeFleetRegistryPath } from '../../projects.js';
import { PROBLEM_CONTENT_TYPE } from '../../problem.js';
import { badRequest } from '../../server/artifacts-helpers.js';
import { resolveProjectOrProblem } from '../../server/board-project.js';

export const RESEARCH_DEPTH_SETTINGS_KEY = 'researchDepth';

const DEPTHS: readonly ResearchDepth[] = ['quick', 'standard', 'deep'];

/** The user's recorded depth choice; an unreadable value degrades to the documented default WITH the raw value echoed, never silently. */
export function resolveResearchDepth(raw: unknown): {
  readonly depth: ResearchDepth;
  readonly note?: string;
} {
  if (raw === undefined || raw === null) return { depth: 'standard' };
  if (typeof raw === 'string' && (DEPTHS as readonly string[]).includes(raw)) {
    return { depth: raw as ResearchDepth };
  }
  return {
    depth: 'standard',
    note: `the stored ${RESEARCH_DEPTH_SETTINGS_KEY} setting (${JSON.stringify(raw)}) is not one of quick/standard/deep — using standard`,
  };
}

export interface ResearchRouteOptions {
  /** Fleet registry home dir override — tests only. */
  home?: string;
}

export function registerResearchRoutes(
  app: FastifyInstance,
  opts: ResearchRouteOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  app.get(
    '/api/v1/projects/:id/research/templates',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: projectId } = request.params as { id: string };
      const record = await resolveProjectOrProblem(
        request,
        reply,
        registryPath,
        projectId,
      );
      if (!record) return;

      const { phase: phaseRaw } = request.query as { phase?: string };
      const phaseId = Number(phaseRaw);
      if (!Number.isInteger(phaseId)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, `invalid phase: ${String(phaseRaw)}`));
      }
      try {
        getPhase(phaseId as PhaseId);
      } catch (err) {
        if (err instanceof UnknownPhaseError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        throw err;
      }

      const scoped = await getEffectiveSettings({ projectDir: record.path });
      const resolved = resolveResearchDepth(
        resolveEffectiveValue(RESEARCH_DEPTH_SETTINGS_KEY, scoped)?.value,
      );

      return reply.send({
        phase: phaseId,
        depth: resolved.depth,
        ...(resolved.note ? { depth_note: resolved.note } : {}),
        templates: templatesForPhase(phaseId as PhaseId).map((t) => ({
          id: t.id,
          title: t.title,
          content_path: t.contentPath,
        })),
      });
    },
  );
}
