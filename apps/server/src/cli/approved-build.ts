/**
 * cli/approved-build.ts — recording and validating what the user actually
 * approved before an unattended build may claim anything (W23-02, AB-02).
 *
 * WHAT IS BEING DEFENDED. An unattended build works from an approval a person
 * gave at one moment against one specification. Everything that goes wrong
 * here goes wrong the same way: the specification moves and the approval does
 * not. Someone edits an acceptance criterion, widens a write scope, swaps the
 * model policy or raises the budget, and a run started yesterday keeps going
 * under a permission it no longer has.
 *
 * SO THE DIGEST COVERS THE SPECIFICATION AND NOTHING ELSE. Ticket acceptance
 * TEXT, write scopes, dependencies, roles, verify commands, titles, lanes —
 * plus the model policy and the budget. It deliberately excludes every
 * mutable execution fact: `status`, `ownerId`, `claimedAt`, `runId`, the
 * manifest, the history, the evidence, and each acceptance criterion's own
 * `done` flag. Progress must never invalidate an approval (a run that
 * completed three tickets would otherwise invalidate itself on the fourth),
 * and a specification edit must always invalidate it. Those two sentences are
 * the whole design, and the test file asserts both directions.
 *
 * THE BOARD THAT MATTERS IS THE EVENT LOG. `plan.json` is Dokima's own
 * development board; a product project's tickets live in `state.db` and are
 * read with `loadTickets`. Digesting the wrong one would have produced an
 * approval that never changed for any real user.
 *
 * OPT-IN IS EXPLICIT AND AT BOTH ENTRANCES. A legacy project whose autonomy
 * dial says `auto` chose that before this existed and gets exactly its old
 * behaviour; `approvedBuild` has to be set by the caller (a CLI flag, an HTTP
 * field), and the validation runs inside `executeBuildRun`, which the HTTP job
 * and the CLI both go through — a precondition only one entrance enforces is
 * not a precondition (the same reasoning `runs-routes.ts` already applies to
 * the signing key).
 */

import { appendEvent, listEvents, type EventLog } from '@dokima/events';
import { digestOf } from '@dokima/mcp';
import { loadTickets } from '@dokima/tickets';
import {
  APPROVED_BUILD_POLICY_VERSION,
  type ApprovedBuildPolicy,
} from '@dokima/harbormaster';
import type { JsonValue } from '@dokima/shared';

/**
 * The default automatic review/repair rounds an approval covers
 * (IMPLEMENTATION_PLAN §7: "at most 3", and never exceeding a tighter existing
 * session, token, spend or policy limit). Part of the digest, so raising it is
 * a specification change that invalidates the approval rather than a quiet
 * loosening of it.
 */
export const DEFAULT_APPROVED_BUILD_REPAIR_ROUNDS = 3;

/** The event type an approval is recorded as. Append-only, like everything else (C-6). */
export const APPROVED_BUILD_EVENT = 'build.approval.recorded';

/** The non-ticket half of the approved specification: what the user chose about how it runs. */
export interface ApprovedBuildRunInputs {
  readonly projectId: string;
  /** The model policy as stored in settings — a specification, never a credential. */
  readonly modelPolicy: JsonValue | null;
  readonly budgetCents: number;
  readonly maxRepairRounds: number;
}

/**
 * The run inputs, built ONCE from the command (W23-13).
 *
 * Two call sites need this digest — the preflight that validates the approval,
 * and the acceptance that re-checks it against the current inputs — and until
 * this function they each constructed the object by hand from the same two
 * fields. Two hand-built copies of a digest input is a drift class, not a
 * duplication nit: the day they disagree, every machine acceptance refuses as
 * stale for a reason nobody can see, or worse, one of them approves against a
 * specification the other never validated.
 */
export function approvedBuildRunInputs(command: {
  readonly projectId: string;
  readonly budgetUsd?: number | null;
}): ApprovedBuildRunInputs {
  return {
    projectId: command.projectId,
    // Null rather than a guess: a wrong value would make an approval invalid
    // for a reason nobody could see.
    modelPolicy: null,
    // Cents, because a float dollar amount is not a stable digest input.
    budgetCents: Math.round((command.budgetUsd ?? 0) * 100),
    maxRepairRounds: DEFAULT_APPROVED_BUILD_REPAIR_ROUNDS,
  };
}

