/**
 * atomic-write.ts — replace a file so a concurrent reader sees the old
 * contents or the new, never neither (W23-46).
 *
 * `fs.writeFile` truncates the target and then writes it. A reader that lands
 * between the two reads an empty or partial file, and every reader of these
 * files maps "unparseable" to "absent": the pipeline status route turned a live
 * run into a 404 that the polling client treats as fatal — the nightly's
 * W13-39 and guided-sample failures — and a torn `fleet.json` reads as
 * FLEET_REGISTRY_CORRUPT.
 *
 * Write a sibling temp file, then `rename` it over the target: rename within
 * one directory is atomic on POSIX filesystems. The temp name carries the pid
 * and a random suffix (two writers in one process must not share it) and ends
 * in `.tmp`, never in the target's own extension, so a directory listing that
 * filters on `.json` can never pick one up. The same shape as
 * `bootstrap/audit-tail.ts`'s high-water mirror, which has done this since
 * W8-01 for the crash-safety half of the same argument.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function writeFileAtomic(target: string, contents: string): Promise<void> {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(tmp, contents, 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    // A failed write must not leave its temp file behind to accumulate.
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
