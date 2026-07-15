/**
 * Fleet registry + project cards (FR-F1/F2, DATABASE.md §7, UX_SPEC §2/§2b).
 *
 * DATABASE.md §7 specs the registry as `~/.shipwright/global.db` (SQLite,
 * same engine/discipline as a project's `state.db`). `better-sqlite3` is
 * only reachable through `@shipwright/events`'s own migration-managed
 * connection (`openEventLog`), which applies *that package's* per-project
 * schema (events/identities/receipts) — wrong shape for a directory index,
 * and `better-sqlite3` itself isn't a declared dependency of
 * `apps/server` (adding one means editing `apps/server/package.json`,
 * outside this ticket's write_scope). The registry is a JSON file instead,
 * `<SHIPWRIGHT_HOME>/fleet.json`, following the exact read/write shape
 * `@shipwright/shared`'s `loadGlobalConfig`/`saveGlobalConfig` already use
 * for `config.json` in the same directory. Card *stats* are never cached
 * in the registry (DATABASE.md §7's "can't lie about a project it hasn't
 * opened") — every read opens the project's own `.shipwright/state.db`
 * fresh via `openEventLogReader` (read-only, WAL-safe alongside a live
 * writer — never contends with the single-writer law, C6).
 *
 * Several card fields have no producer anywhere in the codebase yet
 * (grep-verified): running berths/heartbeats land with W3-04, the Decide
 * queue with W4-07, a persisted spend ledger with the gateway budget work,
 * and the project-level phase machine with W5-01. Faking those numbers
 * would violate local-first honesty (C-1) — they report zero/null until
 * their owning tickets land, never a plausible-looking guess.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { computeShipwrightHome } from '@shipwright/shared';
import { openEventLog, openEventLogReader, type EventLog } from '@shipwright/events';
import { computeBoard, listTickets } from '@shipwright/tickets';
import { problem, PROBLEM_CONTENT_TYPE } from './problem.js';

const FLEET_REGISTRY_FILENAME = 'fleet.json';
const STATE_DB_RELATIVE = path.join('.shipwright', 'state.db');

export type ProjectMode = 'new' | 'onboard' | 'import';

export interface ProjectRecord {
  id: string;
  path: string;
  name: string;
  archived: boolean;
  createdAt: string;
  lastOpenedAt: string;
}

export interface ProjectBoardStats {
  ready: number;
  blocked: number;
  done: number;
}

export interface ProjectCard extends ProjectRecord {
  /** Project-level phase (W5-01 phase machine); null until that lands. */
  phase: number | null;
  board: ProjectBoardStats;
  berthsRunning: number;
  /** Age of the freshest berth heartbeat in ms; null when no berth is running. */
  heartbeatAgeMs: number | null;
  pendingDecideCount: number;
  spendTodayUsd: number;
}

export class ProjectDirectoryError extends Error {}
export class ProjectNotFoundError extends Error {}

export function computeFleetRegistryPath(home: string = computeShipwrightHome()): string {
  return path.join(home, FLEET_REGISTRY_FILENAME);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function loadRegistry(registryPath: string): Promise<ProjectRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(registryPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as ProjectRecord[]) : [];
}

async function saveRegistry(
  registryPath: string,
  records: ProjectRecord[],
): Promise<void> {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}

/** Ensures `.shipwright/state.db` has schema applied, without opening (and thus lock-contending) an existing one. */
async function ensureStateDb(projectPath: string): Promise<void> {
  const dbPath = path.join(projectPath, STATE_DB_RELATIVE);
  if (await pathExists(dbPath)) return;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  openEventLog(dbPath).close();
}

export interface RegisterProjectInput {
  path: string;
  name?: string;
  mode: ProjectMode;
}

/**
 * Registers, imports, or reopens a project directory (FR-F1/F2). Reopening
 * an archived project is the same call on the same path (UX_SPEC §2
 * "Un-archive"): the existing record is reactivated in place, never
 * duplicated.
 */
export async function registerProject(
  registryPath: string,
  input: RegisterProjectInput,
  now: () => string = () => new Date().toISOString(),
): Promise<ProjectRecord> {
  const absPath = path.resolve(input.path);

  if (input.mode === 'new') {
    await fs.mkdir(absPath, { recursive: true });
  } else if (!(await pathExists(absPath))) {
    const label = input.mode === 'onboard' ? 'Onboard' : 'Import';
    throw new ProjectDirectoryError(
      `${label} requires an existing directory: ${absPath}`,
    );
  }

  await ensureStateDb(absPath);

  const records = await loadRegistry(registryPath);
  const nowIso = now();
  const existing = records.find((record) => record.path === absPath);
  let record: ProjectRecord;
  if (existing) {
    existing.archived = false;
    existing.lastOpenedAt = nowIso;
    record = existing;
  } else {
    record = {
      id: randomUUID(),
      path: absPath,
      name: input.name?.trim() || path.basename(absPath),
      archived: false,
      createdAt: nowIso,
      lastOpenedAt: nowIso,
    };
    records.push(record);
  }
  await saveRegistry(registryPath, records);
  return record;
}

