/** Fleet home types (FR-F1/F2, UX_SPEC §2). Mirrors apps/server/src/api/projects.ts's ProjectCard. */

export type ProjectMode = 'new' | 'onboard' | 'import';

export interface ProjectBoardStats {
  ready: number;
  blocked: number;
  done: number;
}

export interface ProjectCard {
  id: string;
  path: string;
  name: string;
  archived: boolean;
  /** Whether the registered directory still exists on disk (W9-15). */
  available: boolean;
  createdAt: string;
  lastOpenedAt: string;
  /** Project-level phase (W5-01 phase machine); null until that lands. */
  phase: number | null;
  board: ProjectBoardStats;
  berthsRunning: number;
  /** Age of the freshest berth heartbeat in ms; null when no berth is running. */
  heartbeatAgeMs: number | null;
  pendingDecideCount: number;
  spendTodayUsd: number;
}

export interface CreateProjectInput {
  path: string;
  name?: string;
  mode: ProjectMode;
}
