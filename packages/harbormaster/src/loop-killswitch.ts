/**
 * Kill-file/pause check (BLUEPRINT §3.6/§434, FR-H2): the claim loop
 * consults this only *between* tickets — a kill or pause takes effect at
 * the next ticket boundary, never mid-session ("finishes the current
 * ticket, checkpoints, stops"). The check is injected (`StopSwitch`) so
 * tests never touch the filesystem; `createFileStopSwitch` is a real
 * default for callers that want the literal productized kill-file/pause
 * button (existence of either file stops the loop).
 */

import { access } from 'node:fs/promises';

export type StopSwitch = () => boolean | Promise<boolean>;

export interface FileStopSwitchOptions {
  readonly killFilePath: string;
  readonly pauseFilePath: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Stops the loop when either the kill-file or the pause-file exists on disk. */
export function createFileStopSwitch(options: FileStopSwitchOptions): StopSwitch {
  return async () =>
    (await fileExists(options.killFilePath)) || (await fileExists(options.pauseFilePath));
}
