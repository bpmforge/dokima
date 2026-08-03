/** GET/PUT /api/v1/projects/{id}/model-matrix (API_DESIGN §89, AC1/AC5/AC6). */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  guardMakerVerifierDistinct,
  isVerifierRole,
  ROLE_CODING_AGENT,
  SameModelRefusedError,
} from '@dokima/gateway';
import {
  listModelMatrix,
  putModelMatrix,
  type ModelMatrixInput,
} from './model-matrix-store.js';
import {
  badRequest,
  conflict,
  resolveProjectOrProblem,
} from './settings-route-helpers.js';
import { appendModelMatrixChanged, DEFAULT_ACTOR_ID } from './settings-events.js';
import { getProjectSettings } from './settings-scope.js';
import { TASK_TYPES, type ModelMatrixRow, type TaskType } from './settings-types.js';

/** Project convention (documented here, not enforced by any provider adapter this ticket can reach): Copilot-backed rows name their model `copilot/<model>` so the UI can flag them under the D-019 consent gate. */
const COPILOT_MODEL_PREFIX = 'copilot/';

export interface WireModelMatrixRow {
  role: string;
  task_type: TaskType;
  model: string;
  fallback: string[];
  updated_at: string;
  copilot_backed: boolean;
}

function isCopilotModel(model: string): boolean {
  return model.startsWith(COPILOT_MODEL_PREFIX);
}

function toWire(row: ModelMatrixRow): WireModelMatrixRow {
  return {
    role: row.role,
    task_type: row.taskType,
    model: row.model,
    fallback: [...row.fallback],
    updated_at: row.updatedAt,
    copilot_backed: isCopilotModel(row.model),
  };
}

function isValidTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value);
}

function parseRows(body: unknown): ModelMatrixInput[] | undefined {
  if (!Array.isArray(body)) return undefined;
  const rows: ModelMatrixInput[] = [];
  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.role !== 'string' ||
      !isValidTaskType(row.task_type) ||
      typeof row.model !== 'string' ||
      row.role.trim() === '' ||
      row.model.trim() === ''
    ) {
      return undefined;
    }
    const fallback =
      row.fallback === undefined
        ? []
        : Array.isArray(row.fallback) && row.fallback.every((f) => typeof f === 'string')
          ? (row.fallback as string[])
          : undefined;
    if (fallback === undefined) return undefined;
    rows.push({ role: row.role, taskType: row.task_type, model: row.model, fallback });
  }
  return rows;
}

export interface MatrixRoutesOptions {
  home?: string;
}

export function registerMatrixRoutes(
  app: FastifyInstance,
  opts: MatrixRoutesOptions = {},
): void {
  app.get(
    '/api/v1/projects/:id/model-matrix',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const [rows, projectSettings] = await Promise.all([
        listModelMatrix(projectPath),
        getProjectSettings(projectPath),
      ]);
      const copilotEnabled = projectSettings.copilotEnabled === true;
      return reply.send({
        rows: rows.map(toWire),
        copilot_enabled: copilotEnabled,
      });
    },
  );

  app.put(
    '/api/v1/projects/:id/model-matrix',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const projectPath = await resolveProjectOrProblem(request, reply, id, opts.home);
      if (!projectPath) return;
      const body = request.body as Record<string, unknown> | undefined;
      const rows = parseRows(body?.rows);
      if (!rows) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            badRequest(
              request,
              '"rows" must be an array of {role, task_type, model, fallback?} entries',
            ),
          );
      }
      const before = await listModelMatrix(projectPath);

      // FR-G2/C-4: refuse a maker/verifier pair resolving to the same model
      // for the same task type, in either direction — a submitted verifier
      // row colliding with an already-stored maker row, a submitted maker
      // row colliding with an already-stored verifier row, or two rows
      // colliding within the same PUT. Only task types this PUT actually
      // touches can newly collide (the invariant already holds for
      // everything else), so the merged post-write role->model map is
      // built per touched task type: stored rows first, then the submitted
      // rows overlaid on top. Fail-fast, before any write.
      const touchedTaskTypes = new Set(rows.map((row) => row.taskType));
      const roleModelByTaskType = new Map<TaskType, Map<string, string>>();
      for (const row of before) {
        if (!touchedTaskTypes.has(row.taskType)) continue;
        const roleModel =
          roleModelByTaskType.get(row.taskType) ?? new Map<string, string>();
        roleModel.set(row.role, row.model);
        roleModelByTaskType.set(row.taskType, roleModel);
      }
      for (const row of rows) {
        const roleModel =
          roleModelByTaskType.get(row.taskType) ?? new Map<string, string>();
        roleModel.set(row.role, row.model);
        roleModelByTaskType.set(row.taskType, roleModel);
      }
      for (const [taskType, roleModel] of roleModelByTaskType) {
        const makerModel = roleModel.get(ROLE_CODING_AGENT);
        if (makerModel === undefined) continue;
        for (const [role, model] of roleModel) {
          if (!isVerifierRole(role) || model !== makerModel) continue;
          try {
            await guardMakerVerifierDistinct({
              verifierRole: role,
              makerRole: ROLE_CODING_AGENT,
              taskType,
              verifierModel: model,
              makerModel,
              actorId: DEFAULT_ACTOR_ID,
            });
          } catch (err) {
            if (err instanceof SameModelRefusedError) {
              return reply
                .code(409)
                .type('application/problem+json')
                .send(conflict(request, err.message, 'same-model-refused'));
            }
            throw err;
          }
        }
      }

      const updated = await putModelMatrix(projectPath, rows);
      appendModelMatrixChanged(projectPath, before, updated);
      const projectSettings = await getProjectSettings(projectPath);
      return reply.send({
        rows: updated.map(toWire),
        copilot_enabled: projectSettings.copilotEnabled === true,
      });
    },
  );
}
