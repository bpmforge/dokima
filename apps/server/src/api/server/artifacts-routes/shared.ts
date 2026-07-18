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

/** Does a gate/close receipt already exist for this ticket or phase (i.e. is the deliverable "gated")? */
export function isGatedDeliverable(
  db: EventLog['db'],
  ticketId: string | null,
  phase: number | null,
): boolean {
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
