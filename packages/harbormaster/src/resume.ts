/**
 * Receipt-based resume (BLUEPRINT §3.6, FR-H3, UC-11): after a crash mid-
 * build, `resumeProject` looks at every ticket a berth still owns
 * (`claimed`/`in_progress`) and asks, per ticket, "does its receipts row
 * prove the close gate already passed?" — never re-running the gate itself
 * ("re-verified, not redone"). A ticket with no close receipt at all is
 * left exactly alone (UC-11 "ticket B": a fresh session picks it back up
 * from the HANDOFF; that's `loop-claim.ts`'s job, not this one's).
 *
 * SECURITY (CRITICAL, review-caught partial-commit — FR-H3, Law 7): this
 * function is TWO-PHASE and all-or-nothing, because the event log is
 * append-only — a partial commit could never be rolled back if a later
 * ticket in the same batch turned out to have drifted.
 *
 * PHASE 1 (`checkClaimedTicket`, called once per claimed ticket): check-only,
 * zero event-log writes. It reads the ticket's latest close receipt (if
 * any), recomputes the receipt's declared files straight off disk, and
 * calls `verifyReceipt` — which independently re-checks the anchor MAC
 * (does the event log agree this receipt is real, not a forged/injected
 * row?), the input-tree hash (does disk still match what the receipt
 * attested to?), and validator currency (has the required validator set
 * moved on since?). `checkClaimedTicket` never calls `closeTicket` and
 * never appends an event — that move is deliberate: an earlier version of
 * this function called `closeTicket` from inside the per-ticket check, so a
 * batch whose LAST ticket drifted still left every earlier ticket's
 * `ticket.closed` event permanently on the append-only log by the time the
 * drift was discovered. There is no such window now because nothing here
 * writes at all.
 *
 * PHASE 2 (inline in `resumeProject`, reached ONLY if every check from phase
 * 1 came back `'valid'` or `'no-receipt'` — zero `'drift'` entries anywhere
 * in the batch): calls the real `closeTicket` for every `'valid'` ticket,
 * folding the already-proven close into the log. If even one ticket
 * drifted, `resumeProject` returns `{ok: false, driftReport}` immediately
 * after phase 1, having appended nothing for this call, and phase 2 never
 * runs — the whole resume refuses, not just the drifted ticket.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getReceipt,
  listEvents,
  verifyReceipt,
  type EventLog,
  type ReceiptInputFile,
} from '@shipwright/events';
import { closeTicket, listTickets, type Ticket } from '@shipwright/tickets';
import { DEFAULT_REQUIRED_VALIDATORS } from './loop-gates-types.js';
import { classifyManifestFile, classifyManifestFiles } from './scope.js';
import type {
  CheckClaimedTicketOptions,
  ClaimedTicketCheck,
  ResumeProjectOptions,
  ResumeProjectResult,
} from './resume-types.js';

export type {
  CheckClaimedTicketOptions,
  ClaimedTicketCheck,
  ResumeDriftEntry,
  ResumeProjectOptions,
  ResumeProjectRefusal,
  ResumeProjectResult,
  ResumeProjectSuccess,
} from './resume-types.js';

interface ReceiptMintPayload {
  receiptId?: unknown;
  kind?: unknown;
}

/** Walks the anchoring `gate.receipt_minted` events backward for this ticket to find its latest close receipt. Never trusts `receipts` rows directly — only ones a real anchoring event names. */
function findLatestCloseReceipt(log: EventLog, ticketId: string) {
  const anchors = listEvents(log).filter(
    (event) => event.eventType === 'gate.receipt_minted' && event.ticketId === ticketId,
  );
  for (const anchor of anchors.slice().reverse()) {
    const payload = anchor.payload as ReceiptMintPayload | null;
    if (payload?.kind !== 'close' || typeof payload.receiptId !== 'string') continue;
    const receipt = getReceipt(log, payload.receiptId);
    if (receipt && receipt.kind === 'close') return receipt;
  }
  return undefined;
}

interface CloseReceiptPayload {
  files?: unknown;
  commits?: unknown;
}

function receiptFiles(receipt: { payload: unknown }): string[] {
  const payload = receipt.payload as CloseReceiptPayload | null;
  const files = payload?.files;
  return Array.isArray(files)
    ? files.filter((f): f is string => typeof f === 'string')
    : [];
}

function receiptCommits(receipt: { payload: unknown }): string[] {
  const payload = receipt.payload as CloseReceiptPayload | null;
  const commits = payload?.commits;
  return Array.isArray(commits)
    ? commits.filter((c): c is string => typeof c === 'string')
    : [];
}

/**
 * PHASE 1 for one ticket — check-only, appends nothing. Returns `'no-
 * receipt'` (leave the ticket alone), `'valid'` (a real close receipt still
 * checks out against the live log/disk), or `'drift'` (event log, receipt,
 * and disk disagree — carries the human-readable reasons from `verifyReceipt`
 * plus this function's own disk-presence check).
 */
