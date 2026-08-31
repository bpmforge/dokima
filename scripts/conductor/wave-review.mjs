// conductor/wave-review.mjs — Tier-A concurrent multi-model advisory review
// over the wave's aggregate diff (P3-03, the `interrogate` shape).
//
// The signal is MODEL DIVERSITY, not assigned personas: reviewers run
// concurrently, each in its own session on its own configured model, each
// writing a distinct immutable report. Synthesis weights 2+-model consensus
// highest; the citation gate discards unresolvable findings BEFORE synthesis
// (the fabricated-REJECT control); and by construction nothing here blocks —
// Tier A advises, Tier D (receipts + validators + seams) gates. Findings
// reuse @dokima/loop's finding ledger (F-<ticket>-<n> + fingerprints) via the
// same lazy TS import pattern as heal.mjs, and are attributed to the member
// ticket whose branch touched the cited file — only that ticket reopens.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { citedFindings, parseJson } from '../conductor-lib.mjs';

let ledgerMod; // lazy: module | 'unavailable' (vendored installs without packages/loop)
async function loadLedger() {
  if (ledgerMod) return ledgerMod;
  try {
    ledgerMod = await import('../../packages/loop/src/findings-ledger.ts');
  } catch {
    ledgerMod = 'unavailable';
  }
  return ledgerMod;
}

/** Which Tier-A reviewers this wave's aggregate diff recruits (config-driven). */
export function waveReviewers(touchedFiles, cfg = {}) {
  const kinds = ['code']; // always
  const table = {
    security:
      cfg.securityPathRe ??
      '(auth|secret|credential|keychain|crypto|packages/events/|packages/gateway/)',
    perf: cfg.perfPathRe ?? '(packages/gateway/|db|store/|migrations?/|cache)',
    ux: cfg.uxPathRe ?? '(apps/web/|\\.(tsx|css)$)',
  };
  for (const [kind, src] of Object.entries(table)) {
    const re = new RegExp(src, 'i');
    if (touchedFiles.some((f) => re.test(f))) kinds.push(kind);
  }
  return kinds;
}

export function waveReviewPrompt(kind, waveId, memberIds, diff) {
  const lens = {
    code: 'correctness, error handling, dead code, cross-ticket contract drift, tests that can actually fail',
    security:
      'OWASP classes, secrets, injection (this app shells out to git and spawns child processes), trust-boundary violations, unsafe deserialization',
    perf: 'N+1 and unbounded queries, hot-path allocations, blocking I/O in async paths, missing pagination',
    ux: 'user-visible behavior changes, a11y regressions, empty/error states, copy drift',
  }[kind];
  return `You are ONE of several independent reviewers examining the AGGREGATE diff of wave ${waveId} (member tickets: ${memberIds.join(', ')}). Your lens: ${lens}.
You did not write this code. Your verdict is ADVISORY — deterministic gates decide merges; your job is findings, ranked, each with a citation that resolves.
Respond with ONLY JSON: {"findings":[{"severity":"CRITICAL"|"HIGH"|"MEDIUM"|"LOW","file":"<path that exists in this diff/tree>","issue":"...","fix":"..."}]}
A finding without a real file citation will be DISCARDED unread. Do not pad; an empty findings list is a valid answer.

DIFF:
${diff}`;
}

