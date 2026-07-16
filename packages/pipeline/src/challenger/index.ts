export type { RerunEvidence } from './rerun.js';
export { isValidRerun, formatRerunLine } from './rerun.js';

export {
  ChallengerSameModelError,
  assertChallengerModelDistinct,
} from './model-guard.js';
export type { ModelIdentityInput } from './model-guard.js';

export { DEFAULT_MAX_TOOL_CALLS_PER_CLAIM, evaluateClaimChallenge } from './claims.js';
export type {
  Claim,
  ClaimVerdict,
  Citation,
  ChallengeAttempt,
  ClaimVerdictResult,
  ClaimIncomplete,
  ClaimRecorded,
  ClaimVerdictOutcome,
} from './claims.js';

export {
  buildChallengeReport,
  buildRevisionHandoffs,
  UnknownClaimError,
} from './report.js';
export type {
  ChallengeReportInput,
  ChallengeReport,
  ChallengeRevisionHandoff,
} from './report.js';

export {
  classifySubjectiveScore,
  classifyReviewSignal,
  evaluateScoreVerdict,
} from './score.js';
export type {
  ReviewSignalAction,
  ScoreVerdictInput,
  ScoreVerdictIncomplete,
  ScoreVerdictRecorded,
  ScoreVerdictOutcome,
} from './score.js';
