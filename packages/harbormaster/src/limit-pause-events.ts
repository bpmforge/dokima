/**
 * Real event minting for provider-limit pauses (FR-G8): appends `limit.pause` /
 * `limit.resume` to the actual hash-chained event log (`@dokima/events`, CLAUDE.md law 7 —
 * append-only, single writer). Both event types carry a literal `tier: 'record'` — a limit
 * pause never raises a Decide-tier approval card, enforced here by the payload's own type, not
 * by convention. Distinct `eventType` strings from `packages/gateway/src/budget/events.ts`'s
 * `budget.*` family (provider ceiling vs user ceiling, FR-G8 vs FR-G4).
 */

import { appendEvent, type EventLog, type EventRecord } from '@dokima/events';
import type { LimitBerthKey, LimitPauseRecord } from './limit-pause-types.js';

export interface LimitPauseEventPayload extends LimitPauseRecord {
  readonly tier: 'record';
}

export interface LimitResumeEventPayload extends LimitBerthKey {
  readonly tier: 'record';
  readonly pausedAt: string;
  readonly resumedAt: string;
}

export interface MintLimitEventOptions {
  /** Injectable clock for deterministic fixtures (TESTING.md §2). */
  now?: () => string;
}

export function mintLimitPauseEvent(
  log: EventLog,
  actorId: string,
  record: LimitPauseRecord,
  opts: MintLimitEventOptions = {},
): EventRecord {
  const payload: LimitPauseEventPayload = { ...record, tier: 'record' };
  return appendEvent(
    log,
    {
      eventType: 'limit.pause',
      actorId,
      ticketId: record.ticketId ?? null,
      runId: record.runId,
      payload,
    },
    opts,
  );
}

export function mintLimitResumeEvent(
  log: EventLog,
  actorId: string,
  record: LimitPauseRecord,
  resumedAt: string,
  opts: MintLimitEventOptions = {},
): EventRecord {
  const payload: LimitResumeEventPayload = {
    projectId: record.projectId,
    runId: record.runId,
    ticketId: record.ticketId,
    berthId: record.berthId,
    providerId: record.providerId,
    pausedAt: record.pausedAt,
    resumedAt,
    tier: 'record',
  };
  return appendEvent(
    log,
    {
      eventType: 'limit.resume',
      actorId,
      ticketId: record.ticketId ?? null,
      runId: record.runId,
      payload,
    },
    opts,
  );
}
