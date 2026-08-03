/**
 * projects/types.ts — the fleet-registry record shapes and their errors.
 *
 * Chapter of the 433-line projects.ts, split under the 400-line
 * CODE_BOOK_PROTOCOL cap (W10-48). Extraction only, no behaviour change.
 */

import path from 'node:path';

export const FLEET_REGISTRY_FILENAME = 'fleet.json';
export const STATE_DB_RELATIVE = path.join('.dokima', 'state.db');

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
  /**
   * Whether the registered directory still exists on disk (W9-15). A project
   * whose directory has vanished MUST NOT render as a healthy card with zeroed
   * stats — zeros are indistinguishable from a real, empty project, and the
   * honest-absence rule (same one `healthz` and the trace view follow) says the
   * two must look different.
   */
  available: boolean;
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