/**
 * The specification of one ticket, reduced to the fields a person approved.
 * Built by hand rather than by deleting keys from `Ticket`, so a new mutable
 * field added to `Ticket` later cannot silently join the digest and start
 * invalidating approvals on progress.
 */
interface TicketSpecification {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly lane: string;
  readonly role: string | null;
  readonly verify: string | null;
  readonly writeScope: readonly string[];
  readonly dependsOn: readonly string[];
  /** Criterion id + text only. `done` is progress, and progress is not specification. */
  readonly acceptance: readonly { readonly id: string; readonly text: string }[];
}

/**
 * The canonical object a digest is taken over. Exported for the test and for
 * a future surface that wants to show a person exactly what they are
 * approving — a digest nobody can see the inputs of is a number, not a record.
 */
export function approvedBuildSpecification(
  log: EventLog,
  inputs: ApprovedBuildRunInputs,
): {
  readonly version: string;
  readonly projectId: string;
  readonly modelPolicy: JsonValue | null;
  readonly budgetCents: number;
  readonly maxRepairRounds: number;
  readonly tickets: readonly TicketSpecification[];
} {
  const tickets = Array.from(loadTickets(log).values())
    .map((t): TicketSpecification => ({
      id: t.id,
      title: t.title,
      type: t.type,
      lane: t.lane,
      role: t.role ?? null,
      verify: t.verify,
      // Copied, then sorted: two boards that list the same scope in a
      // different order are the same specification, and `stableStringify`
      // sorts object keys but not array members.
      writeScope: [...t.writeScope].sort(),
      dependsOn: [...t.dependsOn].sort(),
      acceptance: t.acceptance.map((a) => ({ id: a.id, text: a.text })),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: APPROVED_BUILD_POLICY_VERSION,
    projectId: inputs.projectId,
    modelPolicy: inputs.modelPolicy,
    budgetCents: inputs.budgetCents,
    maxRepairRounds: inputs.maxRepairRounds,
    tickets,
  };
}

/** sha256 over the canonical specification. `digestOf` sorts keys, so key order cannot change it. */
export function approvedBuildDigest(
  log: EventLog,
  inputs: ApprovedBuildRunInputs,
): string {
  return `sha256:${digestOf(approvedBuildSpecification(log, inputs))}`;
}

export interface RecordApprovedBuildInput extends ApprovedBuildRunInputs {
  /** The HUMAN who approved. A machine actor recording its own approval is the thing this prevents. */
  readonly actorId: string;
}

/**
 * Appends the approval. The payload carries the version, the digest and the
 * budget — never the specification itself and never a credential: the log is
 * append-only and permanent, and FR-S2 does not stop applying because a
 * payload is convenient.
 */
export function recordApprovedBuild(
  log: EventLog,
  input: RecordApprovedBuildInput,
): { readonly approvalId: string; readonly inputDigest: string } {
  const inputDigest = approvedBuildDigest(log, input);
  const record = appendEvent(log, {
    eventType: APPROVED_BUILD_EVENT,
    actorId: input.actorId,
    payload: {
      version: APPROVED_BUILD_POLICY_VERSION,
      projectId: input.projectId,
      inputDigest,
      budgetCents: input.budgetCents,
      maxRepairRounds: input.maxRepairRounds,
    },
  });
  return { approvalId: `${record.seq}`, inputDigest };
}

interface StoredApproval {
  readonly approvalId: string;
  readonly projectId: string;
  readonly inputDigest: string;
  readonly budgetCents: number;
  readonly maxRepairRounds: number;
}

/**
 * The newest approval for this project, or null. Reads the log rather than a
 * projection deliberately: an approval is rare, and a projection is a cache
 * whose staleness would be indistinguishable from a revoked approval.
 */
export function readLatestApprovedBuild(
  log: EventLog,
  projectId: string,
): StoredApproval | null {
  let found: StoredApproval | null = null;
  for (const event of listEvents(log)) {
    if (event.eventType !== APPROVED_BUILD_EVENT) continue;
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload || payload.projectId !== projectId) continue;
    if (payload.version !== APPROVED_BUILD_POLICY_VERSION) continue;
    if (typeof payload.inputDigest !== 'string') continue;
    found = {
      approvalId: `${event.seq}`,
      projectId,
      inputDigest: payload.inputDigest,
      budgetCents: typeof payload.budgetCents === 'number' ? payload.budgetCents : 0,
      maxRepairRounds:
        typeof payload.maxRepairRounds === 'number' ? payload.maxRepairRounds : 0,
    };
  }
  return found;
}

export type ApprovedBuildValidation =
  /** Not opted in. The run proceeds exactly as it did before this file existed. */
  | { readonly status: 'legacy' }
  /** Opted in and provable. `policy` is what the runtime carries — never the request body. */
  | { readonly status: 'approved'; readonly policy: ApprovedBuildPolicy }
  /** Opted in and not provable. The caller refuses before claiming anything. */
  | { readonly status: 'refused'; readonly reason: string };

export interface ValidateApprovedBuildInput extends ApprovedBuildRunInputs {
  /** Set only by an explicit caller opt-in. A legacy `autonomy=auto` setting does not set it. */
  readonly optedIn: boolean;
}

/**
 * The one validation both entrances go through. Called from
 * `executeBuildRun`, which is the shared path for the HTTP job and the CLI, so
 * the two cannot disagree about what an approved build is.
 */
export function validateApprovedBuild(
  log: EventLog,
  input: ValidateApprovedBuildInput,
): ApprovedBuildValidation {
  if (!input.optedIn) return { status: 'legacy' };

  const stored = readLatestApprovedBuild(log, input.projectId);
  if (!stored) {
    return {
      status: 'refused',
      reason:
        `this run asked for an approved build (${APPROVED_BUILD_POLICY_VERSION}) and the project has ` +
        `recorded no approval. Nothing was claimed. An autonomy setting is not an approval — the ` +
        `approval names the exact design, acceptance, scopes, model policy and budget it covers.`,
    };
  }

  const current = approvedBuildDigest(log, input);
  if (stored.inputDigest !== current) {
    return {
      status: 'refused',
      reason:
        `the approved build inputs changed since approval ${stored.approvalId} ` +
        `(approved ${stored.inputDigest}, current ${current}). Nothing was claimed. ` +
        `Ticket acceptance, write scopes, dependencies, the model policy or the budget were edited; ` +
        `progress alone never does this. Re-approve the current specification to continue.`,
    };
  }

  return {
    status: 'approved',
    policy: {
      version: APPROVED_BUILD_POLICY_VERSION,
      projectId: input.projectId,
      approvalId: stored.approvalId,
      inputDigest: stored.inputDigest,
      budgetCents: stored.budgetCents,
      maxRepairRounds: stored.maxRepairRounds,
    },
  };
}

/**
 * The preflight `executeBuildRun` calls, and the only place a refusal is
 * turned into an exit code and a line a person reads. Kept beside the
 * validation it wraps rather than inline in `run-build.ts`: that file is at
 * the 400-line chapter cap, and this is one concern, not a fragment of the
 * run loop.
 *
 * Returns the reconstructed policy — never the caller's request — so later
 * cards carry a validated value through the runtime rather than a flag from
 * an HTTP body (IMPLEMENTATION_PLAN §8).
 */
export function approvedBuildPreflight(
  log: EventLog,
  command: {
    readonly projectId: string;
    readonly approvedBuild?: boolean;
    readonly budgetUsd?: number | null;
  },
  runId: string,
  io: { stdout: (line: string) => void; stderr: (line: string) => void },
):
  | { readonly refused: true }
  | { readonly refused: false; readonly policy: ApprovedBuildPolicy | null } {
  const result = validateApprovedBuild(log, {
    optedIn: command.approvedBuild === true,
    ...approvedBuildRunInputs(command),
  });

  if (result.status === 'refused') {
    io.stderr(`${runId} did not start: ${result.reason}`);
    return { refused: true };
  }
  if (result.status === 'approved') {
    io.stdout(
      `${runId} runs under approval ${result.policy.approvalId} ` +
        `(${result.policy.version}, inputs ${result.policy.inputDigest})`,
    );
    return { refused: false, policy: result.policy };
  }
  return { refused: false, policy: null };
}
