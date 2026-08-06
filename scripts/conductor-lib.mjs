// conductor-lib.mjs — pure, side-effect-free helpers extracted out of
// conductor.mjs so they can be unit-tested directly. conductor.mjs itself
// runs a real build harness as a top-level side effect on import (it calls
// `main()` at the bottom of the file), so it cannot be imported from a test
// without spawning git/claude sessions. These functions have no such
// side effect — importing this file does nothing but define functions and
// one constant object.
//
// W9-09: extraction only, no behavioural change. conductor.mjs imports these
// same functions instead of defining them inline; call sites and inputs are
// unchanged.
//
// W10-46: this file was 590 lines, over the 400-line CODE_BOOK_PROTOCOL cap,
// and — with conductor.mjs — was the reason validate-file-size could not be
// flipped repo-wide (W10-40): it IS the machinery that runs the gate, so
// turning the gate on would have failed every ticket including the one fixing
// it. The implementation now lives in `scripts/conductor-lib/` chapters and
// this file is a pure re-export barrel.
//
// It stays at this exact path deliberately. ESM has no directory-index
// resolution, and conductor.mjs, both test suites, and every ad-hoc board
// script import `./conductor-lib.mjs` by name — a barrel here means the split
// moved no call site at all. `isAsciiOnly`/`asciiEscapeNonAscii` remain
// private to the board chapter and are deliberately not re-exported.

export {
  DEFAULT_CONFIG,
  validateModels,
  nodePinMismatch,
  mergeConfig,
  loadConfigFile,
  alwaysOkPatterns,
} from './conductor-lib/config.mjs';

export { wave, nonWildPrefix, globToRegex, parseJson } from './conductor-lib/parsing.mjs';

export { claimableTickets } from './conductor-lib/claim.mjs';

export {
  testSiblingWarning,
  migrationCollisions,
  migrationScopeWarning,
  doneCheckGap,
  pageMountWarning,
  boardUnreadableGap,
} from './conductor-lib/lint-rules.mjs';

export { planPath, loadPlanFrom, serializePlan, writePlan } from './conductor-lib/board.mjs';

export { codingPrompt } from './conductor-lib/prompts.mjs';

export { reviewDecision, selectGates } from './conductor-lib/review.mjs';
