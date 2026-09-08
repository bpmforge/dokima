/**
 * The review pass (W15-01, BLUEPRINT §2.2 R-B2, C-4): landed work gets a
 * cross-model reviewer verdict before a human ever reads the Decide card.
 * Until this module, `in_review` was a state a HUMAN cleared from evidence
 * the MAKER produced — every challenger primitive existed and none ran.
 *
 * TRUST BOUNDARY, kept the product's way (C-2, SC-12 "agents request; the
 * core executes"): the independent re-run is executed BY THE CORE in the
 * ticket's own worktree — sandboxed `reRunVerify`, the same primitive the
 * close gate trusts — never by the reviewer model. The model contributes
 * the one thing only a model can: judgment over the diff, the acceptance,
 * and the re-run's real result. If the CORE's re-run fails, the verdict is
 * CONTRADICTED by construction, whatever the model says — a component
 * never out-votes ground truth.
 *
 * MAKER != VERIFIER IS MECHANICAL (C-4/Law 9b): a reviewer resolving to
 * the maker's model REFUSES the machine review with an honest sentence on
 * the ticket rather than laundering a self-review — a single-model
 * local-only install gets the truth, not theater.
 *
 * NOTHING HERE ACCEPTS. `accept` stays a human verb; the verdict is a
 * comment + event the Decide card reads (W13-32 owns any future autonomy).
 */

import path from 'node:path';
import { appendEvent, type EventLog } from '@dokima/events';
import { commentTicket, listTickets, type Ticket } from '@dokima/tickets';
import {
  classifySubjectiveScore,
  escalateIfOverclaiming,
  formatRerunLine,
  isValidRerun,
  type CalibrationRecord,
  type RerunEvidence,
  type ReviewSignalAction,
} from '@dokima/loop';
import { reRunVerify } from './loop-gates-verify.js';
import { collectTicketSecurityChecks, securityChecksSection } from './review-security.js';
import { countsFrom, parseVerdict, reviewPrompt } from './loop-review-prompt.js';
import { collectReviewEvidence, evidenceStillCurrent } from './review-evidence.js';
// W21-75: the literal that used to sit further down was Dokima's own gate,
// duplicated; the ticket's verify command is resolved in loop-gates.ts now.
import { DEFAULT_VERIFY_COMMAND } from './loop-handoff.js';

export type ReviewVerdictKind = 'CONFIRMED' | 'CONTRADICTED' | 'UNVERIFIABLE';

export interface ReviewOutcome {
  readonly ticketId: string;
  readonly status: 'recorded' | 'skipped' | 'bounced';
  readonly verdict?: ReviewVerdictKind;
  readonly score?: number;
  readonly action?: ReviewSignalAction;
  readonly reason?: string;
}

export interface ReviewPassOptions {
  readonly log: EventLog;
  readonly actorId: string;
  readonly runId: string;
  readonly repoRoot: string;
  /** The maker model this run used — the C-4 comparison anchor. */
  readonly makerModel: string;
  /**
   * W16-01: EVERY model that made work this run. With the escalation ladder
   * live, a ticket can land on R2/R3, so a reviewer matching any rung's
   * model would be reviewing its own work. Defaults to `[makerModel]`.
   */
  readonly makerModels?: readonly string[];
  /** Resolved reviewer model, or null when no reviewer is configured. */
  readonly reviewerModel: string | null;
  /** One judgment turn: prompt in, raw model text out. Injected — routing/providers are the caller's (apps/server) concern; tests inject a fake (Law 9a). */
  readonly reviewChat: (prompt: string) => Promise<string>;
  readonly verifyTimeoutMs?: number;
  readonly secretValues?: readonly string[];
  readonly now?: () => string;
  /** W15-02 (FR-L3): the maker's calibration record, injected — the store lives in memory, which harbormaster may not import. */
  readonly makerCalibration?: () => CalibrationRecord | undefined;
  /** W23-04: where the bundled secrets scanner lives in THIS installation — apps/server resolves it; the package must not guess. */
  readonly secretsValidatorPath?: string | null;
}

export const DEFAULT_REVIEW_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

export async function runReviewPass(
  options: ReviewPassOptions,
): Promise<ReviewOutcome[]> {
  const outcomes: ReviewOutcome[] = [];
  const inReview = listTickets(options.log).filter(
    (ticket) => ticket.status === 'in_review' && ticket.manifest !== null,
  );

  for (const ticket of inReview) {
    outcomes.push(await reviewOne(options, ticket));
  }
  return outcomes;
}

