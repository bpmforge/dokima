/**
 * Settings REST client, part 1 (API_DESIGN §92-114, FR-S1..S3): generic
 * scope settings, model matrix, autonomy, budget. Rule lifecycle,
 * suppressions, Copilot consent, and the guide loader are in
 * api-rules.ts (same client shape, split to stay under the 400-line cap).
 */

import { jsonInit, request, type SettingsApiOptions } from './api-client.js';
import type {
  AutonomySetting,
  BudgetSetting,
  EffectiveSettings,
  ModelMatrix,
  ModelMatrixRow,
  SettingsMap,
  TaskType,
} from './types.js';

export {
  readInjectedToken,
  SettingsApiError,
  type SettingsApiOptions,
} from './api-client.js';

// --- generic scope settings ------------------------------------------------

export async function fetchGlobalSettings(
  opts: SettingsApiOptions = {},
): Promise<SettingsMap> {
  return (await request('/api/v1/settings/global', jsonInit('GET'), opts)) as SettingsMap;
}

export async function putGlobalSettings(
  patch: SettingsMap,
  opts: SettingsApiOptions = {},
): Promise<SettingsMap> {
  return (await request(
    '/api/v1/settings/global',
    jsonInit('PUT', patch),
    opts,
  )) as SettingsMap;
}

export async function fetchProjectSettings(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<SettingsMap> {
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/settings`,
    jsonInit('GET'),
    opts,
  )) as SettingsMap;
}

export async function putProjectSettings(
  projectId: string,
  patch: SettingsMap,
  opts: SettingsApiOptions = {},
): Promise<SettingsMap> {
  return (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/settings`,
    jsonInit('PUT', patch),
    opts,
  )) as SettingsMap;
}

interface EffectiveWireEntry {
  value: unknown;
  winning_scope: 'run' | 'project' | 'global';
  overridden: { scope: 'run' | 'project' | 'global'; value: unknown }[];
}

export async function fetchEffectiveSettings(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<EffectiveSettings> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/settings/effective`,
    jsonInit('GET'),
    opts,
  )) as Record<string, EffectiveWireEntry>;
  const result: EffectiveSettings = {};
  for (const [key, entry] of Object.entries(wire)) {
    result[key] = {
      value: entry.value,
      winningScope: entry.winning_scope,
      overridden: entry.overridden.map((o) => ({ scope: o.scope, value: o.value })),
    };
  }
  return result;
}

// --- model matrix ------------------------------------------------------

interface ModelMatrixWireRow {
  role: string;
  task_type: TaskType;
  model: string;
  fallback: string[];
  updated_at: string;
  copilot_backed: boolean;
}

function matrixRowFromWire(row: ModelMatrixWireRow): ModelMatrixRow {
  return {
    role: row.role,
    taskType: row.task_type,
    model: row.model,
    fallback: row.fallback,
    updatedAt: row.updated_at,
    copilotBacked: row.copilot_backed,
  };
}

export async function fetchModelMatrix(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<ModelMatrix> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/model-matrix`,
    jsonInit('GET'),
    opts,
  )) as { rows: ModelMatrixWireRow[]; copilot_enabled: boolean };
  return { rows: wire.rows.map(matrixRowFromWire), copilotEnabled: wire.copilot_enabled };
}

export interface ModelMatrixRowInput {
  role: string;
  taskType: TaskType;
  model: string;
  fallback?: string[];
}

export async function putModelMatrix(
  projectId: string,
  rows: ModelMatrixRowInput[],
  opts: SettingsApiOptions = {},
): Promise<ModelMatrix> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/model-matrix`,
    jsonInit('PUT', {
      rows: rows.map((r) => ({
        role: r.role,
        task_type: r.taskType,
        model: r.model,
        fallback: r.fallback ?? [],
      })),
    }),
    opts,
  )) as { rows: ModelMatrixWireRow[]; copilot_enabled: boolean };
  return { rows: wire.rows.map(matrixRowFromWire), copilotEnabled: wire.copilot_enabled };
}

// --- autonomy + budget ---------------------------------------------------

interface AutonomyWire {
  mode: 'interactive' | 'auto';
  never_auto: { id: string; label: string; reason: string }[];
}

export async function fetchAutonomy(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<AutonomySetting> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/autonomy`,
    jsonInit('GET'),
    opts,
  )) as AutonomyWire;
  return { mode: wire.mode, neverAuto: wire.never_auto };
}

export async function putAutonomy(
  projectId: string,
  mode: 'interactive' | 'auto',
  opts: SettingsApiOptions = {},
): Promise<AutonomySetting> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/autonomy`,
    jsonInit('PUT', { mode }),
    opts,
  )) as AutonomyWire;
  return { mode: wire.mode, neverAuto: wire.never_auto };
}

interface BudgetWire {
  run_limit_usd: number | null;
  project_limit_usd: number | null;
  breaker_thresholds: { warn: number; downshift: number; hard_stop: number };
}

function budgetFromWire(wire: BudgetWire): BudgetSetting {
  return {
    runLimitUsd: wire.run_limit_usd,
    projectLimitUsd: wire.project_limit_usd,
    breakerThresholds: {
      warn: wire.breaker_thresholds.warn,
      downshift: wire.breaker_thresholds.downshift,
      hardStop: wire.breaker_thresholds.hard_stop,
    },
  };
}

export async function fetchBudget(
  projectId: string,
  opts: SettingsApiOptions = {},
): Promise<BudgetSetting> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/budget`,
    jsonInit('GET'),
    opts,
  )) as BudgetWire;
  return budgetFromWire(wire);
}

export async function putBudget(
  projectId: string,
  input: { runLimitUsd?: number; projectLimitUsd?: number },
  opts: SettingsApiOptions = {},
): Promise<BudgetSetting> {
  const wire = (await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/budget`,
    jsonInit('PUT', {
      ...(input.runLimitUsd !== undefined ? { run_limit_usd: input.runLimitUsd } : {}),
      ...(input.projectLimitUsd !== undefined
        ? { project_limit_usd: input.projectLimitUsd }
        : {}),
    }),
    opts,
  )) as BudgetWire;
  return budgetFromWire(wire);
}