export async function checkClaimedTicket(
  log: EventLog,
  ticket: Ticket,
  options: CheckClaimedTicketOptions,
): Promise<ClaimedTicketCheck> {
  const receipt = findLatestCloseReceipt(log, ticket.id);
  if (!receipt) {
    return { outcome: 'no-receipt', ticketId: ticket.id };
  }

  const worktreePath = path.join(options.repoRoot, '.shipwright', 'worktrees', ticket.id);
  const files = receiptFiles(receipt);

  // SECURITY (W1-07 symlink-escape class): resolved via fs.realpath and
  // checked against the worktree's real root before anything below stats,
  // reads, or hashes a receipt-claimed path — mirrors loop-gates.ts's close
  // gate (scope.ts's module doc).
  const { missing, symlinkEscapes } = await classifyManifestFiles(worktreePath, files);
  if (missing.length > 0 || symlinkEscapes.length > 0) {
    const reasons: string[] = [];
    if (missing.length > 0) {
      reasons.push(
        `receipt ${receipt.id} declares file(s) no longer present on disk: ${missing.join(', ')}`,
      );
    }
    if (symlinkEscapes.length > 0) {
      reasons.push(
        `receipt ${receipt.id} declares file(s) that resolve outside the worktree via a ` +
          `symlink and are refused (symlink-escape, W1-07 class): ${symlinkEscapes.join(', ')}`,
      );
    }
    return { outcome: 'drift', ticketId: ticket.id, reasons };
  }

  // SECURITY (TOCTOU, W1-07 class): re-resolve and re-verify containment for
  // each file immediately before it is read for hashing — classifyManifestFile
  // holds a single fd across its own containment check and the read, so the
  // escape refusal holds atomically at read time, mirroring loop-gates.ts's
  // close-gate read.
  const realRootAtReadTime = await fs.realpath(worktreePath);
  const readTimeMissing: string[] = [];
  const readTimeEscapes: string[] = [];
  const entries = await Promise.all(
    files.map(async (file): Promise<ReceiptInputFile | null> => {
      const result = await classifyManifestFile(worktreePath, realRootAtReadTime, file);
      if (result.status === 'missing') {
        readTimeMissing.push(file);
        return null;
      }
      if (result.status === 'symlink-escape') {
        readTimeEscapes.push(file);
        return null;
      }
      return { path: file, content: result.content as string };
    }),
  );
  if (readTimeMissing.length > 0 || readTimeEscapes.length > 0) {
    const reasons: string[] = [];
    if (readTimeMissing.length > 0) {
      reasons.push(
        `receipt ${receipt.id} declares file(s) that vanished from disk between the initial ` +
          `check and the read (TOCTOU): ${readTimeMissing.join(', ')}`,
      );
    }
    if (readTimeEscapes.length > 0) {
      reasons.push(
        `receipt ${receipt.id} declares file(s) that resolve outside the worktree via a ` +
          'symlink introduced after the initial check and are refused at read time ' +
          `(symlink-escape, W1-07 class, TOCTOU): ${readTimeEscapes.join(', ')}`,
      );
    }
    return { outcome: 'drift', ticketId: ticket.id, reasons };
  }
  const inputFiles = entries as ReceiptInputFile[];

  const verification = verifyReceipt(log, receipt.id, {
    signingKey: options.signingKey,
    inputFiles,
    requiredValidators: options.requiredValidators ?? DEFAULT_REQUIRED_VALIDATORS,
  });

  if (!verification.valid) {
    return { outcome: 'drift', ticketId: ticket.id, reasons: verification.reasons };
  }

  return { outcome: 'valid', ticketId: ticket.id, ticket, receipt };
}

/** Two-phase, all-or-nothing resume (FR-H3) — see this module's doc comment. */
export async function resumeProject(
  options: ResumeProjectOptions,
): Promise<ResumeProjectResult> {
  const { log } = options;
  const claimed = listTickets(log).filter(
    (ticket) => ticket.status === 'claimed' || ticket.status === 'in_progress',
  );

  // PHASE 1 — check-only. No closeTicket call and no appendEvent happen
  // anywhere in this loop or in checkClaimedTicket.
  const checks: ClaimedTicketCheck[] = [];
  for (const ticket of claimed) {
    checks.push(await checkClaimedTicket(log, ticket, options));
  }

  const drifted = checks.filter(
    (check): check is Extract<ClaimedTicketCheck, { outcome: 'drift' }> =>
      check.outcome === 'drift',
  );
  if (drifted.length > 0) {
    return {
      ok: false,
      driftReport: drifted.map((check) => ({
        ticketId: check.ticketId,
        reasons: check.reasons,
      })),
    };
  }

  // PHASE 2 — commit. Reached only when every ticket in this batch passed
  // phase 1 (valid or no-receipt); the earlier drift check would have
  // already returned before a single event was appended.
  const closed: Ticket[] = [];
  for (const check of checks) {
    if (check.outcome !== 'valid') continue;
    const owner = check.ticket.ownerId;
    if (!owner) {
      throw new Error(
        `ticket ${check.ticketId} is claimed with no ownerId — cannot close on its behalf`,
      );
    }
    closed.push(
      closeTicket(
        log,
        {
          ticketId: check.ticketId,
          actorId: owner,
          files: receiptFiles(check.receipt),
          commits: receiptCommits(check.receipt),
          verify: {
            command: check.receipt.verifyCommand ?? '',
            exitCode: check.receipt.verifyExit ?? 0,
          },
        },
        { now: options.now },
      ),
    );
  }

  return {
    ok: true,
    closed,
    skipped: checks
      .filter((check) => check.outcome === 'no-receipt')
      .map((check) => check.ticketId),
  };
}
