/**
 * research-gate.ts — the phase-advance research check (W16-05, FR-P8/FR-P4,
 * US-105 AC-2: "a slate citing an unchallenged HIGH claim is refused").
 *
 * `packages/pipeline`'s research module has carried the whole rule set since
 * W5 — depth floors, per-claim citations, the Challenger citability gate —
 * and nothing consulted it: the advance route verified gate receipts and
 * never looked at `docs/research/` at all, so an unchallenged HIGH claim
 * gated exactly nothing. This chapter is the consult.
 *
 * Artifact convention (the same docs-tree-as-truth shape every phase
 * deliverable uses): a research report is `docs/research/<name>.json`
 * (`ResearchReport`), and its recorded Challenger verdicts — when a
 * challenge has been run — are the sibling `docs/research/<name>.challenge.json`
 * (`ChallengeReport`, FR-P4's CHALLENGE_REPORT artifact). Verdicts are READ,
 * never derived here: the gate is mechanical (C-2); model judgment happens
 * wherever the challenge ran and left its artifact. A missing challenge file
 * is an EMPTY verdict set, which `validateResearchReport` fails closed on
 * for HIGH claims — absence of challenge is refusal, never a pass.
 *
 * Markdown files in `docs/research/` (this repo has many) are not reports
 * and are ignored; only `.json` files are read, and a `.json` that does not
 * parse or does not look like a report is a NAMED refusal — a malformed
 * research artifact must hold the gate, not slip past it.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  validateResearchReport,
  type ChallengeReport,
  type ClaimVerdict,
  type PhaseId,
  type ResearchReport,
} from '@dokima/pipeline';

const RESEARCH_DIR = path.join('docs', 'research');
const CHALLENGE_SUFFIX = '.challenge.json';

function looksLikeReport(value: unknown): value is ResearchReport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.phase === 'number' &&
    typeof v.depth === 'string' &&
    Array.isArray(v.sources) &&
    Array.isArray(v.claims)
  );
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
}

async function verdictsFor(reportPath: string): Promise<Map<string, ClaimVerdict>> {
  const challengePath = reportPath.replace(/\.json$/, CHALLENGE_SUFFIX);
  const verdicts = new Map<string, ClaimVerdict>();
  let raw: unknown;
  try {
    raw = await readJson(challengePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return verdicts;
    throw new MalformedResearchArtifactError(challengePath, err);
  }
  const challenge = raw as ChallengeReport;
  if (!Array.isArray(challenge?.claims)) {
    throw new MalformedResearchArtifactError(
      challengePath,
      new Error('no claims[] array'),
    );
  }
  for (const claim of challenge.claims) {
    verdicts.set(claim.claimId, claim.verdict);
  }
  return verdicts;
}

class MalformedResearchArtifactError extends Error {
  constructor(
    public readonly file: string,
    cause: unknown,
  ) {
    super(
      `research artifact ${file} is unreadable (${cause instanceof Error ? cause.message : String(cause)}) — a malformed research artifact holds the gate rather than slipping past it`,
    );
    this.name = 'MalformedResearchArtifactError';
  }
}

/**
 * Refusal reasons from every research report declared for `phaseId`. Empty
 * when the phase has no reports (research stays on-demand, US-105 — a phase
 * that never asked for research owes none) or when every report passes its
 * validator with its recorded verdicts.
 */
export async function evaluateResearchGate(
  projectRoot: string,
  phaseId: PhaseId,
): Promise<readonly string[]> {
  const dir = path.join(projectRoot, RESEARCH_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const reasons: string[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json') || entry.endsWith(CHALLENGE_SUFFIX)) continue;
    const reportPath = path.join(dir, entry);
    let raw: unknown;
    try {
      raw = await readJson(reportPath);
    } catch (err) {
      reasons.push(new MalformedResearchArtifactError(reportPath, err).message);
      continue;
    }
    if (!looksLikeReport(raw)) {
      reasons.push(
        `research artifact ${reportPath} is not a research report (missing id/phase/depth/sources/claims) — fix or remove it`,
      );
      continue;
    }
    if (raw.phase !== phaseId) continue;

    let verdicts: Map<string, ClaimVerdict>;
    try {
      verdicts = await verdictsFor(reportPath);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    reasons.push(...validateResearchReport(raw, verdicts).reasons);
  }
  return reasons;
}
