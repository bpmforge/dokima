/**
 * Real event-log wiring for settings audit events (FR-S3: "every settings
 * write appends a settings.changed event"). packages/shared/src/config
 * defines the event shape + an injectable `SettingsEventSink` port but
 * cannot itself depend on packages/events (ARCHITECTURE §4 law 4) — this
 * module is the concrete sink apps/server supplies, appending through
 * `@dokima/events`'s real `appendEvent`.
 *
 * v1 is single-user (API_DESIGN §1): every mutation through this API is the
 * one authenticated operator, so a single well-known human identity is
 * created lazily and reused — same `local-operator` convention used
 * elsewhere in this codebase (board verb firing).
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  appendEvent,
  createIdentity,
  getIdentity,
  openEventLog,
  type EventLog,
} from '@dokima/events';
import type {
  JsonValue,
  SettingsChangedEvent,
  SettingsEventSink,
} from '@dokima/shared';
import { stateDbPath } from './settings-db.js';
import type { ModelMatrixRow } from './settings-types.js';

export const DEFAULT_ACTOR_ID = 'local-operator';

function ensureOperatorIdentity(log: EventLog): void {
  if (getIdentity(log, DEFAULT_ACTOR_ID)) return;
  createIdentity(log, { id: DEFAULT_ACTOR_ID, name: 'Local Operator', kind: 'human' });
}

/** Opens the project's event log briefly, appends one event, and closes — same short-lived-writer discipline as settings-db.ts. */
function appendToProject(projectPath: string, eventType: string, payload: unknown): void {
  const dbPath = stateDbPath(projectPath);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const log = openEventLog(dbPath);
  try {
    ensureOperatorIdentity(log);
    appendEvent(log, { eventType, actorId: DEFAULT_ACTOR_ID, payload });
  } finally {
    log.close();
  }
}

/** Real `SettingsEventSink` for a known project — pass to writeProjectSetting/writeGlobalSetting. */
export function createProjectSettingsEventSink(projectPath: string): SettingsEventSink {
  return {
    emit(event: SettingsChangedEvent) {
      appendToProject(projectPath, event.type, event);
    },
  };
}

/** D-019/FR-G6: Copilot's default-off consent acknowledgement, minted only on an explicit enable — mirrors packages/gateway/src/fitness/events.ts's `fitness.unfit_ack` shape (the pattern D-019 says to copy). */
export interface CopilotConsentAckEvent {
  readonly type: 'copilot.consent_ack';
  readonly actorId: string;
  readonly acknowledgedRisk: string;
  readonly occurredAt: string;
}

export function appendCopilotConsentAck(
  projectPath: string,
  acknowledgedRisk: string,
  now: () => string = () => new Date().toISOString(),
): CopilotConsentAckEvent {
  const event: CopilotConsentAckEvent = {
    type: 'copilot.consent_ack',
    actorId: DEFAULT_ACTOR_ID,
    acknowledgedRisk,
    occurredAt: now(),
  };
  appendToProject(projectPath, event.type, event);
  return event;
}

/** DATABASE.md §6/§8: model_matrix is "the project-scope override of the global preset" -- a settings change like any other, so FR-S3's "every settings write appends a settings.changed event" applies even though the matrix lives in its own typed table (AC5) rather than the settings.json key/value store. matrix-routes.ts calls this right after a PUT commits, mirroring appendRuleStateChanged's separate-short-lived-connection discipline below. */
function serializeMatrixRows(rows: readonly ModelMatrixRow[]): JsonValue {
  return rows.map((r) => ({
    role: r.role,
    task_type: r.taskType,
    model: r.model,
    fallback: [...r.fallback],
    updated_at: r.updatedAt,
  }));
}

export function appendModelMatrixChanged(
  projectPath: string,
  previousRows: readonly ModelMatrixRow[],
  nextRows: readonly ModelMatrixRow[],
  now: () => string = () => new Date().toISOString(),
): SettingsChangedEvent {
  const event: SettingsChangedEvent = {
    type: 'settings.changed',
    scope: 'project',
    key: 'model_matrix',
    previousValue: serializeMatrixRows(previousRows),
    nextValue: serializeMatrixRows(nextRows),
    actorId: DEFAULT_ACTOR_ID,
    occurredAt: now(),
  };
  appendToProject(projectPath, event.type, event);
  return event;
}

/** D-014/DATABASE.md §5b: "State transitions are events (`rule.state_changed`, human actor required)." rules-routes.ts calls this right after a promote/demote mutation commits — appended as a separate short-lived connection (same non-atomic-with-the-write discipline as settings-scope.ts's sink, since withSettingsWriter's connection has already closed by the time the caller knows the outcome). */
export interface RuleStateChangedEvent {
  readonly type: 'rule.state_changed';
  readonly actorId: string;
  readonly ruleId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly occurredAt: string;
}

export function appendRuleStateChanged(
  projectPath: string,
  ruleId: string,
  fromState: string,
  toState: string,
  now: () => string = () => new Date().toISOString(),
): RuleStateChangedEvent {
  const event: RuleStateChangedEvent = {
    type: 'rule.state_changed',
    actorId: DEFAULT_ACTOR_ID,
    ruleId,
    fromState,
    toState,
    occurredAt: now(),
  };
  appendToProject(projectPath, event.type, event);
  return event;
}
