/**
 * Artifact Viewer read routes (FR-C3; UX_SPEC §5): list/doc/diff/doc-diff.
 * `doc-diff` diffs two arbitrary revisions of one path directly (vs.
 * `diff`'s ticket-branch-vs-base comparison) — the client uses it to render
 * "the revised version as a diff against the commented version" per
 * FR-C8/R-H2, with `from` set to the comment's `versionRef`.
 *
 * Deliverables are not a DB entity — "Docs live on disk in the project
 * repo — the viewer is a window onto git-visible files" (FR-C3) — so
 * listing/reading/diffing goes through `git-read.ts` against the project's
 * own working copy.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PROBLEM_CONTENT_TYPE } from '../board-errors.js';
import {
  defaultBaseBranch,
  findTicketBranch,
  listMarkdownFiles,
  logForPath,
  mergeBase,
  readWorkingTree,
  showAtRev,
} from '../git-read.js';
import {
  badRequest,
  isSafeGitRevision,
  isSafeRelativePath,
  notFound,
  titleFromMarkdown,
} from '../artifacts-helpers.js';
import { DOCS_SUBDIR, projectPathOrProblem } from './shared.js';

export function registerArtifactDocRoutes(
  app: FastifyInstance,
  registryPath: string,
): void {
  app.get(
    '/api/v1/projects/:id/artifacts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOrProblem(request, reply, registryPath);
      if (!projectPath) return;
      const files = await listMarkdownFiles(projectPath, DOCS_SUBDIR);
      const items = await Promise.all(
        files.map(async (entry) => {
          const content = await readWorkingTree(projectPath, entry.path);
          return {
            path: entry.path,
            title: titleFromMarkdown(
              content ?? '',
              entry.path.split('/').pop() ?? entry.path,
            ),
            // W18-03: on disk but in no commit yet — shown, never hidden.
            uncommitted: !entry.tracked || undefined,
          };
        }),
      );
      return reply.send({ items });
    },
  );

  app.get(
    '/api/v1/projects/:id/artifacts/doc',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOrProblem(request, reply, registryPath);
      if (!projectPath) return;
      const query = request.query as { path?: string; rev?: string };
      if (!query.path || !isSafeRelativePath(query.path)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"path" (safe relative path) is required'));
      }
      if (query.rev !== undefined && !isSafeGitRevision(query.rev)) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"rev" must be a valid git revision'));
      }
      const versions = await logForPath(projectPath, query.path);
      const content = query.rev
        ? await showAtRev(projectPath, query.rev, query.path)
        : await readWorkingTree(projectPath, query.path);
      if (content === null) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            notFound(
              request,
              `no artifact at ${query.path}${query.rev ? `@${query.rev}` : ''}`,
            ),
          );
      }
      return reply.send({
        path: query.path,
        content,
        rev: query.rev ?? versions[0]?.rev ?? null,
        versions,
      });
    },
  );

  app.get(
    '/api/v1/projects/:id/artifacts/diff',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOrProblem(request, reply, registryPath);
      if (!projectPath) return;
      const query = request.query as { path?: string; ticket?: string };
      if (!query.path || !isSafeRelativePath(query.path) || !query.ticket) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"path" and "ticket" are required'));
      }
      const branch = await findTicketBranch(projectPath, query.ticket);
      if (!branch) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no branch found for ticket ${query.ticket}`));
      }
      const base = await defaultBaseBranch(projectPath);
      const baseRev = (await mergeBase(projectPath, base, branch)) ?? base;
      const [oldContent, newContent] = await Promise.all([
        showAtRev(projectPath, baseRev, query.path),
        showAtRev(projectPath, branch, query.path),
      ]);
      return reply.send({
        path: query.path,
        ticket: query.ticket,
        branch,
        base,
        oldContent: oldContent ?? '',
        newContent: newContent ?? '',
      });
    },
  );

  app.get(
    '/api/v1/projects/:id/artifacts/doc-diff',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = await projectPathOrProblem(request, reply, registryPath);
      if (!projectPath) return;
      const query = request.query as { path?: string; from?: string; to?: string };
      if (!query.path || !isSafeRelativePath(query.path) || !query.from) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"path" and "from" are required'));
      }
      if (
        !isSafeGitRevision(query.from) ||
        (query.to !== undefined && !isSafeGitRevision(query.to))
      ) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, '"from"/"to" must be valid git revisions'));
      }
      const oldContent = await showAtRev(projectPath, query.from, query.path);
      if (oldContent === null) {
        return reply
          .code(404)
          .type(PROBLEM_CONTENT_TYPE)
          .send(notFound(request, `no artifact at ${query.path}@${query.from}`));
      }
      const newContent = query.to
        ? await showAtRev(projectPath, query.to, query.path)
        : await readWorkingTree(projectPath, query.path);
      return reply.send({
        path: query.path,
        from: query.from,
        to: query.to ?? 'HEAD',
        oldContent,
        newContent: newContent ?? '',
      });
    },
  );
}