async function reviewOne(
  options: ReviewPassOptions,
  ticket: Ticket,
): Promise<ReviewOutcome> {
  const record = (payload: Record<string, unknown>, eventType: string) =>
    appendEvent(
      options.log,
      {
        eventType,
        actorId: options.actorId,
        ticketId: ticket.id,
        runId: options.runId,
        payload,
      },
      { secretValues: [...(options.secretValues ?? [])] },
    );

  if (options.reviewerModel === null) {
    record({ reason: 'no reviewer model configured' }, 'review.skipped');
    return { ticketId: ticket.id, status: 'skipped', reason: 'no reviewer model' };
  }

  const makerModels = options.makerModels ?? [options.makerModel];
  if (makerModels.includes(options.reviewerModel)) {
    // C-4 honest degradation: never launder a self-review (Law 9b — a
    // single-model install still gets a working product AND the truth).
    // W16-01: the refusal set covers every rung's model, not just R1 — a
    // ticket that landed on R2 must not be reviewed by R2's model either.
    const sentence =
      `Machine review refused: the reviewer would be a model that made work ` +
      `this run (${options.reviewerModel}), and a maker's model never reviews ` +
      `its own work (C-4). Add a second model under Settings → Models for the ` +
      `code-reviewer role, or review this ticket yourself from the Decide card.`;
    commentTicket(options.log, {
      ticketId: ticket.id,
      actorId: options.actorId,
      body: sentence,
    });
    record(
      { reason: 'same model as maker', model: options.reviewerModel },
      'review.skipped',
    );
    return { ticketId: ticket.id, status: 'skipped', reason: 'same model as maker' };
  }

  // THE CORE re-runs verify in the ticket's own worktree (C-2/SC-12).
  const worktreePath = path.join(options.repoRoot, '.dokima', 'worktrees', ticket.id);
  // P6-18: the close gate already re-ran and validated the manifest's verify
  // command — for a ticket with no verify of its own, that proven command
  // outranks the workspace default (which is Node-shaped and simply cannot
  // pass in, say, a Rust worktree; the verdict it produced was CONTRADICTED
  // by the review's own command choice, not by the work).
  const command =
    ticket.verify ?? ticket.manifest?.verify.command ?? DEFAULT_VERIFY_COMMAND;
  const run = await reRunVerify(
    worktreePath,
    command,
    options.verifyTimeoutMs ?? DEFAULT_REVIEW_VERIFY_TIMEOUT_MS,
  );
  const output = `${run.stdout}\n${run.stderr}`;
  const rerun: RerunEvidence = {
    command,
    counts: countsFrom(output),
    exitCode: run.exitCode,
  };
  if (!isValidRerun(rerun)) {
    record({ reason: 'rerun evidence invalid' }, 'review.bounced');
    return { ticketId: ticket.id, status: 'bounced', reason: 'invalid rerun' };
  }

  // W23-03: the actual source change, collected by the CORE from the ticket's
  // own worktree. Incomplete evidence (dirty, oversized, unreadable, empty) is
  // carried into the prompt as an explicit "you are not looking at the code"
  // and, below, makes CONFIRMED impossible — a review of a diff nobody showed
  // the reviewer is worse than no review, because it arrives with a verdict.
  const evidenceInput = {
    ticketId: ticket.id,
    worktreePath,
    secretValues: options.secretValues ?? [],
  };
  const evidence = await collectReviewEvidence(evidenceInput);

  // W23-04: the SAME registry the onboard path runs, pointed at this ticket's
  // worktree. Local-only by default here: the review path has no settings
  // reader of its own, and reaching a network by default is the one mistake a
  // default must not make (Law 9b).
  const security = await collectTicketSecurityChecks({
    worktreePath,
    sourceDigest: evidence.sourceDigest,
    networkPolicy: 'local-only',
    secretsValidatorPath: options.secretsValidatorPath ?? null,
  });

  // One bounce allowed (R-B2: INCOMPLETE is bounced, not counted). A
  // reviewer endpoint that is down or refused skips HONESTLY — a run that
  // landed real work must never crash over its reviewer's availability.
  const prompt = reviewPrompt(
    ticket,
    rerun,
    output.slice(0, 800),
    evidence,
    securityChecksSection(security),
  );
  let raw: string;
  try {
    raw = await options.reviewChat(prompt);
  } catch (err) {
    const reason = `reviewer unavailable: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
    record({ reason }, 'review.skipped');
    return { ticketId: ticket.id, status: 'skipped', reason };
  }
  let parsed = parseVerdict(raw);
  if (!parsed) {
    record({ attempt: 1, reason: 'unparseable verdict' }, 'review.bounced');
    try {
      parsed = parseVerdict(await options.reviewChat(prompt));
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    record({ attempt: 2, reason: 'unparseable verdict — not counted' }, 'review.bounced');
    return { ticketId: ticket.id, status: 'bounced', reason: 'unparseable verdict' };
  }

  // W23-03: the source must still be the source that was reviewed. A model
  // turn takes seconds to minutes and nothing stops the session, a person or a
  // concurrent berth from committing during it, so the head is re-read AFTER
  // the answer rather than trusted from before it.
  const stillCurrent =
    evidence.complete && (await evidenceStillCurrent(evidence, evidenceInput));

  // Ground truth out-votes the model: a failing core re-run IS a
  // contradiction, whatever the reviewer said (C-2).
  const gatePassed = run.exitCode === 0;
  // W23-03: and a CONFIRMED that rests on evidence the reviewer never saw, or
  // on a tree that has since moved, is downgraded to UNVERIFIABLE rather than
  // recorded as a confirmation. Never upgraded — a CONTRADICTED stays
  // contradicted whatever the evidence looked like.
  const evidenceUsable = evidence.complete && stillCurrent;
  const modelVerdict: ReviewVerdictKind =
    parsed.verdict === 'CONFIRMED' && !evidenceUsable ? 'UNVERIFIABLE' : parsed.verdict;
  const verdict: ReviewVerdictKind = gatePassed ? modelVerdict : 'CONTRADICTED';
  // Advisory score classifies only over a PASSING deterministic gate
  // (classifySubjectiveScore's own contract) — over a failing one the
  // verdict alone speaks. W15-02: a chronically over-claiming maker's
  // BORDERLINE signal escalates to a person (asymmetric — never toward
  // accept; escalateIfOverclaiming's own contract).
  let action: ReviewSignalAction | undefined;
  let overclaiming = false;
  if (gatePassed) {
    const calibrated = escalateIfOverclaiming(
      classifySubjectiveScore(parsed.score),
      options.makerCalibration?.(),
    );
    action = calibrated.action;
    overclaiming = calibrated.overclaiming;
  }

  const rerunLine = formatRerunLine(rerun);
  const lines = [
    `Review verdict: ${verdict} (score ${parsed.score}/10${
      action ? ` — ${action}` : ''
    }) — reviewed by ${options.reviewerModel}; maker ${options.makerModel}`,
    rerunLine,
    parsed.reasoning,
  ];
  if (overclaiming && action === 'ESCALATE_TO_HUMAN') {
    lines.splice(
      1,
      0,
      `Escalated to you: this maker (${options.makerModel}) has historically claimed done more often than the gate confirmed, so its borderline work gets a person's eyes (FR-L3).`,
    );
  }
  if (!gatePassed) {
    lines.splice(
      1,
      0,
      `The core's independent re-run FAILED (exit ${run.exitCode}) — the verdict is CONTRADICTED by construction; the model's opinion cannot out-vote the gate.`,
    );
  }
  if (!evidenceUsable) {
    lines.splice(
      1,
      0,
      !evidence.complete
        ? `The reviewer was NOT shown the source change: ${evidence.reason}. A CONFIRMED on this evidence is recorded as UNVERIFIABLE.`
        : `The worktree changed while the review was running, so the verdict describes code that is no longer there; recorded as UNVERIFIABLE.`,
    );
  }
  commentTicket(options.log, {
    ticketId: ticket.id,
    actorId: options.actorId,
    body: lines.filter(Boolean).join('\n'),
  });
  record(
    {
      verdict,
      score: parsed.score,
      action: action ?? null,
      rerunLine,
      reviewerModel: options.reviewerModel,
      makerModel: options.makerModel,
      gatePassed,
      overclaiming,
      // W23-03: what this verdict is ABOUT. A verdict with no head and no
      // digest cannot be checked for staleness later, which is how a stale
      // approval gets reused (IMPLEMENTATION_PLAN §6).
      reviewedHead: evidence.headCommit,
      reviewedBase: evidence.baseCommit,
      sourceDigest: evidence.sourceDigest,
      evidenceComplete: evidence.complete,
      evidenceReason: evidence.reason,
      evidenceStillCurrent: stillCurrent,
      modelVerdict: parsed.verdict,
      // W23-04: what the CORE executed, beside what the model said about it.
      securityChecks: security.evidence.map((c) => ({
        checkId: c.checkId,
        status: c.status,
        exitCode: c.exitCode,
        findingCount: c.findingCount,
        reason: c.reason,
      })),
      securityChecksEligible: security.eligible,
    },
    'review.verdict',
  );
  return {
    ticketId: ticket.id,
    status: 'recorded',
    verdict,
    score: parsed.score,
    action,
  };
}
