/**
 * Reads a project's own event log for the two triggers FR-PLAN1 names
 * ("evaluates after runs and in Improve mode") without touching the
 * harbormaster loop that emits them (orchestrator lane, out of this
 * ticket's write_scope — W5-15's own notes say SUBSCRIBE, don't rewire the
 * emitter). `run.completed`/`run.created` are both appended by
 * `@shipwright/harbormaster`'s `completeRun`/`createRun`
 * (packages/harbormaster/src/breakpoints-runs.ts) straight into the
 * project's `.shipwright/state.db` — the same file `plans-store.ts`
 * already reads/writes via `withSettingsReader`, so a plain read-only SQL
 * scan is enough; no in-process event emitter exists to subscribe to
 * (harbormaster runs as a separate CLI process, not inside apps/server).
 */

import { withSettingsReader } from '../api/server/settings-db.js';

export interface RunTriggerEvent {
  readonly seq: number;
  readonly eventType: 'run.completed' | 'run.created';
  readonly payload: unknown;
}

interface RunEventRow {
  seq: number;
  event_type: string;
  payload: string;
}

interface MaxSeqRow {
  maxSeq: number | null;
}

const TRIGGER_QUERY = `SELECT seq, event_type, payload FROM events
  WHERE seq > ? AND event_type IN ('run.completed', 'run.created')
  ORDER BY seq ASC`;

const MAX_SEQ_QUERY = 'SELECT MAX(seq) as maxSeq FROM events';

/**
 * New `run.completed`/`run.created` rows since `sinceSeq`, plus the
 * highest `seq` across the WHOLE event log — the caller advances its
 * cursor to `maxSeq` even when nothing here matched, so a chatty project
 * (lots of unrelated events) doesn't force a full rescan every poll.
 * Read-only (never contends with the project's own single writer, C6);
 * a project with no `state.db` yet (never opened) reports empty/unchanged
 * rather than throwing.
 */
export async function listRunTriggerEvents(
  projectPath: string,
  sinceSeq: number,
): Promise<{ events: readonly RunTriggerEvent[]; maxSeq: number }> {
  return withSettingsReader(projectPath, { events: [], maxSeq: sinceSeq }, (db) => {
    const rows = db.prepare(TRIGGER_QUERY).all(sinceSeq) as RunEventRow[];
    const maxRow = db.prepare(MAX_SEQ_QUERY).get() as MaxSeqRow;
    const events = rows.map((row) => ({
      seq: row.seq,
      eventType: row.event_type as RunTriggerEvent['eventType'],
      payload: JSON.parse(row.payload) as unknown,
    }));
    return { events, maxSeq: maxRow.maxSeq ?? sinceSeq };
  });
}

/** `POST /projects/{id}/runs` with `mode: 'improve'` (`run-cmd.ts`'s `run start --mode improve`) — the Improve-mode entry point FR-PLAN1 names. */
export function isImproveModeEntry(event: RunTriggerEvent): boolean {
  if (event.eventType !== 'run.created') return false;
  const payload = event.payload;
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { mode?: unknown }).mode === 'improve'
  );
}

/** `completeRun` (breakpoints-runs.ts) — "after every completed run". */
export function isRunCompletion(event: RunTriggerEvent): boolean {
  return event.eventType === 'run.completed';
}
