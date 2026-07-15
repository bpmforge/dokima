/**
 * Finding ledger barrel (BLUEPRINT §3.5, FR-L6, docs/design/FINDING_LOOP_POLICY.md §1,
 * DATABASE.md §5b) — book-style split per CODE_BOOK_PROTOCOL (validate-file-size.sh cap):
 * `findings-types.ts` (identity + record/event shapes), `findings-ledger.ts` (the stateful
 * tracker + funnel), `findings-rules.ts` (rule lifecycle + FP bookkeeping, FR-RL1/2),
 * `findings-infra.ts` (infra-failure taxonomy, R-D2). This file just re-exports the public
 * surface so callers only ever need `from './findings.js'`.
 */

export * from './findings-types.js';
export * from './findings-ledger.js';
export * from './findings-rules.js';
export * from './findings-infra.js';
