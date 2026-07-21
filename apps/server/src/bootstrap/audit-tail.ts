/**
 * Boot-time audit step (DEPLOYMENT.md §8, SC-11): a *fast* tail check — not
 * `shipwright audit verify`'s full from-genesis walk — plus the high-water
 * seq mirror to `~/.shipwright/` that lets the *next* boot detect a
 * truncated log (rows deleted since the mirror was last written).
 *
 * The tail check reuses `computeEventHash` (the same primitive
 * `verifyChain` is built on) but seeds the expected `prevHash` from the row
 * just before the fetched tail — `verifyChain` itself always requires
 * `GENESIS_HASH` for the first row, so it can't be reused directly on a
 * slice that doesn't start at seq 1.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeEventHash, GENESIS_HASH, type EventLog } from '@shipwright/events';

interface TailRow {
  seq: number;
  event_type: string;
  actor_id: string;
  payload: string;
  prev_hash: string;
  hash: string;
}

export interface TailCheckResult {
  valid: boolean;
  checkedFrom: number | null;
  checkedTo: number | null;
  brokenAtSeq: number | null;
  reason: string | null;
}

const DEFAULT_TAIL_SIZE = 50;

/** Fast tail check: verifies only the last `tailSize` events' hash linkage. */
export function auditTailCheck(
  log: EventLog,
  tailSize: number = DEFAULT_TAIL_SIZE,
): TailCheckResult {
  const rows = log.db
    .prepare<[number], TailRow>(
      'SELECT * FROM (SELECT * FROM events ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC',
    )
    .all(tailSize);

  if (rows.length === 0) {
    return {
      valid: true,
      checkedFrom: null,
      checkedTo: null,
      brokenAtSeq: null,
      reason: null,
    };
  }

  const first = rows[0] as TailRow;
  let expectedPrevHash = GENESIS_HASH;
  if (first.seq > 1) {
    const anchor = fetchRowAt(log, first.seq - 1);
    if (anchor) expectedPrevHash = anchor.hash;
  }

  for (const row of rows) {
    if (row.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        checkedFrom: first.seq,
        checkedTo: rows[rows.length - 1]?.seq ?? first.seq,
        brokenAtSeq: row.seq,
        reason: 'prev_hash does not match prior event hash',
      };
    }
    const expectedHash = computeEventHash({
      prevHash: row.prev_hash,
      seq: row.seq,
      eventType: row.event_type,
      actorId: row.actor_id,
      payloadJson: row.payload,
    });
    if (row.hash !== expectedHash) {
      return {
        valid: false,
        checkedFrom: first.seq,
        checkedTo: rows[rows.length - 1]?.seq ?? first.seq,
        brokenAtSeq: row.seq,
        reason: 'hash does not match recomputed value',
      };
    }
    expectedPrevHash = row.hash;
  }

  return {
    valid: true,
    checkedFrom: first.seq,
    checkedTo: rows[rows.length - 1]?.seq ?? first.seq,
    brokenAtSeq: null,
    reason: null,
  };
}

/** Fetches the single row at `seq` for anchoring a tail slice to its predecessor. */
function fetchRowAt(log: EventLog, seq: number): TailRow | undefined {
  return log.db.prepare<[number], TailRow>('SELECT * FROM events WHERE seq = ?').get(seq);
}

export function currentMaxSeq(log: EventLog): number {
  const row = log.db
    .prepare<[], { maxSeq: number }>('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events')
    .get();
  return row?.maxSeq ?? 0;
}

interface HighWaterFile {
  [projectKey: string]: { seq: number; updatedAt: string };
}

function highWaterFilePath(homeDir: string): string {
  return path.join(homeDir, 'audit-highwater.json');
}

async function readHighWaterFile(homeDir: string): Promise<HighWaterFile> {
  try {
    const raw = await fs.readFile(highWaterFilePath(homeDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as HighWaterFile) : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {};
  }
}

async function writeHighWaterFile(homeDir: string, data: HighWaterFile): Promise<void> {
  await fs.mkdir(homeDir, { recursive: true });
  await fs.writeFile(highWaterFilePath(homeDir), `${JSON.stringify(data, null, 2)}\n`);
}

export interface TruncationCheckResult {
  truncated: boolean;
  recordedSeq: number;
  currentSeq: number;
}

/**
 * Compares the current max seq against the last-recorded high-water seq for
 * this project; a lower current seq means rows were deleted (or the file
 * was replaced by an older copy) since the mirror was last written — a
 * silent-corruption signal DEPLOYMENT.md §8 says must never be swallowed.
 * Always rewrites the mirror to the current max afterward (a passing check
 * still advances the high-water mark).
 */
export async function checkAndUpdateHighWater(
  log: EventLog,
  homeDir: string,
  projectKey: string,
  now: () => string = () => new Date().toISOString(),
): Promise<TruncationCheckResult> {
  const data = await readHighWaterFile(homeDir);
  const recordedSeq = data[projectKey]?.seq ?? 0;
  const currentSeq = currentMaxSeq(log);
  const truncated = currentSeq < recordedSeq;

  if (!truncated) {
    data[projectKey] = { seq: currentSeq, updatedAt: now() };
    await writeHighWaterFile(homeDir, data);
  }

  return { truncated, recordedSeq, currentSeq };
}
