/**
 * Settings-change audit trail (FR-S3): "every settings write appends a
 * settings.changed event (actor, scope, key, old->new) replayable from the
 * log." `packages/shared` cannot depend on `packages/events` (only `events`
 * touches the DB write path — ARCHITECTURE §4 law 4), so this module
 * defines the event shape and an injectable sink port; the caller (a
 * higher layer that can import `packages/events`) supplies the real sink
 * that appends to the project's event log.
 */

import type { JsonValue, SettingsScope } from './settings.js';

export interface SettingsChangedEvent {
  type: 'settings.changed';
  scope: SettingsScope;
  key: string;
  /** undefined = key was previously unset. */
  previousValue: JsonValue | undefined;
  /** undefined = key was removed by this write. */
  nextValue: JsonValue | undefined;
  actorId: string;
  occurredAt: string;
}

export interface SettingsEventSink {
  emit(event: SettingsChangedEvent): void | Promise<void>;
}

export const noopSettingsEventSink: SettingsEventSink = {
  emit() {
    // Callers that don't need an audit trail (e.g. exploratory scripts)
    // opt out explicitly by omitting a sink; production call sites must
    // pass a real one wired to packages/events.
  },
};

export function createInMemorySettingsEventSink(): SettingsEventSink & {
  events: SettingsChangedEvent[];
} {
  const events: SettingsChangedEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
