/**
 * projects/routes.ts — the four Fastify routes.
 *
 * Chapter of the 433-line projects.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import { problem, PROBLEM_CONTENT_TYPE } from '../problem.js';
import { wireCard, toCard } from './cards.js';

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ProjectDirectoryError, ProjectNotFoundError, type ProjectMode } from './types.js';
import { computeFleetRegistryPath, pathExists } from './registry-store.js';
import { registerProject, archiveProject, removeProject } from './registry-verbs.js';
import { listProjectCards } from './cards.js';
import {
  newProjectPath,
  ProjectNameError,
  resolveWorkspaceRoot,
  WORKSPACE_ROOT_SETTINGS_KEY,
} from './workspace-root.js';
import { getGlobalSettings } from '../server/settings-scope.js';

export const VALID_MODES: readonly ProjectMode[] = ['new', 'onboard', 'import'];

export function isValidMode(value: unknown): value is ProjectMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value);
}

export function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://dokima.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

export interface ProjectRoutesOptions {
  /** Overrides `computeDokimaHome()` — tests only. */
  home?: string;
}

/** GET/POST /api/v1/projects + POST /api/v1/projects/:id/archive (API_DESIGN §2 "projects & runs"). */
export function registerProjectRoutes(
  app: FastifyInstance,
  opts: ProjectRoutesOptions = {},
): void {
  const registryPath = computeFleetRegistryPath(opts.home);

  app.get('/api/v1/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, unknown>;
    const archived = query.archived === 'true' || query.archived === true;
    const cards = await listProjectCards(registryPath, { archived });
    return reply.send({ projects: cards.map(wireCard) });
  });

  app.post('/api/v1/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const mode = body?.mode;
    const name = typeof body?.name === 'string' ? body.name : undefined;
    const givenPath = typeof body?.path === 'string' && body.path.trim() !== ''
      ? body.path
      : undefined;

    if (!isValidMode(mode)) {
      return reply
        .code(400)
        .type(PROBLEM_CONTENT_TYPE)
        .send(badRequest(request, '"mode" (new|onboard|import) is required'));
    }
    // W12-41: `path` is OPTIONAL for `new`, because the server creates that
    // directory itself and knows where projects go; the client cannot know
    // the home directory, so requiring a path here required the caller to
    // supply something it had no way to compute. `onboard`/`import` still
    // need one — those directories already exist and their location is
    // information only the user has (the picker is W12-42).
    let inputPath: string;
    if (givenPath !== undefined) {
      inputPath = givenPath;
    } else if (mode === 'new') {
      if (name === undefined || name.trim() === '') {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, 'a new project needs a "name", or an explicit "path"'));
      }
      try {
        const settings = await getGlobalSettings();
        const derived = newProjectPath(
          name,
          resolveWorkspaceRoot(settings[WORKSPACE_ROOT_SETTINGS_KEY]),
        );
        // The user named a PROJECT, not a location. If the derived directory
        // already exists, adopting it would silently hand them someone else's
        // work — `fs.mkdir(recursive)` succeeds on an existing directory and
        // `registerProject` then reactivates the existing record, so a second
        // "My App" would quietly reopen the first and say nothing. Refused
        // only here, on the derived path: an explicitly chosen path that
        // already exists is the caller taking responsibility, and reactivating
        // by path is the documented un-archive route (UX_SPEC §2).
        if (await pathExists(derived)) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              badRequest(
                request,
                `${derived} already exists. Open it from the Fleet if it is already ` +
                  `a Dokima project, use "Onboard existing repo" if it is a repo, ` +
                  `or choose a different name.`,
              ),
            );
        }
        inputPath = derived;
      } catch (err) {
        if (err instanceof ProjectNameError) {
          return reply
            .code(400)
            .type(PROBLEM_CONTENT_TYPE)
            .send(badRequest(request, err.message));
        }
        throw err;
      }
    } else {
      return reply
        .code(400)
        .type(PROBLEM_CONTENT_TYPE)
        .send(badRequest(request, `"path" is required to ${mode} an existing directory`));
    }

    try {
      const record = await registerProject(registryPath, { path: inputPath, name, mode });
      return reply.code(201).send(wireCard(await toCard(record)));
    } catch (err) {
      if (err instanceof ProjectDirectoryError) {
        return reply
          .code(400)
          .type(PROBLEM_CONTENT_TYPE)
          .send(badRequest(request, err.message));
      }
      throw err;
    }
  });

  /**
   * DELETE /api/v1/projects/:id — forget the registry entry (W9-15).
   * Never touches the project directory; `archive` and `remove` are different
   * verbs on purpose (archive keeps the entry and is reversible in the UI,
   * remove drops it).
   */
  app.delete(
    '/api/v1/projects/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        await removeProject(registryPath, id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              problem({
                type: 'https://dokima.dev/errors/not-found',
                title: 'Project not found',
                status: 404,
                detail: err.message,
                instance: request.url,
                requestId: request.id.toString(),
              }),
            );
        }
        throw err;
      }
    },
  );

  app.post(
    '/api/v1/projects/:id/archive',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        const record = await archiveProject(registryPath, id);
        return reply.send(wireCard(await toCard(record)));
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply
            .code(404)
            .type(PROBLEM_CONTENT_TYPE)
            .send(
              problem({
                type: 'https://dokima.dev/errors/not-found',
                title: 'Project not found',
                status: 404,
                detail: err.message,
                instance: request.url,
                requestId: request.id.toString(),
              }),
            );
        }
        throw err;
      }
    },
  );
}

