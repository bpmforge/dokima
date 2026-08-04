/**
 * A creation run paused on a founder decision (W10-67).
 *
 * The gate that stops it is CORRECT — FR-P7 locks phase 4 while any
 * founder-decision marker is unresolved, and `runPreflight` checks it
 * immediately after the blueprint, before any further gateway spend. What was
 * wrong is that the run then threw everything away: the slates the founder was
 * being asked to answer existed only in memory, `decisions` stayed empty, the
 * Decisions surface built in W5-13/W5-14 had nothing to show, and the interview
 * rendered "The run failed:" in the error style. Measured in a browser on a
 * real idea: `plan_items 0`, `events 0`, two named questions and nowhere to
 * answer them.
 *
 * WHAT IS PERSISTED, and why it is only this: the blueprint INPUT, not the
 * rendered blueprint. Synthesis is pure (`synthesizeBlueprint`), so the
 * document can be rebuilt for free on resume; the model call that produced the
 * input is the expensive part and the only thing that must not be paid twice.
 * The technical slate and ticket drafts are deliberately NOT here — the gate
 * fires before either is requested, so there is nothing to keep.
 *
 * WHY A FILE rather than an event: the event log is append-only and
 * hash-chained (C-6), and a new event kind means editing `packages/events`,
 * which this ticket's write_scope excludes. A JSON file under the project's
 * own `.dokima/` is the same trust boundary as `settings.json`, is trivially
 * inspectable when a run misbehaves, and carries no schema migration. The
 * SLATES themselves do go through the event log, via `createSlate` — the
 * durable, audited half is the half a human answers.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SynthesizeBlueprintInput } from '@dokima/pipeline';

export interface PausedRun {
  readonly runId: string;
  readonly blueprintTitle: string;
  readonly blueprintInput: SynthesizeBlueprintInput;
  /** `openQuestions[].key` -> the slate id a founder answers to unblock it. */
  readonly slateIdsByKey: Readonly<Record<string, string>>;
  readonly pausedAt: string;
}

function runsDir(projectPath: string): string {
  return path.join(projectPath, '.dokima', 'runs');
}

function runFile(projectPath: string, runId: string): string {
  // `runId` is a server-minted randomUUID on every path that reaches here, but
  // it arrives as a URL parameter on resume — so it is constrained rather than
  // trusted. A traversal in a path segment is not a theoretical concern.
  return path.join(runsDir(projectPath), `${runId}.json`);
}

const RUN_ID_RE = /^[0-9a-f-]{36}$/i;

export function isValidRunId(runId: string): boolean {
  return RUN_ID_RE.test(runId);
}

export async function savePausedRun(projectPath: string, run: PausedRun): Promise<void> {
  await fs.mkdir(runsDir(projectPath), { recursive: true });
  await fs.writeFile(
    runFile(projectPath, run.runId),
    `${JSON.stringify(run, null, 2)}\n`,
  );
}

/** Absent or unreadable means "no such paused run" — the caller reports a 404, never a 500. */
export async function loadPausedRun(
  projectPath: string,
  runId: string,
): Promise<PausedRun | undefined> {
  if (!isValidRunId(runId)) return undefined;
  let raw: string;
  try {
    raw = await fs.readFile(runFile(projectPath, runId), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as PausedRun;
    return parsed.runId === runId && parsed.blueprintInput ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Removes the paused run once it has been resumed to completion. */
export async function clearPausedRun(projectPath: string, runId: string): Promise<void> {
  if (!isValidRunId(runId)) return;
  await fs.rm(runFile(projectPath, runId), { force: true });
}
