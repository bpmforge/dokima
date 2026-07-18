/**
 * Real event-log wiring for settings audit events (FR-S3: "every settings
 * write appends a settings.changed event"). packages/shared/src/config
 * defines the event shape + an injectable `SettingsEventSink` port but
 * cannot itself depend on packages/events (ARCHITECTURE §4 law 4) — this
 * module is the concrete sink apps/server supplies, appending through
 * `@shipwright/events`'s real `appendEvent`.
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
} from '@shipwright/events';
import type { SettingsChangedEvent, SettingsEventSink } from '@shipwright/shared';
import { stateDbPath } from './settings-db.js';

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
