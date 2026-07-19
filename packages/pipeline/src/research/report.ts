/**
 * Whole-report validator (FR-P8's acceptance sketch: "research report without citations fails
 * its validator"). Combines the depth policy's source-count floor, per-claim citation
 * validation, the Challenger citability gate, and (for `deep` reports) the "every claim needs a
 * verdict" rule into the one pass/fail surface a gate consults before a report may be cited.
 */

import { getDepthPolicy } from './depth.js';
import { validateReportCitations } from './citations.js';
import { decideReportCitability } from './challenger-gate.js';
import type { CheckResult, ClaimVerdicts, ResearchReport } from './types.js';

export function validateResearchReport(
  report: ResearchReport,
  verdicts: ClaimVerdicts,
): CheckResult {
  const reasons: string[] = [];

  if (report.claims.length === 0) {
    reasons.push(`research report "${report.id}" has no claims`);
  }

  const policy = getDepthPolicy(report.depth);
  if (report.sources.length < policy.minSources) {
    reasons.push(
      `depth "${report.depth}" requires at least ${policy.minSources} source(s); ` +
        `report "${report.id}" has ${report.sources.length}`,
    );
  }

  reasons.push(...validateReportCitations(report.claims, report.sources).reasons);
  reasons.push(...decideReportCitability(report.claims, verdicts).reasons);

  if (policy.challengerMandatory) {
    for (const claim of report.claims) {
      if (!verdicts.has(claim.id)) {
        reasons.push(
          `depth "deep" requires a Challenger verdict on every claim — "${claim.id}" has none ` +
            '(researcher.md Step 5.4: Challenger mandatory on every DEEP DIVE report)',
        );
      }
    }
  }

  return { valid: reasons.length === 0, reasons };
}
