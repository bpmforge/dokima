/**
 * One repair batch out of many sources (W23-09, AB-09).
 *
 * A ticket's repair round has to act on findings that arrive from three very
 * different places: a scanner's structured output, a specialist model's
 * reading of that output, and a reviewer's judgement over the diff. Left
 * unconsolidated they are three lists with overlapping contents and no shared
 * vocabulary, and the maker is handed the same defect three times with three
 * different titles.
 *
 * DEDUPLICATION IS BY IDENTITY, NEVER BY RESEMBLANCE. Two findings are the
 * same finding when their rule, their normalized path, their location and
 * their evidence fingerprint match — not when their titles read alike. "SQL
 * injection in the user lookup" at two different files is two defects, and
 * merging them because a model phrased them similarly is how one of them
 * silently stops existing. The tests assert both directions, because the
 * failure of a deduplicator is always the merge you cannot see.
 *
 * A HYPOTHESIS IS NOT A DEFECT, AND CONSOLIDATION MAY NOT PROMOTE ONE. A
 * scanner that matched a rule and a model that thinks something looks wrong
 * are different kinds of claim; `confidenceKind` keeps them apart all the way
 * through, and merging a hypothesis into a tool-confirmed finding raises the
 * confirmed one's origin list without lowering its confidence. Nor may it
 * erase one: an unconfirmed hypothesis stays in the batch, marked.
 *
 * PATHS ARE NORMALIZED AND ESCAPES ARE REFUSED. A finding's path is a relative
 * path inside the worktree. Anything that climbs out of it — `..`, an absolute
 * path, a Windows drive letter — is rejected rather than normalized into
 * something plausible, because a repair batch is a list of files something is
 * about to edit.
 */

import path from 'node:path';

export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Where a claim came from, and therefore how much it is worth. */
export type ConfidenceKind = 'tool-confirmed' | 'review-hypothesis';

/** One finding as it arrives, before consolidation. Origin records are preserved verbatim. */
export interface RawFinding {
  /** The id of the check or reviewer that produced it — `tool-sast`, `security-owasp-web`, `review`. */
  readonly originId: string;
  readonly ruleId: string;
  /** Worktree-relative. Validated, never repaired. */
  readonly path: string;
  /** Line, line range, or symbol — whatever the origin gave. Part of identity. */
  readonly location: string;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly confidenceKind: ConfidenceKind;
  /** Digest or excerpt identifying the specific evidence, so two matches on one line are still two findings when they differ. */
  readonly evidenceFingerprint: string;
  /** Evidence artifacts a person can open. */
  readonly evidenceRefs?: readonly string[];
}

export interface RepairFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly path: string;
  readonly location: string;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly confidenceKind: ConfidenceKind;
  readonly evidenceFingerprint: string;
  readonly evidenceRefs: readonly string[];
  /** Every origin that reported this same finding. Never collapsed to one. */
  readonly originIds: readonly string[];
  /** The ticket whose write scope owns this path, or null when nothing does. */
  readonly ownerTicketId: string | null;
  /** The checks that must pass before this repair may be called done. Runtime-chosen. */
  readonly verificationCheckIds: readonly string[];
}

export interface RejectedFinding {
  readonly raw: RawFinding;
  readonly reason: string;
}

export interface RepairBatch {
  /** In-scope findings, grouped below by owner. */
  readonly findings: readonly RepairFinding[];
  /** Findings whose path no ticket owns: an explicit proposal, never a silent scope extension. */
  readonly outOfScope: readonly RepairFinding[];
  /** Findings that could not be normalized at all, with the reason. */
  readonly rejected: readonly RejectedFinding[];
}

export interface TicketScope {
  readonly ticketId: string;
  /** Worktree-relative globs, exactly as the board records them. */
  readonly writeScope: readonly string[];
}

export interface ConsolidateInput {
  readonly raw: readonly RawFinding[];
  readonly scopes: readonly TicketScope[];
  /**
   * The checks the RUNTIME will run to verify a repair, by rule prefix or check
   * id. A model may suggest a command; only this decides what executes
   * (AB-09 step 4).
   */
  readonly verificationChecks: readonly string[];
}

/**
 * Normalizes a worktree-relative path, or refuses. Refusal rather than repair
 * is the whole point: a path that escapes the worktree is not a typo to be
 * fixed, it is a finding that must not become an edit.
 */
