import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { problem, PROBLEM_CONTENT_TYPE } from '../problem.js';
import type { ProjectRecord } from '../projects.js';

const STATE_DB_RELATIVE = path.join('.shipwright', 'state.db');

/**
 * Thrown when `fleet.json` exists but isn't valid JSON (disk corruption,
 * a crashed write, manual edit gone wrong) — distinct from "not found" so
 * callers degrade to a 503 problem+json instead of a 404 or an uncaught
 * `SyntaxError` reaching Fastify's default (non-problem+json) 500 handler
 * (THREAT_MODEL §5.6 residual, W4-02 review).
 */
export class FleetRegistryCorruptError extends Error {
  constructor(
    readonly registryPath: string,
    cause: unknown,
  ) {
    super(`fleet registry is not valid JSON: ${registryPath}`);
    this.name = 'FleetRegistryCorruptError';
    this.cause = cause;
  }
}

/**
 * Board verb routes are keyed only by ticket id (API_DESIGN "tickets —
 * verbs" catalog: `POST /tickets/{id}/claim`, no project segment — the same
 * flat shape the CLI mirrors), so a `?project=` query param is the minimal
 * disambiguator for the one thing the CLI never had to solve: which of N
 * registered projects' `state.db` owns this ticket id (D-013, one core
 * serving N projects). This reads `fleet.json` directly rather than calling
 * `projects.ts`'s exported `listProjectCards` (which also computes full
 * board stats for every registered project — needless work, and a needless
 * open of every other project's `state.db`, on every verb call).
 */
async function loadFleetRegistry(registryPath: string): Promise<ProjectRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(registryPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new FleetRegistryCorruptError(registryPath, err);
  }
  return Array.isArray(parsed) ? (parsed as ProjectRecord[]) : [];
}

export async function resolveProjectRecord(
  registryPath: string,
  projectId: string,
): Promise<ProjectRecord | undefined> {
  const records = await loadFleetRegistry(registryPath);
  return records.find((r) => r.id === projectId);
}

export function stateDbPath(projectPath: string): string {
  return path.join(projectPath, STATE_DB_RELATIVE);
}

function fleetRegistryCorruptProblem(
  request: FastifyRequest,
  err: FleetRegistryCorruptError,
) {
  return problem({
    type: 'https://shipwright.dev/errors/fleet-registry-corrupt',
    title: 'Fleet registry unreadable',
    status: 503,
    detail:
      'The project registry file is not valid JSON; re-register affected projects or restore fleet.json from backup.',
    instance: request.url,
    requestId: request.id.toString(),
    rule: 'FLEET_REGISTRY_CORRUPT',
    evidence: { registry_path: err.registryPath },
  });
}

function projectNotFoundProblem(request: FastifyRequest, projectId: string) {
  return problem({
    type: 'https://shipwright.dev/errors/not-found',
    title: 'Not found',
    status: 404,
    detail: `no project registered with id ${projectId}`,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

/**
 * `resolveProjectRecord`, but degrading to RFC 7807 responses instead of
 * throwing/returning `undefined` for callers to re-derive: 404 when the id
 * isn't registered, **503** (never an uncaught 500) when `fleet.json`
 * itself is corrupt (THREAT_MODEL §5.6 residual). Callers check the return
 * value for `undefined` — the reply has already been sent in that case.
 */
export async function resolveProjectOrProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  registryPath: string,
  projectId: string,
): Promise<ProjectRecord | undefined> {
  let record: ProjectRecord | undefined;
  try {
    record = await resolveProjectRecord(registryPath, projectId);
  } catch (err) {
    if (err instanceof FleetRegistryCorruptError) {
      await reply
        .code(503)
        .type(PROBLEM_CONTENT_TYPE)
        .send(fleetRegistryCorruptProblem(request, err));
      return undefined;
    }
    throw err;
  }
  if (!record) {
    await reply
      .code(404)
      .type(PROBLEM_CONTENT_TYPE)
      .send(projectNotFoundProblem(request, projectId));
    return undefined;
  }
  return record;
}
