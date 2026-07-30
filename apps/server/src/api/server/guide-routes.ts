/**
 * In-product help affordances rendered from content/guide/ (R-M1, AC4).
 * content/guide/ does not exist yet — it's `content/**`, owned by the
 * `content` lane (W1-01), outside this ticket's write_scope, and no
 * ticket has created it (R-M1 explicitly splits ownership across W5-09
 * and this ticket, per docs/work/IMPROVEMENT_RECOMMENDATIONS.md). Rather
 * than fabricate guide content or silently 404, this loader degrades
 * honestly (C-1): a missing topic returns `markdown: null`, not an error —
 * the UI's "?" affordance renders an "no guide yet" state instead of
 * breaking. Once a content-lane ticket populates content/guide/*.md this
 * starts serving real content with zero code changes here.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveAsset } from '@shipwright/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

function defaultContentGuideDir(): string {
  // Anchored to the distribution root so the shipped guide pack resolves from
  // a bundle too (W9-13).
  return resolveAsset('content', 'guide');
}

const TOPIC_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface GuideRoutesOptions {
  /** Overrides the resolved content/guide directory — tests only. */
  contentGuideDir?: string;
}

export function registerGuideRoutes(
  app: FastifyInstance,
  opts: GuideRoutesOptions = {},
): void {
  const guideDir =
    opts.contentGuideDir ??
    process.env.SHIPWRIGHT_CONTENT_GUIDE_DIR ??
    defaultContentGuideDir();

  app.get(
    '/api/v1/guide/:topic',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { topic } = request.params as { topic: string };
      if (!TOPIC_RE.test(topic)) {
        return reply.send({ topic, markdown: null });
      }
      try {
        const markdown = await fs.readFile(path.join(guideDir, `${topic}.md`), 'utf8');
        return reply.send({ topic, markdown });
      } catch {
        return reply.send({ topic, markdown: null });
      }
    },
  );
}