export function normalizeFindingPath(
  raw: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'empty path' };
  if (path.isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return {
      ok: false,
      reason: `absolute path (${trimmed}) — findings are worktree-relative`,
    };
  }
  if (trimmed.includes('\0')) return { ok: false, reason: 'path contains a null byte' };

  const normalized = path.posix.normalize(trimmed.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    return { ok: false, reason: `path escapes the worktree (${trimmed})` };
  }
  return { ok: true, path: normalized.replace(/^\.\//, '') };
}

/**
 * A finding's identity. Rule, path, location and evidence — deliberately NOT
 * the title, which is prose and varies with whichever model wrote it.
 */
export function findingIdentity(finding: {
  ruleId: string;
  path: string;
  location: string;
  evidenceFingerprint: string;
}): string {
  return [
    finding.ruleId,
    finding.path,
    finding.location,
    finding.evidenceFingerprint,
  ].join('|');
}

/** Simple glob match over worktree-relative paths — `**` spans directories, `*` does not. */
function matchesScope(filePath: string, glob: string): boolean {
  const pattern = glob
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replaceAll('**/', '(?:.*/)?')
    .replaceAll('**', '.*')
    .replace(/(?<!\.)\*/g, '[^/]*')
    .replaceAll('?', '[^/]');
  return new RegExp(`^${pattern}$`).test(filePath);
}

const SEVERITY_ORDER: readonly FindingSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Higher of two severities. A merge never lowers one — the same "raise never lower" direction FR-N2 uses. */
function higherSeverity(a: FindingSeverity, b: FindingSeverity): FindingSeverity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

/**
 * A merge never LOWERS confidence: a tool-confirmed finding that a model also
 * reported is still tool-confirmed. And it never RAISES it either — two
 * hypotheses about the same line are still a hypothesis, however many models
 * agree. Agreement between models is not evidence; it is correlation between
 * models.
 */
function mergedConfidence(a: ConfidenceKind, b: ConfidenceKind): ConfidenceKind {
  return a === 'tool-confirmed' || b === 'tool-confirmed'
    ? 'tool-confirmed'
    : 'review-hypothesis';
}

export function consolidateFindings(input: ConsolidateInput): RepairBatch {
  const rejected: RejectedFinding[] = [];
  const byIdentity = new Map<string, RepairFinding>();

  for (const raw of input.raw) {
    const normalized = normalizeFindingPath(raw.path);
    if (!normalized.ok) {
      rejected.push({ raw, reason: normalized.reason });
      continue;
    }
    if (raw.ruleId.trim() === '') {
      rejected.push({
        raw,
        reason: 'no rule id — a finding nothing can be verified against',
      });
      continue;
    }
    if (raw.evidenceFingerprint.trim() === '') {
      rejected.push({
        raw,
        reason:
          'no evidence fingerprint — two findings on one line would be indistinguishable',
      });
      continue;
    }

    const verificationCheckIds = input.verificationChecks.filter(
      (checkId) => raw.ruleId.startsWith(checkId) || raw.originId === checkId,
    );
    if (verificationCheckIds.length === 0) {
      rejected.push({
        raw,
        reason:
          `no runtime check can verify a repair of ${raw.ruleId} — a repair nothing can confirm ` +
          `is a suggestion, not a batch item`,
      });
      continue;
    }

    const identity = findingIdentity({ ...raw, path: normalized.path });
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, {
        id: identity,
        ruleId: raw.ruleId,
        path: normalized.path,
        location: raw.location,
        severity: raw.severity,
        title: raw.title,
        confidenceKind: raw.confidenceKind,
        evidenceFingerprint: raw.evidenceFingerprint,
        evidenceRefs: [...(raw.evidenceRefs ?? [])],
        originIds: [raw.originId],
        ownerTicketId: null,
        verificationCheckIds,
      });
      continue;
    }

    // EVERY ORIGIN IS RETAINED. Losing one loses the ability to say which
    // scanner found it, which is the difference between a defect and a rumour.
    byIdentity.set(identity, {
      ...existing,
      severity: higherSeverity(existing.severity, raw.severity),
      confidenceKind: mergedConfidence(existing.confidenceKind, raw.confidenceKind),
      evidenceRefs: [...new Set([...existing.evidenceRefs, ...(raw.evidenceRefs ?? [])])],
      originIds: existing.originIds.includes(raw.originId)
        ? existing.originIds
        : [...existing.originIds, raw.originId],
      verificationCheckIds: [
        ...new Set([...existing.verificationCheckIds, ...verificationCheckIds]),
      ],
    });
  }

  const findings: RepairFinding[] = [];
  const outOfScope: RepairFinding[] = [];
  for (const finding of byIdentity.values()) {
    const owner = input.scopes.find((scope) =>
      scope.writeScope.some((glob) => matchesScope(finding.path, glob)),
    );
    const placed = { ...finding, ownerTicketId: owner?.ticketId ?? null };
    if (owner) findings.push(placed);
    else outOfScope.push(placed);
  }

  return { findings, outOfScope, rejected };
}

/** Findings grouped by the ticket that owns their path — one repair round per ticket. */
export function groupByOwner(
  batch: RepairBatch,
): ReadonlyMap<string, readonly RepairFinding[]> {
  const grouped = new Map<string, RepairFinding[]>();
  for (const finding of batch.findings) {
    if (!finding.ownerTicketId) continue;
    const list = grouped.get(finding.ownerTicketId) ?? [];
    list.push(finding);
    grouped.set(finding.ownerTicketId, list);
  }
  return grouped;
}
