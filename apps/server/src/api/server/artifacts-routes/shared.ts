/**
 * Shared types + helpers for the artifact viewer route chapters
 * (`docs-routes.ts`, `comments-routes.ts`) — CODE_BOOK_PROTOCOL.md split of
 * the former single `artifacts-routes.ts`.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EventLog } from '@shipwright/events';
import { resolveProjectOrProblem } from '../board-project.js';

export const DOCS_SUBDIR = 'docs';

export interface ArtifactCommentPayload {
  path: string;
  body: string;
  versionRef: string;
  ticketId?: string | null;
  phase?: number | null;
}

/**
 * Doc-path -> phase-id lookup (docs/BLUEPRINT.md §3.2 table,
 * `packages/pipeline/src/phases/topology.ts`'s `PHASES`). Mirrored rather
 * than imported: `packages/pipeline/src/index.ts` doesn't re-export
 * `phases/topology.ts`, and widening that export is outside this ticket's
 * write_scope (`apps/server/src/api/server/artifacts-routes/**`) — same
 * constraint `apps/web/src/artifacts/deliverablePhase.ts` documents on the
 * client side. Keep in sync with `topology.ts`'s `PHASES` if BLUEPRINT §3.2
 * changes.
 *
 * SECURITY (W5-21): this is the server's own source of truth for a
 * deliverable's phase. `isGatedDeliverable` derives phase from this table
 * — never from a client-supplied `phase` field — so a forged request body
 * cannot change the gating decision.
 */
const DELIVERABLE_PHASES: ReadonlyMap<string, number> = new Map([
  ['docs/VISION.md', 0],
  ['docs/COMPETITIVE_ANALYSIS.md', 0],
  ['docs/SCOPE.md', 1],
  ['docs/RISKS.md', 1],
  ['docs/CONSTRAINTS.md', 1],
  ['docs/USER_PERSONAS.md', 1],
  ['docs/SRS.md', 2],
  ['docs/USER_STORIES.md', 2],
  ['docs/USE_CASES.md', 2],
  ['docs/TEST_PLAN.md', 2],
  ['docs/MODULE_DESIGN.md', 3],
  ['docs/ARCHITECTURE.md', 3],
  ['docs/API_DESIGN.md', 3],
  ['docs/api/openapi.yaml', 3],
  ['docs/TECH_STACK.md', 3],
  ['docs/THREAT_MODEL.md', 3],
  ['docs/SECURITY_CONTROLS.md', 3],
  ['docs/INFRASTRUCTURE.md', 3],
  ['docs/design/UX_SPEC.md', 3],
]);

/** `null` for any path not a declared phase 0–3 deliverable. Pure lookup — no client input. */
export function phaseForDeliverablePath(path: string): number | null {
  return DELIVERABLE_PHASES.get(path) ?? null;
}

export interface RevisionRequestedPayload {
  path: string;
  commentEventSeq: number;
  ticketId?: string | null;
  phase?: number | null;
  requestedBy: string;
}

export interface ArtifactRoutesOptions {
  /** Overrides `computeFleetRegistryPath()` — tests only. */
  home?: string;
}

/** Resolves `:id` to the project's working-tree path, or sends a problem+json refusal. */
export async function projectPathOrProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  registryPath: string,
): Promise<string | undefined> {
  const { id } = request.params as { id: string };
  const record = await resolveProjectOrProblem(request, reply, registryPath, id);
  if (!record) return undefined;
  return record.path;
}

/**
 * Does a gate/close receipt already exist for this ticket or the
 * deliverable's phase (i.e. is the deliverable "gated")?
 *
 * `phase` is derived here from `path` via `phaseForDeliverablePath` — a
 * pure server-side lookup — never taken from caller/request input, so a
 * client cannot forge a `phase` to flip the gating decision.
 */
export function isGatedDeliverable(
  db: EventLog['db'],
  ticketId: string | null,
  path: string,
): boolean {
  const phase = phaseForDeliverablePath(path);
  if (!ticketId && phase == null) return false;
  const row = db
    .prepare<[string | null, number | null, number | null], { id: string }>(
      `SELECT id FROM receipts
       WHERE kind IN ('gate', 'close')
         AND ((ticket_id IS NOT NULL AND ticket_id = ?) OR (? IS NOT NULL AND phase = ?))
       LIMIT 1`,
    )
    .get(ticketId, phase, phase);
  return Boolean(row);
}