/** Deterministic consensus key: same file + leading normalized issue tokens. */
export function consensusKey(f) {
  const words = String(f.issue ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
    .join(' ');
  return `${f.file}::${words}`;
}

/**
 * Synthesize per-reviewer finding sets into the consensus tiers:
 *   Act On   — 2+ reviewers agree, or a lone CRITICAL/HIGH on a security surface
 *              (never auto-dismissed — the one exception the design carves out)
 *   Consider — lone CRITICAL/HIGH elsewhere
 *   Noted    — everything else that survived the citation gate
 *   Dismissed — citation did not resolve (discarded unread, listed for audit)
 * Every surviving finding is attributed to the member whose branch touched the
 * cited file; unattributable findings attach to the whole wave.
 */
export function synthesizeWaveFindings(
  perReviewer,
  { fileExists, memberByFile, securityRe },
) {
  const secRe =
    securityRe ?? /(auth|secret|credential|keychain|crypto|packages\/events\/)/i;
  const dismissed = [];
  const byKey = new Map();
  for (const { kind, findings } of perReviewer) {
    const { cited, discarded } = citedFindings(findings, fileExists);
    for (const d of discarded)
      dismissed.push({ ...d, reviewer: kind, reason: 'citation does not resolve' });
    for (const f of cited) {
      const key = consensusKey(f);
      if (!byKey.has(key)) byKey.set(key, { ...f, reviewers: [] });
      const e = byKey.get(key);
      if (!e.reviewers.includes(kind)) e.reviewers.push(kind);
      // keep the worst severity across agreeing reviewers
      const rank = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
      if ((rank[f.severity] ?? 0) > (rank[e.severity] ?? 0)) e.severity = f.severity;
    }
  }
  const actOn = [];
  const consider = [];
  const noted = [];
  for (const e of byKey.values()) {
    const high = e.severity === 'CRITICAL' || e.severity === 'HIGH';
    const onSecuritySurface = secRe.test(e.file ?? '');
    e.attributedTo = memberByFile?.(e.file) ?? null;
    if (e.reviewers.length >= 2 && high) actOn.push(e);
    else if (e.reviewers.length === 1 && high && onSecuritySurface)
      actOn.push(e); // never auto-dismissed
    else if (high) consider.push(e);
    else if (e.reviewers.length >= 2) consider.push(e);
    else noted.push(e);
  }
  return {
    actOn,
    consider,
    noted,
    dismissed,
    agreementMap: [...byKey.values()].map((e) => ({
      file: e.file,
      reviewers: e.reviewers,
      severity: e.severity,
    })),
    blocking: [], // BY CONSTRUCTION: Tier A cannot block (Law L2)
  };
}

/** Stamp ledger IDs (F-<attributed>-<n> + fingerprints) via @dokima/loop; scheme-compatible fallback when vendored. */
export async function ledgerize(waveId, tiers) {
  const mod = await loadLedger();
  const all = [...tiers.actOn, ...tiers.consider, ...tiers.noted];
  if (mod !== 'unavailable') {
    const perTicket = new Map();
    for (const f of all) {
      const owner = f.attributedTo ?? waveId;
      if (!perTicket.has(owner))
        perTicket.set(owner, { ledger: mod.createFindingLedger(owner), raws: [] });
      perTicket.get(owner).raws.push({
        finding: f,
        raw: {
          file: f.file ?? '-',
          category: 'wave-review',
          issue: f.issue ?? '',
          severity: f.severity ?? 'MEDIUM',
          fixHint: f.fix,
        },
      });
    }
    for (const { ledger, raws } of perTicket.values()) {
      ledger.reportPass(
        raws.map((r) => r.raw),
        1,
      );
      for (const r of raws) {
        const rec =
          ledger.findings.find((x) => x.file === r.raw.file && x.issue === r.raw.issue) ??
          ledger.findings[raws.indexOf(r)];
        r.finding.id = rec?.id ?? null;
        r.finding.fingerprint = rec?.fingerprint ?? null;
      }
    }
  } else {
    let n = 0;
    for (const f of all) f.id = `F-${f.attributedTo ?? waveId}-${++n}`;
  }
  return tiers;
}

/**
 * Run the Tier-A pass: reviewers CONCURRENT, each on its own model, each
 * report written immutably before synthesis. runSession is injected
 * (the conductor's session runner) so tests never spawn a model.
 */
export async function runWaveReview({
  waveId,
  diff,
  memberIds,
  touchedFiles,
  cfg = {},
  models = {},
  runSession,
  wt,
  evidenceDir,
  fileExists,
  memberByFile,
}) {
  const kinds = waveReviewers(touchedFiles, cfg);
  const results = await Promise.all(
    kinds.map(async (kind) => {
      const model = models[kind] ?? models.reviewer ?? models.code;
      const r = await runSession(
        waveReviewPrompt(kind, waveId, memberIds, diff),
        model,
        `wave-review:${kind}:${waveId}`,
        wt,
      );
      const parsed = parseJson(r.out) ?? { findings: [] };
      return { kind, model, findings: parsed.findings ?? [] };
    }),
  );
  // Immutable per-reviewer reports BEFORE synthesis — the orchestrator ingests
  // finding sets, never transcripts, and the raw sets survive for audit.
  mkdirSync(evidenceDir, { recursive: true });
  for (const r of results) {
    writeFileSync(
      resolve(evidenceDir, `review-${r.kind}.json`),
      JSON.stringify(r, null, 2) + '\n',
    );
  }
  const tiers = await ledgerize(
    waveId,
    synthesizeWaveFindings(results, {
      fileExists,
      memberByFile,
      securityRe: cfg.securityRe,
    }),
  );
  writeFileSync(
    resolve(evidenceDir, 'wave-report.json'),
    JSON.stringify({ waveId, kinds, ...tiers }, null, 2) + '\n',
  );
  return { kinds, ...tiers };
}

/**
 * Delta re-review (OPT-10): after a member's fix, only the FAILED checks
 * re-run against the new synthetic head — never the whole pass.
 */
export function checksToRerun(prevReport) {
  if (!prevReport) return null; // first run: everything
  const failedKinds = new Set(
    (prevReport.actOn ?? []).map((f) => f.reviewers ?? []).flat(),
  );
  return [...failedKinds];
}
