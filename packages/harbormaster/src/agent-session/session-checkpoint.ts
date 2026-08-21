/**
 * session-checkpoint.ts — the partial manifest a budget-stopped session
 * leaves behind (W17-02).
 *
 * The 2026-08-21 UAT showed attempt 2 re-deriving everything attempt 1
 * knew: the worktree persists, the session's understanding does not. When
 * a session stops on BUDGET (exhausted or early-stopped — never on error),
 * it gets ONE final tool-free turn to state where it got to, as strict
 * JSON. That text is EVIDENCE, not a claim of done (C-2: only the close
 * gate decides done) — the next attempt's handoff leads with it so the
 * model continues instead of rediscovering, and the loop cross-checks it
 * against the REAL worktree diff, flagging a checkpoint that claims
 * completed work the diff does not show.
 *
 * The final turn is best-effort: a provider failure or unparseable answer
 * degrades to no checkpoint — it must never mask the budget stop itself.
 */

export const CHECKPOINT_MARKER = 'SESSION_CHECKPOINT ';

export const CHECKPOINT_REQUEST =
  'Your tool budget for this session is used up. Do not call tools. Reply with ' +
  'ONE line of JSON only, exactly this shape, so the next session can continue ' +
  'your work instead of restarting it: ' +
  '{"completed":["…"],"remaining":["…"],"next":"the single next concrete step"}';

export interface SessionCheckpoint {
  readonly completed: readonly string[];
  readonly remaining: readonly string[];
  readonly next: string;
}

/** Renders the stderr line the loop parses back out. */
export function checkpointStderrLine(checkpoint: SessionCheckpoint): string {
  return `${CHECKPOINT_MARKER}${JSON.stringify(checkpoint)}`;
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string').slice(0, 12)
    : [];

/** Parses a model's checkpoint reply — strict-ish: the first JSON object found; anything unusable is null, never a guess. */
export function parseCheckpointReply(text: string): SessionCheckpoint | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const checkpoint: SessionCheckpoint = {
      completed: asStrings(raw.completed),
      remaining: asStrings(raw.remaining),
      next: typeof raw.next === 'string' ? raw.next : '',
    };
    if (
      checkpoint.completed.length === 0 &&
      checkpoint.remaining.length === 0 &&
      checkpoint.next === ''
    ) {
      return null;
    }
    return checkpoint;
  } catch {
    return null;
  }
}

/** Finds the checkpoint line in a finished session's combined output. */
export function extractSessionCheckpoint(output: string): SessionCheckpoint | null {
  for (const line of output.split('\n')) {
    if (!line.startsWith(CHECKPOINT_MARKER)) continue;
    return parseCheckpointReply(line.slice(CHECKPOINT_MARKER.length));
  }
  return null;
}
