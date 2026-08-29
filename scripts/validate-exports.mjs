#!/usr/bin/env node
// validate-exports.mjs — the no-callers validator (W12-10).
//
// THE DEFECT CLASS: a mechanism lands complete, tested, with a documented
// contract and NO production caller, and stays green forever because nothing
// in the gate can see an exported interface that nothing calls. Six shipped
// instances by 2026-08-13 (W11-04 `RunSessionInput.secretValues`, W11-16's
// wrap-`spawn`, W12-08's `HandoffBuilder` override, W12-04's `packer/`
// barrel, W12-05's `anchors.ts`, the 93-expert roster) — three of them in a
// single dependency chain, and two SELF-DOCUMENTED with a "a future ticket
// wires this up" comment against a ticket that did not exist. Prose intent
// is not a control; this is.
//
// Exports are enumerated through the TypeScript checker (not a regex over
// barrel files) because every package barrel re-exports with `export * from`,
// so the symbol names do not appear in the barrel's own text at all.
//
// References are counted by word-boundary text match, which is a heuristic and
// is stated as one: it OVER-counts (a name in a string, or a same-named local
// in an unrelated file, reads as a use), so a symbol this validator reports as
// unreferenced is unreferenced under a deliberately generous test. False
// NEGATIVES are the acceptable direction here; false positives would get the
// whole check waived.
//
// COMMENTS ARE NOT PART OF THAT OVER-COUNT — this text used to say they were,
// and it was stale for a whole wave. W12-39 moved `stripComments` inside
// `countReferences` precisely so an explanation of why nothing calls a
// function could not be counted as a call. It matters beyond accuracy: it is
// what makes the `@unreached` marker below safe to write, since naming the
// symbol in the marker cannot create a phantom reference to it.
//
// SPLIT INTO CHAPTERS (W22-02, following W10-46). This file was 399 lines —
// one under the CODE_BOOK_PROTOCOL cap — so the W22-02 additions could not
// land without it. The implementation now lives in `scripts/validate-exports/`
// and this stays a pure re-export barrel PLUS the CLI entry.
//
// It keeps this exact path deliberately, for the reason conductor-lib.mjs
// gives: ESM has no directory-index resolution, and `run-validators.mjs`,
// `conductor.config.json` and the test suite all name `validate-exports.mjs`.
// A barrel here means the split moved no call site.
export {
  REPO_ROOT,
  SCAN_ROOTS,
  isBarrel,
  isTestFile,
  isTestSupportFile,
  walkSourceFiles,
} from './validate-exports/files.mjs';
export { countReferences, stripComments } from './validate-exports/strip.mjs';
export {
  exportsOfBarrel,
  moduleExports,
  unreachedMarkers,
} from './validate-exports/symbols.mjs';
export { findUnreferencedExports } from './validate-exports/find.mjs';
export { BASELINE_FLAG, BURIED_BASELINE_FLAG } from './validate-exports/report.mjs';

import { main } from './validate-exports/report.mjs';

if (import.meta.url === `file://${process.argv[1]}`) main();
