/**
 * Offline write-through queue (SC-15, FR-T5 AC-3): when the forge is
 * unreachable, verbs queue rather than fail, and flush in order once it's
 * reachable again. The queue's durable home is ticket `history[]`
 * (docs/DATABASE.md §3: "history TEXT(JSON: verb log incl. queued forge
 * mirror writes — D-004 offline queue)") — out of this package's reach
 * (forge has zero workspace deps, and `packages/tickets/**` isn't in this
 * ticket's write_scope). This module owns the queue *behavior* — enqueue,
 * and order-preserving flush — as plain data a harbormaster-side caller
 * persists into/reads back from that array.
 *
 * HANDOFF: wiring `attemptOrQueue`'s output into `ticket.history[]` and
 * calling `flushMirrorQueue` on reconnect is harbormaster's job (it's the
 * only package importing both `forge` and `tickets`, ARCHITECTURE.md law
 * 5) — a follow-up ticket, not this one.
 */
import type { RepoRef } from '../types.js';
import {
  isOfflineForgeError,
  writeThroughVerb,
  type MirrorForgeAdapter,
} from './write-through.js';
import type { MirrorWriteRequest, MirrorWriteResult } from './types.js';

export interface QueuedMirrorWrite {
  issueNumber: number;
  request: MirrorWriteRequest;
  queuedAt: string;
  attempts: number;
}

/**
 * Tries a write-through immediately; on a "forge unreachable" error the
 * write is appended to the queue (order preserved — pushed to the end)
 * instead of being lost. Any other error propagates — only unreachability
 * goes offline-and-retry; auth/validation failures are real failures.
 */
export async function attemptOrQueue(
  adapter: MirrorForgeAdapter,
  ref: RepoRef,
  issueNumber: number,
  request: MirrorWriteRequest,
  queue: readonly QueuedMirrorWrite[],
  now: () => string,
): Promise<
  | { result: MirrorWriteResult; queue: readonly QueuedMirrorWrite[] }
  | { result: null; queue: readonly QueuedMirrorWrite[] }
> {
  try {
    const result = await writeThroughVerb(adapter, ref, issueNumber, request);
    return { result, queue };
  } catch (err) {
    if (!isOfflineForgeError(err)) throw err;
    const entry: QueuedMirrorWrite = {
      issueNumber,
      request,
      queuedAt: now(),
      attempts: 0,
    };
    return { result: null, queue: [...queue, entry] };
  }
}

export interface FlushResult {
  entry: QueuedMirrorWrite;
  result: MirrorWriteResult;
}

export interface MirrorFlushOutcome {
  flushed: FlushResult[];
  /** Entries still queued, in original order — either untried (came after the first failure) or the failed entry itself with `attempts` incremented. */
  remaining: QueuedMirrorWrite[];
}

type FlushEntryOutcome =
  { ok: true; result: MirrorWriteResult } | { ok: false; error: unknown };

/**
 * Attempts a single queued write and reports success/failure rather than
 * throwing, so the caller (the drain loop below) decides whether a failure
 * means "stop draining" or "propagate" without nesting error handling
 * inside the loop body itself.
 */
async function flushEntry(
  adapter: MirrorForgeAdapter,
  ref: RepoRef,
  entry: QueuedMirrorWrite,
): Promise<FlushEntryOutcome> {
  try {
    const result = await writeThroughVerb(adapter, ref, entry.issueNumber, entry.request);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Drains the queue strictly in order: the forge timeline must see writes
 * in the sequence they happened locally, so flushing stops at the first
 * failure rather than skipping ahead to entries that might succeed —
 * everything from that point on (including the failed entry, retried next
 * time) stays queued.
 */
export async function flushMirrorQueue(
  adapter: MirrorForgeAdapter,
  ref: RepoRef,
  queue: readonly QueuedMirrorWrite[],
): Promise<MirrorFlushOutcome> {
  const flushed: FlushResult[] = [];
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i]!;
    const outcome = await flushEntry(adapter, ref, entry);
    if (outcome.ok) {
      flushed.push({ entry, result: outcome.result });
      continue;
    }
    if (!isOfflineForgeError(outcome.error)) throw outcome.error;
    const retried = { ...entry, attempts: entry.attempts + 1 };
    return { flushed, remaining: [retried, ...queue.slice(i + 1)] };
  }
  return { flushed, remaining: [] };
}
