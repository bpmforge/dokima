export const PACKAGE_NAME = 'memory';

/**
 * FR-L5/FR-L8 Context Packer (W12-04). `packer/index.ts` has existed since
 * FR-L5 landed and was never re-exported here — its own header says why:
 * this file was outside that ticket's `write_scope`. The effect was that
 * `assemblePacket` had zero callers not because nothing wanted it, but
 * because nothing could reach it (TECH_STACK forbids deep imports across
 * package boundaries). `code-index/` still has the same unexported local
 * barrel; it stays that way until something needs it.
 */
export * from './packer/index.js';

/**
 * W12-09: the W7-06 code index, exported for the first time. Same shape as the
 * packer barrel W12-04 fixed: `code-index/index.ts` existed and complete, was
 * never re-exported here, and so had no reachable caller — which is why the
 * packed context shipped with no ranked code slices.
 */
// NARROW, not `export *`: re-exporting the whole code-index barrel exposed
// four more value symbols with no caller and pushed validate-exports 43 -> 47.
// The ratchet's own rule is not to raise the baseline to make a change pass,
// so this exports exactly what a consumer needs to build and use the index.
export { indexProject } from './code-index/indexer.js';
export type { IndexProjectOptions, IndexProjectResult } from './code-index/indexer.js';
// The handle type a caller must supply: `packages/memory` never opens a
// writable connection itself (store/handle.ts), so the type has to be
// nameable from outside or no caller can satisfy the contract.
export type { SqliteHandle } from './store/handle.js';

export * from './lessons/report.js';
export * from './lessons/triage.js';
export * from './lessons/types.js';
export * from './lessons/events.js';

/**
 * W13-23: the memory anchor, exported for the first time. Third instance of
 * the same seam W12-04 (packer) and W12-09 (code index) each hit — the
 * implementation was complete and tested, and simply could not be reached
 * from outside the package, so it had no caller because nothing COULD call it.
 *
 * NARROW, not `export *`: the store barrel carries a dozen more symbols with
 * no consumer, and re-exporting them wholesale would raise the export ratchet
 * to make one addition pass.
 */
export { createMemoryAnchor } from './store/anchor.js';
export type { CreateMemoryAnchorOptions, MemoryAnchor } from './store/anchor.js';


/**
 * W14-05: the fact bank's production write path (cli/memory-hooks.ts in
 * apps/server) — parks insert verified symptom facts, closes append the
 * solution half, error-first recall leads with the pair.
 */
export {
  appendFactSolution,
  insertFact,
  listFacts,
  markFactVerified,
} from './store/facts.js';
export type { FactKind, FactRecord, InsertFactInput } from './store/facts.js';

/** W14-06: the sleep-consolidation job body, called by apps/server when a run completes (the local-first product's only real idle moment). */
export {
  CONSOLIDATION_ENABLED_BY_DEFAULT,
  runSleepConsolidation,
} from './consolidation/consolidate.js';
export type {
  ConsolidationReport,
  RunConsolidationOptions,
} from './consolidation/consolidate.js';
export type { MorningPreBrief, MorningPreBriefFact } from './consolidation/pre-brief.js';

/** W15-02: calibration persistence for the learning hook (FR-L3) — round-trips loop's own record shape. */
export { getCalibration, listCalibration, upsertCalibration } from './store/calibration.js';

/**
 * W16-03: the R0 playbook consult, exported for the first time — fourth
 * instance of the built-but-unreachable seam (W12-04 packer, W12-09 code
 * index, W13-23 anchor): the hook existed, its tests drove gateway's real
 * ladder, and no production path could import it. apps/server composes it
 * into the land loop's `r0Consult` seam (harbormaster may not import this
 * package, ARCHITECTURE §4). NARROW export, same ratchet discipline as
 * every block above.
 */
export { createPlaybookMemoryConsultHook } from './playbook/r0-hook.js';
export type { R0ConsultInput, R0ConsultResult, R0MemoryConsultHook } from './playbook/r0-hook.js';
export type {
  ConsultPlaybookOptions,
  GlobalPlaybookEntryLike,
} from './playbook/consult.js';
export type { PlaybookConsultEvent, PlaybookConsultSink } from './playbook/events.js';