/** Closes the folder (FR-F2): flips the registry flag only, never touches the project directory. */
export async function archiveProject(
  registryPath: string,
  id: string,
): Promise<ProjectRecord> {
  const records = await loadRegistry(registryPath);
  const record = records.find((r) => r.id === id);
  if (!record) throw new ProjectNotFoundError(`no project registered with id ${id}`);
  record.archived = true;
  await saveRegistry(registryPath, records);
  return record;
}

const EMPTY_STATS: Omit<ProjectCard, keyof ProjectRecord> = {
  phase: null,
  board: { ready: 0, blocked: 0, done: 0 },
  berthsRunning: 0,
  heartbeatAgeMs: null,
  pendingDecideCount: 0,
  spendTodayUsd: 0,
};

/**
 * `openEventLogReader` opens read-only (DATABASE.md §7 note above) and never runs
 * migrations, so a `state.db` left on an older schema throws better-sqlite3's
 * `SQLITE_ERROR: no such table/column: ...` — the one case this function is
 * documented to degrade for. Anything else (corruption, a real bug in
 * computeBoard/listTickets, disk I/O failure) must not be swallowed silently.
 */
function isUnmigratedSchemaError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === 'SQLITE_ERROR' &&
    /no such table|no such column/.test(err.message)
  );
}

/** Reads live stats straight from the project's own `state.db` — never cached (DATABASE.md §7). */
async function computeProjectStats(
  projectPath: string,
): Promise<Omit<ProjectCard, keyof ProjectRecord>> {
  const dbPath = path.join(projectPath, STATE_DB_RELATIVE);
  if (!(await pathExists(dbPath))) return EMPTY_STATS;

  const db = openEventLogReader(dbPath);
  try {
    const log: EventLog = { db, path: dbPath, close: () => db.close() };
    const board = computeBoard(listTickets(log));
    const stats = { ready: 0, blocked: 0, done: 0 };
    for (const entry of board) {
      if (entry.status === 'ready') stats.ready += 1;
      else if (entry.status === 'blocked') stats.blocked += 1;
      else if (entry.status === 'done') stats.done += 1;
    }
    return { ...EMPTY_STATS, board: stats };
  } catch (err) {
    if (!isUnmigratedSchemaError(err)) {
      console.error(`[fleet] computeProjectStats failed for ${dbPath}:`, err);
    }
    return EMPTY_STATS;
  } finally {
    db.close();
  }
}

async function toCard(record: ProjectRecord): Promise<ProjectCard> {
  return { ...record, ...(await computeProjectStats(record.path)) };
}

export async function listProjectCards(
  registryPath: string,
  filter: { archived: boolean } = { archived: false },
): Promise<ProjectCard[]> {
  const records = await loadRegistry(registryPath);
  const filtered = records.filter((r) => r.archived === filter.archived);
  return Promise.all(filtered.map(toCard));
}

function wireCard(card: ProjectCard) {
  return {
    id: card.id,
    path: card.path,
    name: card.name,
    archived: card.archived,
    created_at: card.createdAt,
    last_opened_at: card.lastOpenedAt,
    phase: card.phase,
    board: card.board,
    berths_running: card.berthsRunning,
    heartbeat_age_ms: card.heartbeatAgeMs,
    pending_decide_count: card.pendingDecideCount,
    spend_today: card.spendTodayUsd,
  };
}

const VALID_MODES: readonly ProjectMode[] = ['new', 'onboard', 'import'];

function isValidMode(value: unknown): value is ProjectMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value);
}

function badRequest(request: FastifyRequest, detail: string) {
  return problem({
    type: 'https://shipwright.dev/errors/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
    instance: request.url,
    requestId: request.id.toString(),
  });
}

export interface ProjectRoutesOptions {
  /** Overrides `computeShipwrightHome()` — tests only. */
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
    const inputPath = body?.path;
    const mode = body?.mode;
    if (typeof inputPath !== 'string' || inputPath.trim() === '' || !isValidMode(mode)) {
      return reply
        .code(400)
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          badRequest(
            request,
            '"path" (non-empty string) and "mode" (new|onboard|import) are required',
          ),
        );
    }
    const name = typeof body?.name === 'string' ? body.name : undefined;
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
                type: 'https://shipwright.dev/errors/not-found',
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
