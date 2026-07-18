/**
 * Artifact Viewer + feedback-comment routes (FR-C3, FR-C8; UX_SPEC §5).
 * Book-split per CODE_BOOK_PROTOCOL.md: `shared.ts` (types + project-path
 * resolution + gated-deliverable check), `docs-routes.ts` (list/doc/diff/
 * doc-diff), `comments-routes.ts` (GET/POST comments). This file is the
 * public barrel.
 */

import type { FastifyInstance } from 'fastify';
import { IdempotencyStore } from '../../idempotency.js';
import { computeFleetRegistryPath } from '../../projects.js';
import { registerArtifactCommentRoutes } from './comments-routes.js';
import { registerArtifactDocRoutes } from './docs-routes.js';
import type { ArtifactRoutesOptions } from './shared.js';

export type { ArtifactRoutesOptions };

export function registerArtifactRoutes(
  app: FastifyInstance,
  opts: ArtifactRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);
  const idempotency = new IdempotencyStore();
  registerArtifactDocRoutes(app, registryPath);
  registerArtifactCommentRoutes(app, registryPath, idempotency);
}
