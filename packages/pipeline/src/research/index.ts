export type {
  CheckResult,
  ClaimImpact,
  ClaimVerdict,
  ClaimVerdicts,
  FactBankEntry,
  PhaseId,
  ResearchClaim,
  ResearchDepth,
  ResearchReport,
  ResearchSource,
  SourceTier,
} from './types.js';

export { getDepthPolicy } from './depth.js';
export type { DepthPolicy } from './depth.js';

export { validateClaimCitations, validateReportCitations } from './citations.js';

export {
  decideClaimCitability,
  decideReportCitability,
  isChallengerRequired,
} from './challenger-gate.js';

export { decideFactBankAdmission } from './fact-bank.js';
export type { FactBankContext } from './fact-bank.js';

export { validateResearchReport } from './report.js';

export {
  RESEARCH_TEMPLATES,
  UnknownResearchTemplateError,
  getResearchTemplate,
  templatesForPhase,
} from './templates.js';
export type { ResearchTemplate } from './templates.js';
