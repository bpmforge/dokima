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

/**
 * W10-58 generalises the above from "a run paused on a decision" to "a run",
 * because a pause is not the only way a run stops with work already paid for.
 *
 * `PausedRun` persisted `blueprintInput` for one reason — it is the expensive,
 * model-authored half, and synthesis from it is pure and therefore free to
 * replay. That reasoning was never specific to pausing: a run that dies in the
 * technical-slate phase has also already paid for `blueprintInput`, and one
 * that dies in decompose has paid for the slate input too. Today all of it is
 * discarded, so a founder who waited three minutes for a phase-3 failure gets
 * nothing back.
 *
 * `RunRecord` is a strict SUPERSET of `PausedRun` — same file, same
 * `runs/<id>.json` location, same `isValidRunId` guard — so `resume.ts` keeps
 * reading exactly the fields it always read and needs no change. The added
 * fields are all optional: a record is written the moment a run starts (before
 * any model call has landed) and patched forward as each stage completes, so
 * the file is the run's durable progress, not just its epitaph.
 *
 * WHY STILL A FILE, restated because the reason changed: W10-67 chose a file
 * because `packages/events` was out of its write_scope. That is no longer true
 * here. It stays a file anyway because the event log is append-only and
 * hash-chained (C-6) and run progress is MUTABLE state — the current stage
 * overwrites the previous one. Append-only storage models "what happened"; this
 * models "where we are". The phase EVENTS still go to the log, and they are the
 * audited half.
 */
export type RunStatus = 'running' | 'awaiting-decisions' | 'completed' | 'failed';

export interface RunRecord {
  readonly runId: string;
  readonly blueprintTitle: string;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  /** Completed stages, in order, each with the instant it landed. */
  readonly phases: readonly { readonly name: string; readonly at: string }[];
  /** Model-authored inputs, persisted AS THEY LAND — the whole point (acceptance 5). */
  readonly blueprintInput?: SynthesizeBlueprintInput;
  readonly technicalSlateInput?: unknown;
  readonly ticketDrafts?: unknown;
  /** Present only once the run pauses — keeps `PausedRun` readable by `resume.ts`. */
  readonly slateIdsByKey?: Readonly<Record<string, string>>;
  readonly pausedAt?: string;
  /** Terminal payloads: exactly what the synchronous route used to return. */
  readonly awaiting?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly status: number; readonly body: unknown };
}

export async function saveRunRecord(
  projectPath: string,
  record: RunRecord,
): Promise<void> {
  await fs.mkdir(runsDir(projectPath), { recursive: true });
  await fs.writeFile(
    runFile(projectPath, record.runId),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

/** Absent/unreadable means "no such run" — the status route reports 404, never a 500. */
export async function loadRunRecord(
  projectPath: string,
  runId: string,
): Promise<RunRecord | undefined> {
  if (!isValidRunId(runId)) return undefined;
  let raw: string;
  try {
    raw = await fs.readFile(runFile(projectPath, runId), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as RunRecord;
    return parsed.runId === runId && parsed.status ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read-modify-write of one run's record. Safe without a lock because a single
 * run is driven by exactly one in-process job (`index.ts` refuses a second
 * concurrent run per project), so this file has one writer at a time — the same
 * single-writer discipline C-6 requires of the event log, applied to the same
 * unit of work.
 */
export async function patchRunRecord(
  projectPath: string,
  runId: string,
  patch: (current: RunRecord) => RunRecord,
): Promise<RunRecord | undefined> {
  const current = await loadRunRecord(projectPath, runId);
  if (!current) return undefined;
  const next = patch(current);
  await saveRunRecord(projectPath, next);
  return next;
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

/**
 * Absent, unreadable, or NOT ACTUALLY PAUSED means "no such paused run" — the
 * caller reports a 404, never a 500.
 *
 * The last clause is W10-58's doing and is easy to get wrong. Before it, this
 * file existed ONLY for a paused run, so "has a blueprintInput" was equivalent
 * to "is paused" and the predicate below was sound. Now every run writes a
 * record, and two terminal states satisfy that old test while carrying no
 * `slateIdsByKey`: a run that FAILED after the blueprint stage (its
 * blueprintInput was persisted precisely because it had been paid for), and a
 * COMPLETED one. Either would reach `applyDecisions`, which does
 * `Object.entries(paused.slateIdsByKey)` — a TypeError, i.e. a 500 on a request
 * whose honest answer is 404.
 *
 * So the check is now structural AND status-based: the record must carry the
 * slate map `applyDecisions` requires, and must not be a terminal state. A
 * missing `status` is treated as pausable so pre-W10-58 W10-67 files stay
 * readable.
 */
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
    const parsed = JSON.parse(raw) as PausedRun & { status?: RunStatus };
    const pausable = parsed.status === undefined || parsed.status === 'awaiting-decisions';
    return parsed.runId === runId && parsed.blueprintInput && parsed.slateIdsByKey && pausable
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/** Removes the paused run once it has been resumed to completion. */
export async function clearPausedRun(projectPath: string, runId: string): Promise<void> {
  if (!isValidRunId(runId)) return;
  await fs.rm(runFile(projectPath, runId), { force: true });
}
