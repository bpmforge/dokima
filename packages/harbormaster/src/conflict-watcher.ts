/**
 * File watcher on the human's checkout (BLUEPRINT §7.3 step 2, FR-T6,
 * ARCHITECTURE.md §7.5: "a file watcher on the human's checkout flags edits
 * inside a leased scope"). `parsePorcelainStatus`/`detectConflicts` are the
 * pure decision core (mirrors `watchdog.ts`'s pure `checkWatchdogBreach`);
 * `scanHumanCheckout` is the real `git status --porcelain` read.
 * `runConflictWatch` is one watcher pass: scan -> mint `human.file_edited`
 * for every observed edit (UC-04 A2: an edit outside any lease is still an
 * ordinary event, no interruption) -> match against active leases -> mint
 * `conflict.detected` for every collision and return them so a caller can
 * immediately drive `conflict-rebase.ts`'s `resolveHumanEditConflict`.
 *
 * Polling on an interval (the literal "watcher" process) is left to a
 * future ticket's composition, the same "drop-in unit" posture
 * `watchdog-session.ts`/`limit-pause.ts` document for their own modules —
 * this module's `runConflictWatch` is the one pass such a poller would call
 * repeatedly.
 */

import { git, matchesAnyGlob } from '@dokima/git';
import type { EventLog } from '@dokima/events';
import type { ConflictDetection, HumanEdit, LeaseRecord } from './conflict-types.js';
import { mintConflictDetected, mintHumanFileEdited } from './conflict-events.js';

/**
 * Parses `git status --porcelain` output into repo-relative paths. Rename
 * lines (`R  old -> new`) report the new path — the old path no longer
 * exists to lease-check against. Handles the two-character XY status
 * prefix `git status --porcelain` always emits, including the raw
 * (unquoted) path form.
 */
export function parsePorcelainStatus(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (line.length === 0) continue;
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    const path = arrow === -1 ? rest : rest.slice(arrow + ' -> '.length);
    paths.push(path.trim());
  }
  return paths.filter((path) => path.length > 0);
}

/** Real read of the human's checkout — every path `git status --porcelain` reports changed, timestamped by the caller's clock. */
export async function scanHumanCheckout(
  repoRoot: string,
  now: () => string = () => new Date().toISOString(),
): Promise<HumanEdit[]> {
  // `--untracked-files=all` — the default mode collapses a brand-new directory
  // to a single `?? docs/` line instead of listing the files inside it, which
  // would hide a leased-scope edit sitting in an untracked subdirectory.
  const { stdout } = await git(repoRoot, [
    'status',
    '--porcelain',
    '--untracked-files=all',
  ]);
  const detectedAt = now();
  return parsePorcelainStatus(stdout).map((path) => ({ path, detectedAt }));
}

/** Pure match: every (edit, lease) pair where the edit's path falls inside the lease's write_scope. */
export function detectConflicts(
  edits: readonly HumanEdit[],
  leases: readonly LeaseRecord[],
): ConflictDetection[] {
  const detections: ConflictDetection[] = [];
  for (const edit of edits) {
    for (const lease of leases) {
      const matchedGlob = lease.writeScope.find((glob) =>
        matchesAnyGlob(edit.path, [glob]),
      );
      if (matchedGlob) {
        detections.push({
          ticketId: lease.ticketId,
          ownerId: lease.ownerId,
          path: edit.path,
          matchedGlob,
        });
      }
    }
  }
  return detections;
}

export interface RunConflictWatchOptions {
  readonly log: EventLog;
  /** Mints `conflict.detected` — the harbormaster/watcher identity, not the human's. */
  readonly actorId: string;
  /** Whoever edited the checkout — the human.file_edited event's attribution (FR-L4). */
  readonly humanActorId: string;
  readonly repoRoot: string;
  readonly leases: readonly LeaseRecord[];
  readonly now?: () => string;
}

/** One watcher pass. Returns the detections so a caller can immediately drive `resolveHumanEditConflict`. */
export async function runConflictWatch(
  options: RunConflictWatchOptions,
): Promise<ConflictDetection[]> {
  const now = options.now ?? (() => new Date().toISOString());
  const edits = await scanHumanCheckout(options.repoRoot, now);
  const detections = detectConflicts(edits, options.leases);
  const ticketIdByPath = new Map(detections.map((d) => [d.path, d.ticketId]));

  for (const edit of edits) {
    mintHumanFileEdited(
      options.log,
      options.humanActorId,
      ticketIdByPath.get(edit.path) ?? null,
      edit,
      { now },
    );
  }
  for (const detection of detections) {
    mintConflictDetected(options.log, options.actorId, detection, { now });
  }
  return detections;
}
